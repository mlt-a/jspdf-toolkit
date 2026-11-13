import { BOX, CALLOUT, INFOBOX, ICONS, LINE_WIDTH, LIST, centerOnCapitals } from '../core/constants';
import type { TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  checkedBox,
  checkedChoice,
  checkedLeftOut,
  checkedObject,
  checkedText,
  checkedTexts,
  optionalBoolean,
  optionalChoice,
  optionalNumber,
  optionalText,
} from '../core/errors';
import { withDrawingState } from './drawing-state';
import { drawIcon } from './image-helpers';
import type { FlowLayout, FlowPrefix, FlowRun } from './rich';
import { drawFlow, layoutFlow } from './rich';
import { levelColor, measureTextLevel, resolveTextStyle } from './text';
import type { TextLevelMetrics } from './text';
import { normalizeText, remainingTextWidth, text, wrap } from './text-lines';
import type { TextStyle } from './text-style';
import { applyFont, applyTextStyle } from './text-style';

/** Fill and border of a box, each mapped to palette tokens. */
export type BoxStylePreset = 'tint' | 'tintSolid' | 'border' | 'background' | 'surface' | 'surfaceBorder';

/** Options of `drawBox`: position and size in mm. */
export interface BoxOptions {
  /** Left edge (mm), from the left of the page. */
  x: number;
  /** Top edge (mm), from the top of the page. */
  y: number;
  /** Width (mm). */
  width: number;
  /** Height (mm). */
  height: number;
  /** Fill and border preset. */
  boxStyle: BoxStylePreset;
  /** Corner radius (mm). Default: 1. */
  radius?: number;
}

const BOX_STYLES = [
  'tint',
  'tintSolid',
  'border',
  'background',
  'surface',
  'surfaceBorder',
] as const satisfies readonly BoxStylePreset[];

/** The `boxStyle` of a block `what`, checked: a preset, or `undefined`. */
export function optionalBoxStyle(what: string, boxStyle: unknown): BoxStylePreset | undefined {
  return optionalChoice(`${what} boxStyle`, boxStyle, BOX_STYLES);
}

/**
 * Draws a styled box, `y` at its top. Returns the Y under it.
 *
 * @example
 * ```ts
 * import { drawBox } from '@mlt-a/jspdf-toolkit';
 *
 * const y = doc.getYPos();
 * drawBox(doc, { x: doc.margins.left, y, width: 80, height: 20, boxStyle: 'tint' });
 * ```
 */
export function drawBox(ctx: DrawingContext, options: BoxOptions): number {
  return withDrawingState(ctx, () => paintBox(ctx, options));
}

function paintBox(ctx: DrawingContext, options: BoxOptions): number {
  const { doc, theme } = ctx;
  const { x, y, width, height } = checkedBox('drawBox', options);
  const boxStyle = checkedChoice('drawBox boxStyle', options.boxStyle, BOX_STYLES);
  const radius = optionalNumber('drawBox radius (mm)', options.radius, { min: 0 }) ?? BOX.radius;
  const { colors } = theme;

  const styleConfigs: Record<
    BoxStylePreset,
    { fill?: string; stroke?: string; lineWidth: number; mode: 'F' | 'S' | 'FD' }
  > = {
    background: {
      fill: colors.background,
      stroke: colors.border,
      lineWidth: LINE_WIDTH.thick,
      mode: 'FD',
    },
    surface: {
      fill: colors.surface,
      stroke: colors.surfaceBorder,
      lineWidth: LINE_WIDTH.normal,
      mode: 'FD',
    },
    tint: {
      fill: colors.tint,
      stroke: colors.tintBorder,
      lineWidth: LINE_WIDTH.normal,
      mode: 'FD',
    },
    tintSolid: {
      fill: colors.tint,
      lineWidth: LINE_WIDTH.normal,
      mode: 'F',
    },
    border: {
      stroke: colors.border,
      lineWidth: LINE_WIDTH.thick,
      mode: 'S',
    },
    surfaceBorder: {
      stroke: colors.surfaceBorder,
      lineWidth: LINE_WIDTH.thick,
      mode: 'S',
    },
  };

  const config = styleConfigs[boxStyle];

  if (config.fill) {
    doc.setFillColor(config.fill);
  }
  if (config.stroke) {
    doc.setDrawColor(config.stroke);
  }
  doc.setLineWidth(config.lineWidth);

  doc.roundedRect(x, y, width, height, radius, radius, config.mode);
  return y + height;
}

