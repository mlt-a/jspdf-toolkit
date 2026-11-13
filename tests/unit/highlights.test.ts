import { describe, expect, it, vi } from 'vitest';

import { drawHighlightedText, measureHighlightedText } from '../../src/drawing/highlights';
import { setTextStyle } from '../../src/drawing/text';
import { channels, makeDoc } from './helpers';

describe('drawHighlightedText', () => {
  it('restores font, size and text color after a strong highlight', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const before = {
      font: doc.doc.getFont().fontStyle,
      size: doc.doc.getFontSize(),
      color: doc.doc.getTextColor(),
    };
    drawHighlightedText(doc, 'Total', { x: doc.margins.left, y: 40, strong: true });
    expect(doc.doc.getFont().fontStyle).toBe(before.font);
    expect(doc.doc.getFontSize()).toBe(before.size);
    // jsPDF stores colors with 3 decimals, so the round trip may shift a channel by one.
    channels(doc.doc.getTextColor()).forEach((channel, i) => {
      expect(Math.abs(channel - channels(before.color)[i])).toBeLessThanOrEqual(1);
    });
  });

  it('takes the top of the pill and returns the Y under it', () => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    const metrics = measureHighlightedText(doc, 'Total');
    expect(drawHighlightedText(doc, 'Total', { x: doc.margins.left, y: 40, metrics })).toBeCloseTo(40 + metrics.height);
    expect(rect.mock.calls[0][1]).toBe(40);
  });
});
