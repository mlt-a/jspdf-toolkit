---
title: logo
---

# logo

An image drawn at the position, or placed from a corner of the page. Only `height` is needed: the width follows the
ratio of the image.

<!-- preview: logo -->

![A logo above a heading](../images/components/logo.png)

```ts
doc
  .logo('logo', { height: 10 })
  .heading('Quarterly review')
  .paragraph('The logo opens the page; the heading follows it.');
```

The image is a name given to `registerImage`, or image data:

```ts
import { loadImageFromPath } from '@mlt-a/jspdf-toolkit/node';

doc.registerImage('brand', loadImageFromPath('./logo.png'));
doc.logo('brand', { height: 12 });
```

## From a page corner

With `y`, or a bottom `anchor`, the logo is placed from a page corner: `x` and `y` are distances from the corner
`anchor` names, and the position does not move.

<!-- preview: logo-corner -->

![A logo in the top-right corner, beside the heading](../images/components/logo-corner.png)

```ts
doc
  .logo('logo', { height: 8, anchor: 'top-right', y: 20 })
  .heading('Invoice INV-042')
  .paragraph('The heading starts at the top of the content: the logo sits beside it, 20 mm from the top edge.');
```

## Options

`logo(image, options?)`:

<!-- options: LogoOptions -->

| Option       | Type         | Default                                                                         | Description                                                                                                                                                |
| ------------ | ------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spaceAfter` | `number`     | `SPACING.xlarge`                                                                | Space (mm) under a logo drawn at the position.                                                                                                             |
| `height`     | `number`     | 15                                                                              | Height (mm), above 0; the width follows the image ratio.                                                                                                   |
| `x`          | `number`     | the margin on that side; 20 on the back cover                                   | Distance (mm) from the left or right page edge, as `anchor` says.                                                                                          |
| `y`          | `number`     | the top margin, or the bottom margin with a bottom anchor; 20 on the back cover | Distance (mm) from the top or bottom page edge, as `anchor` says. Left out on `doc.logo()` anchored at the top, the logo is drawn at the position instead. |
| `anchor`     | `LogoAnchor` | `'top-left'`                                                                    | Page corner `x` and `y` measure from.                                                                                                                      |

<!-- /options -->

## Rules

- **Throws** an `InvalidOptionError` for a `height` that is not above 0, besides the checks every block makes (see
  [errors](errors.md#what-a-block-checks)).
- **Warns** when the image is neither a registered name nor readable image data (`Failed to draw logo: …`): nothing is
  drawn and the document is still produced. A logo that runs off the page reads
  `The logo is … mm wide, more than the … mm the page leaves from its position, and may be clipped`: the width is
  measured from `x` to the opposite page edge, the height from `y`. One drawn at the position and
  [taller than a page](flow-control.md#taller-than-a-page) adds the warning of a block that overflows its page.
- **Across pages**: a logo drawn at the position is never split. A logo placed from a corner belongs to the page it is
  called on.
- **In a column**: a logo drawn at the position sits in the column; one placed from a corner is a page method and
  measures from the corner of the page.
- Covers take their own `logo` option: see [cover](cover.md).
