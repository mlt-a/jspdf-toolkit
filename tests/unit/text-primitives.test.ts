import { describe, expect, it } from 'vitest';

import { ascentMm, lineHeightMm } from '../../src/core/constants';
import { withDrawingState } from '../../src/drawing/drawing-state';
import { setTextStyle } from '../../src/drawing/text';
import { fitWithEllipsis, wrap } from '../../src/drawing/text-lines';
import { drawText, trackedTextWidth, wrapText } from '../../src/drawing/text-primitives';
import * as publicApi from '../../src/index';
import { mixInk } from '../../src/theme/colors';
import { makeDoc, recordTexts } from './helpers';

describe('the building blocks for custom components', () => {
  it('are exported under their public names', () => {
    expect(publicApi).toMatchObject({
      mixInk,
      withDrawingState,
      fitWithEllipsis,
      ascentMm,
      drawText,
      wrapText,
      trackedTextWidth,
    });
  });
});

describe('drawText', () => {
  it('draws at the baseline it is given, in the current font', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const texts = recordTexts(doc);
    drawText(doc, 'Hello', 20, 40);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ lines: ['Hello'], x: 20, y: 40 });
  });

  it('puts a tracked text on its anchor when it is centred or aligned right, which jsPDF alone does not', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const texts = recordTexts(doc);
    const width = trackedTextWidth(doc, 'Total', 0.6);
    drawText(doc, 'Total', 100, 40, { align: 'center', charSpace: 0.6 });
    drawText(doc, 'Total', 100, 50, { align: 'right', charSpace: 0.6 });
    expect(texts[0].x).toBeCloseTo(100 - width / 2, 6);
    expect(texts[1].x).toBeCloseTo(100 - width, 6);
  });

  it('spaces the lines of an array by the theme line height, scaled by lineHeightScale', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const texts = recordTexts(doc);
    drawText(doc, ['One', 'Two'], 20, 40, { lineHeightScale: 2 });
    drawText(doc, ['One', 'Two'], 100, 40, { align: 'center', charSpace: 0.6, lineHeightScale: 2 });
    const step = lineHeightMm(doc.doc.getFontSize(), doc.theme.typography.lineHeightFactor, 2);
    // A plain call is one jsPDF call for both lines; a tracked, centred one is a call per line.
    expect(texts[0].lines).toEqual(['One', 'Two']);
    expect(texts[2].y - texts[1].y).toBeCloseTo(step, 6);
  });

  it('takes a baseline and a maxWidth', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    expect(() => drawText(doc, 'Hello there', 20, 40, { baseline: 'top', maxWidth: 30 })).not.toThrow();
  });

  it('wraps a tracked, centred or right-aligned text to maxWidth before anchoring each line', () => {
    const value = 'A rather long sentence that needs wrapping to a narrow width';
    for (const align of ['center', 'right'] as const) {
      const doc = makeDoc();
      setTextStyle(doc, 'body');
      const lines = wrapText(doc, value, 30, 0.6);
      expect(lines.length).toBeGreaterThan(1);
      const texts = recordTexts(doc);
      drawText(doc, value, 100, 40, { align, charSpace: 0.6, maxWidth: 30 });
      expect(texts.map((call) => call.lines.join(''))).toEqual(lines);
      texts.forEach((call, index) => {
        const width = trackedTextWidth(doc, lines[index], 0.6);
        expect(call.x).toBeCloseTo(align === 'right' ? 100 - width : 100 - width / 2, 6);
      });
    }
  });
});

describe('wrapText', () => {
  it('wraps as the built-in paragraphs do, a long word included', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const value = 'A short line and an address: someone.with.a.very.long.name@a-quite-long-domain.example.com\nNext';
    const lines = wrapText(doc, value, 40, 0.2);
    expect(lines).toEqual(wrap(doc, value, 40, 0.2));
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(trackedTextWidth(doc, line, 0.2)).toBeLessThanOrEqual(40.001);
  });

  it('defaults to no letter spacing', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    expect(wrapText(doc, 'A line', 100)).toEqual(['A line']);
  });
});

describe('trackedTextWidth', () => {
  it('adds the letter spacing between the letters, not after the last', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    expect(trackedTextWidth(doc, 'Total')).toBeCloseTo(doc.doc.getTextWidth('Total'), 6);
    expect(trackedTextWidth(doc, 'Total', 0.5)).toBeCloseTo(doc.doc.getTextWidth('Total') + 2, 6);
    expect(trackedTextWidth(doc, '', 0.5)).toBe(0);
  });
});

describe('ascentMm', () => {
  it('is the ascent of a free size: the one of its text level when the size is the level one', () => {
    expect(ascentMm(10)).toBeCloseTo(2.54, 2);
    expect(ascentMm(20)).toBeCloseTo(ascentMm(10) * 2, 6);
  });
});
