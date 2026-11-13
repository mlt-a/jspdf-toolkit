import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  BADGE,
  CHART,
  CHECKBOX,
  COVER,
  FONT_ROLES,
  LOGO,
  HEADING_LEVELS,
  TEXT_LEVELS,
  capitalMiddle,
  centerOnCapitals,
  lineHeightMm,
  PT_TO_MM,
} from '../../src/core/constants';
import type { FontRole, TextLevel } from '../../src/core/constants';
import type { FontRole as ExposedFontRole } from '../../src/drawing/text-style';

describe('lineHeightMm', () => {
  it('is jsPDF line advance in mm: size × factor × scale', () => {
    expect(lineHeightMm(10, 1.3)).toBeCloseTo(10 * PT_TO_MM * 1.3);
    expect(lineHeightMm(10, 1.3, 1.5)).toBeCloseTo(10 * PT_TO_MM * 1.3 * 1.5);
  });
});

describe('capitalMiddle and centerOnCapitals', () => {
  it('put the middle of the capitals half an ascent above the baseline: 0.72 em, from a size or from metrics', () => {
    expect(capitalMiddle(10)).toBeCloseTo(1.27, 3);
    expect(capitalMiddle(20)).toBeCloseTo(2.54, 3);
    expect(capitalMiddle({ ascent: 3 })).toBe(1.5);
  });

  it('centre a mark on that middle: its top is half its size above it', () => {
    expect(centerOnCapitals(50, 10, 4)).toBeCloseTo(46.73, 3);
    expect(centerOnCapitals(50, { ascent: 3 }, 4)).toBe(46.5);
  });
});

describe('TEXT_LEVELS', () => {
  it('lists the 14 text levels once each, the heading levels first', () => {
    expect(TEXT_LEVELS).toHaveLength(14);
    expect(new Set(TEXT_LEVELS).size).toBe(14);
    // Checked by the type-check: the list is every `TextLevel`, nothing else.
    expectTypeOf<(typeof TEXT_LEVELS)[number]>().toEqualTypeOf<TextLevel>();
    expect(TEXT_LEVELS.slice(0, HEADING_LEVELS.length)).toEqual(HEADING_LEVELS);
  });
});

describe('FONT_ROLES', () => {
  it('lists the three font roles once each', () => {
    expect([...FONT_ROLES]).toEqual(['body', 'title', 'label']);
    // Checked by the type-check: the list is every `FontRole`, nothing else, and `text-style` exposes the same type.
    expectTypeOf<(typeof FONT_ROLES)[number]>().toEqualTypeOf<FontRole>();
    expectTypeOf<ExposedFontRole>().toEqualTypeOf<FontRole>();
  });
});

// The public JSDoc writes these defaults as numbers: the constants are not exported. A changed constant fails here,
// so its JSDoc is changed with it.
describe('the defaults the public JSDoc writes', () => {
  it.each([
    ['DonutChartOptions.innerRatio', CHART.donut.innerRatio, 0.62],
    ['StackedBarOptions.height', CHART.stackedBar.height, 9],
    ['ChartColumn.label, lines', CHART.column.labelLines, 2],
    ['ColumnChartOptions.height', CHART.column.height, 42],
    ['ColumnChartOptions.reference, label share', CHART.column.referenceLabelShare, 1 / 3],
    ['ChartLine.lineWidth', CHART.line.lineWidth, 0.5],
    ['LineChartOptions, narrowest plot', CHART.line.minPlotWidth, 10],
    ['LineChartOptions.height', CHART.line.height, 62],
    ['LineChartOptions.yTicks', CHART.line.yTicks, 4],
    ['LineChartOptions.xTicks', CHART.line.xTicks, 6],
    ['LogoPosition.height', LOGO.height, 15],
    ['PDFDocument.badge, gap under a heading', BADGE.headingGap, 2],
    ['CheckboxOptions.spaceAfter, gap between consecutive checkboxes', CHECKBOX.groupGap, 2],
    ['the back cover inset: logo, contact, legal text', COVER.backInset, 20],
  ])('%s', (_where, constant, written) => {
    expect(constant).toBe(written);
  });
});
