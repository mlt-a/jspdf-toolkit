import { describe, expect, it, vi } from 'vitest';

import { COVER } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import type { DocumentOptions } from '../../src/core/document';
import { InvalidOptionError } from '../../src/core/errors';
import { resolvePageFormat } from '../../src/core/page-format';
import type { PageFormat } from '../../src/core/page-format';
import { createTheme } from '../../src/theme/defaults';
import { LONG, PNG, expectWithin, makeDoc, recordExtents, recordTexts } from './helpers';

// jsPDF converts through points: the last digits of a millimetre are noise.
const size = (doc: PDFDocument) => [doc.pageWidth, doc.pageHeight].map((side) => Math.round(side * 1e6) / 1e6);

/** The size (mm) each page of the exported file says it has. */
function pageBoxes(doc: PDFDocument): number[][] {
  const file = Buffer.from(doc.toBuffer()).toString('latin1');
  return [...file.matchAll(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(([, width, height]) => [
    (Number(width) * 25.4) / 72,
    (Number(height) * 25.4) / 72,
  ]);
}

describe('the page size', () => {
  // jsPDF keeps its sizes in points, so a millimetre is read to a tenth.
  it.each<[string, DocumentOptions, number, number]>([
    ['the default', {}, 210, 297],
    ['A3', { format: 'A3' }, 297, 420],
    ['A4', { format: 'A4' }, 210, 297],
    ['A5', { format: 'A5' }, 148, 210],
    ['letter', { format: 'letter' }, 215.9, 279.4],
    ['legal', { format: 'legal' }, 215.9, 355.6],
    ['A4 portrait', { format: 'A4', orientation: 'portrait' }, 210, 297],
    ['A3 landscape', { format: 'A3', orientation: 'landscape' }, 420, 297],
    ['A4 landscape', { format: 'A4', orientation: 'landscape' }, 297, 210],
    ['A5 landscape', { format: 'A5', orientation: 'landscape' }, 210, 148],
    ['letter landscape', { format: 'letter', orientation: 'landscape' }, 279.4, 215.9],
    ['legal landscape', { format: 'legal', orientation: 'landscape' }, 355.6, 215.9],
    ['[100, 150], as given', { format: [100, 150] }, 100, 150],
    ['[200, 120], landscape as it is wider than high', { format: [200, 120] }, 200, 120],
    ['[120, 120], square', { format: [120, 120] }, 120, 120],
    ['[100, 150] turned landscape', { format: [100, 150], orientation: 'landscape' }, 150, 100],
    ['[200, 120] turned portrait', { format: [200, 120], orientation: 'portrait' }, 120, 200],
  ])('of %s is %s x %s mm', (_, options, width, height) => {
    const [pageWidth, pageHeight] = size(makeDoc(options));
    expect(pageWidth).toBeCloseTo(width, 1);
    expect(pageHeight).toBeCloseTo(height, 1);
  });

  it('is the size of every page of the file', () => {
    const boxes = pageBoxes(
      makeDoc({ format: [100, 150] })
        .addPage()
        .addPage(),
    );
    expect(boxes).toHaveLength(3);
    for (const [width, height] of boxes) {
      expect(width).toBeCloseTo(100, 3);
      expect(height).toBeCloseTo(150, 3);
    }
  });
});

describe('an invalid format', () => {
  const invalid: Array<[string, DocumentOptions]> = [
    ['an unknown name', { format: 'tabloid' as PageFormat }],
    ['a name in another case', { format: 'a4' as PageFormat }],
    ['a name that is not a string', { format: 42 as unknown as PageFormat }],
    ['a null format', { format: null as unknown as PageFormat }],
    ['a width that is not finite', { format: [Number.NaN, 100] }],
    ['an infinite height', { format: [100, Number.POSITIVE_INFINITY] }],
    ['a zero width', { format: [0, 100] }],
    ['a zero height', { format: [100, 0] }],
    ['a negative width', { format: [-100, 100] }],
    ['a negative height', { format: [100, -1] }],
    ['a side that is not a number', { format: ['100', 200] as unknown as PageFormat }],
    ['one side', { format: [100] as unknown as PageFormat }],
    ['three sides', { format: [100, 200, 300] as unknown as PageFormat }],
    ['an empty size', { format: [] as unknown as PageFormat }],
    ['an unknown orientation', { orientation: 'diagonal' as 'portrait' }],
    ['an orientation in another case', { orientation: 'Portrait' as 'portrait' }],
  ];

  it.each(invalid)('throws an InvalidOptionError for %s', (_, options) => {
    expect(() => makeDoc(options)).toThrow(InvalidOptionError);
  });

  it('names the sizes that exist', () => {
    expect(() => makeDoc({ format: 'tabloid' as PageFormat })).toThrow(/tabloid.*'A3', 'A4', 'A5'/);
  });

  it('shows the size that was given', () => {
    expect(() => makeDoc({ format: [100, -5] })).toThrow(/\[100, -5\]/);
  });

  it('is checked before the margins, which it decides', () => {
    expect(() => resolvePageFormat([0, 0])).toThrow(InvalidOptionError);
    expect(() => makeDoc({ format: [0, 0], margins: { left: 500 } })).toThrow(/format/);
  });
});

const pages = (format: PageFormat) => {
  const doc = makeDoc({ format });
  for (let index = 0; index < 40; index++) doc.paragraph(LONG);
  return doc;
};

describe('margins and content area', () => {
  it('follow the page: the default margins on a smaller page leave a narrower content area', () => {
    const a4 = makeDoc();
    const a5 = makeDoc({ format: 'A5' });
    expect(a5.margins).toEqual(a4.margins);
    expect(a5.contentWidth).toBeCloseTo(a5.pageWidth - a5.margins.left - a5.margins.right, 6);
    expect(a5.contentWidth).toBeLessThan(a4.contentWidth);
    expect(a5.measure).toBe(a5.contentWidth);
    expect(a5.layout.bottom(a5.pageHeight)).toBeCloseTo(a5.pageHeight - a5.margins.bottom, 6);
  });

  it('check the margins against the width of the page they are on', () => {
    const margins = { left: 40, right: 40 };
    expect(() => makeDoc({ margins })).not.toThrow();
    expect(() => makeDoc({ format: 'A5', margins })).not.toThrow();
    expect(() => makeDoc({ format: [70, 100], margins })).toThrow(/Invalid margins/);
  });

  it('check the measure against the content width of the page', () => {
    expect(() => makeDoc({ measure: 160 })).not.toThrow();
    expect(() => makeDoc({ format: 'A5', measure: 160 })).toThrow(/Invalid measure/);
  });

  it('break the pages at the height of the format', () => {
    expect(pages('A5').doc.getNumberOfPages()).toBeGreaterThan(pages('A4').doc.getNumberOfPages());
    expect(pages('A3').doc.getNumberOfPages()).toBeLessThan(pages('A4').doc.getNumberOfPages());

    const doc = makeDoc({ format: [120, 120] });
    const texts = recordTexts(doc);
    for (let index = 0; index < 12; index++) doc.paragraph(LONG);
    expect(doc.doc.getNumberOfPages()).toBeGreaterThan(2);
    for (const call of texts) {
      expect(call.y).toBeLessThanOrEqual(doc.pageHeight - doc.margins.bottom);
      expect(call.y).toBeGreaterThanOrEqual(doc.margins.top);
    }
  });
});

const TABLE_COLUMNS = [
  { header: 'Item', key: 'item' },
  { header: 'Qty', key: 'qty', align: 'right' as const },
  { header: 'Price', key: 'price', align: 'right' as const },
];

/** One of each kind of block, a table, columns and a long paragraph among them, across several pages. */
function fill(doc: PDFDocument): void {
  doc.registerImage('img', PNG);
  doc
    .heading('Title', { level: 'h1', number: '1', rule: true })
    .paragraph(LONG)
    .bulletList([LONG, 'Short'])
    .infoBox(LONG, { title: 'Box', bulletPoints: [LONG] })
    .fields([
      { label: 'Status', value: LONG },
      { label: 'Owner', value: 'Jane Smith' },
    ])
    .table(
      Array.from({ length: 30 }, (_, index) => ({
        item: `${index} ${LONG.slice(0, 60)}`,
        qty: index,
        price: '€1,200',
      })),
      { columns: TABLE_COLUMNS, footRow: ['Total', 435, '€36,000'] },
    )
    .keepTogether(() =>
      doc.columns([
        (column) => column.paragraph(LONG).bulletList([LONG]),
        (column) => column.infoBox(LONG, { title: 'Box' }),
      ]),
    )
    .signatureZone([{ label: 'Client' }, { label: 'Supplier' }])
    .badge('Draft');
}

const FORMATS: Array<[string, DocumentOptions]> = [
  ['A5', { format: 'A5' }],
  ['A5 landscape', { format: 'A5', orientation: 'landscape' }],
  ['A3', { format: 'A3' }],
  ['legal', { format: 'legal' }],
  ['[120, 180] mm', { format: [120, 180] }],
  ['[250, 100] mm', { format: [250, 100] }],
];

describe.each(FORMATS)('a %s document', (_, options) => {
  it('keeps its blocks, table and columns inside the margins, on every page', () => {
    const doc = makeDoc(options);
    const extents = recordExtents(doc);
    const texts = recordTexts(doc);
    fill(doc);

    expect(doc.doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(doc.warnings).toEqual([]);
    expectWithin(extents, doc.margins.left, doc.pageWidth - doc.margins.right);
    for (const call of texts) {
      expect(call.y, call.lines[0]).toBeLessThanOrEqual(doc.pageHeight - doc.margins.bottom + 0.01);
    }
  });

  it('draws a wave cover, a back cover, a watermark and a background across the whole page', () => {
    const doc = makeDoc({ ...options, theme: createTheme({ colors: { primary: '#3572B8', background: '#F5F0E6' } }) });
    const extents = recordExtents(doc);
    const addImage = vi.spyOn(doc.doc, 'addImage') as unknown as { mock: { calls: unknown[][] } };
    const rect = vi.spyOn(doc.doc, 'rect');
    const texts = recordTexts(doc);
    doc.registerImage('img', PNG);
    doc.background('img', { allPages: true });
    doc.watermark('DRAFT', { allPages: true, fontSize: 24 });

    doc.cover('A title', { variant: 'wave', subtitle: 'A subtitle' }).paragraph('Body').backCover().finalize();

    expect(doc.doc.getNumberOfPages()).toBe(3);
    expectWithin(extents, 0, doc.pageWidth);
    // The page color fills every page, covers included, from edge to edge.
    const fills = rect.mock.calls.filter(
      ([x, y, width, height, style]) =>
        x === 0 && y === 0 && width === doc.pageWidth && height === doc.pageHeight && style === 'F',
    );
    // The first page was painted when the document was made.
    expect(fills).toHaveLength(2);
    // The background image spans the width of the page and rests on its bottom edge.
    const backgrounds = addImage.mock.calls.filter(([, x, , width]) => x === 0 && width === doc.pageWidth);
    // The first page, which the cover then covers, and the page after it: not the back cover.
    expect(backgrounds).toHaveLength(2);
    for (const [, , y, , height] of backgrounds)
      expect((y as number) + (height as number)).toBeCloseTo(doc.pageHeight, 6);
    // The watermark turns around the center of each page.
    const marks = texts.filter((call) => call.lines[0] === 'DRAFT');
    expect(marks).toHaveLength(3);
    for (const mark of marks) {
      expect(mark.x).toBeCloseTo(doc.pageWidth / 2, 6);
      expect(mark.y).toBeCloseTo(doc.pageHeight / 2, 6);
    }
  });

  it('puts the running header and footer on the margins of the format', () => {
    const doc = makeDoc(options);
    doc.pageHeader({ title: 'Report', folio: true }).pageFooter({ left: 'Left', right: '{page}/{pages}' });
    fill(doc);
    const extents = recordExtents(doc);
    const texts = recordTexts(doc);
    doc.finalize();

    expect(extents.length).toBeGreaterThan(0);
    // The letter spacing of the labels trails the last letter of a right-aligned one.
    expectWithin(extents, doc.margins.left, doc.pageWidth - doc.margins.right, 0.3);
    const footer = texts.filter((call) => call.lines[0] === 'LEFT');
    expect(footer).toHaveLength(doc.doc.getNumberOfPages());
    for (const call of footer) expect(call.y).toBeGreaterThan(doc.pageHeight - doc.margins.bottom);
    for (const call of footer) expect(call.y).toBeLessThan(doc.pageHeight);
  });

  it('wraps the title of an image cover within the share of the page width it is given', () => {
    const theme = createTheme({ assets: { covers: { plain: { color: 'text', titleX: 10, titleY: 40 } } } });
    const doc = makeDoc({ ...options, theme }).registerImage('img', PNG);
    const texts = recordTexts(doc);
    doc.cover(LONG, { variant: 'image', layout: 'plain', image: 'img' });
    expect(texts.length).toBeGreaterThan(1);
    for (const call of texts) {
      for (const width of call.widths) expect(width).toBeLessThanOrEqual(doc.pageWidth * COVER.titleWidthRatio + 0.01);
    }
  });

  it('gives every page of the file the size of the format', () => {
    const doc = makeDoc(options);
    doc.cover('Cover', { variant: 'wave' }).paragraph('Body').addPage().backCover();
    const boxes = pageBoxes(doc);
    expect(boxes).toHaveLength(4);
    for (const [width, height] of boxes) {
      expect(width).toBeCloseTo(doc.pageWidth, 3);
      expect(height).toBeCloseTo(doc.pageHeight, 3);
    }
  });
});
