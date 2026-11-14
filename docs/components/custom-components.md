---
title: Custom components
---

# Custom components

Every block is a function that takes the document as a `DrawingContext` (the `PDFDocument` itself), then the content,
then options: `drawX(ctx, content, options)`. A component of your own follows the same contract as the built-in ones, so
it paginates and spaces like them.

<!-- preview: custom-note -->

![A custom label drawn between two built-in blocks](../images/components/custom-note.png)

```ts
import {
  measureTextLevel,
  resolveColor,
  setTextStyle,
  type ColorInput,
  type DrawingContext,
} from '@mlt-a/jspdf-toolkit';

export interface NoteOptions {
  /** Default: `'primary'`. */
  color?: ColorInput;
  spaceAfter?: number;
}

export function computeNoteHeight(ctx: DrawingContext): number {
  return measureTextLevel(ctx, 'label').lineHeight;
}

export function drawNote(ctx: DrawingContext, text: string, options: NoteOptions = {}): number {
  const { color = 'primary' } = options;
  // Reserved with the note, so it reads the space `endBlock` will leave.
  const spaceAfter = ctx.resolveSpaceAfter(options.spaceAfter);
  const { ascent } = measureTextLevel(ctx, 'label');
  ctx.ensureSpace(computeNoteHeight(ctx) + spaceAfter);

  const y = ctx.getYPos();
  setTextStyle(ctx, 'label');
  ctx.doc.setTextColor(resolveColor(ctx.theme, color));
  ctx.doc.text(text, ctx.margins.left, y + ascent);

  return ctx.endBlock(y + computeNoteHeight(ctx), spaceAfter);
}

doc.heading('Section', { level: 'h2' });
drawNote(doc, 'Custom label');
doc.paragraph('Back to the fluent API.');
```

## The contract

- **Flow primitives** draw at the current position, call `ensureSpace(height)` before reading the position (it breaks
  the page and places headings that wait for a block), and close with `endBlock(bottom, spaceAfter)`, whose result they
  return; `endBlock` defaults `spaceAfter` to `theme.spacing.block`. A block that asks for space above it calls
  `beginBlock(spaceBefore)` after `ensureSpace`. `endBlock` does not place a waiting heading: call `ensureSpace` (or
  read `getYPos`) before drawing. A block that repeats something at the top of a new page (a title, a head row) passes
  its height as `ensureSpace(height, { lead })`, so a block too tall for a page with it is reported.
- **Primitives placed by coordinates** take `{ x, y, … }` in their options, `y` being the top of what they draw, and
  return the Y under it. `drawText` is the exception: it takes `x` and `y` as arguments, `y` being a baseline, and
  returns nothing.
- **Page decorations** (watermark, running header and footer) return nothing.
- `computeXHeight(ctx, content, options)` returns the height a block will take, without `spaceAfter`, to decide a layout
  before drawing. `measureX` returns metrics (`measureTextLevel`, `measureHighlightedText`).
- **Drawing with jsPDF** after a block finds the font, colors, line width, cap and join set before it, in force on the
  page: a `doc.doc.rect(…, 'F')` without `doc.doc.setFillColor` takes the fill set before the block, even though the
  block wrote text (in PDF the text color is also the fill color) or broke the page.
- The reading column (the `measure` document option) applies to the `compute*` functions as it does to the drawing.

## Building blocks

<!-- preview: custom-blocks -->

![A box with a pill and an icon with text, drawn by coordinates](../images/components/custom-blocks.png)

```ts
import { drawBox, drawHighlightedText, drawIconWithText } from '@mlt-a/jspdf-toolkit';

const height = 24;
const spaceAfter = doc.resolveSpaceAfter();
doc.ensureSpace(height + spaceAfter);
const y = doc.getYPos();
const x = doc.margins.left;

drawBox(doc, { x, y, width: 90, height, boxStyle: 'tint' });
drawHighlightedText(doc, 'Paid', { x: x + 4, y: y + 4, strong: true });
drawIconWithText(doc, 'Verified by Acme Corp', { icon: 'star', x: x + 4, y: y + 14 });
doc.endBlock(y + height, spaceAfter);
```

A block that sets a tracked caption on a baseline of its own size centers it with `drawText` and `ascentMm`:

```ts
import { ascentMm, drawText, mixInk, resolveColor, setFont } from '@mlt-a/jspdf-toolkit';

const size = 9;
const spaceAfter = doc.resolveSpaceAfter();
doc.ensureSpace(ascentMm(size) + spaceAfter);
const y = doc.getYPos();

setFont(doc, 'label', 'bold', size);
doc.doc.setTextColor(mixInk(resolveColor(doc.theme, 'text'), resolveColor(doc.theme, 'background'), 0.3));
const middle = doc.margins.left + doc.contentWidth / 2;
drawText(doc, 'CONFIDENTIAL', middle, y + ascentMm(size), { align: 'center', charSpace: 0.6 });
doc.endBlock(y + ascentMm(size), spaceAfter);
```

