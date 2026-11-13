import { describe, expect, it, vi } from 'vitest';

import { TABLE } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import { InvalidColorError, InvalidOptionError } from '../../src/core/errors';
import { measureTextLevel, resolveTextStyle, setTextStyle } from '../../src/drawing/text';
import type { TableOptions, TableRow } from '../../src/table/types';
vi.mock('../../src/drawing/text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/drawing/text')>();
  return { ...actual, resolveTextStyle: vi.fn(actual.resolveTextStyle) };
});

import { createTheme } from '../../src/theme/defaults';
import type { DrawnText } from './helpers';
import { channels, filledShapes, leaveRoom, makeDoc, pageStream, recordTexts, sameColor, textOf } from './helpers';

type Cell = { x: number; y: number; width: number; height: number; fill: string; page: number };

/**
 * Drops the float noise of the points-to-mm division, so that a width given in mm reads back as itself. Four digits
 * keep the rounding well under the 0.001 mm the tests compare at.
 */
const mm = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Every cell a document draws (a filled and stroked rectangle), with its page and the color it is really painted with,
 * read from the content stream: `getFillColor` does not know that a text block changes it.
 */
function cellsOf(doc: PDFDocument): Cell[] {
  return Array.from({ length: doc.pageNumber }, (_, i) => i + 1).flatMap((page) =>
    filledShapes(doc, page)
      .filter((shape) => shape.op === 'B')
      .map(({ x, y, width, height, color }) => ({
        x: mm(x),
        y: mm(y),
        width: mm(width),
        height: mm(height),
        fill: color,
        page,
      })),
  );
}

/**
 * Draws a table on a new document, `before` run first (e.g. to leave little room), and reads back what the table draws.
 */
function drawn(data: TableRow[], options: TableOptions, before?: (doc: PDFDocument) => void) {
  const doc = makeDoc();
  before?.(doc);
  const texts = recordTexts(doc);
  doc.table(data, options);
  return { doc, cells: cellsOf(doc), texts };
}

/** Every text line drawn, flattened. */
const linesOf = (texts: DrawnText[]) => texts.flatMap((call) => call.lines);

/** Same color, give or take jsPDF's one-level round trip. */
function expectColor(actual: string, expected: string): void {
  channels(actual).forEach((level, i) => expect(Math.abs(level - channels(expected)[i])).toBeLessThanOrEqual(1));
}

const lineHeight = (doc: PDFDocument) => measureTextLevel(doc, 'small').lineHeight;
const oneLineRow = (doc: PDFDocument) => lineHeight(doc) + TABLE.cellPadding.top + TABLE.cellPadding.bottom;
/** Height (mm) of the content area of a page after the first. */
const usableHeight = (doc: PDFDocument) => doc.layout.bottom(doc.pageHeight) - doc.layout.topFor(2);

const rowsOf = (count: number): TableRow[] => Array.from({ length: count }, (_, i) => ({ item: `Row ${i}`, value: i }));
const columns: TableOptions['columns'] = [
  { header: 'Item', key: 'item' },
  { header: 'Value', key: 'value', align: 'right' },
];

/** Leaves room for `rows` one-line rows, and a little more, at the bottom of the page. */
const roomFor = (rows: number) => (doc: PDFDocument) => leaveRoom(doc, rows * oneLineRow(doc) + 0.5);

/** Cells grouped by row, from the order they are drawn in. */
const byRow = (cells: Cell[], width = columns.length) =>
  Array.from({ length: cells.length / width }, (_, i) => cells.slice(i * width, (i + 1) * width));

