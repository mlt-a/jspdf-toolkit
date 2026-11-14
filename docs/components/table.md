---
title: table
---

# table

A themed table that sizes its columns from their content and continues across pages.

<!-- preview: table -->

![A table with a foot row](../images/components/table.png)

```ts
doc.table(
  [
    { description: 'Brand design', qty: 5, total: '$2,750.00' },
    { description: 'Accessibility audit', qty: 3, total: '$2,400.00' },
    { description: 'Workshop', qty: 1, total: '$900.00' },
  ],
  {
    columns: [
      { header: 'Description', key: 'description' },
      { header: 'Qty', key: 'qty', width: 20, align: 'center' },
      { header: 'Total', key: 'total', width: 35, align: 'right' },
    ],
    footRow: ['', 'Total', '$6,050.00'],
  },
);
```

`data` holds one record per row; each column reads its `key`. A value is a string or a number; `null` and `undefined`
leave the cell empty.

## Styling cells

`cellStyle` is called for every cell and returns the style of that one: here, negative amounts in the error color and a
bold first column. It may run more than once per cell (`keepTogether` measures first): keep it free of side effects.

<!-- preview: table-cell-style -->

![A table with styled cells](../images/components/table-cell-style.png)

```ts
doc.table(
  [
    { account: 'Subscriptions', change: '+$12,400' },
    { account: 'Refunds', change: '-$1,150' },
    { account: 'Services', change: '+$3,900' },
  ],
  {
    columns: [
      { header: 'Account', key: 'account' },
      { header: 'Change', key: 'change', align: 'right' },
    ],
    alternateRowFill: false,
    cellStyle: ({ section, columnIndex, text }) => {
      if (section !== 'body') return undefined;
      if (text.startsWith('-')) return { color: 'error', bold: true };
      return columnIndex === 0 ? { bold: true } : undefined;
    },
  },
);
```

## A sheet to fill in by hand

`minRowHeight` gives every body row at least that height (mm), whatever its cells hold: an empty row stays tall enough
to write in once printed. The text stays at the top of the cell, and a row taller than the minimum keeps its own height.
The head and the foot row keep the height of their text.

<!-- preview: table-register -->

![A register with empty rows](../images/components/table-register.png)

```ts
doc.table(
  [
    { name: 'Ada Lovelace', arrival: '09:00' },
    { name: '', arrival: '' },
    { name: '', arrival: '' },
  ],
  {
    columns: [
      { header: 'Name', key: 'name' },
      { header: 'Arrival', key: 'arrival', width: 30 },
      { header: 'Signature', key: 'signature', width: 60 },
    ],
    minRowHeight: 14,
    alternateRowFill: false,
  },
);
```

## A dense table

`level` sets the text level of the head, the body and the foot row (default `'small'`). A table with many columns takes
`'caption'`: the text is smaller, so the columns need less width, a header word is not cut in two, and more rows fit a
page. The line height, the wrapping, the pagination and `minRowHeight` follow the level; the cell padding and the
continuation title keep their size. Every text level is accepted, as for a paragraph or a list.

<!-- preview: table-dense -->

![A dense register](../images/components/table-dense.png)

```ts
doc.table([], {
  columns: [
    { header: 'Representatives', key: 'representative' },
    { header: 'Responsibilities', key: 'responsibility' },
    { header: 'Authorisation', key: 'authorisation' },
    { header: 'Identification', key: 'identification' },
    { header: 'Accommodation', key: 'accommodation' },
    { header: 'Administration', key: 'administration' },
    { header: 'Registration', key: 'registration' },
    { header: 'Observations', key: 'observations' },
  ],
  level: 'caption',
  minRowHeight: 10,
  alternateRowFill: false,
});
```

The body and the foot take the color and the slant of the level, the head and the foot are bold on top of it, and what
`cellStyle` returns composes with it: `bold`, `italic` and `color` change that cell, its size stays the one of the table.

## A column

<!-- options: TableColumn -->

| Option   | Type               | Default  | Description                                                                                                                                                                                                                                                                                                                                  |
| -------- | ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `header` | `string`           | required | Text of the head cell.                                                                                                                                                                                                                                                                                                                       |
| `key`    | `string`           | required | Key of the row record whose value fills the cells of this column; a missing key gives an empty cell.                                                                                                                                                                                                                                         |
| `width`  | `number \| 'auto'` | `'auto'` | Width (mm): a finite number above 0, else `InvalidOptionError`. `'auto'` or absent: the column is sized from its content, and the automatic columns share what the fixed ones leave of the content width. A table whose columns are all fixed is as wide as their sum, up to the content width (wider ones are scaled down, with a warning). |
| `align`  | `TextAlign`        | `'left'` | Horizontal alignment of the column, head cell included.                                                                                                                                                                                                                                                                                      |

<!-- /options -->

## Options

`table(data, options)`:

<!-- options: TableOptions -->

