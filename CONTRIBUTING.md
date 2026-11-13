# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

- [pnpm](https://pnpm.io) (the version is pinned in `packageManager`) and Node 22 or later for the dev tooling.
  The published package itself supports Node >= 20.
- [poppler](https://poppler.freedesktop.org) provides `pdftotext` (the PDF baseline check) and `pdftoppm` (the README
  and component page previews): `brew install poppler` or `apt-get install poppler-utils`.

```bash
pnpm install   # also generates the Inter modules and installs the pre-push hook
```

The dev scripts `check:browser` and `prepare` use POSIX shell syntax. They do not run on Windows outside WSL.

## Before a pull request

```bash
pnpm fmt          # oxfmt --write
pnpm check:all    # type-check, lint, format check, build, README and snippets, component pages, browser bundle, unit tests, PDF baselines, API docs
```

`pnpm check:all` is what CI runs, on Node 22 and 24; CI also runs `pnpm test:coverage` on Node 24. The pre-push hook
runs `pnpm lint && pnpm fmt:check`.

Useful on their own:

| Command                                   | Does                                                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm type-check`                         | `tsc --noEmit` on `src` and on `tests`                                                                                                                                  |
| `pnpm test`                               | vitest unit tests                                                                                                                                                       |
| `pnpm test:coverage`                      | the same, with coverage: below the thresholds, it fails                                                                                                                 |
| `pnpm lint`, `pnpm lint:fix`              | oxlint                                                                                                                                                                  |
| `pnpm fmt`, `pnpm fmt:check`              | oxfmt, write or check                                                                                                                                                   |
| `pnpm build`                              | generates the Inter modules, then bundles with tsup to `dist/`                                                                                                          |
| `pnpm check:browser`                      | bundles `dist/index.js` for the browser (after `build`)                                                                                                                 |
| `pnpm check:pdf`, `pnpm check:pdf:update` | compares or refreshes the PDF text baselines and the layout baselines, of every example or of the ones named (`pnpm check:pdf:update invoice`)                          |
| `pnpm check:layout:update`                | refreshes the layout baselines only                                                                                                                                     |
| `pnpm check:readme`                       | compiles every `ts` snippet of the README, of the component pages and every JSDoc `@example` against `dist/` (after `build`), runs them, checks the names the docs cite |
| `pnpm check:docs`                         | checks the component pages: the index and the titles, the tables, the previews against their snippets and the README previews against the layout baselines (no poppler) |
| `pnpm example:all`                        | writes the example PDFs to `output/` (`example:invoice`, `:report`, …)                                                                                                  |
| `pnpm docs:api`                           | builds the TypeDoc API reference to `docs/api` (git-ignored)                                                                                                            |
| `pnpm docs:previews`                      | renders the README preview images to `docs/images`, with their fingerprints                                                                                             |
| `pnpm docs:components`                    | builds, writes the tables of `docs/components` and renders its previews to `docs/images/components` (`pnpm docs:components table cover`: those pages' previews only)    |
| `pnpm assets:images`                      | redraws the example logos and backgrounds in `assets/` (needs `pdftocairo`; `node scripts/render-assets.mjs cover`: one image)                                          |

## Tests

- **Unit tests** live in `tests/unit` and run with vitest (`pnpm test`). Add one for each behavior you add or fix.
- **Coverage** is measured on `src` (the examples and the generated fonts aside) by `pnpm test:coverage`. The
  thresholds in `vitest.config.ts` are the level reached, 100 %: a line, a branch or a function no test reaches fails
  the check. V8 counts branches differently from one Node version to the next, so one version is the reference: CI runs
  `pnpm test:coverage` on Node 24 only, and `check:all` runs the tests without coverage. `coverage/` holds the HTML
  report. Write the test that reaches the code; code no test can reach is dead code, to delete, or a case the types
  should rule out. `src` has no `v8 ignore`.
- **PDF baselines** live in `tests/baselines`. `pnpm check:pdf` renders the examples in `src/examples`, extracts the
  text with `pdftotext -raw` (the order the PDF draws it in) and compares it to the stored `.txt` files page by page,
  whitespace aside, so the result does not depend on the poppler version. The files hold what the check reads: one
  line per page, whitespace removed. A diff means the content, its order or the pagination moved.
- **Layout baselines** are the `<example>.layout.txt` files next to them. `tests/unit/examples-layout.test.ts` builds
  each example and lists the document properties and bookmarks, then, page by page and in painting order, one line per
  mark: every string (position, size, color, font, letter and word spacing, angle, text), every filled or stroked shape
  (box, color, line width, dash), every clip, every image (box, resource, fingerprint of its data), the opacity of each,
  then the links of the page, in millimeters to 0.01. It reads the content stream as a viewer does, not the calls, and
  needs no poppler; what it cannot read, or a mark off its page, fails the test. A block that moved, a line that wrapped
  elsewhere or a color that changed is a diff the text baseline does not see. `pnpm check:pdf:update` rewrites them with
  the text baselines; `pnpm check:layout:update` rewrites them alone.

When a baseline check fails:

1. Run `node scripts/pdf-baselines.mjs <example>` to see the first differing page of the text baseline; the layout
   test prints its diff, one line per mark.
2. Open the PDF in `output/` and decide whether the change is intended.
3. If it is, run `pnpm check:pdf:update`, then read `git diff tests/baselines`, page by page.
   A diff you cannot explain is a bug, not a baseline to refresh.
4. Commit the baselines in the same commit as the change that moved them.

The fingerprint of an image is taken on the data jsPDF re-encodes, so a `jspdf` or `fflate` update can change it with
no change of layout: refresh with `pnpm check:pdf:update` and read the diff, which must show only the fingerprints.

## Docs

- The README is also the index of the API reference (`typedoc.json`). Keep each `ts` snippet either standalone (imports
  included) or marked ``// assumes `doc` from Quick start``: its `doc` is then the Quick start document, which already
  has content. A new method goes into the "Every method at a glance" table, a new type into "Exported types".
- `pnpm check:readme` reads every code block of the README, of the component pages and of the JSDoc comments; a block
  is `ts` or `bash`, any other language fails. It runs after `pnpm build`; each error gives the file and line, the name
  in cause and what to do. It fails when:
  - a `ts` block does not compile against the declarations of `dist/`, through the `exports` of `package.json`: an
    example cannot use a member the published types leave out;
  - a `ts` block throws when run under Node, or leaves a warning in `doc.warnings` once its documents are exported. A
    block that needs the browser (`document`, `window`, `fetch`) starts with `// browser only`: it is compiled, not
    run, and the script lists it. A block that shows a warning on purpose starts with `// warns: <part of the
warning>`: it must leave that warning and no other, and the error lists the ones it left;
  - an export or a public `PDFDocument` member is not written in code in the README, or the README or the changelog
    cites in code a name the published types lack (`doc.x` must be a public member). `OUTSIDE` in the script lists
    the few names that are no API, each one still needed;
  - an exported function or a public `PDFDocument` method lacks an `@example`, a method its `@group`, or a `@group`
    is not one of `groupOrder` in `typedoc.json`.
- Every public export needs a JSDoc comment: `pnpm docs:api` fails on a missing one or a broken `{@link}`. A public
  `PDFDocument` method and every exported function also carry an `@example`; a method carries a `@group` too. An
  option says its default.
- An `@example` is read as written after the Quick start. Only `doc` (the Quick start document) and the sample values
  are given: `base64Png`, `base64Ttf`, `base64BoldTtf`, `phoneDataUri`, `logoDataUri`, `starDataUri`,
  `letterheadDataUri` and `longText`, read from `assets/`. It imports every other name itself. It runs in a directory
  that holds `logo.png`, `star.png`, `cover.png`, `letterhead.png`, `Brand-Regular.ttf` and `Brand-Bold.ttf`, for the
  `loadImageFromPath` and `loadFontFromPath` calls. An example that needs an empty document builds its own.
- **Component pages** live in `docs/components`: one page per component or family, `README.md` being the index, and
  typedoc publishes them with the API reference (`projectDocuments` in `typedoc.json`). To add one, copy a page of the
  same kind, list it in the `children` of the front matter of `README.md` and in one of its tables, then run
  `pnpm docs:components` and commit the page with the table and the images it wrote. A page has an intro, an example
  that runs, its rendering, the options and the rules (what throws, what warns, in a column, across a page break). What
  can drift is written by the script, never by hand:
  - `<!-- options: TypeName -->` and `<!-- /options -->` around nothing: the script writes the table of that exported
    type from its JSDoc (name, type, the `Default: <value>.` sentence, description). Every property needs a
    description, and a default written in that form. A union is listed as one table of the properties of its members:
    a property only some members take says which (`Only with variant: 'callout'`), and the members that share one must
    describe it in the same words; name each variant's own type instead when they differ. Change the JSDoc, not the
    table.
  - `<!-- table: name -->` and `<!-- /table -->`: a table the script computes from the built package, such as the text
    levels or the spacing scale (`GENERATED_TABLES` in `scripts/docs-components.mjs`). Change the code, not the table.
  - `<!-- preview: name -->` above a `ts` snippet, then the image `![alt](../images/components/name.png)`: the script
    runs the snippet and renders it to `docs/images/components/name.png`, cropped to the content. `page=N` renders
    that whole page instead; show it with `<img src="../images/components/name.png" width="420" alt="…">`, as a page is
    too tall at full width. An image with no preview, a preview with no image, a page missing from the index and a stale
    table fail `pnpm check:docs`; an image of the folder that no page uses is orphaned and fails too, and so does an
    image named like one of `docs/images`, since typedoc copies both folders into one.
  - Each preview has a fingerprint in `docs/images/components/fingerprints.json`: its snippet, its page, the render
    settings, the demo document, the assets, and what the run drew (the band shown, the page count, the content of the
    page). `pnpm check:docs` runs the snippets again and fails, naming the command to run, when an image no longer
    shows what its snippet draws.
  - A snippet that uses `doc` without declaring it is given a fresh demo document, built by the snippet of
    `docs/components/README.md` marked `<!-- demo document -->`: the page shows the code that runs. One that builds its
    own document must build exactly one when it announces a preview. The files of `FILES` in `scripts/_shared.mjs`
    (`logo.png`, `star.png`, `cover.png`, `letterhead.png`…) exist where a snippet runs.
  - The front matter `title` of a page is its first heading and the label of its link in the index: the method names
    the page covers (`paragraph, paragraphs`), or a title in sentence case (`Flow control`).
  - Images are relative (`../images/components/…`): they resolve on GitHub, and typedoc copies them into the site.
    Nothing of `docs/` is in the npm package, whose page shows the README, which keeps its absolute URLs.
  - The bytes of a PNG depend on the poppler version: render the pages you changed (`pnpm docs:components table`), not
    every image, and read each new image before committing it with `fingerprints.json`.
  - `pnpm check:readme` compiles and runs the snippets and checks the names the pages cite in code; the words of an
    option table come from the JSDoc and are not checked there.
- The previews in `docs/images` come from `pnpm docs:previews`. `README_PREVIEWS` in `scripts/_shared.mjs` names the
  page of each preview and the title of the section it shows; the script checks the title is on that page, and when it
  is not, fails and says which page holds it now. Its fingerprint, in `docs/images/fingerprints.json`, is the page as
  the layout baseline of its example describes it: after `pnpm check:pdf:update` moves a previewed page,
  `pnpm check:docs` fails until the image is rendered again. Update the list, rerun the command and commit the new PNGs
  with their fingerprints.
- User-visible changes go into `CHANGELOG.md`.

## API design rules

Keep the public API consistent; a new method or option follows these rules.

- **Content first**: a fluent method is `method(content, options?)` and returns `this`. A method without content takes
  `method(options?)`. Never return `PDFDocument`.
- **Names**: the options type of `heading` is `HeadingOptions`, of `table` `TableOptions`: `<Method>Options`, no `Draw`
  prefix. List entries are `<Thing>Item`. Object shapes are `interface`s, unions are `type`s with `variant` inside each
  member.
- **Shared options**: every block takes `spaceAfter` (mm, default `theme.spacing.block`) and, when it draws text,
  `level: TextLevel`. Use `maxWidth` (default `ctx.measure`), `gap` between columns, `itemSpacing` between items,
  `intro` for lead text, `icon` for icons, `variant` for a component variant and `boxStyle` for a `BoxStylePreset`.
- **Colors**: the option is `color`, typed `ColorInput` (palette token or hex) and resolved with `resolveColor`. No
  `textColor`, no `fooColor`. Exception: an object carrying two colors names the main one `color` and the second
  `<part>Color` (e.g. `CoverConfig.subtitleColor`), all typed `ColorInput`.
- **Images**: any image option takes a name given to `registerImage` or a data URI. A logo is `{ image, height?, x?, y?,
anchor? }`.
- **Primitives**: a flow primitive is `drawX(ctx, content, options)`; one placed by coordinates takes `{ x, y, … }` in
  its options. `computeXHeight(ctx, content, options)` takes the same options and excludes `spaceAfter`;
  `measureX` returns metrics. Reuse the options type of the fluent method.
- **Throw or warn**: invalid configuration throws a `PdfToolkitError` subclass (`InvalidOptionError`,
  `InvalidColorError`). A problem with an asset at drawing time (an unreadable image, a missing font face) calls
  `ctx.addWarning` and the document carries on.
- **State**: read through getters (`warnings`, `margins`, `coverPage`…). `getYPos()` stays a method because it places
  the waiting headings.
- **Breaking changes** are acceptable before 1.0, but list them in `CHANGELOG.md`.

## Conventions

- ESM only. No runtime `dependencies`: `jspdf` is the only peer dependency.
- Formatting is oxfmt (120 columns, single quotes, trailing commas); linting is oxlint. Run `pnpm fmt` and `pnpm lint`.
- No hardcoded colors: everything comes from `theme.colors` and `theme.typography`. Layout numbers live in
  `src/core/constants.ts`.
- Comments say why, not what. No dates or incident stories in code; they belong in the commit message.
- Commits use a short conventional subject (`feat(table): ...`, `fix(fonts): ...`, `docs: ...`), with a body of a few
  lines at most.
- The public API is `src/index.ts` and the `PDFDocument` methods. Name and export the options type of anything public.

## Adding a drawing primitive

1. Create `drawX(ctx: DrawingContext, content, options?)` in `src/drawing/`. It closes with
   `ctx.endBlock(bottom, options?.spaceAfter)` and returns its result, following the contract in `src/core/context.ts`:
   `endBlock` applies the default, and `ctx.resolveSpaceAfter(options?.spaceAfter)` gives it to a block that reserves
   it with `ensureSpace` first. When the block also needs a `computeXHeight`, share a `layout*` function between them;
   both take the same options, `spaceAfter` excluded.
2. Add a fluent wrapper in `PDFDocument`. It calls `this.checkNotFinalized()`, then the function, and returns `this`.
3. Export the function from `src/index.ts` only if it is public API, with its options type named `<Method>Options`
   after the fluent method. Every public export carries a JSDoc summary.

Add a unit test and, when the block changes how a page looks, a section in an example so the baselines cover it.
