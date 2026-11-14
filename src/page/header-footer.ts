import { CHROME, LINE_WIDTH, capitalMiddle } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { checkedObject, checkedVariant, optionalBoolean, optionalNumber, optionalText } from '../core/errors';
import { restateFillColor, withDrawingState } from '../drawing/drawing-state';
import { addCachedImage, scaledSize } from '../drawing/image-helpers';
import { resolveTextStyle, setTextStyle, textLevelSize } from '../drawing/text';
import { fitWithEllipsis, normalizeText, text, trackedWidth } from '../drawing/text-lines';
import type { TextStyle } from '../drawing/text-style';
import { applyFont, applyTextStyle } from '../drawing/text-style';
import { errorMessage } from '../utils/errors';

/** Running header and footer: declared once, drawn by `finalize()` on the numbered pages (`pageLabels`). */

/** The numbers a custom running header or footer draws on one page: what `{page}` and `{pages}` stand for. */
export interface PageNumbers {
  /** Number of the page, from 1, the covers not counted: its entry in `doc.pageLabels`. */
  page: number;
  /** Number of numbered pages: the size of `doc.pageLabels`. */
  pages: number;
}

/** The running header the library draws: a title and a page number above a rule. */
export interface PlainPageHeaderOptions {
  /** A header drawn by the library from the options below. Default: `'plain'`. */
  variant?: 'plain';
  /** Running title, left-aligned. Cut short with "…" when it would run into the page number or past the margin. */
  title?: string;
  /**
   * Page number, right-aligned, in the primary color: the number printed in the footer, on two digits at least (`01`).
   * Default: `false`.
   */
  folio?: boolean;
}

/** A running header drawn by your callback: see `PDFDocument.pageHeader`. */
export interface CustomPageHeaderOptions {
  /** A header drawn by `draw` on every numbered page. */
  variant: 'custom';
  /**
   * Top margin (mm) the header needs, below which the content starts: a lower `margins.top` is raised to it, as the
   * plain header does with 16 mm; 0 leaves the margins as they are. Less than the page height minus `margins.bottom`.
   * Default: 0.
   */
  reserve?: number;
  /** Draws the header of one page: `ctx` is the document, on that page; `numbers` its number and the page count. */
  draw: (ctx: DrawingContext, numbers: PageNumbers) => void;
}

/**
 * Options of `pageHeader`, discriminated by `variant`: `plain` (the default) or `custom`. The options of the other
 * variant throw an `InvalidOptionError` at the call.
 */
export type PageHeaderOptions = PlainPageHeaderOptions | CustomPageHeaderOptions;

/** The running footer the library draws: two labels and a logo under a rule. */
export interface PlainPageFooterOptions {
  /** A footer drawn by the library from the options below. Default: `'plain'`. */
  variant?: 'plain';
  /**
   * Left label. `{page}` and `{pages}` stand for the printed page number and the page count, e.g.
   * `'{page}/{pages}'`. Declaring a footer replaces the default one (`{ right: '{page}/{pages}' }`): print the page
   * numbers with these tokens.
   */
  left?: string;
  /** Right label, same tokens as `left`. */
  right?: string;
  /**
   * Logo centered between the labels: a name given to `registerImage`, or image data. Default:
   * `theme.assets.footerLogo`.
   */
  logo?: string;
  /** Rule over the footer. Default: `true`. */
  rule?: boolean;
}

/** A running footer drawn by your callback: see `PDFDocument.pageFooter`. */
export interface CustomPageFooterOptions {
  /** A footer drawn by `draw` on every numbered page. */
  variant: 'custom';
  /** Draws the footer of one page: `ctx` is the document, on that page; `numbers` its number and the page count. */
  draw: (ctx: DrawingContext, numbers: PageNumbers) => void;
}

/**
 * Options of `pageFooter`, discriminated by `variant`: `plain` (the default) or `custom`. The options of the other
 * variant throw an `InvalidOptionError` at the call.
 */
export type PageFooterOptions = PlainPageFooterOptions | CustomPageFooterOptions;

/** The options each variant takes besides `variant`: another variant's options are rejected, not ignored. */
const HEADER_VARIANTS = { plain: ['title', 'folio'], custom: ['reserve', 'draw'] };
const FOOTER_VARIANTS = { plain: ['left', 'right', 'logo', 'rule'], custom: ['draw'] };

/**
 * Throws an `InvalidOptionError` for `pageHeader` options of the wrong type or of another variant, when the header is
 * declared: it is drawn by `finalize()`, long after the call. A `reserve` must leave room for content on the page.
 */
