import { LINE_WIDTH, SEPARATOR } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { POSITIVE, optionalNumber } from '../core/errors';
import { resolveOptionalColor } from '../theme/colors';
import type { ColorInput } from '../theme/types';
import { withDrawingState } from './drawing-state';

/** Options of `separator`. */
export interface SeparatorOptions {
  /** Color of the rule. Default: `'border'`. */
  color?: ColorInput;
  /** Stroke width (mm) of the rule: above 0. Default: `LINE_WIDTH.normal`. */
  lineWidth?: number;
  /** Space (mm) under the rule. Default: `SPACING.large`. */
  spaceAfter?: number;
  /**
   * Space (mm) above the rule. It collapses with the space the previous block left under it: the larger of the two
   * separates them. None at the top of a page. Default: `SPACING.large`, wider than the space under a block, so the
   * rule reads as a break.
   */
  spaceBefore?: number;
}

export function drawSeparator(ctx: DrawingContext, options?: SeparatorOptions): number {
  return withDrawingState(ctx, () => {
    const { doc, contentWidth, theme } = ctx;
    const margin = ctx.margins.left;

    const color = resolveOptionalColor(theme, options?.color, 'border');
    const lineWidth = optionalNumber('separator lineWidth (mm)', options?.lineWidth, POSITIVE) ?? LINE_WIDTH.normal;
    const spaceBefore = optionalNumber('spaceBefore (mm)', options?.spaceBefore) ?? SEPARATOR.spaceBefore;
    const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter, SEPARATOR.spaceAfter);

    // Before any move, so a heading waiting for the separator goes to the next page with it.
    ctx.ensureSpace(spaceBefore + spaceAfter);
    const currentY = ctx.beginBlock(spaceBefore);

    doc.setDrawColor(color);
    doc.setLineWidth(lineWidth);
    doc.line(margin, currentY, margin + contentWidth, currentY);

    return ctx.endBlock(currentY, spaceAfter);
  });
}
