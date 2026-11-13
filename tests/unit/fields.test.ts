import { describe, expect, it, vi } from 'vitest';

import { FIELD, LAYOUT, LEADER, SPACING } from '../../src/core/constants';
import { PDFDocument } from '../../src/core/document';
import type { Field, FieldLayout } from '../../src/drawing/fields';
import { drawFieldRows, drawFields } from '../../src/drawing/fields';
import { layoutLeaderRow } from '../../src/drawing/rich';
import { measureTextLevel, resolveTextStyle, setTextStyle } from '../../src/drawing/text';
import { wrap } from '../../src/drawing/text-lines';
import { makeDoc } from './helpers';

// Y advanced by `drawFields` for a single field, spacing after excluded.
function drawnHeight(doc: PDFDocument, field: Field, layout?: FieldLayout): number {
  const startY = doc.getYPos();
  drawFields(doc, [field], { spaceAfter: 0, layout });
  return doc.getYPos() - startY;
}

const LONG_LABEL = 'Registered office address as filed with the commercial register of the competent court';

const HIGHLIGHTED_FIELD: Field = {
  label: 'Status',
  value: 'Active under the extended compliance regime for regulated entities',
  highlight: true,
};

describe('drawFields', () => {
  it('draws every label line inside the column', () => {
    const doc = makeDoc();
    const text = vi.spyOn(doc.doc, 'text');
    const [a, b, c] = [0, 1, 2].map(() => ({ label: LONG_LABEL, value: 'x' }));
    drawFields(doc, [a, b, c]);
    const columnWidth = (doc.contentWidth - 2 * LAYOUT.columnGap) / 3;
    setTextStyle(doc, 'fieldLabel');
    const labelLines = text.mock.calls.flatMap(([value]) => value).filter((value) => value !== 'x');
    expect(labelLines.length).toBeGreaterThan(3);
    for (const line of labelLines) expect(doc.doc.getTextWidth(line as string)).toBeLessThanOrEqual(columnWidth + 0.01);
  });

  it('keeps the pill of a highlighted value inside the field', () => {
    const doc = makeDoc();
    const startY = doc.getYPos();
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    const height = drawnHeight(doc, HIGHLIGHTED_FIELD);
    const [, pillY, , pillHeight] = rect.mock.calls[0] as number[];
    expect(pillY + pillHeight).toBeLessThanOrEqual(startY + height);
  });
});

const fieldHeight = (doc: PDFDocument) =>
  measureTextLevel(doc, 'fieldLabel').lineHeight + FIELD.labelGap + measureTextLevel(doc, 'fieldValue').lineHeight;
const advance = (doc: PDFDocument, draw: () => void) => {
  const startY = doc.getYPos();
  draw();
  return doc.getYPos() - startY;
};

describe('field spacing', () => {
  const SHORT: Field = { label: 'Client', value: 'TechStart Inc.' };
  it('a lone field advances by its height and SPACING.medium', () => {
    const doc = makeDoc();
    expect(advance(doc, () => drawFields(doc, [SHORT]))).toBeCloseTo(fieldHeight(doc) + SPACING.medium, 6);
  });

  it('two rows are FIELD.rowGap.stacked apart by default, then SPACING.medium', () => {
    const doc = makeDoc();
    const total = advance(doc, () => drawFieldRows(doc, [[SHORT], [SHORT]]));
    expect(total).toBeCloseTo(2 * fieldHeight(doc) + FIELD.rowGap.stacked + SPACING.medium, 6);
  });

  it('gives spaceAfter to the last non-empty row, not to an empty one after it', () => {
    const doc = makeDoc();
    expect(advance(doc, () => drawFieldRows(doc, [[SHORT], []]))).toBeCloseTo(fieldHeight(doc) + SPACING.medium, 6);
    expect(advance(doc, () => drawFieldRows(doc, [[], [SHORT], [], [SHORT], []]))).toBeCloseTo(
      2 * fieldHeight(doc) + FIELD.rowGap.stacked + SPACING.medium,
      6,
    );
  });

  it('draws nothing for rows that are all empty', () => {
    const doc = makeDoc();
    expect(advance(doc, () => drawFieldRows(doc, [[], []]))).toBe(0);
  });

  it('an explicit rowGap sets the space between rows only', () => {
    const doc = makeDoc();
    const total = advance(doc, () => drawFieldRows(doc, [[SHORT], [SHORT]], { rowGap: 7 }));
    expect(total).toBeCloseTo(2 * fieldHeight(doc) + 7 + SPACING.medium, 6);
  });

  it('an explicit spaceAfter sets the space under the block only', () => {
    const doc = makeDoc();
    const total = advance(doc, () => drawFieldRows(doc, [[SHORT], [SHORT]], { spaceAfter: 9 }));
    expect(total).toBeCloseTo(2 * fieldHeight(doc) + FIELD.rowGap.stacked + 9, 6);
  });

  it('a value that wraps adds one line height per extra line', () => {
    const doc = makeDoc();
    const value = 'A long value that runs over several lines of the content width. '.repeat(4).trim();
    setTextStyle(doc, 'fieldValue');
    const lineCount = wrap(doc, value, doc.measure).length;
    expect(lineCount).toBeGreaterThan(1);
    const total = advance(doc, () => drawFields(doc, [{ label: 'Notes', value }], { spaceAfter: 0 }));
    expect(total).toBeCloseTo(
      measureTextLevel(doc, 'fieldLabel').lineHeight +
        FIELD.labelGap +
        lineCount * measureTextLevel(doc, 'fieldValue').lineHeight,
      6,
    );
  });

  it('inline rows are FIELD.lineGap apart inside a row, rowGap between rows', () => {
    const doc = makeDoc();
    const line = measureTextLevel(doc, 'fieldValue').lineHeight;
    const total = advance(doc, () => drawFieldRows(doc, [[SHORT, SHORT], [SHORT]], { layout: 'inline', rowGap: 6 }));
    expect(total).toBeCloseTo(3 * line + FIELD.lineGap + 6 + SPACING.medium, 6);
  });
});

