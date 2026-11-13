import { describe, expect, it, vi } from 'vitest';

import { BOX } from '../../src/core/constants';
import type { AddressLine } from '../../src/drawing/address';
import { parseAddressLines } from '../../src/drawing/address';
import { setTextStyle } from '../../src/drawing/text';
import { LONG, makeDoc, watchDrawing } from './helpers';

const lines = (address: string): AddressLine[] => [
  { text: 'Acme Corp', role: 'title' },
  { text: address, role: 'address' },
];

describe('address block', () => {
  it('wraps a line wider than the box, and grows with it', () => {
    const doc = makeDoc();
    const texts = vi.spyOn(doc.doc, 'text');
    const startY = doc.getYPos();
    doc.addressBlock(lines('42 Innovation Avenue'));
    const shortHeight = doc.getYPos() - startY;

    const wide = makeDoc();
    const wideTexts = vi.spyOn(wide.doc, 'text');
    // Half the measure, to make the long line wrap.
    wide.inset({ width: wide.measure / 2 }, () => wide.addressBlock(lines(LONG)));
    expect(wide.getYPos() - startY).toBeGreaterThan(shortHeight);
    expect(wideTexts.mock.calls.length).toBeGreaterThan(texts.mock.calls.length);
    setTextStyle(wide, 'body');
    for (const [value, x] of wideTexts.mock.calls) {
      const width = wide.doc.getTextWidth(String(value));
      expect(Number(x) + width).toBeLessThanOrEqual(wide.margins.left + wide.measure / 2);
    }
  });
});

// The options it refuses are in `option-validation.test.ts`.
describe('address block options', () => {
  it('accepts the narrowest frame that leaves some text width', () => {
    const doc = makeDoc();
    expect(() =>
      doc.inset({ width: BOX.padding * 2 + 1 }, () => doc.addressBlock(lines('1 Main Street'))),
    ).not.toThrow();
  });

  it('takes the measure of its frame: the whole measure by default, the inset inside one', () => {
    const doc = makeDoc({ measure: 120 });
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    doc.addressBlock(lines('1 Main Street'));
    doc.inset({ left: 20, width: 80 }, () => doc.addressBlock(lines('1 Main Street')));
    const [whole, inset] = rect.mock.calls.map(([x, , width]) => ({ x: Number(x), width: Number(width) }));
    expect(whole).toEqual({ x: doc.margins.left, width: 120 });
    expect(inset).toEqual({ x: doc.margins.left + 20, width: 80 });
  });

  it('draws nothing for no line, and leaves the position and a waiting heading alone', () => {
    const doc = makeDoc();
    doc.paragraph('Body').heading('Waiting');
    const startY = doc.peekYPos();
    const drawing = watchDrawing(doc);
    expect(doc.inset({ width: 60 }, () => doc.addressBlock([])).peekYPos()).toBe(startY);
    drawing.nothingDrawn();
  });
});

describe('parseAddressLines', () => {
  const address = 'Acme Corp\nSupplier\n\n1 Main Street\n   \nSpringfield';

  it('takes the first line as the title and the others as address lines, blank lines dropped', () => {
    expect(parseAddressLines(address)).toEqual([
      { text: 'Acme Corp', role: 'title' },
      { text: 'Supplier', role: 'address' },
      { text: '1 Main Street', role: 'address' },
      { text: 'Springfield', role: 'address' },
    ]);
  });

  it('takes the second line as the subtitle when asked', () => {
    expect(parseAddressLines(address, { hasSubtitle: true })).toEqual([
      { text: 'Acme Corp', role: 'title' },
      { text: 'Supplier', role: 'subtitle' },
      { text: '1 Main Street', role: 'address' },
      { text: 'Springfield', role: 'address' },
    ]);
  });

  it('has no subtitle to take from a one-line address', () => {
    expect(parseAddressLines('Acme Corp', { hasSubtitle: true })).toEqual([{ text: 'Acme Corp', role: 'title' }]);
  });

  it('gives no line for a blank address', () => {
    expect(parseAddressLines('')).toEqual([]);
    expect(parseAddressLines('\n  \n')).toEqual([]);
  });
});
