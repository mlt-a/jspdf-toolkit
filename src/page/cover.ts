import { COVER, LOGO, lineHeightMm } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  InvalidOptionError,
  checkedBox,
  checkedChoice,
  checkedLeftOut,
  checkedObject,
  checkedTexts,
  optionalBoolean,
  optionalText,
  unknownOption,
} from '../core/errors';
import { drawBackgroundImage } from '../drawing/image-helpers';
import { levelColor, measureTextLevel, resolveTextStyle } from '../drawing/text';
import { drawLines, remainingTextWidth, wrap } from '../drawing/text-lines';
import { applyFont, applyTextStyle, setFont } from '../drawing/text-style';
import type { TextStyle } from '../drawing/text-style';
import { resolveColor } from '../theme/colors';
import type { ColorInput } from '../theme/types';
import type { CoverBaseOptions } from './cover-options';
import { drawLogoAt, resolveLogo } from './logo';
import type { LogoPlacement } from './logo';
import { drawWaveCover } from './wave-cover';
import type { WaveCoverOptions } from './wave-cover';

export type { CoverBaseOptions, WaveCoverOptions };

/**
 * A full-page image under the title, placed as a layout of `theme.assets.covers` says. The `image` is anchored to
 * the bottom of the page; the `logo` is placed as the layout's `logo` says, each field given here overriding it
 * (default height: 15 mm).
 */
export interface ImageCoverOptions extends CoverBaseOptions {
  /**
   * An image as wide as the page, anchored to the bottom of the cover, with the title over it placed by a layout of the
   * theme.
   */
  variant: 'image';
  /** Key of the layout in `theme.assets.covers`: where the title, subtitle and logo go. */
  layout: string;
}

/** A cover drawn by your callback: see `PDFDocument.cover`. */
export interface CustomCoverOptions {
  /** A cover drawn by `draw`. */
  variant: 'custom';
  /** Draws the cover page: `ctx` is the document, `title` the one given to `cover`. */
  draw: (ctx: DrawingContext, title: string) => void;
}

/**
 * Options of `cover`, discriminated by `variant`: `wave`, `image` or `custom`. The options of another variant throw an
 * `InvalidOptionError` before anything is drawn.
 */
export type CoverOptions = WaveCoverOptions | ImageCoverOptions | CustomCoverOptions;

/** A page `cover` or `backCover` draws whole. */
export type DesignedPage = 'cover' | 'backCover';

/** The options each variant takes besides `variant`: another variant's options are rejected, not ignored. */
const VARIANT_OPTIONS: Record<DesignedPage, Record<string, readonly string[]>> = {
  cover: {
    wave: ['subtitle', 'image', 'logo', 'titleColor', 'subtitleColor', 'accentBar', 'waveColor'],
    image: ['subtitle', 'image', 'logo', 'layout'],
    custom: ['draw'],
  },
  backCover: {
    plain: ['image', 'logo', 'contact', 'legalText'],
    custom: ['draw'],
  },
};

/**
 * Throws `InvalidOptionError` when the `variant` of a cover or back cover is unknown, a custom one has no `draw`, an
 * option of another variant is set, or an option has the wrong type. Checked at runtime for JavaScript callers, before anything is drawn.
 */
export function checkVariant(kind: DesignedPage, options: CoverOptions | BackCoverOptions): void {
  const what = kind === 'cover' ? 'cover' : 'back cover';
  checkedObject(`${what} options`, options);
  const variants = VARIANT_OPTIONS[kind];
  // A back cover is a plain one unless it says otherwise: `null` is no variant.
  const given = options.variant === undefined && kind === 'backCover' ? 'plain' : options.variant;
  const variant = checkedChoice(`${what} variant`, given, Object.keys(variants));
  if (variant === 'custom' && typeof (options as { draw?: unknown }).draw !== 'function') {
    throw new InvalidOptionError(`The custom ${what} needs a \`draw\` function`);
  }
  const others = Object.values(variants).flat();
  checkedLeftOut(
    `${what} ${variant}`,
    options,
    others.filter((key) => !variants[variant].includes(key)),
  );
  if (variant === 'custom') return;
  // The options every other variant takes with a type of its own: texts, and the bar of the wave cover.
  const fields = options as Record<string, unknown>;
  optionalText(`${what} image`, fields.image);
  if (kind === 'backCover') {
    optionalText(`${what} legalText`, fields.legalText);
    return;
  }
  optionalText(`${what} subtitle`, fields.subtitle);
  if (variant === 'wave') optionalBoolean(`${what} accentBar`, fields.accentBar);
}

