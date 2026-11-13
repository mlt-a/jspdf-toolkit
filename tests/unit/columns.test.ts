import { describe, expect, it, vi } from 'vitest';

import { BOX, ICONS, LAYOUT } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import { InvalidOptionError } from '../../src/core/errors';
import { computeInfoBoxHeight, drawInfoBox } from '../../src/drawing/boxes';
import type { Column } from '../../src/drawing/columns';
import { columnWidth, drawColumns } from '../../src/drawing/columns';
import { computeDeclarationsBoxHeight, drawDeclarationsBox } from '../../src/drawing/declarations';
import { computeParagraphHeight, drawParagraph, measureTextLevel } from '../../src/drawing/text';
import {
  LONG,
  PNG,
  currentPage,
  expectDrawnHeight,
  expectTextWithin,
  expectWithin,
  frameOf,
  lastText,
  leaveRoom,
  makeDoc,
  recordExtents,
  recordTexts,
  textOf,
  titleY,
} from './helpers';

type Placement = { x: number; width: number; y: number };

/** A column that notes where it was drawn and advances Y by `height`. */
function probe(placements: Placement[], height = 0): Column {
  return (ctx, x, width) => {
    placements.push({ x, width, y: ctx.getYPos() });
    ctx.setYPos(ctx.getYPos() + height);
  };
}

/** A column whose first block is the heading `title`. */
const firstHeading =
  (title: string): Column =>
  (ctx) => {
    ctx.heading(title, { level: 'h3' }).paragraph('Body');
  };

/** A column whose last block is a heading, left waiting for a block that never comes. */
const endsWithHeading: Column = (ctx) => {
  ctx.paragraph('Left').heading('End', { level: 'h3' });
};

/** Left edge and width (mm) of column `index` of `count`, as `columns` splits the content width. */
function columnBox(doc: PDFDocument, index: number, count: number, gap = LAYOUT.columnGap) {
  const width = columnWidth(doc.contentWidth, count, gap);
  return { left: doc.margins.left + index * (width + gap), width };
}