describe('table widths', () => {
  it('spans the content width from the left margin', () => {
    const { doc, cells } = drawn(rowsOf(2), { columns });
    const [first, second] = cells;
    expect(first.x).toBeCloseTo(doc.margins.left, 6);
    expect(second.x).toBeCloseTo(first.x + first.width, 6);
    expect(first.width + second.width).toBeCloseTo(doc.contentWidth, 3);
    expect(doc.warnings).toEqual([]);
  });

  it('keeps fixed widths and gives the automatic columns the rest', () => {
    const { doc, cells } = drawn([{ a: 'x', b: 'y', c: 'z' }], {
      columns: [
        { header: 'A', key: 'a', width: 30 },
        { header: 'B', key: 'b', width: 'auto' },
        { header: 'C', key: 'c', width: 20 },
      ],
    });
    const [a, b, c] = cells;
    expect(a.width).toBe(30);
    expect(c.width).toBe(20);
    expect(b.width).toBeCloseTo(doc.contentWidth - 50, 3);
  });

  it('is as wide as the sum of its columns when every width is fixed and under the content width', () => {
    const { doc, cells } = drawn([{ a: 'x', b: 'y' }], {
      columns: [
        { header: 'A', key: 'a', width: 30 },
        { header: 'B', key: 'b', width: 20 },
      ],
    });
    expect(cells.slice(0, 2).map((cell) => cell.width)).toEqual([30, 20]);
    const last = cells[1];
    expect(last.x + last.width).toBeCloseTo(doc.margins.left + 50, 6);
    expect(doc.warnings).toEqual([]);
  });

  it('sizes automatic columns from their content', () => {
    const { doc, cells } = drawn([{ id: '1', label: 'A much longer description of the line item' }], {
      columns: [
        { header: 'No', key: 'id' },
        { header: 'Description', key: 'label' },
      ],
    });
    const [id, label] = cells;
    expect(label.width).toBeGreaterThan(id.width * 3);
    expect(id.width + label.width).toBeCloseTo(doc.contentWidth, 3);
  });

  it('sizes a column from its widest line, the header included', () => {
    const { cells } = drawn([{ a: 'x', b: 'y' }], {
      columns: [
        { header: 'A header much wider than its cells', key: 'a' },
        { header: 'B', key: 'b' },
      ],
    });
    const [a, b] = cells;
    expect(a.width).toBeGreaterThan(b.width);
  });

  it('leaves a hidden header out of the widths', () => {
    const options: TableOptions = {
      columns: [
        { header: 'A header much wider than its cells', key: 'a' },
        { header: 'B', key: 'b' },
      ],
    };
    const shown = drawn([{ a: 'x', b: 'y' }], options);
    const hidden = drawn([{ a: 'x', b: 'y' }], { ...options, showHead: 'never' });
    expect(hidden.cells[0].width).toBeLessThan(shown.cells[0].width);
  });

  it('wraps a long cell instead of squeezing the short columns', () => {
    const long = 'A very long description that cannot fit on one line of the table. '.repeat(4).trim();
    const { doc, cells, texts } = drawn([{ qty: '12', label: long }], {
      columns: [
        { header: 'Qty', key: 'qty' },
        { header: 'Description', key: 'label' },
      ],
      showHead: 'never',
    });
    const [qty] = cells;
    // The short column keeps its natural width: its text is on one line.
    expect(linesOf(texts)).toContain('12');
    expect(qty.height).toBeGreaterThan(oneLineRow(doc));
    expect(qty.width).toBeLessThan(doc.contentWidth / 4);
  });

  it('never wraps a cell of a column sized from that very cell', () => {
    const long = 'A long description that takes all the room the short columns leave to it. '.repeat(3).trim();
    const { texts } = drawn([{ label: long, total: '$2,750.00', ok: 'Yes' }], {
      columns: [
        { header: 'Description', key: 'label' },
        { header: 'Total', key: 'total' },
        { header: 'OK', key: 'ok' },
      ],
    });
    // The squeezed column wraps; the short ones keep their text whole.
    expect(linesOf(texts)).toEqual(expect.arrayContaining(['Total', '$2,750.00', 'Yes', 'OK']));
  });

  it('scales columns wider than the content down to it, with a warning', () => {
    const { doc, cells } = drawn([{ a: 'x', b: 'y', c: 'z' }], {
      columns: [
        { header: 'A', key: 'a', width: 120 },
        { header: 'B', key: 'b', width: 100 },
        { header: 'C', key: 'c' },
      ],
    });
    const last = cells[2];
    expect(last.x + last.width).toBeCloseTo(doc.margins.left + doc.contentWidth, 3);
    expect(cells[0].width / cells[1].width).toBeCloseTo(120 / 100, 3);
    expect(doc.warnings).toEqual([
      expect.stringMatching(
        /mm wide together, more than the available width \(186\.0 mm\): they are scaled down to fit$/,
      ),
    ]);
  });
});

