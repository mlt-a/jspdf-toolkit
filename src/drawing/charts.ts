import { CHART, LINE_WIDTH, capitalMiddle } from '../core/constants';
import type { TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  InvalidOptionError,
  POSITIVE,
  checkedArray,
  checkedNumber,
  checkedObject,
  checkedObjects,
  checkedText,
  optionalBoolean,
  optionalFunction,
  optionalNumber,
  optionalText,
} from '../core/errors';
import type { NumberBounds } from '../core/errors';
import { readableOn, resolveColor, resolveOptionalColor } from '../theme/colors';
import type { ColorInput } from '../theme/types';
import type { ChartLayout, LabelFitter, LegendEntry, Point, Swatch } from './chart-parts';
import {
  AXIS_LEVEL,
  LEGEND_LEVEL,
  VALUE_LEVEL,
  chartHeight,
  drawChart,
  emptyChart,
  fillPolygon,
  isDrawable,
  labelFitter,
  legendBaseline,
  legendBelow,
  legendRowsHeight,
  percent,
  seriesColors,
  squareSwatch,
  strokePolyline,
  widestText,
  withOpacity,
} from './chart-parts';
import { withDrawingState, withStroke } from './drawing-state';
import type { Stroke } from './drawing-state';
import { measureTextLevel, resolveTextStyle, setTextStyle } from './text';
import type { TextLevelMetrics } from './text';
import { drawLines, fitWithEllipsis, frameWidth, text as drawText, wrap } from './text-lines';
import { applyTextStyle } from './text-style';

// Four charts, each in two steps: `layoutX` validates the input, resolves the colors and measures everything once,
// then `drawX` reserves the room and paints from that layout. `computeXHeight` reads the same layout.

/** A named series of a chart: a slice, a layer of columns, a line, a band. */
export interface ChartSeries {
  /** Name in the legend. */
  label: string;
  /**
   * Color in the chart and in the legend. Default: a shade of the primary color, one per slice, layer or line in
   * order, the primary first.
   */
  color?: ColorInput;
}

// === Parts of a whole ===

/** One part of a whole: a slice of `donutChart`, or of the bar of `stackedBar`. */
export interface ChartSlice extends ChartSeries {
  /** A value that is not a finite number above 0 leaves the part out. */
  value: number;
  /** Text of the legend in place of the percentage, e.g. `'$1,200'`. */
  legendValue?: string;
}

/** A part that is drawn, its color resolved and its legend text written. */
interface Part {
  label: string;
  value: number;
  color: string;
  /** Its percentage of the whole. */
  share: string;
  /** What the legend shows: `legendValue`, else `share`. */
  legendText: string;
}

/**
 * The parts a chart draws: those with a drawable value, in order, each with its color. Every part is checked first,
 * those left out too, so an invalid label or color throws before anything is drawn.
 */
function drawableParts(ctx: DrawingContext, method: string, parts: readonly ChartSlice[]): Part[] {
  checkedObjects(`${method} data`, parts, (part) => {
    checkedText(`${method} label`, part.label);
    optionalText(`${method} legendValue of "${part.label}"`, part.legendValue);
    // The colors of the parts kept are resolved once, below.
    if (!isDrawable(part.value) && part.color !== undefined) resolveColor(ctx.theme, part.color);
  });
  const kept = parts.filter((part) => isDrawable(part.value));
  const colors = seriesColors(
    ctx,
    kept.map((part) => part.color),
    kept.length,
  );
  const total = kept.reduce((sum, part) => sum + part.value, 0);
  return kept.map((part, index) => {
    const share = percent(part.value, total);
    return { label: part.label, value: part.value, color: colors[index], share, legendText: part.legendValue ?? share };
  });
}

// === Donut ===

/** Text level of the label in the hole. */
const CENTER_LEVEL: TextLevel = 'bodyBold';
/** Text level of the labels of the legend beside the ring; its values are in `LEGEND_LEVEL`. */
const SIDE_LEGEND_LEVEL: TextLevel = 'small';

/**
 * Options of `donutChart`: the slices as a ring, with the legend on its right, each slice with its percentage or
 * `legendValue`. Slices without a color take shades of the primary color. A slice whose value is not a finite number
 * above 0 is left out; without a slice left, the chart draws `emptyText`, or nothing. Invalid options throw an
 * `InvalidOptionError` before anything is drawn, even when there is nothing to draw.
 */