describe('drawColumns', () => {
  it('splits the content width into equal columns, LAYOUT.columnGap apart', () => {
    const doc = makeDoc();
    const placements: Placement[] = [];
    drawColumns(doc, [probe(placements), probe(placements), probe(placements)]);
    const width = (doc.contentWidth - 2 * LAYOUT.columnGap) / 3;
    expect(placements.map((p) => p.width)).toEqual([width, width, width]);
    expect(placements[0].x).toBe(doc.margins.left);
    expect(placements[1].x).toBeCloseTo(doc.margins.left + width + LAYOUT.columnGap, 6);
    expect(placements[2].x).toBeCloseTo(doc.margins.left + 2 * (width + LAYOUT.columnGap), 6);
    // The last column ends on the right margin.
    expect(placements[2].x + placements[2].width).toBeCloseTo(doc.margins.left + doc.contentWidth, 6);
  });

  it('takes the gap option instead of the default one', () => {
    const doc = makeDoc();
    const placements: Placement[] = [];
    drawColumns(doc, [probe(placements), probe(placements)], { gap: 4 });
    expect(placements[0].width).toBeCloseTo((doc.contentWidth - 4) / 2, 6);
    expect(placements[1].x - (placements[0].x + placements[0].width)).toBeCloseTo(4, 6);
  });

  it('gives a single column the whole content width', () => {
    const doc = makeDoc();
    const placements: Placement[] = [];
    drawColumns(doc, [probe(placements)]);
    expect(placements).toEqual([{ x: doc.margins.left, width: doc.contentWidth, y: doc.firstPageTop }]);
  });

  it('starts every column at the Y the block began at, whatever the one before it drew', () => {
    const doc = makeDoc();
    const placements: Placement[] = [];
    const startY = doc.getYPos();
    drawColumns(doc, [probe(placements, 30), probe(placements, 5), probe(placements)]);
    expect(placements.map((p) => p.y)).toEqual([startY, startY, startY]);
  });

  it('returns the Y under the tallest column, plus theme.spacing.block unless spaceAfter says otherwise', () => {
    const doc = makeDoc();
    const startY = doc.getYPos();
    const end = drawColumns(doc, [probe([], 12), probe([], 30), probe([], 8)]);
    expect(end).toBeCloseTo(startY + 30 + doc.theme.spacing.block, 6);
    expect(doc.getYPos()).toBe(end);
    expect(drawColumns(doc, [probe([], 12), probe([], 30)], { spaceAfter: 0 })).toBeCloseTo(end + 30, 6);
  });

  it('leaves one space under the columns, not the one of their last block on top of it', () => {
    const doc = makeDoc();
    const startY = doc.getYPos();
    const end = drawColumns(doc, [(ctx) => ctx.paragraph('Left', { spaceAfter: 9 }), probe([], 1)], { spaceAfter: 3 });
    expect(end).toBeCloseTo(startY + measureTextLevel(doc, 'body').lineHeight + 3, 6);
    expect(doc.contentBottom()).toBeCloseTo(end - 3, 6);
  });

  it('ends under the tallest column of blocks, with one space after', () => {
    const doc = makeDoc();
    doc.paragraph('Intro');
    const top = doc.getYPos();
    doc.columns([(column) => column.paragraph('Short.'), (column) => column.paragraph(LONG)]);

    const reference = makeDoc();
    reference.paragraph('Intro');
    reference.columns([() => {}, (column) => column.paragraph(LONG, { spaceAfter: 0 })], { spaceAfter: 0 });
    expect(doc.getYPos() - top).toBeCloseTo(reference.getYPos() - top + doc.theme.spacing.block, 6);
  });

  it('opens every column as the block above left the position: a first heading collapses into its space', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const { block, heading } = doc.theme.spacing;
    doc.paragraph('Intro');
    const top = doc.getYPos();
    drawColumns(doc, [firstHeading('Left'), firstHeading('Right')]);
    const expected = top + heading.h3.before - block + measureTextLevel(doc, 'h3').ascent;
    expect(titleY(texts, 'Left')).toBeCloseTo(expected, 6);
    expect(titleY(texts, 'Right')).toBeCloseTo(expected, 6);
  });

  it('adds no space above the first heading of columns at the top of a page', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    drawColumns(doc, [firstHeading('Left'), firstHeading('Right')]);
    const expected = doc.firstPageTop + measureTextLevel(doc, 'h3').ascent;
    expect(titleY(texts, 'Left')).toBeCloseTo(expected, 6);
    expect(titleY(texts, 'Right')).toBeCloseTo(expected, 6);
  });

  it('draws a heading that ends a column in that column, not at the top of the next one', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const placements: Placement[] = [];
    const top = doc.getYPos();
    drawColumns(doc, [probe([]), endsWithHeading, probe(placements)]);
    const end = textOf(texts, 'End');
    expect(end.y).toBeGreaterThan(top);
    expect(end.x).toBeCloseTo(columnBox(doc, 1, 3).left, 6);
    expect(placements[0].y).toBe(top);
  });

  it('draws a heading waiting above the columns where it stands, across the page', () => {
    const doc = makeDoc();
    const line = vi.spyOn(doc.doc, 'line');
    doc.heading('Above', { level: 'h2', rule: true });
    doc.columns([(column) => column.paragraph('Left'), (column) => column.paragraph('Right')]);
    const [x1, , x2] = line.mock.calls[0];
    expect(x1).toBe(doc.margins.left);
    expect(x2).toBeCloseTo(doc.margins.left + doc.measure, 6);
  });

  it('never moves the position back above the columns when they draw nothing in the flow', () => {
    const doc = makeDoc();
    doc.heading('Title');
    const top = doc.getYPos();
    const end = drawColumns(doc, [(column, x, width) => column.doc.rect(x, column.getYPos(), width, 10), () => {}], {
      spaceAfter: 0,
    });
    expect(end).toBeCloseTo(top, 6);
  });

  it('leaves the position and the space above alone when no column draws', () => {
    const doc = makeDoc();
    doc.paragraph('Intro', { spaceAfter: 3 });
    const y = doc.peekYPos();
    const bottom = doc.contentBottom();
    expect(drawColumns(doc, [probe([]), probe([])])).toBe(y);
    expect(doc.peekYPos()).toBe(y);
    expect(doc.contentBottom()).toBe(bottom);
  });

  it('leaves the position, and the headings waiting for a block, alone when there is no column', () => {
    // Under some content: `addSpace` does nothing at the top of a page, which would hide added space.
    const doc = makeDoc();
    doc.paragraph('Body').heading('Waiting');
    const startY = doc.peekYPos();
    expect(drawColumns(doc, [])).toBe(startY);
    // `getYPos` places the waiting heading and moves the position: it must not have been called.
    expect(doc.peekYPos()).toBe(startY);
  });
});

