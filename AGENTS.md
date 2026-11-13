# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## Project Status

Library in active early development (v0.1.0). Breaking changes to the public API are expected and acceptable — favor the best design over backwards compatibility.

## Commands

```bash
pnpm build              # Generate Inter modules, then bundle with tsup → dist/ (index, node, fonts/inter)
pnpm type-check         # TypeScript strict validation of src and tests
pnpm test               # vitest unit tests (tests/unit)
pnpm test:coverage      # same with coverage; thresholds (100 %) in vitest.config.ts; CI runs it on Node 24 only
pnpm check:pdf          # PDF text baselines (pdftotext -raw, page by page, whitespace aside); check:pdf:update refreshes them and the layout baselines
pnpm check:layout:update # Refresh the layout baselines alone (tests/baselines/*.layout.txt)
pnpm check:browser      # Bundle dist/index.js for the browser (after build; POSIX-only)
pnpm check:readme       # Compile the ts snippets of the README, component pages and JSDoc against dist/, run them to toBuffer(), check the names they cite (part of check:all, after build)
pnpm check:docs         # Component pages: runs their snippets against dist/, checks index, generated tables and preview fingerprints (no poppler; part of check:all)
pnpm docs:components    # Build, write the option tables and render the previews of docs/components (needs pdftoppm)
pnpm check:all          # Everything CI runs, coverage aside (pnpm test:coverage)
pnpm docs:api           # typedoc → docs/api (git-ignored); fails on missing JSDoc or broken links; part of check:all
pnpm docs:previews      # Render example pages to docs/images/*.png (needs pdftoppm)
pnpm fonts:generate     # Regenerate src/fonts/inter/generated (also run by prepare and build)
pnpm lint               # oxlint
pnpm lint:fix           # oxlint --fix
pnpm fmt                # oxfmt --write
pnpm fmt:check          # oxfmt formatting check
pnpm example:invoice    # Generate invoice PDF → output/invoice.pdf
pnpm example:report     # Generate report PDF → output/report.pdf
pnpm example:all        # Generate all example PDFs
```

Pre-push hook runs `pnpm lint && pnpm fmt:check`. CI runs `pnpm check:all` on Node 22 and 24.

## Architecture

**@mlt-a/jspdf-toolkit** — themed PDF generation library wrapping jsPDF with a fluent API.

### Pipeline

```
createTheme({ colors: { primary: '#3572B8' } })
  → auto-generates 15-color palette via generatePalette()
  → new PDFDocument({ theme? })
    → registers `fonts` (first family is the default when the theme names none, else Helvetica; Inter opt-in via `@mlt-a/jspdf-toolkit/fonts/inter`)
    → initializes jsPDF + layout state
  → doc.heading().paragraph().table()...  (chainable methods, each updates yPos)
  → doc.finalize()  (renders page numbers, footers — auto-called on export)
  → doc.toBuffer() / toDataUri() / toBlob()
```

### Module Layout

