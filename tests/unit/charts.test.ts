import { describe, expect, it, vi } from 'vitest';

import { CHART, LAYOUT, capitalMiddle } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import { InvalidColorError, InvalidOptionError } from '../../src/core/errors';
import {
  computeColumnChartHeight,
  computeDonutAngles,
  computeDonutChartHeight,
  computeLineChartHeight,
  computeStackedBarHeight,
  drawColumnChart,
  drawDonutChart,
  drawLineChart,
  drawStackedBar,
  niceCeil,
} from '../../src/drawing/charts';
import type {
  ChartColumn,
  ChartSlice,
  ColumnChartOptions,
  LineChartData,
  LineChartOptions,
} from '../../src/drawing/charts';
import { columnWidth } from '../../src/drawing/columns';
import { measureTextLevel } from '../../src/drawing/text';
import { createTheme } from '../../src/theme/defaults';
import {
  LONG,
  expectDrawnHeight,
  expectWithin,
  filledShapes,
  leaveRoom,
  makeDoc,
  recordExtents,
  recordTexts,
  sameColor,
  strokedShapes,
  textOf,
} from './helpers';

const SLICES: ChartSlice[] = [
  { label: 'Equities', value: 60 },
  { label: 'Bonds', value: 30 },
  { label: 'Cash', value: 10 },
];

/** Labels long enough to cut in a narrow column. */
const LONG_SLICES: ChartSlice[] = [
  { label: 'Equities and other listed securities', value: 60, legendValue: '$720,000.00' },
  { label: 'Government and corporate bonds', value: 30 },
  { label: 'Cash', value: 10 },
];

const XS = [2026, 2027, 2028, 2029, 2030];
const LINE = { label: 'Forecast', values: [100, 110, 121, 133, 146] };
const BAND = { label: 'Range', lower: [100, 104, 108, 112, 116], upper: [100, 116, 134, 154, 176] };

const COLUMNS: ChartColumn[] = [
  { label: 'Q1', valueLabel: '120', values: [80, 40] },
  { label: 'Q2', valueLabel: '150', values: [95, 55] },
];
const SERIES = [{ label: 'Licences' }, { label: 'Services' }];

/** Many columns, long labels, a legend and a reference: the widest thing `columnChart` draws. */
const CROWDED_COLUMNS: ChartColumn[] = Array.from({ length: 8 }, (_, index) => ({
  label: `Quarter number ${index + 1} of the financial year`,
  valueLabel: '$1,234,567.00',
  values: [10 + index, 20],
}));

/** Every chart, drawn with data that stresses its width: used for what all of them must do. */
const CHARTS: [string, (ctx: PDFDocument) => unknown][] = [
  ['donutChart', (ctx) => ctx.donutChart(LONG_SLICES, { centerLabel: 'A long label for the hole' })],
  ['donutChart, pie', (ctx) => ctx.donutChart(LONG_SLICES, { innerRatio: 0 })],
  ['stackedBar', (ctx) => ctx.stackedBar(LONG_SLICES)],
  [
    'columnChart',
    (ctx) =>
      ctx.columnChart(CROWDED_COLUMNS, {
        series: [{ label: 'Licences and subscriptions' }, { label: 'Professional services' }],
        reference: { value: 40, label: 'Target for the year' },
      }),
  ],
  [
    'lineChart',
    (ctx) =>
      ctx.lineChart(
        { xs: XS, lines: [LINE, { ...LINE, label: 'Another line with a long name' }], band: BAND },
        {
          xTitle: 'Year',
          yTitle: 'Value',
          highlight: { from: 2027, to: 2029, label: 'Target period for the whole organisation' },
        },
      ),
  ],
];

/** The nothing each chart can be given, and the line of text its `emptyText` draws. */
const EMPTY: [string, (ctx: PDFDocument, emptyText?: string) => unknown][] = [
  ['donutChart', (ctx, emptyText) => ctx.donutChart([{ label: 'A', value: 0 }], { emptyText })],
  ['donutChart, no slice', (ctx, emptyText) => ctx.donutChart([], { emptyText })],
  ['stackedBar', (ctx, emptyText) => ctx.stackedBar([{ label: 'A', value: -2 }], { emptyText })],
  ['stackedBar, not numbers', (ctx, emptyText) => ctx.stackedBar(slices(NaN, Infinity), { emptyText })],
  ['columnChart', (ctx, emptyText) => ctx.columnChart([], { emptyText })],
  [
    'columnChart, no value above zero',
    (ctx, emptyText) =>
      ctx.columnChart(
        [
          { label: 'A', values: [0] },
          { label: 'B', values: [] },
          { label: 'C', values: [-3, Number.NaN] },
        ],
        { emptyText, reference: { value: 10, label: 'Target' }, max: 20 },
      ),
  ],
  ['lineChart, one point', (ctx, emptyText) => ctx.lineChart({ xs: [1], lines: [] }, { emptyText })],
  [
    'lineChart, nothing above zero',
    (ctx, emptyText) =>
      ctx.lineChart(
        { xs: [1, 2], lines: [{ label: 'L', values: [0, 0] }], band: { label: 'B', lower: [0, 0], upper: [0, 0] } },
        { emptyText },
      ),
  ],
];

function slices(...values: number[]): ChartSlice[] {
  return values.map((value, index) => ({ label: `Part ${index + 1}`, value }));
}

/** Every text a chart draws, one per call. */
const drawnTexts = (texts: ReturnType<typeof recordTexts>) => texts.flatMap((call) => call.lines);

/** The jsPDF call arguments of `method` while `draw` runs on a fresh document. */
function callsOf<K extends 'rect' | 'line' | 'moveTo' | 'lineTo' | 'setFillColor'>(
  method: K,
  draw: (doc: PDFDocument) => unknown,
) {
  const doc = makeDoc();
  const spy = vi.spyOn(doc.doc, method);
  draw(doc);
  return { doc, calls: spy.mock.calls as unknown[][] };
}

/** A document whose theme restyles four text levels, each in its own color. */
const themedDoc = () =>
  makeDoc({
    theme: createTheme({
      colors: { primary: '#3572B8' },
      typography: {
        levels: {
          smallMuted: { color: '#ff0000' },
          caption: { color: '#00ff00' },
          small: { color: '#0000ff' },
          bodyBold: { color: '#ff00ff' },
        },
      },
    }),
  });

/** Diameter (mm) of the donut drawn in the first of `count` columns. */
const donutDiameterIn = (count: number) => {
  const doc = makeDoc();
  const moveTo = vi.spyOn(doc.doc, 'moveTo');
  doc.columns(Array.from({ length: count }, (_, at) => (ctx) => (at === 0 ? ctx.donutChart(SLICES) : undefined)));
  // The first point is the top of the ring: its X is the centre, its distance from the left is the radius.
  return (moveTo.mock.calls[0][0] as number) - doc.margins.left;
};

/** The fills of the columns: every filled rectangle drawn. */
const fills = (columns: ChartColumn[], options: ColumnChartOptions = {}) =>
  callsOf('rect', (d) => d.columnChart(columns, { series: undefined, ...options })).calls.filter(
    (call) => call[4] === 'F',
  ) as number[][];

/** The texts a line chart draws. */
const textsOf = (data: LineChartData, options: LineChartOptions = {}) => {
  const doc = makeDoc();
  const texts = recordTexts(doc);
  doc.lineChart(data, options);
  return { doc, texts, drawn: drawnTexts(texts) };
};

/** Number of `line` calls of a line chart with `yTicks` grid lines. */
const lineCalls = (yTicks?: number) =>
  callsOf('line', (d) => d.lineChart({ xs: XS, lines: [LINE] }, { yTicks })).calls.length;

/** What a line chart with a highlight draws. */
const highlightArea = (label?: string) => {
  const doc = makeDoc();
  const texts = recordTexts(doc);
  const fill = vi.spyOn(doc.doc, 'fill');
  doc.lineChart({ xs: XS, lines: [LINE] }, { highlight: { from: 2027, to: 2029, label } });
  return { fills: fill.mock.calls.length, drawn: drawnTexts(texts) };
};

/** Highest point (smallest Y) of the highlighted area over two lines, `High` with or without emphasis. */
const highlightTop = (emphasis: boolean) => {
  const doc = makeDoc();
  const moveTo = vi.spyOn(doc.doc, 'moveTo');
  const lineTo = vi.spyOn(doc.doc, 'lineTo');
  doc.lineChart(
    {
      xs: [1, 2],
      lines: [
        { label: 'Low', values: [1, 1] },
        { label: 'High', values: [10, 10], emphasis },
      ],
    },
    { highlight: { from: 1, to: 2 } },
  );
  // The first path is the highlighted area: its start, then three more points.
  const ys = [moveTo.mock.calls[0], ...lineTo.mock.calls.slice(0, 3)].map(([, y]) => y as number);
  return Math.min(...ys);
};

/** The texts of a line chart of `values`: its Y labels among them. */
const yLabelsOf = (values: number[]) =>
  textsOf({ xs: values.map((_, index) => index), lines: [{ label: 'L', values }] }).drawn;

describe('computeDonutAngles', () => {
  it('starts at the top and covers a full turn', () => {
    const ranges = computeDonutAngles([1, 1, 2]);
    expect(ranges[0].start).toBeCloseTo(-Math.PI / 2, 9);
    expect(ranges[2].end - ranges[0].start).toBeCloseTo(Math.PI * 2, 9);
    expect(ranges[2].end - ranges[2].start).toBeCloseTo(Math.PI, 9);
  });

  it('gives an empty arc to a value of zero or less, and to everything without a total', () => {
    const [negative, positive] = computeDonutAngles([-5, 3]);
    expect(negative.end).toBe(negative.start);
    expect(positive.end - positive.start).toBeCloseTo(Math.PI * 2, 9);
    for (const range of computeDonutAngles([0, 0])) expect(range.end).toBe(range.start);
  });
});

describe('niceCeil', () => {
  it.each([
    [0, 1],
    [-4, 1],
    [1, 1],
    [146, 200],
    [201, 250],
    [260, 500],
    [501, 1000],
    [0.03, 0.05],
  ])('rounds %s up to %s', (value, expected) => {
    expect(niceCeil(value)).toBeCloseTo(expected, 9);
  });
});

