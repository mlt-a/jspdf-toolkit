import { describe, expect, it, vi } from 'vitest';

import { BOX, CALLOUT } from '../../src/core/constants';
import { PDFDocument } from '../../src/core/document';
import { computeInfoBoxHeight, drawBox, drawInfoBox } from '../../src/drawing/boxes';
import { setTextStyle } from '../../src/drawing/text';
import { LONG, PNG, channels, expectDrawnHeight, inInset, makeDoc, pageStream } from './helpers';

describe('drawBox', () => {
  it('returns the Y under the box', () => {
    expect(drawBox(makeDoc(), { x: 10, y: 30, width: 50, height: 12, boxStyle: 'tint' })).toBe(42);
  });
});

describe('info box', () => {
  const prefix = 'Preserve all evidence:';
  const content = 'Short intro.';
  const options = {
    title: 'Incident',
    bulletPoints: [`${prefix} ${LONG}`, 'Plain bullet.'],
    boldPrefixes: [prefix],
    spaceAfter: 0,
  };

  it('draws the height it computes with a wrapping bold-prefix bullet', () => {
    expectDrawnHeight(computeInfoBoxHeight, drawInfoBox, content, options);
  });

  it('wraps a bold-prefix bullet over several lines, prefix in bold on the first', () => {
    const doc = makeDoc();
    const styles: string[] = [];
    const original = doc.doc.text.bind(doc.doc);
    const text = vi.spyOn(doc.doc, 'text').mockImplementation(((...args: Parameters<typeof original>) => {
      styles.push(doc.doc.getFont().fontStyle);
      return original(...args);
    }) as typeof original);
    drawInfoBox(doc, content, options);
    const calls = text.mock.calls.map(([value, , y]) => ({ value: String(value), y: y as number }));
    const prefixIndex = calls.findIndex(({ value }) => value === prefix);
    expect(prefixIndex).toBeGreaterThan(0);
    expect(calls[prefixIndex - 1].value).toBe('•');
    expect(styles[prefixIndex]).toBe('bold');
    // The bullet continues over several lines after the prefix line.
    const bulletYs = new Set(calls.slice(prefixIndex).map(({ y }) => y));
    expect(bulletYs.size).toBeGreaterThan(2);
    expect(calls.map(({ value }) => value).join(' ')).toContain('period and the following one.');
  });

  it('matches the prefix across narrow no-break space grouping (locale, e.g. fr-FR)', () => {
    const doc = makeDoc();
    const text = vi.spyOn(doc.doc, 'text');
    drawInfoBox(doc, 'C', {
      title: 'T',
      bulletPoints: ['Total 1 200 € due'],
      boldPrefixes: ['Total 1 200 €'],
    });
    const calls = text.mock.calls.map(([value]) => String(value));
    expect(calls).toContain('Total 1 200 €');
  });
});

/** Right edge (mm) reached by each text call while `fn` runs, the letter spacing included. */
function drawnRightEdges(doc: PDFDocument, fn: () => void): number[] {
  const original = doc.doc.text.bind(doc.doc);
  const edges: number[] = [];
  const spy = vi.spyOn(doc.doc, 'text').mockImplementation(((...args: Parameters<typeof original>) => {
    const [value, x, , options] = args;
    const charSpace = (options as { charSpace?: number } | undefined)?.charSpace ?? 0;
    for (const line of Array.isArray(value) ? value : [String(value)]) {
      edges.push((x as number) + doc.doc.getTextWidth(line) + charSpace * (line.length - 1));
    }
    return original(...args);
  }) as typeof original);
  fn();
  spy.mockRestore();
  return edges;
}

