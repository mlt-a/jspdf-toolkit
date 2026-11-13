# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-13

First public release: themed PDF generation on top of jsPDF, through a fluent, typed API.

### Added

#### Document and pagination

- `PDFDocument` draws blocks top to bottom and adds pages when the content overflows. Its fluent methods return the
  document, so calls chain.
- Page formats `'A3'`, `'A4'`, `'A5'`, `'letter'`, `'legal'` or any `[width, height]` in mm, in either orientation;
  margins, a first-page top for a letterhead, and a `measure` for the reading width.
- Headings wait for the block that follows them, so a heading never ends a page alone.
- `keepTogether` moves a group of blocks to the next page when it fits on a page of its own.
- `inset` lays out a group of blocks in a narrower frame, measured from the edges of the frame it is called in (the
  page margins, a column or another inset); a heading called before it spans the frame around it and stays with its
  first block.
- One vertical rhythm: `theme.spacing` sets the space under blocks and around headings, `SPACING` holds the scale, and
  the space between two blocks is the larger of the two they ask for, never their sum. A heading leaves 8, 4 and 2 mm
  under `h1`, `h2` and `h3`. A badge called right after a heading attaches to it: 2 mm under the heading, and the
  space the heading would have left under the badge; a heading given a `spaceAfter` keeps it, and nothing attaches.
  Consecutive `checkbox` calls sit 2 mm apart, and the last one leaves `theme.spacing.block` like any block.
- `getYPos`, `setYPos`, `ensureSpace`, `beginBlock`, `endBlock` and `resolveSpaceAfter` let custom blocks take their
  place among the others, spaces and page breaks included.
- PDF metadata (`title`, `author`, `subject`, `keywords`, `creator`) and export with `toBuffer`, `toDataUri` and
  `toBlob`.

#### Themes

- `createTheme` derives a 15-token palette from one primary color, with readable text colors (WCAG contrast): `onPrimary` is white as soon as it reaches 3:1 on the primary color.
- Ten presets: `presetTheme`, `PRESET_THEME_NAMES`.
- Every `color` option takes a palette token or a hex color (`ColorInput`).
- `typography.levels` restyles any of the 14 text levels (color, weight, slant, font family); every block set in that
  level follows.
- Color helpers: `generatePalette`, `resolveColor`, `contrastRatio`, `ensureReadableOn`, `tint`, `hexToRgb`,
  `rgbToHex`.

#### Text and blocks

- Headings `h1` to `h4`, with an optional section number and rule. A long heading wraps to the reading column, its
  number on the first line and its rule under the last, 1 mm under the descenders of that line.
- Paragraphs, plain or justified, and rich text with `**bold**` and `*italic*` markup; `richBlocks` builds rich text
  from data, links included.
- Bullet, numbered and icon lists, with sub-items and detail lines.
- Fields in three layouts (stacked, inline, dotted leader), checkboxes and question / answer lines.
- Info boxes (surface or callout), boxes of declarations, address blocks, signature zones with anchors for
  e-signature tools; the label and sublabel of a signature box wrap to it.
- Text keeps to the page: a `maxWidth` wider than the available width (paragraphs, rich text, lists) is brought down
  to it with a warning, as table columns and charts are; a logo that runs off the page, measured from its position, is
  reported.
- Separators, logos and badges; a badge label wider than the reading column wraps to it.

#### Columns

- `columns` lays blocks out side by side: each column is the document narrowed to its width, so any block, a table or
  nested columns included, wraps to it.
- `headerColumns` draws titled columns of label / value lines for invoice and letter headers.

#### Tables

- `table` draws a themed table: columns sized from their content or fixed, head row repeated on the pages it continues
  on, rows never split, foot row kept with the last row, zebra rows.
- `cellStyle` styles any cell: color, fill, weight, slant, alignment.

#### Charts

- `donutChart`, `stackedBar`, `columnChart` and `lineChart`, drawn with PDF paths in the theme colors, with no extra
  dependency.
- Charts fit the available width, a column of `columns` included, and break the page whole.
- `stackedBar` writes its percentages in bold, in the lighter of the page and text colors over a slice that reaches a 3:1 contrast with it.
- A column chart takes a reference line, its label in a room of its own right of the plot; a line chart takes a band
  and a highlighted period, in the secondary and the primary color unless given another.

#### Covers and page decorations

- Covers in three variants (wave, image, custom drawing) and a back cover, without page number, header or footer. The
  back cover closes the document: its contact lines and legal text wrap to the page, and content added after it starts
  a new page, with a warning.
- A table of contents filled with the headings and their page numbers, with links, continued on new pages when it
  overflows.
- Running header and footer with page numbers, a closing note at the bottom of a page, watermarks, background images
  and an `onNewPage` callback. A background called on a page that already has content adds a warning. Watermarks are
  drawn by `finalize()`, over everything on their page, whenever they are called.

#### Images and fonts

- `registerImage` names an image once for every image option; a data URI works too.
- Image loaders for base64, bytes and, under Node, files: PNG, JPEG, GIF, WebP and BMP, the type read from the data.
- Helvetica by default; Inter as an opt-in entry point; any TTF through the font loaders. Theme fonts are checked
  against the registered faces.

#### Errors and warnings

- Invalid configuration throws a typed error (`InvalidOptionError`, `InvalidColorError`, both `PdfToolkitError`)
  before anything is drawn, the document options and the arguments of the low-level helpers included; a color is
  checked even when there is nothing to draw. A problem with an asset becomes an entry of `doc.warnings` and the
  document carries on.
  The rules are in the [README](README.md#finalize-export-warnings-and-errors).

#### Low-level primitives

- Every block is also a function taking the document as a `DrawingContext`, with a `compute*Height` companion that
  measures it first: custom components follow the same contract.
- `setTextStyle`, `setFont(ctx, role, weight, size, italic?)` and `measureTextLevel` set and measure text for custom
  drawing.

#### Documentation

- A page per component, published with the API reference: a runnable example and its rendering, every option in a table
  written from the JSDoc, and the rules to know (what throws, what warns, behavior in a column and across a page break).
  Every example is compiled and run against the published types.
- The tables of the options, of the text levels and of the spacing are generated from the code, and each rendering is
  checked against the example it shows, so the pages follow the library.
- Four more runnable examples: a registration form, a service agreement, a business letter and a landscape
  certificate. Each has a text baseline and a layout baseline.

#### Package

- `@mlt-a/jspdf-toolkit`: the document, themes, primitives and loaders, browser-safe.
- `@mlt-a/jspdf-toolkit/node`: the file loaders, `loadImageFromPath` and `loadFontFromPath`.
- `@mlt-a/jspdf-toolkit/fonts/inter`: `interFonts`, Inter regular, bold and italic.
- ESM only, typed, with `jspdf` as the only peer dependency. Runs on Node 20 and later, and in the browser.

[0.1.0]: https://github.com/mlt-a/jspdf-toolkit/releases/tag/v0.1.0
