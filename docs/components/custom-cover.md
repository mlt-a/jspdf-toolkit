---
title: Custom covers
---

# Custom covers

`cover` and `backCover` take `variant: 'custom'` with a `draw` function: you draw the page. The page is still handled as
a cover: it has no page number and no running header or footer. After a custom cover, the content starts on the next
page; a custom back cover closes the document, like the plain one.

<!-- preview: cover-custom page=1 -->

<img src="../images/components/cover-custom.png" width="420" alt="A custom cover: a colored band with the title">

```ts
import { setFont } from '@mlt-a/jspdf-toolkit';

doc.cover('Annual report', {
  variant: 'custom',
  draw: (ctx, title) => {
    ctx.doc.setFillColor(ctx.theme.colors.primary);
    ctx.doc.rect(0, 0, ctx.pageWidth, 110, 'F');
    setFont(ctx, 'title', 'bold', 36);
    ctx.doc.setTextColor(ctx.theme.colors.onPrimary);
    ctx.doc.text(title, ctx.margins.left, 90);
    ctx.setYPos(130).paragraph('Blocks work on a custom cover too.', { level: 'smallMuted' });
  },
});
```

`draw(ctx, title)` receives the document and the title given to `cover`; the `draw` of a back cover receives `ctx` only.

## A back cover of your own

<!-- preview: back-cover-custom page=2 -->

<img src="../images/components/back-cover-custom.png" width="420" alt="A custom back cover: a page in the primary color with a closing line">

```ts
import { setFont } from '@mlt-a/jspdf-toolkit';

doc.paragraph('The content of the document.');
doc.backCover({
  variant: 'custom',
  draw: (ctx) => {
    ctx.doc.setFillColor(ctx.theme.colors.primary);
    ctx.doc.rect(0, 0, ctx.pageWidth, ctx.pageHeight, 'F');
    setFont(ctx, 'title', 'bold', 20);
    ctx.doc.setTextColor(ctx.theme.colors.onPrimary);
    ctx.doc.text('Thank you', ctx.pageWidth / 2, ctx.pageHeight / 2, { align: 'center' });
  },
});
```

## Options

<!-- options: CustomCoverOptions -->

| Option    | Type                                           | Default  | Description                                                                    |
| --------- | ---------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `variant` | `'custom'`                                     | required | A cover drawn by `draw`.                                                       |
| `draw`    | `(ctx: DrawingContext, title: string) => void` | required | Draws the cover page: `ctx` is the document, `title` the one given to `cover`. |

<!-- /options -->

and for the back cover:

<!-- options: CustomBackCoverOptions -->

| Option    | Type                            | Default  | Description                                       |
| --------- | ------------------------------- | -------- | ------------------------------------------------- |
| `variant` | `'custom'`                      | required | A back cover drawn by `draw`.                     |
| `draw`    | `(ctx: DrawingContext) => void` | required | Draws the back cover page: `ctx` is the document. |

<!-- /options -->

## Rules

- **Throws** an `InvalidOptionError` for a custom variant without a `draw` function and for an option of another variant
  (`subtitle` on a custom cover, `legalText` on a custom back cover, `draw` on a plain one). The checks run before
  anything is drawn.
- **The page**: `ctx` is the document laid out on the whole page (`margins`, `contentWidth`), also when `cover` or
  `backCover` is called from a `columns` callback. The color of the theme `background` is already painted.
- **What `draw` sets**: the font, size, colors and line width it sets do not reach the pages that follow.
- **Warns** when the callback draws past its page: only the first page is the cover, the rest is content.
- **When the callback throws**, the pages it added are deleted, no cover is recorded, and the error propagates. What
  it already drew on the current page stays, and so does what it registered (`onNewPage`, `background`).
- **Blocks and jsPDF**: use any block on `ctx`, or the jsPDF instance through `ctx.doc`.