describe('info box title', () => {
  const LONG_TITLE = LONG.slice(0, 110);
  const narrow = { spaceAfter: 0 };
  const frame = { x: 30, width: 90 };

  /** `fn` run in an inset 90 mm wide, from x = 30 mm. */
  const inFrame =
    <A extends unknown[], R>(fn: (ctx: PDFDocument, ...args: A) => R) =>
    (ctx: PDFDocument, ...args: A): R =>
      inInset(ctx, { left: frame.x - ctx.margins.left, width: frame.width }, () => fn(ctx, ...args));

  it.each([
    ['surface', { ...narrow, title: LONG_TITLE }, 4],
    ['surface with an icon', { ...narrow, title: LONG_TITLE, icon: 'img' }, 4],
    ['callout', { ...narrow, variant: 'callout' as const, title: LONG_TITLE }, 5],
  ])('wraps a %s title wider than the box and draws the height it computes', (_name, options, rightPadding) => {
    const doc = makeDoc();
    const compute = inFrame(computeInfoBoxHeight);
    const draw = inFrame(drawInfoBox);
    const short = compute(doc, 'Content.', { ...options, title: 'Title' });
    expect(compute(doc, 'Content.', options)).toBeGreaterThan(short + 4);
    const drawn = expectDrawnHeight(compute, draw, 'Content.', options);
    const edges = drawnRightEdges(drawn, () => draw(drawn, 'Content.', options));
    expect(edges.length).toBeGreaterThan(2);
    for (const edge of edges) expect(edge).toBeLessThanOrEqual(frame.x + frame.width - rightPadding + 0.01);
  });
});

describe('info box icon', () => {
  const options = { icon: 'img', spaceAfter: 0 };

  it.each([
    ['an empty title', ''],
    ['a title', 'Title'],
  ])('draws the icon of a surface box with %s', (_name, title) => {
    const doc = makeDoc().registerImage('img', PNG);
    const image = vi.spyOn(doc.doc, 'addImage');
    drawInfoBox(doc, 'Content.', { ...options, title });
    expect(image).toHaveBeenCalledTimes(1);
  });

  it('draws the height it computes for an icon without a title', () => {
    const doc = makeDoc().registerImage('img', PNG);
    const withIcon = { ...options, title: '' };
    expect(computeInfoBoxHeight(doc, 'Content.', withIcon)).toBeGreaterThan(
      computeInfoBoxHeight(doc, 'Content.', { title: '', spaceAfter: 0 }),
    );
    expectDrawnHeight(computeInfoBoxHeight, drawInfoBox, 'Content.', withIcon);
  });
});

describe('info box without content', () => {
  it('draws a title alone', () => {
    const options = { title: 'Title only', spaceAfter: 0 };
    const withContent = computeInfoBoxHeight(makeDoc(), 'Content.', options);
    expect(computeInfoBoxHeight(makeDoc(), '', options)).toBeLessThan(withContent);
    expectDrawnHeight(computeInfoBoxHeight, drawInfoBox, '', options);
  });
});