/** Draws the cover on the current page. */
export function drawCover(ctx: DrawingContext, title: string, options: CoverOptions): void {
  if (options.variant === 'wave') drawWaveCover(ctx, title, options);
  else if (options.variant === 'image') drawImageCover(ctx, title, options);
  else options.draw(ctx, title);
}

/** Throws when the layout is not in `theme.assets.covers`. */
function drawImageCover(ctx: DrawingContext, title: string, options: ImageCoverOptions): void {
  const { doc, theme, pageWidth } = ctx;

  const coverConfig = theme.assets.covers?.[options.layout];
  if (!coverConfig) {
    throw unknownOption('layout of theme.assets.covers', options.layout, Object.keys(theme.assets.covers ?? {}));
  }

  // Every color is resolved before drawing, so an invalid one leaves no half-drawn page.
  const titleColor = resolveColor(theme, coverConfig.color);
  const subtitleColor = options.subtitle
    ? resolveColor(theme, coverConfig.subtitleColor ?? coverConfig.color)
    : undefined;

  const logo = resolveLogo(options.logo, { height: LOGO.height }, coverConfig.logo);

  if (options.image) drawBackgroundImage(ctx, options.image);

  if (logo) drawLogoAt(ctx, logo.image, logo.position);

  const { titleX, titleY } = coverConfig;
  const titleSize = coverConfig.titleSize ?? COVER.titleSize;
  const titleAlign = coverConfig.titleAlign ?? 'left';
  const titleMaxWidth = coverConfig.titleMaxWidth ?? pageWidth * COVER.titleWidthRatio;

  setFont(ctx, 'title', 'bold', titleSize);
  doc.setTextColor(titleColor);
  const titleLines = wrap(ctx, title, titleMaxWidth);
  const titleEnd = drawLines(
    ctx,
    titleLines,
    titleX,
    titleY,
    lineHeightMm(titleSize, COVER.lineHeightFactor),
    titleAlign,
  );

  if (options.subtitle && subtitleColor !== undefined) {
    const subtitleSize = coverConfig.subtitleSize ?? titleSize * COVER.subtitleSizeRatio;
    const subtitleY = titleEnd + (coverConfig.titleGap ?? COVER.titleGap);

    setFont(ctx, 'title', 'regular', subtitleSize);
    doc.setTextColor(subtitleColor);
    const subtitleLines = wrap(ctx, options.subtitle, titleMaxWidth);
    drawLines(ctx, subtitleLines, titleX, subtitleY, lineHeightMm(subtitleSize, COVER.lineHeightFactor), titleAlign);
  }
}

/** Contact lines of the back cover. Positions in mm from the top-left corner. */
export interface BackCoverContact {
  /**
   * One text per line, set in the `small` level, wrapped to the page width right of `x` less a 20 mm inset. Required:
   * a contact without `lines` throws `InvalidOptionError`, and so does an `x` that leaves the lines no width.
   */
  lines: string[];
  /** Left edge (mm) of the lines, from the left of the page. Default: 20. */
  x?: number;
  /** Top (mm) of the first line, from the top of the page. Default: 50. */
  y?: number;
  /** Color of the lines. Default: the color of the `small` level, `'text'` unless the theme changes it. */
  color?: ColorInput;
}

/** The `plain` back cover: an optional image, logo and contact block. */
export interface PlainBackCoverOptions {
  /** A back cover drawn by the library from the options below. Default: `'plain'`. */
  variant?: 'plain';
  /** Full-page image, anchored to the bottom of the page: a name given to `registerImage`, or image data. */
  image?: string;
  /** Logo placed from a page corner. Default: 20 mm from the top-left corner, 15 mm tall. */
  logo?: LogoPlacement;
  /** Block of contact lines; nothing is drawn when it has no line. */
  contact?: BackCoverContact;
  /**
   * Small centered text at the bottom of the page, e.g. legal notices: the `footer` level, in `'secondary'` unless the
   * theme colors that level. Wrapped to the page width less 20 mm on each side, its last line on the bottom baseline.
   */
  legalText?: string;
}