describe('inline and leader layouts', () => {
  const LONG_VALUE =
    'Acme Corp, a small team building themed PDF generation for business documents, with a focus on layouts ' +
    'that stay readable when the content is longer than expected';

  const fieldCases: [string, Field][] = [
    ['a short value', { label: 'Project', value: 'jspdf-toolkit' }],
    ['a value that wraps', { label: 'Maintainer', value: LONG_VALUE }],
    ['a highlighted value', { label: 'Status', value: 'Active', highlight: true }],
    ['a complement', { label: 'Repository', value: 'github.com/toolkit', complement: 'Mirror available on GitLab' }],
    ['a label that wraps', { label: LONG_LABEL, value: 'Paris' }],
    ['a value too long for the label line', { label: 'Main activity', value: LONG_VALUE }],
  ];

  describe.each(['inline', 'leader'] as const)('%s', (layout) => {
    it('draws a field per line, with a gap between them and a wider one between rows', () => {
      const doc = makeDoc();
      const a = { label: 'A', value: '1' };
      const single = drawnHeight(makeDoc(), a, layout);
      const startY = doc.getYPos();
      drawFieldRows(doc, [[a, a], [a]], { layout });
      expect(doc.getYPos() - startY).toBeCloseTo(3 * single + FIELD.lineGap + FIELD.rowGap[layout] + SPACING.medium, 6);
    });

    it('keeps every text inside the measure', () => {
      const doc = makeDoc({ measure: 110 });
      // Widths are read while drawing: the font changes between the label, the value and the note.
      const original = doc.doc.text.bind(doc.doc);
      const drawn: { start: number; end: number }[] = [];
      vi.spyOn(doc.doc, 'text').mockImplementation(((...args: Parameters<typeof original>) => {
        const [value, x, , options] = args;
        const alignRight = (options as { align?: string } | undefined)?.align === 'right';
        for (const line of Array.isArray(value) ? value : [String(value)]) {
          const width = doc.doc.getTextWidth(line);
          const start = alignRight ? (x as number) - width : (x as number);
          drawn.push({ start, end: start + width });
        }
        return original(...args);
      }) as typeof original);
      drawFields(
        doc,
        fieldCases.map(([, field]) => field),
        { layout },
      );
      expect(drawn.length).toBeGreaterThan(8);
      for (const { start, end } of drawn) {
        expect(start).toBeGreaterThanOrEqual(doc.margins.left - 0.01);
        expect(end).toBeLessThanOrEqual(doc.margins.left + doc.measure + 0.01);
      }
    });
  });

  describe('inline', () => {
    it('hangs the wrapped value under its first line, after the label', () => {
      const doc = makeDoc();
      const text = vi.spyOn(doc.doc, 'text');
      drawFields(doc, [{ label: 'Maintainer', value: LONG_VALUE }], { layout: 'inline' });
      const calls = text.mock.calls.map(([value, x, y]) => ({ value: String(value), x: x as number, y: y as number }));
      expect(calls[0].value).toBe('Maintainer:');
      const valueCalls = calls.slice(1);
      expect(new Set(valueCalls.map(({ y }) => y)).size).toBeGreaterThan(1);
      const indent = valueCalls[0].x;
      expect(indent).toBeGreaterThan(doc.margins.left + 10);
      for (const { x } of valueCalls) expect(x).toBeCloseTo(indent, 6);
      // The value starts on the label baseline.
      expect(valueCalls[0].y).toBeCloseTo(calls[0].y, 6);
    });

    it('falls back to the stacked layout when the label leaves no room', () => {
      const field = { label: LONG_LABEL, value: 'Paris' };
      expect(drawnHeight(makeDoc(), field, 'inline')).toBeCloseTo(drawnHeight(makeDoc(), field, 'stacked'), 6);
    });
  });

  describe('leader', () => {
    const field = { label: 'Registered capital', value: '€250,000' };

    it('draws the dots between the end of the label and the start of the value', () => {
      const doc = makeDoc();
      const line = vi.spyOn(doc.doc, 'line');
      drawFields(doc, [field], { layout: 'leader' });
      expect(line).toHaveBeenCalledTimes(1);
      const [x1, y1, x2, y2] = line.mock.calls[0] as number[];
      expect(y1).toBe(y2);
      setTextStyle(doc, 'body');
      const labelEnd = doc.margins.left + doc.doc.getTextWidth(field.label);
      setTextStyle(doc, 'bodyBold');
      const valueStart = doc.margins.left + doc.measure - doc.doc.getTextWidth(field.value);
      const [from, to] = [Math.min(x1, x2), Math.max(x1, x2)];
      expect(from).toBeGreaterThanOrEqual(labelEnd);
      expect(to).toBeLessThanOrEqual(valueStart);
      expect(to - from).toBeGreaterThan(20);
    });

    it('restores the dash pattern around the dots', () => {
      const doc = makeDoc();
      const save = vi.spyOn(doc.doc, 'saveGraphicsState');
      const restore = vi.spyOn(doc.doc, 'restoreGraphicsState');
      drawFields(doc, [field], { layout: 'leader' });
      expect(save).toHaveBeenCalledTimes(1);
      expect(restore).toHaveBeenCalledTimes(1);
    });

    it('moves a value too long for the label line onto its own right-aligned lines, without dots', () => {
      const doc = makeDoc();
      const line = vi.spyOn(doc.doc, 'line');
      const text = vi.spyOn(doc.doc, 'text');
      const long = { label: 'Main activity', value: LONG_VALUE };
      drawFields(doc, [long], { layout: 'leader', spaceAfter: 0 });
      expect(line).not.toHaveBeenCalled();
      const calls = text.mock.calls.map(([value, x, y, options]) => ({
        value: String(value),
        x: x as number,
        y: y as number,
        align: (options as { align?: string } | undefined)?.align,
      }));
      const [label, ...valueLines] = calls;
      expect(label.value).toBe('Main activity');
      expect(valueLines.length).toBeGreaterThan(1);
      for (const valueLine of valueLines) {
        expect(valueLine.align).toBe('right');
        expect(valueLine.y).toBeGreaterThan(label.y);
        expect(valueLine.x).toBeCloseTo(doc.margins.left + doc.measure, 6);
      }
      expect(doc.getYPos()).toBeGreaterThan(valueLines[valueLines.length - 1].y);
    });

    it('draws a highlighted value as a right-aligned pill behind the dots', () => {
      const doc = makeDoc();
      const rect = vi.spyOn(doc.doc, 'roundedRect');
      const line = vi.spyOn(doc.doc, 'line');
      const highlighted = { ...field, highlight: true };
      drawFields(doc, [highlighted], { layout: 'leader', spaceAfter: 0 });
      expect(rect).toHaveBeenCalledTimes(1);
      const [pillX, pillY, pillWidth, pillHeight] = rect.mock.calls[0] as number[];
      expect(pillX + pillWidth).toBeCloseTo(doc.margins.left + doc.measure, 6);
      expect(pillY + pillHeight).toBeLessThanOrEqual(doc.getYPos());
      const [x1, , x2] = line.mock.calls[0] as number[];
      expect(Math.max(x1, x2)).toBeLessThanOrEqual(pillX);
    });

    it('puts the value under the label when the label would keep less than its minimum share', () => {
      const doc = makeDoc();
      const width = 30;
      const row = (valueRoom: number) =>
        layoutLeaderRow(doc, {
          label: 'Capital',
          labelStyle: resolveTextStyle(doc, 'body'),
          value: { text: '1', style: resolveTextStyle(doc, 'bodyBold') },
          width,
          lineHeight: 5,
          minRun: FIELD.leaderMinRun,
          valueRoom,
        });
      // Under the side limit, but the label would keep 30 - 13.5 - 10 = 6.5 mm, below 25 % of the row.
      expect(30 - 13.5 - FIELD.leaderMinRun - 2 * LEADER.gap).toBeLessThan(width * LEADER.labelMinRatio);
      const squeezed = row(13.5);
      expect(squeezed.placement).toBe('below');
      expect(squeezed.labelLines).toHaveLength(1);
      expect(squeezed.labelLines[0].text).toBe('Capital');
      expect(row(10).placement).toBe('beside');
    });

    it('wraps a long label before the value and keeps the dots on its last line', () => {
      const doc = makeDoc({ measure: 100 });
      const line = vi.spyOn(doc.doc, 'line');
      const text = vi.spyOn(doc.doc, 'text');
      drawFields(doc, [{ label: LONG_LABEL, value: 'Paris' }], { layout: 'leader' });
      const ys = text.mock.calls.map(([, , y]) => y as number);
      expect(new Set(ys).size).toBeGreaterThan(1);
      expect(line.mock.calls[0][1]).toBeCloseTo(Math.max(...ys), 6);
    });
  });

  it('does not draw leaders in the stacked layout', () => {
    const doc = makeDoc();
    const line = vi.spyOn(doc.doc, 'line');
    drawFields(doc, [{ label: 'A', value: 'B' }]);
    expect(line).not.toHaveBeenCalled();
  });
});
