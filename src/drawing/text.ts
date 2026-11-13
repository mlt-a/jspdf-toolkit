import type { HeadingLevel, TextLevel } from '../core/constants';
import { HEADING, HEADING_LEVELS, LINE_WIDTH, ascentMm, descentMm, lineHeightMm } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  POSITIVE,
  checkedChoice,
  checkedText,
  checkedTexts,
  optionalBoolean,
  optionalChoice,
  optionalNumber,
  optionalText,
} from '../core/errors';
import type { TocEntry } from '../core/page-references';
import { resolveFace } from '../fonts/resolve';
import { resolveColor } from '../theme/colors';
import type { ColorInput, ColorPalette, Typography, TypographySizes } from '../theme/types';
import { withDrawingState } from './drawing-state';
import {
  drawJustifiedLine,
  drawLines,
  fitLineWidth,
  remainingTextWidth,
  resolveLineWidth,
  text as drawText,
  wrap,
  wrapLine,
} from './text-lines';
import type { LineFrame } from './text-lines';
import type { FontRole, TextStyle } from './text-style';
import { applyFont, applyTextStyle, fontFace, fontFamilyFor } from './text-style';

export type { HeadingLevel, TextLevel };

/** Table of contents level of a heading: its rank among the heading levels. */
const tocLevel = (level: HeadingLevel) => (HEADING_LEVELS.indexOf(level) + 1) as TocEntry['level'];

/** Vertical metrics (mm) of a text level. */
export interface TextLevelMetrics {
  /** Distance between two baselines. */
  lineHeight: number;
  /** Distance from the top of a line to its baseline. */
  ascent: number;
  /** Depth of the descenders below the baseline. */
  descent: number;
}

type TextStyleConfig = {
  fontRole: FontRole;
  weight: keyof Typography['weights'];
  italic?: boolean;
  color: keyof ColorPalette;
  /** The `typography.sizes` entry the level reads: a derived level shares its base level's. */
  size: keyof TypographySizes;
};

const TEXT_STYLE_MAP: Record<TextLevel, TextStyleConfig> = {
  h1: { fontRole: 'title', weight: 'bold', color: 'text', size: 'h1' },
  h2: { fontRole: 'title', weight: 'bold', color: 'primary', size: 'h2' },
  h3: { fontRole: 'body', weight: 'bold', color: 'text', size: 'h3' },
  h4: { fontRole: 'body', weight: 'bold', color: 'secondary', size: 'h4' },
  body: { fontRole: 'body', weight: 'regular', color: 'text', size: 'body' },
  bodyBold: { fontRole: 'body', weight: 'bold', color: 'text', size: 'body' },
  small: { fontRole: 'body', weight: 'regular', color: 'text', size: 'small' },
  smallMuted: { fontRole: 'body', weight: 'regular', color: 'secondary', size: 'small' },
  caption: { fontRole: 'body', weight: 'regular', color: 'subtle', size: 'caption' },
  label: { fontRole: 'label', weight: 'bold', color: 'primary', size: 'label' },
  fieldLabel: { fontRole: 'label', weight: 'bold', color: 'secondary', size: 'fieldLabel' },
  fieldValue: { fontRole: 'body', weight: 'regular', color: 'text', size: 'fieldValue' },
  footer: { fontRole: 'body', weight: 'regular', color: 'subtle', size: 'footer' },
  italic: { fontRole: 'body', weight: 'regular', italic: true, color: 'secondary', size: 'small' },
};

const TEXT_LEVELS = Object.keys(TEXT_STYLE_MAP) as TextLevel[];

/** The `level` argument of `what`, checked: a text level, else an `InvalidOptionError`. */
function checkedLevel(what: string, level: unknown): TextLevel {
  return checkedChoice(`${what} level`, level, TEXT_LEVELS);
}

/** The optional `level` option of the block `what`, checked: a text level, or `undefined`. */
export function optionalLevel(what: string, level: unknown): TextLevel | undefined {
  return optionalChoice(`${what} level`, level, TEXT_LEVELS);
}

/** Font size (pt) of a text level in the document theme. */
export function textLevelSize(ctx: DrawingContext, level: TextLevel): number {
  return ctx.theme.typography.sizes[TEXT_STYLE_MAP[level].size];
}

/**
 * Text color of a level: the one `theme.typography.levels` gives it, else `fallback`, else the built-in one. A block
 * that sets a level in a color of its own (a muted label, an accent) passes that color as `fallback`: the color the
 * theme chose for the level still wins, so restyling a level reaches every block set in it.
 */