describe.each(CHARTS)('%s', (_name, draw) => {
  it('takes the height it reserves, plus the block space', () => {
    const doc = makeDoc();
    doc.paragraph('Intro');
    const start = doc.getYPos();
    const ensure = vi.spyOn(doc, 'ensureSpace');
    draw(doc);
    expect(doc.getYPos() - start).toBeCloseTo(ensure.mock.calls[0][0], 6);
    expect(doc.contentBottom()).toBeCloseTo(doc.getYPos() - doc.theme.spacing.block, 6);
  });

  it('moves to the next page whole when it does not fit, without a warning', () => {
    const doc = leaveRoom(makeDoc(), 10);
    const rect = vi.spyOn(doc.doc, 'rect');
    const pagesDrawnOn = new Set<number>();
    rect.mockImplementation(function (this: unknown) {
      pagesDrawnOn.add(doc.pageNumber);
      return doc.doc;
    });
    draw(doc);
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect([...pagesDrawnOn]).toEqual(rect.mock.calls.length > 0 ? [2] : []);
    expect(doc.warnings).toEqual([]);
  });

  it('draws once inside keepTogether, with no page left behind', () => {
    const plain = makeDoc();
    const plainTexts = recordTexts(plain);
    draw(plain);
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.keepTogether(() => draw(doc.heading('Chart', { level: 'h3' })));
    expect(doc.doc.getNumberOfPages()).toBe(1);
    // The heading, then the chart as it is drawn alone: the measuring pass drew nothing on this page.
    expect(texts.filter((call) => call.lines[0] === 'Chart')).toHaveLength(1);
    expect(texts.filter((call) => call.page === 1)).toHaveLength(plainTexts.length + 1);
  });

  it('moves with its heading to the next page when keepTogether finds no room', () => {
    const doc = leaveRoom(makeDoc(), 30);
    const texts = recordTexts(doc);
    doc.keepTogether(() => draw(doc.heading('Chart', { level: 'h3' })));
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(texts.findLast((call) => call.lines[0] === 'Chart')!.page).toBe(2);
  });

  it.each([
    [1, 2],
    [2, 3],
    [0, 3],
  ])('stays inside column %s of %s', (index, count) => {
    const doc = makeDoc();
    const width = columnWidth(doc.contentWidth, count, LAYOUT.columnGap);
    const left = doc.margins.left + index * (width + LAYOUT.columnGap);
    const extents = recordExtents(doc);
    doc.columns(Array.from({ length: count }, (_, at) => (at === index ? (ctx) => draw(ctx) : () => {})));
    expectWithin(extents, left, left + width);
    for (const extent of extents) expect(extent.page, extent.what).toBe(1);
    // A narrow column leaves some labels no room at all: that is the only thing worth a warning.
    expect(doc.warnings.filter((warning) => !warning.includes('labels with no room'))).toEqual([]);
  });

  it('goes on in its column on the next page, and warns', () => {
    const doc = leaveRoom(makeDoc(), 10);
    doc.columns([() => {}, (ctx) => draw(ctx)]);
    expect(doc.doc.getNumberOfPages()).toBe(2);
    // A narrow column leaves some labels no room at all: that warning is not the one this test is about.
    const warnings = doc.warnings.filter((warning) => !warning.includes('labels with no room'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('keepTogether');
  });

  it('follows a theme that restyles the size of its text levels', () => {
    const big = makeDoc({
      theme: createTheme({ colors: { primary: '#3572B8' }, typography: { sizes: { small: 40, caption: 40 } } }),
    });
    const start = big.getYPos();
    draw(big);
    const plain = makeDoc();
    draw(plain);
    expect(big.getYPos() - start).toBeGreaterThan(plain.getYPos() - start);
  });
});

describe('the height each chart computes', () => {
  it.each([
    ['a legend beside the ring', SLICES, {}],
    ['a centre label', SLICES, { centerLabel: 'Total' }],
    ['no legend', SLICES, { legend: false }],
    ['a pie', SLICES, { innerRatio: 0, diameter: 30 }],
    ['a legend taller than the ring', slices(...Array.from({ length: 14 }, () => 1)), { diameter: 20 }],
    ['long labels and values', LONG_SLICES, {}],
  ])('donutChart, %s', (_, data, options) => {
    expectDrawnHeight(computeDonutChartHeight, drawDonutChart, data, { ...options, spaceAfter: 0 });
  });

  it.each([
    ['a legend', SLICES, {}],
    ['no legend', SLICES, { legend: false, height: 14 }],
    ['a legend on several lines', slices(...Array.from({ length: 14 }, () => 1)), { width: 80 }],
    ['an empty text', [], { emptyText: 'No data' }],
  ])('stackedBar, %s', (_, data, options) => {
    expectDrawnHeight(computeStackedBarHeight, drawStackedBar, data, { ...options, spaceAfter: 0 });
  });

  it.each([
    ['a legend', COLUMNS, { series: SERIES }],
    ['a reference and a max', COLUMNS, { reference: { value: 200, label: 'Target' }, max: 250, height: 30 }],
    ['crowded columns', CROWDED_COLUMNS, { series: SERIES }],
    ['an empty text', [], { emptyText: 'No data' }],
  ])('columnChart, %s', (_, data, options) => {
    expectDrawnHeight(computeColumnChartHeight, drawColumnChart, data, { ...options, spaceAfter: 0 });
  });

  it.each([
    ['one line', { xs: XS, lines: [LINE] }, {}],
    ['a band, titles and a highlight', { xs: XS, lines: [LINE], band: BAND }, TITLED],
    ['a legend on several lines', { xs: XS, lines: manyLines(12) }, { width: 90 }],
    ['an empty text', { xs: [1], lines: [] }, { emptyText: 'No data' }],
  ])('lineChart, %s', (_, data, options) => {
    expectDrawnHeight(computeLineChartHeight, drawLineChart, data as LineChartData, { ...options, spaceAfter: 0 });
  });

  it.each([
    [
      'donutChart',
      (ctx: PDFDocument) => computeDonutChartHeight(ctx, SLICES),
      (ctx: PDFDocument) => ctx.donutChart(SLICES),
    ],
    [
      'stackedBar',
      (ctx: PDFDocument) => computeStackedBarHeight(ctx, SLICES),
      (ctx: PDFDocument) => ctx.stackedBar(SLICES),
    ],
    [
      'columnChart',
      (ctx: PDFDocument) => computeColumnChartHeight(ctx, COLUMNS, { series: SERIES }),
      (ctx: PDFDocument) => ctx.columnChart(COLUMNS, { series: SERIES }),
    ],
    [
      'lineChart',
      (ctx: PDFDocument) => computeLineChartHeight(ctx, { xs: XS, lines: [LINE] }),
      (ctx: PDFDocument) => ctx.lineChart({ xs: XS, lines: [LINE] }),
    ],
  ])('%s takes the same height in a column', (_, compute, draw) => {
    const column = makeDoc();
    let computed = 0;
    let drawn = 0;
    column.columns([
      (ctx) => {
        computed = compute(ctx);
        const start = ctx.getYPos();
        draw(ctx);
        drawn = ctx.getYPos() - start - ctx.theme.spacing.block;
      },
      () => {},
    ]);
    expect(drawn).toBeCloseTo(computed, 6);
  });

  it('measures without moving or drawing', () => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'rect');
    const texts = recordTexts(doc);
    const y = doc.peekYPos();
    computeDonutChartHeight(doc, SLICES);
    computeStackedBarHeight(doc, SLICES);
    computeColumnChartHeight(doc, COLUMNS);
    computeLineChartHeight(doc, { xs: XS, lines: [LINE] });
    expect(doc.peekYPos()).toBe(y);
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(rect).not.toHaveBeenCalled();
    expect(texts).toEqual([]);
  });

  it('is 0 for a chart that draws nothing', () => {
    const doc = makeDoc();
    expect(computeDonutChartHeight(doc, [])).toBe(0);
    expect(computeStackedBarHeight(doc, slices(0, -1))).toBe(0);
    expect(computeColumnChartHeight(doc, [])).toBe(0);
    expect(computeColumnChartHeight(doc, [{ label: 'A', values: [0] }])).toBe(0);
    expect(computeLineChartHeight(doc, { xs: [1], lines: [] })).toBe(0);
  });
});

const TITLED = {
  xTitle: 'Year',
  yTitle: 'Value',
  highlight: { from: 2027, to: 2029, label: 'Target period' },
};

function manyLines(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    label: `Scenario ${index + 1}`,
    values: LINE.values.map((value) => value + index),
  }));
}

describe.each(EMPTY)('%s without data', (_name, draw) => {
  it('draws nothing and leaves the flow as it was', () => {
    const doc = makeDoc();
    doc.paragraph('Intro', { spaceAfter: 3 });
    const y = doc.peekYPos();
    const bottom = doc.contentBottom();
    const rect = vi.spyOn(doc.doc, 'rect');
    const texts = recordTexts(doc);
    draw(doc);
    expect(rect).not.toHaveBeenCalled();
    expect(texts).toEqual([]);
    expect(doc.peekYPos()).toBe(y);
    expect(doc.contentBottom()).toBe(bottom);
  });

  it.each(['', '   '])('draws nothing for an emptyText of %j', (emptyText) => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const y = doc.peekYPos();
    draw(doc, emptyText);
    expect(texts).toEqual([]);
    expect(doc.peekYPos()).toBe(y);
  });

  it('draws the muted line of emptyText, and takes one line of height', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const start = doc.getYPos();
    draw(doc, 'No data yet');
    expect(drawnTexts(texts)).toEqual(['No data yet']);
    expect(sameColor(texts[0].color, doc.theme.colors.secondary)).toBe(true);
    expect(texts[0].x).toBe(doc.margins.left);
    const { lineHeight, ascent } = measureTextLevel(doc, 'smallMuted');
    expect(texts[0].y).toBeCloseTo(start + ascent, 6);
    expect(doc.getYPos() - start).toBeCloseTo(lineHeight + doc.theme.spacing.block, 6);
  });

  it('wraps an emptyText that is wider than the chart', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    draw(doc, 'Nothing to show for this period because no figures were reported. '.repeat(4));
    expect(texts.length).toBeGreaterThan(1);
    for (const call of texts) expect(call.widths[0]).toBeLessThanOrEqual(doc.contentWidth);
  });

  it('keeps an emptyText line inside a column', () => {
    const doc = makeDoc();
    const width = columnWidth(doc.contentWidth, 2, LAYOUT.columnGap);
    const left = doc.margins.left + width + LAYOUT.columnGap;
    const extents = recordExtents(doc);
    doc.columns([() => {}, (ctx) => draw(ctx, 'No figures were reported for this period. '.repeat(3))]);
    expectWithin(extents, left, left + width);
  });
});

describe('an emptyText that is not a string', () => {
  it.each([
    ['donutChart', (ctx: PDFDocument) => ctx.donutChart(SLICES, { emptyText: 5 as never })],
    ['stackedBar', (ctx: PDFDocument) => ctx.stackedBar(SLICES, { emptyText: 5 as never })],
    ['columnChart', (ctx: PDFDocument) => ctx.columnChart(COLUMNS, { emptyText: 5 as never })],
    ['lineChart', (ctx: PDFDocument) => ctx.lineChart({ xs: XS, lines: [LINE] }, { emptyText: 5 as never })],
  ])('%s throws', (_, draw) => {
    const doc = makeDoc();
    expect(() => draw(doc)).toThrow(/emptyText: 5 — must be a string/);
  });
});

describe('chart colors', () => {
  it.each([
    ['the theme of the tests', () => makeDoc(), '#3572B8'],
    [
      'a theme of its own',
      () => makeDoc({ theme: createTheme({ colors: { primary: '#aa0000', background: '#fafafa' } }) }),
      '#AA0000',
    ],
  ])('shades the primary color of %s for the series without a color, darkest first', (_, make, primary) => {
    const doc = make();
    const fill = vi.spyOn(doc.doc, 'setFillColor');
    doc.stackedBar(SLICES, { legend: false, percentages: false });
    const [first, second, third] = fill.mock.calls.map(([value]) => String(value));
    expect(first).toBe(primary);
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('draws a single part, or a single series, in the primary color itself', () => {
    const bar = callsOf('setFillColor', (d) => d.stackedBar(slices(1), { legend: false, percentages: false }));
    expect(bar.calls[0][0]).toBe(bar.doc.theme.colors.primary);
    const columns = callsOf('setFillColor', (d) => d.columnChart([{ label: 'A', values: [1] }]));
    expect(columns.calls[0][0]).toBe(columns.doc.theme.colors.primary);
  });

  it('takes a palette token or a hex color', () => {
    const { doc, calls } = callsOf('setFillColor', (d) =>
      d.stackedBar(
        [
          { label: 'A', value: 1, color: 'success' },
          { label: 'B', value: 1, color: '#abc' },
        ],
        { legend: false, percentages: false },
      ),
    );
    // The last call puts back the fill color the chart found.
    expect(calls.slice(0, 2).map(([value]) => value)).toEqual([doc.theme.colors.success, '#AABBCC']);
  });

  it.each([
    ['donutChart', (ctx: PDFDocument) => ctx.donutChart([{ label: 'A', value: 1, color: 'nope' as never }])],
    [
      'donutChart, a slice left out',
      (ctx: PDFDocument) => ctx.donutChart([...SLICES, { label: 'A', value: 0, color: 'nope' as never }]),
    ],
    ['stackedBar', (ctx: PDFDocument) => ctx.stackedBar([{ label: 'A', value: 1, color: 'nope' as never }])],
    [
      'columnChart',
      (ctx: PDFDocument) => ctx.columnChart(COLUMNS, { series: [SERIES[0], { label: 'B', color: '#12' as never }] }),
    ],
    [
      'lineChart, a line',
      (ctx: PDFDocument) => ctx.lineChart({ xs: XS, lines: [{ ...LINE, color: 'nope' as never }] }),
    ],
    [
      'lineChart, the band',
      (ctx: PDFDocument) => ctx.lineChart({ xs: XS, lines: [LINE], band: { ...BAND, color: 'nope' as never } }),
    ],
    [
      'lineChart, the highlight',
      (ctx: PDFDocument) =>
        ctx.lineChart({ xs: XS, lines: [LINE] }, { highlight: { from: 2027, to: 2028, color: 'nope' as never } }),
    ],
  ])('%s throws on an invalid color before drawing anything', (_, draw) => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'rect');
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    const start = doc.getYPos();
    expect(() => draw(doc)).toThrow(InvalidColorError);
    expect(rect).not.toHaveBeenCalled();
    expect(lineTo).not.toHaveBeenCalled();
    expect(doc.getYPos()).toBe(start);
  });
});

