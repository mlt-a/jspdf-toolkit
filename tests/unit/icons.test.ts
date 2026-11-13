import { describe, expect, it, vi } from 'vitest';

import { drawIconWithText } from '../../src/drawing/icons';
import { measureTextLevel, setTextStyle } from '../../src/drawing/text';
import { PNG, makeDoc } from './helpers';

describe('drawIconWithText', () => {
  const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '.repeat(4);

  it('wraps within the reading column by default and returns the Y under the text', () => {
    const doc = makeDoc();
    const calls = vi.spyOn(doc.doc, 'text');
    const x = doc.margins.left;
    const bottom = drawIconWithText(doc, text, { x, y: 40, icon: PNG });
    const lines = calls.mock.calls[0][0] as string[];
    expect(lines.length).toBeGreaterThan(1);
    const textX = Number(calls.mock.calls[0][1]);
    setTextStyle(doc, 'body');
    for (const line of lines) expect(textX + doc.doc.getTextWidth(line)).toBeLessThanOrEqual(x + doc.measure + 0.01);
    expect(bottom).toBeCloseTo(40 + lines.length * measureTextLevel(doc, 'body').lineHeight, 6);
  });
});

// The options it refuses are in `option-validation.test.ts`.
describe('drawIconWithText width', () => {
  it('accepts an icon and a gap that leave the text some width', () => {
    const doc = makeDoc();
    expect(() =>
      drawIconWithText(doc, 'Phone', { x: 10, y: 10, icon: PNG, maxWidth: 5.5, iconSize: 3, gap: 2 }),
    ).not.toThrow();
  });
});