export function levelColor(ctx: DrawingContext, level: TextLevel, fallback?: ColorInput): string {
  const custom = ctx.theme.typography.levels?.[level]?.color;
  return resolveColor(ctx.theme, custom ?? fallback ?? TEXT_STYLE_MAP[level].color);
}

/**
 * Applies the font, size and color of a text level to the jsPDF instance. Throws an `InvalidOptionError` for a level
 * that is no text level.
 *
 * @example
 * ```ts
 * import { setTextStyle } from '@mlt-a/jspdf-toolkit';
 *
 * setTextStyle(doc, 'label'); // font, size and color of the level
 * doc.doc.text('Custom label', doc.margins.left, doc.getYPos() + 4);
 * ```
 */
export function setTextStyle(ctx: DrawingContext, level: TextLevel): void {
  applyTextStyle(ctx.doc, resolveTextStyle(ctx, checkedLevel('setTextStyle', level)));
}

/** One cache per document: the theme of a document never changes. */
const styleCaches = new WeakMap<DrawingContext, Map<string, ResolvedStyle>>();

/** A resolved style and the warnings its face fallback raised, raised again on every reuse. */
interface ResolvedStyle {
  style: Readonly<TextStyle>;
  warnings: string[];
}

function styleCache(ctx: DrawingContext): Map<string, ResolvedStyle> {
  let cache = styleCaches.get(ctx);
  if (cache === undefined) {
    const created = new Map<string, ResolvedStyle>();
    // A face registered later changes the fallback a style resolved to.
    ctx.doc.internal.events.subscribe('addFont', () => created.clear());
    styleCaches.set(ctx, created);
    cache = created;
  }
  return cache;
}

/**
 * Resolved style of a text level, with optional emphasis over the level's own weight and slant: `true` or `false`
 * wins over the level (`bold` on `italic` gives bold italic, or italic when the theme maps bold to the regular face),
 * `undefined` lets the level decide. The level is the built-in one with what `theme.typography.levels` changes on it;
 * its size comes from `typography.sizes`. Resolved once per document, level and emphasis: callers spread it to change a
 * field, never write to it.
 */
export function resolveTextStyle(
  ctx: DrawingContext,
  level: TextLevel,
  emphasis?: { bold?: boolean | undefined; italic?: boolean | undefined },
): Readonly<TextStyle> {
  const bold = emphasis?.bold;
  const italic = emphasis?.italic;
  const cache = styleCache(ctx);
  // `undefined` and `false` are different requests: the first leaves the level alone, the second removes its emphasis.
  const key = `${level}/${String(bold)}/${String(italic)}`;
  let resolved = cache.get(key);
  if (resolved === undefined) {
    const warnings: string[] = [];
    const style = computeTextStyle(ctx, level, bold, italic, (message) => warnings.push(message));
    resolved = { style, warnings };
    cache.set(key, resolved);
  }
  // A measuring pass of `keepTogether` rolls its warnings back: the pass that draws must raise them again.
  for (const message of resolved.warnings) ctx.addWarning(message);
  return resolved.style;
}

function computeTextStyle(
  ctx: DrawingContext,
  level: TextLevel,
  emphasisBold: boolean | undefined,
  emphasisItalic: boolean | undefined,
  onWarn: (message: string) => void,
): TextStyle {
  const { typography } = ctx.theme;
  const config = TEXT_STYLE_MAP[level];
  const custom = typography.levels?.[level];
  const family = fontFamilyFor(ctx, custom?.font ?? config.fontRole);
  const bold = emphasisBold ?? custom?.bold ?? config.weight === 'bold';
  const italic = emphasisItalic ?? custom?.italic ?? config.italic === true;
  return Object.freeze({
    family,
    fontStyle: resolveFace(ctx.doc, family, fontFace(typography, bold, italic), onWarn),
    size: textLevelSize(ctx, level),
    color: levelColor(ctx, level),
  });
}

/** Options of `measureTextLevel`. */
export interface MeasureTextLevelOptions {
  /** Multiplies the line height: a finite number above 0. Default: 1. */
  lineHeightScale?: number;
}

/**
 * Line height and ascent (mm) of a text level, from its own font size. Throws an `InvalidOptionError` for a level
 * that is no text level, or a `lineHeightScale` that is not a finite number above 0.
 *
 * @example
 * ```ts
 * import { measureTextLevel } from '@mlt-a/jspdf-toolkit';
 *
 * const { lineHeight, ascent } = measureTextLevel(doc, 'body');
 * const y = doc.getYPos();
 * doc.doc.text('On the first baseline', doc.margins.left, y + ascent);
 * doc.endBlock(y + lineHeight, doc.theme.spacing.block);
 * ```
 */
