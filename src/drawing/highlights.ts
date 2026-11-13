import { HIGHLIGHT, descentMm } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  POSITIVE,
  checkedNumber,
  checkedObject,
  checkedPoint,
  checkedText,
  checkedTexts,
  optionalBoolean,
  optionalNumber,
} from '../core/errors';
import { withDrawingState } from './drawing-state';
import { measureTextLevel, resolveTextStyle, setTextStyle } from './text';
import { text as drawText, remainingTextWidth, wrap } from './text-lines';
import { applyTextStyle } from './text-style';

/** Options of `drawHighlightedText`: position of the pill and its wrapping. */
export interface HighlightedTextOptions {
  /** Left edge (mm) of the pill. */
  x: number;
  /** Top of the pill: the top of its first text line is `padding` lower. */
  y: number;
  /** Padding (mm) between the pill edge and its text, on every side. Default: 1. */
  padding?: number;
  /** Width (mm) the pill wraps within, padding included. Default: the document `measure`. */
  maxWidth?: number;
  /** Primary fill with `onPrimary` text, instead of the light tint with `text`. Default: `false`. */
  strong?: boolean;
  /** Already measured with the same `text`, `padding` and `maxWidth`: skips measuring again. */
  metrics?: HighlightMetrics;
}

/** Size of a highlighted text pill, as `measureHighlightedText` returns it. */
export interface HighlightMetrics {
  /** The text wrapped to the pill, one entry per line. */
  lines: string[];
  /** Width of the pill, padding included. */
  width: number;
  /** Height of the pill, padding included: from the top of the capitals to the descenders, padded. */
  height: number;
  /** Distance (mm) between two baselines of the pill text. */
  lineHeight: number;
  /** Padding (mm) between the pill edge and its text. */
  padding: number;
  /** Glyph extent (mm) above the baseline. */
  ascent: number;
  /** Glyph extent (mm) below the baseline. */
  descent: number;
}

/**
 * Measuring half of `drawHighlightedText`. Leaves the font and colors as it found them.
 *
 * @example
 * ```ts
 * import { measureHighlightedText } from '@mlt-a/jspdf-toolkit';
 *
 * const { width, height } = measureHighlightedText(doc, 'Paid');
 * const x = doc.margins.left + doc.contentWidth - width; // right-aligned pill
 * ```
 */
export function measureHighlightedText(
  ctx: DrawingContext,
  text: string,
  options?: Pick<HighlightedTextOptions, 'padding' | 'maxWidth'>,
): HighlightMetrics {
  checkedText('drawHighlightedText text', text);
  const padding = optionalNumber('drawHighlightedText padding (mm)', options?.padding, { min: 0 }) ?? HIGHLIGHT.padding;
  const maxWidth = optionalNumber('drawHighlightedText maxWidth (mm)', options?.maxWidth, POSITIVE) ?? ctx.measure;

  return withDrawingState(ctx, () => {
    setTextStyle(ctx, 'bodyBold');
    const { lineHeight, ascent } = measureTextLevel(ctx, 'bodyBold');
    const lines = wrap(ctx, text, remainingTextWidth('drawHighlightedText', maxWidth, padding * 2));
    const textWidth = Math.max(...lines.map((line) => ctx.doc.getTextWidth(line)));

    const descent = descentMm(ctx.doc.getFontSize());
    const glyphs = { lines, lineHeight, ascent, descent };
    return {
      lines,
      width: textWidth + padding * 2,
      height: pillBox(glyphs, 0, padding).height,
      lineHeight,
      padding,
      ascent,
      descent,
    };
  });
}

/**
 * The rectangle of a pill whose first baseline is at `baseline`: it wraps the glyphs of its lines, from the top of the
 * capitals of the first one to the descenders of the last one, `padding` around them.
 */
function pillBox(
  metrics: Pick<HighlightMetrics, 'lines' | 'lineHeight' | 'ascent' | 'descent'>,
  baseline: number,
  padding: number,
): { top: number; height: number } {
  const { lines, lineHeight, ascent, descent } = metrics;
  return {
    top: baseline - ascent - padding,
    height: (lines.length - 1) * lineHeight + ascent + descent + padding * 2,
  };
}

/**
 * The rectangle `drawPill` paints for a pill whose first baseline is at `baseline`: its padding is cut down so it is
 * no taller than its lines, and pills on adjacent lines never overlap.
 * @internal
 */
export function inlinePillBox(metrics: HighlightMetrics, baseline: number): { top: number; height: number } {
  const { ascent, descent, lineHeight } = metrics;
  return pillBox(metrics, baseline, Math.max(0, Math.min(metrics.padding, (lineHeight - ascent - descent) / 2)));
}

/** Paints the pill rectangle (`top`, `height`) and its text, first baseline at `baseline`. */
function paintPill(
  ctx: DrawingContext,
  metrics: HighlightMetrics,
  x: number,
  baseline: number,
  rect: { top: number; height: number },
  strong: boolean,
): void {
  const { doc, theme } = ctx;
  withDrawingState(ctx, () => {
    doc.setFillColor(strong ? theme.colors.primary : theme.colors.tintLight);
    doc.roundedRect(x, rect.top, metrics.width, rect.height, HIGHLIGHT.radius, HIGHLIGHT.radius, 'F');

    // The text color goes with the fill of the pill, not with the level.
    applyTextStyle(doc, {
      ...resolveTextStyle(ctx, 'bodyBold'),
      color: strong ? theme.colors.onPrimary : theme.colors.text,
    });
    drawText(ctx, metrics.lines, x + metrics.padding, baseline);
  });
}

/**
 * Draws a measured pill inline, its first baseline on the baseline of the text around it, in the rectangle of
 * `inlinePillBox`.
 * @internal
 */
export function drawPill(
  ctx: DrawingContext,
  metrics: HighlightMetrics,
  x: number,
  baseline: number,
  strong: boolean,
): void {
  paintPill(ctx, metrics, x, baseline, inlinePillBox(metrics, baseline), strong);
}

const METRIC_SIZES = ['width', 'height', 'lineHeight', 'padding', 'ascent', 'descent'] as const;

/** The `metrics` a caller passes in: the lines of text and every size, each as `measureHighlightedText` gives it. */
function checkMetrics(metrics: HighlightMetrics): HighlightMetrics {
  checkedObject('drawHighlightedText metrics', metrics);
  checkedTexts('drawHighlightedText metrics lines', metrics.lines);
  for (const size of METRIC_SIZES) checkedNumber(`drawHighlightedText metrics ${size}`, metrics[size], { min: 0 });
  return metrics;
}

/**
 * Draws `text` in a pill, `y` at the top of the pill. Returns the Y under the pill.
 *
 * @example
 * ```ts
 * import { drawHighlightedText } from '@mlt-a/jspdf-toolkit';
 *
 * const y = doc.getYPos();
 * drawHighlightedText(doc, 'Paid', { x: doc.margins.left, y, strong: true });
 * ```
 */
export function drawHighlightedText(ctx: DrawingContext, text: string, options: HighlightedTextOptions): number {
  const { x, y } = checkedPoint('drawHighlightedText', options);
  checkedText('drawHighlightedText text', text);
  const strong = optionalBoolean('drawHighlightedText strong', options.strong) ?? false;
  const metrics =
    options.metrics === undefined ? measureHighlightedText(ctx, text, options) : checkMetrics(options.metrics);
  const baseline = y + metrics.padding + metrics.ascent;
  paintPill(ctx, metrics, x, baseline, pillBox(metrics, baseline, metrics.padding), strong);
  return y + metrics.height;
}
