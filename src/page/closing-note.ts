import type { TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { checkedText, optionalNumber } from '../core/errors';
import { withDrawingState } from '../drawing/drawing-state';
import { levelColor, measureTextLevel, optionalLevel, resolveTextStyle } from '../drawing/text';
import { text as drawText, wrap } from '../drawing/text-lines';
import { applyFont, applyTextStyle } from '../drawing/text-style';
import { resolveColor } from '../theme/colors';
import type { ColorInput } from '../theme/types';

/** Options of `closingNote`. */
export interface ClosingNoteOptions {
  /** Text level of the note. Default: `'footer'`. */
  level?: TextLevel;
  /** Color of the note. Default: the color the theme gives the level, else `'secondary'`. */
  color?: ColorInput;
  /** Space (mm) between the note and the bottom of the content area: 0 or more. Default: `theme.spacing.block`. */
  bottomGap?: number;
}

/**
 * Draws small muted text at the bottom of the content area, e.g. legal notices, and closes the page: the position
 * moves to the end of the content area, so what follows starts on a new page. Breaks the page first when the text
 * does not fit under the current position. An empty text draws nothing and moves nothing.
 */
export function drawClosingNote(ctx: DrawingContext, text: string, options?: ClosingNoteOptions): number {
  const { contentWidth, theme } = ctx;
  const bottomGap = optionalNumber('closingNote bottomGap (mm)', options?.bottomGap, { min: 0 }) ?? theme.spacing.block;
  const level = optionalLevel('closingNote', options?.level) ?? 'footer';
  const color = options?.color === undefined ? levelColor(ctx, level, 'secondary') : resolveColor(theme, options.color);
  checkedText('closingNote text', text);
  // Nothing to draw: not even a page to close, so what follows stays where it was.
  if (text === '') return ctx.peekYPos();

  const { lineHeight, ascent } = measureTextLevel(ctx, level);
  const limit = ctx.layout.bottom(ctx.pageHeight);

  // One scope: the page break restores the style it found, and the `onNewPage` hook starts from its own.
  withDrawingState(ctx, () => {
    const style = { ...resolveTextStyle(ctx, level), color };
    applyFont(ctx.doc, style);
    const lines = wrap(ctx, text, contentWidth);
    const height = lines.length * lineHeight;
    ctx.ensureSpace(height + bottomGap);
    // After `ensureSpace`: placing a waiting heading restores the color it found, rounded by jsPDF.
    applyTextStyle(ctx.doc, style);
    drawText(ctx, lines, ctx.margins.left + contentWidth / 2, limit - bottomGap - height + ascent, {
      align: 'center',
    });
  });
  // No space under it: the position stops at the bottom of the content area, which closes the page.
  return ctx.endBlock(limit, 0);
}