export function measureTextLevel(
  ctx: DrawingContext,
  level: TextLevel,
  options?: MeasureTextLevelOptions,
): TextLevelMetrics {
  const { typography } = ctx.theme;
  const size = textLevelSize(ctx, checkedLevel('measureTextLevel', level));
  const scale = optionalNumber('lineHeightScale', options?.lineHeightScale, POSITIVE);
  return {
    lineHeight: lineHeightMm(size, typography.lineHeightFactor, scale),
    ascent: ascentMm(size),
    descent: descentMm(size),
  };
}

/** Options of `heading`. */
export interface HeadingOptions {
  /** Heading level: `'h1'` (a page title) to `'h4'` (the smallest). Default: `'h1'`. */
  level?: HeadingLevel;
  /**
   * Space (mm) above the heading. It collapses with the space the previous block left under it: the larger of the
   * two separates them. None at the top of a page. Default: `theme.spacing.heading[level].before`.
   */
  spaceBefore?: number;
  /** Space (mm) under the heading. Default: `theme.spacing.heading[level].after`. */
  spaceAfter?: number;
  /**
   * Section number drawn before the title in the primary color, e.g. `'2.1'`, on its first line: the lines of a long
   * title align after it. Listed in the table of contents. A number that leaves the title no width throws an
   * `InvalidOptionError`.
   */
  number?: string;
  /** Rule under the heading, across the reading column, in the primary color. */
  rule?: boolean;
  /**
   * Keeps the heading with the block that follows it, so a heading never ends a page alone: `doc.heading()` waits
   * for the next block and moves to the next page with its first line or row when both do not fit. Consecutive
   * headings wait together. `false` draws the heading at once. Default: `true`.
   */
  keepWithNext?: boolean;
  /**
   * Lists the heading in the table of contents (`true`) or leaves it out (`false`), whatever the table `depth`. Default:
   * listed when its level is within the table `depth`.
   */
  toc?: boolean;
}

const DEFAULT_HEADING_LEVEL: HeadingLevel = 'h1';

/**
 * `HeadingOptions` with the level and the space above filled in with their defaults. `spaceAfter` stays as the caller
 * gave it, which tells a chosen space from the default; `resolvedSpaceAfter` is the space under the heading.
 */
export type ResolvedHeadingOptions = HeadingOptions &
  Required<Pick<HeadingOptions, 'level' | 'spaceBefore'>> & { resolvedSpaceAfter: number };

/**
 * Throws an `InvalidOptionError` for an option of the wrong type (a `level` that is no heading level, a `number` that
 * is no text, a flag that is no boolean, a `spaceBefore` or `spaceAfter` that is not a finite number): `doc.heading()`
 * calls it before the heading waits for the next block.
 */
export function resolveHeadingOptions(ctx: DrawingContext, options?: HeadingOptions): ResolvedHeadingOptions {
  const level = optionalChoice('heading level', options?.level, HEADING_LEVELS) ?? DEFAULT_HEADING_LEVEL;
  optionalText('heading number', options?.number);
  optionalBoolean('heading rule', options?.rule);
  optionalBoolean('heading keepWithNext', options?.keepWithNext);
  optionalBoolean('heading toc', options?.toc);
  const { before, after } = ctx.theme.spacing.heading[level];
  const spaceBefore = optionalNumber('spaceBefore (mm)', options?.spaceBefore) ?? before;
  return { ...options, level, spaceBefore, resolvedSpaceAfter: ctx.resolveSpaceAfter(options?.spaceAfter, after) };
}

/** A heading laid out in the reading column: its title lines, after the number. */
interface HeadingLayout {
  lines: string[];
  /** Offset (mm) of the title from the left margin: the number and its gap. */
  titleOffset: number;
  lineHeight: number;
  ascent: number;
  /** Height (mm) of the lines and the rule, without the space around them. */
  height: number;
}

/**
 * Single source of layout for `headingHeight` and `drawHeading`: the title wraps to the reading column, beside the
 * number. Throws an `InvalidOptionError` for a number that leaves the title no width.
 */
