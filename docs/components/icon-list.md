---
title: iconList
---

# iconList

A list whose bullets are an image: a star, a brand pictogram.

<!-- preview: icon-list -->

![A list with stars as bullets](../images/components/icon-list.png)

```ts
doc.iconList(['Identity verified', 'Insurance up to date', { text: 'Audit passed', detail: 'March 2026.' }], {
  icon: 'star',
});
```

The library ships no icon: `icon` is an image of yours, registered with `doc.registerImage` or passed as data:

```ts
import { loadImageFromPath } from '@mlt-a/jspdf-toolkit/node';

doc.registerImage('mark', loadImageFromPath('./star.png'));
doc.iconList(['Verified'], { icon: 'mark' });
```

## Options

`iconList(items, options)`. Items are the ones of [bulletList](lists.md#an-item).

<!-- options: IconListOptions -->

| Option            | Type        | Default                               | Description                                                                                                                                              |
| ----------------- | ----------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon`            | `string`    | required                              | Image of every bullet: a name given to `doc.registerImage`, or image data. The library ships no icon.                                                    |
| `level`           | `TextLevel` | `'body'`                              | Text level of the items.                                                                                                                                 |
| `indent`          | `number`    | 0                                     | Indent (mm) of the whole list from the left margin, taken off its width.                                                                                 |
| `maxWidth`        | `number`    | the document `measure` minus `indent` | Width (mm) of the list, bullets included, above 0. Wider than the available width (the content width less `indent`): brought down to it, with a warning. |
| `itemSpacing`     | `number`    | 1                                     | Space (mm) between two items: 0 or more.                                                                                                                 |
| `lineHeightScale` | `number`    | 1                                     | Multiplies the line height.                                                                                                                              |
| `spaceAfter`      | `number`    | `theme.spacing.block`                 | Space (mm) under the list.                                                                                                                               |

<!-- /options -->

## Rules

- **Throws** an `InvalidOptionError` for a missing `options` object (`icon` is required) and for a `bulletChar`, which
  this list has no use for, besides the rules of [bulletList](lists.md#rules).
- **Warns** when the image is neither a registered name nor readable data: the bullets are left out and `doc.warnings`
  says `Failed to draw icon: …`. The document is still produced.
- **Across pages**, **in a column**: like [bulletList](lists.md#rules).