Exported for custom code:

- **Text**: `setTextStyle(ctx, level)`, `setFont(ctx, role, weight, size, italic?)` (a `'body'`, `'title'` or `'label'`
  family at `'regular'` or `'bold'`, with face fallback), `hasFontFace(ctx, role, weight, italic?)` (whether that face
  exists: a component can stress a word another way when it does not), `measureTextLevel(ctx, level, options?)`
  (`{ lineHeight, ascent }`), `computeParagraphHeight`, `computeRichTextHeight`, `computeRichBlocksHeight`.
- **Text placed by hand** (each reads the current font: set it first):
  - `drawText(ctx, value, x, y, options?)` draws at a baseline, with the letter spacing (`charSpace`) counted in
    `'center'` and `'right'`, which jsPDF alone does not do.
  - `wrapText(ctx, value, width, charSpace?)` returns the lines a built-in paragraph wraps to, a word wider than the
    line broken.
  - `trackedTextWidth(ctx, value, charSpace?)` is the width `drawText` gives a line.
  - `fitWithEllipsis(ctx, value, maxWidth, charSpace?)` cuts a line to a width, with an `…`.
  - `ascentMm(sizePt)` is the distance from the top of a line to its baseline, for a size that is no text level
    (`measureTextLevel` gives it for a level).
- **Drawing state**: `withDrawingState(ctx, fn)` runs `fn` and puts back the font, size, colors, line width, cap and
  join it found, so what a custom block sets does not reach the next one. The library runs the `draw` of a custom cover, header and
  footer in one.
- **Colors**: `mixInk(ink, paper, factor)` mixes two hex colors (`0` is the ink, `1` the paper); it, `tint`, `rgbToHex`
  and `ensureReadableOn` return a `#RRGGBB` string a `ColorInput` takes as it is. `resolveColor(theme, input)` turns a
  palette token into one first.
- **Boxes**: `drawBox(ctx, { x, y, width, height, boxStyle, radius? })`, `computeInfoBoxHeight`,
  `computeDeclarationsBoxHeight`, `computeSignatureZoneHeight`.
- **Charts**: `computeDonutChartHeight`, `computeStackedBarHeight`, `computeColumnChartHeight`,
  `computeLineChartHeight`.
- **Pills, icons and images**: `drawHighlightedText(ctx, text, { x, y, … })`, `measureHighlightedText`,
  `drawIconWithText(ctx, text, { icon, x, y, … })`, `drawImage(ctx, image, { x, y, width?, height? })`. A pill wraps its
  glyphs, `padding` around them: with `y` at `padding` above the top of a text line, its text sits on that line.
- **Scales**: `SPACING`, `LINE_WIDTH`, `RADIUS`, `PT_TO_MM`, `ascentMm`; the document rhythm is `theme.spacing`, complete on every
  theme.
