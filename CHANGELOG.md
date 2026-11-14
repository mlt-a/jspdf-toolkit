# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-11-14

### Added

- `doc.pageReference()` names the current page as it ends up in the PDF. Once the document is finalized, its `page` is
  the physical page (covers included), the one an e-signature provider counts, and its `label` the number its footer
  prints (absent on a cover, the back cover and a page added after `finalize()`). It follows every move of the page:
  the continuation pages a table of contents inserts when it is filled, the empty table page `finalize()` removes, a
  `doc.doc.insertPage`, `doc.doc.movePage` or `doc.doc.deletePage`. Take it in `renderAnchor` to place a signature on
  the right page past a table of contents that grew, in a custom component, in a column, or in the `draw` of a custom
  cover or running header. Reading it throws a `PdfToolkitError` before `finalize()`, for a reference taken in a
  measuring pass of `keepTogether` (keep the one of the last call), and for a page deleted since. The document keeps
  nothing per reference. Type `PageReference`.
- `fontFallbacks` document option declares the faces a family lacks on purpose: `{ Brand: ['italic', 'bolditalic'] }`.
  Text asked in such a face is drawn in the same fallback as before (italic upright, bold italic bold, bold regular)
  without the warning in `doc.warnings`, in text levels, rich text and `setFont` alike. Each face is judged on its own:
  `'italic'` covers `'bolditalic'` too, `'bold'` does not, and a missing face that is not declared, or a family that
  is not listed, keeps its warning. Family names match in any case; an entry for a family nobody registered does
  nothing. A value that is no object of arrays of `'bold'`, `'italic'` or `'bolditalic'` throws an
  `InvalidOptionError`. Type `FontFallbacks`.
- `hasFontFace(ctx, role, weight, italic?)` tells whether the face `setFont` would set for a role (`'body'`,
  `'title'` or `'label'`), through `typography.weights`, is registered or built in. It never warns and does not change
  the font; `fontFallbacks` does not change its answer. An unknown role or weight, or an `italic` that is no boolean,
  throws an `InvalidOptionError`.
- `tableOfContents` takes `formatPage: (page: number) => string`, which writes the page number of an entry (default:
  the number itself, as before): `(page) => String(page).padStart(2, '0')` matches a running header that prints `02`,
  and a prefix or roman numerals work too. It receives the number of `doc.pageLabels` (covers not counted), once the
  entries have their final pages. The column of numbers, the leaders and the wrapping of the labels follow the text
  returned, the widest the entries can reach; the links keep pointing to the page. An empty string shows no number. A
  `formatPage` that is no function throws an `InvalidOptionError`, and so does a result that is no string, when the
  document is finalized. The running header's `folio` keeps its two digits at least.
- `table` takes `level`, the text level of the head, the body and the foot row (default `'small'`, the rendering of
  before): a dense table takes `'caption'` so that its header words are not cut in two. Column widths, wrapping, row
  height, repeated head and pagination follow the level; the body and the foot take its color (a pale one, such as the
  gray of `'caption'`, is darkened to 4.5:1 on the cell fill) and slant, the head and the foot stay bold, and
  `cellStyle` composes with it. The cell padding, the continuation title and `minRowHeight` keep their size. A value
  that is no text level throws an `InvalidOptionError`.
- `lineChart` draws values below zero: a line value and the `lower` and `upper` edges of a band may be negative. The Y
  scale extends under zero to round multiples of a round step (at most `yTicks` + 1 intervals, zero always on the
  grid) and the axis is drawn at zero, solid, over the lines; the X labels stay under the plot. A `highlight` is filled
  between the line and the zero line, on both sides of it when the line crosses it. `formatValue` receives the negative
  values as they are. Values at 0 or above keep the scale, the grid and the labels they had. The scale stays
  automatic: no option sets its ends.

### Changed

- `columnChart` accepts a `max` and a `reference.value` of 0: they no longer throw. A `max` of 0 is the same as none; a
  reference at 0 is drawn, dashed, over the axis, and does not change the scale. A negative or non-finite value still
  throws. Calls that passed before draw the same.

