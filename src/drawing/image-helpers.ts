import type { ImageCompression } from 'jspdf';

import type { DrawingContext } from '../core/context';
import { InvalidOptionError, checkedBox, checkedText } from '../core/errors';
import type { EmbeddedImage } from '../core/image-cache';
import { errorMessage } from '../utils/errors';

/**
 * Size (mm) of `image`: `size` as given when it has both sides, else the missing side follows the image ratio. Throws
 * when `size` has neither.
 */
export function scaledSize(
  image: EmbeddedImage,
  { width, height }: { width?: number; height?: number },
): { width: number; height: number } {
  if (width !== undefined) return { width, height: height ?? (image.height / image.width) * width };
  if (height !== undefined) return { width: (image.width / image.height) * height, height };
  throw new InvalidOptionError('An image size needs a width or a height');
}

/**
 * Draws `image` (a name given to `registerImage`, image data, or an image the cache already resolved) through the
 * document's image cache: decoded and embedded once, then drawn by alias. Throws when the image cannot be read.
 */
export function addCachedImage(
  ctx: DrawingContext,
  image: string | EmbeddedImage,
  x: number,
  y: number,
  width: number,
  height: number,
  compression?: ImageCompression,
): void {
  const { alias, data } = typeof image === 'string' ? ctx.images.get(image) : image;
  // No format: jsPDF reads it from the bytes, so PNG and JPEG both work.
  ctx.doc.addImage(data, x, y, width, height, alias, compression);
}

/** Options of `drawImage`, `x` and `y` at its top-left corner. A missing `width` or `height` keeps the image ratio. */
export type ImageOptions = {
  /** Left edge (mm), from the left of the page. */
  x: number;
  /** Top edge (mm), from the top of the page. */
  y: number;
} & (
  | {
      /** Width (mm). Give `width`, `height` or both; one left out follows from the other and the image ratio. */
      width: number;
      /** Height (mm). Give `width`, `height` or both; one left out follows from the other and the image ratio. */
      height?: number;
    }
  | {
      /** Width (mm). Give `width`, `height` or both; one left out follows from the other and the image ratio. */
      width?: number;
      /** Height (mm). Give `width`, `height` or both; one left out follows from the other and the image ratio. */
      height: number;
    }
);

/**
 * Draws `image` (a name given to `doc.registerImage`, or image data), `y` at its top. Returns the Y under it. An
 * image that cannot be read is recorded as a warning and draws nothing.
 *
 * @example
 * ```ts
 * import { drawImage } from '@mlt-a/jspdf-toolkit';
 *
 * doc.registerImage('logo', logoDataUri);
 * const y = doc.getYPos();
 * const bottom = drawImage(doc, 'logo', { x: doc.margins.left, y, width: 90 }); // height from the ratio
 * doc.endBlock(bottom, doc.theme.spacing.block);
 * ```
 */
export function drawImage(ctx: DrawingContext, image: string, options: ImageOptions): number {
  // A missing or invalid size is a wrong call, not an unreadable asset: it must not end up as a warning.
  const { x, y, width, height } = checkedBox('drawImage', options, ['x', 'y']);
  // Not an unreadable asset either: a value that is no string must not end up as a warning.
  checkedText('drawImage image', image);
  if (width === undefined && height === undefined) {
    throw new InvalidOptionError('drawImage needs a width or a height');
  }
  try {
    const embedded = ctx.images.get(image);
    const size = scaledSize(embedded, { width, height });
    addCachedImage(ctx, embedded, x, y, size.width, size.height);
    return y + size.height;
  } catch (error) {
    ctx.addWarning(`Failed to draw image: ${errorMessage(error)}`);
    return y + (height ?? 0);
  }
}

/**
 * Draws `image` as large as it fits in `box`, its ratio kept, from the top-left corner of the box. An image that
 * cannot be read is recorded as a warning naming `what` and draws nothing.
 */
export function drawImageInBox(
  ctx: DrawingContext,
  image: string,
  box: { x: number; y: number; width: number; height: number },
  what: string,
): void {
  try {
    const embedded = ctx.images.get(image);
    const byWidth = scaledSize(embedded, { width: box.width });
    const size = byWidth.height <= box.height ? byWidth : scaledSize(embedded, { height: box.height });
    addCachedImage(ctx, embedded, box.x, box.y, size.width, size.height);
  } catch (error) {
    ctx.addWarning(`Failed to draw ${what}: ${errorMessage(error)}`);
  }
}

/**
 * Draws `image` `height` tall, its width from the image ratio. `x` is the left edge, or a function of the width for an
 * image placed from its right edge. Returns the width, or `undefined` after a warning naming `what`.
 */
export function drawImageAtHeight(
  ctx: DrawingContext,
  image: string,
  x: number | ((width: number) => number),
  y: number,
  height: number,
  what: string,
): number | undefined {
  try {
    const embedded = ctx.images.get(image);
    const { width } = scaledSize(embedded, { height });
    addCachedImage(ctx, embedded, typeof x === 'number' ? x : x(width), y, width, height);
    return width;
  } catch (error) {
    ctx.addWarning(`Failed to draw ${what}: ${errorMessage(error)}`);
    return undefined;
  }
}

/**
 * Draws `image` across the page width on the bottom edge, shifted by `theme.assets.backgroundOffsetY`: the
 * `background` of the document and of the covers. Returns the resolved image to draw it again, or `undefined` after
 * a warning.
 */
export function drawBackgroundImage(ctx: DrawingContext, image: string | EmbeddedImage): EmbeddedImage | undefined {
  try {
    const embedded = typeof image === 'string' ? ctx.images.get(image) : image;
    const { width, height } = scaledSize(embedded, { width: ctx.pageWidth });
    const y = ctx.pageHeight - height + (ctx.theme.assets.backgroundOffsetY ?? 0);
    addCachedImage(ctx, embedded, 0, y, width, height, 'FAST');
    return embedded;
  } catch (error) {
    ctx.addWarning(`Failed to draw background image: ${errorMessage(error)}`);
    return undefined;
  }
}

/** Draws an `icon` option, a square `size` wide: a name given to `registerImage`, or image data. */
export function drawIcon(ctx: DrawingContext, icon: string, x: number, y: number, size: number): void {
  try {
    addCachedImage(ctx, icon, x, y, size, size);
  } catch (error) {
    ctx.addWarning(`Failed to draw icon: ${errorMessage(error)}`);
  }
}