- **`src/core/document.ts`** — `PDFDocument` class. The main API. All fluent methods live here, delegating to drawing functions. Tracks Y position, page breaks, cover pages. Page decorations are two fixed layers drawn by `startPage`: theme color, `background` image; the `onNewPage` hook runs after them. `finalize` draws the watermarks last, over everything. Holds the current frame (page or column) that `margins`, `contentWidth` and `measure` return.
- **`src/core/constants.ts`** — `LAYOUT`, `SPACING`, `LINE_WIDTH`, `BOX`, `COVER`, `TextLevel` and `HeadingLevel` types, `HEADING_LEVELS`. All layout magic numbers are here. `SPACING` is the only scale of gaps: a gap in a component constant is one of its steps; sizes (icon, bar, margin) and radii (`RADIUS`) stay plain numbers.
- **`src/theme/`** — Theme system. `createTheme()` in `defaults.ts` merges overrides. `colors.ts` has `generatePalette()` which derives 15 tokens from a single primary color using WCAG luminance. `presets.ts` has 10 named themes (ocean, emerald, slate, etc.).
- **`src/core/context.ts`** — `DrawingContext`, a type alias of `PDFDocument`: the name drawing primitives and custom components take.
- **`src/core/page-layout.ts`** — `PageLayout`, the page geometry: the four margins (`resolveMargins`), `firstPageTop`, the header reserve widening `margins.top`. `topFor(page)` includes the header reserve; `baseTop(page)` (covers) does not.
- **`src/core/page-format.ts`** — `PageFormat`, `resolvePageFormat`: names and `[width, height]`, validated before jsPDF is built.
- **`src/utils/defined.ts`** — `defined()`: spread over defaults so an explicit `undefined` keeps them. Use it for every override merge.
- **`src/drawing/`** — Low-level drawing primitives (text, boxes, lists, fields, checkboxes, columns, etc.). Each takes a `DrawingContext` and returns the new Y position. Shared text code: `text-style.ts` (font roles, `setFont`, `TextStyle`), `drawing-state.ts` (`withDrawingState`, `trackDrawingState`, `withStroke`), `text-lines.ts` (text normalization, tracked width, wrapping, justification, list prefixes, `fitWithEllipsis`, `resolveLineWidth` and `remainingTextWidth` for a validated line width). Charts: `charts.ts` (donut, stacked bar, columns, lines) and `chart-parts.ts`; each `layoutX` validates, resolves colors and measures once, and returns `{ height, paint }` or nothing; `drawChart` reserves the room, paints under `withDrawingState`, then `endBlock`; `computeXHeight` reads the same layout; every number is in `CHART`. Public JSDoc writes default values as numbers, never as the name of a constant that is not exported; `constants.test.ts` pins them. `frameWidth` and `fitLineWidth` (`text-lines.ts`) bring a width or a `maxWidth` down to the available width with a warning, for charts, paragraphs, rich text and lists alike; `labelFitter` warns once per chart for a label that disappears; `legendBelow` builds the legend under a chart. `withStroke` (`drawing-state.ts`) draws a colored, dashed stroke for the leader and the charts.
- **`src/page/`** — Page-level components (cover pages, wave cover, header/logo/badge, closing note, running header/footer, background images).
- **`src/table/`** — Native table engine (`drawTable`): column widths from content, rows never split, repeated head, continuation title, foot row kept with the last row, `cellStyle` per cell.
- **`src/fonts/`** — Font registration from `FontSource`; `loadFontFromBase64/Binary(data, { family, style? })` build the sources. `src/fonts/inter/` is the opt-in Inter entry; its base64 modules are generated from `assets/fonts/inter` by `pnpm fonts:generate` (git-ignored).
- **`src/images/`** — Browser-safe loaders (`loadImageFromBase64/Binary(data, { mimeType? })`, type sniffed when absent). Images are named with `doc.registerImage(name, data)`; every image option takes a registered name or image data, resolved by the document's `ImageCache`.
- **`src/node/`** — `@mlt-a/jspdf-toolkit/node` entry: the only module using `node:fs` (`loadImageFromPath(path, { mimeType? })`, `loadFontFromPath(path, { family, style? })`).
- **`src/core/errors.ts`** — `PdfToolkitError` and subclasses (`InvalidColorError`, `InvalidOptionError`, `AssetLoadError`). Invalid configuration throws; runtime asset problems add a warning. The `checked*` and `optional*` functions of this file (number, text, boolean, choice, function, array, object, box, point) are the only validators, with one message format: `Invalid <what>: <value> — must be <rule>`. A position or size option (`x`, `y`, `width`, `maxWidth`, `height`, `indent`, `gap`) is checked by them before anything is drawn. So is everything else a caller passes: text arguments, optional fields (absent is fine, a wrong type throws, `null` included), required fields of content structures (list items, fields, table rows, chart data), and options that belong to another variant. An invalid input throws `InvalidOptionError` (`InvalidColorError` for a color), never a `TypeError`, and never after a partial draw. Each case has a row in `tests/unit/option-validation.test.ts`.
- **`src/text/markup.ts`** — Rich text parser (`**bold**`, `*italic*`), no PDF dependency.
- **`src/core/page-references.ts`** — `PageReferences`: cover, back cover, TOC entries and the watermarks of a single page, kept right when pages move. `numberedPages(total)` answers "which pages get page furniture".
- **`src/examples/`** — Runnable examples in Inter, listed once in `registry.ts`: the CLI runner and the layout test read it. Images load through `exampleAsset` (`assets.ts`). `pnpm check:pdf` compares their `pdftotext` output to `tests/baselines/`.
- **`docs/components/`** — one page per component (index `README.md`), published by typedoc (`projectDocuments`). `scripts/docs-components.mjs` writes the `<!-- options: Type -->` tables from the JSDoc and renders the `<!-- preview: name -->` snippets to `docs/images/components/`; `scripts/check-readme.mjs` compiles and runs their snippets (a snippet that uses `doc` gets a demo document; `// warns: <part of the warning>` marks a warning shown on purpose, and only that one may be raised). The index holds the demo document (`<!-- demo document -->`), the one the scripts run. `<!-- table: … -->` tables (text levels, spacing) are generated from the code like the option tables. `fingerprints.json`, next to the images, records what each preview draws: `check:docs` fails on a stale image without poppler. Shared script code is in `scripts/_shared.mjs`.
- **Entry points** (tsup, ESM only): `.`, `./node`, `./fonts/inter`. See `exports` in `package.json`.
- **`tests/unit/`** — vitest unit tests, one file per module, plus tables run over every primitive: `primitive-cases.ts` (drawing state, fill colors, raw drawing) and `option-validation.test.ts` (every invalid option throws before anything is drawn). `helpers.ts` holds the shared recorders; `content-stream.ts` reads a page's content stream with a closed list of operators (anything it cannot read throws). `examples-layout.test.ts` compares each example to its layout baseline, written by `layout.ts` without poppler: one line per string, shape, image, clip and link, with position, size, color, opacity and dash, and the document properties. Each `build` of `src/examples/registry.ts` returns the finalized document.

