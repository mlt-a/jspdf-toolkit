import { describe, expect, it, vi } from 'vitest';

import { LAYOUT } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import { InvalidOptionError } from '../../src/core/errors';
import type { InsetOptions } from '../../src/core/inset';
import { columnWidth } from '../../src/drawing/columns';
import { measureTextLevel } from '../../src/drawing/text';
import {
  expectRejectedBeforeDrawing,
  expectTextWithin,
  frameOf,
  inInset,
  lastText,
  leaveRoom,
  makeDoc,
  recordTexts,
  textOf,
} from './helpers';

/** Margins chosen apart, so a frame measured from the wrong edge shows. */
const docOnMargins = () => makeDoc({ margins: { left: 25, right: 15 } });

/** Width (mm) of the content area between those margins: jsPDF's A4 is a little over 210 mm wide. */
const W = docOnMargins().contentWidth;

const PARAGRAPHS = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}`);
const TABLE_COLUMNS = [
  { header: 'Item', key: 'item' },
  { header: 'Qty', key: 'qty', align: 'right' as const },
];

const bodyLine = (doc: PDFDocument) => measureTextLevel(doc, 'body').lineHeight;
const headingBlock = (doc: PDFDocument) => measureTextLevel(doc, 'h2').lineHeight + doc.theme.spacing.heading.h2.after;

describe('inset options', () => {
  // [options, left offset, width], in mm of the frame between margins of 25 and 15 mm.
  it.each<[InsetOptions, number, number]>([
    [{}, 0, W],
    [{ left: 20 }, 20, W - 20],
    [{ right: 30 }, 0, W - 30],
    [{ width: 60 }, 0, 60],
    [{ left: 20, right: 30 }, 20, W - 50],
    [{ left: 20, width: 60 }, 20, 60],
    [{ right: 30, width: 60 }, W - 90, 60],
  ])('%o opens a frame %s mm from the left edge, %s mm wide', (options, left, width) => {
    const doc = docOnMargins();
    const frame = inInset(doc, options, () => frameOf(doc));
    expect(frame.margins.left).toBeCloseTo(25 + left, 6);
    expect(frame.margins.right).toBeCloseTo(doc.pageWidth - 25 - left - width, 6);
    expect(frame.contentWidth).toBeCloseTo(width, 6);
    expect(frame.measure).toBeCloseTo(width, 6);
    expect(frame.margins.top).toBe(doc.margins.top);
    expect(frame.margins.bottom).toBe(doc.margins.bottom);
    expect(doc.warnings).toEqual([]);
  });

  it('anchors right and width to the right edge of the frame', () => {
    const doc = docOnMargins();
    const frame = inInset(doc, { right: 10, width: 50 }, () => frameOf(doc));
    expect(frame.margins.right).toBeCloseTo(doc.margins.right + 10, 6);
    expect(frame.margins.left + frame.contentWidth).toBeCloseTo(doc.pageWidth - doc.margins.right - 10, 6);
  });

  it.each<[InsetOptions, number, number, string]>([
    [{ width: 500 }, 0, W, `(${W.toFixed(1)} mm)`],
    [{ left: 20, width: 500 }, 20, W - 20, `(${(W - 20).toFixed(1)} mm, the frame width less the 20.0 mm of left)`],
    [{ right: 30, width: 500 }, 0, W - 30, `(${(W - 30).toFixed(1)} mm, the frame width less the 30.0 mm of right)`],
  ])(
    'brings %o down to the room the frame leaves, and says in the words of the inset what reduces it',
    (options, left, width, room) => {
      const doc = docOnMargins();
      const frame = inInset(doc, options, () => frameOf(doc));
      expect(frame.margins.left).toBeCloseTo(25 + left, 6);
      expect(frame.contentWidth).toBeCloseTo(width, 6);
      expect(doc.warnings).toEqual([
        `inset width of 500.0 mm is wider than the available width ${room}: it is brought down to fit`,
      ]);
    },
  );

  it('keeps the measure of the frame around it when the inset is wider', () => {
    const doc = makeDoc({ measure: 100 });
    expect(inInset(doc, { left: 10 }, () => frameOf(doc)).measure).toBe(100);
    expect(inInset(doc, { right: 10 }, () => frameOf(doc)).measure).toBe(100);
    expect(inInset(doc, {}, () => frameOf(doc)).measure).toBe(100);
    expect(inInset(doc, { left: 10 }, () => frameOf(doc)).contentWidth).toBeCloseTo(doc.contentWidth - 10, 6);
    expect(inInset(doc, { width: 80 }, () => frameOf(doc)).measure).toBe(80);
  });

  it('narrows the measure to the room left when that is less than the measure of the document', () => {
    const doc = makeDoc({ measure: 100 });
    expect(inInset(doc, { left: doc.contentWidth - 60 }, () => frameOf(doc)).measure).toBeCloseTo(60, 6);
  });

  it('takes a width given as its measure, wider than the measure of the document', () => {
    const doc = makeDoc({ measure: 100 });
    const frame = inInset(doc, { width: 150 }, () => frameOf(doc));
    expect(frame.contentWidth).toBe(150);
    expect(frame.measure).toBe(150);
    expect(doc.warnings).toEqual([]);
  });

  it('takes the width kept after the warning as its measure', () => {
    const doc = makeDoc({ measure: 100 });
    const frame = inInset(doc, { width: 500 }, () => frameOf(doc));
    expect(frame.contentWidth).toBeCloseTo(doc.contentWidth, 6);
    expect(frame.measure).toBeCloseTo(doc.contentWidth, 6);
    expect(doc.warnings).toHaveLength(1);
  });

  it('gives the current frame back after draw, and when draw throws', () => {
    const doc = docOnMargins();
    const before = frameOf(doc);
    doc.inset({ left: 20 }, () => {});
    expect(frameOf(doc)).toEqual(before);
    expect(() =>
      doc.inset({ left: 20 }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(frameOf(doc)).toEqual(before);
  });

  it('throws for left, right and width together', () => {
    const doc = docOnMargins();
    const draw = vi.fn();
    expectRejectedBeforeDrawing(doc, () => doc.inset({ left: 10, right: 10, width: 50 }, draw));
    expect(() => doc.inset({ left: 10, right: 10, width: 50 }, draw)).toThrow(
      'Invalid inset width (mm): 50 — must be left out when left and right are both given',
    );
    expect(draw).not.toHaveBeenCalled();
  });

  it.each<[InsetOptions, string]>([
    [{ left: W }, 'left'],
    [{ right: W + 30 }, 'right'],
    [{ left: W, width: 10 }, 'left'],
    [{ right: W, width: 10 }, 'right'],
    [{ left: 100, right: W - 100 }, 'left and right'],
  ])('throws when %o leaves no width, naming %s and not width, before anything is drawn', (options, named) => {
    const doc = docOnMargins();
    const draw = vi.fn();
    expectRejectedBeforeDrawing(doc, () => doc.inset(options, draw));
    expect(() => doc.inset(options, draw)).toThrow(
      new RegExp(
        `^Invalid inset ${named} \\(mm\\) in a frame [\\d.]+ mm wide: [\\d.]+ — must be a finite number, less than [\\d.]+$`,
      ),
    );
    expect(draw).not.toHaveBeenCalled();
    expect(frameOf(doc)).toEqual(frameOf(docOnMargins()));
  });
});

describe('blocks in an inset', () => {
  it('wraps a paragraph to the inset and draws it at its left edge', () => {
    const doc = docOnMargins();
    const texts = recordTexts(doc);
    doc.inset({ left: 40, right: 50 }, () => doc.paragraph(PARAGRAPHS.join(' ')));
    expectTextWithin(texts, 65, 65 + 80);
    expect(texts.length).toBeGreaterThan(1);
  });

  it('carries the flow in and out: the position and the space left above it', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.paragraph('Before');
    doc.inset({ left: 20 }, () => doc.paragraph('Inside'));
    doc.paragraph('After');
    const line = bodyLine(doc);
    const block = doc.theme.spacing.block;
    expect(textOf(texts, 'Inside').y - textOf(texts, 'Before').y).toBeCloseTo(line + block, 6);
    expect(textOf(texts, 'After').y - textOf(texts, 'Inside').y).toBeCloseTo(line + block, 6);
    expect(textOf(texts, 'After').x).toBe(doc.margins.left);
  });

  it('nests: an inset of an inset is measured from the edges of the outer one', () => {
    const doc = docOnMargins();
    let inner!: ReturnType<typeof frameOf>;
    doc.inset({ left: 20, right: 10 }, () => {
      inner = inInset(doc, { left: 5, width: 30 }, () => frameOf(doc));
    });
    expect(inner.margins.left).toBeCloseTo(25 + 20 + 5, 6);
    expect(inner.contentWidth).toBeCloseTo(30, 6);
  });

  it('keeps the measure of the document in an inset nested in an inset that gave no width', () => {
    const doc = makeDoc({ measure: 100 });
    const frames = inInset(doc, { left: 10 }, () => ({
      inner: inInset(doc, { left: 5 }, () => frameOf(doc)),
      wider: inInset(doc, { width: 140 }, () => frameOf(doc)),
    }));
    expect(frames.inner.measure).toBe(100);
    expect(frames.wider.measure).toBe(140);
  });

  it('opens in a column, measured from the edges of that column', () => {
    const doc = docOnMargins();
    let column!: ReturnType<typeof frameOf>;
    let inner!: ReturnType<typeof frameOf>;
    doc.columns([
      () => {},
      (ctx) => {
        column = frameOf(ctx);
        inner = inInset(ctx, { right: 5, width: 20 }, () => frameOf(ctx));
      },
    ]);
    expect(inner.margins.right).toBeCloseTo(column.margins.right + 5, 6);
    expect(inner.contentWidth).toBeCloseTo(20, 6);
  });

  it('splits its own width between the columns opened in it', () => {
    const doc = docOnMargins();
    const lefts: number[] = [];
    const widths: number[] = [];
    const probe = (ctx: PDFDocument, x: number, width: number) => {
      lefts.push(x);
      widths.push(width);
      ctx.paragraph('Cell');
    };
    doc.inset({ left: 30, right: 20 }, () => doc.columns([probe, probe]));
    const width = columnWidth(W - 50, 2, LAYOUT.columnGap);
    expect(widths[0]).toBeCloseTo(width, 6);
    expect(widths[1]).toBeCloseTo(width, 6);
    expect(lefts[0]).toBeCloseTo(55, 6);
    expect(lefts[1]).toBeCloseTo(55 + width + LAYOUT.columnGap, 6);
  });

  it('continues a table on the next page in the inset, its head repeated there', () => {
    const doc = leaveRoom(docOnMargins(), 30);
    const texts = recordTexts(doc);
    const rows = Array.from({ length: 12 }, (_, index) => ({ item: `Row ${index + 1}`, qty: index }));
    doc.inset({ left: 40, width: 80 }, () => doc.table(rows, { columns: TABLE_COLUMNS }));
    expect(textOf(texts, 'Row 12').page).toBe(2);
    const heads = texts.filter((call) => call.lines[0] === 'Item');
    expect(heads.map((call) => call.page)).toEqual([1, 2]);
    // A right-aligned cell is drawn from its right edge.
    expectTextWithin(
      texts.filter((call) => call.align !== 'right'),
      65,
      65 + 80,
    );
    for (const call of texts.filter((cell) => cell.align === 'right')) expect(call.x).toBeLessThanOrEqual(65 + 80);
    expect(doc.warnings).toEqual([]);
  });
});

/** x and width (mm) of the box `infoBox` draws in an inset of `options`. */
const boxIn = (doc: PDFDocument, options: InsetOptions) => {
  const rect = vi.spyOn(doc.doc, 'roundedRect');
  doc.inset(options, () => doc.infoBox('Content', { title: 'Title' }));
  const [x, , width] = rect.mock.calls[0];
  return { x: Number(x), width: Number(width) };
};

describe('an inset on a document with a narrow measure', () => {
  it('draws a box up to the right edge it was given, wider than the measure', () => {
    const doc = makeDoc({ measure: 100 });
    const { x, width } = boxIn(doc, { right: 0, width: 150 });
    expect(x).toBeCloseTo(doc.pageWidth - doc.margins.right - 150, 6);
    expect(width).toBeCloseTo(150, 6);
    expect(x + width).toBeCloseTo(doc.pageWidth - doc.margins.right, 6);
  });

  it('draws a box as wide as a width given alone, from the left edge', () => {
    const doc = makeDoc({ measure: 100 });
    expect(boxIn(doc, { width: 150 })).toEqual({ x: doc.margins.left, width: 150 });
  });

  it('keeps the measure of the document for a box in an inset given only left', () => {
    const doc = makeDoc({ measure: 100 });
    expect(boxIn(doc, { left: 10 })).toEqual({ x: doc.margins.left + 10, width: 100 });
  });

  it('draws a box in a nested inset with the width given there', () => {
    const doc = makeDoc({ measure: 100 });
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    doc.inset({ left: 10 }, () => doc.inset({ width: 140 }, () => doc.infoBox('Content', { title: 'Title' })));
    const [x, , width] = rect.mock.calls[0];
    expect({ x: Number(x), width: Number(width) }).toEqual({ x: doc.margins.left + 10, width: 140 });
  });
});

describe('a page break in an inset', () => {
  it('goes on in the inset on the next page, without a warning', () => {
    const doc = leaveRoom(docOnMargins(), 20);
    const texts = recordTexts(doc);
    doc.inset({ left: 30 }, () => doc.paragraphs(PARAGRAPHS));
    const last = textOf(texts, 'Paragraph 12');
    expect(last.page).toBe(2);
    expect(last.x).toBeCloseTo(55, 6);
    expect(doc.warnings).toEqual([]);
  });

  it('is kept together by keepTogether around the inset', () => {
    const doc = leaveRoom(docOnMargins(), 12);
    const texts = recordTexts(doc);
    doc.keepTogether(() => doc.inset({ left: 30 }, () => doc.paragraphs(PARAGRAPHS.slice(0, 3))));
    const first = lastText(texts, 'Paragraph 1');
    expect(first.page).toBe(2);
    expect(first.x).toBeCloseTo(55, 6);
    expect(frameOf(doc)).toEqual(frameOf(docOnMargins()));
    expect(doc.warnings).toEqual([]);
  });

  it('keeps a group together with keepTogether inside the inset', () => {
    const doc = leaveRoom(docOnMargins(), 12);
    const texts = recordTexts(doc);
    doc.inset({ left: 30 }, () =>
      doc.keepTogether(() => doc.heading('Kept', { level: 'h3' }).paragraphs(PARAGRAPHS.slice(0, 3))),
    );
    const kept = lastText(texts, 'Kept');
    expect(kept.page).toBe(2);
    expect(kept.x).toBeCloseTo(55, 6);
    expect(doc.warnings).toEqual([]);
  });
});

describe('headings around an inset', () => {
  it('draws a heading called before the inset across the frame around it, with the first block of the inset', () => {
    const doc = docOnMargins();
    const line = vi.spyOn(doc.doc, 'line');
    const texts = recordTexts(doc);
    doc.heading('Above', { level: 'h2', rule: true });
    doc.inset({ left: 40 }, () => doc.paragraph('Inside'));
    expect(textOf(texts, 'Above').x).toBe(25);
    const [x1, , x2] = line.mock.calls[0];
    expect(x1).toBe(25);
    expect(x2).toBeCloseTo(25 + W, 6);
    expect(textOf(texts, 'Inside').x).toBe(65);
  });

  it('measures a heading called before the inset in the frame around it', () => {
    // A title on one line across the page, on several in the inset: measured in the inset, it would not fit.
    const title = 'Results of the second quarter';
    const doc = leaveRoom(docOnMargins(), headingBlock(makeDoc()) + bodyLine(makeDoc()) + 0.5);
    const texts = recordTexts(doc);
    doc.heading(title, { level: 'h2', spaceBefore: 0 });
    doc.inset({ width: 25 }, () => doc.paragraph('Body'));
    const heading = textOf(texts, title);
    expect(heading.lines).toHaveLength(1);
    expect(heading.page).toBe(1);
    expect(textOf(texts, 'Body').page).toBe(1);
  });

  it('moves a heading called before the inset to the next page with the first block of the inset', () => {
    const doc = leaveRoom(docOnMargins(), headingBlock(makeDoc()) + 1);
    const texts = recordTexts(doc);
    doc.heading('Above', { level: 'h2', spaceBefore: 0 });
    doc.inset({ left: 40 }, () => doc.paragraph('Inside'));
    expect(textOf(texts, 'Above').page).toBe(2);
    expect(textOf(texts, 'Inside').page).toBe(2);
    expect(doc.warnings).toEqual([]);
  });

  it('draws a heading still waiting at the end of the inset in the inset, with the block after it', () => {
    const doc = docOnMargins();
    const texts = recordTexts(doc);
    doc.inset({ left: 40 }, () => doc.paragraph('Inside').heading('Waiting', { level: 'h3' }));
    expect(textOf(texts, 'Waiting')).toBeUndefined();
    doc.paragraph('After');
    expect(textOf(texts, 'Waiting').x).toBe(65);
    expect(textOf(texts, 'After').x).toBe(25);
  });

  it('draws a heading still waiting at the end of the inset in the inset when the document is exported', () => {
    const doc = docOnMargins();
    const texts = recordTexts(doc);
    doc.inset({ left: 40 }, () => doc.heading('Last', { level: 'h3' }));
    doc.toBuffer();
    expect(textOf(texts, 'Last').x).toBe(65);
  });
});

describe('page-level calls in an inset', () => {
  it('declares a pageHeader at the scale of the page', () => {
    const doc = docOnMargins();
    const texts = recordTexts(doc);
    doc.inset({ left: 40, right: 40 }, () => doc.pageHeader({ title: 'Report' }));
    doc.paragraph('Body').finalize();
    // The running header sets its title in capitals.
    expect(textOf(texts, 'REPORT').x).toBe(25);
  });

  it('draws a table of contents across the page, and goes on in the inset on the next page', () => {
    const doc = docOnMargins();
    const texts = recordTexts(doc);
    doc.inset({ left: 40 }, () => {
      doc.tableOfContents({ title: 'Contents' });
      doc.heading('Chapter').paragraph('Body');
    });
    doc.finalize();
    expect(textOf(texts, 'Contents').x).toBe(25);
    expect(textOf(texts, 'Chapter').x).toBe(65);
    expect(textOf(texts, 'Chapter').page).toBe(2);
    expect(doc.warnings).toEqual([]);
  });

  it('warns when called after finalize, like any drawing call', () => {
    const doc = makeDoc();
    doc.finalize();
    doc.inset({}, () => {});
    expect(doc.warnings.join(' ')).toContain('Drawing after finalize()');
  });

  it('throws for options that are not an object', () => {
    expect(() => makeDoc().inset(null as never, () => {})).toThrow(InvalidOptionError);
  });
});