| Option              | Type                                                      | Default               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `columns`           | `TableColumn[]`                                           | required              | Columns, left to right. At least one, else `InvalidOptionError`.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `showHead`          | `'everyPage' \| 'firstPage' \| 'never'`                   | `'everyPage'`         | Pages that show the head row: every page of the table, its first page only, or none.                                                                                                                                                                                                                                                                                                                                                                                             |
| `alternateRowFill`  | `boolean`                                                 | `true`                | Zebra stripes on every other body row, the first included, in `colors.zebraFill`.                                                                                                                                                                                                                                                                                                                                                                                                |
| `continuationTitle` | `string`                                                  |                       | Bold line drawn above the table on each page it continues on, e.g. `'Orders (continued)'`.                                                                                                                                                                                                                                                                                                                                                                                       |
| `level`             | `TextLevel`                                               | `'small'`             | Text level of the head, the body and the foot row; a dense table takes `'caption'`. It sets the size of the text, so the natural width of the columns, the wrapping, the row height and the pagination follow it; the body and the foot take its color and slant, the head and the foot are bold on top of it, and a `cellStyle` result composes with it. The cell padding and the continuation title (`'bodyBold'`) keep their size. Any text level, else `InvalidOptionError`. |
| `footRow`           | `TableCell[]`                                             |                       | Closing row, one cell per column, in bold on the `tint` fill. It stays with the last body row.                                                                                                                                                                                                                                                                                                                                                                                   |
| `cellStyle`         | `(cell: TableCellContext) => TableCellStyle \| undefined` |                       | Styles cells one by one, e.g. a negative amount in the error color: `({ section, text }) => (section === 'body' && text.startsWith('-') ? { color: 'error' } : undefined)`. Asked about every cell drawn: head (unless `showHead: 'never'`), body and foot. It may be called more than once for the same cell (`keepTogether` measures before it draws): keep it free of side effects.                                                                                           |
| `minRowHeight`      | `number`                                                  | none                  | Least height (mm) of each body row, for a table meant to be filled in by hand once printed (a register, an attendance sheet): an empty or short row keeps this height, and the text stays at the top of the cell. A taller row keeps its own height. The head and the foot row are not affected. A finite number from 0 to the page height, else `InvalidOptionError`.                                                                                                           |
| `spaceAfter`        | `number`                                                  | `theme.spacing.block` | Space (mm) under the table.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

<!-- /options -->

`cellStyle` receives:

<!-- options: TableCellContext -->

| Option        | Type                         | Default  | Description                                                                |
| ------------- | ---------------------------- | -------- | -------------------------------------------------------------------------- |
| `section`     | `'head' \| 'body' \| 'foot'` | required | `head` for the head row, `body` for a row of `data`, `foot` for `footRow`. |
| `rowIndex`    | `number`                     | required | Index of the row in `data` for a body cell; 0 for the head and the foot.   |
| `columnIndex` | `number`                     | required | Index of the column in `columns`.                                          |
| `column`      | `TableColumn`                | required | The column of the cell.                                                    |
| `text`        | `string`                     | required | The cell text: the value as printed, `''` for an empty cell.               |
| `row`         | `TableRow`                   |          | The record of a body row; absent for the head and the foot.                |

<!-- /options -->

and returns:

<!-- options: TableCellStyle -->

| Option   | Type         | Default                                                                    | Description                                 |
| -------- | ------------ | -------------------------------------------------------------------------- | ------------------------------------------- |
| `color`  | `ColorInput` |                                                                            | Text color.                                 |
| `fill`   | `ColorInput` |                                                                            | Cell fill.                                  |
| `bold`   | `boolean`    | bold in the head and the foot, the weight of the table `level` in the body | Bold text; `false` removes the weight too.  |
| `italic` | `boolean`    | the slant of the table `level`                                             | Italic text; `false` removes the slant too. |
| `align`  | `TextAlign`  | the column `align`                                                         | Horizontal alignment of the cell.           |

<!-- /options -->

## Rules

- **Throws** an `InvalidOptionError` for no column, a column `width` that is neither `'auto'` nor above 0, a `level`
  that is no text level and a `minRowHeight` that is not a finite number from 0 to the page height, besides the checks every block makes (see
  [errors](errors.md#what-a-block-checks)); an `InvalidColorError` for a color `cellStyle` returns that is invalid. A
  table without a row draws its head row.
- **Warns** when the widths of the columns add up to more than the available width: they are scaled down to fit.
- **Width**: the table spans the available width, unless every column has a fixed `width`: it is then as wide as their
  sum. A column without `width` is sized from its content and shares what the fixed ones leave.
- **Across pages**: rows never split. The head row is repeated on each page (`showHead`), `continuationTitle` is drawn
  above the table on each page it continues on, and the foot row stays with the last body row. A row
  [taller than a page](flow-control.md#taller-than-a-page) overflows it, with a warning.
- **In a column**: the table spans the column.
