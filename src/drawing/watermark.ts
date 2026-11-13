import { GState } from 'jspdf';

import { WATERMARK } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { POSITIVE, checkedText, optionalBoolean, optionalNumber } from '../core/errors';
import { resolveOptionalColor } from '../theme/colors';
import type { ColorInput } from '../theme/types';
import { withDrawingState } from './drawing-state';
import { setFont } from './text-style';

/** Options of `watermark`. */
export interface WatermarkOptions {
  /**
   * Every page, added before or after the call: content, table continuation, table of contents, blank pages, covers
   * and back cover. Default: `false`, the page where `watermark()` is called only.
   */
  allPages?: boolean;
  /** Opacity, from 0 (invisible) to 1 (solid). Default: 0.08. */
  opacity?: number;
  /** Rotation (degrees) around the page center; positive turns counter-clockwise. Default: -45. */
  angle?: number;
  /** Font size (pt), in bold body text. Default: 60. */
  fontSize?: number;
  /** Color of the text, made translucent by `opacity`. Default: `'text'`. */
  color?: ColorInput;
}

/**
 * Draws watermarks of one spec: the opacity `GState` is built once, however many pages get it. Throws an
 * `InvalidOptionError` for a text that is no string and for an option of the wrong type.
 */
export function watermarkDrawer(ctx: DrawingContext, text: string, options?: WatermarkOptions): () => void {
  const { doc, theme } = ctx;

  checkedText('watermark text', text);
  optionalBoolean('watermark allPages', options?.allPages);
  const angle = optionalNumber('watermark angle (degrees)', options?.angle) ?? WATERMARK.angle;
  const fontSize = optionalNumber('watermark fontSize (pt)', options?.fontSize, POSITIVE) ?? WATERMARK.fontSize;
  const opacity = optionalNumber('watermark opacity', options?.opacity, { min: 0, max: 1 }) ?? WATERMARK.opacity;
  const color = resolveOptionalColor(theme, options?.color, 'text');
  const gState = new GState({ opacity });

  return () =>
    withDrawingState(ctx, () => {
      // Scopes the opacity to the watermark; `withDrawingState` restores the font and colors.
      doc.saveGraphicsState();
      doc.setGState(gState);

      setFont(ctx, 'body', 'bold', fontSize);
      doc.setTextColor(color);

      doc.text(text, ctx.pageWidth / 2, ctx.pageHeight / 2, {
        angle,
        align: 'center',
        baseline: 'middle',
      });

      doc.restoreGraphicsState();
    });
}
