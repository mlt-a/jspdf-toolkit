import { CHROME, LINE_WIDTH, capitalMiddle } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { checkedObject, optionalBoolean, optionalText } from '../core/errors';
import { withDrawingState } from '../drawing/drawing-state';
import { addCachedImage, scaledSize } from '../drawing/image-helpers';
import { resolveTextStyle, textLevelSize } from '../drawing/text';
import { fitWithEllipsis, normalizeText, text, trackedWidth } from '../drawing/text-lines';
import type { TextStyle } from '../drawing/text-style';
import { applyFont, applyTextStyle } from '../drawing/text-style';
import { errorMessage } from '../utils/errors';

/** Running header and footer: declared once, drawn by `finalize()` on the numbered pages (`pageLabels`). */

export interface PageHeaderOptions {
  /** Running title, left-aligned. Cut short with "…" when it would run into the page number or past the margin. */
  title?: string;
  /**
   * Page number, right-aligned, in the primary color: the number printed in the footer, on two digits at least (`01`).
   * Default: `false`.
   */
  folio?: boolean;
}

/** Options of `pageFooter`. */
export interface PageFooterOptions {
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

/**
 * Throws an `InvalidOptionError` for `pageHeader` options of the wrong type, when the header is declared: it is drawn
 * by `finalize()`, long after the call.
 */
export function checkPageHeader(options: PageHeaderOptions): void {
  checkedObject('pageHeader options', options);
  optionalText('pageHeader title', options.title);
  optionalBoolean('pageHeader folio', options.folio);
}

/** `checkPageHeader` for `pageFooter`, which also takes `false`. */
export function checkPageFooter(options: PageFooterOptions | false): void {
  if (options === false) return;
  checkedObject('pageFooter options', options, 'false');
  optionalText('pageFooter left', options.left);
  optionalText('pageFooter right', options.right);
  optionalText('pageFooter logo', options.logo);
  optionalBoolean('pageFooter rule', options.rule);
}

/** Footer `finalize()` draws when none is declared. */
export const DEFAULT_PAGE_FOOTER: PageFooterOptions = { right: '{page}/{pages}' };

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
  options: PageFooterOptions,
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

export function drawPageFooter(ctx: DrawingContext, options: PageFooterOptions, pageLabels: Map<number, number>): void {
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