export function checkPageHeader(ctx: DrawingContext, options: PageHeaderOptions): void {
  checkedObject('pageHeader options', options);
  checkedVariant('pageHeader', options, HEADER_VARIANTS, 'plain');
  if (options.variant === 'custom') {
    optionalNumber('pageHeader reserve', options.reserve, {
      min: 0,
      exclusiveMax: ctx.pageHeight - ctx.margins.bottom,
    });
    return;
  }
  optionalText('pageHeader title', options.title);
  optionalBoolean('pageHeader folio', options.folio);
}

/** `checkPageHeader` for `pageFooter`, which also takes `false`. */
export function checkPageFooter(options: PageFooterOptions | false): void {
  if (options === false) return;
  checkedObject('pageFooter options', options, 'false');
  checkedVariant('pageFooter', options, FOOTER_VARIANTS, 'plain');
  if (options.variant === 'custom') return;
  optionalText('pageFooter left', options.left);
  optionalText('pageFooter right', options.right);
  optionalText('pageFooter logo', options.logo);
  optionalBoolean('pageFooter rule', options.rule);
}

/** The top margin (mm) a declared header needs. */
export function headerReserve(options: PageHeaderOptions): number {
  return options.variant === 'custom' ? (options.reserve ?? 0) : CHROME.header.reserve;
}

/** Footer `finalize()` draws when none is declared. */
export const DEFAULT_PAGE_FOOTER: PlainPageFooterOptions = { right: '{page}/{pages}' };

/**
 * Runs `draw` on every numbered page, each call in a drawing state of its own, from the `body` text style and the fill
 * jsPDF reports, as the `onNewPage` hook does. jsPDF goes back to the page it was on, also when `draw` throws.
 */
function drawCustomChrome(
  ctx: DrawingContext,
  draw: (ctx: DrawingContext, numbers: PageNumbers) => void,
  labels: Map<number, number>,
): void {
  const { doc } = ctx;
  const current = ctx.pageNumber;
  const pages = labels.size;
  try {
    for (const [page, pageLabel] of labels) {
      doc.setPage(page);
      withDrawingState(ctx, () => {
        // A page drawn earlier may have another fill in force than the one jsPDF reports.
        restateFillColor(doc);
        setTextStyle(ctx, 'body');
        draw(ctx, { page: pageLabel, pages });
      });
    }
  } finally {
    doc.setPage(current);
  }
}

const TOKEN = /(\{pages\}|\{page\})/;

function caps(ctx: DrawingContext, value: string): string {
  const normalized = normalizeText(value);
  return (ctx.theme.chrome.uppercase ?? true) ? normalized.toUpperCase() : normalized;
}

/** Style of the running title and footer labels: label font, bold, footer size, tracked. */
function chromeStyle(ctx: DrawingContext, color: string): TextStyle {
  const { chrome } = ctx.theme;
  return {
    ...resolveTextStyle(ctx, 'label'),
    size: textLevelSize(ctx, 'footer'),
    color,
    charSpace: chrome.tracking ?? CHROME.tracking,
  };
}

/** A label template, split once: without a page token the label is the same on every page. */
type Label = (page: number, pages: number) => string;

function compileLabel(ctx: DrawingContext, value: string): Label {
  const parts = value.split(TOKEN).map((part) => (TOKEN.test(part) ? part : caps(ctx, part)));
  if (parts.length === 1) return () => parts[0];
  return (page, pages) => parts.map((part) => (part === '{page}' ? page : part === '{pages}' ? pages : part)).join('');
}

/** Width of a label on the last page, where the page tokens are widest. */
function labelWidth(ctx: DrawingContext, label: Label | undefined, style: TextStyle, pages: number): number {
  if (!label) return 0;
  applyFont(ctx.doc, style);
  return trackedWidth(ctx.doc, label(pages, pages), style.charSpace);
}

function drawRule(ctx: DrawingContext, y: number): void {
  const { doc } = ctx;
  const margin = ctx.margins.left;
  doc.setDrawColor(ctx.theme.colors.border);
  doc.setLineWidth(LINE_WIDTH.normal);
  doc.line(margin, y, margin + ctx.contentWidth, y);
}

function folioOf(pageLabel: number): string {
  return String(pageLabel).padStart(2, '0');
}

export function drawPageHeader(ctx: DrawingContext, options: PageHeaderOptions, labels: Map<number, number>): void {
  if (options.variant === 'custom') drawCustomChrome(ctx, options.draw, labels);
  else drawPlainPageHeader(ctx, options, labels);
}