### Fixed

- `table` no longer cuts a word in two when the longest words fit: an automatic column takes at least the width of its
  longest word (head and body, at the table `level`, padding included; a URL or an email counts its longest segment
  between the separators it breaks at, no-break spaces keep a word whole) before the others share the rest. A register
  with no body row, or a column of long words next to wide ones, keeps its words whole. A table where no word was cut
  keeps its widths. When the longest words of the automatic columns do not fit together, the sharing runs on those
  words instead of the full contents, without a warning: the columns whose longest word fits an equal share keep it
  whole, the others split what is left, and cut words are fewer or the same as before. Columns with a `width` do not
  change.

## [0.2.0] - 2026-11-14

### Added

- `pageHeader` and `pageFooter` take `variant: 'custom'` with a `draw(ctx, { page, pages })` callback: `finalize()`
  runs it on every numbered page, each call from the `body` text style, its fonts and colors kept from the next page.
  A custom header takes a `reserve`, the top margin it needs (default 0), raised and warned about like the 16 mm of
  the plain header. An option of the other variant throws an `InvalidOptionError`, both ways.
- Types `PlainPageHeaderOptions`, `CustomPageHeaderOptions`, `PlainPageFooterOptions`, `CustomPageFooterOptions` and
  `PageNumbers`.
- `addWarning(message)` is public on the document: a custom component records a warning in `doc.warnings`, deduplicated
  and printed in `debug` mode like the built-in ones. A message that is not a string throws an `InvalidOptionError`.
- `table` takes `minRowHeight` (mm): every body row is at least that tall, empty or short ones included, for a sheet
  filled in by hand once printed. The text stays at the top of the row; the head and the foot row are not affected.
  A value that is not a finite number from 0 to the page height throws an `InvalidOptionError`.
- `donutChart` and `stackedBar` take `formatPercent(share)`, the share a number from 0 to 1, for another language or
  precision (`45 %` with a no-break space, `45,5 %`). It writes the percentages of the legend and inside the bar and
  sets the widths they are measured with; the default is still `45%`. A value that is not a function, or a result that
  is not a string, throws an `InvalidOptionError`.
- `fields` and `fieldRows` take `labelSuffix`, the text after the label of an `'inline'` field (default `':'`), for
  another usage (`'\u00a0:'` in French) or none (`''`). It counts in the width of the label. With the `'stacked'` or
  `'leader'` layout it throws an `InvalidOptionError`; a value that is not a string throws one too. A field that falls
  back to the stacked layout shows its label without the suffix.
- Building blocks for custom components, exported: `drawText(ctx, value, x, y, options?)` (text at a baseline,
  `charSpace` counted in the `'center'` and `'right'` alignments, which jsPDF alone does not do),
  `wrapText(ctx, value, width, charSpace?)`, `trackedTextWidth(ctx, value, charSpace?)`,
  `fitWithEllipsis(ctx, value, maxWidth, charSpace?)`, `withDrawingState(ctx, fn)`, `mixInk(ink, paper, factor)` and
  `ascentMm(sizePt)`, the ascent the built-in blocks put a baseline at. Their arguments are checked: an invalid one
  throws an `InvalidOptionError`. Type `DrawTextOptions`.

### Changed

- `tint`, `mixInk`, `rgbToHex` and `ensureReadableOn` return a string typed as a hex color, so a `ColorInput` takes the
  result without a cast. `ensureReadableOn` returns a color that already reads well as `#RRGGBB` in uppercase, no
  longer as given.
- `PageHeaderOptions` and `PageFooterOptions` are unions discriminated by `variant`: `'plain'`, the default, or
  `'custom'`. Code that leaves `variant` out works as before.

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

[Unreleased]: https://github.com/mlt-a/jspdf-toolkit/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/mlt-a/jspdf-toolkit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mlt-a/jspdf-toolkit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mlt-a/jspdf-toolkit/releases/tag/v0.1.0
