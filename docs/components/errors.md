---
title: Validation, warnings and errors
---

# Validation, warnings and errors

The rule: **invalid configuration throws, a problem with an asset warns.** A wrong option is a bug in the calling code,
so it fails at once; an unreadable image should not lose a whole document, so it is skipped and reported.

## Errors

Every error extends `PdfToolkitError`:

| Class                | Thrown for                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InvalidColorError`  | A color that is neither a palette token nor `#RGB` or `#RRGGBB`. Carries `value` and, for a theme color, `token`.                                                                                                                                                                                                                         |
| `InvalidOptionError` | An invalid document option, a position, size or space that is not a finite number (`x`, `width`, `height`, `spaceAfter`, `gap`…), a width that leaves no room for text, an unknown cover layout, a content item that is not an object or lacks a required field, an option of another variant, a theme font family that is not available. |
| `AssetLoadError`     | A file that `loadImageFromPath` or `loadFontFromPath` cannot read; image data a `loadImageFrom*` loader cannot decode, or whose type it does not recognize without `mimeType`.                                                                                                                                                            |

```ts
import {
  AssetLoadError,
  InvalidOptionError,
  PDFDocument,
  PdfToolkitError,
  loadImageFromBase64,
} from '@mlt-a/jspdf-toolkit';

try {
  new PDFDocument({ margins: { left: -5 } });
} catch (error) {
  if (error instanceof InvalidOptionError) console.error('Fix the options:', error.message);
  else if (error instanceof PdfToolkitError) console.error('Toolkit error:', error.message);
  else throw error;
}

try {
  loadImageFromBase64('not an image');
} catch (error) {
  if (!(error instanceof AssetLoadError)) throw error;
}
```

## What a block checks

Every input of the wrong type throws, before anything is drawn, and from `compute*Height` too:

- Its options come first: an invalid one throws even when there is nothing to draw (empty text, no item).
- A text argument (`paragraph(5)`) that is no string.
- A content item, field, column, row or slice that is not an object, or that lacks a field its type requires (the
  `text` of a list item, the `label` and `value` of a field, the `role` of an address line, the `lines` of a back cover
  `contact`…): an `InvalidOptionError`, never a `TypeError`.
- An optional field set with the wrong type: a flag that is no boolean, a `level`, `variant` or `boxStyle` that is none
  of the choices, a text that is no string, a position, size or space that is not a finite number. Left out, it keeps
  its default; `null` is a wrong type.
- A color that is neither a palette token nor a hex color: an `InvalidColorError`.
- An option of another variant, even from JavaScript: an `icon` on a callout, a `subtitle` on a custom cover.
- A list is checked whole before its first item is drawn.

These rules hold for every component and its page does not repeat them. A page lists the rules of its own component:
bounds (a size above 0, an `itemSpacing` of 0 or more), combinations (a column with more values than series), a width
too narrow for the text.

## Warnings

`doc.warnings` lists the problems the library handled instead of throwing: an image that failed to load, a block taller
than a page, a width brought down to the available width, a cover or a background drawn over content, a
page added after the back cover, registered fonts the theme does not use, a font face that is missing, a footer that
does not fit, columns that run onto a new page.

```ts
// warns: Failed to draw logo
import { PDFDocument } from '@mlt-a/jspdf-toolkit';

const doc = new PDFDocument();
doc.logo('missing', { height: 10 }).paragraph('The document is still produced.');
for (const warning of doc.warnings) console.warn(warning);
```

- A drawing that fails reads `Failed to draw <what>: <reason>`; an image that cannot be registered reads
  `Failed to register image "<name>": <reason>`; the others are plain sentences, without a closing period. The reason
  may be the message of jsPDF itself, which may end with one.
- Messages are deduplicated.
- `debug: true` in the document options prints them as they are raised.
- Drawing after `finalize()` works, but misses the page numbers and footers, and raises a warning.
