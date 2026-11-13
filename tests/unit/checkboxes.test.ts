import { describe, expect, it, vi } from 'vitest';

import { ANSWER_BADGE, CHECKBOX } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import { InvalidColorError } from '../../src/core/errors';
import { drawCheckbox, drawInlineQuestion } from '../../src/drawing/checkboxes';
import { measureTextLevel, setTextStyle } from '../../src/drawing/text';
import { createTheme } from '../../src/theme/defaults';
import type { ColorInput } from '../../src/theme/types';
import { LONG, expectTextWithin, inFirstOfTwoColumns, leaveRoom, makeDoc, recordTexts, strokedShapes } from './helpers';

describe('drawCheckboxIcon', () => {
  it('strokes the box and its mark with round ends, which the lines drawn after it do not get, on any page', () => {
    const doc = makeDoc();
    drawCheckbox(doc, 'Option', { variant: 'checked' });
    const [box, ...marks] = strokedShapes(doc, 1);
    expect(marks).toHaveLength(2);
    for (const stroke of [box, ...marks]) expect(stroke).toMatchObject({ cap: 1, join: 1 });
    doc.doc.line(10, 10, 50, 10);
    // jsPDF writes the cap and join it keeps at the top of a new page.
    doc.doc.addPage();
    doc.doc.line(10, 10, 50, 10);
    expect(strokedShapes(doc, 1).at(-1)).toMatchObject({ cap: 0, join: 0 });
    expect(strokedShapes(doc, 2)).toMatchObject([{ cap: 0, join: 0 }]);
  });
});

/** The stroke color in force when each box (`roundedRect`) and mark stroke (`line`) of `draw` is drawn. */
function strokeColors(draw: (doc: PDFDocument) => void): { box: string[]; marks: string[] } {
  const doc = makeDoc();
  const colors = { box: [] as string[], marks: [] as string[] };
  for (const [method, into] of [
    ['roundedRect', colors.box],
    ['line', colors.marks],
  ] as const) {
    const original = doc.doc[method].bind(doc.doc) as (...args: unknown[]) => unknown;
    vi.spyOn(doc.doc, method).mockImplementation(((...args: unknown[]) => {
      into.push(doc.doc.getDrawColor());
      return original(...args);
    }) as never);
  }
  draw(doc);
  return colors;
}

/** Every box and mark stroke was drawn in `expected`, as jsPDF reads it back: its color round trip is not exact. */
function expectStrokedIn(colors: { box: string[]; marks: string[] }, expected: string, marks: number): void {
  const reference = makeDoc();
  reference.doc.setDrawColor(expected);
  expect(colors.box).toHaveLength(1);
  expect(colors.marks).toHaveLength(marks);
  for (const color of [...colors.box, ...colors.marks]) expect(color).toBe(reference.doc.getDrawColor());
}

describe('checkbox colors', () => {
  const { colors } = makeDoc().theme;

  it.each([
    ['checked', colors.primary, 2],
    ['empty', colors.secondary, 0],
    ['cross', colors.error, 2],
  ] as const)('strokes the %s checkbox in the color of its variant', (variant, color, marks) => {
    expectStrokedIn(
      strokeColors((d) => drawCheckbox(d, 'a', { variant })),
      color,
      marks,
    );
  });

  it.each([
    ['checked', colors.success, 2],
    ['empty', colors.secondary, 0],
    ['cross', colors.error, 2],
  ] as const)('strokes the %s inline question badge in the color of its variant', (variant, color, marks) => {
    expectStrokedIn(
      strokeColors((d) => drawInlineQuestion(d, 'q', { variant })),
      color,
      marks,
    );
  });

  it('honors the color option on both blocks, hex and palette tokens alike', () => {
    expectStrokedIn(
      strokeColors((d) => drawCheckbox(d, 'a', { variant: 'checked', color: '#abc' })),
      '#aabbcc',
      2,
    );
    expectStrokedIn(
      strokeColors((d) => drawCheckbox(d, 'a', { variant: 'checked', color: 'error' })),
      colors.error,
      2,
    );
    expectStrokedIn(
      strokeColors((d) => drawInlineQuestion(d, 'q', { variant: 'checked', color: 'error' })),
      colors.error,
      2,
    );
  });
});

