import { describe, expect, it } from 'vitest';

import { LIST, SPACING } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import { drawBulletList, drawNumberedList } from '../../src/drawing/lists';
import { drawRichBlocks, listPrefixes } from '../../src/drawing/rich';
import { measureTextLevel, resolveTextStyle, setTextStyle } from '../../src/drawing/text';
import { type DrawnText, makeDoc, recordTexts, watchDrawing } from './helpers';

/** Where the text of item 1 starts, and the call that drew the number `prefix`, if any. */
function firstTextX(doc: PDFDocument, draw: () => void, prefix?: string): { prefixCall?: DrawnText; textX: number } {
  const drawn = recordTexts(doc);
  draw();
  const textCall = drawn.find(({ lines }) => lines[0] === 'Item 1');
  expect(textCall, 'the text of item 1 was drawn').toBeDefined();
  return { prefixCall: drawn.find(({ lines }) => lines[0] === prefix), textX: textCall!.x };
}

describe('numbered list prefix', () => {
  const items = Array.from({ length: 120 }, (_, index) => `Item ${index + 1}`);

  it.each([
    [
      'rich',
      (doc: PDFDocument) => drawRichBlocks(doc, [{ type: 'numberedList', items: items.map((i) => [{ text: i }]) }]),
    ],
    ['numbered', (doc: PDFDocument) => drawNumberedList(doc, items)],
  ])('indents %s list text after the widest number', (_, draw) => {
    const doc = makeDoc();
    const { prefixCall, textX } = firstTextX(
      doc,
      () => {
        draw(doc);
      },
      '120.',
    );
    // Without the number drawn, there is no width to compare the text with.
    expect(prefixCall, 'the number 120. was drawn').toBeDefined();
    setTextStyle(doc, 'body');
    expect(textX).toBeGreaterThan(prefixCall!.x + doc.doc.getTextWidth('120.'));
  });

  it('keeps the default width for a short list', () => {
    const doc = makeDoc();
    const { textX } = firstTextX(doc, () => {
      drawNumberedList(doc, ['Item 1']);
    });
    expect(textX).toBeCloseTo(doc.margins.left + LIST.numberedPrefixWidth);
  });
});

describe('list prefix widths', () => {
  it('keeps text after a wide bullet', () => {
    const doc = makeDoc();
    const drawn = recordTexts(doc);
    drawBulletList(doc, ['Item'], { bulletChar: '>>>>>>>>' });
    const bullet = drawn.find(({ lines }) => lines[0] === '>>>>>>>>')!;
    const textX = drawn.find(({ lines }) => lines[0] === 'Item')!.x;
    setTextStyle(doc, 'body');
    const bulletX = bullet.x;
    const bulletWidth = doc.doc.getTextWidth('>>>>>>>>');
    expect(bulletWidth).toBeGreaterThan(LIST.bulletPrefixWidth);
    expect(textX).toBeGreaterThanOrEqual(bulletX + bulletWidth);
  });

  it('reserves the width of 88. for a list of 90', () => {
    const doc = makeDoc();
    const style = resolveTextStyle(doc, 'body');
    const { width } = listPrefixes(doc, style, true, 90)(0);
    doc.doc.setFont(style.family, style.fontStyle);
    doc.doc.setFontSize(style.size);
    expect(width).toBeGreaterThanOrEqual(doc.doc.getTextWidth('88.'));
  });
});

const body = (doc: PDFDocument) => measureTextLevel(doc, 'body');