describe('table options validation', () => {
  it.each([
    ['NaN', Number.NaN],
    ['zero', 0],
    ['negative', -5],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a string other than auto', 'wide'],
    ['an empty string', ''],
  ])('throws on a width of %s', (_label, width) => {
    const doc = makeDoc();
    const run = () => doc.table(rowsOf(1), { columns: [{ header: 'A', key: 'item', width: width as number }] });
    expect(run).toThrow(InvalidOptionError);
    expect(run).toThrow(/Invalid width for table column "item"/);
  });

  it('throws even when there is nothing to draw', () => {
    const doc = makeDoc();
    expect(() => doc.table([], { columns: [{ header: 'A', key: 'a', width: 0 }], showHead: 'never' })).toThrow(
      InvalidOptionError,
    );
  });

  it.each<[string, TableRow[], TableOptions]>([
    ['with rows', rowsOf(3), { columns: [] }],
    ['with a foot', [], { columns: [], footRow: ['Total'] }],
    ['without anything to show', [], { columns: [], showHead: 'never' }],
  ])('throws on a table without columns, %s', (_, data, options) => {
    const doc = makeDoc();
    expect(() => doc.table(data, options)).toThrow(InvalidOptionError);
    expect(() => doc.table(data, options)).toThrow(/at least one column/);
  });

  it("accepts a positive finite number, 'auto' and no width", () => {
    const doc = makeDoc();
    expect(() =>
      doc.table(rowsOf(1), {
        columns: [
          { header: 'A', key: 'item', width: 30 },
          { header: 'B', key: 'value', width: 'auto' },
          { header: 'C', key: 'item' },
        ],
      }),
    ).not.toThrow();
  });
});

describe('table cells', () => {
  it('prints numbers and leaves null, undefined and missing values empty, without a text call', () => {
    const { texts } = drawn([{ a: 42, b: null }, { a: 0, b: undefined }, { a: 1.5 }], {
      columns: [
        { header: 'A', key: 'a' },
        { header: 'B', key: 'b' },
      ],
    });
    expect(linesOf(texts)).toEqual(['A', 'B', '42', '0', '1.5']);
  });

  it('breaks a cell on its line breaks and sizes the row from its tallest cell', () => {
    const { doc, cells, texts } = drawn([{ item: 'First\nSecond', value: 1 }], { columns, showHead: 'never' });
    expect(linesOf(texts)).toEqual(expect.arrayContaining(['First', 'Second']));
    for (const cell of cells) expect(cell.height).toBeCloseTo(oneLineRow(doc) + lineHeight(doc), 3);
  });

  it('anchors each cell by its alignment, inside the padding', () => {
    const { cells, texts } = drawn([{ l: 'Left', c: 'Center', r: 'Right' }], {
      columns: [
        { header: 'L', key: 'l', width: 40 },
        { header: 'C', key: 'c', width: 40, align: 'center' },
        { header: 'R', key: 'r', width: 40, align: 'right' },
      ],
      showHead: 'never',
    });
    const [left, center, right] = cells;
    expect(textOf(texts, 'Left')).toMatchObject({ x: left.x + TABLE.cellPadding.left, align: 'left' });
    expect(textOf(texts, 'Center')).toMatchObject({ x: center.x + center.width / 2, align: 'center' });
    expect(textOf(texts, 'Right')).toMatchObject({
      x: right.x + right.width - TABLE.cellPadding.right,
      align: 'right',
    });
  });

  it('aligns the head and the foot with their column', () => {
    const { texts } = drawn(rowsOf(1), { columns, footRow: ['Total', 1] });
    expect(textOf(texts, 'Item').align).toBe('left');
    expect(textOf(texts, 'Value').align).toBe('right');
    expect(textOf(texts, '1').align).toBe('right');
  });

  it('sets the head in bold on the primary color, the body in regular, the foot in bold on the tint', () => {
    const { doc, cells, texts } = drawn([{ item: 'Body', value: 2 }], { columns, footRow: ['Foot', 3] });
    const { colors } = doc.theme;
    expect(textOf(texts, 'Item').fontStyle).toBe('bold');
    expectColor(textOf(texts, 'Item').color, colors.onPrimary);
    expect(textOf(texts, 'Body').fontStyle).toBe('normal');
    expectColor(textOf(texts, 'Body').color, colors.text);
    expect(textOf(texts, 'Foot').fontStyle).toBe('bold');
    const [head, body, foot] = byRow(cells);
    expectColor(head[0].fill, colors.primary);
    expectColor(body[0].fill, colors.zebraFill);
    expectColor(foot[0].fill, colors.tint);
  });

  it('stripes every other body row, the first included', () => {
    const { doc, cells } = drawn(rowsOf(4), { columns, showHead: 'never' });
    const { zebraFill, background } = doc.theme.colors;
    byRow(cells).forEach((row, i) => {
      for (const cell of row) expectColor(cell.fill, i % 2 === 0 ? zebraFill : background);
    });
  });

  it('fills every body row with the background when alternateRowFill is false', () => {
    const { doc, cells } = drawn(rowsOf(4), { columns, showHead: 'never', alternateRowFill: false });
    for (const cell of cells) expectColor(cell.fill, doc.theme.colors.background);
  });

  const keys = ['name', 'constructor', 'toString', '__proto__'];
  it.each<[string, TableRow, string[]]>([
    ['leaves out what a row inherits', { name: 'A' }, ['A']],
    ['reads an own property, whatever its name', { constructor: 'mine', toString: 'own' }, ['mine', 'own']],
  ])('%s', (_, row, body) => {
    const { texts } = drawn([row], { columns: keys.map((key) => ({ header: key, key })), showHead: 'never' });
    expect(linesOf(texts)).toEqual(body);
  });

  it('resolves the text style once per weight, slant and color, not once per cell', () => {
    const doc = makeDoc();
    vi.mocked(resolveTextStyle).mockClear();
    doc.table(rowsOf(40), { columns, footRow: ['Total', 1] });
    // Bold on the primary color for the head, regular for the body, bold for the foot.
    expect(vi.mocked(resolveTextStyle)).toHaveBeenCalledTimes(3);

    vi.mocked(resolveTextStyle).mockClear();
    doc.table(rowsOf(40), { columns, cellStyle: ({ section }) => (section === 'body' ? { italic: true } : undefined) });
    // Head bold, body italic.
    expect(vi.mocked(resolveTextStyle)).toHaveBeenCalledTimes(2);
  });

  it('leaves the cells of a short foot row empty', () => {
    const { cells, texts } = drawn(rowsOf(1), { columns, footRow: ['Total'] });
    expect(cells).toHaveLength(3 * columns.length);
    expect(linesOf(texts).filter((line) => line === 'Total')).toHaveLength(1);
  });
});

