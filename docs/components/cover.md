---
title: cover
---

# cover

A cover page: a built-in layout, or your own drawing. `cover` draws on the current page, then starts a new one for the
content. The cover has no page number and no running header or footer.

<!-- preview: cover page=1 -->

<img src="../images/components/cover.png" width="420" alt="A wave cover with a title, a subtitle and a logo">

```ts
doc.cover('Annual report', {
  variant: 'wave',
  subtitle: 'Financial year 2026',
  logo: { image: 'logo', height: 12 },
});
doc.heading('Highlights').paragraph('The content starts on the page after the cover.');
```

`variant` picks the layout:

| `variant`  | Layout                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| `'wave'`   | A colored wave under the title, drawn from the theme. An `image` fills the wave zone.   |
| `'image'`  | An image as wide as the page; the title is placed by a layout of the theme.             |
| `'custom'` | You draw the page, with the blocks or with jsPDF: see [custom covers](custom-cover.md). |

The wave cover starts from the top of the page it is drawn on.

## An image cover

The image spans the page width, keeps its ratio and stands on the bottom edge: an image in the proportions of the page
covers it whole. Where the title goes, and in which color, depends on the image, so it is described once in the theme,
in `theme.assets.covers`, and named by `layout`.

<!-- preview: cover-image page=1 -->

<img src="../images/components/cover-image.png" width="420" alt="An image cover: a dark picture with a white title">

```ts
import { PDFDocument, createTheme } from '@mlt-a/jspdf-toolkit';
import { interFonts } from '@mlt-a/jspdf-toolkit/fonts/inter';
import { loadImageFromPath } from '@mlt-a/jspdf-toolkit/node';

const theme = createTheme({
  assets: {
    covers: {
      dark: { color: '#FFFFFF', titleX: 20, titleY: 100, logo: { height: 14, x: 20, y: 20 } },
    },
  },
});
const doc = new PDFDocument({ theme, fonts: interFonts });

doc.registerImage('cover', loadImageFromPath('./cover.png'));
doc.registerImage('mark', loadImageFromPath('./logo-icon.png'));
doc.cover('Annual report', {
  variant: 'image',
  layout: 'dark',
  subtitle: 'Financial year 2026',
  image: 'cover',
  logo: { image: 'mark' },
});
doc.heading('Highlights').paragraph('The content starts on the page after the cover.');
```

## Options

`cover(title, options)`. A cover takes the options of its own variant only.

`variant: 'wave'`:

<!-- options: WaveCoverOptions -->

| Option          | Type            | Default       | Description                                                                                      |
| --------------- | --------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `variant`       | `'wave'`        | required      | Logo and title at the top, and a wave-shaped zone filled with an image or a color at the bottom. |
| `titleColor`    | `ColorInput`    | `'text'`      | Color of the title.                                                                              |
| `subtitleColor` | `ColorInput`    | `'secondary'` | Color of the subtitle.                                                                           |
| `accentBar`     | `boolean`       | `true`        | Bar above the title, in the primary color.                                                       |
| `waveColor`     | `ColorInput`    | `'tint'`      | Fill of the wave zone without an `image`, or when it cannot be drawn.                            |
| `subtitle`      | `string`        |               | Line(s) under the title.                                                                         |
| `image`         | `string`        |               | Page image: a name given to `registerImage`, or image data. The variant sets where it goes.      |
| `logo`          | `LogoPlacement` |               | Logo position and size. The variant sets the default.                                            |

<!-- /options -->

`variant: 'image'`:

<!-- options: ImageCoverOptions -->

| Option     | Type            | Default  | Description                                                                                                                |
| ---------- | --------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `variant`  | `'image'`       | required | An image as wide as the page, anchored to the bottom of the cover, with the title over it placed by a layout of the theme. |
| `layout`   | `string`        | required | Key of the layout in `theme.assets.covers`: where the title, subtitle and logo go.                                         |
| `subtitle` | `string`        |          | Line(s) under the title.                                                                                                   |
| `image`    | `string`        |          | Page image: a name given to `registerImage`, or image data. The variant sets where it goes.                                |
| `logo`     | `LogoPlacement` |          | Logo position and size. The variant sets the default.                                                                      |

<!-- /options -->

`variant: 'custom'`: see [custom covers](custom-cover.md).

A `logo` is placed from a page corner, `x` and `y` measuring from `anchor`:

<!-- options: LogoPlacement -->

| Option   | Type         | Default                                                                         | Description                                                                                                                                                |
| -------- | ------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image`  | `string`     | required                                                                        | A name given to `registerImage`, or image data.                                                                                                            |
| `height` | `number`     | 15                                                                              | Height (mm), above 0; the width follows the image ratio.                                                                                                   |
| `x`      | `number`     | the margin on that side; 20 on the back cover                                   | Distance (mm) from the left or right page edge, as `anchor` says.                                                                                          |
| `y`      | `number`     | the top margin, or the bottom margin with a bottom anchor; 20 on the back cover | Distance (mm) from the top or bottom page edge, as `anchor` says. Left out on `doc.logo()` anchored at the top, the logo is drawn at the position instead. |
| `anchor` | `LogoAnchor` | `'top-left'`                                                                    | Page corner `x` and `y` measure from.                                                                                                                      |

<!-- /options -->

and a layout of `theme.assets.covers`:

<!-- options: CoverConfig -->

| Option          | Type           | Default               | Description                                                                                            |
| --------------- | -------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `logo`          | `LogoPosition` |                       | Position of the cover `logo`, which the `logo` option of the cover overrides field by field.           |
| `color`         | `ColorInput`   | required              | Title color, and the subtitle's unless `subtitleColor` is set.                                         |
| `titleX`        | `number`       | required              | X (mm) the title and subtitle are aligned to: their left edge, center or right edge, per `titleAlign`. |
| `titleY`        | `number`       | required              | Baseline Y (mm) of the first title line.                                                               |
| `titleMaxWidth` | `number`       | 60% of the page width | Width (mm) the title and subtitle wrap within.                                                         |
| `titleSize`     | `number`       | 32                    | Title font size (pt).                                                                                  |
| `titleAlign`    | `TextAlign`    | `'left'`              | Alignment of the title and subtitle on `titleX`.                                                       |
| `titleGap`      | `number`       | 8                     | Space (mm) between the title and the subtitle.                                                         |
| `subtitleSize`  | `number`       | 60% of the title size | Subtitle font size (pt).                                                                               |
| `subtitleColor` | `ColorInput`   | `color`               | Subtitle color.                                                                                        |

<!-- /options -->

## Rules

- **Throws** an `InvalidOptionError` for an option of another variant (`layout` on a wave cover, `subtitle` on a custom
  one) and an `image` layout that `theme.assets.covers` does not hold, besides the checks every block makes (see
  [errors](errors.md#what-a-block-checks)). Everything is checked before anything is drawn.
- **Warns** when an `image` or a `logo` is neither a registered name nor readable image data (the cover is drawn without
  it), and when the page already has content: the cover is drawn over it, so call `cover` before the content of its
  page, or after `addPage()`.
- **Page numbers**: the cover takes none and is not counted. The pages are numbered in order, the cover and the
  [back cover](back-cover.md) skipped: after a cover on the first page, the second page is page 1.
- **In a column**: `cover` is a page method: it draws on the whole page.
