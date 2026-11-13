---
title: addressBlock
---

# addressBlock

A boxed address: a name, an optional subtitle, the address lines.

<!-- preview: address-block -->

![An address block](../images/components/address-block.png)

```ts
doc.addressBlock([
  { text: 'TechStart Inc.', role: 'title' },
  { text: 'Accounts payable', role: 'subtitle' },
  { text: '1 Main Street', role: 'address' },
  { text: 'Springfield, IL 62701', role: 'address' },
]);
```

## From a multi-line string

`parseAddressLines` builds the lines: the first one is the title, the second one the subtitle when `hasSubtitle` is
set, the rest the address. The block takes the measure of its frame; [`inset`](flow-control.md#inset) narrows and places it.

<!-- preview: address-block-right -->

![An address block on the right of the page](../images/components/address-block-right.png)

```ts
import { parseAddressLines } from '@mlt-a/jspdf-toolkit';

doc.inset({ right: 0, width: 80 }, () => {
  doc.addressBlock(parseAddressLines('Acme Corp\n12 Harbour Road\nBristol BS1 4RW'), { boxStyle: 'tint' });
});
```

## A line

<!-- options: AddressLine -->

| Option | Type                                 | Default  | Description                                                                                                       |
| ------ | ------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `text` | `string`                             | required | The line as drawn; a line wider than the box wraps.                                                               |
| `role` | `'title' \| 'subtitle' \| 'address'` | required | What the line is, which sets its text level: `title` in `label`, `subtitle` in `smallMuted`, `address` in `body`. |

<!-- /options -->

## Options

`addressBlock(lines, options?)`:

<!-- options: AddressBlockOptions -->

| Option       | Type             | Default               | Description               |
| ------------ | ---------------- | --------------------- | ------------------------- |
| `boxStyle`   | `BoxStylePreset` | `'surfaceBorder'`     | Fill and border preset.   |
| `spaceAfter` | `number`         | `theme.spacing.block` | Space (mm) under the box. |

<!-- /options -->

`parseAddressLines(address, options?)`:

<!-- options: ParseAddressLinesOptions -->

| Option        | Type      | Default | Description                                                                       |
| ------------- | --------- | ------- | --------------------------------------------------------------------------------- |
| `hasSubtitle` | `boolean` | `false` | Takes the second line as a subtitle, in `smallMuted`, instead of an address line. |

<!-- /options -->

## Rules

- **Throws** an `InvalidOptionError` for a line with a `role` other than `'title'`, `'subtitle'` or `'address'` and a
  frame that leaves no room for the text, besides the checks every block makes (see
  [errors](errors.md#what-a-block-checks)). An empty list of lines draws nothing.
- **Across pages**: the box is never split; it moves to the next page when it does not fit. One
  [taller than a page](flow-control.md#taller-than-a-page) overflows it, with a warning.
- **In a column or an inset**: the block takes the measure of that frame.