const wide = [...columns, { header: 'Note', key: 'note' }, { header: 'Total', key: 'total', align: 'right' as const }];
const wideRows = (count: number): TableRow[] => rowsOf(count).map((row) => Object.assign(row, { note: 'n', total: 1 }));
/** Each cell reads the text colors of its own column, so the text written before a cell never matches its fill. */
const textColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'] as const;
const cellStyle: NonNullable<TableOptions['cellStyle']> = ({ columnIndex }) => ({ color: textColors[columnIndex] });

describe('table fills', () => {
  it('fills every cell of every column with the color of its section, whatever the text before it', () => {
    const { doc, cells } = drawn(wideRows(5), { columns: wide, footRow: ['Total', 1, '', 2], cellStyle });
    const { colors } = doc.theme;
    const expected = [
      colors.primary,
      ...[0, 1, 2, 3, 4].map((i) => (i % 2 === 0 ? colors.zebraFill : colors.background)),
      colors.tint,
    ];
    byRow(cells, wide.length).forEach((row, i) => {
      expect(row).toHaveLength(wide.length);
      for (const cell of row) expectColor(cell.fill, expected[i]);
    });
    // None of the text colors ends up as a background.
    for (const cell of cells) for (const color of textColors) expect(sameColor(cell.fill, color), color).toBe(false);
  });

  it('fills a plain table with its background in every cell', () => {
    const { doc, cells } = drawn(wideRows(4), { columns: wide, alternateRowFill: false, showHead: 'never', cellStyle });
    expect(cells).toHaveLength(4 * wide.length);
    for (const cell of cells) expectColor(cell.fill, doc.theme.colors.background);
  });

  it('fills the cells of a custom fill with it, and the others with theirs', () => {
    const { doc, cells } = drawn(wideRows(2), {
      columns: wide,
      showHead: 'never',
      cellStyle: ({ columnIndex, ...rest }) => ({
        ...cellStyle({ columnIndex, ...rest }),
        fill: columnIndex === 1 ? '#FFEEEE' : undefined,
      }),
    });
    byRow(cells, wide.length).forEach((row, i) => {
      row.forEach((cell, c) =>
        expectColor(
          cell.fill,
          c === 1 ? '#FFEEEE' : i % 2 === 0 ? doc.theme.colors.zebraFill : doc.theme.colors.background,
        ),
      );
    });
  });

  it('fills the head and the rows of a continuation page like the first', () => {
    const { doc, cells } = drawn(wideRows(120), { columns: wide, footRow: ['Total', 1, '', 2], cellStyle });
    const { colors } = doc.theme;
    expect(doc.pageNumber).toBeGreaterThan(2);
    const all = byRow(cells, wide.length);
    // The head opens every page, the foot closes the table, and body rows keep counting across pages.
    let bodyIndex = 0;
    const expected = all.map((row, i) => {
      const pageOf = row[0].page;
      const opensPage = i === 0 || all[i - 1][0].page !== pageOf;
      if (opensPage) return colors.primary;
      if (i === all.length - 1) return colors.tint;
      return bodyIndex++ % 2 === 0 ? colors.zebraFill : colors.background;
    });
    // The head of the first page is not a body row: the first body row is striped.
    all.forEach((row, i) => {
      for (const cell of row) expectColor(cell.fill, expected[i]);
    });
  });
});