const INTRO = { intro: 'Intro' };

/** A block in a column: its computed height, and the check that drawing it advances Y by that height. */
const MEASURED: [string, (ctx: PDFDocument) => number, (ctx: PDFDocument) => unknown][] = [
  [
    'paragraph',
    (d) => computeParagraphHeight(d, LONG),
    (d) => expectDrawnHeight(computeParagraphHeight, drawParagraph, LONG, { spaceAfter: 0 }, d),
  ],
  [
    'infoBox',
    (d) => computeInfoBoxHeight(d, LONG, { title: 'Title' }),
    (d) => expectDrawnHeight(computeInfoBoxHeight, drawInfoBox, LONG, { title: 'Title', spaceAfter: 0 }, d),
  ],
  [
    'declarationsBox',
    (d) => computeDeclarationsBoxHeight(d, [{ text: LONG }], INTRO),
    (d) =>
      expectDrawnHeight(
        computeDeclarationsBoxHeight,
        drawDeclarationsBox,
        [{ text: LONG }],
        { ...INTRO, spaceAfter: 0 },
        d,
      ),
  ],
];

/** What `finalize` draws, the running header and footer, when it is called from a column or after the columns. */
function drawFinalized(inColumn: boolean) {
  const doc = makeDoc();
  doc.pageHeader({ title: 'Report', folio: true }).pageFooter({ left: 'Left', right: '{page}/{pages}' });
  doc.paragraph('Body');
  const extents = recordExtents(doc);
  const texts = recordTexts(doc);
  doc.columns([() => {}, (column) => (inColumn ? column.finalize() : undefined)]);
  doc.finalize();
  return { extents, texts };
}

const boom: Column = () => {
  throw new Error('boom');
};