function drawPlainPageHeader(ctx: DrawingContext, options: PlainPageHeaderOptions, labels: Map<number, number>): void {
  const { doc, theme } = ctx;
  const margin = ctx.margins.left;
  const contentRight = margin + ctx.contentWidth;
  const { baselineFromTop, ruleFromTop, titleGap } = CHROME.header;

  withDrawingState(ctx, () => {
    const titleStyle = chromeStyle(ctx, theme.colors.secondary);
    // The folio is not tracked.
    const folioStyle = { ...titleStyle, color: theme.colors.primary, charSpace: 0 };
    // Measured once, with the widest page number, so the title is the same on every page.
    let title = options.title ? caps(ctx, options.title) : undefined;
    if (title) {
      applyFont(doc, titleStyle);
      const folioWidth = options.folio ? doc.getTextWidth(folioOf(Math.max(...labels.values()))) + titleGap : 0;
      title = fitWithEllipsis(ctx, title, ctx.contentWidth - folioWidth, titleStyle.charSpace);
    }

    for (const [page, pageLabel] of labels) {
      doc.setPage(page);

      if (title) {
        applyTextStyle(doc, titleStyle);
        text(ctx, title, margin, baselineFromTop, { charSpace: titleStyle.charSpace });
      }
      if (options.folio) {
        applyTextStyle(doc, folioStyle);
        text(ctx, folioOf(pageLabel), contentRight, baselineFromTop, { align: 'right' });
      }

      drawRule(ctx, ruleFromTop);
    }
  });
}

/**
 * Resolves the logo once for all pages: its width is capped to the gutter left between the two labels, its height
 * follows the image ratio. `undefined` when there is no logo, it cannot be read, or no room is left.
 */
function resolveLogo(
  ctx: DrawingContext,
  options: PlainPageFooterOptions,
  labels: { left?: Label; right?: Label },
  labelStyle: TextStyle,
  ruleY: number,
  pages: number,
) {
  const image = options.logo ?? ctx.theme.assets.footerLogo;
  if (!image) return undefined;
  const { bandTopGap, bandHeight, logoSideGap } = CHROME.footer;

  try {
    const embedded = ctx.images.get(image);
    const side = Math.max(
      labelWidth(ctx, labels.left, labelStyle, pages),
      labelWidth(ctx, labels.right, labelStyle, pages),
    );
    const gutter = ctx.contentWidth - 2 * side - 2 * logoSideGap;
    const natural = scaledSize(embedded, { height: bandHeight });
    const scale = Math.min(1, gutter / natural.width);
    if (scale <= 0) {
      ctx.addWarning('Failed to draw footer logo: the footer labels leave no room for it');
      return undefined;
    }
    const width = natural.width * scale;
    const height = natural.height * scale;
    return {
      embedded,
      x: ctx.margins.left + (ctx.contentWidth - width) / 2,
      y: ruleY + bandTopGap + (bandHeight - height) / 2,
      width,
      height,
    };
  } catch (error) {
    ctx.addWarning(`Failed to draw footer logo: ${errorMessage(error)}`);
    return undefined;
  }
}

export function drawPageFooter(ctx: DrawingContext, options: PageFooterOptions, labels: Map<number, number>): void {
  if (options.variant === 'custom') drawCustomChrome(ctx, options.draw, labels);
  else drawPlainPageFooter(ctx, options, labels);
}

function drawPlainPageFooter(
  ctx: DrawingContext,
  options: PlainPageFooterOptions,
  pageLabels: Map<number, number>,
): void {
  const { doc, theme } = ctx;
  const margin = ctx.margins.left;
  const contentRight = margin + ctx.contentWidth;
  const pages = pageLabels.size;
  const { ruleBelowContent, bandTopGap, bandHeight } = CHROME.footer;
  const fontSize = textLevelSize(ctx, 'footer');
  const labels = {
    left: options.left ? compileLabel(ctx, options.left) : undefined,
    right: options.right ? compileLabel(ctx, options.right) : undefined,
  };

  // A zone shorter than the footer would push the labels off the page: the footer then overlaps the content.
  const ruleY = ctx.pageHeight - Math.max(ctx.margins.bottom, CHROME.footer.minHeight) + ruleBelowContent;
  // Labels are centred on the band, like the logo.
  const textY = ruleY + bandTopGap + bandHeight / 2 + capitalMiddle(fontSize);

  withDrawingState(ctx, () => {
    const labelStyle = chromeStyle(ctx, theme.colors.secondary);
    const { charSpace } = labelStyle;
    const logo = resolveLogo(ctx, options, labels, labelStyle, ruleY, pages);

    for (const [page, pageLabel] of pageLabels) {
      doc.setPage(page);
      if (options.rule !== false) drawRule(ctx, ruleY);

      applyTextStyle(doc, labelStyle);
      if (labels.left) text(ctx, labels.left(pageLabel, pages), margin, textY, { charSpace });
      if (labels.right) {
        text(ctx, labels.right(pageLabel, pages), contentRight, textY, { align: 'right', charSpace });
      }
      if (logo) addCachedImage(ctx, logo.embedded, logo.x, logo.y, logo.width, logo.height);
    }
  });
}
