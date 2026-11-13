import { describe, expect, it, vi } from 'vitest';

import { BADGE, HEADER_COLUMNS, capitalMiddle } from '../../src/core/constants';
import type { TextLevel } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import { InvalidOptionError } from '../../src/core/errors';
import { measureTextLevel, setTextStyle } from '../../src/drawing/text';
import {
  type DrawnText,
  PNG,
  currentPage,
  expectRejectedBeforeDrawing,
  expectTextWithin,
  inFirstOfTwoColumns,
  leaveRoom,
  makeDoc,
  recordTexts,
  textOf,
} from './helpers';

/**
 * The width of each line of a call, in the font of `level`: the call is over, the document is back in the caller's
 * font.
 */
function widthsAt(doc: PDFDocument, level: TextLevel, call: DrawnText): number[] {
  setTextStyle(doc, level);
  return call.lines.map((line) => doc.doc.getTextWidth(line));
}

describe('headerColumns', () => {
  const LONG_VALUE = 'a value that is much too long to stay on a single line of its column '.repeat(3).trim();

  it('wraps a long value inside its column, after the label', () => {
    const doc = makeDoc();
    const drawn = recordTexts(doc);
    doc.headerColumns([
      { title: 'Invoice', fields: [{ label: 'Note', value: LONG_VALUE }] },
      { title: 'Client', fields: [{ label: 'Name', value: 'Jane' }] },
    ]);

    const columnWidth = (doc.contentWidth - 10) / 2;
    const valueX = doc.margins.left + 35;
    const value = drawn.find((call) => call.x === valueX && call.lines[0].startsWith('a value'))!;
    expect(value.lines.length).toBeGreaterThan(1);
    expect(value.lines.join(' ')).toBe(LONG_VALUE);
    for (const width of widthsAt(doc, 'fieldValue', value))
      expect(valueX + width).toBeLessThanOrEqual(doc.margins.left + columnWidth + 0.01);
  });

  it('puts the next block under the wrapped value', () => {
    const doc = makeDoc();
    const short = makeDoc();
    doc.headerColumns([{ title: 'Invoice', fields: [{ label: 'Note', value: LONG_VALUE }] }]);
    short.headerColumns([{ title: 'Invoice', fields: [{ label: 'Note', value: 'short' }] }]);
    expect(doc.getYPos()).toBeGreaterThan(short.getYPos() + 5);
  });

  it('wraps a label wider than its column instead of running into the value', () => {
    const doc = makeDoc();
    const drawn = recordTexts(doc);
    const label = 'A reference label much wider than the label column of its header';
    doc.headerColumns([{ title: 'Invoice', fields: [{ label, value: 'INV-42' }] }]);

    const valueX = doc.margins.left + 35;
    const labelCall = drawn.find((call) => call.x === doc.margins.left && call.lines.join(' ') === label)!;
    expect(labelCall.lines.length).toBeGreaterThan(1);
    for (const width of widthsAt(doc, 'fieldValue', labelCall)) expect(doc.margins.left + width).toBeLessThan(valueX);
    expect(drawn.some((call) => call.x === valueX && call.lines.join(' ') === 'INV-42')).toBe(true);
  });

  it('keeps the label and the value on the same first line', () => {
    const doc = makeDoc();
    const drawn = recordTexts(doc);
    doc.headerColumns([{ title: 'Invoice', fields: [{ label: 'Date', value: 'April 9, 2026' }] }]);
    const label = textOf(drawn, 'Date');
    const value = textOf(drawn, 'April 9, 2026');
    expect(label.y).toBe(value.y);
    expect(value.x).toBe(doc.margins.left + 35);
  });

  it('honours labelWidth', () => {
    const doc = makeDoc();
    const drawn = recordTexts(doc);
    doc.headerColumns([{ title: 'Invoice', labelWidth: 20, fields: [{ label: 'Date', value: 'April 9, 2026' }] }]);
    expect(textOf(drawn, 'April 9, 2026').x).toBe(doc.margins.left + 20);
  });

  it.each([0, -5, HEADER_COLUMNS.labelGap, Number.NaN])(
    'rejects a labelWidth of %s that leaves no room for the label',
    (labelWidth) => {
      const doc = makeDoc();
      const columns = [{ title: 'Invoice', labelWidth, fields: [{ label: 'Date', value: 'April 9, 2026' }] }];
      expect(() => doc.headerColumns(columns)).toThrow(InvalidOptionError);
    },
  );

  it('draws the title at the h2 size', () => {
    const doc = makeDoc();
    const sizes: number[] = [];
    vi.spyOn(doc.doc, 'text').mockImplementation(function (...args: unknown[]) {
      if ([args[0]].flat().includes('Invoice')) sizes.push(doc.doc.getFontSize());
      return doc.doc;
    });
    doc.headerColumns([{ title: 'Invoice', fields: [] }]);
    expect(sizes).toEqual([doc.theme.typography.sizes.h2]);
  });

  it('draws a block that does not fit under the position whole on the next page', () => {
    const doc = makeDoc();
    const drawn = recordTexts(doc);
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 5);
    doc.headerColumns([
      { title: 'Invoice', fields: [{ label: 'Date', value: 'April 9, 2026' }] },
      { title: 'Client', fields: [{ label: 'Name', value: 'Jane' }] },
    ]);

    expect(currentPage(doc)).toBe(2);
    expect(drawn.length).toBeGreaterThan(0);
    for (const call of drawn) {
      expect(call.page).toBe(2);
      expect(call.y).toBeGreaterThanOrEqual(doc.margins.top);
    }
  });

  it('keeps a waiting heading with the block that moves to the next page', () => {
    const doc = makeDoc();
    const drawn = recordTexts(doc);
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 12);
    doc.heading('Parties', { level: 'h3' });
    doc.headerColumns([{ title: 'Invoice', fields: [{ label: 'Date', value: 'April 9, 2026' }] }]);

    expect(textOf(drawn, 'Parties').page).toBe(2);
    expect(textOf(drawn, 'Invoice').page).toBe(2);
  });

  it('moves to the next page whole after a closing note instead of drawing into the footer zone', () => {
    const doc = makeDoc();
    doc.paragraph('Intro').closingNote('Legal mentions.');
    const drawn = recordTexts(doc);
    doc.headerColumns([
      { title: 'Invoice', fields: [{ label: 'No.', value: 'INV-042' }] },
      { title: 'Client', fields: [{ label: 'Company', value: 'TechStart Inc.' }] },
    ]);
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(drawn.length).toBeGreaterThan(0);
    const bottom = doc.layout.bottom(doc.pageHeight);
    for (const call of drawn) {
      expect(call.page).toBe(2);
      expect(call.y).toBeLessThanOrEqual(bottom);
    }
  });

  it('takes the height of its tallest column, then its space', () => {
    const doc = makeDoc();
    const ensure = vi.spyOn(doc, 'ensureSpace');
    const start = doc.getYPos();
    doc.headerColumns(
      [
        { title: 'Short', fields: [{ label: 'a', value: 'b' }] },
        {
          title: 'Tall',
          fields: [
            { label: 'a', value: LONG_VALUE },
            { label: 'c', value: 'd' },
          ],
        },
      ],
      { spaceAfter: 7 },
    );
    // The block reserves its tallest column and its space, and moves under them.
    expect(doc.getYPos() - start).toBeCloseTo(ensure.mock.calls[0][0], 6);
    expect(doc.contentBottom()).toBeCloseTo(doc.getYPos() - 7, 6);
    const short = makeDoc();
    short.headerColumns([{ title: 'Short', fields: [{ label: 'a', value: 'b' }] }], { spaceAfter: 7 });
    expect(doc.getYPos()).toBeGreaterThan(short.getYPos());
  });

  it('reserves nothing for an empty list of columns', () => {
    const doc = makeDoc();
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 1);
    const start = doc.getYPos();
    doc.headerColumns([]);
    expect(currentPage(doc)).toBe(1);
    expect(doc.getYPos()).toBe(start);
  });

  it('moves under the block by spaceAfter', () => {
    const doc = makeDoc();
    const start = doc.getYPos();
    const none = makeDoc().headerColumns([{ title: 'T', fields: [{ label: 'a', value: 'b' }] }], { spaceAfter: 0 });
    const spaced = doc.headerColumns([{ title: 'T', fields: [{ label: 'a', value: 'b' }] }], { spaceAfter: 7 });
    expect(spaced.getYPos() - start).toBeCloseTo(none.getYPos() - start + 7, 6);
  });
});