describe('the text of the charts follows the theme', () => {
  it('donutChart: the legend in small and smallMuted, the centre label in bodyBold', () => {
    const doc = themedDoc();
    const texts = recordTexts(doc);
    doc.donutChart(SLICES, { centerLabel: 'Total' });
    expect(textOf(texts, 'Equities').color).toBe('#0000ff');
    expect(textOf(texts, '60%').color).toBe('#ff0000');
    expect(textOf(texts, 'Total').color).toBe('#ff00ff');
  });

  it('stackedBar: the legend in smallMuted, the percentages in a color that reads over the fill', () => {
    const doc = themedDoc();
    const texts = recordTexts(doc);
    doc.stackedBar(SLICES);
    expect(textOf(texts, 'Equities 60%').color).toBe('#ff0000');
    const { background, text } = doc.theme.colors;
    const inside = texts.filter((call) => call.lines[0] === '60%');
    expect(inside).toHaveLength(1);
    expect([background, text].some((ink) => sameColor(inside[0].color, ink))).toBe(true);
    expect(inside[0].fontStyle).toBe('bold');
  });

  it('columnChart: labels in smallMuted, values in small, the reference in caption', () => {
    const doc = themedDoc();
    const texts = recordTexts(doc);
    doc.columnChart(COLUMNS, { series: SERIES, reference: { value: 150, label: 'Target' } });
    expect(textOf(texts, 'Q1').color).toBe('#ff0000');
    expect(textOf(texts, '120').color).toBe('#0000ff');
    expect(textOf(texts, 'Licences').color).toBe('#ff0000');
    expect(textOf(texts, 'Target').color).toBe('#00ff00');
  });

  it('lineChart: the axes in caption, the legend in smallMuted', () => {
    const doc = themedDoc();
    const texts = recordTexts(doc);
    doc.lineChart({ xs: XS, lines: [LINE] }, { xTitle: 'Year', yTitle: 'Value' });
    for (const label of ['0', '2026', 'Year', 'Value']) expect(textOf(texts, label).color).toBe('#00ff00');
    expect(textOf(texts, 'Forecast').color).toBe('#ff0000');
  });

  it('takes the font of a restyled level', () => {
    const doc = makeDoc({
      theme: createTheme({
        colors: { primary: '#3572B8' },
        typography: { levels: { smallMuted: { bold: true } } },
      }),
    });
    const texts = recordTexts(doc);
    doc.stackedBar(SLICES);
    expect(textOf(texts, 'Equities 60%').fontStyle).toBe('bold');
  });
});

describe('donutChart', () => {
  it('leaves out the slices without a value', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.donutChart([...SLICES, { label: 'Nothing', value: 0 }, { label: 'Less', value: -3 }]);
    expect(drawnTexts(texts)).not.toContain('Nothing');
    expect(drawnTexts(texts)).not.toContain('Less');
    expect(drawnTexts(texts)).toEqual(expect.arrayContaining(['60%', '30%', '10%']));
  });

  it('leaves out a value that is not a finite number', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.donutChart([{ label: 'A', value: 3 }, ...slices(NaN, Infinity), { label: 'S', value: '4' as never }]);
    const drawn = drawnTexts(texts);
    expect(drawn).toContain('100%');
    expect(drawn).not.toContain('Part 1');
    expect(drawn).not.toContain('Part 2');
    expect(drawn).not.toContain('S');
  });

  it('draws a single slice as a full ring', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.donutChart([{ label: 'All', value: 7 }]);
    expect(drawnTexts(texts)).toEqual(['All', '100%']);
  });

  it('shows the percentage of each slice, or its legendValue', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.donutChart([
      { label: 'A', value: 3 },
      { label: 'B', value: 1, legendValue: '$250' },
    ]);
    const drawn = drawnTexts(texts);
    expect(drawn).toEqual(expect.arrayContaining(['A', '75%', 'B', '$250']));
    expect(drawn).not.toContain('25%');
  });

  it('draws no legend on request, and is then as tall as its diameter', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const start = doc.getYPos();
    doc.donutChart(SLICES, { legend: false, diameter: 30, spaceAfter: 0 });
    expect(texts).toHaveLength(0);
    expect(doc.getYPos() - start).toBeCloseTo(30, 6);
  });

  it('is as tall as its legend when that is taller than the ring, and centres the ring on it', () => {
    const doc = makeDoc();
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    const start = doc.getYPos();
    doc.donutChart(slices(...Array.from({ length: 14 }, () => 1)), { diameter: 20, spaceAfter: 0 });
    const height = doc.getYPos() - start;
    expect(height).toBeGreaterThan(20);
    // The first point of the first slice is the top of the ring, centred on the legend.
    expect(moveTo.mock.calls[0][1]).toBeCloseTo(start + (height - 20) / 2, 6);
  });

  it('draws the ring with the given diameter, starting at the top', () => {
    const doc = makeDoc();
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    const start = doc.getYPos();
    doc.donutChart(SLICES, { diameter: 40, legend: false });
    const [x, y] = moveTo.mock.calls[0];
    expect(x).toBeCloseTo(doc.margins.left + 20, 6);
    expect(y).toBeCloseTo(start, 6);
  });

  it('draws a pie from its centre when innerRatio is 0', () => {
    const doc = makeDoc();
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    const start = doc.getYPos();
    doc.donutChart(SLICES, { diameter: 40, innerRatio: 0, legend: false });
    const [x, y] = moveTo.mock.calls[0];
    expect(x).toBeCloseTo(doc.margins.left + 20, 6);
    expect(y).toBeCloseTo(start + 20, 6);
  });

  it.each([0.2, 0.5, 0.8])('opens a hole of %s of the radius', (innerRatio) => {
    const doc = makeDoc();
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    const start = doc.getYPos();
    doc.donutChart([{ label: 'All', value: 1 }], { diameter: 40, innerRatio, legend: false });
    const cx = doc.margins.left + 20;
    const cy = start + 20;
    const distances = [...moveTo.mock.calls, ...lineTo.mock.calls].map(([x, y]) =>
      Math.hypot((x as number) - cx, (y as number) - cy),
    );
    expect(Math.max(...distances)).toBeCloseTo(20, 6);
    expect(Math.min(...distances)).toBeCloseTo(20 * innerRatio, 6);
  });

  it('writes the centre label in the middle of the hole, in bold', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const start = doc.getYPos();
    doc.donutChart(SLICES, { diameter: 40, centerLabel: '$1.2M', legend: false });
    const [label] = texts;
    expect(label.lines).toEqual(['$1.2M']);
    expect(label.align).toBe('center');
    expect(label.fontStyle).toBe('bold');
    expect(label.x).toBeCloseTo(doc.margins.left + 20, 6);
    expect(label.y).toBeGreaterThan(start + 20);
    expect(label.y).toBeLessThan(start + 25);
  });

  it('cuts a centre label wider than the hole, and writes none on a pie', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.donutChart(SLICES, { diameter: 30, centerLabel: 'A very long label for a small hole', legend: false });
    expect(texts[0].lines[0].endsWith('…')).toBe(true);
    expect(texts[0].widths[0]).toBeLessThanOrEqual(30 * CHART.donut.innerRatio + 0.01);

    const pie = makeDoc();
    const pieTexts = recordTexts(pie);
    pie.donutChart(SLICES, { innerRatio: 0, centerLabel: 'Total', legend: false });
    expect(pieTexts).toHaveLength(0);
  });

  it('shrinks to leave its legend room in a narrow column, never under the smallest diameter', () => {
    expect(donutDiameterIn(1) * 2).toBeCloseTo(46, 6);
    expect(donutDiameterIn(2) * 2).toBeCloseTo(46, 6);
    expect(donutDiameterIn(3) * 2).toBeLessThan(46);
    expect(donutDiameterIn(3) * 2).toBeGreaterThanOrEqual(20);
    expect(donutDiameterIn(5) * 2).toBeCloseTo(20, 6);
  });

  it('keeps the whole width for a ring without legend in a narrow column', () => {
    const doc = makeDoc();
    const extents = recordExtents(doc);
    const width = columnWidth(doc.contentWidth, 6, LAYOUT.columnGap);
    doc.columns(
      Array.from({ length: 6 }, (_, at) => (ctx) => (at === 0 ? ctx.donutChart(SLICES, { legend: false }) : undefined)),
    );
    expectWithin(extents, doc.margins.left, doc.margins.left + width);
  });

  it('cuts a legend label to the room, and keeps the values in a column after the longest label', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.donutChart(LONG_SLICES, { diameter: 130 });
    const cut = texts.filter((call) => call.lines[0].endsWith('…'));
    expect(cut.length).toBeGreaterThan(0);
    const values = ['$720,000.00', '30%', '10%'].map((value) => textOf(texts, value));
    expect(values.map((call) => call.align)).toEqual(['right', 'right', 'right']);
    expect(new Set(values.map((call) => call.x.toFixed(6))).size).toBe(1);
  });

  it.each([
    ['a diameter of 0', { diameter: 0 }, /diameter/],
    ['a negative diameter', { diameter: -5 }, /diameter/],
    ['a diameter that is NaN', { diameter: Number.NaN }, /diameter/],
    ['an infinite diameter', { diameter: Number.POSITIVE_INFINITY }, /diameter/],
    ['an innerRatio of 1', { innerRatio: 1 }, /innerRatio/],
    ['a negative innerRatio', { innerRatio: -0.1 }, /innerRatio/],
    ['an innerRatio that is NaN', { innerRatio: Number.NaN }, /innerRatio/],
    ['a centerLabel that is not a string', { centerLabel: 3 as never }, /centerLabel: 3 — must be a string/],
  ])('throws for %s, before drawing', (_, options, message) => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'rect');
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    const start = doc.getYPos();
    expect(() => doc.donutChart(SLICES, options)).toThrow(InvalidOptionError);
    expect(() => doc.donutChart(SLICES, options)).toThrow(message);
    expect(rect).not.toHaveBeenCalled();
    expect(lineTo).not.toHaveBeenCalled();
    expect(doc.getYPos()).toBe(start);
  });

  it('throws for a label that is not a string', () => {
    expect(() => makeDoc().donutChart([{ label: 4 as never, value: 1 }])).toThrow(
      'Invalid donutChart label: 4 — must be a string',
    );
    expect(() => makeDoc().donutChart([{ label: 'A', value: 1, legendValue: 4 as never }])).toThrow(/legendValue/);
  });

  it('checks its options even when there is nothing to draw', () => {
    expect(() => makeDoc().donutChart([], { diameter: -1 })).toThrow(InvalidOptionError);
  });
});