/** A back cover drawn by your callback: see `PDFDocument.backCover`. */
export interface CustomBackCoverOptions {
  /** A back cover drawn by `draw`. */
  variant: 'custom';
  /** Draws the back cover page: `ctx` is the document. */
  draw: (ctx: DrawingContext) => void;
}

/**
 * Options of `backCover`, discriminated by `variant`: `plain` (the default) or `custom`. The options of the other
 * variant throw an `InvalidOptionError` before anything is drawn.
 */
export type BackCoverOptions = PlainBackCoverOptions | CustomBackCoverOptions;

function drawPlainBackCover(ctx: DrawingContext, options: PlainBackCoverOptions): void {
  const { doc, pageWidth, pageHeight, theme } = ctx;

  // Checked before anything is drawn: an invalid option is a wrong call, not an unreadable asset.
  const { contact } = options;
  const logo = resolveLogo(options.logo, { height: LOGO.height, x: COVER.backInset, y: COVER.backInset });
  if (contact !== undefined) {
    checkedObject('backCover contact', contact);
    checkedTexts('backCover contact lines', contact.lines);
  }
  const { x: contactX = COVER.backInset, y: contactY = COVER.backContactTop } = checkedBox(
    'backCover contact',
    contact ?? {},
    [],
  );
  // Before the lines are looked at: an invalid color throws even when there is no line to draw.
  const contactColor = contact?.color === undefined ? undefined : resolveColor(theme, contact.color);
  // Wrapped before anything is drawn too: a position that leaves the text no width throws.
  const contactText = contact && contact.lines.length > 0 ? layoutContact(ctx, contact.lines, contactX) : undefined;
  const legal = options.legalText ? layoutLegalText(ctx, options.legalText) : undefined;

  if (options.image) drawBackgroundImage(ctx, options.image);

  if (logo) drawLogoAt(ctx, logo.image, logo.position);

  if (contactText) {
    applyTextStyle(doc, { ...contactText.style, color: contactColor ?? contactText.style.color });
    drawLines(ctx, contactText.lines, contactX, contactY, contactText.lineHeight);
  }

  if (legal) {
    applyTextStyle(doc, legal.style);
    // The last line stays on the bottom baseline: a longer text grows upward.
    const lastBaseline = pageHeight - COVER.legalBottomMargin;
    const firstBaseline = lastBaseline - (legal.lines.length - 1) * legal.lineHeight;
    drawLines(ctx, legal.lines, pageWidth / 2, firstBaseline, legal.lineHeight, 'center');
  }
}

/** Lines of a back cover text block, wrapped in the style they are drawn in. */
interface BackCoverText {
  style: TextStyle;
  lines: string[];
  lineHeight: number;
}

/** The contact lines, each wrapped to what the page leaves right of `x`, its inset kept. */
function layoutContact(ctx: DrawingContext, lines: readonly string[], x: number): BackCoverText {
  const width = remainingTextWidth('the backCover contact', ctx.pageWidth - x, COVER.backInset);
  const style = resolveTextStyle(ctx, 'small');
  applyFont(ctx.doc, style);
  return {
    style,
    lines: lines.flatMap((line) => wrap(ctx, line, width)),
    lineHeight: lineHeightMm(style.size, COVER.contactLineHeightFactor),
  };
}

/** The legal text, wrapped to the page less an inset on each side. */
function layoutLegalText(ctx: DrawingContext, text: string): BackCoverText {
  const width = remainingTextWidth('the backCover legalText', ctx.pageWidth, 2 * COVER.backInset);
  const style = { ...resolveTextStyle(ctx, 'footer'), color: levelColor(ctx, 'footer', 'secondary') };
  applyFont(ctx.doc, style);
  return { style, lines: wrap(ctx, text, width), lineHeight: measureTextLevel(ctx, 'footer').lineHeight };
}

/** Draws the back cover on the current page. */
export function drawBackCover(ctx: DrawingContext, options: BackCoverOptions): void {
  if (options.variant === 'custom') options.draw(ctx);
  else drawPlainBackCover(ctx, options);
}
