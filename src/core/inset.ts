import { fitToRoom } from '../drawing/text-lines';
import type { DrawingContext } from './context';
import { InvalidOptionError, POSITIVE, checkedNumber, checkedObject, describe, optionalNumber } from './errors';

/**
 * Options of `inset`, in mm from the edges of the current frame: the page, a column, or another inset. Two of the
 * three fix the third; all three together throw.
 */
export interface InsetOptions {
  /** Space (mm) between the left edge of the current frame and the inset: 0 or more. Default: 0. */
  left?: number;
  /** Space (mm) between the inset and the right edge of the current frame: 0 or more. Default: 0. */
  right?: number;
  /**
   * Width (mm) of the inset: a finite number above 0. Given alone, the inset starts at the left edge of the frame; with
   * `right`, it ends that far from the right edge. Wider than the room the frame leaves, it is brought down to fit,
   * with a warning. A given width is also the measure of the inset, wider or narrower than the `measure` of the
   * document. Default: what `left` and `right` leave.
   */
  width?: number;
}

/** The options among `left` and `right` that are given, as one name: `left`, `right`, or `left and right`. */
function named(left: number | undefined, right: number | undefined): string {
  return [left === undefined ? '' : 'left', right === undefined ? '' : 'right'].filter(Boolean).join(' and ');
}

/**
 * Where an inset of `options` stands in the current frame of `ctx`: `left` (mm) from its left edge, `width` (mm) wide,
 * reading `measure` (mm): a given `width` itself, else the room left, or the measure of the frame when that is narrower.
 * Throws an `InvalidOptionError` for an option out of its bounds, for the three options together, and for `left` and
 * `right` that leave no width, before any warning; a `width` wider than the room left is brought down, with a warning.
 */
export function resolveInset(
  ctx: DrawingContext,
  options: InsetOptions,
): { left: number; width: number; measure: number } {
  checkedObject('inset options', options);
  const left = optionalNumber('inset left (mm)', options.left, { min: 0 });
  const right = optionalNumber('inset right (mm)', options.right, { min: 0 });
  const width = optionalNumber('inset width (mm)', options.width, POSITIVE);
  if (left !== undefined && right !== undefined && width !== undefined) {
    throw new InvalidOptionError(
      `Invalid inset width (mm): ${describe(width)} — must be left out when left and right are both given: ` +
        'two of the three fix the third',
    );
  }
  const frame = ctx.contentWidth;
  const offset = (left ?? 0) + (right ?? 0);
  // `left` and `right` together must leave a width: the sum is checked, named after the options that are given.
  checkedNumber(() => `inset ${named(left, right)} (mm) in a frame ${frame.toFixed(1)} mm wide`, offset, {
    exclusiveMax: frame,
  });
  const room = frame - offset;
  if (width === undefined) return { left: left ?? 0, width: room, measure: Math.min(room, ctx.measure) };
  const fitted = fitToRoom(
    ctx,
    'inset width',
    width,
    room,
    offset === 0 ? '' : `the frame width less the ${offset.toFixed(1)} mm of ${named(left, right)}`,
  );
  // Anchored to the right edge only when `right` is given: `width` alone starts at the left edge.
  return { left: right === undefined ? (left ?? 0) : frame - right - fitted, width: fitted, measure: fitted };
}