describe('stackedBar', () => {
  it('fills the width exactly', () => {
    const { doc, calls } = callsOf('rect', (d) => d.stackedBar(slices(1, 1, 1), { width: 100, legend: false }));
    const bars = calls.filter((call) => call[4] === 'F');
    const last = bars[bars.length - 1];
    expect(bars).toHaveLength(3);
    expect((last[0] as number) + (last[2] as number)).toBeCloseTo(doc.margins.left + 100, 9);
  });

  it.each([
    ['the content width and is 9 mm tall by default', {}, (doc: PDFDocument) => doc.contentWidth, 9],
    ['the width and the height given', { width: 120, height: 14 }, () => 120, 14],
  ])('spans %s', (_, options, width, height) => {
    const { doc, calls } = callsOf('rect', (d) => d.stackedBar(SLICES, { legend: false, ...options }));
    const outline = calls.at(-1) as unknown[];
    expect(outline[4]).toBe('S');
    expect(outline[0]).toBe(doc.margins.left);
    expect(outline[2]).toBeCloseTo(width(doc), 6);
    expect(outline[3]).toBe(height);
  });

  it('sizes each slice to its share', () => {
    const { calls } = callsOf('rect', (d) => d.stackedBar(slices(1, 3), { width: 80, legend: false }));
    expect((calls[0] as number[])[2]).toBeCloseTo(20, 6);
    expect((calls[1] as number[])[2]).toBeCloseTo(60, 6);
  });

  it('writes the percentage only in the slices wide enough for it', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.stackedBar(
      [
        { label: 'Wide', value: 97 },
        { label: 'Thin', value: 3 },
      ],
      { legend: false },
    );
    expect(drawnTexts(texts)).toEqual(['97%']);
  });

  it('writes no percentage on request', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.stackedBar(SLICES, { legend: false, percentages: false });
    expect(texts).toHaveLength(0);
  });

  it('centres each percentage on its slice', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.stackedBar(slices(1, 1), { width: 80, legend: false });
    expect(texts.map((call) => call.x)).toEqual([doc.margins.left + 20, doc.margins.left + 60]);
    expect(texts.every((call) => call.align === 'center')).toBe(true);
  });

  it('writes the percentage in the page color over a dark fill, in the text color over a light one', () => {
    const dark = makeDoc();
    const darkTexts = recordTexts(dark);
    dark.stackedBar([{ label: 'A', value: 1, color: '#001133' }], { legend: false });
    expect(sameColor(darkTexts[0].color, dark.theme.colors.background)).toBe(true);

    const light = makeDoc();
    const lightTexts = recordTexts(light);
    light.stackedBar([{ label: 'A', value: 1, color: '#f4f4c8' }], { legend: false });
    expect(sameColor(lightTexts[0].color, light.theme.colors.text)).toBe(true);
  });

  it('writes the percentage in the page color over the success green, which reaches 3:1 with it', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.stackedBar([{ label: 'A', value: 1, color: 'success' }], { legend: false });
    expect(sameColor(texts[0].color, doc.theme.colors.background)).toBe(true);
  });

  it('writes the percentages in bold', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.stackedBar(SLICES, { legend: false });
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((call) => call.fontStyle === 'bold')).toBe(true);
  });

  it('draws the legend under the bar: each slice with its percentage or legendValue', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const start = doc.getYPos();
    doc.stackedBar([
      { label: 'A', value: 3 },
      { label: 'B', value: 1, legendValue: '$250' },
    ]);
    const legend = texts.filter((call) => call.lines[0].includes(' '));
    expect(legend.map((call) => call.lines[0])).toEqual(['A 75%', 'B $250']);
    for (const call of legend) expect(call.y).toBeGreaterThan(start + CHART.stackedBar.height);
  });

  it('wraps a legend too long for one line', () => {
    const many = Array.from({ length: 14 }, (_, index) => ({ label: `Category number ${index + 1}`, value: 1 }));
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.stackedBar(many);
    const rows = new Set(texts.filter((call) => call.lines[0].startsWith('Category')).map((call) => call.y.toFixed(3)));
    expect(rows.size).toBeGreaterThan(1);
    const short = makeDoc();
    short.stackedBar(many.slice(0, 2));
    expect(doc.getYPos()).toBeGreaterThan(short.getYPos());
  });

  it('wraps the legend to the width of the bar, not to the content width', () => {
    const doc = makeDoc();
    const extents = recordExtents(doc);
    doc.stackedBar(
      Array.from({ length: 6 }, (_, index) => ({ label: `Category ${index + 1}`, value: 1 })),
      { width: 70 },
    );
    expectWithin(extents, doc.margins.left, doc.margins.left + 70);
  });

  it('cuts a label wider than the bar with an ellipsis, on a line of its own', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const label = 'A category whose name is far too long for a bar that is only forty millimetres wide';
    doc.stackedBar([{ label, value: 1 }, ...slices(1)], { width: 40 });
    const cut = texts.find((call) => call.lines[0].endsWith('…'))!;
    expect(cut.x + cut.widths[0]).toBeLessThanOrEqual(doc.margins.left + 40 + 0.01);
    expect(cut.lines[0].startsWith('A category')).toBe(true);
    // Cut short is no loss: the ellipsis shows it.
    expect(doc.warnings).toEqual([]);
  });

  it('draws no legend on request', () => {
    const without = makeDoc();
    const start = without.getYPos();
    without.stackedBar(SLICES, { legend: false, spaceAfter: 0 });
    const withLegend = makeDoc();
    withLegend.stackedBar(SLICES, { spaceAfter: 0 });
    expect(without.getYPos() - start).toBeCloseTo(CHART.stackedBar.height, 6);
    expect(withLegend.getYPos()).toBeGreaterThan(without.getYPos());
  });

  it.each([
    ['a width of 0', { width: 0 }, /width/],
    ['a negative width', { width: -10 }, /width/],
    ['a width that is NaN', { width: Number.NaN }, /width/],
    ['a height of 0', { height: 0 }, /height/],
    ['an infinite height', { height: Number.POSITIVE_INFINITY }, /height/],
  ])('throws for %s, before drawing', (_, options, message) => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'rect');
    expect(() => doc.stackedBar(SLICES, options)).toThrow(InvalidOptionError);
    expect(() => doc.stackedBar(SLICES, options)).toThrow(message);
    expect(rect).not.toHaveBeenCalled();
  });

  it('leaves out a value that is not a finite number or not above zero', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.stackedBar([{ label: 'A', value: 3 }, ...slices(NaN, Infinity, -4, 0)]);
    expect(drawnTexts(texts)).toEqual(['100%', 'A 100%']);
  });
});

