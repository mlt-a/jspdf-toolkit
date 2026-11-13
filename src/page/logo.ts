import type { DrawingContext } from '../core/context';
import { checkedBox, checkedObject, checkedText, optionalChoice } from '../core/errors';
import { drawImageAtHeight } from '../drawing/image-helpers';

/** Page corner a logo's `x` and `y` measure from. */
export type LogoAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Where a logo sits: its height and its offset from a corner of the page. */
export interface LogoPosition {
  /** Height (mm), above 0; the width follows the image ratio. Default: 15. */
  height?: number;
  /**
   * Distance (mm) from the left or right page edge, as `anchor` says. Default: the margin on that side; 20 on the back
   * cover.
   */
  x?: number;
  /**
   * Distance (mm) from the top or bottom page edge, as `anchor` says. Default: the top margin, or the bottom margin
   * with a bottom anchor; 20 on the back cover. Left out on `doc.logo()` anchored at the top, the logo is drawn at the
   * position instead.
   */
  y?: number;
  /** Page corner `x` and `y` measure from. Default: `'top-left'`. */
  anchor?: LogoAnchor;
}

/** A logo image and where it sits: the `logo` option of the covers and the back cover. */
export interface LogoPlacement extends LogoPosition {
  /** A name given to `registerImage`, or image data. */
  image: string;
}

const LOGO_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const satisfies readonly LogoAnchor[];

/** A logo position with its `height` settled. */
type ResolvedLogoPosition = LogoPosition & { height: number };

/**
 * `defaults` under the positions given, the last one winning. A value left `undefined` in a position keeps the
 * default, the `image` of a `LogoPlacement` is not carried over.
 */
export function logoPosition(
  defaults: ResolvedLogoPosition,
  ...positions: (LogoPosition | undefined)[]
): ResolvedLogoPosition {
  const merged = positions.reduce<ResolvedLogoPosition>(
    (previous, position) => ({
      // `undefined` keeps the default; `null` is a value like any other, refused below.
      height: position?.height === undefined ? previous.height : position.height,
      x: position?.x === undefined ? previous.x : position.x,
      y: position?.y === undefined ? previous.y : position.y,
      anchor: position?.anchor === undefined ? previous.anchor : position.anchor,
    }),
    defaults,
  );
  // Before the logo is placed: an invalid value is a wrong call, not an unreadable image.
  checkedBox('logo', merged, ['height']);
  optionalChoice('logo anchor', merged.anchor, LOGO_ANCHORS);
  return merged;
}

/** A logo option resolved: its image and its position, checked. */
export interface ResolvedLogo {
  image: string;
  position: ResolvedLogoPosition;
}

/**
 * The `logo` option of a page drawn whole (a cover, the back cover), resolved before anything is drawn on it: its
 * position is `defaults` under the `layers` (a cover layout), under the option itself. `undefined` without a logo.
 * Throws an `InvalidOptionError` for an invalid position: the page is then left blank, not half drawn.
 */
export function resolveLogo(
  logo: LogoPlacement | undefined,
  defaults: ResolvedLogoPosition,
  ...layers: (LogoPosition | undefined)[]
): ResolvedLogo | undefined {
  if (logo === undefined) return undefined;
  checkedObject('logo', logo);
  checkedText('logo image', logo.image);
  return { image: logo.image, position: logoPosition(defaults, ...layers, logo) };
}

/** Whether a logo sits in the flow, at the current position: no `y`, anchored at the top. */
function inFlow(position: LogoPosition): boolean {
  return position.y === undefined && !position.anchor?.startsWith('bottom');
}

/**
 * Draws `image` from its page corner. Left out of `position`, `x` is the margin on the anchor's side and `y` the
 * margin on its edge: the page's top margin, or the bottom margin. A logo wider or taller than the page leaves it from
 * there raises a warning: it runs off the page. `checkHeight: false` leaves the height to `ensureSpace`, which already
 * warns for a logo in the flow taller than the page. Returns the width, or `undefined` after a warning naming `what`.
 */