export interface DonutChartOptions {
  /**
   * Diameter (mm), above 0. Wider than the available width: brought down to it, with a
   * warning. Within that width but leaving the legend less than 36 mm beside it (the room is then at
   * least 20 mm): brought down to what is left, with a warning of its own. Default: 46, shrinking without a warning to
   * leave the legend 36 mm, down to 20, and to the available width.
   */
  diameter?: number;
  /**
   * Radius of the hole, as a share of the radius, from 0 up to but excluding 1: 0 draws a pie. Default: 0.62.
   */
  innerRatio?: number;
  /** Text in the middle of the hole, e.g. the total. Cut short when it is wider than the hole. */
  centerLabel?: string;
  /** Legend on the right. Default: `true`. */
  legend?: boolean;
  /** Line drawn when no slice has a value. Default: none, the chart draws nothing. */
  emptyText?: string;
  /** Space (mm) under the chart. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

/**
 * Start and end angle (radians) of each value around a circle, clockwise from the top. A value of zero or less
 * gets an empty arc; the spans add up to a full turn when the total is positive.
 */
export function computeDonutAngles(values: number[]): { start: number; end: number }[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  let cursor = CHART.donut.startAngle;
  return values.map((value) => {
    const span = total > 0 ? (Math.max(0, value) / total) * CHART.fullTurn : 0;
    const range = { start: cursor, end: cursor + span };
    cursor += span;
    return range;
  });
}

/** Outline of a ring sector, or of a pie sector when `inner` is 0. */
function ringSector(cx: number, cy: number, outer: number, inner: number, start: number, end: number): Point[] {
  const steps = Math.max(CHART.minArcSteps, Math.ceil((end - start) / CHART.arcStep));
  const arc = (radius: number, from: number, to: number): Point[] =>
    Array.from({ length: steps + 1 }, (_, step) => {
      const angle = from + ((to - from) * step) / steps;
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    });
  return inner > 0 ? [...arc(outer, start, end), ...arc(inner, end, start)] : [[cx, cy], ...arc(outer, start, end)];
}

/** The diameter given, kept in the frame; else the default, which gives way to the legend and to the frame. */
function donutDiameter(ctx: DrawingContext, diameter: number | undefined, legend: boolean): number {
  const { contentWidth } = ctx;
  const beside = legend ? contentWidth - CHART.legendGap - CHART.donut.legendMinWidth : contentWidth;
  const room = Math.min(contentWidth, Math.max(CHART.donut.minDiameter, beside));
  if (diameter !== undefined) {
    const framed = frameWidth(ctx, 'donutChart diameter', diameter);
    if (framed <= room) return framed;
    // A ring this wide leaves the legend no room beside it: it would run out of the frame.
    if (diameter <= contentWidth) {
      ctx.addWarning(
        `donutChart diameter of ${diameter.toFixed(1)} mm leaves no room for the legend (${room.toFixed(1)} mm at most): ` +
          'it is brought down to fit',
      );
    }
    return room;
  }
  return Math.min(CHART.donut.diameter, room);
}

/** The legend beside a donut, measured: one line per part. */
interface SideLegend {
  height: number;
  metrics: TextLevelMetrics;
  swatches: Swatch[];
  /** The labels, cut to the room. */
  labels: string[];
  values: string[];
  /** Right edge of the values, from the left edge of the legend. */
  valueRight: number;
}

/**
 * The legend beside a donut, `width` wide: swatch, label, then the values in a column right after the widest label,
 * so a value never floats far from its label. A label too long for the room is cut with an ellipsis.
 */
function layoutSideLegend(ctx: DrawingContext, parts: Part[], width: number, labels: LabelFitter): SideLegend {
  const labelX = CHART.swatch + CHART.swatchGap;
  const values = parts.map((part) => part.legendText);
  return withDrawingState(ctx, () => {
    setTextStyle(ctx, LEGEND_LEVEL);
    const valueWidth = widestText(ctx, values);
    setTextStyle(ctx, SIDE_LEGEND_LEVEL);
    const room = width - labelX - CHART.legendGap - valueWidth;
    const names = parts.map((part) => part.label);
    const labelWidth = Math.max(CHART.donut.minLabelWidth, Math.min(room, widestText(ctx, names)));
    const metrics = measureTextLevel(ctx, SIDE_LEGEND_LEVEL);
    return {
      height: legendRowsHeight(parts.length, metrics.lineHeight),
      metrics,
      swatches: parts.map((part) => squareSwatch(ctx, part.color)),
      labels: names.map((name) => labels.fit(name, labelWidth)),
      values,
      valueRight: Math.min(labelX + labelWidth + CHART.legendGap + valueWidth, width),
    };
  });
}

function paintSideLegend(ctx: DrawingContext, legend: SideLegend, left: number, top: number): void {
  const { metrics } = legend;
  const step = metrics.lineHeight + CHART.legendRowGap;
  const firstBaseline = legendBaseline(top, 0, metrics);
  legend.swatches.forEach((swatch, row) => swatch(left, legendBaseline(top, row, metrics) - capitalMiddle(metrics)));
  setTextStyle(ctx, SIDE_LEGEND_LEVEL);
  drawLines(ctx, legend.labels, left + CHART.swatch + CHART.swatchGap, firstBaseline, step);
  setTextStyle(ctx, LEGEND_LEVEL);
  drawLines(ctx, legend.values, left + legend.valueRight, firstBaseline, step, 'right');
}

/** Layout shared by `drawDonutChart` and `computeDonutChartHeight`; `undefined` when there is nothing to draw. */
function layoutDonutChart(
  ctx: DrawingContext,
  slices: ChartSlice[],
  options?: DonutChartOptions,
): ChartLayout | undefined {
  const method = 'donutChart';
  const innerRatio =
    optionalNumber(`${method} innerRatio`, options?.innerRatio, { min: 0, exclusiveMax: 1 }) ?? CHART.donut.innerRatio;
  if (options?.diameter !== undefined) checkedNumber(`${method} diameter`, options.diameter, POSITIVE);
  const centerLabel = optionalText(`${method} centerLabel`, options?.centerLabel);
  const emptyText = optionalText(`${method} emptyText`, options?.emptyText);
  const showLegend = optionalBoolean(`${method} legend`, options?.legend) ?? true;
  const parts = drawableParts(ctx, method, slices);
  if (parts.length === 0) return emptyChart(ctx, emptyText);

  const diameter = donutDiameter(ctx, options?.diameter, showLegend);
  const radius = diameter / 2;
  const labels = labelFitter(ctx, method);
  const center =
    innerRatio > 0 && centerLabel
      ? withDrawingState(ctx, () => {
          setTextStyle(ctx, CENTER_LEVEL);
          const { ascent } = measureTextLevel(ctx, CENTER_LEVEL);
          return { text: labels.fit(centerLabel, diameter * innerRatio), ascent };
        })
      : undefined;
  const legend = showLegend
    ? layoutSideLegend(ctx, parts, ctx.contentWidth - diameter - CHART.legendGap, labels)
    : undefined;
  const height = Math.max(diameter, legend?.height ?? 0);
  const ranges = computeDonutAngles(parts.map((part) => part.value));
  const left = ctx.margins.left;
  const { doc } = ctx;

  return {
    height,
    paint: (top) => {
      const cx = left + radius;
      const cy = top + height / 2;
      parts.forEach((part, index) => {
        doc.setFillColor(part.color);
        fillPolygon(doc, ringSector(cx, cy, radius, radius * innerRatio, ranges[index].start, ranges[index].end));
      });
      if (center) {
        setTextStyle(ctx, CENTER_LEVEL);
        drawText(ctx, center.text, cx, cy + capitalMiddle(center), { align: 'center' });
      }
      if (legend) paintSideLegend(ctx, legend, left + diameter + CHART.legendGap, top + (height - legend.height) / 2);
    },
  };
}

/** Draws a donut chart at the position: see `DonutChartOptions`. */
export function drawDonutChart(ctx: DrawingContext, slices: ChartSlice[], options?: DonutChartOptions): number {
  return drawChart(ctx, layoutDonutChart(ctx, slices, options), options?.spaceAfter);
}

/**
 * Height (mm) of the chart `doc.donutChart()` draws, `spaceAfter` excluded: 0 when it draws nothing.
 *
 * @example
 * ```ts
 * import { computeDonutChartHeight } from '@mlt-a/jspdf-toolkit';
 *
 * const slices = [{ label: 'Licenses', value: 60 }, { label: 'Services', value: 40 }];
 * const height = computeDonutChartHeight(doc, slices, { centerLabel: '$1.2M' });
 * ```
 */
export function computeDonutChartHeight(
  ctx: DrawingContext,
  slices: ChartSlice[],
  options?: DonutChartOptions,
): number {
  ctx.resolveSpaceAfter(options?.spaceAfter);
  return chartHeight(layoutDonutChart(ctx, slices, options));
}

// === Stacked bar ===

/**
 * Options of `stackedBar`: the slices side by side in one bar, with their percentages inside the slices wide enough
 * for them and a legend under the bar. Slices are left out and colored like those of `donutChart`; the
 * chart draws `emptyText`, or nothing, and throws, like it.
 */
export interface StackedBarOptions {
  /**
   * Width (mm) of the bar, above 0. Wider than the available width: brought down to it, with a warning. Default: the available width.
   */
  width?: number;
  /** Height (mm) of the bar, above 0. Default: 9. */
  height?: number;
  /** Legend under the bar: each slice with its percentage or `legendValue`. Default: `true`. */
  legend?: boolean;
  /** Percentage inside the slices wide enough for it. Default: `true`. */
  percentages?: boolean;
  /** Line drawn when no slice has a value. Default: none, the chart draws nothing. */
  emptyText?: string;
  /** Space (mm) under the chart. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

function layoutStackedBar(
  ctx: DrawingContext,
  slices: ChartSlice[],
  options?: StackedBarOptions,
): ChartLayout | undefined {
  const method = 'stackedBar';
  const width = optionalNumber(`${method} width`, options?.width, POSITIVE) ?? ctx.contentWidth;
  const barHeight = optionalNumber(`${method} height`, options?.height, POSITIVE) ?? CHART.stackedBar.height;
  const emptyText = optionalText(`${method} emptyText`, options?.emptyText);
  const showLegend = optionalBoolean(`${method} legend`, options?.legend) ?? true;
  const showPercentages = optionalBoolean(`${method} percentages`, options?.percentages) ?? true;
  const parts = drawableParts(ctx, method, slices);
  if (parts.length === 0) return emptyChart(ctx, emptyText);

  const barWidth = frameWidth(ctx, `${method} width`, width);
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const legend = showLegend
    ? legendBelow(
        ctx,
        parts.map((part) => ({ label: `${part.label} ${part.legendText}`, swatch: squareSwatch(ctx, part.color) })),
        barWidth,
        labelFitter(ctx, method),
      )
    : undefined;
  const percentages = showPercentages;
  const valueStyle = resolveTextStyle(ctx, VALUE_LEVEL, { bold: true });
  const value = measureTextLevel(ctx, VALUE_LEVEL);
  const { background, text, border } = ctx.theme.colors;
  const left = ctx.margins.left;
  const { doc } = ctx;

  return {
    height: barHeight + (legend?.height ?? 0),
    paint: (top) => {
      let x = left;
      parts.forEach((part, index) => {
        // The last slice takes what is left, so rounding never leaves a gap at the end of the bar.
        const sliceWidth = index === parts.length - 1 ? left + barWidth - x : (part.value / total) * barWidth;
        doc.setFillColor(part.color);
        doc.rect(x, top, sliceWidth, barHeight, 'F');
        if (percentages && sliceWidth > CHART.stackedBar.minLabelWidth) {
          // A color of its own, chosen for the contrast over the fill: the theme's color for the level would not.
          applyTextStyle(doc, { ...valueStyle, color: readableOn(part.color, background, text) });
          drawText(ctx, part.share, x + sliceWidth / 2, top + barHeight / 2 + capitalMiddle(value), {
            align: 'center',
          });
        }
        x += sliceWidth;
      });

      doc.setDrawColor(border);
      doc.setLineWidth(LINE_WIDTH.thin);
      doc.rect(left, top, barWidth, barHeight, 'S');

      legend?.paint(left, top + barHeight);
    },
  };
}

/** Draws a stacked bar at the position: see `StackedBarOptions`. */
export function drawStackedBar(ctx: DrawingContext, slices: ChartSlice[], options?: StackedBarOptions): number {
  return drawChart(ctx, layoutStackedBar(ctx, slices, options), options?.spaceAfter);
}

/**
 * Height (mm) of the chart `doc.stackedBar()` draws, `spaceAfter` excluded: 0 when it draws nothing.
 *
 * @example
 * ```ts
 * import { computeStackedBarHeight } from '@mlt-a/jspdf-toolkit';
 *
 * const height = computeStackedBarHeight(doc, [{ label: 'Done', value: 14 }, { label: 'Open', value: 5 }]);
 * ```
 */
export function computeStackedBarHeight(
  ctx: DrawingContext,
  slices: ChartSlice[],
  options?: StackedBarOptions,
): number {
  ctx.resolveSpaceAfter(options?.spaceAfter);
  return chartHeight(layoutStackedBar(ctx, slices, options));
}

// === Column chart ===

/** One column of `columnChart`. */
export interface ChartColumn {
  /** Under the column, on 2 lines at most: a longer one is cut with an ellipsis. */
  label: string;
  /** Formatted value under the label, e.g. `'$90,000'`. */
  valueLabel?: string;
  /**
   * One value per series, stacked from the bottom up: an array, even for a plain column (`[90]`). A value that is not a
   * finite number above 0 draws no layer, where it throws in `ChartLine.values`.
   */
  values: number[];
}

/**
 * Options of `columnChart`: vertical columns on a common scale from 0, each with its label and value under it. A
 * column stacks one value per `series`. Without a column that has a value above 0, the chart draws `emptyText`, or
 * nothing. Invalid options, and with `series` given, a column with more values than named series, throw an
 * `InvalidOptionError` before anything is drawn, even when there is nothing to draw.
 */
export interface ColumnChartOptions {
  /**
   * The layers of the columns, in the order of each column's `values`: names the legend and sets the colors. Given, a
   * column with more values than series throws an `InvalidOptionError`.
   */
  series?: ChartSeries[];
  /**
   * Top of the scale, above 0. The scale reaches `max` as long as no column and not the reference is higher: it then
   * extends to show them. Default: the tallest column, or the reference when it is higher.
   */
  max?: number;
  /**
   * Dashed horizontal line across the plot, e.g. a target, with its label right of the plot, centered on the line. The
   * label has its own room there: the columns share what it leaves, so none runs under it. A label wider than a third
   * of the chart is cut with an ellipsis.
   */
  reference?: {
    /** Where the line stands on the scale, above 0. A value above every column raises the scale to it. */
    value: number;
    /** Text right of the plot, at the height of the line. */
    label: string;
  };
  /** Legend under the chart, when `series` is given. Default: `true`. */
  legend?: boolean;
  /** Height (mm) of the scale, above 0. Default: 42. */
  height?: number;
  /** Line drawn when no column has a value. Default: none, the chart draws nothing. */
  emptyText?: string;
  /** Space (mm) under the chart. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

/** What `checkColumnChart` returns: the options checked, defaults filled in. */
interface ColumnSettings {
  scaleHeight: number;
  scaleMax: number;
  reference: ColumnChartOptions['reference'];
  series: readonly ChartSeries[];
  emptyText: string | undefined;
  legend: boolean;
}

function checkColumnChart(method: string, columns: ChartColumn[], options?: ColumnChartOptions): ColumnSettings {
  const reference = options?.reference;
  if (reference !== undefined) {
    checkedObject(`${method} reference`, reference);
    checkedNumber(`${method} reference value`, reference.value, POSITIVE);
    checkedText(`${method} reference label`, reference.label);
  }
  const series = checkedObjects(`${method} series`, options?.series === undefined ? [] : options.series, (entry) =>
    checkedText(`${method} series label`, entry.label),
  );
  checkedObjects(`${method} data`, columns, (column) => {
    checkedText(`${method} column label`, column.label);
    optionalText(`${method} valueLabel of "${column.label}"`, column.valueLabel);
    checkedArray(`${method} values of column "${column.label}"`, column.values);
    if (series.length > 0 && column.values.length > series.length) {
      throw new InvalidOptionError(
        `${method}: column "${column.label}" has ${column.values.length} values for ${series.length} series`,
      );
    }
  });
  return {
    scaleHeight: optionalNumber(`${method} height`, options?.height, POSITIVE) ?? CHART.column.height,
    scaleMax: options?.max === undefined ? 0 : checkedNumber(`${method} max`, options.max, POSITIVE),
    reference,
    series,
    emptyText: optionalText(`${method} emptyText`, options?.emptyText),
    legend: optionalBoolean(`${method} legend`, options?.legend) ?? true,
  };
}

/** The labels and values under the columns, measured. */
interface ColumnCaptions {
  /** Metrics of the label lines (`LEGEND_LEVEL`) and of the value row (`VALUE_LEVEL`). */
  labelMetrics: TextLevelMetrics;
  valueMetrics: TextLevelMetrics;
  labelLines: string[][];
  valueLabels: (string | undefined)[];
  /** Lines of the tallest label: the values sit under it, so they line up across columns. */
  labelRows: number;
  /** Height (mm), the gap above the captions included. */
  height: number;
}

/** `label` wrapped to `width`, on `CHART.column.labelLines` at most: the last ends in an ellipsis when text is left. */
function columnLabelLines(ctx: DrawingContext, label: string, width: number, labels: LabelFitter): string[] {
  const lines = wrap(ctx, label, width);
  const count = CHART.column.labelLines;
  if (lines.length <= count) return lines;
  const kept = lines.slice(0, count - 1);
  const last = fitWithEllipsis(ctx, lines.slice(count - 1).join(' '), width);
  if (last === '') {
    labels.lost(label);
    return kept;
  }
  return [...kept, last];
}

function layoutColumnCaptions(
  ctx: DrawingContext,
  columns: ChartColumn[],
  width: number,
  labels: LabelFitter,
): ColumnCaptions {
  const labelMetrics = measureTextLevel(ctx, LEGEND_LEVEL);
  const valueMetrics = measureTextLevel(ctx, VALUE_LEVEL);
  return withDrawingState(ctx, () => {
    setTextStyle(ctx, LEGEND_LEVEL);
    const labelLines = columns.map((column) => columnLabelLines(ctx, column.label, width, labels));
    setTextStyle(ctx, VALUE_LEVEL);
    const valueLabels = columns.map((column) => (column.valueLabel ? labels.fit(column.valueLabel, width) : undefined));
    const labelRows = labelLines.reduce((most, lines) => Math.max(most, lines.length), 0);
    // Each row takes the metrics of the level it is drawn in.
    const valuesHeight = valueLabels.some((value) => value !== undefined) ? valueMetrics.lineHeight : 0;
    return {
      labelMetrics,
      valueMetrics,
      labelLines,
      valueLabels,
      labelRows,
      height: CHART.captionGap + labelRows * labelMetrics.lineHeight + valuesHeight,
    };
  });
}

function paintColumnCaptions(ctx: DrawingContext, captions: ColumnCaptions, centers: number[], top: number): void {
  const { labelMetrics, valueMetrics } = captions;
  const labelsTop = top + CHART.captionGap;
  setTextStyle(ctx, LEGEND_LEVEL);
  captions.labelLines.forEach((lines, index) =>
    drawLines(ctx, lines, centers[index], labelsTop + labelMetrics.ascent, labelMetrics.lineHeight, 'center'),
  );
  setTextStyle(ctx, VALUE_LEVEL);
  const valueBaseline = labelsTop + captions.labelRows * labelMetrics.lineHeight + valueMetrics.ascent;
  captions.valueLabels.forEach((value, index) => {
    if (value !== undefined) drawText(ctx, value, centers[index], valueBaseline, { align: 'center' });
  });
}

/** The reference label, fitted to its room, and the width it takes right of the plot, its gap included. */
interface ReferenceLabel {
  text: string;
  room: number;
}

/** The reference label in `AXIS_LEVEL`, cut with an ellipsis past its share of `width`; no room without a label. */
function layoutReferenceLabel(
  ctx: DrawingContext,
  label: string | undefined,
  width: number,
  labels: LabelFitter,
): ReferenceLabel {
  if (label === undefined) return { text: '', room: 0 };
  return withDrawingState(ctx, () => {
    setTextStyle(ctx, AXIS_LEVEL);
    const text = labels.fit(label, width * CHART.column.referenceLabelShare);
    return { text, room: text === '' ? 0 : ctx.doc.getTextWidth(text) + CHART.column.referenceGap };
  });
}

/** The dashed line across the plot at `line.y`, and its label right of the plot, centered on the line. */
function paintReference(
  ctx: DrawingContext,
  label: string,
  line: { left: number; right: number; y: number },
  axis: TextLevelMetrics,
): void {
  const { left, right, y } = line;
  const dashed = { color: ctx.theme.colors.text, width: LINE_WIDTH.thin, dash: CHART.column.referenceDash };
  withStroke(ctx, dashed, () => ctx.doc.line(left, y, right, y));
  if (label === '') return;
  setTextStyle(ctx, AXIS_LEVEL);
  drawText(ctx, label, right + CHART.column.referenceGap, y + capitalMiddle(axis));
}

function layoutColumnChart(
  ctx: DrawingContext,
  columns: ChartColumn[],
  options?: ColumnChartOptions,
): ChartLayout | undefined {
  const method = 'columnChart';
  const {
    scaleHeight,
    scaleMax,
    reference,
    series,
    emptyText,
    legend: showLegend,
  } = checkColumnChart(method, columns, options);
  // Every color is resolved before the empty test: an invalid one throws whether there is something to draw or not.
  const layers = columns.reduce((most, column) => Math.max(most, column.values.length), series.length);
  const colors = seriesColors(
    ctx,
    series.map((entry) => entry.color),
    layers,
  );
  const totals = columns.map((column) =>
    column.values.reduce((sum: number, value) => (isDrawable(value) ? sum + value : sum), 0),
  );
  const tallest = totals.reduce((most, total) => Math.max(most, total), 0);
  if (tallest === 0) return emptyChart(ctx, emptyText);
  const max = Math.max(scaleMax, tallest, reference?.value ?? 0);

  const { contentWidth } = ctx;
  const left = ctx.margins.left;
  const labels = labelFitter(ctx, method);
  // The reference label has its own room right of the plot: no column can run under it.
  const referenceLabel = layoutReferenceLabel(ctx, reference?.label, contentWidth, labels);
  const plotRight = left + contentWidth - referenceLabel.room;
  // Each column sits in the middle of its share of the plot; its label may use the whole share.
  const slot = (plotRight - left) / columns.length;
  const labelWidth = Math.max(slot - CHART.column.gap, CHART.column.minLabelWidth);
  const columnWidth = Math.min(labelWidth, CHART.column.maxWidth);
  const centers = columns.map((_, index) => left + (index + 0.5) * slot);

  const captions = layoutColumnCaptions(ctx, columns, labelWidth, labels);
  const legend = showLegend
    ? legendBelow(
        ctx,
        series.map((entry, index) => ({ label: entry.label, swatch: squareSwatch(ctx, colors[index]) })),
        contentWidth,
        labels,
      )
    : undefined;
  const axis = measureTextLevel(ctx, AXIS_LEVEL);
  const referenceY = (value: number) => (1 - value / max) * scaleHeight;
  // Centred on its line, the reference label rises above the line by the half of its ascent: near the top of the
  // scale, the chart grows by what rises above it.
  const referenceHeight =
    reference && referenceLabel.text !== ''
      ? Math.max(0, axis.ascent - capitalMiddle(axis) - referenceY(reference.value))
      : 0;
  const { doc, theme } = ctx;

  return {
    height: referenceHeight + scaleHeight + captions.height + (legend?.height ?? 0),
    paint: (top) => {
      const scaleTop = top + referenceHeight;
      const baseY = scaleTop + scaleHeight;
      const right = plotRight;

      columns.forEach((column, index) => {
        let y = baseY;
        column.values.forEach((value, layer) => {
          if (!isDrawable(value)) return;
          const layerHeight = (value / max) * scaleHeight;
          doc.setFillColor(colors[layer]);
          doc.rect(centers[index] - columnWidth / 2, y - layerHeight, columnWidth, layerHeight, 'F');
          y -= layerHeight;
        });
      });

      doc.setDrawColor(theme.colors.border);
      doc.setLineWidth(LINE_WIDTH.thin);
      doc.line(left, baseY, right, baseY);

      if (reference) {
        paintReference(ctx, referenceLabel.text, { left, right, y: scaleTop + referenceY(reference.value) }, axis);
      }

      paintColumnCaptions(ctx, captions, centers, baseY);
      legend?.paint(left, baseY + captions.height);
    },
  };
}

/** Draws a column chart at the position: see `ColumnChartOptions`. */
export function drawColumnChart(ctx: DrawingContext, columns: ChartColumn[], options?: ColumnChartOptions): number {
  return drawChart(ctx, layoutColumnChart(ctx, columns, options), options?.spaceAfter);
}

/**
 * Height (mm) of the chart `doc.columnChart()` draws, `spaceAfter` excluded: 0 when it draws nothing.
 *
 * @example
 * ```ts
 * import { computeColumnChartHeight } from '@mlt-a/jspdf-toolkit';
 *
 * const height = computeColumnChartHeight(doc, [{ label: 'Q1', values: [80, 40] }], { height: 50 });
 * ```
 */
export function computeColumnChartHeight(ctx: DrawingContext, columns: ChartColumn[], options?: ColumnChartOptions) {
  ctx.resolveSpaceAfter(options?.spaceAfter);
  return chartHeight(layoutColumnChart(ctx, columns, options));
}

// === Line chart ===

/** One line of `lineChart`. */
export interface ChartLine extends ChartSeries {
  /**
   * One value per point of `xs`, each a finite number of 0 or more, else an `InvalidOptionError`, where
   * `ChartColumn.values` leaves such a value out.
   */
  values: number[];
  /** Stroke width (mm), above 0. Default: 0.5. */
  lineWidth?: number;
  /** Dash and gap lengths (mm) of a dashed line, 0 or more, not both 0. Default: a solid line. */
  dash?: [number, number];
  /** Draws the line last, over the others. The highlighted area follows the first line with emphasis. */
  emphasis?: boolean;
}

/**
 * A band between a low and a high value at each point, e.g. the range of a forecast. Drawn translucent.
 */
export interface ChartBand extends ChartSeries {
  /** Color in the chart and in the legend, drawn translucent. Default: `'secondary'`, whatever the number of lines. */
  color?: ColorInput;
  /** One value per point of `xs`, like `ChartLine.values`, each at most the `upper` value of the same point. */
  lower: number[];
  /** One value per point of `xs`, like `ChartLine.values`. */
  upper: number[];
}

/** The data of `lineChart`: the points along the X axis and what is plotted over them. */
export interface LineChartData {
  /**
   * X value of each point, e.g. years: finite numbers, each equal to or greater than the one before it. A value lower
   * than the one before it throws an `InvalidOptionError`.
   */
  xs: number[];
  /** The lines, each with one value per point of `xs`. */
  lines: ChartLine[];
  /** A shaded range, drawn under the lines. */
  band?: ChartBand;
}

/**
 * Options of `lineChart`: lines over a common X axis, on a scale from 0 to a round maximum, with a grid, axis labels
 * and a legend. With fewer than two points or no value above 0, the chart draws `emptyText`, or nothing. Invalid data
 * or options throw an `InvalidOptionError` before anything is drawn, even when there is nothing to draw. A plot
 * narrower than 10 mm (a small `width`, wide Y labels) is not drawn: the chart takes no room and
 * adds a warning.
 */
export interface LineChartOptions {
  /** Colors the area under the emphasized line (or the first one) between two X values, e.g. a target period. */
  highlight?: {
    /** X value where the area starts. */
    from: number;
    /** X value where the area ends: `from` or more. */
    to: number;
    /**
     * Default: `'primary'`, whatever the number of lines, so it differs from the default of the band. The area is
     * drawn translucent.
     */
    color?: ColorInput;
    /** Shown in the legend; without one the area has no legend entry. */
    label?: string;
  };
  /** Title of the X axis, centered under its labels. */
  xTitle?: string;
  /** Title of the Y axis, above the plot. */
  yTitle?: string;
  /**
   * Formats a Y value, e.g. `(value) => `$${value / 1000}k``. Default: the number, rounded to the decimals that
   * print the grid values exactly. May run more than once per chart (`keepTogether` measures first): no side effects.
   */
  formatValue?: (value: number) => string;
  /** Formats an X value. Default: the number. Runs like `formatValue`. */
  formatX?: (x: number) => string;
  /** Height (mm) of the plot, above 0. Default: 62. */
  height?: number;
  /**
   * Width (mm) of the chart, Y labels included, above 0. Wider than the available width: brought down to it, with a
   * warning. Default: the available width.
   */
  width?: number;
  /** Horizontal grid lines above the axis, a whole number of 1 or more. Default: 4. */
  yTicks?: number;
  /** Most labels under the X axis, a whole number of 2 or more. Default: 6. */
  xTicks?: number;
  /** Line drawn when there are fewer than two points or no value above 0. Default: none, the chart draws nothing. */
  emptyText?: string;
  /** Space (mm) under the chart. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

/** Most decimals `Number.prototype.toFixed` takes. */
const MAX_DECIMALS = 100;

/** Bounds of a plotted value: the scale starts at 0. */
const PLOTTED: NumberBounds = { min: 0 };

/** The next round number at or above `value` (1, 2, 2.5, 5 or 10 times a power of ten): a readable top of scale. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  // The last step is 10, above any normalized value.
  const step = CHART.line.niceSteps.find((candidate) => normalized <= candidate)!;
  return step * magnitude;
}

/** Decimals that print a grid value exactly when the grid lines are `step` apart: its first significant digits. */
function tickDecimals(step: number): number {
  return Math.min(MAX_DECIMALS, Math.max(0, CHART.line.labelDigits - 1 - Math.floor(Math.log10(step))));
}

/** Throws on a series that cannot be plotted, before anything is drawn: a wrong length, or a value out of `bounds`. */
function checkSeries(what: string, values: readonly number[], points: number, bounds: NumberBounds): void {
  checkedArray(what, values);
  if (values.length !== points) {
    throw new InvalidOptionError(`Invalid ${what}: ${values.length} values for ${points} points of xs`);
  }
  for (let index = 0; index < points; index++) checkedNumber(() => `${what} at index ${index}`, values[index], bounds);
}

function checkLineData(method: string, data: LineChartData): void {
  const { xs, lines, band } = checkedObject(`${method} data`, data);
  const points = checkedArray(`${method} xs`, xs).length;
  for (let index = 0; index < points; index++) {
    checkedNumber(() => `${method} xs at index ${index}`, xs[index]);
    if (index > 0 && xs[index] < xs[index - 1]) {
      throw new InvalidOptionError(
        `Invalid ${method} xs: ${xs[index]} at index ${index} after ${xs[index - 1]} — must be in increasing order`,
      );
    }
  }
  checkedObjects(`${method} lines`, lines, (line) => {
    const name = `${method} line "${checkedText(`${method} line label`, line.label)}"`;
    checkSeries(`${name} values`, line.values, points, PLOTTED);
    if (line.lineWidth !== undefined) checkedNumber(`${name} lineWidth`, line.lineWidth, POSITIVE);
    optionalBoolean(`${name} emphasis`, line.emphasis);
    if (line.dash !== undefined) checkDash(`${name} dash`, line.dash);
  });
  if (band !== undefined) {
    checkedObject(`${method} band`, band);
    checkedText(`${method} band label`, band.label);
    checkSeries(`${method} band.lower`, band.lower, points, PLOTTED);
    checkSeries(`${method} band.upper`, band.upper, points, PLOTTED);
    for (let index = 0; index < points; index++) {
      checkedNumber(() => `${method} band.lower at index ${index}`, band.lower[index], {
        ...PLOTTED,
        max: band.upper[index],
      });
    }
  }
}

function checkDash(what: string, dash: readonly number[]): void {
  checkedArray(what, dash);
  for (const length of dash) checkedNumber(`${what} length`, length, { min: 0 });
  if (dash.length !== 2 || dash[0] + dash[1] === 0) {
    throw new InvalidOptionError(`Invalid ${what}: [${dash.join(', ')}] — must be two lengths, not both 0`);
  }
}

/** What `checkLineOptions` returns: the options checked, defaults filled in. */
interface LineSettings {
  plotHeight: number;
  width: number;
  yTicks: number;
  xTicks: number;
  xTitle: string | undefined;
  yTitle: string | undefined;
  emptyText: string | undefined;
}

function checkLineOptions(ctx: DrawingContext, method: string, options?: LineChartOptions): LineSettings {
  const highlight = options?.highlight;
  if (highlight !== undefined) {
    checkedObject(`${method} highlight`, highlight);
    const from = checkedNumber(`${method} highlight.from`, highlight.from);
    checkedNumber(`${method} highlight.to`, highlight.to, { min: from });
    optionalText(`${method} highlight.label`, highlight.label);
  }
  optionalFunction(`${method} formatValue`, options?.formatValue);
  optionalFunction(`${method} formatX`, options?.formatX);
  return {
    plotHeight: optionalNumber(`${method} height`, options?.height, POSITIVE) ?? CHART.line.height,
    width: optionalNumber(`${method} width`, options?.width, POSITIVE) ?? ctx.contentWidth,
    yTicks: optionalNumber(`${method} yTicks`, options?.yTicks, { integer: true, min: 1 }) ?? CHART.line.yTicks,
    xTicks: optionalNumber(`${method} xTicks`, options?.xTicks, { integer: true, min: 2 }) ?? CHART.line.xTicks,
    xTitle: optionalText(`${method} xTitle`, options?.xTitle),
    yTitle: optionalText(`${method} yTitle`, options?.yTitle),
    emptyText: optionalText(`${method} emptyText`, options?.emptyText),
  };
}

/** The highest value of the data, 0 when there is none. */
function dataMax({ lines, band }: LineChartData): number {
  let max = 0;
  for (const series of [...lines.map((line) => line.values), band?.upper ?? []]) {
    for (const value of series) if (value > max) max = value;
  }
  return max;
}

const lineStroke = (line: ChartLine, color: string): Stroke => ({
  color,
  width: line.lineWidth ?? CHART.line.lineWidth,
  dash: line.dash,
});

function lineSwatch(ctx: DrawingContext, stroke: Stroke): Swatch {
  return (x, middle) => withStroke(ctx, stroke, () => ctx.doc.line(x, middle, x + CHART.lineSwatch, middle));
}

function areaSwatch(ctx: DrawingContext, color: string): Swatch {
  return (x, middle) =>
    withOpacity(ctx.doc, CHART.line.areaSwatchOpacity, () => {
      ctx.doc.setFillColor(color);
      ctx.doc.rect(x, middle - CHART.swatch / 2, CHART.lineSwatch, CHART.swatch, 'F');
    });
}

/** The area of a line chart that is filled translucent: the band or the highlight, with its color resolved. */
interface Area {
  label: string | undefined;
  color: string;
}

/** The legend entries of a line chart: the band, the highlight when it has a label, then the lines. */
function lineLegendEntries(
  ctx: DrawingContext,
  areas: readonly (Area | undefined)[],
  lines: readonly ChartLine[],
  strokes: readonly Stroke[],
): LegendEntry[] {
  const entries: LegendEntry[] = [];
  for (const area of areas) {
    if (area?.label) entries.push({ label: area.label, swatch: areaSwatch(ctx, area.color) });
  }
  lines.forEach((line, index) => entries.push({ label: line.label, swatch: lineSwatch(ctx, strokes[index]) }));
  return entries;
}

/** The axis texts of a line chart, measured, and the horizontal frame of its plot. */
interface LineAxes {
  /** Grid values from 0 to the top of the scale, with their labels. */
  yLabels: { value: number; text: string }[];
  /** The X labels kept, with their left edge. */
  xLabels: { text: string; x: number }[];
  plotLeft: number;
  plotWidth: number;
  /** Position (mm) of an X value. */
  plotX: (x: number) => number;
}

/**
 * The axis texts, measured once in the style they are drawn in: the plot is as wide as the Y labels leave. The last
 * point is always labelled, on the right edge; a label that would run into it is skipped.
 */
function layoutLineAxes(
  ctx: DrawingContext,
  xs: readonly number[],
  frame: { left: number; right: number; yMax: number; yTicks: number; xTicks: number },
  format: { value: (value: number) => string; x: (x: number) => string },
): LineAxes {
  const { left, right, yMax, yTicks, xTicks } = frame;
  const { doc } = ctx;
  const formatValue = (value: number) => checkedText('value returned by lineChart formatValue', format.value(value));
  const formatX = (x: number) => checkedText('value returned by lineChart formatX', format.x(x));
  return withDrawingState(ctx, () => {
    setTextStyle(ctx, AXIS_LEVEL);
    const yLabels = Array.from({ length: yTicks + 1 }, (_, tick) => {
      const value = (yMax / yTicks) * tick;
      return { value, text: formatValue(value) };
    });
    const yTexts = yLabels.map((label) => label.text);
    const plotLeft = left + widestText(ctx, yTexts) + CHART.line.axisGap;
    const plotWidth = right - plotLeft;
    const points = xs.length;
    const spanX = xs[points - 1] - xs[0] || 1;
    const plotX = (x: number): number => plotLeft + ((x - xs[0]) / spanX) * plotWidth;

    const lastText = formatX(xs[points - 1]);
    const lastLeft = right - doc.getTextWidth(lastText);
    const step = Math.max(1, Math.ceil((points - 1) / (xTicks - 1)));
    const xLabels: LineAxes['xLabels'] = [];
    // Points are not evenly spaced when `xs` is not: a label also gives way to the one before it.
    let free = plotLeft;
    for (let index = 0; index < points - 1; index += step) {
      const text = formatX(xs[index]);
      const textWidth = doc.getTextWidth(text);
      const x = Math.max(plotLeft, plotX(xs[index]) - textWidth / 2);
      if (x >= free && x + textWidth + CHART.line.axisGap <= lastLeft) {
        xLabels.push({ text, x });
        free = x + textWidth + CHART.line.axisGap;
      }
    }
    xLabels.push({ text: lastText, x: lastLeft });
    return { yLabels, xLabels, plotLeft, plotWidth, plotX };
  });
}

/** The plot of a line chart, placed on the page. */
interface Plot {
  left: number;
  right: number;
  bottom: number;
  /** Position (mm) of an X value. */
  x: (x: number) => number;
  /** Position (mm) of a Y value. */
  y: (value: number) => number;
}

const curve = (plot: Plot, xs: readonly number[], values: readonly number[]): Point[] =>
  values.map((value, index) => [plot.x(xs[index]), plot.y(value)]);

/** The grid lines above the axis, faint, and the Y labels. */
function paintGrid(ctx: DrawingContext, plot: Plot, axes: LineAxes, axis: TextLevelMetrics): void {
  const { doc } = ctx;
  doc.setDrawColor(ctx.theme.colors.border);
  doc.setLineWidth(LINE_WIDTH.thin);
  withOpacity(doc, CHART.line.gridOpacity, () => {
    // The first value is the axis itself, drawn over the lines.
    for (let tick = 1; tick < axes.yLabels.length; tick++) {
      const y = plot.y(axes.yLabels[tick].value);
      doc.line(plot.left, y, plot.right, y);
    }
  });
  setTextStyle(ctx, AXIS_LEVEL);
  for (const label of axes.yLabels) {
    drawText(ctx, label.text, plot.left - CHART.line.axisGap, plot.y(label.value) + capitalMiddle(axis), {
      align: 'right',
    });
  }
}

/** Outline of a band: along its top, then back along its bottom. */
function bandOutline(plot: Plot, xs: readonly number[], band: ChartBand): Point[] {
  const outline = curve(plot, xs, band.upper);
  for (let index = xs.length - 1; index >= 0; index--) outline.push([plot.x(xs[index]), plot.y(band.lower[index])]);
  return outline;
}

/** Fills `outline` translucent in `color`: the band, the highlighted area. */
function paintArea(ctx: DrawingContext, color: string, outline: readonly Point[]): void {
  withOpacity(ctx.doc, CHART.line.areaOpacity, () => {
    ctx.doc.setFillColor(color);
    fillPolygon(ctx.doc, outline);
  });
}

/** The axis, over the lines, then the X labels and the X title under it. */
function paintXAxis(
  ctx: DrawingContext,
  plot: Plot,
  axes: LineAxes,
  axis: TextLevelMetrics,
  title: string | undefined,
): void {
  const { doc } = ctx;
  doc.setDrawColor(ctx.theme.colors.border);
  doc.setLineWidth(LINE_WIDTH.thin);
  doc.line(plot.left, plot.bottom, plot.right, plot.bottom);
  setTextStyle(ctx, AXIS_LEVEL);
  const baseline = plot.bottom + CHART.captionGap + axis.ascent;
  for (const label of axes.xLabels) drawText(ctx, label.text, label.x, baseline);
  if (title) {
    const titleBaseline = baseline + CHART.legendRowGap + axis.lineHeight;
    drawText(ctx, title, axes.plotLeft + axes.plotWidth / 2, titleBaseline, { align: 'center' });
  }
}

/** Index of the first of `xs` (in increasing order) that is `x` or more; `xs.length` when none is. */
function firstAtLeast(xs: readonly number[], x: number): number {
  let low = 0;
  let high = xs.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (xs[middle] < x) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Value at `x`, within the range of `xs`, of the line through the points (`xs`, `values`). */
function valueAt(xs: readonly number[], values: readonly number[], x: number): number {
  const next = firstAtLeast(xs, x);
  if (next === 0) return values[0];
  // `x` lies past `xs[next - 1]` and not past `xs[next]`: the span is never zero.
  const span = xs[next] - xs[next - 1];
  return values[next - 1] + ((x - xs[next - 1]) / span) * (values[next] - values[next - 1]);
}

/**
 * Outline of the area under the line through (`xs`, `values`) between `from` and `to`, two X values within the range of
 * `xs`: interpolated at both ends so the edges stand exactly at those values, the points of the line in between.
 */
function highlightOutline(
  plot: Plot,
  xs: readonly number[],
  values: readonly number[],
  from: number,
  to: number,
): Point[] {
  const outline: Point[] = [
    [plot.x(from), plot.bottom],
    [plot.x(from), plot.y(valueAt(xs, values, from))],
  ];
  let index = firstAtLeast(xs, from);
  while (index < xs.length && xs[index] <= from) index++;
  for (; index < xs.length && xs[index] < to; index++) outline.push([plot.x(xs[index]), plot.y(values[index])]);
  outline.push([plot.x(to), plot.y(valueAt(xs, values, to))], [plot.x(to), plot.bottom]);
  return outline;
}

/** Layout shared by `drawLineChart` and `computeLineChartHeight`; `undefined` when there is nothing to draw. */
function layoutLineChart(
  ctx: DrawingContext,
  data: LineChartData,
  options?: LineChartOptions,
): ChartLayout | undefined {
  const method = 'lineChart';
  checkLineData(method, data);
  const settings = checkLineOptions(ctx, method, options);
  const { xs, lines, band } = data;
  const highlight = options?.highlight;

  // Every color is resolved before drawing, so an invalid one leaves no half-drawn chart. The lines share the shades
  // among themselves only, so a band or a highlight added later does not recolor them; the band and the highlight have
  // a default of their own, which differs from each other and does not depend on the number of lines.
  const lineColors = seriesColors(
    ctx,
    lines.map((line) => line.color),
    lines.length,
  );
  const bandColor = resolveOptionalColor(ctx.theme, band?.color, 'secondary');
  const highlightColor = resolveOptionalColor(ctx.theme, highlight?.color, 'primary');

  const points = xs.length;
  const highest = dataMax(data);
  if (points < 2 || highest === 0) return emptyChart(ctx, settings.emptyText);

  const { plotHeight, yTicks, xTitle, yTitle } = settings;
  const width = frameWidth(ctx, `${method} width`, settings.width);
  const drawnBand = band?.upper.some((upper, index) => upper > band.lower[index]) ? band : undefined;
  const strokes = lines.map((line, index) => lineStroke(line, lineColors[index]));
  const yMax = niceCeil(highest);
  // Rounded to what the scale needs: two fixed decimals would print the grid values 0.025 and 0.075 as 0.03 and 0.08.
  const decimals = tickDecimals(yMax / yTicks);
  const left = ctx.margins.left;
  const right = left + width;
  const axes = layoutLineAxes(
    ctx,
    xs,
    { left, right, yMax, yTicks, xTicks: settings.xTicks },
    {
      value: options?.formatValue ?? ((value: number) => String(Number(value.toFixed(decimals)))),
      x: options?.formatX ?? String,
    },
  );
  // The room the Y labels leave depends on the labels, not on a setting: a plot too narrow is skipped, with a warning.
  if (axes.plotWidth < CHART.line.minPlotWidth) {
    ctx.addWarning(
      `Failed to draw ${method}: its width leaves a plot ${Math.max(axes.plotWidth, 0).toFixed(1)} mm wide, ` +
        `under the ${CHART.line.minPlotWidth} mm it needs`,
    );
    return undefined;
  }
  const legend = legendBelow(
    ctx,
    lineLegendEntries(
      ctx,
      [
        drawnBand && { label: drawnBand.label, color: bandColor },
        highlight && { label: highlight.label, color: highlightColor },
      ],
      lines,
      strokes,
    ),
    width,
    labelFitter(ctx, method),
    CHART.lineSwatch,
  );
  const axis = measureTextLevel(ctx, AXIS_LEVEL);
  const yTitleHeight = yTitle ? axis.lineHeight + CHART.legendRowGap : 0;
  const xLabelHeight = CHART.captionGap + axis.lineHeight;
  const xTitleHeight = xTitle ? CHART.legendRowGap + axis.lineHeight : 0;
  // The highlighted area follows the first line with emphasis, else the first line.
  const highlighted = (lines.find((line) => line.emphasis) ?? lines[0])?.values;
  const { doc } = ctx;

  return {
    height: yTitleHeight + plotHeight + xLabelHeight + xTitleHeight + (legend?.height ?? 0),
    paint: (chartTop) => {
      const bottom = chartTop + yTitleHeight + plotHeight;
      const plot: Plot = {
        left: axes.plotLeft,
        right,
        bottom,
        x: axes.plotX,
        y: (value) => bottom - (value / yMax) * plotHeight,
      };

      if (yTitle) {
        setTextStyle(ctx, AXIS_LEVEL);
        drawText(ctx, yTitle, left, chartTop + axis.ascent);
      }
      paintGrid(ctx, plot, axes, axis);

      if (highlight && highlighted) {
        // Kept within the range of xs, `to` never before `from`.
        const from = Math.min(Math.max(highlight.from, xs[0]), xs[points - 1]);
        const to = Math.min(Math.max(highlight.to, from), xs[points - 1]);
        paintArea(ctx, highlightColor, highlightOutline(plot, xs, highlighted, from, to));
      }
      if (drawnBand) paintArea(ctx, bandColor, bandOutline(plot, xs, drawnBand));
      // The lines with emphasis last, over the others.
      for (const emphasis of [false, true]) {
        lines.forEach((line, index) => {
          if (Boolean(line.emphasis) !== emphasis) return;
          withStroke(ctx, strokes[index], () => strokePolyline(doc, curve(plot, xs, line.values)));
        });
      }
      paintXAxis(ctx, plot, axes, axis, xTitle);
      legend?.paint(left, bottom + xLabelHeight + xTitleHeight);
    },
  };
}

/** Draws a line chart at the position: see `LineChartOptions`. */
export function drawLineChart(ctx: DrawingContext, data: LineChartData, options?: LineChartOptions): number {
  return drawChart(ctx, layoutLineChart(ctx, data, options), options?.spaceAfter);
}

/**
 * Height (mm) of the chart `doc.lineChart()` draws, `spaceAfter` excluded: 0 when it draws nothing.
 *
 * @example
 * ```ts
 * import { computeLineChartHeight } from '@mlt-a/jspdf-toolkit';
 *
 * const height = computeLineChartHeight(doc, { xs: [1, 2, 3], lines: [{ label: 'Sales', values: [3, 5, 4] }] });
 * ```
 */
export function computeLineChartHeight(ctx: DrawingContext, data: LineChartData, options?: LineChartOptions): number {
  ctx.resolveSpaceAfter(options?.spaceAfter);
  return chartHeight(layoutLineChart(ctx, data, options));
}