describe('columnChart', () => {
  it('scales the columns to the tallest one and caps their width', () => {
    const [small, tall] = fills(
      [
        { label: 'A', values: [50] },
        { label: 'B', values: [100] },
      ],
      { height: 40 },
    );
    expect(tall[3]).toBeCloseTo(40, 6);
    expect(small[3]).toBeCloseTo(20, 6);
    expect(small[2]).toBe(28);
    // Both columns stand on the same base line.
    expect(small[1] + small[3]).toBeCloseTo(tall[1] + tall[3], 6);
  });

  it('shares the width between the columns, each in the middle of its share', () => {
    const { doc, calls } = callsOf('rect', (d) =>
      d.columnChart([
        { label: 'A', values: [1] },
        { label: 'B', values: [1] },
        { label: 'C', values: [1] },
        { label: 'D', values: [1] },
      ]),
    );
    const slot = doc.contentWidth / 4;
    (calls as number[][]).forEach(([x, , width], index) => {
      expect(x + width / 2).toBeCloseTo(doc.margins.left + slot * (index + 0.5), 6);
    });
  });

  it('shrinks the columns to leave a gap when many share the width', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ label: `${index}`, values: [1] }));
    const rects = fills(many);
    const doc = makeDoc();
    const slot = doc.contentWidth / 12;
    expect(rects[0][2]).toBeCloseTo(slot - CHART.column.gap, 6);
    expect(rects[1][0] - (rects[0][0] + rects[0][2])).toBeCloseTo(CHART.column.gap, 6);
  });

  it('stacks the values of a column from the bottom up, in the colors of the series', () => {
    const { doc, calls } = callsOf('rect', (d) =>
      d.columnChart([{ label: 'A', values: [30, 10] }], {
        series: [{ label: 'One', color: 'success' }, { label: 'Two' }],
        height: 40,
      }),
    );
    const [first, second] = calls as number[][];
    expect(first[3]).toBeCloseTo(30, 6);
    expect(second[3]).toBeCloseTo(10, 6);
    // The second layer sits right on the first.
    expect(second[1] + second[3]).toBeCloseTo(first[1], 6);
    expect(doc.getYPos()).toBeGreaterThan(0);
  });

  it('draws the layers of a column with values and no series, in shades of the primary color', () => {
    const { doc, calls } = callsOf('setFillColor', (d) => d.columnChart([{ label: 'A', values: [3, 2, 1] }]));
    const colors = calls.slice(0, 3).map(([value]) => String(value));
    expect(colors[0]).toBe(doc.theme.colors.primary);
    expect(new Set(colors).size).toBe(3);
  });

  it('sets the top of the scale with max', () => {
    const [column] = fills([{ label: 'A', values: [50] }], { height: 40, max: 200 });
    expect(column[3]).toBeCloseTo(10, 6);
  });

  it('raises the scale to the tallest column when max is lower', () => {
    const [column] = fills([{ label: 'A', values: [50] }], { height: 40, max: 10 });
    expect(column[3]).toBeCloseTo(40, 6);
  });

  it('takes max as the top of the scale only until a column or the reference is higher', () => {
    const columns = [
      { label: 'A', values: [80] },
      { label: 'B', values: [20] },
    ];
    // max above everything: the scale stops at max.
    expect(fills(columns, { height: 40, max: 100 }).map((column) => column[3])).toEqual([
      expect.closeTo(32, 6),
      expect.closeTo(8, 6),
    ]);
    // max under the tallest column: the scale reaches it, and the column fills it.
    expect(fills(columns, { height: 40, max: 50 }).map((column) => column[3])).toEqual([
      expect.closeTo(40, 6),
      expect.closeTo(10, 6),
    ]);
    // max under the reference: the scale reaches the reference.
    const [tall] = fills(columns, { height: 40, max: 50, reference: { value: 160, label: 'Target' } });
    expect(tall[3]).toBeCloseTo(20, 6);
  });

  it('raises the scale to the reference when it is above every column', () => {
    const [column] = fills([{ label: 'A', values: [50] }], {
      height: 40,
      reference: { value: 100, label: 'Target' },
    });
    expect(column[3]).toBeCloseTo(20, 6);
  });

  it('draws the reference as a dashed line across the plot, with its label right of it, centred on the line', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const dash = vi.spyOn(doc.doc, 'setLineDashPattern');
    const line = vi.spyOn(doc.doc, 'line');
    doc.columnChart([{ label: 'A', values: [50] }], { height: 40, reference: { value: 25, label: 'Target' } });
    expect(dash).toHaveBeenCalledWith(CHART.column.referenceDash, 0);
    const [base, reference] = line.mock.calls as number[][];
    expect(base[1] - reference[1]).toBeCloseTo(20, 6);
    expect(reference[0]).toBe(doc.margins.left);
    // The axis and the line stop where the room of the label starts.
    expect(base[2]).toBeCloseTo(reference[2], 6);
    const label = textOf(texts, 'Target');
    expect(label.align).toBeUndefined();
    expect(label.x).toBeCloseTo(reference[2] + CHART.column.referenceGap, 6);
    expect(label.x + label.widths[0]).toBeCloseTo(doc.margins.left + doc.contentWidth, 6);
    const axis = measureTextLevel(doc, 'caption');
    expect(label.y).toBeCloseTo(reference[1] + capitalMiddle(axis), 6);
  });

  it.each([
    ['above every column', 160],
    ['under the tallest column', 60],
    ['at the top of the scale', 100],
    ['near the axis', 2],
  ])('keeps the reference label clear of every column: a reference %s', (_name, value) => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const start = doc.getYPos();
    const columns = [20, 100, 70, 100].map((height, index) => ({ label: `Q${index + 1}`, values: [height] }));
    doc.columnChart(columns, { series: [{ label: 'Sales' }], reference: { value, label: 'Target for the year' } });
    const label = textOf(texts, 'Target for the year');
    const axis = measureTextLevel(doc, 'caption');
    const box = { left: label.x, right: label.x + label.widths[0], top: label.y - axis.ascent, bottom: label.y };
    // Its top stays in the chart, which grows by what rises above the scale.
    expect(box.top).toBeGreaterThanOrEqual(start - 1e-6);
    // The columns: wider than the swatch of the legend.
    const bars = filledShapes(doc, 1).filter((shape) => shape.width > CHART.swatch + 1e-6);
    expect(bars).toHaveLength(columns.length);
    for (const bar of bars) {
      const apart =
        bar.x + bar.width <= box.left || bar.x >= box.right || bar.y + bar.height <= box.top || bar.y >= box.bottom;
      expect(apart, `column at ${bar.x}`).toBe(true);
    }
  });

  it('gives an empty reference label no room: the line runs across the whole chart', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const line = vi.spyOn(doc.doc, 'line');
    doc.columnChart([{ label: 'A', values: [50] }], { reference: { value: 25, label: '' } });
    const [base, reference] = line.mock.calls as number[][];
    expect(reference[2]).toBeCloseTo(doc.margins.left + doc.contentWidth, 6);
    expect(base[2]).toBeCloseTo(reference[2], 6);
    expect(texts.map((call) => call.lines[0])).toEqual(['A']);
    expect(doc.warnings).toEqual([]);
  });

  it('cuts a reference label wider than a third of the chart with an ellipsis', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.columnChart([{ label: 'A', values: [50] }], { reference: { value: 25, label: LONG } });
    const label = texts.find((call) => call.lines[0].endsWith('…'))!;
    expect(label.widths[0]).toBeLessThanOrEqual(doc.contentWidth * CHART.column.referenceLabelShare + 1e-6);
    expect(doc.warnings).toEqual([]);
  });

  it('draws a legend only when the series are named, and not on request', () => {
    const named = makeDoc();
    named.columnChart([{ label: 'A', values: [1, 2] }], { series: SERIES });
    const plain = makeDoc();
    plain.columnChart([{ label: 'A', values: [1, 2] }]);
    const hidden = makeDoc();
    hidden.columnChart([{ label: 'A', values: [1, 2] }], { series: SERIES, legend: false });
    expect(named.getYPos()).toBeGreaterThan(plain.getYPos());
    expect(hidden.getYPos()).toBeCloseTo(plain.getYPos(), 6);
  });

  it('writes the label and the value under each column, the values lined up under the tallest label', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.columnChart([
      { label: 'Short', valueLabel: '10', values: [1] },
      { label: 'A label that needs a second line', valueLabel: '20', values: [2] },
      ...Array.from({ length: 4 }, () => ({ label: 'x', values: [1] })),
    ]);
    const long = textOf(texts, '20');
    expect(textOf(texts, '10').y).toBeCloseTo(long.y, 6);
    // The long label on two lines, one under the other, centred on its column.
    const center = doc.margins.left + 1.5 * (doc.contentWidth / 6);
    const lines = texts.filter((call) => Math.abs(call.x - center) < 1e-6 && call.lines[0] !== '20');
    expect(lines.map((call) => call.lines[0]).join(' ')).toBe('A label that needs a second line');
    expect(lines).toHaveLength(2);
    expect(lines[1].y - lines[0].y).toBeCloseTo(measureTextLevel(doc, 'smallMuted').lineHeight, 6);
    expect(long.y).toBeGreaterThan(lines[1].y);
    expect(lines.every((call) => call.align === 'center')).toBe(true);
    expect(textOf(texts, 'Short').align).toBe('center');
  });

  it('cuts a label to two lines, the last ending with an ellipsis', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.columnChart(
      Array.from({ length: 6 }, () => ({ label: 'Every word of this label wraps again and again', values: [1] })),
    );
    const slot = doc.contentWidth / 6;
    for (let index = 0; index < 6; index++) {
      const center = doc.margins.left + (index + 0.5) * slot;
      const lines = texts.filter((call) => Math.abs(call.x - center) < 1e-6).map((call) => call.lines[0]);
      expect(lines).toHaveLength(2);
      expect(lines[1].endsWith('…')).toBe(true);
    }
  });

  it('cuts a value label wider than its column', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.columnChart(
      Array.from({ length: 6 }, () => ({ label: 'A', valueLabel: '$1,234,567,890.00 in total', values: [1] })),
    );
    const slot = doc.contentWidth / 6;
    const value = texts.find((call) => call.lines[0].startsWith('$1'))!;
    expect(value.lines[0].endsWith('…')).toBe(true);
    expect(value.widths[0]).toBeLessThanOrEqual(slot - CHART.column.gap + 0.01);
  });

  it('makes no room for values when no column has one', () => {
    const withValue = makeDoc();
    withValue.columnChart([{ label: 'A', valueLabel: '1', values: [1] }]);
    const without = makeDoc();
    without.columnChart([{ label: 'A', values: [1] }]);
    expect(withValue.getYPos() - without.getYPos()).toBeCloseTo(
      measureTextLevel(withValue, 'smallMuted').lineHeight,
      6,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -5, 0])('leaves out a value of %s and keeps its scale', (value) => {
    const rects = fills(
      [
        { label: 'A', values: [80] },
        { label: 'B', values: [value] },
      ],
      { height: 40 },
    );
    expect(rects).toHaveLength(1);
    expect(rects[0][3]).toBeCloseTo(40, 6);
  });

  it('leaves out a value that is a text', () => {
    expect(fills([{ label: 'A', values: ['5' as never, 4] }], { height: 40 })).toHaveLength(1);
  });

  it('draws a plain column from a single value, and keeps the axis under a column without a value', () => {
    expect(fills([{ label: 'A', values: [7] }])).toHaveLength(1);
    const { calls } = callsOf('line', (d) =>
      d.columnChart([
        { label: 'A', values: [] },
        { label: 'B', values: [0] },
        { label: 'C', values: [2] },
      ]),
    );
    expect(calls).toHaveLength(1);
  });

  it('takes a series shorter than the values it names when none is named', () => {
    expect(fills([{ label: 'A', values: [1, 2, 3] }])).toHaveLength(3);
  });

  it('leaves a layer out of a column that has fewer values than the series', () => {
    expect(fills([{ label: 'A', values: [1] }], { series: SERIES, legend: false })).toHaveLength(1);
  });

  it('throws when a column has more values than the named series', () => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'rect');
    expect(() => doc.columnChart([{ label: 'A', values: [1, 2, 3] }], { series: SERIES })).toThrow(
      /column "A" has 3 values for 2 series/,
    );
    expect(rect).not.toHaveBeenCalled();
  });

  it.each([
    ['a height of 0', { height: 0 }, /height/],
    ['a negative height', { height: -3 }, /height/],
    ['a max that is NaN', { max: Number.NaN }, /max/],
    ['a max of 0', { max: 0 }, /max/],
    ['a reference of 0', { reference: { value: 0, label: 'T' } }, /reference value/],
    ['a reference that is NaN', { reference: { value: Number.NaN, label: 'T' } }, /reference value/],
    ['a reference label that is not a string', { reference: { value: 5, label: 5 as never } }, /reference label/],
  ])('throws for %s, before drawing', (_, options, message) => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'rect');
    expect(() => doc.columnChart(COLUMNS, options)).toThrow(InvalidOptionError);
    expect(() => doc.columnChart(COLUMNS, options)).toThrow(message);
    expect(rect).not.toHaveBeenCalled();
  });

  it('throws for a column whose label or values are not what they should be', () => {
    expect(() => makeDoc().columnChart([{ label: 5 as never, values: [1] }])).toThrow(/column label/);
    expect(() => makeDoc().columnChart([{ label: 'A', valueLabel: 5 as never, values: [1] }])).toThrow(/valueLabel/);
    expect(() => makeDoc().columnChart([{ label: 'A', values: 5 as never }])).toThrow(/must be an array/);
  });

  it('checks its options even when there is nothing to draw', () => {
    expect(() => makeDoc().columnChart([], { height: -1 })).toThrow(InvalidOptionError);
  });

  it('wraps a legend too long for one line inside the width', () => {
    const doc = makeDoc();
    const extents = recordExtents(doc);
    const series = Array.from({ length: 10 }, (_, index) => ({ label: `Revenue stream ${index + 1}` }));
    doc.columnChart([{ label: 'A', values: series.map(() => 1) }], { series });
    expectWithin(extents, doc.margins.left, doc.margins.left + doc.contentWidth);
    const single = makeDoc();
    single.columnChart([{ label: 'A', values: [1, 1] }], { series: SERIES });
    expect(doc.getYPos()).toBeGreaterThan(single.getYPos());
  });
});

/** Whether a shape is as wide as a legend swatch of a line chart, and `height` accepts its height. */
const isSwatch = (shape: { width: number; height: number }, height: (h: number) => boolean) =>
  Math.abs(shape.width - CHART.lineSwatch) < 1e-6 && height(shape.height);

const SECOND = { ...LINE, label: 'Second', values: LINE.values.map((value) => value / 2) };
/** The colors of the line samples and of the area swatches of a legend, in the order the legend draws them. */
const legendColors = (data: LineChartData, options?: LineChartOptions) => {
  const doc = makeDoc();
  doc.lineChart(data, options);
  return {
    doc,
    areas: filledShapes(doc, 1)
      .filter((shape) => isSwatch(shape, (height) => Math.abs(height - CHART.swatch) < 1e-6))
      .map((swatch) => swatch.color),
    lines: strokedShapes(doc, 1)
      .filter((shape) => isSwatch(shape, (height) => height < 1e-6))
      .map((sample) => sample.color),
  };
};