describe('table position', () => {
  it('advances by the rows it draws, then the block space', () => {
    const doc = makeDoc();
    const start = doc.getYPos();
    doc.table(rowsOf(3), { columns, footRow: ['Total', 3] });
    expect(doc.getYPos() - start).toBeCloseTo(5 * oneLineRow(doc) + doc.theme.spacing.block, 6);
  });

  it.each([0, 10])('leaves spaceAfter %d mm under it', (spaceAfter) => {
    const doc = makeDoc();
    const start = doc.getYPos();
    doc.table(rowsOf(2), { columns, spaceAfter });
    expect(doc.getYPos() - start).toBeCloseTo(3 * oneLineRow(doc) + spaceAfter, 6);
    expect(doc.contentBottom() - start).toBeCloseTo(3 * oneLineRow(doc), 6);
  });

  it('draws the head alone for a table without rows', () => {
    const { doc, cells } = drawn([], { columns });
    expect(cells).toHaveLength(columns.length);
    expect(doc.contentBottom() - doc.firstPageTop).toBeCloseTo(oneLineRow(doc), 6);
  });

  it('draws the foot alone for a table without rows nor head', () => {
    const { doc, cells } = drawn([], { columns, showHead: 'never', footRow: ['Total', 0] });
    expect(cells).toHaveLength(columns.length);
    expectColor(cells[0].fill, doc.theme.colors.tint);
  });

  it('draws nothing and leaves the position alone without rows, head nor foot', () => {
    let start = 0;
    const { doc, cells } = drawn([], { columns, showHead: 'never' }, (page) => {
      page.paragraph('Intro');
      start = page.peekYPos();
    });
    expect(cells).toEqual([]);
    expect(doc.peekYPos()).toBe(start);
  });
});