function layoutHeading(ctx: DrawingContext, text: string, options: HeadingOptions | undefined): HeadingLayout {
  const level = options?.level ?? DEFAULT_HEADING_LEVEL;
  const { lineHeight, ascent, descent } = measureTextLevel(ctx, level);
  return withDrawingState(ctx, () => {
    // The number is set in the title face: measured in it.
    applyFont(ctx.doc, resolveTextStyle(ctx, level));
    const number = options?.number;
    const titleOffset = number === undefined ? 0 : ctx.doc.getTextWidth(number) + HEADING.numberGap;
    const lines = wrap(ctx, text, remainingTextWidth('a heading', ctx.measure, titleOffset));
    // The rule sits `ruleGap` under the descenders of the last line, whatever the line height.
    const height =
      options?.rule === true
        ? (lines.length - 1) * lineHeight + ascent + descent + HEADING.ruleGap
        : lines.length * lineHeight;
    return { lines, titleOffset, lineHeight, ascent, height };
  });
}

/** Height (mm) of a heading, its title wrapped to the reading column, and its rule, without the space around it. */
export function headingHeight(ctx: DrawingContext, text: string, options?: HeadingOptions): number {
  return layoutHeading(ctx, text, options).height;
}

/**
 * Draws a heading at once: the page breaks first when it does not fit with its `spaceBefore`, then `beginBlock` adds
 * that space. `doc.heading()` draws through it once the heading stops waiting for the next block. Expects no heading
 * waiting: its space above is measured from the block above it. The title wraps to the reading column; the number
 * stands on its first line, the rule under its last.
 */
export function drawHeading(ctx: DrawingContext, text: string, options?: HeadingOptions): number {
  const { doc, theme } = ctx;
  const margin = ctx.margins.left;
  const resolved = resolveHeadingOptions(ctx, options);
  const { level, spaceBefore, resolvedSpaceAfter } = resolved;
  const number = options?.number;
  const rule = options?.rule === true;
  const layout = layoutHeading(ctx, text, resolved);
  const { lines, lineHeight, ascent, height } = layout;

  // As the waiting headings measure it (`chainHeight`).
  ctx.ensureSpace(ctx.spaceAbove(spaceBefore) + height + resolvedSpaceAfter);
  const currentY = ctx.beginBlock(spaceBefore);
  // After the page break, so the entry points to the page the heading lands on. It keeps the whole title.
  if (options?.toc !== false) {
    ctx.pageRefs.registerTocEntry({
      level: tocLevel(level),
      label: text,
      number,
      toc: options?.toc,
      page: ctx.pageNumber,
      y: currentY,
    });
  }

  withDrawingState(ctx, () => {
    const style = resolveTextStyle(ctx, level);
    const baseline = currentY + ascent;
    if (number !== undefined) {
      applyTextStyle(doc, { ...style, color: theme.colors.primary });
      drawText(ctx, number, margin, baseline);
    }
    // The accent moves to the number or the rule: the title turns to ink, unless the theme colors its level.
    const accented = number !== undefined || rule;
    applyTextStyle(doc, accented ? { ...style, color: levelColor(ctx, level, 'text') } : style);
    drawLines(ctx, lines, margin + layout.titleOffset, baseline, lineHeight);

    if (rule) {
      const ruleY = currentY + height;
      doc.setDrawColor(theme.colors.primary);
      doc.setLineWidth(LINE_WIDTH.normal);
      doc.line(margin, ruleY, margin + ctx.measure, ruleY);
    }
  });

  // A badge may attach to it.
  return ctx.endBlock(currentY + height, options?.spaceAfter, { kind: 'heading', fallback: resolvedSpaceAfter });
}