describe('lineChart', () => {
  it('gives the band the secondary color and the highlight the primary one, which differ', () => {
    const { doc, areas } = legendColors(
      { xs: XS, lines: [LINE, SECOND], band: BAND },
      { highlight: { from: 2027, to: 2028, label: 'Target' } },
    );
    expect(areas).toHaveLength(2);
    const [band, highlight] = areas;
    expect(sameColor(band, doc.theme.colors.secondary)).toBe(true);
    expect(sameColor(highlight, doc.theme.colors.primary)).toBe(true);
    expect(sameColor(band, highlight)).toBe(false);
  });

  it('keeps the colors of the lines whether or not there is a band or a highlight', () => {
    const alone = legendColors({ xs: XS, lines: [LINE, SECOND] }).lines;
    const withBand = legendColors({ xs: XS, lines: [LINE, SECOND], band: BAND }).lines;
    const withBoth = legendColors(
      { xs: XS, lines: [LINE, SECOND], band: BAND },
      { highlight: { from: 2027, to: 2028, label: 'Target' } },
    ).lines;
    expect(alone).toHaveLength(2);
    expect(withBand).toEqual(alone);
    expect(withBoth).toEqual(alone);
    // The first line keeps the primary color, as the first of the series.
    expect(sameColor(alone[0], makeDoc().theme.colors.primary)).toBe(true);
    expect(sameColor(alone[0], alone[1])).toBe(false);
  });

  it('gives the band and the highlight the same colors whatever the number of lines', () => {
    const one = legendColors(
      { xs: XS, lines: [LINE], band: BAND },
      { highlight: { from: 2027, to: 2028, label: 'Target' } },
    ).areas;
    const three = legendColors(
      { xs: XS, lines: [LINE, SECOND, { ...SECOND, label: 'Third' }], band: BAND },
      { highlight: { from: 2027, to: 2028, label: 'Target' } },
    ).areas;
    expect(three).toEqual(one);
  });

  it('takes the colors given to the band and the highlight', () => {
    const doc = makeDoc();
    doc.lineChart(
      { xs: XS, lines: [LINE], band: { ...BAND, color: '#00AA00' } },
      { highlight: { from: 2027, to: 2028, label: 'Target', color: 'error' } },
    );
    const swatches = filledShapes(doc, 1).filter((shape) => Math.abs(shape.width - CHART.lineSwatch) < 1e-6);
    expect(swatches.map((swatch) => swatch.color)).toEqual([
      expect.toSatisfy((color: string) => sameColor(color, '#00AA00')),
      expect.toSatisfy((color: string) => sameColor(color, doc.theme.colors.error)),
    ]);
  });

  it('throws when a series does not have one value per point', () => {
    const doc = makeDoc();
    expect(() => doc.lineChart({ xs: XS, lines: [{ label: 'Short', values: [1, 2] }] })).toThrow(InvalidOptionError);
    expect(() => doc.lineChart({ xs: XS, lines: [{ label: 'Short', values: [1, 2] }] })).toThrow(
      'Invalid lineChart line "Short" values: 2 values for 5 points of xs',
    );
    expect(() =>
      doc.lineChart({ xs: XS, lines: [LINE], band: { label: 'Range', lower: [1], upper: LINE.values } }),
    ).toThrow(/band\.lower: 1 values for 5 points/);
    expect(() =>
      doc.lineChart({ xs: XS, lines: [LINE], band: { label: 'Range', lower: LINE.values, upper: [] } }),
    ).toThrow(/band\.upper: 0 values/);
    expect(() => doc.lineChart({ xs: XS, lines: [{ label: 'L', values: 5 as never }] })).toThrow(
      'Invalid lineChart line "L" values: 5 — must be an array',
    );
  });

  it.each([
    ['a line', { xs: [1, 2, 3], lines: [{ label: 'L', values: [1, Number.NaN, 3] }] }],
    ['xs', { xs: [1, Number.POSITIVE_INFINITY, 3], lines: [{ label: 'L', values: [1, 2, 3] }] }],
    [
      'the band',
      {
        xs: [1, 2, 3],
        lines: [{ label: 'L', values: [1, 2, 3] }],
        band: { label: 'B', lower: [1, 1, 1], upper: [2, Number.NaN, 2] },
      },
    ],
    ['a line, negative infinity', { xs: [1, 2, 3], lines: [{ label: 'L', values: [1, Number.NEGATIVE_INFINITY, 3] }] }],
  ])('throws on %s with a value that is not a finite number, before drawing', (_, data) => {
    const doc = makeDoc();
    const line = vi.spyOn(doc.doc, 'line');
    const start = doc.getYPos();
    expect(() => doc.lineChart(data)).toThrow(InvalidOptionError);
    expect(() => doc.lineChart(data)).toThrow(/at index 1: -?(NaN|Infinity) — must be a finite number/);
    expect(line).not.toHaveBeenCalled();
    expect(doc.getYPos()).toBe(start);
  });

  it('throws when a band is lower at one point than it is high, before drawing', () => {
    const doc = makeDoc();
    const line = vi.spyOn(doc.doc, 'line');
    const start = doc.getYPos();
    const crossed = { label: 'Range', lower: [100, 104, 140, 112, 116], upper: [100, 116, 134, 154, 176] };
    expect(() => doc.lineChart({ xs: XS, lines: [LINE], band: crossed })).toThrow(InvalidOptionError);
    expect(() => doc.lineChart({ xs: XS, lines: [LINE], band: crossed })).toThrow(
      'Invalid lineChart band.lower at index 2: 140 — must be a finite number, at least 0 and at most 134',
    );
    expect(line).not.toHaveBeenCalled();
    expect(doc.getYPos()).toBe(start);
    expect(doc.warnings).toEqual([]);
  });

  it('accepts a band whose edges meet', () => {
    const doc = makeDoc();
    expect(() =>
      doc.lineChart({ xs: XS, lines: [LINE], band: { label: 'Flat', lower: LINE.values, upper: LINE.values } }),
    ).not.toThrow();
  });

  it('checks the band even when nothing is drawn', () => {
    expect(() => makeDoc().lineChart({ xs: [1], lines: [], band: { label: 'B', lower: [5], upper: [3] } })).toThrow(
      /band\.lower at index 0: 5/,
    );
  });

  it('throws when xs does not increase, and accepts equal neighbours', () => {
    expect(() => makeDoc().lineChart({ xs: [1, 3, 2], lines: [{ label: 'L', values: [1, 2, 3] }] })).toThrow(
      /increasing order/,
    );
    const doc = makeDoc();
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    doc.lineChart({ xs: [1, 2, 2], lines: [{ label: 'L', values: [1, 2, 3] }] });
    // The last two points share their X: the line goes straight up between them.
    const [second, third] = lineTo.mock.calls as number[][];
    expect(third[0]).toBeCloseTo(second[0], 6);
    expect(third[1]).toBeLessThan(second[1]);
  });

  it('scales the Y axis from zero to a round maximum', () => {
    const { drawn } = textsOf({ xs: XS, lines: [LINE] }, { yTicks: 4 });
    expect(drawn).toEqual(expect.arrayContaining(['0', '50', '100', '150', '200']));
  });

  it('takes the band into account for the scale', () => {
    const { drawn } = textsOf({ xs: XS, lines: [LINE], band: BAND });
    expect(drawn).toContain('200');
    const { drawn: tall } = textsOf({ xs: XS, lines: [LINE], band: { ...BAND, upper: [100, 300, 400, 500, 600] } });
    expect(tall).toContain('1000');
  });

  it('draws as many grid lines as yTicks says, 4 by default, and the axis', () => {
    // The grid above the axis, the axis, and the sample of the legend.
    expect(lineCalls(2)).toBe(2 + 1 + 1);
    expect(lineCalls(8)).toBe(8 + 1 + 1);
    expect(lineCalls()).toBe(4 + 1 + 1);
  });

  it('formats the axis labels with the functions given', () => {
    const { drawn } = textsOf(
      { xs: XS, lines: [LINE] },
      { formatValue: (value) => `${value} k`, formatX: (x) => `Y${x - 2025}` },
    );
    expect(drawn).toEqual(expect.arrayContaining(['200 k', 'Y1', 'Y5']));
  });

  it('labels the X axis up to xTicks, the last point always', () => {
    const xs = Array.from({ length: 40 }, (_, index) => 2000 + index);
    const labelled = (xTicks?: number) =>
      textsOf({ xs, lines: [{ label: 'Flat', values: xs.map(() => 5) }] }, { xTicks }).drawn.filter((text) =>
        /^20\d\d$/.test(text),
      );
    expect(labelled()).toContain('2039');
    expect(labelled(2)).toEqual(['2000', '2039']);
    expect(labelled(4).length).toBeLessThanOrEqual(4);
    expect(labelled(4)).toContain('2039');
  });

  it('draws no X label over the last one', () => {
    const { texts } = textsOf({ xs: [1, 2, 3, 4], lines: [{ label: 'L', values: [1, 2, 3, 4] }] }, { xTicks: 4 });
    const labels = texts.filter((call) => /^[1-4]$/.test(call.lines[0]) && call.align === undefined);
    for (let index = 1; index < labels.length; index++) {
      expect(labels[index].x).toBeGreaterThanOrEqual(labels[index - 1].x + labels[index - 1].widths[0]);
    }
  });

  it('keeps every point inside the plot', () => {
    const doc = makeDoc();
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    const start = doc.getYPos();
    doc.lineChart({ xs: XS, lines: [LINE] }, { height: 50, spaceAfter: 0 });
    const points = [...moveTo.mock.calls, ...lineTo.mock.calls] as number[][];
    expect(points).toHaveLength(XS.length);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(doc.margins.left);
      expect(x).toBeLessThanOrEqual(doc.margins.left + doc.contentWidth + 1e-6);
      expect(y).toBeGreaterThanOrEqual(start);
      expect(y).toBeLessThanOrEqual(start + 50 + 1e-6);
    }
  });

  it('plots a value of zero on the axis', () => {
    const doc = makeDoc();
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    const start = doc.getYPos();
    doc.lineChart({ xs: [1, 2, 3], lines: [{ label: 'L', values: [5, 0, 0] }] }, { height: 50, spaceAfter: 0 });
    const ys = [...moveTo.mock.calls, ...lineTo.mock.calls].map(([, y]) => y as number);
    expect(ys[0]).toBeCloseTo(start, 6);
    expect(ys[1]).toBeCloseTo(start + 50, 6);
    expect(ys[2]).toBeCloseTo(start + 50, 6);
  });

  it('draws a chart with a single series of a single non-zero point among zeros', () => {
    const { drawn } = textsOf({ xs: [1, 2, 3], lines: [{ label: 'L', values: [0, 4, 0] }] });
    expect(drawn).toContain('L');
  });

  it('takes the width and the height given', () => {
    const doc = makeDoc();
    const line = vi.spyOn(doc.doc, 'line');
    const start = doc.getYPos();
    doc.lineChart({ xs: XS, lines: [{ label: 'L', values: LINE.values }] }, { width: 100, height: 30, spaceAfter: 0 });
    // The axis is the lowest of the lines that reach the right edge.
    const reaching = (line.mock.calls as number[][]).filter(
      (call) => Math.abs(call[2] - (doc.margins.left + 100)) < 1e-6,
    );
    expect(reaching.length).toBeGreaterThan(1);
    const axis = reaching.reduce((lowest, call) => (call[1] > lowest[1] ? call : lowest));
    expect(axis[1] - start).toBeCloseTo(30, 6);
  });

  it('writes the titles of the axes', () => {
    const { texts, doc } = textsOf({ xs: XS, lines: [LINE] }, { xTitle: 'Year', yTitle: 'Value' });
    expect(textOf(texts, 'Value').x).toBe(doc.margins.left);
    expect(textOf(texts, 'Year').align).toBe('center');
    expect(textOf(texts, 'Year').y).toBeGreaterThan(textOf(texts, '2026').y);
  });

  it('draws every line, the emphasized ones last, with their width and dash', () => {
    const doc = makeDoc();
    const stroke = vi.spyOn(doc.doc, 'stroke');
    const widths: number[] = [];
    const dashes: unknown[] = [];
    vi.spyOn(doc.doc, 'setLineWidth').mockImplementation(function (this: unknown, width: number) {
      widths.push(width);
      return doc.doc;
    });
    vi.spyOn(doc.doc, 'setLineDashPattern').mockImplementation(function (this: unknown, pattern: number[]) {
      dashes.push(pattern);
      return doc.doc;
    });
    doc.lineChart(
      {
        xs: XS,
        lines: [
          { label: 'Emphasis', values: LINE.values, emphasis: true, lineWidth: 1.4 },
          { label: 'Dashed', values: LINE.values, dash: [2, 1] },
        ],
      },
      { yTicks: 1 },
    );
    expect(stroke).toHaveBeenCalledTimes(2);
    // The dashed line is stroked first, the emphasized one after it: the width 1.4 comes after the default one.
    const strokes = widths.filter((width) => width === CHART.line.lineWidth || width === 1.4);
    expect(strokes.indexOf(CHART.line.lineWidth)).toBeLessThan(strokes.indexOf(1.4));
    expect(dashes).toContainEqual([2, 1]);
  });

  it('shades a band, translucent, and gives it a legend entry', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const gState = vi.spyOn(doc.doc, 'setGState');
    doc.lineChart({ xs: XS, lines: [LINE], band: BAND });
    expect(gState).toHaveBeenCalled();
    expect(drawnTexts(texts)).toContain('Range');
  });

  it('draws no band, and no legend entry for it, when it is no wider than a line', () => {
    const { drawn } = textsOf({
      xs: XS,
      lines: [LINE],
      band: { label: 'Flat range', lower: LINE.values, upper: LINE.values },
    });
    expect(drawn).not.toContain('Flat range');
  });

  it('highlights an area under the emphasized line, with a legend entry only when it has a label', () => {
    expect(highlightArea('Target period')).toEqual({ fills: 1, drawn: expect.arrayContaining(['Target period']) });
    expect(highlightArea().drawn).not.toContain('undefined');
    expect(highlightArea().fills).toBe(1);
  });

  it('keeps the highlight inside the range of xs', () => {
    const doc = makeDoc();
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    doc.lineChart({ xs: XS, lines: [LINE] }, { highlight: { from: 1990, to: 2100 } });
    const xs = [...moveTo.mock.calls, ...lineTo.mock.calls].map(([x]) => x as number);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(doc.margins.left);
    expect(Math.max(...xs)).toBeLessThanOrEqual(doc.margins.left + doc.contentWidth + 1e-6);
  });

  it('follows the first line with emphasis for the highlight', () => {
    // On the high line the area reaches higher (a smaller Y) than on the low one.
    expect(highlightTop(true)).toBeLessThan(highlightTop(false) - 1);
  });

  it('wraps a legend of many lines inside the width of the chart', () => {
    const doc = makeDoc();
    const extents = recordExtents(doc);
    doc.lineChart({ xs: XS, lines: manyLines(12) }, { width: 100 });
    expectWithin(extents, doc.margins.left, doc.margins.left + 100);
    const one = makeDoc();
    one.lineChart({ xs: XS, lines: [LINE] }, { width: 100 });
    expect(doc.getYPos()).toBeGreaterThan(one.getYPos());
  });

  it('cuts a legend entry wider than the chart', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.lineChart(
      { xs: XS, lines: [{ ...LINE, label: 'A line whose name goes on and on well past the edge of the chart' }] },
      { width: 50 },
    );
    expect(texts.some((call) => call.lines[0].endsWith('…'))).toBe(true);
  });

  it('prints the grid values of a fine scale exactly', () => {
    expect(yLabelsOf([0.02, 0.05, 0.08])).toEqual(expect.arrayContaining(['0', '0.025', '0.05', '0.075', '0.1']));
    expect(yLabelsOf([0.002, 0.005, 0.008])).toEqual(expect.arrayContaining(['0.0025', '0.005', '0.0075', '0.01']));
  });

  it('prints whole numbers without decimals', () => {
    const { drawn } = textsOf({ xs: [0, 1, 2], lines: [{ label: 'L', values: [100, 120, 146] }] });
    expect(drawn).toEqual(expect.arrayContaining(['0', '50', '100', '150', '200']));
  });

  it('draws a chart whose points all share one X, on the left edge of the plot', () => {
    const doc = makeDoc();
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    doc.lineChart({ xs: [3, 3], lines: [{ label: 'L', values: [1, 2] }] });
    const [[fromX, fromY]] = moveTo.mock.calls as number[][];
    const [[toX, toY]] = lineTo.mock.calls as number[][];
    expect(toX).toBeCloseTo(fromX, 6);
    expect(toY).toBeLessThan(fromY);
  });

  it('draws a legend of a band only', () => {
    const { drawn } = textsOf({ xs: XS, lines: [], band: BAND });
    expect(drawn).toContain('Range');
  });

  it.each([
    ['a height of 0', { height: 0 }, /height/],
    ['a width that is NaN', { width: Number.NaN }, /width/],
    ['a negative width', { width: -4 }, /width/],
    ['yTicks of 0', { yTicks: 0 }, 'Invalid lineChart yTicks: 0 — must be a whole number, at least 1'],
    ['yTicks that is no whole number', { yTicks: 2.5 }, /yTicks/],
    ['xTicks of 1', { xTicks: 1 }, 'Invalid lineChart xTicks: 1 — must be a whole number, at least 2'],
    ['xTicks that is NaN', { xTicks: Number.NaN }, /xTicks/],
    ['a highlight that ends before it starts', { highlight: { from: 2029, to: 2027 } }, /highlight\.to/],
    ['a highlight from that is NaN', { highlight: { from: Number.NaN, to: 2027 } }, /highlight\.from/],
    ['a highlight to that is infinite', { highlight: { from: 2027, to: Number.POSITIVE_INFINITY } }, /highlight\.to/],
    [
      'a highlight label that is not a string',
      { highlight: { from: 2027, to: 2028, label: 1 as never } },
      /highlight\.label/,
    ],
    ['an xTitle that is not a string', { xTitle: 1 as never }, /xTitle/],
    ['a yTitle that is not a string', { yTitle: 1 as never }, /yTitle/],
    [
      'a formatValue that returns a number',
      { formatValue: (() => 1) as never },
      'Invalid value returned by lineChart formatValue: 1 — must be a string',
    ],
    [
      'a formatX that returns nothing',
      { formatX: (() => undefined) as never },
      /formatX: undefined — must be a string/,
    ],
  ])('throws for %s, before drawing', (_, options, message) => {
    const doc = makeDoc();
    const line = vi.spyOn(doc.doc, 'line');
    const start = doc.getYPos();
    expect(() => doc.lineChart({ xs: XS, lines: [LINE] }, options)).toThrow(InvalidOptionError);
    expect(() => doc.lineChart({ xs: XS, lines: [LINE] }, options)).toThrow(message);
    expect(line).not.toHaveBeenCalled();
    expect(doc.getYPos()).toBe(start);
  });

  it.each([
    ['a lineWidth of 0', { lineWidth: 0 }, 'Invalid lineChart line "Forecast" lineWidth: 0 — must be a finite number'],
    ['a negative lineWidth', { lineWidth: -1 }, /lineWidth/],
    [
      'a dash of one length',
      { dash: [2] as never },
      'Invalid lineChart line "Forecast" dash: [2] — must be two lengths',
    ],
    ['a dash with a negative length', { dash: [-1, 2] as [number, number] }, /dash/],
    ['a dash of zeros', { dash: [0, 0] as [number, number] }, /dash/],
    ['a dash that is NaN', { dash: [Number.NaN, 1] as [number, number] }, /dash/],
    ['a dash that is not an array', { dash: 3 as never }, /dash/],
  ])('throws for a line with %s, before drawing', (_, style, message) => {
    const doc = makeDoc();
    const line = vi.spyOn(doc.doc, 'line');
    expect(() => doc.lineChart({ xs: XS, lines: [{ ...LINE, ...style }] })).toThrow(InvalidOptionError);
    expect(() => doc.lineChart({ xs: XS, lines: [{ ...LINE, ...style }] })).toThrow(message);
    expect(line).not.toHaveBeenCalled();
  });

  it('checks the data and the options even when there is nothing to draw', () => {
    expect(() => makeDoc().lineChart({ xs: [1], lines: [{ label: 'L', values: [] }] })).toThrow(InvalidOptionError);
    expect(() => makeDoc().lineChart({ xs: [1], lines: [] }, { height: -1 })).toThrow(InvalidOptionError);
  });

  it('takes the series without a color from the palette', () => {
    const doc = makeDoc();
    const stroke = vi.spyOn(doc.doc, 'setDrawColor');
    doc.lineChart({ xs: XS, lines: manyLines(2) }, { yTicks: 1 });
    const colors = stroke.mock.calls.map(([value]) => String(value));
    expect(colors).toContain(doc.theme.colors.primary);
  });
});