describe('callout box', () => {
  const body = { variant: 'callout' as const, spaceAfter: 0 };

  it.each([
    ['content only', body],
    ['an eyebrow, a title and content', { ...body, eyebrow: 'Good to know', title: 'Heads up' }],
    ['a title without an eyebrow', { ...body, title: 'Heads up' }],
    [
      'bullets with a bold prefix, no accent bar',
      {
        ...body,
        title: 'Heads up',
        bulletPoints: [`Keep evidence: ${LONG}`, 'Plain bullet.'],
        boldPrefixes: ['Keep evidence:'],
        accentBar: false,
      },
    ],
    ['an eyebrow wider than the box', { ...body, eyebrow: LONG.slice(0, 120) }],
    ['a custom width and x', { ...body, eyebrow: 'Note', width: 90, x: 30 }],
  ])('draws the height it computes with %s', (_name, options) => {
    expectDrawnHeight(computeInfoBoxHeight, drawInfoBox, LONG, options);
  });

  it('is taller with an eyebrow and with bullets', () => {
    const doc = makeDoc();
    const plain = computeInfoBoxHeight(doc, LONG, body);
    expect(computeInfoBoxHeight(doc, LONG, { ...body, eyebrow: 'Note' })).toBeGreaterThan(plain);
    expect(computeInfoBoxHeight(doc, LONG, { ...body, bulletPoints: ['One', 'Two'] })).toBeGreaterThan(plain);
  });

  it('paints a solid tint without stroke, then the accent bar', () => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    const bar = vi.spyOn(doc.doc, 'rect');
    drawInfoBox(doc, LONG, { ...body, title: 'T' });
    expect(rect.mock.calls[0][6]).toBe('F');
    expect(bar).toHaveBeenCalledTimes(1);
    expect(bar.mock.calls[0][4]).toBe('F');
  });

  it('runs the accent bar down the whole box, clipped to its rounded corners', () => {
    const doc = makeDoc();
    const box = vi.spyOn(doc.doc, 'roundedRect');
    const bar = vi.spyOn(doc.doc, 'rect');
    const clip = vi.spyOn(doc.doc, 'clip');
    drawInfoBox(doc, LONG, { ...body, title: 'T' });
    const [boxX, boxY, boxWidth, boxHeight] = box.mock.calls[0] as number[];
    const [barX, barY, barWidth, barHeight] = bar.mock.calls[0] as number[];
    expect([barX, barY, barHeight]).toEqual([boxX, boxY, boxHeight]);
    expect(barWidth).toBe(CALLOUT.barWidth);
    // The clip path is the box itself, traced without painting, so the bar takes its rounding.
    expect(box.mock.calls[1]).toEqual([boxX, boxY, boxWidth, boxHeight, CALLOUT.radius, CALLOUT.radius, null]);
    expect(clip).toHaveBeenCalledTimes(1);
  });

  it('clips only the accent bar: the text is written after the clip is undone', () => {
    const doc = makeDoc();
    drawInfoBox(doc, LONG, { ...body, title: 'T' });
    const ops = pageStream(doc, 1)
      .split('\n')
      .map((line) => line.trim().split(/\s+/).at(-1));
    const save = ops.indexOf('q');
    const clip = ops.indexOf('W');
    const restore = ops.indexOf('Q');
    // Saved, the box traced as the clip and the path discarded, the bar filled, then the state restored.
    expect(save).toBeGreaterThan(-1);
    expect(ops.slice(clip, clip + 2)).toEqual(['W', 'n']);
    expect(ops.slice(clip + 2, restore)).toEqual(['rg', 're', 'f']);
    expect([save < clip, clip < restore]).toEqual([true, true]);
    expect(ops.filter((op) => op === 'q' || op === 'Q')).toEqual(['q', 'Q']);
    // Every text block comes after the restore.
    expect(ops.indexOf('BT')).toBeGreaterThan(restore);
  });

  it('draws no clip without an accent bar', () => {
    const doc = makeDoc();
    const clip = vi.spyOn(doc.doc, 'clip');
    drawInfoBox(doc, LONG, { ...body, title: 'T', accentBar: false });
    expect(clip).not.toHaveBeenCalled();
  });

  it('draws the eyebrow in capitals and leaves the text style as it found it', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const before = { font: doc.doc.getFont().fontStyle, size: doc.doc.getFontSize(), color: doc.doc.getTextColor() };
    const text = vi.spyOn(doc.doc, 'text');
    drawInfoBox(doc, LONG, { ...body, eyebrow: 'Good to know' });
    expect(text.mock.calls.map(([value]) => String(value))).toContain('GOOD TO KNOW');
    expect(doc.doc.getFont().fontStyle).toBe(before.font);
    expect(doc.doc.getFontSize()).toBe(before.size);
    channels(doc.doc.getTextColor()).forEach((channel, i) => {
      expect(Math.abs(channel - channels(before.color)[i])).toBeLessThanOrEqual(1);
    });
  });

  it('keeps every text inside the box', () => {
    const doc = makeDoc({ measure: 120 });
    const original = doc.doc.text.bind(doc.doc);
    const drawn: { x: number; width: number }[] = [];
    vi.spyOn(doc.doc, 'text').mockImplementation(((...args: Parameters<typeof original>) => {
      const [value, x, , options] = args;
      const charSpace = (options as { charSpace?: number } | undefined)?.charSpace ?? 0;
      for (const line of Array.isArray(value) ? value : [String(value)]) {
        drawn.push({ x: x as number, width: doc.doc.getTextWidth(line) + charSpace * (line.length - 1) });
      }
      return original(...args);
    }) as typeof original);
    drawInfoBox(doc, LONG, {
      variant: 'callout',
      eyebrow: LONG.slice(0, 90),
      title: 'Heads up',
      bulletPoints: [LONG],
    });
    const right = doc.margins.left + doc.measure;
    expect(drawn.length).toBeGreaterThan(5);
    for (const { x, width } of drawn) expect(x + width).toBeLessThanOrEqual(right - BOX.padding + 0.01);
  });
});