describe('table pagination', () => {
  it('breaks the page between rows, never inside one', () => {
    const { doc, cells } = drawn(rowsOf(120), { columns });
    const pages = doc.doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    const bottom = doc.layout.bottom(doc.pageHeight);
    for (const cell of cells) expect(cell.y + cell.height).toBeLessThanOrEqual(bottom + 1e-6);
    // Every row is drawn once, the header once per page.
    expect(cells).toHaveLength((120 + pages) * columns.length);
  });

  it('goes on at the top of the content of the next page', () => {
    const { doc, cells } = drawn(rowsOf(120), { columns });
    const onSecondPage = cells.filter((cell) => cell.page === 2);
    expect(Math.min(...onSecondPage.map((cell) => cell.y))).toBeCloseTo(doc.margins.top, 6);
  });

  it('breaks in the middle of the table and goes on with the next row', () => {
    const { doc, cells, texts } = drawn(rowsOf(4), { columns }, roomFor(3));
    expect(doc.doc.getNumberOfPages()).toBe(2);
    // Head and two rows on the first page; the repeated head and the last two rows on the second.
    expect(cells.filter((cell) => cell.page === 1)).toHaveLength(3 * columns.length);
    expect(cells.filter((cell) => cell.page === 2)).toHaveLength(3 * columns.length);
    expect(linesOf(texts).filter((line) => line.startsWith('Row '))).toEqual(['Row 0', 'Row 1', 'Row 2', 'Row 3']);
  });

  it.each<[TableOptions['showHead'], (pages: number) => number]>([
    [undefined, (pages) => pages],
    ['everyPage', (pages) => pages],
    ['firstPage', () => 1],
    ['never', () => 0],
  ])('draws the header with showHead %s on the expected pages', (showHead, expected) => {
    const { doc, texts } = drawn(rowsOf(120), { columns, showHead });
    const pages = doc.doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    expect(texts.filter((call) => call.lines[0] === 'Item')).toHaveLength(expected(pages));
  });

  it('draws the continuation title on the pages the table continues on, above the header', () => {
    const { doc, cells, texts } = drawn(rowsOf(120), { columns, continuationTitle: 'Orders (continued)' });
    const pages = doc.doc.getNumberOfPages();
    const titles = texts.filter((call) => call.lines[0] === 'Orders (continued)');
    expect(titles.map((call) => call.page)).toEqual(Array.from({ length: pages - 1 }, (_, i) => i + 2));
    const { ascent, lineHeight: titleLine } = measureTextLevel(doc, 'bodyBold');
    expect(titles[0].y).toBeCloseTo(doc.margins.top + ascent, 6);
    expect(titles[0].x).toBe(doc.margins.left);
    expect(titles[0].fontStyle).toBe('bold');
    const headOnSecond = cells.find((cell) => cell.page === 2)!;
    expect(headOnSecond.y).toBeCloseTo(doc.margins.top + titleLine + TABLE.continuationTitleGap, 3);
  });

  it('wraps a long continuation title to the table width and moves the header under it', () => {
    const title = 'Orders placed over the whole of the reporting period, every region included (continued)';
    const narrow = [
      { header: 'Item', key: 'item', width: 40 },
      { header: 'Value', key: 'value', width: 30 },
    ];
    const { doc, cells, texts } = drawn(rowsOf(120), { columns: narrow, continuationTitle: title });
    const onSecond = texts.filter((call) => call.page === 2);
    const titleLines = onSecond.slice(
      0,
      onSecond.findIndex((call) => call.lines[0] === 'Item'),
    );
    expect(titleLines.length).toBeGreaterThan(1);
    expect(titleLines.flatMap((call) => call.lines).join(' ')).toBe(title);
    setTextStyle(doc, 'bodyBold');
    for (const line of titleLines.flatMap((call) => call.lines)) expect(doc.doc.getTextWidth(line)).toBeLessThan(70);
    const { lineHeight: titleLine } = measureTextLevel(doc, 'bodyBold');
    const headOnSecond = cells.find((cell) => cell.page === 2)!;
    expect(headOnSecond.y).toBeCloseTo(doc.margins.top + titleLines.length * titleLine + TABLE.continuationTitleGap, 3);
    // The lead counts every line of the title: no row runs past the bottom of the content area.
    const bottom = doc.layout.bottom(doc.pageHeight);
    for (const cell of cells) expect(cell.y + cell.height).toBeLessThanOrEqual(bottom + 1e-6);
  });

  it('draws the continuation title without a header with showHead firstPage', () => {
    const { doc, texts } = drawn(rowsOf(120), {
      columns,
      continuationTitle: 'Orders (continued)',
      showHead: 'firstPage',
    });
    const pages = doc.doc.getNumberOfPages();
    expect(linesOf(texts).filter((line) => line === 'Orders (continued)')).toHaveLength(pages - 1);
    expect(linesOf(texts).filter((line) => line === 'Item')).toHaveLength(1);
  });

  it('keeps the foot row with the last body row', () => {
    // Room for the header and two body rows, not for the foot under them.
    const { doc, cells } = drawn(rowsOf(2), { columns, footRow: ['Total', 1] }, roomFor(3));
    expect(doc.doc.getNumberOfPages()).toBe(2);
    // On the second page: the repeated header, the last row and the foot.
    expect(cells.filter((cell) => cell.page === 2)).toHaveLength(3 * columns.length);
  });

  it('does not leave the header alone when the only row moves with the foot', () => {
    // Room for the header and the row, not for the foot under them.
    const { doc, cells } = drawn(rowsOf(1), { columns, footRow: ['Total', 1], showHead: 'firstPage' }, roomFor(2));
    expect(doc.doc.getNumberOfPages()).toBe(2);
    // Header, row and foot all start on the second page: nothing was drawn at the bottom of the first.
    expect(cells.every((cell) => cell.page === 2)).toBe(true);
    expect(cells).toHaveLength(3 * columns.length);
  });

  it('decorates its continuation pages', () => {
    const doc = makeDoc();
    const hook = vi.fn();
    doc.onNewPage(hook);
    doc.table(rowsOf(120), { columns });
    expect(hook).toHaveBeenCalledTimes(doc.doc.getNumberOfPages() - 1);
  });
});

const tallRow = (lines: number): TableRow => ({
  item: Array.from({ length: lines }, (_, i) => `Line ${i}`).join('\n'),
  value: 1,
});
const rowHeight = (lines: number, doc: PDFDocument) =>
  lines * lineHeight(doc) + TABLE.cellPadding.top + TABLE.cellPadding.bottom;