describe('a width wider than the frame', () => {
  it.each([
    ['stackedBar width', (ctx: PDFDocument) => ctx.stackedBar(SLICES, { width: 500 })],
    ['lineChart width', (ctx: PDFDocument) => ctx.lineChart({ xs: XS, lines: [LINE] }, { width: 500 })],
    ['donutChart diameter', (ctx: PDFDocument) => ctx.donutChart(SLICES, { diameter: 500, legend: false })],
  ])('brings the %s down to the column, with a warning', (what, draw) => {
    const doc = makeDoc();
    const width = columnWidth(doc.contentWidth, 2, LAYOUT.columnGap);
    const left = doc.margins.left + width + LAYOUT.columnGap;
    const extents = recordExtents(doc);
    doc.columns([() => {}, (ctx) => draw(ctx)]);
    expectWithin(extents, left, left + width);
    expect(doc.warnings).toEqual([
      `${what} of 500.0 mm is wider than the available width (${width.toFixed(1)} mm): it is brought down to fit`,
    ]);
  });

  it('brings the donut down to the frame, as tall as it is wide', () => {
    const doc = makeDoc();
    const start = doc.getYPos();
    doc.donutChart(SLICES, { diameter: 500, legend: false, spaceAfter: 0 });
    expect(doc.getYPos() - start).toBeCloseTo(doc.contentWidth, 6);
  });

  it('brings a donut with a legend down to the room beside it, with the one warning of the frame', () => {
    const doc = makeDoc();
    const extents = recordExtents(doc);
    doc.donutChart(SLICES, { diameter: 500 });
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toMatch(/^donutChart diameter of 500\.0 mm is wider than the available width/);
    expectWithin(extents, doc.margins.left, doc.margins.left + doc.contentWidth);
  });

  it('says nothing of a width that fits, or of a chart that draws nothing', () => {
    const doc = makeDoc();
    doc.stackedBar(SLICES, { width: doc.contentWidth });
    doc.stackedBar([], { width: 500 });
    doc.lineChart({ xs: [1], lines: [] }, { width: 500 });
    doc.donutChart([], { diameter: 500 });
    expect(doc.warnings).toEqual([]);
  });

  it('shrinks the default donut to a column narrower than its smallest diameter, without a warning', () => {
    const doc = makeDoc();
    const width = columnWidth(doc.contentWidth, 10, LAYOUT.columnGap);
    expect(width).toBeLessThan(20);
    const extents = recordExtents(doc);
    doc.columns(
      Array.from(
        { length: 10 },
        (_, at) => (ctx) => (at === 0 ? ctx.donutChart(SLICES, { legend: false }) : undefined),
      ),
    );
    expectWithin(extents, doc.margins.left, doc.margins.left + width);
    expect(doc.warnings).toEqual([]);
  });
});

describe('a label with no room', () => {
  it('warns once for the chart, however many labels it loses', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.stackedBar(slices(1, 1, 1), { width: 4, percentages: false });
    expect(drawnTexts(texts).filter((text) => text !== '')).toEqual([]);
    expect(doc.warnings).toEqual(['stackedBar: labels with no room are left out, "Part 1 33%" among them']);
  });

  it('warns once per chart, and once for a chart measured before it is drawn', () => {
    const doc = makeDoc();
    computeStackedBarHeight(doc, slices(1, 1), { width: 4 });
    doc.stackedBar(slices(1, 1), { width: 4 });
    doc.keepTogether(() => doc.stackedBar([{ label: 'Other', value: 1 }], { width: 4 }));
    expect(doc.warnings).toEqual([
      'stackedBar: labels with no room are left out, "Part 1 50%" among them',
      'stackedBar: labels with no room are left out, "Other 100%" among them',
    ]);
  });

  it('warns for the label of a hole too small for an ellipsis', () => {
    const doc = makeDoc();
    doc.donutChart(SLICES, { diameter: 10, innerRatio: 0.05, centerLabel: 'Total', legend: false });
    expect(doc.warnings).toEqual(['donutChart: labels with no room are left out, "Total" among them']);
  });

  it('warns for a value label under a column too narrow for it', () => {
    const doc = makeDoc();
    doc.columnChart(Array.from({ length: 40 }, () => ({ label: '', valueLabel: '$1,234', values: [1] })));
    expect(doc.warnings).toEqual(['columnChart: labels with no room are left out, "$1,234" among them']);
  });

  it('warns for a column label too narrow for its ellipsis, where it would vanish without a trace', () => {
    const doc = makeDoc();
    doc.columnChart(Array.from({ length: 40 }, () => ({ label: 'Quarterly results', values: [1] })));
    expect(doc.warnings).toEqual(['columnChart: labels with no room are left out, "Quarterly results" among them']);
  });

  it('warns for a donut whose diameter leaves its legend no room, and brings it down', () => {
    const doc = makeDoc();
    const before = doc.getYPos();
    doc.donutChart(SLICES, { diameter: 180, spaceAfter: 0 });
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toMatch(/diameter of 180\.0 mm leaves no room for the legend/);
    expect(doc.getYPos() - before).toBeLessThan(180);
  });

  it('does not label two points of an uneven X axis on top of each other', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.lineChart({
      xs: [2000, 2001, 2002, 2003, 2004, 2040],
      lines: [{ label: 'Sales', values: [1, 2, 3, 4, 5, 6] }],
    });
    const years = texts.filter((call) => /^20\d\d$/.test(call.lines[0])).toSorted((a, b) => a.x - b.x);
    for (let index = 1; index < years.length; index++) {
      expect(years[index].x).toBeGreaterThanOrEqual(years[index - 1].x + years[index - 1].widths[0]);
    }
  });
});

/** What a line chart of `options` draws, and what it leaves behind. */
const attempt = (options: LineChartOptions) => {
  const doc = makeDoc();
  const texts = recordTexts(doc);
  const spies = (['line', 'rect', 'moveTo'] as const).map((method) => vi.spyOn(doc.doc, method));
  const start = doc.peekYPos();
  doc.lineChart({ xs: XS, lines: [LINE], band: BAND }, options);
  const drawn = texts.length > 0 || spies.some((spy) => spy.mock.calls.length > 0);
  return { doc, start, drawn, height: computeLineChartHeight(doc, { xs: XS, lines: [LINE] }, options) };
};

/** A line chart with no Y labels: its plot is the width minus the gap before it. */
const noLabels = (width: number) => ({ width, formatValue: () => '' });

