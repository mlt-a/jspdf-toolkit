import type { TextLevel } from '../core/constants';
import { ICONS, centerOnCapitals } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { POSITIVE, checkedPoint, checkedText, optionalNumber } from '../core/errors';
import { resolveColor } from '../theme/colors';
import type { ColorInput } from '../theme/types';
import { withDrawingState } from './drawing-state';
import { drawIcon } from './image-helpers';
import { levelColor, measureTextLevel, optionalLevel, resolveTextStyle } from './text';
import { text as drawText, remainingTextWidth, wrap } from './text-lines';
import { applyTextStyle } from './text-style';

/** Options of `drawIconWithText`. */
export interface IconWithTextOptions {
  /** Left edge (mm), from the left of the page. */
  x: number;
  /** Top edge (mm) of the first text line, from the top of the page. */
  y: number;
  /** A name given to `doc.registerImage`, or image data. */
  icon: string;
  /** Side (mm) of the square icon. Default: 3. */
  iconSize?: number;
  /** Space (mm) between the icon and the text. Default: 2. */
  gap?: number;
  /** Text level of the text. Default: `'body'`. */
  level?: TextLevel;
  /** Text color. Default: the level's. */
  color?: ColorInput;
  /**
   * Width (mm) of the icon, the gap and the text together: the text wraps in what is left. Default: the document
   * `measure`.
   */
  maxWidth?: number;
}

/**
 * Draws an icon followed by `text`, `y` at the top of the first text line: the icon sits on its baseline. Returns the
 * Y under the text.
 *
 * @example
 * ```ts
 * import { drawIconWithText } from '@mlt-a/jspdf-toolkit';
 *
 * doc.registerImage('phone', phoneDataUri);
 * const y = doc.getYPos();
 * const bottom = drawIconWithText(doc, '+1 555 0100', { icon: 'phone', x: doc.margins.left, y });
 * doc.endBlock(bottom, doc.theme.spacing.block);
 * ```
 */
export function drawIconWithText(ctx: DrawingContext, text: string, options: IconWithTextOptions): number {
  return withDrawingState(ctx, () => {
    const { doc } = ctx;
    const what = 'drawIconWithText';
    const { x, y } = checkedPoint(what, options);
    checkedText(`${what} text`, text);
    checkedText(`${what} icon`, options.icon);
    const iconSize = optionalNumber(`${what} iconSize (mm)`, options.iconSize, POSITIVE) ?? ICONS.size;
    const gap = optionalNumber(`${what} gap (mm)`, options.gap, { min: 0 }) ?? ICONS.gap;
    const level = optionalLevel(what, options.level) ?? 'body';
    const maxWidth = optionalNumber(`${what} maxWidth (mm)`, options.maxWidth, POSITIVE) ?? ctx.measure;
    // The text keeps some width after the icon and its gap.
    const textWidth = remainingTextWidth(what, maxWidth, iconSize + gap);
    const metrics = measureTextLevel(ctx, level);
    const baseline = y + metrics.ascent;
    // Resolved before the icon: an invalid color must not leave the icon drawn alone.
    const color = options.color === undefined ? levelColor(ctx, level) : resolveColor(ctx.theme, options.color);

    drawIcon(ctx, options.icon, x, centerOnCapitals(baseline, metrics, iconSize), iconSize);

    applyTextStyle(doc, { ...resolveTextStyle(ctx, level), color });

    const lines = wrap(ctx, text, textWidth);
    drawText(ctx, lines, x + iconSize + gap, baseline);

    return y + lines.length * metrics.lineHeight;
  });
}