describe('badge', () => {
  it('draws the label inside its pill and moves under it', () => {
    const doc = makeDoc();
    const drawn = recordTexts(doc);
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    vi.spyOn(doc.doc, 'roundedRect').mockImplementation(function (...args: unknown[]) {
      const [x, y, w, h] = args as number[];
      rects.push({ x, y, w, h });
      return doc.doc;
    });
    doc.badge('Draft', { spaceAfter: 5 });

    const label = textOf(drawn, 'Draft');
    const [rect] = rects;
    expect(label.x).toBeGreaterThan(rect.x);
    expect(label.x + widthsAt(doc, 'bodyBold', label)[0]).toBeLessThan(rect.x + rect.w);
    expect(label.y).toBeGreaterThan(rect.y);
    expect(label.y).toBeLessThan(rect.y + rect.h);
    expect(doc.getYPos()).toBeCloseTo(rect.y + rect.h + 5, 6);
  });

  it('is taller at a larger text level', () => {
    const small = makeDoc().badge('Draft', { level: 'small' });
    const large = makeDoc().badge('Draft', { level: 'h2' });
    expect(large.getYPos()).toBeGreaterThan(small.getYPos());
  });

  describe('with a label wider than the reading column', () => {
    const LABEL = 'Confidential: for the members of the board and the auditors only, not to be forwarded';

    /** The pill drawn by `draw`, and the label lines inside it. */
    function pillOf(doc: PDFDocument, draw: () => void) {
      const drawn = recordTexts(doc);
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      vi.spyOn(doc.doc, 'roundedRect').mockImplementation(function (...args: unknown[]) {
        const [x, y, w, h] = args as number[];
        rects.push({ x, y, w, h });
        return doc.doc;
      });
      draw();
      return { rect: rects[0], label: drawn.find((call) => call.lines.join(' ') === LABEL)! };
    }

    it('wraps to the reading column, the pill around its lines', () => {
      const doc = makeDoc({ measure: 100 });
      const { rect, label } = pillOf(doc, () => doc.badge(LABEL, { spaceAfter: 0 }));

      expect(label.lines.length).toBeGreaterThan(1);
      const widest = Math.max(...widthsAt(doc, 'bodyBold', label));
      expect(rect.x + rect.w).toBeLessThanOrEqual(doc.margins.left + doc.measure + 1e-6);
      expect(rect.w).toBeCloseTo(widest + 2 * BADGE.paddingX, 6);
      expect(label.x).toBeCloseTo(rect.x + BADGE.paddingX, 6);
    });

    it('is as tall as its lines, and the position moves under it', () => {
      const doc = makeDoc({ measure: 100 });
      const start = doc.getYPos();
      const { rect, label } = pillOf(doc, () => doc.badge(LABEL, { spaceAfter: 4 }));
      const { lineHeight, ascent } = measureTextLevel(doc, 'bodyBold');

      expect(rect.h).toBeCloseTo(label.lines.length * lineHeight + 2 * BADGE.paddingY, 6);
      expect(doc.getYPos()).toBeCloseTo(start + rect.h + 4, 6);
      // The first line is centred on the capitals, as a badge of one line is.
      expect(label.y - rect.y).toBeCloseTo(BADGE.paddingY + lineHeight / 2 + capitalMiddle({ ascent }), 6);
    });

    it('moves to the next page when the whole pill does not fit', () => {
      const doc = leaveRoom(makeDoc({ measure: 100 }), 12);
      const { rect } = pillOf(doc, () => doc.badge(LABEL));
      expect(doc.doc.getNumberOfPages()).toBe(2);
      expect(rect.y).toBeCloseTo(doc.layout.topFor(2), 6);
    });

    it('wraps to its column', () => {
      const doc = makeDoc();
      const drawn = recordTexts(doc);
      const frame = inFirstOfTwoColumns(doc, (column) => column.badge(LABEL));
      const lines = drawn.filter((call) => call.lines[0] !== 'Beside.');
      expect(lines[0].lines.length).toBeGreaterThan(1);
      expectTextWithin(lines, frame.left, frame.left + frame.width);
    });

    it('throws before drawing when the reading column leaves the label no width', () => {
      const doc = makeDoc({ measure: 2 * BADGE.paddingX });
      expectRejectedBeforeDrawing(doc, () => doc.badge('Draft'));
      expect(() => doc.badge('Draft')).toThrow(/text width of the badge/);
    });
  });
});

const logo = (doc: PDFDocument, options: object) => () => {
  doc.registerImage('brand', PNG);
  return doc.logo('brand', options);
};

// The values it refuses are in `option-validation.test.ts`.
describe('logo position and size', () => {
  it('keeps a position left undefined at its default', () => {
    expect(logo(makeDoc(), { height: undefined, x: undefined, y: undefined })).not.toThrow();
  });
});