describe('a line chart plot with no width', () => {
  it.each([
    ['a width under the Y labels', { width: 8 }],
    ['a negative plot: the labels are wider than the chart', { width: 30, formatValue: () => 'A very long Y label' }],
    ['a width of 0.01', { width: 0.01 }],
  ])('draws nothing for %s, and takes no room', (_, options) => {
    const { doc, start, drawn, height } = attempt(options);
    expect(drawn).toBe(false);
    expect(doc.peekYPos()).toBe(start);
    expect(height).toBe(0);
    expect(doc.doc.getNumberOfPages()).toBe(1);
  });

  it('warns once for the chart, saying what it needs', () => {
    const doc = makeDoc();
    doc.lineChart({ xs: XS, lines: [LINE] }, { width: 8, formatValue: () => 'A very long Y label' });
    expect(doc.warnings).toEqual([
      `Failed to draw lineChart: its width leaves a plot 0.0 mm wide, under the ${CHART.line.minPlotWidth} mm it needs`,
    ]);
  });

  it('warns once, and draws nothing, inside keepTogether', () => {
    const doc = makeDoc();
    const line = vi.spyOn(doc.doc, 'line');
    const start = doc.peekYPos();
    doc.keepTogether(() => doc.lineChart({ xs: XS, lines: [LINE] }, { width: 8 }));
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toMatch(/^Failed to draw lineChart: .*[^.]$/);
    expect(line).not.toHaveBeenCalled();
    expect(doc.peekYPos()).toBe(start);
    expect(doc.doc.getNumberOfPages()).toBe(1);
  });

  it('draws from the narrowest plot up, and warns under it', () => {
    // Without Y labels the plot is the width minus the gap before it.
    const enough = makeDoc();
    enough.lineChart({ xs: XS, lines: [LINE] }, noLabels(CHART.line.minPlotWidth + CHART.line.axisGap + 0.01));
    expect(enough.warnings).toEqual([]);
    expect(enough.peekYPos()).toBeGreaterThan(makeDoc().peekYPos());
    const short = makeDoc();
    short.lineChart({ xs: XS, lines: [LINE] }, noLabels(CHART.line.minPlotWidth + CHART.line.axisGap - 0.01));
    expect(short.warnings).toHaveLength(1);
    expect(short.peekYPos()).toBe(makeDoc().peekYPos());
  });

  it('says nothing, and draws nothing, for an emptyText chart too narrow: nothing to draw comes first', () => {
    const doc = makeDoc();
    doc.lineChart({ xs: [1], lines: [] }, { width: 8, emptyText: 'No data' });
    expect(doc.warnings).toEqual([]);
  });

  it('leaves the other charts a plot of some width in the narrowest column', () => {
    const doc = makeDoc();
    const rects = vi.spyOn(doc.doc, 'rect');
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    doc.columns(
      Array.from({ length: 10 }, (_, at) => (ctx) => {
        if (at === 0) ctx.stackedBar(LONG_SLICES);
        if (at === 1) ctx.columnChart(CROWDED_COLUMNS);
        if (at === 2) ctx.donutChart(LONG_SLICES);
      }),
    );
    expect(doc.warnings.filter((warning) => warning.startsWith('Failed to draw'))).toEqual([]);
    expect((rects.mock.calls as number[][]).every(([, , width]) => width > 0)).toBe(true);
    expect(moveTo).toHaveBeenCalled();
    expect(donutDiameterIn(10)).toBeGreaterThan(0);
  });
});

describe('what the charts check before drawing', () => {
  it.each([
    [
      'donutChart, a label',
      (ctx: PDFDocument) => ctx.donutChart([...SLICES, { label: 4 as never, value: 0 }]),
      /label/,
    ],
    [
      'donutChart, a legendValue',
      (ctx: PDFDocument) => ctx.donutChart([...SLICES, { label: 'Nil', value: -1, legendValue: 3 as never }]),
      /legendValue of "Nil": 3/,
    ],
    [
      'stackedBar, a label',
      (ctx: PDFDocument) => ctx.stackedBar([...SLICES, { label: null as never, value: Number.NaN }]),
      /label: null/,
    ],
  ])('%s of a part left out', (_, draw, message) => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'rect');
    expect(() => draw(doc)).toThrow(InvalidOptionError);
    expect(() => draw(doc)).toThrow(message);
    expect(rect).not.toHaveBeenCalled();
  });

  it.each([
    ['donutChart slices', (ctx: PDFDocument) => ctx.donutChart(undefined as never), 'Invalid donutChart data'],
    ['stackedBar slices', (ctx: PDFDocument) => ctx.stackedBar({} as never), 'Invalid stackedBar data'],
    ['columnChart columns', (ctx: PDFDocument) => ctx.columnChart(5 as never), 'Invalid columnChart data'],
    [
      'columnChart series',
      (ctx: PDFDocument) => ctx.columnChart(COLUMNS, { series: 'Licences' as never }),
      'Invalid columnChart series',
    ],
    ['lineChart xs', (ctx: PDFDocument) => ctx.lineChart({ xs: 5 as never, lines: [] }), 'Invalid lineChart xs: 5'],
    [
      'lineChart xs, missing',
      (ctx: PDFDocument) => ctx.lineChart({ lines: [] } as never),
      'Invalid lineChart xs: undefined',
    ],
    ['lineChart lines', (ctx: PDFDocument) => ctx.lineChart({ xs: XS } as never), 'Invalid lineChart lines'],
    [
      'lineChart band.upper',
      (ctx: PDFDocument) => ctx.lineChart({ xs: XS, lines: [LINE], band: { ...BAND, upper: null as never } }),
      'Invalid lineChart band.upper',
    ],
  ])('%s that is not an array throws an InvalidOptionError', (_, draw, message) => {
    const doc = makeDoc();
    expect(() => draw(doc)).toThrow(InvalidOptionError);
    expect(() => draw(doc)).toThrow(`${message}`);
  });

  it.each([
    ['a series label', { series: [{ label: 3 as never }] }, 'Invalid columnChart series label: 3 — must be a string'],
  ])('columnChart throws for %s that is not a string', (_, options, message) => {
    expect(() => makeDoc().columnChart(COLUMNS, options)).toThrow(message);
  });

  it.each([
    ['a line', { xs: [1, 2, 3], lines: [{ label: 'L', values: [5, -3, 0] }] }, /line "L" values at index 1: -3/],
    [
      'the bottom of the band',
      { xs: [1, 2, 3], lines: [], band: { label: 'B', lower: [-1, 0, 0], upper: [1, 1, 1] } },
      /band\.lower at index 0: -1/,
    ],
    [
      'the label of a line',
      { xs: [1, 2, 3], lines: [{ label: 7 as never, values: [1, 2, 3] }] },
      /lineChart line label: 7/,
    ],
    [
      'the label of the band',
      { xs: [1, 2], lines: [], band: { label: 7 as never, lower: [0, 0], upper: [1, 1] } },
      /band label/,
    ],
  ])('lineChart throws for a negative value or a label that is no text: %s', (_, data, message) => {
    const doc = makeDoc();
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    expect(() => doc.lineChart(data)).toThrow(InvalidOptionError);
    expect(() => doc.lineChart(data)).toThrow(message);
    expect(lineTo).not.toHaveBeenCalled();
  });

  it.each([
    [
      'donutChart innerRatio',
      (ctx: PDFDocument) => ctx.donutChart(SLICES, { innerRatio: 1 }),
      '1 — must be a finite number, at least 0 and less than 1',
    ],
    [
      'donutChart diameter',
      (ctx: PDFDocument) => ctx.donutChart(SLICES, { diameter: 0 }),
      '0 — must be a finite number, greater than 0',
    ],
    [
      'stackedBar height',
      (ctx: PDFDocument) => ctx.stackedBar(SLICES, { height: '9' as never }),
      '9 — must be a finite number, greater than 0',
    ],
    [
      'columnChart max',
      (ctx: PDFDocument) => ctx.columnChart(COLUMNS, { max: -1 }),
      '-1 — must be a finite number, greater than 0',
    ],
    [
      'lineChart highlight.to',
      (ctx: PDFDocument) => ctx.lineChart({ xs: XS, lines: [LINE] }, { highlight: { from: 2029, to: 2027 } }),
      '2027 — must be a finite number, at least 2029',
    ],
    [
      'lineChart line "Forecast" dash length',
      (ctx: PDFDocument) => ctx.lineChart({ xs: XS, lines: [{ ...LINE, dash: [1, -1] }] }),
      '-1 — must be a finite number, at least 0',
    ],
  ])('says what %s must be, in the one format of every number option', (what, draw, rule) => {
    expect(() => draw(makeDoc())).toThrow(`Invalid ${what}: ${rule}`);
  });
});

describe('lineChart with many points', () => {
  it('draws the highlight of 10 000 points as the reference interpolation does', () => {
    const xs = Array.from({ length: 10_000 }, (_, index) => index * 0.5);
    const values = xs.map((x) => 50 + 40 * Math.sin(x / 300));
    const [from, to] = [1234.3, 3210.7];
    const doc = makeDoc();
    const moveTo = vi.spyOn(doc.doc, 'moveTo');
    const lineTo = vi.spyOn(doc.doc, 'lineTo');
    doc.lineChart({ xs, lines: [{ label: 'L', values }] }, { highlight: { from, to } });

    // Two paths: the highlighted area, then the line, whose points give the position of every value.
    const lineLength = xs.length - 1;
    const outlineLength = lineTo.mock.calls.length - lineLength + 1;
    const outline = [moveTo.mock.calls[0], ...lineTo.mock.calls.slice(0, outlineLength - 1)] as number[][];
    const line = [moveTo.mock.calls[1], ...lineTo.mock.calls.slice(outlineLength - 1)] as number[][];
    const bottom = outline[0][1];
    // The point of the line at `x`, interpolated between the points around it.
    const at = (x: number): number[] => {
      const next = xs.findIndex((knot) => x <= knot);
      const share = (x - xs[next - 1]) / (xs[next] - xs[next - 1]);
      const [a, b] = [line[next - 1], line[next]];
      return [a[0] + share * (b[0] - a[0]), a[1] + share * (b[1] - a[1])];
    };
    const inside = line.filter((_, index) => xs[index] > from && xs[index] < to);
    const expected = [[at(from)[0], bottom], at(from), ...inside, at(to), [at(to)[0], bottom]];

    expect(outline).toHaveLength(expected.length);
    outline.forEach(([x, y], index) => {
      expect(x).toBeCloseTo(expected[index][0], 6);
      expect(y).toBeCloseTo(expected[index][1], 6);
    });
  });

  it('draws 200 000 values without running out of stack', () => {
    const xs = Array.from({ length: 200_000 }, (_, index) => index);
    const values = xs.map((x) => x % 97);
    const doc = makeDoc();
    const texts = recordTexts(doc);
    let points = 0;
    const lineTo = doc.doc.lineTo.bind(doc.doc);
    doc.doc.lineTo = (x: number, y: number) => {
      points++;
      return lineTo(x, y);
    };
    doc.lineChart({ xs, lines: [{ label: 'L', values }] });
    expect(points).toBe(xs.length - 1);
    expect(drawnTexts(texts)).toEqual(expect.arrayContaining(['0', '100', '199999', 'L']));
  });
});

describe('a line chart with a band and no line', () => {
  it('draws the band with no legend when its label is empty', () => {
    const data = { xs: [1, 2, 3], lines: [], band: { label: '', lower: [1, 1, 1], upper: [2, 3, 4] } };
    const doc = makeDoc();
    const fill = vi.spyOn(doc.doc, 'fill');
    const points: number[][] = [];
    for (const method of ['moveTo', 'lineTo'] as const) {
      const original = doc.doc[method].bind(doc.doc);
      vi.spyOn(doc.doc, method).mockImplementation((x, y) => (points.push([x, y]), original(x, y)));
    }
    const start = doc.getYPos();
    doc.lineChart(data, { spaceAfter: 0 });
    expect(fill).toHaveBeenCalledTimes(1);
    expect(doc.warnings).toEqual([]);
    // One polygon: along the top (2, 3, 4) from left to right, then back along the bottom (1, 1, 1).
    expect(points).toHaveLength(6);
    const [top, bottom] = [points.slice(0, 3), points.slice(3)];
    expect(bottom.map(([x]) => x)).toEqual(top.map(([x]) => x).toReversed());
    const step = top[1][0] - top[0][0];
    expect(step).toBeGreaterThan(0);
    expect(top[2][0] - top[1][0]).toBeCloseTo(step, 6);
    // One unit of value is the same height everywhere: the bottom, at 1, lies one unit under the top's 2.
    const unit = top[0][1] - top[1][1];
    expect(unit).toBeGreaterThan(0);
    expect(top[1][1] - top[2][1]).toBeCloseTo(unit, 6);
    for (const [, y] of bottom) expect(y - top[0][1]).toBeCloseTo(unit, 6);
    expectDrawnHeight(computeLineChartHeight, drawLineChart, data, { spaceAfter: 0 });
    expect(computeLineChartHeight(doc, data, { spaceAfter: 0 })).toBeLessThan(
      computeLineChartHeight(doc, { ...data, band: { ...data.band, label: 'Range' } }, { spaceAfter: 0 }),
    );
    expect(doc.getYPos()).toBeGreaterThan(start);
  });
});