describe('the frame of a column', () => {
  it('narrows margins, contentWidth and measure to the column, and gives the page frame back after', () => {
    const doc = makeDoc();
    const page = frameOf(doc);
    const pageMargins = doc.margins;
    const seen: ReturnType<typeof frameOf>[] = [];
    const look: Column = (column) => {
      expect(Object.isFrozen(column.margins)).toBe(true);
      // One object for the whole column.
      expect(column.margins).toBe(column.margins);
      seen.push(frameOf(column));
    };

    doc.columns([look, look]);

    seen.forEach((frame, index) => {
      const { left, width } = columnBox(doc, index, 2);
      expect(frame.margins.left).toBeCloseTo(left, 6);
      expect(frame.margins.right).toBeCloseTo(doc.pageWidth - left - width, 6);
      expect(frame.contentWidth).toBeCloseTo(width, 6);
      expect(frame.measure).toBeCloseTo(width, 6);
      // The page geometry stays: the top and the footer zone are the page's.
      expect(frame.margins.top).toBe(page.margins.top);
      expect(frame.margins.bottom).toBe(page.margins.bottom);
    });
    expect(frameOf(doc)).toEqual(page);
    expect(doc.margins).toBe(pageMargins);
  });

  it('follows a pageHeader declared in the column with the top of its margins', () => {
    const doc = makeDoc({ margins: { top: 10 } });
    const tops: number[] = [];
    doc.columns([
      (column) => {
        const { margins } = column;
        tops.push(margins.top);
        column.pageHeader({ title: 'Report' });
        tops.push(margins.top, column.margins.top);
      },
    ]);
    expect(tops[0]).toBe(10);
    expect(tops[1]).toBeGreaterThan(10);
    expect(tops[1]).toBe(doc.margins.top);
    expect(tops[2]).toBe(tops[1]);
  });

  it('finalizes with the page frame, even from inside a column', () => {
    const inColumn = drawFinalized(true);
    expect(inColumn.texts.length).toBeGreaterThan(0);
    expect(inColumn).toEqual(drawFinalized(false));
  });

  it('keeps the measure option in a column wider than it', () => {
    const doc = makeDoc({ measure: 60 });
    const measures: number[] = [];
    doc.columns([(column) => measures.push(column.measure)]);
    doc.columns([(column) => measures.push(column.measure), () => {}, () => {}, () => {}]);
    expect(measures[0]).toBe(60);
    expect(measures[1]).toBeCloseTo(columnBox(doc, 0, 4).width, 6);
    expect(doc.measure).toBe(60);
  });

  it('nests: a column of a column splits that column', () => {
    const doc = makeDoc();
    const outer = columnBox(doc, 1, 2);
    const inner: { left: number; width: number }[] = [];
    doc.columns([
      () => {},
      (column) => {
        column.columns([
          (nested) => inner.push({ left: nested.margins.left, width: nested.contentWidth }),
          (nested) => inner.push({ left: nested.margins.left, width: nested.contentWidth }),
        ]);
        // The outer column frame is back after the nested columns.
        expect(column.margins.left).toBeCloseTo(outer.left, 6);
        expect(column.contentWidth).toBeCloseTo(outer.width, 6);
      },
    ]);
    const width = (outer.width - LAYOUT.columnGap) / 2;
    expect(inner[0]).toEqual({ left: outer.left, width });
    expect(inner[1].left).toBeCloseTo(outer.left + width + LAYOUT.columnGap, 6);
    expect(inner[1].width).toBeCloseTo(width, 6);
  });

  it('gives the page frame back when a column throws, nested or not', () => {
    const doc = makeDoc();
    const page = frameOf(doc);
    expect(() => doc.columns([boom])).toThrow('boom');
    expect(() => doc.columns([(column) => column.columns([() => {}, boom])])).toThrow('boom');
    expect(frameOf(doc)).toEqual(page);
  });

  it('decorates a page added from inside a column with the page geometry, and goes on in the column', () => {
    const doc = makeDoc();
    const page = frameOf(doc);
    const seen: (typeof page)[] = [];
    doc.onNewPage(() => seen.push(frameOf(doc)));
    let after = 0;
    doc.columns([
      () => {},
      (column) => {
        column.addPage();
        after = column.contentWidth;
      },
    ]);
    expect(seen).toEqual([page]);
    expect(after).toBeCloseTo(columnBox(doc, 1, 2).width, 6);
  });

  it.each(MEASURED)(
    'measures %s with the column width: the height computed in the column is the height drawn there',
    (_, height, expectDrawn) => {
      const doc = makeDoc();
      let inColumn = 0;
      doc.columns([
        () => {},
        (column) => {
          inColumn = height(column);
          expectDrawn(column);
        },
      ]);
      // Narrower than on the page: the text wraps to more lines.
      expect(inColumn).toBeGreaterThan(height(doc));
    },
  );
});

const TABLE_COLUMNS = [
  { header: 'Item', key: 'item' },
  { header: 'Qty', key: 'qty', align: 'right' as const },
  { header: 'Price', key: 'price', align: 'right' as const },
];

