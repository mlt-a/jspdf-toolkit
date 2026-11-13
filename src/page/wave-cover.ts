import type { jsPDF } from 'jspdf';

import { COVER, LOGO, ascentMm, lineHeightMm } from '../core/constants';
import type { DrawingContext } from '../core/context';
import type { EmbeddedImage } from '../core/image-cache';
import { addCachedImage, scaledSize } from '../drawing/image-helpers';
import { drawLines, wrap } from '../drawing/text-lines';
import { setFont } from '../drawing/text-style';
import { resolveOptionalColor } from '../theme/colors';
import type { ColorInput } from '../theme/types';
import { errorMessage } from '../utils/errors';
import type { CoverBaseOptions } from './cover-options';
import { placeLogo, resolveLogo } from './logo';

/**
 * A logo, an accent bar, the title and a wave-shaped zone, laid out from the document margins. The `image` fills
 * the wave zone at the bottom of the page, cropped to cover it; without one the zone is filled with `waveColor`.
 * The `logo` defaults to the top of the margins, 15 mm tall, with the title under it; with a `y` or a bottom anchor,
 * it is placed from its corner and the title starts at the top.
 */
export interface WaveCoverOptions extends CoverBaseOptions {
  /** Logo and title at the top, and a wave-shaped zone filled with an image or a color at the bottom. */
  variant: 'wave';
  /** Color of the title. Default: `'text'`. */
  titleColor?: ColorInput;
  /** Color of the subtitle. Default: `'secondary'`. */
  subtitleColor?: ColorInput;
  /** Bar above the title, in the primary color. Default: `true`. */
  accentBar?: boolean;
  /** Fill of the wave zone without an `image`, or when it cannot be drawn. Default: `'tint'`. */
  waveColor?: ColorInput;
}

// === Wave path ===

function drawWavePath(doc: jsPDF, pageWidth: number, pageHeight: number): void {
  const waveY = pageHeight * COVER.waveYRatio;

  doc.moveTo(0, waveY + COVER.waveDip * 0.3);
  doc.curveTo(
    pageWidth * 0.25,
    waveY - COVER.waveDip,
    pageWidth * 0.75,
    waveY + COVER.waveDip * 0.5,
    pageWidth,
    waveY - COVER.waveDip * 0.4,
  );
  doc.lineTo(pageWidth, pageHeight);
  doc.lineTo(0, pageHeight);
  doc.close();
}

// === Image ===

/**
 * Clips to the wave and draws `image` over the zone, cropped to cover it. The graphics state is restored whatever
 * happens.
 */
function drawClippedImage(ctx: DrawingContext, image: EmbeddedImage): void {
  const { doc, pageWidth, pageHeight } = ctx;
  const waveTop = pageHeight * COVER.waveYRatio - COVER.waveDip;
  const zoneHeight = pageHeight - waveTop;

  // An image wider than the zone fits its height and is cropped on the sides, a taller one fits its width and is
  // cropped top and bottom.
  const wider = image.width / image.height > pageWidth / zoneHeight;
  const { width, height } = scaledSize(image, wider ? { height: zoneHeight } : { width: pageWidth });

  doc.saveGraphicsState();
  try {
    drawWavePath(doc, pageWidth, pageHeight);
    doc.clip();
    doc.discardPath();
    addCachedImage(ctx, image, (pageWidth - width) / 2, waveTop - (height - zoneHeight) / 2, width, height, 'FAST');
  } finally {
    doc.restoreGraphicsState();
  }
}

/**
 * Draws the wave image. Returns `false` after a warning when it cannot be resolved or drawn, so the caller falls
 * back to the tint. The image is resolved before the path is clipped: a clip consumes the path, so a failure after
 * it could not fall back to the tint.
 */
function drawWaveImage(ctx: DrawingContext, image: string): boolean {
  try {
    drawClippedImage(ctx, ctx.images.get(image));
    return true;
  } catch (error) {
    ctx.addWarning(`Failed to draw wave cover image: ${errorMessage(error)}`);
    return false;
  }
}

// === Main ===

/** Wave cover on the current page. Throws, before drawing, when a color or the logo position is invalid. */
export function drawWaveCover(ctx: DrawingContext, title: string, options: WaveCoverOptions): void {
  const { doc, theme, pageWidth, pageHeight, contentWidth } = ctx;
  const { left } = ctx.margins;
  // Every color is resolved before drawing, so an invalid one leaves no half-drawn page.
  const titleColor = resolveOptionalColor(theme, options.titleColor, 'text');
  const subtitleColor = resolveOptionalColor(theme, options.subtitleColor, 'secondary');
  const waveColor = resolveOptionalColor(theme, options.waveColor, 'tint');
  const titleSize = COVER.waveTitleSize;
  const subtitleSize = COVER.waveSubtitleSize;
  const logo = resolveLogo(options.logo, { height: LOGO.height });

  // The top of the page the cover is drawn on, which is not always the first one.
  let currentY = ctx.layout.baseTop(ctx.pageNumber);

  if (logo) {
    const height = placeLogo(ctx, logo.image, logo.position, currentY, 'cover logo');
    // A logo out of the flow takes no room, nor does an unreadable one: the warning says why it is missing.
    if (height > 0) currentY += height + COVER.waveAccentBarGap;
  }

  if (options.accentBar !== false) {
    doc.setFillColor(theme.colors.primary);
    doc.rect(left, currentY, COVER.waveAccentBarWidth, COVER.waveAccentBarHeight, 'F');
    currentY += COVER.waveAccentBarHeight + COVER.waveTitleGap;
  }

  // `currentY` is the top of the capitals; `drawLines` takes baselines.
  const titleLineHeight = lineHeightMm(titleSize, COVER.lineHeightFactor);
  const titleBaseline = currentY + ascentMm(titleSize);
  setFont(ctx, 'title', 'bold', titleSize);
  doc.setTextColor(titleColor);
  const titleLines = wrap(ctx, title, contentWidth);
  drawLines(ctx, titleLines, left, titleBaseline, titleLineHeight);

  if (options.subtitle) {
    const lastTitleBaseline = titleBaseline + (titleLines.length - 1) * titleLineHeight;
    setFont(ctx, 'body', 'regular', subtitleSize);
    doc.setTextColor(subtitleColor);
    drawLines(
      ctx,
      wrap(ctx, options.subtitle, contentWidth),
      left,
      lastTitleBaseline + COVER.waveSubtitleGap + ascentMm(subtitleSize),
      lineHeightMm(subtitleSize, COVER.lineHeightFactor),
    );
  }

  const imageDrawn = options.image ? drawWaveImage(ctx, options.image) : false;
  if (!imageDrawn) {
    doc.setFillColor(waveColor);
    drawWavePath(doc, pageWidth, pageHeight);
    doc.fill();
  }
}
