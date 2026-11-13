---
title: Components
children:
  - heading.md
  - paragraph.md
  - rich-text.md
  - text-levels.md
  - lists.md
  - icon-list.md
  - separator.md
  - fields.md
  - checkbox.md
  - inline-question.md
  - info-box.md
  - declarations-box.md
  - address-block.md
  - signature-zone.md
  - table.md
  - donut-chart.md
  - stacked-bar.md
  - column-chart.md
  - line-chart.md
  - columns.md
  - header-columns.md
  - logo.md
  - badge.md
  - flow-control.md
  - spacing.md
  - page-formats.md
  - cover.md
  - back-cover.md
  - custom-cover.md
  - table-of-contents.md
  - page-header-footer.md
  - watermark.md
  - background.md
  - closing-note.md
  - errors.md
  - custom-components.md
---

# Components

One page per component: what it draws, an example with its rendering, every option, and the rules to know.

## Getting started

```bash
pnpm add @mlt-a/jspdf-toolkit jspdf
```

A document is a `PDFDocument`. Each component is a method: it draws a block under the previous one, breaks the page when
needed, and returns the document, so calls chain.

```ts
import { writeFileSync } from 'node:fs';
import { PDFDocument, presetTheme } from '@mlt-a/jspdf-toolkit';

const doc = new PDFDocument({ theme: presetTheme('ocean'), title: 'Invoice INV-042' });

doc
  .heading('Invoice INV-042')
  .paragraph('Thank you for your business. Payment is due within 30 days.')
  .fields([
    { label: 'Client', value: 'TechStart Inc.' },
    { label: 'Status', value: 'Paid', highlight: true },
  ])
  .table([{ item: 'Design', total: '$2,750.00' }], {
    columns: [
      { header: 'Item', key: 'item' },
      { header: 'Total', key: 'total', align: 'right' },
    ],
  });

writeFileSync('invoice.pdf', doc.toBuffer()); // in the browser: doc.toBlob() or doc.toDataUri()
```

