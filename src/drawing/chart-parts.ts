import { GState } from 'jspdf';
import type { jsPDF } from 'jspdf';

import { CHART, capitalMiddle } from '../core/constants';
import type { TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { mixInk, resolveColor } from '../theme/colors';
import type { ColorInput } from '../theme/types';
import { withDrawingState } from './drawing-state';
import { measureTextLevel, setTextStyle } from './text';
import type { TextLevelMetrics } from './text';
import { drawLines, fitWithEllipsis, text as drawText, wrap } from './text-lines';

// What the four charts share. A chart lays itself out once (`ChartLayout`), then reserves and draws from that single
// layout, so the height it asks for is the height it takes. Charts are drawn with jsPDF paths only: no canvas.

export type Point = readonly [number, number];

/** Text level of legend entries, of the labels under a chart and of `emptyText`. */
export const LEGEND_LEVEL: TextLevel = 'smallMuted';
/** Text level of axis labels, axis titles and the reference label. */
export const AXIS_LEVEL: TextLevel = 'caption';
/** Text level of values: the percentages inside a stacked bar, the value labels under columns. */
export const VALUE_LEVEL: TextLevel = 'small';

/** A chart measured: the height it takes, and how to paint itself from the top it is given. */
export interface ChartLayout {
  /** Height (mm) of the chart, `spaceAfter` excluded. */
  height: number;
  /**
   * Draws the chart with its top at `top`, in the frame it was measured in. The caller has reserved the room and
   * wrapped the call in `withDrawingState`.
   */
  paint: (top: number) => void;
}

/**
 * Reserves the room of `layout`, paints it and closes the block. Without a layout (nothing to draw) the position, the
 * space left by the block above and the waiting headings stay as they were.
 */
export function drawChart(ctx: DrawingContext, layout: ChartLayout | undefined, spaceAfter?: number): number {
  // Checked first: an invalid `spaceAfter` throws on a chart with nothing to draw too.
  const after = ctx.resolveSpaceAfter(spaceAfter);
  if (layout === undefined) return ctx.peekYPos();
  ctx.ensureSpace(layout.height + after);
  const top = ctx.getYPos();
  withDrawingState(ctx, () => layout.paint(top));
  return ctx.endBlock(top + layout.height, after);
}

/** Height (mm) of `layout`, 0 when there is nothing to draw. */
export const chartHeight = (layout: ChartLayout | undefined): number => layout?.height ?? 0;

// === Values and widths ===

/** Whether a chart draws `value`: a finite number above 0. Anything else is left out instead of reaching jsPDF. */
export function isDrawable(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export const percent = (value: number, total: number): string => `${Math.round((value / total) * 100)}%`;

/** Width (mm) of the widest of `texts` in the current font. */
export function widestText(ctx: DrawingContext, texts: readonly string[]): number {
  return texts.reduce((widest, value) => Math.max(widest, ctx.doc.getTextWidth(value)), 0);
}

// === Labels ===

/** Cuts the labels of one chart to their room. */
export interface LabelFitter {
  /**
   * `label` cut to `width` with an ellipsis, in the current font: `''`, and `lost`, when even the ellipsis is wider.
   */
  fit(label: string, width: number): string;
  /** Records `label` as left out for want of room. */
  lost(label: string): void;
}

/**
 * The `LabelFitter` of one chart. A label cut short says nothing: the ellipsis shows it. A label left out entirely
 * would vanish without a trace, so the first one of the chart raises a warning, and the others add nothing.
 */
export function labelFitter(ctx: DrawingContext, method: string): LabelFitter {
  let warned = false;
  const lost = (label: string): void => {
    if (warned || label.trim() === '') return;
    warned = true;
    ctx.addWarning(`${method}: labels with no room are left out, "${label}" among them`);
  };
  return {
    fit: (label, width) => {
      const fitted = fitWithEllipsis(ctx, label, width);
      if (fitted === '') lost(label);
      return fitted;
    },
    lost,
  };
}

// === Colors ===

/**
 * Colors of `count` series: the one each asks for, else a shade of the primary color, from the primary itself to a
 * light mix with the page background. An invalid color throws before anything is drawn.
 */
export function seriesColors(ctx: DrawingContext, requested: readonly (ColorInput | undefined)[], count: number) {
  const { primary, background } = ctx.theme.colors;
  return Array.from({ length: count }, (_, index) => {
    const color = requested[index];
    if (color !== undefined) return resolveColor(ctx.theme, color);
    return mixInk(primary, background, count > 1 ? (index / (count - 1)) * CHART.lightestShade : 0);
  });
}

// === Empty chart ===

/**
 * The layout of a chart with nothing to show: the muted line `emptyText` says, wrapped to the width. Without an
 * `emptyText` there is nothing to draw: `undefined`.
 */
export function emptyChart(ctx: DrawingContext, emptyText: string | undefined): ChartLayout | undefined {
  if (emptyText === undefined || emptyText.trim() === '') return undefined;
  const { lineHeight, ascent } = measureTextLevel(ctx, LEGEND_LEVEL);
  const lines = withDrawingState(ctx, () => {
    setTextStyle(ctx, LEGEND_LEVEL);
    return wrap(ctx, emptyText, ctx.contentWidth);
  });
  const left = ctx.margins.left;
  return {
    height: lines.length * lineHeight,
    paint: (top) => {
      setTextStyle(ctx, LEGEND_LEVEL);
      drawLines(ctx, lines, left, top + ascent, lineHeight);
    },
  };
}

// === Paths and opacity ===

/** Runs `fn` with fills and strokes at `opacity` (0 to 1), then puts the graphics state back. */
export function withOpacity(doc: jsPDF, opacity: number, fn: () => void): void {
  doc.saveGraphicsState();
  try {
    doc.setGState(new GState({ opacity, 'stroke-opacity': opacity }));
    fn();
  } finally {
    doc.restoreGraphicsState();
  }
}

function tracePath(doc: jsPDF, points: readonly Point[]): void {
  doc.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) doc.lineTo(points[index][0], points[index][1]);
}

/** Fills the closed polygon through `points` (mm) with the current fill color: one path, so no seam shows inside. */
export function fillPolygon(doc: jsPDF, points: readonly Point[]): void {
  tracePath(doc, points);
  doc.close();
  doc.fill();
}

/** Strokes the open line through `points` (mm) with the current draw color and line width, as one path. */
export function strokePolyline(doc: jsPDF, points: readonly Point[]): void {
  tracePath(doc, points);
  doc.stroke();
}

// === Legends ===

/** Height (mm) of `rows` legend lines `lineHeight` apart, with the gap between two. */
export const legendRowsHeight = (rows: number, lineHeight: number): number =>
  rows * lineHeight + Math.max(0, rows - 1) * CHART.legendRowGap;

/** Baseline of legend line `row` (from 0) of a legend whose top is `top`. */
export const legendBaseline = (top: number, row: number, metrics: TextLevelMetrics): number =>
  top + row * (metrics.lineHeight + CHART.legendRowGap) + metrics.ascent;

/** Paints the sample of a legend entry: `x` is its left edge, `middle` the middle of the capitals of its label. */
export type Swatch = (x: number, middle: number) => void;

export function squareSwatch(ctx: DrawingContext, color: string): Swatch {
  return (x, middle) => {
    ctx.doc.setFillColor(color);
    ctx.doc.rect(x, middle - CHART.swatch / 2, CHART.swatch, CHART.swatch, 'F');
  };
}

export interface LegendEntry {
  label: string;
  swatch: Swatch;
}

/** The legend under a chart, measured. */
export interface LegendBelow {
  /** Height (mm), the gap above the legend included. */
  height: number;
  /** Draws the legend under a chart whose left edge is `left` and bottom `top`. */
  paint: (left: number, top: number) => void;
}

/**
 * Entries side by side under a chart `width` wide, each with a sample `swatchWidth` wide, wrapped to the width. An
 * entry wider than the width takes a line of its own and its label is cut to fit. `undefined` without entries.
 */
export function legendBelow(
  ctx: DrawingContext,
  entries: readonly LegendEntry[],
  width: number,
  labels: LabelFitter,
  swatchWidth: number = CHART.swatch,
): LegendBelow | undefined {
  if (entries.length === 0) return undefined;
  const metrics = measureTextLevel(ctx, LEGEND_LEVEL);
  const labelRoom = Math.max(width - swatchWidth - CHART.swatchGap, 0);
  const items = withDrawingState(ctx, () => {
    setTextStyle(ctx, LEGEND_LEVEL);
    let cursor = 0;
    let row = 0;
    return entries.map((entry) => {
      const label = labels.fit(entry.label, labelRoom);
      const entryWidth = swatchWidth + CHART.swatchGap + ctx.doc.getTextWidth(label);
      if (cursor > 0 && cursor + entryWidth > width) {
        row++;
        cursor = 0;
      }
      const item = { label, swatch: entry.swatch, x: cursor, row };
      cursor += entryWidth + CHART.legendGap;
      return item;
    });
  });
  const rows = items[items.length - 1].row + 1;
  return {
    height: CHART.captionGap + legendRowsHeight(rows, metrics.lineHeight),
    paint: (left, top) => {
      const legendTop = top + CHART.captionGap;
      setTextStyle(ctx, LEGEND_LEVEL);
      for (const { label, swatch, x, row } of items) {
        const baseline = legendBaseline(legendTop, row, metrics);
        swatch(left + x, baseline - capitalMiddle(metrics));
        drawText(ctx, label, left + x + swatchWidth + CHART.swatchGap, baseline);
      }
    },
  };
}