/** The strokes of the mark inside the box of a checkbox. */
function markStrokes(variant: 'checked' | 'cross'): [x1: number, y1: number, x2: number, y2: number][] {
  const doc = makeDoc();
  const line = vi.spyOn(doc.doc, 'line');
  drawCheckbox(doc, 'x', { variant });
  return line.mock.calls.map(([x1, y1, x2, y2]) => [x1, y1, x2, y2]);
}

/**
 * A theme whose `small` and `body` levels are 10 and 20 pt: the middle of their capitals is 1.27 and 2.54 mm above
 * the baseline (an ascent of 0.72 em).
 */
const roundSizes = () => makeDoc({ theme: createTheme({ typography: { sizes: { small: 10, body: 20 } } }) });
const CAPITALS_MIDDLE = { small: 1.27, body: 2.54 } as const;

describe('drawCheckbox', () => {
  it('draws the label after the box and returns the Y under the line', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const startY = doc.getYPos();
    const body = measureTextLevel(doc, 'body');
    const end = drawCheckbox(doc, 'Agreed');
    expect(texts).toHaveLength(1);
    expect(texts[0].lines).toEqual(['Agreed']);
    expect(texts[0].x).toBeCloseTo(doc.margins.left + CHECKBOX.size + CHECKBOX.gap, 6);
    expect(texts[0].y).toBeCloseTo(startY + body.ascent, 6);
    expect(end).toBeCloseTo(startY + body.lineHeight + doc.theme.spacing.block, 6);
    expect(doc.getYPos()).toBe(end);
  });

  it('sits the box at the left margin', () => {
    const doc = makeDoc();
    const box = vi.spyOn(doc.doc, 'roundedRect');
    drawCheckbox(doc, 'Agreed');
    expect(box.mock.calls[0][0]).toBeCloseTo(doc.margins.left, 6);
  });

  it('centres the box on the capitals of its label, whatever its level', () => {
    const doc = roundSizes();
    const box = vi.spyOn(doc.doc, 'roundedRect');
    const texts = recordTexts(doc);
    for (const level of ['small', 'body'] as const) {
      drawCheckbox(doc, 'Agreed', { level });
      const [, boxY, size] = box.mock.calls.at(-1) as number[];
      expect(boxY + size / 2).toBeCloseTo(texts.at(-1)!.y - CAPITALS_MIDDLE[level], 3);
    }
  });

  it.each([
    ['checked', 2],
    ['cross', 2],
    ['empty', 0],
  ] as const)('draws the %s box with %i strokes inside it', (variant, strokes) => {
    const doc = makeDoc();
    const box = vi.spyOn(doc.doc, 'roundedRect');
    const line = vi.spyOn(doc.doc, 'line');
    drawCheckbox(doc, 'x', { variant });
    expect(box).toHaveBeenCalledTimes(1);
    expect(line).toHaveBeenCalledTimes(strokes);
    const [boxX, boxY, size] = box.mock.calls[0] as number[];
    expect(size).toBe(CHECKBOX.size);
    for (const [x1, y1, x2, y2] of line.mock.calls) {
      for (const x of [x1, x2]) expect(x).toBeGreaterThan(boxX);
      for (const x of [x1, x2]) expect(x).toBeLessThan(boxX + size);
      for (const y of [y1, y2]) expect(y).toBeGreaterThan(boxY);
      for (const y of [y1, y2]) expect(y).toBeLessThan(boxY + size);
    }
  });

  it('draws a tick as two strokes that both head right, and a cross as one that heads right and one that heads left', () => {
    const tick = markStrokes('checked');
    expect(tick).toHaveLength(2);
    expect(tick.filter(([x1, , x2]) => x2 > x1)).toHaveLength(2);

    const cross = markStrokes('cross');
    expect(cross).toHaveLength(2);
    expect(cross.filter(([x1, , x2]) => x2 > x1)).toHaveLength(1);
    expect(cross.filter(([x1, , x2]) => x2 < x1)).toHaveLength(1);
  });

  it('follows the text level and spaceAfter in the position it returns', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const startY = doc.getYPos();
    const small = measureTextLevel(doc, 'small');
    const end = drawCheckbox(doc, 'Fine print', { level: 'small', spaceAfter: 5 });
    expect(texts[0].y).toBeCloseTo(startY + small.ascent, 6);
    expect(end).toBeCloseTo(startY + small.lineHeight + 5, 6);
  });

  it('moves to the next page when the line does not fit above the bottom margin', () => {
    const doc = makeDoc();
    doc.paragraph('Intro');
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 1);
    const texts = recordTexts(doc);
    drawCheckbox(doc, 'Late');
    expect(texts[0].page).toBe(2);
    expect(texts[0].y).toBeCloseTo(doc.margins.top + measureTextLevel(doc, 'body').ascent, 6);
  });

  describe('a long label', () => {
    it('wraps to what the box leaves of the measure, under its own first line', () => {
      const doc = roundSizes();
      const texts = recordTexts(doc);
      const box = vi.spyOn(doc.doc, 'roundedRect');
      const startY = doc.getYPos();
      const { lineHeight } = measureTextLevel(doc, 'body');
      const end = drawCheckbox(doc, LONG);
      const { lines, x, y } = texts[0];
      expect(lines.length).toBeGreaterThan(1);
      expect(x).toBeCloseTo(doc.margins.left + CHECKBOX.size + CHECKBOX.gap, 6);
      expectTextWithin(texts, x, doc.margins.left + doc.measure);
      // One box, on the first line; the block is as tall as its lines.
      expect(box).toHaveBeenCalledTimes(1);
      const [, boxY, size] = box.mock.calls[0] as number[];
      expect(boxY + size / 2).toBeCloseTo(y - CAPITALS_MIDDLE.body, 3);
      expect(end).toBeCloseTo(startY + lines.length * lineHeight + doc.theme.spacing.block, 6);
    });

    it('wraps to the measure option', () => {
      const doc = makeDoc({ measure: 90 });
      const texts = recordTexts(doc);
      drawCheckbox(doc, LONG);
      expectTextWithin(texts, doc.margins.left, doc.margins.left + 90);
    });

    it('wraps to the column it is drawn in, and the next block starts under its last line', () => {
      const doc = makeDoc();
      const texts = recordTexts(doc);
      const column = inFirstOfTwoColumns(doc, (ctx) => ctx.checkbox(LONG));
      const label = texts.find(({ lines }) => lines.join(' ').startsWith('The undersigned'))!;
      expect(label.lines.length).toBeGreaterThan(2);
      expect(label.x).toBeCloseTo(column.left + CHECKBOX.size + CHECKBOX.gap, 6);
      expectTextWithin([label], label.x, column.left + column.width);
      expect(doc.contentBottom()).toBeCloseTo(
        label.y - measureTextLevel(doc, 'body').ascent + label.lines.length * measureTextLevel(doc, 'body').lineHeight,
        6,
      );
    });

    it('moves to the next page whole when its lines do not fit', () => {
      const doc = makeDoc();
      const lineHeight = measureTextLevel(doc, 'body').lineHeight;
      leaveRoom(doc, 2 * lineHeight);
      const texts = recordTexts(doc);
      drawCheckbox(doc, LONG);
      expect(texts[0].page).toBe(2);
      expect(texts[0].lines.length).toBeGreaterThan(2);
    });

    it('wraps in a measure too narrow for the box, without throwing', () => {
      const doc = makeDoc({ measure: CHECKBOX.size + CHECKBOX.gap + 1 });
      const texts = recordTexts(doc);
      expect(() => drawCheckbox(doc, 'Narrow measure')).not.toThrow();
      expect(texts[0].lines.length).toBeGreaterThan(1);
    });

    it('stays one line for a label that fits', () => {
      const doc = makeDoc();
      const texts = recordTexts(doc);
      drawCheckbox(doc, 'Agreed');
      expect(texts[0].lines).toEqual(['Agreed']);
    });
  });

  it('throws on a color that is neither a palette token nor a hex value', () => {
    expect(() => drawCheckbox(makeDoc(), 'x', { color: 'nope' as ColorInput })).toThrow(InvalidColorError);
  });
});

