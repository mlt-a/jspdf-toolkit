import { TEXT_ALIGNS } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  POSITIVE,
  checkedNumber,
  checkedObject,
  checkedText,
  checkedTexts,
  optionalChoice,
  optionalNumber,
} from '../core/errors';
import { withDrawingState } from './drawing-state';
import type { DrawTextOptions } from './text-lines';
import { text, trackedWidth, wrap } from './text-lines';

const BASELINES = ['alphabetic', 'middle', 'top', 'bottom'] as const;

/**
 * Draws `value` at `x`, `y` in the current font, size and color (`setTextStyle`, `setFont`): the primitive under the
 * built-in text. `y` is the baseline of the first line (`'alphabetic'`, see `baseline`), not the top: add
 * `measureTextLevel(...).ascent` or `ascentMm(size)` to the top of a line. Unlike `doc.doc.text`, `charSpace` counts
 * in the centering and the right alignment, so a tracked text sits on its anchor. An array is one line per entry,
 * spaced by the theme `lineHeightFactor`. Moves neither the position nor the page: it returns nothing, and a block
 * closes with `endBlock`. Leaves the font, colors and fill as it found them. Throws an `InvalidOptionError` for a
 * `value` that is no string or array of strings, a coordinate or option that is not a finite number, or an `align` or
 * `baseline` it does not take.
 *
 * @example
 * ```ts
 * import { ascentMm, drawText, setFont } from '@mlt-a/jspdf-toolkit';
 *
 * setFont(doc, 'label', 'bold', 9);
 * const top = doc.getYPos();
 * const centre = doc.margins.left + doc.contentWidth / 2;
 * drawText(doc, 'ANNUAL REPORT', centre, top + ascentMm(9), { align: 'center', charSpace: 0.6 });
 * doc.endBlock(top + 6);
 * ```
 */
export function drawText(
  ctx: DrawingContext,
  value: string | string[],
  x: number,
  y: number,
  options?: DrawTextOptions,
): void {
  if (Array.isArray(value)) checkedTexts('drawText value', value);
  else checkedText('drawText value', value);
  checkedNumber('drawText x', x);
  checkedNumber('drawText y', y);
  const opts = options === undefined ? {} : checkedObject('drawText options', options);
  optionalChoice('drawText align', opts.align, TEXT_ALIGNS);
  optionalNumber('drawText charSpace', opts.charSpace);
  optionalChoice('drawText baseline', opts.baseline, BASELINES);
  optionalNumber('drawText maxWidth', opts.maxWidth, POSITIVE);
  optionalNumber('drawText lineHeightScale', opts.lineHeightScale, POSITIVE);
  // The text color is also the fill color: a scope puts the fill back, so raw drawing after the call finds its own.
  withDrawingState(ctx, () => text(ctx, value, x, y, opts));
}

/**
 * Wraps `value` to `width` mm in the current font and `charSpace` mm between letters, as the built-in paragraphs do:
 * one paragraph per line break, breaks at spaces, and a word wider than `width` (an email, an IBAN, a URL) broken
 * instead of overflowing. Returns the lines, without drawing; `drawText` draws them, one line under the other.
 * Throws an `InvalidOptionError` for a `value` that is no string, a `width` that is not a number above 0, or a
 * `charSpace` that is not a finite number.
 *
 * @example
 * ```ts
 * import { drawText, setTextStyle, wrapText } from '@mlt-a/jspdf-toolkit';
 *
 * setTextStyle(doc, 'small');
 * const lines = wrapText(doc, 'A note long enough to need several lines in a narrow column.', 50);
 * drawText(doc, lines, doc.margins.left, doc.getYPos() + 4);
 * ```
 */
export function wrapText(ctx: DrawingContext, value: string, width: number, charSpace?: number): string[] {
  checkedText('wrapText value', value);
  checkedNumber('wrapText width', width, POSITIVE);
  return wrap(ctx, value, width, optionalNumber('wrapText charSpace', charSpace));
}

/**
 * Width (mm) of `value` in the current font, `charSpace` mm added between its letters: the width `drawText` gives it,
 * which `doc.doc.getTextWidth` alone does not count. For one line; `wrapText` cuts a longer text first. Throws an
 * `InvalidOptionError` for a `value` that is no string, or a `charSpace` that is not a finite number.
 *
 * @example
 * ```ts
 * import { drawText, setTextStyle, trackedTextWidth } from '@mlt-a/jspdf-toolkit';
 *
 * setTextStyle(doc, 'caption');
 * const left = doc.margins.left;
 * const baseline = doc.getYPos() + 4;
 * drawText(doc, 'DRAFT', left, baseline, { charSpace: 0.4 });
 * doc.doc.line(left, baseline + 1, left + trackedTextWidth(doc, 'DRAFT', 0.4), baseline + 1);
 * ```
 */
export function trackedTextWidth(ctx: DrawingContext, value: string, charSpace?: number): number {
  checkedText('trackedTextWidth value', value);
  return trackedWidth(ctx.doc, value, optionalNumber('trackedTextWidth charSpace', charSpace));
}