export function drawLogoAt(
  ctx: DrawingContext,
  image: string,
  position: ResolvedLogoPosition,
  what = 'logo',
  checkHeight = true,
): number | undefined {
  const { height, anchor = 'top-left' } = position;
  const fromRight = anchor.endsWith('right');
  const fromBottom = anchor.startsWith('bottom');
  const { margins } = ctx;
  const offsetX = position.x ?? (fromRight ? margins.right : margins.left);
  const offsetY = position.y ?? (fromBottom ? margins.bottom : ctx.layout.baseTop(ctx.pageNumber));
  const x = fromRight ? (width: number) => ctx.pageWidth - width - offsetX : offsetX;
  const y = fromBottom ? ctx.pageHeight - height - offsetY : offsetY;
  const width = drawImageAtHeight(ctx, image, x, y, height, what);
  // From either side, what the page leaves is what lies between the corner offset and the opposite edge.
  if (width !== undefined) {
    warnOffPage(ctx, what, { width, height: checkHeight ? height : undefined }, offsetX, offsetY);
  }
  return width;
}

/**
 * Warns when a logo `width` wide, `height` tall when given, runs off the page: more than the page leaves from the
 * offsets `x` and `y` of its corner.
 */
function warnOffPage(
  ctx: DrawingContext,
  what: string,
  size: { width: number; height: number | undefined },
  x: number,
  y: number,
): void {
  const roomWidth = ctx.pageWidth - x;
  const roomHeight = ctx.pageHeight - y;
  const sides = [
    ...(size.width > roomWidth
      ? [`${size.width.toFixed(1)} mm wide, more than the ${roomWidth.toFixed(1)} mm the page leaves from its position`]
      : []),
    ...(size.height !== undefined && size.height > roomHeight
      ? [
          `${size.height.toFixed(1)} mm tall, more than the ${roomHeight.toFixed(1)} mm the page leaves from its position`,
        ]
      : []),
  ];
  if (sides.length > 0) ctx.addWarning(`The ${what} is ${sides.join(' and ')}, and may be clipped`);
}

/**
 * Without `y` and anchored at the top, draws the logo in the flow at `y`; otherwise places it from its page corner.
 * Returns the height it takes in the flow: 0 out of the flow, or when the image cannot be drawn (after a warning).
 */
export function placeLogo(
  ctx: DrawingContext,
  image: string,
  position: ResolvedLogoPosition,
  y: number,
  what: string,
): number {
  if (!inFlow(position)) {
    // Placed from its page corner, it takes the page margins, not those of the column it is called from.
    ctx.inPageFrame(() => drawLogoAt(ctx, image, position, what));
    return 0;
  }
  return drawLogoAt(ctx, image, { ...position, y }, what) === undefined ? 0 : position.height;
}

/**
 * Without `y` and anchored at the top, draws the logo in the flow at the current position and moves the position
 * `spaceAfter` under it. With `y`, or anchored at the bottom, places it from its page corner and leaves the position.
 * Returns the position.
 */
export function drawFlowLogo(
  ctx: DrawingContext,
  image: string,
  position: LogoPosition,
  { defaultHeight, what, spaceAfter }: { defaultHeight: number; what: string; spaceAfter: number },
): number {
  checkedText(`${what} image`, image);
  const logo = logoPosition({ height: defaultHeight }, position);
  if (!inFlow(logo)) {
    placeLogo(ctx, image, logo, ctx.peekYPos(), what);
    return ctx.peekYPos();
  }
  ctx.ensureSpace(logo.height + spaceAfter);
  const startY = ctx.getYPos();
  // `ensureSpace` has warned for a logo taller than the page.
  const width = drawLogoAt(ctx, image, { ...logo, y: startY }, what, false);
  // An unreadable logo takes no room: the warning says why it is missing.
  return width === undefined ? startY : ctx.endBlock(startY + logo.height, spaceAfter);
}