/** Where the badge box lands while `draw` runs. */
function badgeBox(doc: PDFDocument, draw: () => void) {
  const box = vi.spyOn(doc.doc, 'roundedRect');
  draw();
  const [x, y, size] = box.mock.calls[0] as number[];
  return { x, y, size };
}

/** The text color in force when the answer "Yes" of a checked inline question is drawn. */
function answerColor(color?: 'error'): string | undefined {
  const doc = makeDoc();
  let drawn: string | undefined;
  const original = doc.doc.text.bind(doc.doc);
  vi.spyOn(doc.doc, 'text').mockImplementation(((...args: Parameters<typeof original>) => {
    if (args[0] === 'Yes') drawn = doc.doc.getTextColor();
    return original(...args);
  }) as typeof original);
  drawInlineQuestion(doc, 'Agreed?', { variant: 'checked', answer: 'Yes', color });
  return drawn;
}

/** A color as jsPDF reads it back: its color round trip is not exact. */
function asJsPdfColor(color: string): string {
  const doc = makeDoc();
  doc.doc.setTextColor(color);
  return doc.doc.getTextColor();
}

describe('drawInlineQuestion', () => {
  it('draws the question at the margin and the badge against the right edge', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const badge = badgeBox(doc, () => drawInlineQuestion(doc, 'Agreed?'));
    expect(texts[0].lines).toEqual(['Agreed?']);
    expect(texts[0].x).toBeCloseTo(doc.margins.left, 6);
    expect(badge.size).toBe(ANSWER_BADGE.size);
    expect(badge.x + badge.size).toBeCloseTo(doc.margins.left + doc.measure, 6);
  });

  it('moves the badge left by the width of a bold answer and draws the answer after it', () => {
    const plain = makeDoc();
    const plainBadge = badgeBox(plain, () => drawInlineQuestion(plain, 'Agreed?', { variant: 'checked' }));

    const doc = makeDoc();
    const texts = recordTexts(doc);
    const badge = badgeBox(doc, () => drawInlineQuestion(doc, 'Agreed?', { variant: 'checked', answer: 'Yes' }));
    setTextStyle(doc, 'bodyBold');
    expect(badge.x).toBeCloseTo(plainBadge.x - doc.doc.getTextWidth('Yes') - ANSWER_BADGE.gap, 6);
    const answer = texts.find(({ lines }) => lines[0] === 'Yes')!;
    expect(answer.x).toBeCloseTo(badge.x + badge.size + ANSWER_BADGE.gap, 6);
    // The answer ends on the right edge of the reading column, as the badge does without one.
    expect(answer.x + doc.doc.getTextWidth('Yes')).toBeCloseTo(doc.margins.left + doc.measure, 6);
  });

  it('centres the badge on the capitals of the first line of the question', () => {
    const doc = roundSizes();
    const texts = recordTexts(doc);
    const badge = badgeBox(doc, () => drawInlineQuestion(doc, LONG));
    expect(texts[0].lines.length).toBeGreaterThan(1);
    expect(badge.y + badge.size / 2).toBeCloseTo(texts[0].y - CAPITALS_MIDDLE.body, 3);
  });

  it('wraps a question at the badge, keeping ANSWER_BADGE.questionGap clear of it', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    setTextStyle(doc, 'body');
    // The longest run of narrow letters that fits before the badge: a second one must go to the next line, and
    // would stay on the first if the gap were not kept (a space and a letter are narrower than the gap).
    const room = doc.measure - ANSWER_BADGE.size - ANSWER_BADGE.questionGap;
    let fit = 'i';
    while (doc.doc.getTextWidth(fit + 'i') <= room) fit += 'i';
    drawInlineQuestion(doc, `${fit} i`);
    expect(texts[0].lines).toEqual([fit, 'i']);
  });

  it('draws the answer in the color of the badge', () => {
    expect(answerColor()).toBe(asJsPdfColor(makeDoc().theme.colors.success));
    expect(answerColor('error')).toBe(asJsPdfColor(makeDoc().theme.colors.error));
  });

  it('wraps a long question before the badge and grows by the lines it adds', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const startY = doc.getYPos();
    const question = 'Does the undersigned confirm that every filing has been submitted on time? '.repeat(3).trim();
    const badge = badgeBox(doc, () => drawInlineQuestion(doc, question));
    const { lines } = texts[0];
    expect(lines.length).toBeGreaterThan(1);
    setTextStyle(doc, 'body');
    for (const line of lines) {
      expect(doc.margins.left + doc.doc.getTextWidth(line)).toBeLessThanOrEqual(badge.x - ANSWER_BADGE.questionGap);
    }
    expect(doc.getYPos() - startY).toBeCloseTo(
      lines.length * measureTextLevel(doc, 'body').lineHeight + doc.theme.spacing.block,
      6,
    );
  });

  it('returns the Y under the question, by theme.spacing.block unless spaceAfter says otherwise', () => {
    const doc = makeDoc();
    const line = measureTextLevel(doc, 'body').lineHeight;
    const startY = doc.getYPos();
    expect(drawInlineQuestion(doc, 'Agreed?')).toBeCloseTo(startY + line + doc.theme.spacing.block, 6);
    const next = doc.getYPos();
    expect(drawInlineQuestion(doc, 'Agreed?', { spaceAfter: 0 })).toBeCloseTo(next + line, 6);
  });

  it('moves to the next page when the question does not fit above the bottom margin', () => {
    const doc = makeDoc();
    doc.paragraph('Intro');
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 1);
    const texts = recordTexts(doc);
    drawInlineQuestion(doc, 'Late?');
    expect(texts[0].page).toBe(2);
    expect(texts[0].y).toBeCloseTo(doc.margins.top + measureTextLevel(doc, 'body').ascent, 6);
  });

  it('wraps a long question inside a column, the badge on its right edge and the first line', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const box = vi.spyOn(doc.doc, 'roundedRect');
    const column = inFirstOfTwoColumns(doc, (ctx) => ctx.inlineQuestion(LONG, { answer: 'Yes', variant: 'checked' }));
    const { lines, x } = texts.find((call) => call.lines.join(' ').startsWith('The undersigned'))!;
    expect(lines.length).toBeGreaterThan(2);
    const [badgeX, badgeY, size] = box.mock.calls[0] as number[];
    setTextStyle(doc, 'body');
    for (const line of lines)
      expect(x + doc.doc.getTextWidth(line)).toBeLessThanOrEqual(badgeX - ANSWER_BADGE.questionGap + 0.01);
    setTextStyle(doc, 'bodyBold');
    expect(badgeX + size + ANSWER_BADGE.gap + doc.doc.getTextWidth('Yes')).toBeCloseTo(column.left + column.width, 6);
    // On the first line, not the last.
    expect(badgeY).toBeLessThan(texts[0].y);
  });

  it('names the question width an answer that takes the whole measure leaves', () => {
    const doc = makeDoc({ measure: 20 });
    expect(() => drawInlineQuestion(doc, 'Answered?', { answer: 'A rather long answer' })).toThrow(
      /text width of an inlineQuestion/,
    );
  });

  it('throws on a color that is neither a palette token nor a hex value', () => {
    expect(() => drawInlineQuestion(makeDoc(), 'x', { color: 'nope' as ColorInput })).toThrow(InvalidColorError);
  });
});