describe('info box bullets', () => {
  it('aligns a wrapped bullet line under the text of its first line', () => {
    const doc = makeDoc();
    const text = vi.spyOn(doc.doc, 'text');
    doc.inset({ width: 90 }, () => drawInfoBox(doc, 'Content', { title: 'Title', bulletPoints: [LONG] }));
    const calls = text.mock.calls.map(([value, x]) => ({ value: String(value), x: x as number }));
    const bullet = calls.findIndex(({ value }) => value === '•');
    const [first, second] = calls.slice(bullet + 1, bullet + 3);
    expect(first.value.startsWith('The undersigned')).toBe(true);
    expect(first.x).toBeGreaterThan(calls[bullet].x);
    expect(second.x).toBeCloseTo(first.x);
  });
});

describe('surface box without a title', () => {
  it('draws the content alone when it has no icon, as the callout does', () => {
    const doc = makeDoc();
    const withTitle = computeInfoBoxHeight(doc, 'Content', { title: '' });
    expect(computeInfoBoxHeight(doc, 'Content', {} as unknown as { title: string })).toBe(withTitle);
  });
});

// The frames they refuse are in `option-validation.test.ts`.
describe('width of the frame', () => {
  const SURFACE = { title: 'Box' } as const;
  const CALLOUT_BOX = { variant: 'callout', title: 'Note' } as const;

  describe.each([
    ['surface', SURFACE, BOX.padding * 2],
    ['callout', CALLOUT_BOX, BOX.padding * 2 + CALLOUT.barWidth + CALLOUT.barGap],
  ] as const)('infoBox %s', (_, base, narrowest) => {
    it('names the text width the padding leaves, and accepts one that leaves some', () => {
      const doc = makeDoc();
      expect(() => doc.inset({ width: narrowest }, () => doc.infoBox('Content', base))).toThrow(
        /text width of infoBox/,
      );
      expect(() => doc.inset({ width: narrowest + 1 }, () => doc.infoBox('Content', base))).not.toThrow();
    });

    it('takes the measure of its frame: the inset inside one', () => {
      const doc = makeDoc({ measure: 120 });
      const rect = vi.spyOn(doc.doc, 'roundedRect');
      doc.infoBox('Content', base);
      // A callout clips to a second rounded rectangle after the box: read the box when it is drawn.
      const first = rect.mock.calls[0];
      doc.inset({ left: 20, width: 80 }, () => doc.infoBox('Content', base));
      const second = rect.mock.calls.find(([x]) => Number(x) > doc.margins.left + 1)!;
      expect({ x: first[0], width: first[2] }).toEqual({ x: doc.margins.left, width: 120 });
      expect({ x: second[0], width: second[2] }).toEqual({ x: doc.margins.left + 20, width: 80 });
    });
  });

  it('keeps drawing a box with a zero radius', () => {
    const doc = makeDoc();
    expect(() => drawBox(doc, { x: 10, y: 10, width: 40, height: 20, boxStyle: 'tint', radius: 0 })).not.toThrow();
  });
});
