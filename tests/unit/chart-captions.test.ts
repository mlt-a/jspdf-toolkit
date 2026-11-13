import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHART } from '../../src/core/constants';
import { computeColumnChartHeight } from '../../src/drawing/charts';
import type { ChartColumn } from '../../src/drawing/charts';
import { measureTextLevel } from '../../src/drawing/text';
import { expectDrawnHeight, makeDoc, recordTexts, textOf } from './helpers';

// The built-in theme gives `small` and `smallMuted` one size, so no theme can tell the two rows of captions apart.
// Their metrics are scaled here, per level, to check that each row reads the metrics of the level it is drawn in.
const scale = vi.hoisted(() => ({ factors: {} as Partial<Record<string, number>> }));

vi.mock('../../src/drawing/text', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/drawing/text')>();
  return {
    ...original,
    measureTextLevel: (...args: Parameters<typeof original.measureTextLevel>) => {
      const metrics = original.measureTextLevel(...args);
      const factor = scale.factors[args[1]] ?? 1;
      return { lineHeight: metrics.lineHeight * factor, ascent: metrics.ascent * factor };
    },
  };
});

afterEach(() => {
  scale.factors = {};
});

const COLUMNS: ChartColumn[] = [
  { label: 'A label that needs a second line', valueLabel: '20', values: [2] },
  ...Array.from({ length: 5 }, () => ({ label: 'x', valueLabel: '1', values: [1] })),
];

const WITHOUT_VALUES: ChartColumn[] = COLUMNS.map((column) => ({ label: column.label, values: column.values }));

describe('the captions under the columns', () => {
  it.each([
    ['values taller than the labels', { small: 3, smallMuted: 1 }],
    ['labels taller than the values', { small: 1, smallMuted: 2 }],
  ])('give each row the metrics of its own level: %s', (_, factors) => {
    scale.factors = factors;
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const label = measureTextLevel(doc, 'smallMuted');
    const value = measureTextLevel(doc, 'small');
    doc.columnChart(COLUMNS, { height: 30 });

    const center = doc.margins.left + 0.5 * (doc.contentWidth / COLUMNS.length);
    const lines = texts.filter((call) => Math.abs(call.x - center) < 1e-6 && call.lines[0] !== '20');
    expect(lines).toHaveLength(2);
    expect(lines[1].y - lines[0].y).toBeCloseTo(label.lineHeight, 6);
    // The value row starts where the last label line ends, and its baseline is one ascent under that edge.
    const labelsBottom = lines[1].y - label.ascent + label.lineHeight;
    expect(textOf(texts, '20').y - value.ascent).toBeCloseTo(labelsBottom, 6);
  });

  it.each([
    ['values taller than the labels', { small: 3, smallMuted: 1 }],
    ['labels taller than the values', { small: 1, smallMuted: 2 }],
  ])('are as tall as they are drawn: %s', (_, factors) => {
    scale.factors = factors;
    const doc = makeDoc();
    const options = { height: 30, legend: false };
    const label = measureTextLevel(doc, 'smallMuted');
    const value = measureTextLevel(doc, 'small');
    const withValues = computeColumnChartHeight(doc, COLUMNS, options);
    const withoutValues = computeColumnChartHeight(doc, WITHOUT_VALUES, options);
    expect(withoutValues).toBeCloseTo(30 + CHART.captionGap + 2 * label.lineHeight, 6);
    expect(withValues - withoutValues).toBeCloseTo(value.lineHeight, 6);
    expectDrawnHeight(
      computeColumnChartHeight,
      (ctx, columns, drawOptions) => doc.columnChart(columns, drawOptions),
      COLUMNS,
      { ...options, spaceAfter: 0 },
      doc,
    );
  });
});
