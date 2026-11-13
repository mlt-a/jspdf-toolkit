import { describe, expect, it, vi } from 'vitest';

import { BOX } from '../../src/core/constants';
import { computeDeclarationsBoxHeight, drawDeclarationsBox } from '../../src/drawing/declarations';
import { setTextStyle } from '../../src/drawing/text';
import { LONG, PNG, expectDrawnHeight, expectTextWithin, inInset, makeDoc, recordTexts } from './helpers';

describe('declarations box', () => {
  it.each([
    [
      'an inline highlight that wraps',
      {
        items: [{ text: LONG, highlights: [{ text: 'binding commitment', strong: true }] }, { text: 'Second item.' }],
        spaceAfter: 0,
      },
    ],
    [
      'an intro, bullets and a long highlight',
      {
        intro: 'The company declares, ' + LONG,
        bullet: true,
        items: [{ text: LONG, highlights: [{ text: LONG.slice(0, 160) }] }, { text: 'Short.' }],
        spaceAfter: 0,
      },
    ],
    [
      'a width and an x',
      { items: [{ text: LONG }], intro: 'The company declares:', icon: PNG, width: 90, x: 60, spaceAfter: 0 },
    ],
  ])('draws the height it computes with %s', (_name, { items, ...options }) => {
    expectDrawnHeight(computeDeclarationsBoxHeight, drawDeclarationsBox, items, options);
  });

  it('places the inline highlight below the first line and draws the text after it', () => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    const words = vi.spyOn(doc.doc, 'text');
    const startY = doc.getYPos();
    drawDeclarationsBox(doc, [
      { text: LONG, highlights: [{ text: 'binding commitment', strong: true }] },
      { text: 'Second item.' },
    ]);
    // Box, then the pill: the highlight sits below the first line, so the item wrapped.
    const pillY = rect.mock.calls[1][1] as number;
    expect(pillY).toBeGreaterThan(startY + 5);
    const drawn = words.mock.calls.map(([value]) => String(value));
    expect(drawn.some((value) => value.endsWith('one.'))).toBe(true);
    expect(drawn).toContain('Second item.');
  });

  it.each([
    ['between two highlights in a row', 'We confirm that Alpha Beta apply.', ['Alpha', 'Beta']],
    ['between a highlight and the text before it', 'We confirm Alpha applies.', ['Alpha']],
  ])('keeps the width of a space %s', (_name, text, highlights) => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    const texts = recordTexts(doc);
    drawDeclarationsBox(doc, [{ text, highlights: highlights.map((highlight) => ({ text: highlight })) }]);
    // The box, then one pill per highlight.
    const [, ...pills] = rect.mock.calls.map(([x, , width]) => ({ x: Number(x), right: Number(x) + Number(width) }));
    const [lead] = texts;
    const before = pills.length > 1 ? pills[0].right : lead.x + lead.widths[0];
    setTextStyle(doc, 'body');
    expect(pills.at(-1)!.x - before).toBeCloseTo(doc.doc.getTextWidth(' '), 6);
  });

  it('starts an item with its highlight at the text edge, with no space before it', () => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    drawDeclarationsBox(doc, [{ text: 'Alpha applies.', highlights: [{ text: 'Alpha' }] }, { text: 'Alpha applies.' }]);
    const [, pill] = rect.mock.calls.map(([x]) => x as number);
    const plainFirst = makeDoc();
    const plain = vi.spyOn(plainFirst.doc, 'text');
    drawDeclarationsBox(plainFirst, [{ text: 'Alpha applies.' }]);
    expect(pill).toBeCloseTo(plain.mock.calls[0][1] as number, 6);
  });

  it('spans the reading column from the left margin by default', () => {
    const doc = makeDoc({ measure: 120 });
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    drawDeclarationsBox(doc, [{ text: 'Item.' }]);
    const [x, , width] = rect.mock.calls[0];
    expect(x).toBe(doc.margins.left);
    expect(width).toBe(120);
  });

  it('draws the box in its inset, and wraps the items inside it', () => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    const texts = recordTexts(doc);
    const left = doc.margins.left;
    doc.inset({ left: 70 - left, width: 80 }, () =>
      drawDeclarationsBox(doc, [{ text: LONG }], { intro: 'The company declares:' }),
    );
    const [x, , width] = rect.mock.calls[0];
    expect(x).toBe(70);
    expect(width).toBe(80);
    // Inside the padding.
    expectTextWithin(texts, 70 + BOX.padding, 150 - BOX.padding);
  });

  it('is taller in a narrower box', () => {
    const doc = makeDoc();
    const items = [{ text: LONG }];
    const narrow = inInset(doc, { width: 80 }, () => computeDeclarationsBoxHeight(doc, items));
    expect(narrow).toBeGreaterThan(computeDeclarationsBoxHeight(doc, items));
  });
});