Every method follows one shape: its content first, then an options object, optional except for `cover`, `iconList`,
`infoBox`, `table`, `pageHeader` and `pageFooter`. Lengths are millimeters, font sizes points. Colors, fonts and
spacing come from the theme: see _Theming and presets_ in the
[README](https://github.com/mlt-a/jspdf-toolkit#theming-and-presets).

## Reading the pages

Each page has the same parts:

- an example that runs as written, and its rendering;
- a table of the options, written from the JSDoc of their type: name, type, default and description;
- the rules: what throws, what warns, how the component behaves in a column and across a page break.

The examples use a `doc` created beforehand, so they show the component alone. The renderings are produced from the
examples themselves, each with a fresh copy of this document, and show the page from the top of the content:

<!-- demo document -->

```ts
import { PDFDocument } from '@mlt-a/jspdf-toolkit';
import { interFonts } from '@mlt-a/jspdf-toolkit/fonts/inter';
import { loadImageFromPath } from '@mlt-a/jspdf-toolkit/node';

const doc = new PDFDocument({ fonts: interFonts }); // default theme, Inter
doc.registerImages({
  logo: loadImageFromPath('./logo.png'),
  'logo-icon': loadImageFromPath('./logo-icon.png'),
  star: loadImageFromPath('./star.png'),
});
```

An example that imports something shows the import; an example that needs another document creates it. Inter has no
bold italic face: the examples avoid it, so they draw without a warning.

## Words used in these pages

- **Position**: where the next block starts, `doc.getYPos()`. A block draws from it and moves it under itself.
- **Content width**: `doc.contentWidth`, the page width less the left and right margins. Inside a `columns` callback,
  it is the width of the column.
- **Available width**: what a block may take where it is drawn: the content width, less the `indent` of the block. A
  width option wider than it is brought down to it, with a warning.
- **Reading column**: `doc.measure`, the default width of text blocks, so lines stay short on a wide page. It is the
  content width unless the `measure` document option narrows it; inside a column, the narrower of the two.
- **Numbered page**: every page but the [cover](cover.md) and the [back cover](back-cover.md). It gets a page number
  and the running header and footer.
- **Running header and footer**: what [pageHeader and pageFooter](page-header-footer.md) declare, drawn on every
  numbered page.
- **Page method**: a method that acts on the whole page, even when it is called inside a `columns` callback:
  `pageHeader`, `pageFooter`, `watermark`, `background`, `tableOfContents`, `cover`, `backCover`, a `logo` placed from
  a page corner, and `finalize`.

## Text

| Component                             | Draws                                                              |
| ------------------------------------- | ------------------------------------------------------------------ |
| [heading](heading.md)                 | A section title, `h1` to `h4`, numbered or ruled.                  |
| [paragraph, paragraphs](paragraph.md) | Plain text wrapped to the reading column.                          |
| [richText, richBlocks](rich-text.md)  | Text with bold, italic and links.                                  |
| [Text levels](text-levels.md)         | The 14 levels every text is set in, and how a theme restyles them. |

## Lists

| Component                            | Draws                                  |
| ------------------------------------ | -------------------------------------- |
| [bulletList, numberedList](lists.md) | Lists with sub-items and detail lines. |
| [iconList](icon-list.md)             | A list whose bullets are an image.     |
| [separator](separator.md)            | A horizontal rule.                     |

## Fields and forms

| Component                            | Draws                                                         |
| ------------------------------------ | ------------------------------------------------------------- |
| [fields, fieldRows](fields.md)       | Label / value pairs: stacked, inline or with a dotted leader. |
| [checkbox](checkbox.md)              | A box and its label: empty, checked or crossed.               |
| [inlineQuestion](inline-question.md) | A question and its answer on one line.                        |

## Boxes

| Component                              | Draws                                       |
| -------------------------------------- | ------------------------------------------- |
| [infoBox](info-box.md)                 | A titled box, or a tinted callout.          |
| [declarationsBox](declarations-box.md) | A box of statements with highlighted words. |
| [addressBlock](address-block.md)       | A boxed address.                            |
| [signatureZone](signature-zone.md)     | One or two signature boxes.                 |

## Data

| Component                      | Draws                                             |
| ------------------------------ | ------------------------------------------------- |
| [table](table.md)              | A themed table that continues across pages.       |
| [donutChart](donut-chart.md)   | Parts of a whole, as a ring or a pie.             |
| [stackedBar](stacked-bar.md)   | Parts of a whole, as one horizontal bar.          |
| [columnChart](column-chart.md) | Stacked columns against a reference line.         |
| [lineChart](line-chart.md)     | Lines, a range around them, a highlighted period. |

## Layout

| Component                          | Does                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------- |
| [columns](columns.md)              | Side-by-side columns of blocks.                                            |
| [headerColumns](header-columns.md) | Titled columns of label / value lines, for document headers.               |
| [logo](logo.md)                    | An image at the position, or placed from a page corner.                    |
| [badge](badge.md)                  | A pill-shaped label.                                                       |
| [Flow control](flow-control.md)    | `keepTogether`, `inset`, `addPage`, `addSpace`, `onNewPage`, the position. |
| [Spacing](spacing.md)              | The scale, the rhythm of the theme, and how spaces collapse.               |
| [Page formats](page-formats.md)    | The format, the orientation, the margins and the reading column.           |

## Page

| Component                                       | Draws                                             |
| ----------------------------------------------- | ------------------------------------------------- |
| [cover](cover.md)                               | A cover page: wave or image.                      |
| [backCover](back-cover.md)                      | A last page with a logo, contact and legal lines. |
| [Custom covers](custom-cover.md)                | A cover or a back cover you draw yourself.        |
| [tableOfContents](table-of-contents.md)         | A table of contents filled from the headings.     |
| [pageHeader, pageFooter](page-header-footer.md) | The running header and footer, page numbers.      |
| [watermark](watermark.md)                       | A translucent text across the page.               |
| [background](background.md)                     | A full-width image behind the content.            |
| [closingNote](closing-note.md)                  | A note anchored to the bottom of the page.        |

## Reference

| Page                                         | Covers                                                          |
| -------------------------------------------- | --------------------------------------------------------------- |
| [Validation, warnings and errors](errors.md) | What throws, what warns, the error classes.                     |
| [Custom components](custom-components.md)    | Writing a block of your own with the primitives of the library. |

## Going further

- The [README](https://github.com/mlt-a/jspdf-toolkit#readme) covers fonts, themes, document options, export and the
  entry points.
- The [API reference](https://mlt-a.github.io/jspdf-toolkit/) lists every method and type.