/** What a continuation page draws before its first row: the title and its gap, the header. */
const lead = (doc: PDFDocument) =>
  measureTextLevel(doc, 'bodyBold').lineHeight + TABLE.continuationTitleGap + oneLineRow(doc);

/**
 * Draws a first row, then `row`, under room for three one-line rows, with a continuation title: `row` goes to the
 * next page. `keepTogether` wraps the table in it.
 */
function draw(row: TableRow, extra: Partial<TableOptions> = {}, { keepTogether = false } = {}) {
  const doc = makeDoc();
  leaveRoom(doc, 3 * oneLineRow(doc));
  const table = () =>
    doc.table([{ item: 'First', value: 0 }, row], { columns, continuationTitle: 'Orders (continued)', ...extra });
  if (keepTogether) doc.keepTogether(table);
  else table();
  return doc;
}

/** Most lines a row can have and still fit under the lead of a continuation page. */
const fittingLines = (doc: PDFDocument) => Math.floor((usableHeight(doc) - lead(doc) - 2) / lineHeight(doc));
/** Fewest lines for a row that fits a bare page but not under the lead. */
const overflowingLines = (doc: PDFDocument) => fittingLines(doc) + 1;

describe('table rows taller than a continuation page', () => {
  const tooTall = /taller than the usable page height/;
  const tooTallWarnings = (doc: PDFDocument) => doc.warnings.filter((warning) => tooTall.test(warning));
  const probe = makeDoc();

  it('draws the row anyway and warns once when it does not fit under the title and the header', () => {
    const lines = overflowingLines(probe);
    // A row that fits a bare page, so that only the continuation lead overflows it.
    expect(rowHeight(lines, probe)).toBeLessThanOrEqual(usableHeight(probe));
    expect(rowHeight(lines, probe)).toBeGreaterThan(usableHeight(probe) - lead(probe));
    const doc = draw(tallRow(lines));
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(pageStream(doc, 2)).toContain('(Line 0)');
    expect(tooTallWarnings(doc)).toHaveLength(1);
    expect(doc.warnings[0]).not.toMatch(/\.$/);
  });

  it('counts what the page draws before the row, for the foot too', () => {
    // The foot goes to the continuation page with the last row.
    const doc = draw(tallRow(overflowingLines(probe) - 1), { footRow: ['Total', 1] });
    expect(tooTallWarnings(doc)).toHaveLength(1);
  });

  it('warns once in keepTogether, not once per measuring pass', () => {
    const doc = draw(tallRow(overflowingLines(probe)), {}, { keepTogether: true });
    expect(tooTallWarnings(doc)).toHaveLength(1);
  });

  it('does not warn when the row fits under the title and the header', () => {
    const lines = fittingLines(probe);
    expect(rowHeight(lines, probe)).toBeLessThanOrEqual(usableHeight(probe) - lead(probe));
    const doc = draw(tallRow(lines));
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(doc.warnings).toEqual([]);
  });

  it('warns once, for the row itself, when it is taller than a bare page', () => {
    const doc = draw(tallRow(overflowingLines(probe) + Math.ceil(lead(probe) / lineHeight(probe)) + 1));
    expect(tooTallWarnings(doc)).toHaveLength(1);
  });
});

describe('table whose first row is taller than a page', () => {
  it('keeps the header with it and warns once', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.table([tallRow(Math.ceil(usableHeight(doc) / lineHeight(doc)) + 1)], {
      columns,
      continuationTitle: 'Orders (continued)',
    });
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(texts.every((call) => call.page === 1)).toBe(true);
    expect(doc.warnings).toHaveLength(1);
  });
});

describe('table in keepTogether', () => {
  it('stays on the page when it fits, without leaving scratch pages behind', () => {
    const doc = makeDoc();
    doc.keepTogether(() => doc.heading('Orders', { level: 'h2' }).table(rowsOf(5), { columns }));
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(doc.pageRefs.tocEntries.map((entry) => entry.page)).toEqual([1]);
  });

  it('moves to the next page whole, with its heading, when it does not fit', () => {
    const doc = makeDoc();
    leaveRoom(doc, 4 * oneLineRow(doc));
    doc.keepTogether(() => doc.heading('Orders', { level: 'h2' }).table(rowsOf(5), { columns }));
    expect(doc.doc.getNumberOfPages()).toBe(2);
    // The measuring passes draw on scratch pages: the pages kept tell where the table went.
    expect(pageStream(doc, 1)).not.toContain('(Item)');
    for (const text of ['(Item)', '(Row 0)', '(Row 4)']) expect(pageStream(doc, 2)).toContain(text);
    expect(doc.pageRefs.tocEntries.map((entry) => entry.page)).toEqual([2]);
  });

  it('raises its warnings once, not once per measuring pass', () => {
    const doc = makeDoc();
    leaveRoom(doc, oneLineRow(doc));
    doc.keepTogether(() =>
      doc.table(rowsOf(3), {
        columns: [
          { header: 'A', key: 'item', width: 150 },
          { header: 'B', key: 'value', width: 150 },
        ],
      }),
    );
    expect(doc.warnings.filter((warning) => warning.includes('scaled down'))).toHaveLength(1);
  });
});