### Key Patterns

**Drawing context**: Primitives take `ctx: DrawingContext` (the `PDFDocument` itself), never raw jsPDF or the theme alone. Members only the library needs (`peekYPos`, `atPageTop`, `layout`, `pageRefs`, `parallel`…) are tagged `/** @internal */` on `PDFDocument` and stripped from the published `.d.ts` (`stripInternal`). Line metrics come from `measureTextLevel(ctx, level)`.

**Return contract**: Flow primitives `drawX(ctx, content, options?)` call `ensureSpace(height)` before reading the position (it places waiting headings), draw from `ctx.getYPos()` and close with `ctx.endBlock(bottom, options?.spaceAfter)`, whose result they return. `endBlock` supplies the default space; a block that reserves it before drawing reads it from `ctx.resolveSpaceAfter(spaceAfter)`. A block that asks for space above it calls `ctx.beginBlock(spaceBefore)` after `ensureSpace`. A block that redraws something at the top of a new page (a table's title and head) passes its height as `ensureSpace(height, { lead })`. A flow primitive checks its options (`spaceAfter` through `ctx.resolveSpaceAfter` included) before anything else, so an invalid option throws whether or not there is content. A flow primitive given nothing to draw then tests its input and returns `ctx.peekYPos()`; its `computeXHeight` returns 0. Position, trailing space and waiting headings stay. Coordinate primitives `drawX(ctx, content, { x, y, … })` take `y` = top of what they draw and return the Y under it. `computeXHeight(ctx, content, options?)` takes the same options and excludes `spaceAfter`; `measureX` returns a metrics object. Page decorations return nothing. Page-closing blocks (`closingNote`, `backCover`) anchor at the bottom of the content area and move Y there, so the next block starts a new page.

**keepTogether**: `keepTogether(fn)` runs `fn` on scratch pages to measure it, rolls back what the pass recorded, then draws on the current or next page.

**TextLevel system**: 14 semantic text levels (`h1`–`h4`, `body`, `bodyBold`, `small`, `caption`, `label`, `fieldLabel`, `fieldValue`, `footer`, `italic`, `smallMuted`) mapped to theme typography via `TEXT_STYLE_MAP` in `drawing/text.ts`.

**Frame**: `margins`, `contentWidth` and `measure` read the current frame: the page, a column of `columns`, or an `inset`. `PDFDocument.parallel(branches)` (internal) opens one frame per branch, restarts each branch from the same point and returns the lowest bottom. `inset(options, draw)` (public) opens one narrowed frame, relative to the current one (`resolveInset` in `core/inset.ts`); `childFrame` builds the frame for both. A `width` given to `inset` is also its `measure`, over the measure of the document; without one, the measure of the frame around it holds, down to the room left. `layout` (`PageLayout`) keeps the page geometry; `startPage` decorates and runs the hook in the page frame, and `finalize` runs there too. Primitives read the geometry through these getters, never from `layout`. `doc.margins` is one frozen object per frame: its `top` follows a header declared later (`bottom` never changes). A page break in a frame marked `branch` (set by `parallel`, inherited by an inset opened in a column) is allowed and adds a warning that names `keepTogether()`; in an inset of the page it adds none. A waiting heading keeps the frame it was called in: it is measured and drawn there. Each column of `columns` runs in its own `withDrawingState`.

**Fill color**: In PDF the fill color is also the text color. Call `setFillColor` before every filled shape that may follow text, and never remember it from one shape to the next. `getFillColor` does not reflect it; `filledShapes` (`tests/unit/helpers.ts`) gives the color a shape is really painted with, and `tests/unit/fill-colors.test.ts` runs it over every primitive. `trackDrawingState` follows only the line cap and join, which jsPDF cannot read back: nothing else on the jsPDF instance is wrapped. `withDrawingState` writes the fill back when its scope wrote to the page since the fill was last written, or changed page; nested scopes write it once; `inPageFrame` runs in a scope too; `startPage` writes it at the top of every page. Raw jsPDF drawing after a primitive finds the state jsPDF reports (`tests/unit/raw-drawing.test.ts`).

**Marks beside text**: A checkbox, icon or badge beside text takes its Y from `centerOnCapitals(baseline, fontSize, size)`, never from an offset constant.

**Text levels**: `theme.typography.levels` restyles a level (`TextLevelStyle`). `resolveTextStyle` is the only reader, and `TEXT_STYLE_MAP` (read through `textLevelSize`) the only table of sizes: never read `typography.sizes` directly for a level. `TEXT_LEVELS` and `FONT_ROLES` in `constants.ts` list the levels and roles for the theme. Emphasis given to `resolveTextStyle` wins over the level when it is `true` or `false`; `undefined` lets the level decide, so pass `false` only to remove an emphasis. A label takes its color from the `fieldLabel` level, whatever level sets its font. Text set on a colored fill (a percentage inside a bar, a table head) takes a contrast color of its own: the level color does not apply. A block that sets a level in a color of its own passes that color as the `fallback` of `levelColor` and applies `{ ...resolveTextStyle(ctx, level), color }` after `ensureSpace`; never `setTextStyle` followed by `setTextColor`.

**Page-level calls**: Calls that declare or draw at the scale of the page run in the page frame through `inPageFrame`, whatever frame calls them: `pageHeader`, `pageFooter`, `watermark`, `background`, `tableOfContents` (waiting headings flushed in their own frame first), a logo placed from a page corner, `startPage`, `finalize`, and `cover`/`backCover` through `pageDecoration`, which validate `variant` first. It marks the page before `draw` and wraps `draw` in `withDrawingState`; `startPage` warns when `draw` opens a page, and when a page is added after a back cover; a cover called after a back cover takes a page of its own. `cover` and `background` warn when called on a page that already has content; `watermark` only registers, whatever the page holds. If `draw` throws, `snapshot` deletes the added pages and puts the references back. What `draw` already drew on the starting page stays: jsPDF cannot truncate a page.

**Spacing**: A block owns the space under it (`spaceAfter`, default `theme.spacing.block`); a heading or section may ask for space above (`spaceBefore`, from `theme.spacing.heading`). The gap between two blocks is the larger of the two, never their sum, and nothing is added at the top of a page. `endBlock` and `beginBlock` on `PDFDocument` are the only place this happens. A block may attach to the one above it: `endBlock(bottom, options?.spaceAfter, { kind, fallback })` (internal overload) takes the option as the caller gave it and records the kind only when it is absent: a primitive never tests that itself. `attachTo(kind, gap, height)` (internal), called in place of `ensureSpace`, reserves the room with the move counted, then moves the position up to `gap` under a block of that kind closed in the same frame, never down, and returns the space it left. A page break, `addSpace`, `setYPos`, `beginBlock` or any other `endBlock` forgets the kind. A badge attaches to a heading this way, and a checkbox to the checkbox above it (2 mm, its own space kept under it).

**Theme-driven**: Zero hardcoded colors. All styling flows from `theme.colors` (15 palette tokens) and `theme.typography`. Color options are named `color` and typed `ColorInput` (palette token or hex), resolved by `resolveColor` in `theme/colors.ts` (`resolveOptionalColor` for an option with a default: `null` is refused), before any empty-content exit. A heading wraps like a paragraph: `layoutHeading` serves both `headingHeight` and `drawHeading`. The `boxStyle` presets (`tint`, `border`, `surface`, `surfaceBorder`, `background`) map to palette tokens in `drawing/boxes.ts`.

**Presets**: `presetTheme(name, overrides?)` returns a ready `Theme`.

**finalize()**: Must be called before export (auto-called by `toBuffer`/`toDataUri`/`toBlob`). Renders page numbers and footers across all pages, skipping cover/back cover. Only runs once.

### Adding a New Drawing Primitive

1. Create `drawX(ctx: DrawingContext, content, options?) → number` in `src/drawing/` (validates its options first, ends with `return ctx.endBlock(bottom, options?.spaceAfter)`), with a shared `layout*` function when it also needs a `computeXHeight` (same options, `spaceAfter` excluded)
2. Add fluent wrapper in `PDFDocument` that calls `this.checkNotFinalized()`, the function, and returns `this`
3. Export it from `src/index.ts` only if it is public API (low-level primitives and their `compute*Height`); export its options type, named `<Method>Options` after the fluent method (no barrel in `src/drawing/`)
4. Give it a page in `docs/components` (listed in its `README.md`), a row in the README index, then run `pnpm docs:components`

## Conventions

- ESM only (`"type": "module"`). The package supports Node >= 20; dev tooling needs Node 22+.
- oxfmt: 120 char width, single quotes, trailing commas
- oxlint: correctness=error, suspicious=warn, console.log allowed; no warning left
- Coverage thresholds are the level reached (100 %): every new line needs a test; code no test can reach is deleted or ruled out by the types; no `v8 ignore` in `src/`
- After changing an option or its JSDoc, run `pnpm docs:components` and commit the tables, PNGs and `fingerprints.json` it rewrites: `pnpm check:docs` fails on a stale table or a preview that no longer shows what its snippet draws. After a `check:pdf:update` that touches a page shown in the README, run `pnpm docs:previews`. Component pages use relative image paths; the README keeps absolute URLs
- A change that moves a block, a wrap or a color in the examples changes `tests/baselines/*.layout.txt`: run `pnpm check:pdf:update` and read the diff
- No runtime `dependencies`: `jspdf` is the only peer dependency — keep it minimal
- Every public export and public `PDFDocument` member carries a JSDoc summary: `pnpm docs:api` fails otherwise. `.github/workflows/docs.yml` deploys it to GitHub Pages. Every exported function and `PDFDocument` method also has an `@example`, and a method a `@group`: `pnpm check:readme` fails otherwise.
- README images use absolute `raw.githubusercontent.com` URLs: `docs/` is not published to npm. Every `ts` snippet is standalone or starts with `// assumes \`doc\` from Quick start`.
- Docs: `README.md` (`pnpm check:readme` compiles and runs its snippets against the published types and checks every name it cites; a snippet that needs a browser starts with `// browser only`; a new method goes into its index table, a new type into « Exported types »), `CONTRIBUTING.md`, `CHANGELOG.md` (update on user-visible changes)

## Git Workflow

- Pre-push hook runs `pnpm lint && pnpm fmt:check` — always run `pnpm fmt` before pushing
- If a formatting or lint fix is needed after a commit that hasn't been pushed yet, amend it (`git commit --amend --no-edit`) instead of creating a separate commit