describe('drawNumberedList', () => {
  it('numbers the items from 1 in the gutter, with their text after it', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    drawNumberedList(doc, ['First', 'Second', 'Third']);
    const drawn = texts.map(({ lines, x }) => ({ value: lines[0], x }));
    expect(drawn.map(({ value }) => value)).toEqual(['1.', 'First', '2.', 'Second', '3.', 'Third']);
    for (const { value, x } of drawn) {
      const isNumber = /^\d+\.$/.test(value);
      expect(x).toBeCloseTo(doc.margins.left + (isNumber ? 0 : LIST.numberedPrefixWidth), 6);
    }
  });

  it('returns the Y under the list: lines, the space between items, then spaceAfter', () => {
    const doc = makeDoc();
    const startY = doc.getYPos();
    const line = body(doc).lineHeight;
    const end = drawNumberedList(doc, ['A', 'B', 'C']);
    expect(end).toBeCloseTo(startY + 3 * line + 2 * SPACING.xsmall + SPACING.medium, 6);
    expect(doc.getYPos()).toBe(end);

    const custom = drawNumberedList(doc, ['A', 'B', 'C'], { itemSpacing: 3, spaceAfter: 0 });
    expect(custom).toBeCloseTo(end + 3 * line + 2 * 3, 6);
  });

  it('indents the list and wraps its items in the width that is left', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    drawNumberedList(
      doc,
      ['The undersigned confirms every regulatory filing required under applicable law. '.repeat(3)],
      {
        indent: 15,
      },
    );
    expect(texts[0].lines).toEqual(['1.']);
    expect(texts[0].x).toBeCloseTo(doc.margins.left + 15, 6);
    const wrapped = texts.slice(1);
    expect(wrapped.length).toBeGreaterThan(1);
    setTextStyle(doc, 'body');
    for (const { lines, x } of wrapped) {
      expect(x + doc.doc.getTextWidth(lines[0])).toBeLessThanOrEqual(doc.margins.left + doc.measure);
      expect(x).toBeCloseTo(doc.margins.left + 15 + LIST.numberedPrefixWidth, 6);
    }
  });

  it('draws sub-items under their item, each behind a dash and indented', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    drawNumberedList(doc, [{ text: 'Parent', subItems: ['Child one', 'Child two'] }]);
    const parent = texts.find(({ lines }) => lines[0] === 'Parent')!;
    const children = texts.filter(({ lines }) => lines[0].startsWith('Child'));
    const dashes = texts.filter(({ lines }) => lines[0] === '-');
    expect(children).toHaveLength(2);
    expect(dashes).toHaveLength(2);
    for (const dash of dashes) expect(dash.x).toBeCloseTo(doc.margins.left + LIST.subIndent, 6);
    for (const child of children)
      expect(child.x).toBeCloseTo(doc.margins.left + LIST.subIndent + LIST.bulletPrefixWidth, 6);
    expect(children[0].y).toBeGreaterThan(parent.y);
    expect(children[1].y).toBeGreaterThan(children[0].y);
  });

  it('keeps counting on the next page when the list is longer than one', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    drawNumberedList(
      doc,
      Array.from({ length: 80 }, (_, index) => `Item ${index + 1}`),
    );
    const numbers = texts.filter(({ lines }) => /^\d+\.$/.test(lines[0]));
    expect(numbers.map(({ lines }) => lines[0])).toEqual(Array.from({ length: 80 }, (_, index) => `${index + 1}.`));
    expect(numbers[0].page).toBe(1);
    expect(numbers.at(-1)!.page).toBeGreaterThan(1);
    expect(numbers.find(({ page }) => page === 2)!.y).toBeCloseTo(doc.margins.top + body(doc).ascent, 6);
  });

  it('leaves the position, and the headings waiting for a block, alone for an empty list', () => {
    // Under some content: `addSpace` does nothing at the top of a page, which would hide added space.
    const doc = makeDoc();
    doc.paragraph('Body').heading('Waiting');
    const startY = doc.peekYPos();
    expect(drawNumberedList(doc, [])).toBe(startY);
    // `getYPos` places the waiting heading and moves the position: it must not have been called.
    expect(doc.peekYPos()).toBe(startY);
  });
});

// The options a list refuses are in `option-validation.test.ts`.
describe('an empty list', () => {
  it('draws nothing, and leaves the position and a waiting heading alone', () => {
    const doc = makeDoc();
    doc.paragraph('Body').heading('Waiting');
    const startY = doc.peekYPos();
    const drawing = watchDrawing(doc);
    expect(doc.bulletList([], { indent: 10 }).iconList([], { icon: 'mark' }).peekYPos()).toBe(startY);
    drawing.nothingDrawn();
  });
});

/** Height (mm) a bullet list of one item takes. */
function listHeight(item: Parameters<typeof drawBulletList>[1][number]): number {
  const doc = makeDoc();
  const start = doc.getYPos();
  drawBulletList(doc, [item], { spaceAfter: 0 });
  return doc.getYPos() - start;
}

describe('list item detail', () => {
  it('gives an empty detail no room, like no detail', () => {
    expect(listHeight({ text: 'Item', detail: '' })).toBe(listHeight('Item'));
    expect(listHeight({ text: 'Item', detail: 'Detail.' })).toBeGreaterThan(listHeight('Item'));
  });
});