/** Shared by the two variants. Fields of the other variant are rejected at compile time, and at runtime with an `InvalidOptionError`. */
export interface InfoBoxCommon {
  /** Bullet items listed under the content, each in `body` behind a bullet. */
  bulletPoints?: string[];
  /** A bullet that starts with one of these strings shows that prefix, and the bullet glyph, in bold. */
  boldPrefixes?: string[];
  /** Space (mm) under the box. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

/** The default variant: a bordered `surface` box with a title line, content and bullets. */
export interface SurfaceInfoBoxOptions extends InfoBoxCommon {
  /** The default variant: a bordered box on the `surface` color, drawn when `variant` is left out. */
  variant?: 'surface';
  /**
   * Title line, in the `label` style. Required by the types; at run time, only a box with an `icon` must have one (the
   * icon sits on the title line).
   */
  title: string;
  /** Icon before the title: a name given to `doc.registerImage`, or image data. The library ships no icon. */
  icon?: string;
  /** A callout shows a small text in capitals above its title; a surface box has none, so this cannot be set (`InvalidOptionError`). */
  eyebrow?: never;
  /** A callout has a colored bar on its left edge; a surface box has a border instead, so this cannot be set (`InvalidOptionError`). */
  accentBar?: never;
}

/**
 * A tinted box without border and an accent bar on the left: an eyebrow in capitals, a bold title, the content
 * and bullets, all optional. Reads as a note set apart from the text.
 */
export interface CalloutInfoBoxOptions extends InfoBoxCommon {
  /** A tinted note with no border, set apart from the text by an accent bar on its left. */
  variant: 'callout';
  /** Short text in capitals above the title. */
  eyebrow?: string;
  /** Title line, in bold body text. */
  title?: string;
  /** Accent bar on the left edge. Default: `true`. */
  accentBar?: boolean;
  /** A surface box shows an icon before its title; a callout has none, so this cannot be set (`InvalidOptionError`). */
  icon?: never;
}

/**
 * Options of `infoBox`, discriminated by `variant`: `surface` (default) or `callout`. The options of the other variant
 * throw an `InvalidOptionError` before anything is drawn.
 */
export type InfoBoxOptions = SurfaceInfoBoxOptions | CalloutInfoBoxOptions;

interface TextBlock {
  lines: string[];
  /** Offset (mm) of the block top from the box top. */
  top: number;
  style: TextStyle;
  lineHeight: number;
  ascent: number;
  /** Offset (mm) of the lines from the text left edge: room for an icon. */
  indent: number;
}

interface InfoBoxLayout {
  /** Total box height, shared by measuring and drawing; `spaceAfter` excluded. */
  height: number;
  /** Space (mm) under the box. */
  spaceAfter: number;
  boxStyle: BoxStylePreset;
  radius: number;
  accentBar: boolean;
  /** Left edge (mm) of the text, from the box left. */
  inset: number;
  eyebrow: TextBlock | null;
  title: TextBlock | null;
  content: TextBlock | null;
  /** Icon before the title, at the title top. */
  icon: string | null;
  /** Bullets with the offset (mm) of their top from the box top. */
  bullets: { flow: FlowLayout; top: number }[];
  /** Ascent (mm) of the bullet text, set in body. */
  bulletAscent: number;
}

/** First prefix that the normalized `bullet` starts with, normalized too. */
function findBoldPrefix(bullet: string, prefixes: string[] | undefined): string | undefined {
  return prefixes?.map(normalizeText).find((prefix) => prefix.length > 0 && bullet.startsWith(prefix));
}

/** A bullet as flow runs behind its bullet: a matching prefix and the bullet in bold, the rest in body. */
function bulletFlow(
  ctx: DrawingContext,
  rawBullet: string,
  prefixes: string[] | undefined,
): { runs: FlowRun[]; prefix: FlowPrefix } {
  // Normalized once, so the prefix search and the split below work on the same string the gateway draws.
  const bullet = normalizeText(rawBullet);
  const body = resolveTextStyle(ctx, 'body');
  const boldPrefix = findBoldPrefix(bullet, prefixes);
  if (boldPrefix === undefined) {
    return {
      runs: [{ text: bullet, style: body }],
      prefix: { text: LIST.bulletChar, style: body, width: LIST.bulletPrefixWidth },
    };
  }
  const bold = resolveTextStyle(ctx, 'bodyBold');
  return {
    runs: [
      { text: boldPrefix, style: bold },
      { text: bullet.substring(boldPrefix.length), style: body },
    ],
    prefix: { text: LIST.bulletChar, style: bold, width: LIST.bulletPrefixWidth },
  };
}

/** What tells the two variants apart; the layout and the drawing are shared. */
interface InfoBoxFrame {
  boxStyle: BoxStylePreset;
  radius: number;
  accentBar: boolean;
  titleLevel: TextLevel;
  /** Title line, `''` when there is none: a surface box always has one, a callout may leave it out. */
  title: string;
  /** Text above the title: callout only. */
  eyebrow: string | undefined;
  /** Icon before the title: surface only. */
  icon: string | null;
}

const VARIANTS = ['surface', 'callout'] as const;

/**
 * Checked at runtime for JavaScript callers: the types make the title of a surface box required, and keep the options
 * of the other variant out.
 */
function infoBoxFrame(options: InfoBoxOptions): InfoBoxFrame {
  checkedObject('infoBox options', options);
  const variant = checkedChoice(
    'infoBox variant',
    options.variant === undefined ? 'surface' : options.variant,
    VARIANTS,
  );
  checkedLeftOut(`infoBox ${variant}`, options, variant === 'callout' ? ['icon'] : ['eyebrow', 'accentBar']);
  if (options.variant === 'callout') {
    return {
      boxStyle: 'tintSolid',
      radius: CALLOUT.radius,
      accentBar: optionalBoolean('infoBox accentBar', options.accentBar) ?? true,
      titleLevel: 'bodyBold',
      title: optionalText('infoBox title', options.title) ?? '',
      eyebrow: optionalText('infoBox eyebrow', options.eyebrow),
      icon: null,
    };
  }
  const icon = optionalText('infoBox icon', options.icon);
  // The icon sits on the title line, so an icon without a title has no line to stand on.
  const title =
    icon === undefined
      ? (optionalText('infoBox title', options.title) ?? '')
      : checkedText('infoBox title (required with an icon)', options.title);
  return {
    boxStyle: 'surface',
    radius: BOX.radius,
    accentBar: false,
    titleLevel: 'label',
    title,
    eyebrow: undefined,
    icon: icon ?? null,
  };
}

/** Lines of one block, wrapped in `style` to `width`. The block is placed by the caller. */
function textBlock(
  ctx: DrawingContext,
  value: string,
  style: TextStyle,
  width: number,
  metrics: TextLevelMetrics,
  indent = 0,
): TextBlock {
  applyFont(ctx.doc, style);
  return { lines: wrap(ctx, value, width - indent, style.charSpace), top: 0, style, indent, ...metrics };
}

/** Single source of layout for both variants, shared by drawing and measuring. */
function layoutInfoBox(ctx: DrawingContext, body: string, options: InfoBoxOptions): InfoBoxLayout {
  const frame = infoBoxFrame(options);
  checkedText('infoBox content', body);
  if (options.bulletPoints !== undefined) checkedTexts('infoBox bulletPoints', options.bulletPoints);
  if (options.boldPrefixes !== undefined) checkedTexts('infoBox boldPrefixes', options.boldPrefixes);
  const inset = BOX.padding + (frame.accentBar ? CALLOUT.barWidth + CALLOUT.barGap : 0);
  const textWidth = remainingTextWidth('infoBox', ctx.measure, inset + BOX.padding);
  const spaceAfter = ctx.resolveSpaceAfter(options.spaceAfter);
  const bodyMetrics = measureTextLevel(ctx, 'body');

  // Blocks stack top to bottom; a gap only separates two blocks that exist.
  let cursor = BOX.padding;
  let placed = false;
  const place = (gapBefore: number, height: number): number => {
    const top = cursor + (placed ? gapBefore : 0);
    cursor = top + height;
    placed = true;
    return top;
  };
  const stack = (block: TextBlock, gapBefore: number): TextBlock => {
    block.top = place(gapBefore, block.lines.length * block.lineHeight);
    return block;
  };

  let eyebrow: TextBlock | null = null;
  if (frame.eyebrow) {
    const style = {
      ...resolveTextStyle(ctx, 'fieldLabel'),
      color: levelColor(ctx, 'fieldLabel', 'primary'),
      charSpace: CALLOUT.eyebrowTracking,
    };
    const upper = normalizeText(frame.eyebrow).toUpperCase();
    eyebrow = stack(textBlock(ctx, upper, style, textWidth, measureTextLevel(ctx, 'fieldLabel')), 0);
  }

  const { icon } = frame;
  let title: TextBlock | null = null;
  // The icon belongs to the title line: it makes the line exist even when the title is empty.
  if (frame.title || icon) {
    const indent = icon ? ICONS.infoSize + ICONS.gap : 0;
    const style = resolveTextStyle(ctx, frame.titleLevel);
    const metrics = measureTextLevel(ctx, frame.titleLevel);
    title = stack(textBlock(ctx, frame.title, style, textWidth, metrics, indent), CALLOUT.eyebrowGap);
  }

  let content: TextBlock | null = null;
  if (body) {
    content = stack(textBlock(ctx, body, resolveTextStyle(ctx, 'body'), textWidth, bodyMetrics), INFOBOX.titleGap);
  }

  const bullets: InfoBoxLayout['bullets'] = [];
  options.bulletPoints?.forEach((bullet, index) => {
    const { runs, prefix } = bulletFlow(ctx, bullet, options.boldPrefixes);
    const flow = layoutFlow(ctx, runs, { width: textWidth, lineHeight: bodyMetrics.lineHeight, prefix });
    bullets.push({ flow, top: place(index === 0 ? INFOBOX.bulletsGap : 0, flow.height) });
  });

  return {
    height: cursor + BOX.padding,
    spaceAfter,
    boxStyle: frame.boxStyle,
    radius: frame.radius,
    accentBar: frame.accentBar,
    inset,
    eyebrow,
    title,
    content,
    icon,
    bullets,
    bulletAscent: bodyMetrics.ascent,
  };
}

function drawInfoBoxLayout(ctx: DrawingContext, layout: InfoBoxLayout): number {
  const { doc, theme } = ctx;
  const { height, spaceAfter } = layout;
  const x = ctx.margins.left;
  const { measure: width } = ctx;
  ctx.ensureSpace(height + spaceAfter);
  const top = ctx.getYPos();

  drawBox(ctx, { x, y: top, width, height, boxStyle: layout.boxStyle, radius: layout.radius });
  if (layout.accentBar) {
    // The bar runs the full height, clipped to the box: its outer corners follow the rounding of the box.
    doc.saveGraphicsState();
    doc.roundedRect(x, top, width, height, layout.radius, layout.radius, null);
    doc.clip();
    doc.discardPath();
    doc.setFillColor(theme.colors.primary);
    doc.rect(x, top, CALLOUT.barWidth, height, 'F');
    doc.restoreGraphicsState();
  }

  const textX = x + layout.inset;
  if (layout.icon && layout.title) {
    const iconY = centerOnCapitals(top + layout.title.top + layout.title.ascent, layout.title, ICONS.infoSize);
    drawIcon(ctx, layout.icon, textX, iconY, ICONS.infoSize);
  }
  for (const block of [layout.eyebrow, layout.title, layout.content]) {
    if (!block || block.lines.every((line) => line === '')) continue;
    applyTextStyle(doc, block.style);
    text(ctx, block.lines, textX + block.indent, top + block.top + block.ascent, { charSpace: block.style.charSpace });
  }
  for (const { flow, top: bulletTop } of layout.bullets) {
    drawFlow(ctx, flow, textX, top + bulletTop, layout.bulletAscent);
  }

  return ctx.endBlock(top + height, spaceAfter);
}

/**
 * `content` is the body text under the title. A callout may pass `''`: it then draws no body block, and the other
 * blocks (eyebrow, title, bullets) close up.
 */
export function drawInfoBox(ctx: DrawingContext, content: string, options: InfoBoxOptions): number {
  return withDrawingState(ctx, () => drawInfoBoxLayout(ctx, layoutInfoBox(ctx, content, options)));
}

/**
 * Height (mm) of the box `doc.infoBox()` draws, `spaceAfter` excluded.
 *
 * @example
 * ```ts
 * import { computeInfoBoxHeight } from '@mlt-a/jspdf-toolkit';
 *
 * const options = { title: 'Payment' } as const;
 * if (computeInfoBoxHeight(doc, 'Net 30.', options) > 60) doc.addPage();
 * doc.infoBox('Net 30.', options);
 * ```
 */
export function computeInfoBoxHeight(ctx: DrawingContext, content: string, options: InfoBoxOptions): number {
  return withDrawingState(ctx, () => layoutInfoBox(ctx, content, options).height);
}