// Each flow block drawn through the document passed to a column.
const BLOCKS: [string, Column][] = [
  ['heading', (c) => c.heading('Column title', { level: 'h2', number: '1', rule: true }).paragraph('Body')],
  ['heading that ends the column', (c) => c.heading('Last title', { level: 'h3' })],
  ['paragraph', (c) => c.paragraph(LONG)],
  ['paragraph, justified', (c) => c.paragraph(LONG, { align: 'justify' })],
  ['paragraphs', (c) => c.paragraphs([LONG, 'Short.'])],
  ['richText', (c) => c.richText(`A **bold** and *italic* [link](https://example.com) text. ${LONG}`)],
  ['richBlocks', (c) => c.richBlocks([{ type: 'bulletList', items: [[{ text: LONG }], [{ text: 'Two' }]] }])],
  ['separator', (c) => c.separator()],
  ['bulletList', (c) => c.bulletList([LONG, { text: 'Two', subItems: [LONG], detail: LONG }])],
  ['numberedList', (c) => c.numberedList([LONG, 'Two'])],
  ['iconList', (c) => c.iconList([LONG, 'Two'], { icon: 'img' })],
  ['checkbox', (c) => c.checkbox('Terms accepted', { variant: 'checked' })],
  ['inlineQuestion', (c) => c.inlineQuestion('Has the training been completed?', { answer: 'yes' })],
  [
    'fields, stacked',
    (c) =>
      c.fields([
        { label: 'Status', value: LONG, highlight: true, complement: 'Since May' },
        { label: 'Owner', value: 'Jane Smith' },
      ]),
  ],
  ['fields, inline', (c) => c.fields([{ label: 'Status', value: LONG }], { layout: 'inline' })],
  ['fields, leader', (c) => c.fields([{ label: 'Total', value: '€1,200', highlight: true }], { layout: 'leader' })],
  ['fieldRows', (c) => c.fieldRows([[{ label: 'A', value: LONG }], [{ label: 'C', value: 'd' }]])],
  ['infoBox, surface', (c) => c.infoBox(LONG, { title: 'Title', bulletPoints: [LONG], icon: 'img' })],
  ['infoBox, callout', (c) => c.infoBox(LONG, { variant: 'callout', eyebrow: 'Note', title: 'Title' })],
  [
    'declarationsBox',
    (c) =>
      c.declarationsBox([{ text: LONG, highlights: [{ text: 'binding commitment', strong: true }] }], {
        intro: 'The company declares:',
        icon: 'img',
      }),
  ],
  ['declarationsBox, bullets', (c) => c.declarationsBox([{ text: LONG }, { text: 'Two' }], { bullet: true })],
  [
    'addressBlock',
    (c) =>
      c.addressBlock([
        { text: 'Acme Corp', role: 'title' },
        { text: 'Technology Division', role: 'subtitle' },
        { text: '42 Innovation Avenue', role: 'address' },
      ]),
  ],
  [
    'signatureZone',
    (c) =>
      c.signatureZone([{ label: 'Client', sublabel: 'Jane Smith, CEO', image: 'img' }, { label: 'Supplier' }], {
        caption: 'Signed in London on May 22, 2026',
      }),
  ],
  [
    'table',
    (c) =>
      c.table(
        [
          { item: 'Consulting', qty: 2, price: '€1,200' },
          { item: LONG, qty: 1, price: '€90' },
        ],
        { columns: TABLE_COLUMNS, footRow: ['Total', 3, '€1,290'] },
      ),
  ],
  ['badge', (c) => c.badge('Draft')],
  ['logo', (c) => c.logo('img', { height: 8 })],
  [
    'headerColumns',
    (c) =>
      c.headerColumns([
        { title: 'Seller', fields: [{ label: 'Name', value: 'Acme Corp, 42 Innovation Avenue' }] },
        { title: 'Buyer', fields: [{ label: 'Name', value: 'Globex' }] },
      ]),
  ],
  ['columns', (c) => c.columns([(n) => n.paragraph(LONG), (n) => n.bulletList([LONG])])],
];

describe('blocks in a column', () => {
  it.each(BLOCKS)('%s draws inside its column, under the top of the columns', (_, block) => {
    const doc = makeDoc();
    doc.registerImage('img', PNG);
    doc.paragraph('Intro');
    const top = doc.getYPos();
    const { left, width } = columnBox(doc, 1, 2);
    const extents = recordExtents(doc);
    const texts = recordTexts(doc);

    doc.columns([() => {}, block]);

    expectWithin(extents, left, left + width);
    for (const extent of extents) expect(extent.page, extent.what).toBe(1);
    for (const call of texts) expect(call.y).toBeGreaterThan(top);
    expect(doc.getYPos()).toBeGreaterThan(top);
    expect(doc.warnings).toEqual([]);
  });

  it('wraps a paragraph to its column and draws it at the column X', () => {
    const doc = makeDoc();
    const { left, width } = columnBox(doc, 1, 2);
    const texts = recordTexts(doc);
    doc.columns([() => {}, (column) => column.paragraph(LONG)]);
    expect(texts.length).toBeGreaterThan(3);
    for (const call of texts) expect(call.x).toBeCloseTo(left, 6);
    expectTextWithin(texts, left, left + width);
  });

  it('sizes a table to its column', () => {
    const doc = makeDoc();
    const { left, width } = columnBox(doc, 0, 2);
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.columns([(column) => column.table([{ item: 'A', qty: 1, price: '€1' }], { columns: TABLE_COLUMNS }), () => {}]);
    const xs = rect.mock.calls.map(([x, , w]) => [x as number, (x as number) + (w as number)]);
    expect(Math.min(...xs.map(([from]) => from))).toBeCloseTo(left, 6);
    expect(Math.max(...xs.map(([, to]) => to))).toBeLessThanOrEqual(left + width + 0.01);
  });
});