describe('table cellStyle', () => {
  it('removes the weight and the slant of the level with false, and leaves them to the level without an answer', () => {
    const doc = makeDoc({ theme: createTheme({ typography: { levels: { small: { bold: true, italic: true } } } }) });
    const texts = recordTexts(doc);
    doc.table(rowsOf(1), {
      columns,
      showHead: 'never',
      cellStyle: ({ columnIndex }) => (columnIndex === 0 ? { bold: false, italic: false } : undefined),
    });
    expect(textOf(texts, 'Row 0').fontStyle).toBe('normal');
    expect(textOf(texts, '0').fontStyle).toBe('bolditalic');
  });

  it('draws the body of a table in the weight of the level', () => {
    const doc = makeDoc({ theme: createTheme({ typography: { levels: { small: { bold: true } } } }) });
    const texts = recordTexts(doc);
    doc.table(rowsOf(1), { columns, showHead: 'never' });
    expect(textOf(texts, 'Row 0').fontStyle).toBe('bold');
  });

  it('is asked about every cell, with its section and record', () => {
    const data = rowsOf(2);
    const seen: string[] = [];
    drawn(data, {
      columns,
      footRow: ['Total', 1],
      cellStyle: ({ section, rowIndex, columnIndex, column, text, row }) => {
        seen.push(`${section}:${rowIndex}:${columnIndex}:${text}`);
        expect(column).toBe(columns[columnIndex]);
        expect(row).toBe(section === 'body' ? data[rowIndex] : undefined);
        return undefined;
      },
    });
    expect(seen).toEqual([
      'head:0:0:Item',
      'head:0:1:Value',
      'body:0:0:Row 0',
      'body:0:1:0',
      'body:1:0:Row 1',
      'body:1:1:1',
      'foot:0:0:Total',
      'foot:0:1:1',
    ]);
  });

  it('is not asked about a hidden header', () => {
    const sections = new Set<string>();
    drawn(rowsOf(2), { columns, showHead: 'never', cellStyle: ({ section }) => void sections.add(section) });
    expect([...sections]).toEqual(['body']);
  });

  it('applies the color, fill and alignment it returns', () => {
    const { doc, cells, texts } = drawn([{ item: 'Refund', value: '-12' }], {
      columns,
      cellStyle: ({ section, text }) =>
        section === 'body' && text.startsWith('-') ? { color: 'error', fill: '#FFEEEE', align: 'left' } : undefined,
    });
    expectColor(textOf(texts, '-12').color, doc.theme.colors.error);
    expect(textOf(texts, '-12').align).toBe('left');
    expectColor(cells[3].fill, '#FFEEEE');
    // The other cells keep the table style.
    expectColor(textOf(texts, 'Refund').color, doc.theme.colors.text);
    expect(textOf(texts, 'Value').align).toBe('right');
  });

  it.each([
    ['head', 'Item', { bold: false }, 'normal'],
    ['body', 'Row 0', { bold: true }, 'bold'],
    ['body', 'Row 0', { italic: true }, 'italic'],
    ['foot', 'Total', { italic: true }, 'bolditalic'],
  ] as const)('restyles the %s text %s with %o', (section, text, style, fontStyle) => {
    const { texts } = drawn(rowsOf(1), {
      columns,
      footRow: ['Total', 1],
      cellStyle: (cell) => (cell.section === section ? style : undefined),
    });
    expect(textOf(texts, text).fontStyle).toBe(fontStyle);
  });

  it('throws on an invalid color', () => {
    const doc = makeDoc();
    expect(() => doc.table(rowsOf(1), { columns, cellStyle: () => ({ color: 'not-a-color' as never }) })).toThrow(
      InvalidColorError,
    );
    expect(() => doc.table(rowsOf(1), { columns, cellStyle: () => ({ fill: '#12' as never }) })).toThrow(
      InvalidColorError,
    );
  });
});