/** Options of `paragraph`. */
export interface ParagraphOptions {
  /** Text level of the paragraph. Default: `'body'`. */
  level?: TextLevel;
  /** Indent (mm) from the left margin. Default: 0. */
  indent?: number;
  /**
   * Line width (mm), above 0. Wider than the available width (the content width less `indent`): brought down to it, with a warning. Default:
   * the document `measure` minus `indent`.
   */
  maxWidth?: number;
  /** `justify` stretches every line but the last one of each source line. Default: `left`. */
  align?: 'justify' | 'left';
  /** Multiplies the line height. Default: 1. */
  lineHeightScale?: number;
  /** Space (mm) after the paragraph. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

/** The alignments of a paragraph or of rich text. */
export const ALIGNMENTS = ['justify', 'left'] as const;

/** The options of a paragraph checked, before the text is looked at: an invalid one throws even on an empty text. */
interface ParagraphFrame {
  line: LineFrame;
  lineHeight: number;
  ascent: number;
  spaceAfter: number;
}

function paragraphFrame(ctx: DrawingContext, options?: ParagraphOptions): ParagraphFrame {
  optionalLevel('paragraph', options?.level);
  optionalChoice('paragraph align', options?.align, ALIGNMENTS);
  const line = resolveLineWidth(ctx, 'paragraph', options);
  const { lineHeight, ascent } = measureTextLevel(ctx, options?.level ?? 'body', options);
  return { line, lineHeight, ascent, spaceAfter: ctx.resolveSpaceAfter(options?.spaceAfter) };
}

/** Wrapped lines of a paragraph, and where they go. Shared by `drawParagraph` and `computeParagraphHeight`. */
interface ParagraphLayout {
  x: number;
  maxWidth: number;
  lineHeight: number;
  ascent: number;
  /** Each source line is wrapped on its own, so justification knows which lines end a paragraph. */
  lines: Array<{ line: string; last: boolean }>;
}

/** Sets the level style, which the drawing keeps. */
function layoutParagraph(
  ctx: DrawingContext,
  text: string,
  frame: ParagraphFrame,
  options?: ParagraphOptions,
): ParagraphLayout {
  const { lineHeight, ascent } = frame;
  const maxWidth = fitLineWidth(ctx, 'paragraph', frame.line);
  setTextStyle(ctx, options?.level ?? 'body');
  const lines = text.split(/\r?\n/).flatMap((source) => {
    const wrapped = wrapLine(ctx, source, maxWidth);
    return wrapped.map((line, index) => ({ line, last: index === wrapped.length - 1 }));
  });
  return { x: ctx.margins.left + frame.line.indent, maxWidth, lineHeight, ascent, lines };
}

export function drawParagraph(ctx: DrawingContext, text: string, options?: ParagraphOptions): number {
  const frame = paragraphFrame(ctx, options);
  checkedText('paragraph text', text);
  if (text === '') return ctx.peekYPos();
  return withDrawingState(ctx, () => {
    const level = options?.level ?? 'body';
    const align = options?.align ?? 'left';
    const { x, maxWidth, lineHeight, ascent, lines } = layoutParagraph(ctx, text, frame, options);

    lines.forEach(({ line, last }) => {
      const pageBreak = ctx.ensureSpace(lineHeight);
      if (pageBreak) setTextStyle(ctx, level);

      const y = ctx.getYPos();
      // The last line of a paragraph stays ragged, as in any justified setting.
      if (align === 'justify' && !last) {
        drawJustifiedLine(ctx, line, x, y + ascent, maxWidth);
      } else {
        drawText(ctx, line, x, y + ascent);
      }
      ctx.setYPos(y + lineHeight);
    });

    return ctx.endBlock(ctx.getYPos(), frame.spaceAfter);
  });
}

/**
 * Height (mm) `doc.paragraph()` takes on one page, `spaceAfter` excluded.
 *
 * @example
 * ```ts
 * import { computeParagraphHeight } from '@mlt-a/jspdf-toolkit';
 *
 * const height = computeParagraphHeight(doc, longText, { level: 'small' });
 * if (height > 60) doc.addPage();
 * doc.paragraph(longText, { level: 'small' });
 * ```
 */
export function computeParagraphHeight(ctx: DrawingContext, text: string, options?: ParagraphOptions): number {
  const frame = paragraphFrame(ctx, options);
  checkedText('paragraph text', text);
  if (text === '') return 0;
  return withDrawingState(ctx, () => {
    const { lines, lineHeight } = layoutParagraph(ctx, text, frame, options);
    return lines.length * lineHeight;
  });
}

/** Options of `paragraphs`. */
export interface ParagraphsOptions extends ParagraphOptions {
  /** Space (mm) between two paragraphs: 0 or more. Default: `theme.spacing.block`. */
  itemSpacing?: number;
}

export function drawParagraphs(ctx: DrawingContext, paragraphs: string[], options?: ParagraphsOptions): number {
  // Checked before the texts: an invalid option throws even when every text is empty.
  paragraphFrame(ctx, options);
  optionalNumber('paragraphs itemSpacing (mm)', options?.itemSpacing, { min: 0 });
  checkedTexts('paragraphs texts', paragraphs);
  // An empty text draws nothing: it must not take the place of the last paragraph, which carries `spaceAfter`.
  const drawn = paragraphs.filter((paragraph) => paragraph !== '');
  drawn.forEach((paragraph, index) => {
    const isLast = index === drawn.length - 1;
    drawParagraph(ctx, paragraph, isLast ? options : { ...options, spaceAfter: options?.itemSpacing });
  });
  // `peekYPos`: without a paragraph drawn, a waiting heading keeps waiting.
  return ctx.peekYPos();
}