const PARAGRAPHS = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}`);
/** A column that runs onto the next page from near the bottom of the first one. */
const RUNS_OVER: Column = (column) => column.paragraphs(PARAGRAPHS);
const SECOND: Column = (column) => column.paragraph('Second column');

/** A document with `room` mm left on its first page, recording the texts drawn from now on. */
function nearPageEnd(room = 20) {
  const doc = leaveRoom(makeDoc(), room);
  return { doc, texts: recordTexts(doc) };
}

describe('a page break in a column', () => {
  it('goes on in the column on the new page, warns, and ends on that page', () => {
    const { doc, texts } = nearPageEnd();
    const { left } = columnBox(doc, 0, 2);
    doc.columns([RUNS_OVER, SECOND]);

    expect(doc.doc.getNumberOfPages()).toBe(2);
    const last = textOf(texts, 'Paragraph 12');
    expect(last.page).toBe(2);
    expect(last.x).toBeCloseTo(left, 6);
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toContain('keepTogether');
    // The end position belongs to the page the document is on, not to the first page.
    expect(currentPage(doc)).toBe(2);
    expect(doc.contentBottom()).toBeGreaterThanOrEqual(last.y);
    expect(doc.getYPos()).toBeLessThanOrEqual(doc.layout.bottom(doc.pageHeight) + doc.theme.spacing.block);
  });

  it('warns once for nested columns', () => {
    const { doc } = nearPageEnd();
    doc.columns([(column) => column.columns([RUNS_OVER, SECOND]), SECOND]);
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toContain('keepTogether');
  });

  it('warns once for an inset in a column: the inset is still in the column', () => {
    const { doc, texts } = nearPageEnd();
    doc.columns([(column) => column.inset({ left: 5 }, () => RUNS_OVER(column, 0, 0)), SECOND]);
    expect(textOf(texts, 'Paragraph 12').page).toBe(2);
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toContain('keepTogether');
  });

  it('starts the columns after it at the top of the new page', () => {
    const { doc, texts } = nearPageEnd();
    doc.columns([RUNS_OVER, SECOND]);
    const second = textOf(texts, 'Second column');
    expect(second.page).toBe(2);
    expect(second.x).toBeCloseTo(columnBox(doc, 1, 2).left, 6);
    expect(second.y).toBeCloseTo(doc.layout.topFor(2) + measureTextLevel(doc, 'body').ascent, 6);
  });

  it('starts the columns after it where the start of the page left the position, under the hook', () => {
    const { doc, texts } = nearPageEnd();
    doc.onNewPage(() => {
      doc.setYPos(doc.getYPos() + 15);
    });
    doc.columns([RUNS_OVER, SECOND, (column) => column.paragraph('Third column')]);
    const onSecondPage = texts.filter((call) => call.page === 2);
    const first = onSecondPage.find((call) => call.lines[0].startsWith('Paragraph'))!;
    const bodyTop = doc.layout.topFor(2) + 15 + measureTextLevel(doc, 'body').ascent;
    expect(first.y).toBeCloseTo(bodyTop, 6);
    expect(lastText(texts, 'Second column').y).toBeCloseTo(first.y, 6);
    expect(lastText(texts, 'Third column').y).toBeCloseTo(first.y, 6);
  });

  it('ends under the lowest column on the last page, a column that ended earlier aside', () => {
    const { doc, texts } = nearPageEnd();
    doc.columns([(column) => column.paragraph('Fits'), RUNS_OVER], { spaceAfter: 0 });
    const last = textOf(texts, 'Paragraph 12');
    const { lineHeight, ascent } = measureTextLevel(doc, 'body');
    expect(currentPage(doc)).toBe(2);
    // Only the second column reached page 2: the first one's Y, on page 1, is lower but does not count.
    expect(doc.getYPos()).toBeCloseTo(last.y - ascent + lineHeight, 6);
  });

  it('continues a table of a column on the next page, in that column', () => {
    const { doc, texts } = nearPageEnd(30);
    const rows = Array.from({ length: 12 }, (_, index) => ({ item: `Row ${index + 1}`, qty: index, price: '€1' }));
    doc.columns([() => {}, (column) => column.table(rows, { columns: TABLE_COLUMNS })]);
    const last = textOf(texts, 'Row 12');
    expect(last.page).toBe(2);
    expect(last.x).toBeGreaterThan(columnBox(doc, 1, 2).left);
    expect(doc.warnings.join(' ')).toContain('keepTogether');
  });

  it('raises no warning when the columns fit', () => {
    const doc = makeDoc();
    doc.columns([(column) => column.paragraph('One'), (column) => column.paragraph('Two')]);
    expect(doc.warnings).toEqual([]);
  });

  it('is avoided by keepTogether: the columns move to the next page whole, without a warning', () => {
    const { doc, texts } = nearPageEnd();
    doc.keepTogether(() => {
      doc.columns([RUNS_OVER, SECOND]);
    });
    // The last calls: the measuring passes of `keepTogether` draw on scratch pages first.
    const first = lastText(texts, 'Paragraph 1');
    const second = lastText(texts, 'Second column');
    expect(first.page).toBe(2);
    expect(second.page).toBe(2);
    expect(second.y).toBeCloseTo(first.y, 6);
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(doc.warnings).toEqual([]);
    // The page frame is back after the measuring passes.
    expect(frameOf(doc)).toEqual(frameOf(makeDoc()));
  });

  it('keepTogether in a column keeps a block of that column together', () => {
    const { doc, texts } = nearPageEnd(12);
    doc.columns([
      (column) => column.keepTogether(() => column.heading('Kept', { level: 'h3' }).paragraphs(PARAGRAPHS.slice(0, 3))),
      () => {},
    ]);
    const kept = lastText(texts, 'Kept');
    expect(kept.page).toBe(2);
    expect(kept.x).toBeCloseTo(columnBox(doc, 0, 2).left, 6);
  });

  it('warns once, for the columns() call, when a keepTogether in a column moves its block to the next page', () => {
    const { doc } = nearPageEnd(12);
    doc.columns([
      (column) => column.keepTogether(() => column.heading('Kept', { level: 'h3' }).paragraphs(PARAGRAPHS.slice(0, 3))),
      () => {},
    ]);
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toContain('Wrap the whole columns() call in keepTogether()');
  });

  it('restarts the columns after a page break of a measuring pass from the top of the new page', () => {
    const doc = makeDoc();
    // The hook shifts every real page: a stale `startedAt` would start the second column 15 mm lower.
    doc.onNewPage(() => {
      doc.setYPos(doc.getYPos() + 15);
    });
    doc.addPage();
    leaveRoom(doc, 20);
    const texts = recordTexts(doc);
    doc.keepTogether(() => {
      doc.columns([RUNS_OVER, SECOND]);
    });
    // The first call is the measuring pass from the current position, which breaks the page in the first column.
    const measured = textOf(texts, 'Second column');
    expect(measured.y).toBeCloseTo(doc.layout.topFor(2) + measureTextLevel(doc, 'body').ascent, 6);
  });
});

describe('invalid widths', () => {
  const TEXT = [{ text: 'Statement' }];

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('declarationsBox throws in an inset of width %s', (width) => {
    const doc = makeDoc();
    expect(() => doc.inset({ width }, () => drawDeclarationsBox(doc, TEXT))).toThrow(InvalidOptionError);
    expect(() => doc.inset({ width }, () => computeDeclarationsBoxHeight(doc, TEXT))).toThrow(InvalidOptionError);
  });

  it.each([
    ['the padding takes the whole width', { width: BOX.padding * 2 }, undefined],
    ['the padding takes more than the width', { width: BOX.padding * 2 - 1 }, undefined],
    ['the padding and the icon take the whole width', { width: BOX.padding * 2 + ICONS.size }, 'mark'],
  ])('declarationsBox throws when %s', (_, inset, icon) => {
    const doc = makeDoc();
    doc.registerImage('mark', PNG);
    const draw = () => doc.inset(inset, () => drawDeclarationsBox(doc, TEXT, { icon }));
    expect(draw).toThrow(InvalidOptionError);
    expect(draw).toThrow(/text width/);
  });

  it('declarationsBox accepts the narrowest width that leaves some text width', () => {
    const doc = makeDoc();
    expect(() => doc.inset({ width: BOX.padding * 2 + 1 }, () => drawDeclarationsBox(doc, TEXT))).not.toThrow();
  });

  const CONTENT_WIDTH = makeDoc().contentWidth;
  it.each([
    ['the gap is the content width', 2, CONTENT_WIDTH],
    ['the gap is wider than the content', 2, CONTENT_WIDTH + 20],
    ['the gap is not a number', 2, Number.NaN, /columns gap/],
    [
      'there are too many of them for the gap',
      Math.ceil(CONTENT_WIDTH / LAYOUT.columnGap) + 1,
      LAYOUT.columnGap,
      /column width/,
    ],
  ])(
    'columns throw when %s, before any column draws or the frame changes',
    (_, count, gap, message = /column width/) => {
      const doc = makeDoc();
      const draw = vi.fn();
      expect(() =>
        doc.columns(
          Array.from({ length: count }, () => draw),
          { gap },
        ),
      ).toThrow(InvalidOptionError);
      expect(() =>
        doc.columns(
          Array.from({ length: count }, () => draw),
          { gap },
        ),
      ).toThrow(message);
      expect(draw).not.toHaveBeenCalled();
      expect(frameOf(doc)).toEqual(frameOf(makeDoc()));
    },
  );
});

/** The PDF of `doc`, finalized, without its creation date and file identifier, which change on every run. */
const pdfOf = (doc: PDFDocument) =>
  Buffer.from(doc.toBuffer())
    .toString('latin1')
    .replace(/\/CreationDate \(D:[^)]*\)/g, '')
    .replace(/\/ID \[[^\]]*\]/g, '');

// The public calls that declare or draw something at the scale of the page, not in the flow. A logo placed from its
// page corner is one; a logo in the flow and `closingNote`, which wraps to the frame it closes, are not.
const PAGE_CALLS: Array<[name: string, call: (doc: PDFDocument) => unknown]> = [
  ['pageHeader', (d) => d.pageHeader({ title: 'Report', folio: true })],
  ['pageFooter', (d) => d.pageFooter({ left: 'Left', right: '{page}/{pages}', logo: 'img' })],
  ['pageFooter(false)', (d) => d.pageFooter(false)],
  ['watermark', (d) => d.watermark('DRAFT')],
  ['watermark on every page', (d) => d.watermark('DRAFT', { allPages: true })],
  ['background', (d) => d.background('img')],
  ['background on every page', (d) => d.background('img', { allPages: true })],
  ['tableOfContents', (d) => d.tableOfContents({ title: 'Contents', intro: 'Intro' })],
  ['logo from a page corner', (d) => d.logo('img', { y: 12 })],
  ['logo from the bottom right corner', (d) => d.logo('img', { anchor: 'bottom-right' })],
  ['cover', (d) => d.cover('Title', { variant: 'wave', subtitle: 'Sub' })],
  ['backCover', (d) => d.backCover({ contact: { lines: ['Contact'] }, legalText: 'Legal' })],
  ['finalize', (d) => d.finalize()],
];

describe.each([
  ['under a paragraph', (doc: PDFDocument) => doc.heading('Opening').paragraph('Opening text.')],
  ['on a fresh page', () => {}],
])('page-level calls from a column, %s', (_start, open) => {
  it.each(PAGE_CALLS)('%s renders the same PDF as when called just before the columns', (_name, call) => {
    const render = (inColumn: boolean) => {
      const doc = makeDoc({ margins: { left: 25, right: 15 }, compress: false });
      doc.registerImage('img', PNG);
      open(doc);
      if (!inColumn) call(doc);
      // From the middle column: neither of its edges is on a page margin.
      doc.columns([() => {}, (column) => (inColumn ? call(column) : undefined), () => {}]);
      doc.heading('After').paragraph('After the columns.');
      return pdfOf(doc);
    };
    expect(render(true)).toBe(render(false));
  });
});

describe.each([
  ['under a paragraph', (doc: PDFDocument) => doc.heading('Opening').paragraph('Opening text.')],
  ['on a fresh page', () => {}],
])('page-level calls from an inset, %s', (_start, open) => {
  it.each(PAGE_CALLS)('%s renders the same PDF as when called just before the inset', (_name, call) => {
    const render = (inInset: boolean) => {
      const doc = makeDoc({ margins: { left: 25, right: 15 }, compress: false });
      doc.registerImage('img', PNG);
      open(doc);
      if (!inInset) call(doc);
      // Neither edge of the inset is on a page margin.
      doc.inset({ left: 20, right: 30 }, () => (inInset ? call(doc) : undefined));
      doc.heading('After').paragraph('After the inset.');
      return pdfOf(doc);
    };
    expect(render(true)).toBe(render(false));
  });
});