- **Pages**: `doc.pageReference()` names the current page as it ends up in the PDF (see
  [where a page ends up](#where-a-page-ends-up)).

## Where a page ends up

`doc.pageReference()` follows the current page until the PDF is written. Once the document is finalized, its `page` is
the physical page the content ends up on, covers included, and its `label` the number of that page in `pageLabels`
(absent on a cover). A table of contents inserts pages when `finalize()` fills it, an empty one is removed: a page number
read while drawing can be wrong by then, a reference is not. It is what a component that hands positions to another
system (an e-signature anchor, an index, a link map) keeps next to its coordinates.

```ts
import { PDFDocument, type PageReference } from '@mlt-a/jspdf-toolkit';

const doc = new PDFDocument();
doc.tableOfContents();
doc.heading('Appendix').paragraph('Figures for the year.');
const appendix: PageReference = doc.pageReference();
doc.finalize();
console.log(appendix.page, appendix.label);
```

- **Throws** a `PdfToolkitError` when read before `finalize()`, for a reference taken in a measuring pass of
  `keepTogether` (that pass is drawn again: keep the reference of the last call), and for a page deleted since.
- **Follows** every move of its page: the continuation pages of a table of contents, the empty table page `finalize()`
  removes, a `doc.doc.insertPage`, `doc.doc.movePage` or `doc.doc.deletePage`. It works in a column, an `inset`, and the `draw` of a
  custom cover or running header and footer.
- **Keeps nothing in the document**: a reference you drop is freed with it.

## Options of the building blocks

`drawBox(ctx, options)`:

<!-- options: BoxOptions -->

| Option     | Type             | Default  | Description                                |
| ---------- | ---------------- | -------- | ------------------------------------------ |
| `x`        | `number`         | required | Left edge (mm), from the left of the page. |
| `y`        | `number`         | required | Top edge (mm), from the top of the page.   |
| `width`    | `number`         | required | Width (mm).                                |
| `height`   | `number`         | required | Height (mm).                               |
| `boxStyle` | `BoxStylePreset` | required | Fill and border preset.                    |
| `radius`   | `number`         | 1        | Corner radius (mm).                        |

<!-- /options -->

`drawHighlightedText(ctx, text, options)`:

<!-- options: HighlightedTextOptions -->

| Option     | Type               | Default                | Description                                                                             |
| ---------- | ------------------ | ---------------------- | --------------------------------------------------------------------------------------- |
| `x`        | `number`           | required               | Left edge (mm) of the pill.                                                             |
| `y`        | `number`           | required               | Top of the pill: the top of its first text line is `padding` lower.                     |
| `padding`  | `number`           | 1                      | Padding (mm) between the pill edge and its text, on every side.                         |
| `maxWidth` | `number`           | the document `measure` | Width (mm) the pill wraps within, padding included.                                     |
| `strong`   | `boolean`          | `false`                | Primary fill with `onPrimary` text, instead of the light tint with `text`.              |
| `metrics`  | `HighlightMetrics` |                        | Already measured with the same `text`, `padding` and `maxWidth`: skips measuring again. |

<!-- /options -->

`drawIconWithText(ctx, text, options)`:

<!-- options: IconWithTextOptions -->

| Option     | Type         | Default                | Description                                                                            |
| ---------- | ------------ | ---------------------- | -------------------------------------------------------------------------------------- |
| `x`        | `number`     | required               | Left edge (mm), from the left of the page.                                             |
| `y`        | `number`     | required               | Top edge (mm) of the first text line, from the top of the page.                        |
| `icon`     | `string`     | required               | A name given to `doc.registerImage`, or image data.                                    |
| `iconSize` | `number`     | 3                      | Side (mm) of the square icon.                                                          |
| `gap`      | `number`     | 2                      | Space (mm) between the icon and the text.                                              |
| `level`    | `TextLevel`  | `'body'`               | Text level of the text.                                                                |
| `color`    | `ColorInput` | the level's            | Text color.                                                                            |
| `maxWidth` | `number`     | the document `measure` | Width (mm) of the icon, the gap and the text together: the text wraps in what is left. |

<!-- /options -->

`drawImage(ctx, image, options)`:

<!-- options: ImageOptions -->

| Option   | Type     | Default  | Description                                                                                           |
| -------- | -------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `x`      | `number` | required | Left edge (mm), from the left of the page.                                                            |
| `y`      | `number` | required | Top edge (mm), from the top of the page.                                                              |
| `width`  | `number` |          | Width (mm). Give `width`, `height` or both; one left out follows from the other and the image ratio.  |
| `height` | `number` |          | Height (mm). Give `width`, `height` or both; one left out follows from the other and the image ratio. |

<!-- /options -->

`drawText(ctx, value, x, y, options?)`: `value` is a string or an array of lines, `x` and `y` the anchor and the baseline
of the first line (mm). It returns nothing and moves no position.

<!-- options: DrawTextOptions -->

| Option            | Type                                            | Default  | Description                                                                                                                                     |
| ----------------- | ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `align`           | `TextAlign`                                     | `'left'` | Which side of `x` the text sits on: `'left'` (it starts at `x`), `'center'` or `'right'`.                                                       |
| `charSpace`       | `number`                                        |          | Space (mm) added between letters: a finite number, negative to tighten. Unlike jsPDF alone, it counts in the centering and the right alignment. |
| `baseline`        | `'alphabetic' \| 'middle' \| 'top' \| 'bottom'` |          | What `y` is the height of: the `'alphabetic'` baseline (the default), the `'top'`, `'middle'` or `'bottom'` of the text.                        |
| `maxWidth`        | `number`                                        |          | Width (mm) the text is wrapped to, `charSpace` counted: above 0. Without it, a line is as long as its text.                                     |
| `lineHeightScale` | `number`                                        | 1        | Multiplies the theme `lineHeightFactor` between lines of a multi-line text: a number above 0.                                                   |

<!-- /options -->

`measureTextLevel(ctx, level, options?)`:

<!-- options: MeasureTextLevelOptions -->

| Option            | Type     | Default | Description                                          |
| ----------------- | -------- | ------- | ---------------------------------------------------- |
| `lineHeightScale` | `number` | 1       | Multiplies the line height: a finite number above 0. |

<!-- /options -->

## Rules

- **Throws** like the blocks, from `compute*Height` too (see [errors](errors.md#what-a-block-checks)). `drawImage`
  throws when it has neither a `width` nor a `height`.
- **Warns** when an image or an icon is neither a registered name nor readable data.
- **Report your own problems** with `ctx.addWarning(message)`, as the built-in blocks do: an asset that cannot be read, a
  text that does not fit. The message joins `doc.warnings` once, however many times it is raised, and is printed in
  `debug` mode. Follow the library's wording: `Failed to draw <what>: <reason>`, or a plain sentence with no final
  period. Throw, as the built-in blocks do, for an invalid option.
- **In a column**: `ctx` is the document laid out in the column, so `ctx.margins`, `ctx.contentWidth` and `ctx.measure`
  are the column's.
