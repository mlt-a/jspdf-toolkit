---
title: columns
---

# columns

Side-by-side columns of blocks. Inside a column the document lays its blocks out in that column: headings, lists,
tables, charts, boxes, even nested columns. The page methods are the exception: they act on the whole page.

<!-- preview: columns -->

![Two columns of headings, lists and text](../images/components/columns.png)

```ts
doc.columns(
  [
    (column) => column.heading('Sales', { level: 'h3' }).bulletList(['12 people', '3 offices', '40 countries']),
    (column) =>
      column
        .heading('Support', { level: 'h3' })
        .paragraph('Open 24 hours a day, five days a week, in four languages.')
        .checkbox('Phone and chat', { variant: 'checked' }),
  ],
  { gap: 8 },
);
```

Each callback receives `(column, columnX, columnWidth)`: `column` is the document laid out in the column (its `margins`
and `contentWidth` are the column's, its `measure` the narrower of the column and the reading column); the two numbers
are for drawing with jsPDF yourself.

## A chart next to its reading

<!-- preview: columns-chart -->

![A donut chart beside an info box](../images/components/columns-chart.png)

```ts
doc.columns([
  (column) =>
    column.donutChart(
      [
        { label: 'Recurring', value: 72 },
        { label: 'One-off', value: 28 },
      ],
      { centerLabel: '72%' },
    ),
  (column) =>
    column.infoBox('Recurring revenue passed 70% of the total for the first time.', {
      variant: 'callout',
      title: 'A steadier base',
    }),
]);
```

## Options

`columns(callbacks, options?)`:

<!-- options: ColumnsOptions -->

| Option       | Type     | Default               | Description                                |
| ------------ | -------- | --------------------- | ------------------------------------------ |
| `gap`        | `number` | `SPACING.xlarge`      | Space (mm) between two columns: 0 or more. |
| `spaceAfter` | `number` | `theme.spacing.block` | Space (mm) under the tallest column.       |

<!-- /options -->

## Rules

- **Throws** an `InvalidOptionError` for an argument that is not an array of functions, a `gap` below 0, and a `gap`
  that leaves the columns no width, besides the checks every block makes (see
  [errors](errors.md#what-a-block-checks)). An empty list of callbacks draws nothing.
- **Layout**: the columns are equal and span the content width. Each starts from the same top, with the font, colors
  and line width the call found, and the position ends under the tallest one.
- **Across pages**: columns do not continue on the next page. A column that runs onto a new page adds a warning and the
  columns after it start at the top of that page. Wrap the whole call in [keepTogether](flow-control.md#keeptogether)
  when the columns may reach the bottom.
- **Page methods** called from a column (`pageHeader`, `pageFooter`, `watermark`, `background`, `tableOfContents`,
  `cover`, `backCover`, a logo placed from a page corner, `finalize`) act on the whole page, not on the column.
- **An error in a callback** propagates: it is not caught.
