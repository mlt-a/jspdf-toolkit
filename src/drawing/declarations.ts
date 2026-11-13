import { BOX, DECLARATIONS, ICONS, LIST, centerOnCapitals } from '../core/constants';
import type { TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { checkedObject, checkedObjects, checkedText, optionalBoolean, optionalText } from '../core/errors';
import type { BoxStylePreset } from './boxes';
import { drawBox, optionalBoxStyle } from './boxes';
import { withDrawingState } from './drawing-state';
import { drawIcon } from './image-helpers';
import type { FlowLayout, FlowRun } from './rich';
import { drawFlow, layoutFlow } from './rich';
import { measureTextLevel, optionalLevel, resolveTextStyle, setTextStyle } from './text';
import { normalizeText, remainingTextWidth, text, wrap } from './text-lines';
import type { TextStyle } from './text-style';

/** One declaration: its text and the fragments of it to highlight. */
export interface DeclarationItem {
  /** The declaration as drawn; wraps within the box. */
  text: string;
  /** Fragments of `text` set in a pill. Each one marks the first place its words appear. */
  highlights?: Array<{
    /** Words to highlight, matched whole and in order. */
    text: string;
    /** Primary fill with `onPrimary` text, instead of the light tint. Default: `false`. */
    strong?: boolean;
  }>;
}

/** Options of `declarationsBox`. */
export interface DeclarationsBoxOptions {
  /** Intro line(s) above the items. */
  intro?: string;
  /** Prefixes each item with a bullet. Ignored when `icon` is set. */
  bullet?: boolean;
  /** Icon before each item: a name given to `doc.registerImage`, or image data. */
  icon?: string;
  /** Fill and border preset. Default: `'background'`. */
  boxStyle?: BoxStylePreset;
  /** Text level of the intro and the items. Highlights keep their own pill style. Default: `'body'`. */
  level?: TextLevel;
  /** Space (mm) under the box. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

type Highlight = { text: string; strong: boolean };

interface DeclarationsLayout {
  /** X of the items: after the check icon, or at the bullet. */
  itemX: number;
  contentX: number;
  introLines: string[];
  introHeight: number;
  items: FlowLayout[];
  /** Text level of the intro and the items, defaulted. */
  level: TextLevel;
  /** Ascent of that level. */
  ascent: number;
  /** Total box height, shared by measuring and drawing. */
  height: number;
}

/** Item text as flow runs: plain words, and each highlight as one pill at its first match. */
function itemRuns(item: DeclarationItem, style: TextStyle): FlowRun[] {
  if (!item.highlights || item.highlights.length === 0) return [{ text: item.text, style }];
  const highlights = item.highlights.map((h): Highlight => ({ text: h.text, strong: h.strong ?? false }));
  const words = item.text.split(' ');
  const highlightAt = buildHighlightMap(words, highlights);

  const runs: FlowRun[] = [];
  let plain: string[] = [];
  const flushPlain = (beforePill: boolean) => {
    if (plain.length === 0) {
      // Two pills in a row keep the space between them.
      if (beforePill && runs.length > 0) runs.push({ text: ' ', style });
      return;
    }
    const lead = runs.length > 0 ? ' ' : '';
    runs.push({ text: lead + plain.join(' ') + (beforePill ? ' ' : ''), style });
    plain = [];
  };

  words.forEach((word, index) => {
    const highlight = highlightAt.get(index);
    if (!highlight) {
      plain.push(word);
      return;
    }
    // A multi-word highlight is one pill, placed at its first word.
    if (index > 0 && highlightAt.get(index - 1) === highlight) return;
    flushPlain(true);
    runs.push({ pill: highlight.text, strong: highlight.strong });
  });
  flushPlain(false);
  return runs;
}

/** Every item checked before anything is drawn: its `text`, and the `text` of each highlight it carries. */
function checkItems(items: DeclarationItem[]): void {
  checkedObjects('declarationsBox items', items, (item, index) => {
    const at = `declarationsBox items[${index}]`;
    checkedText(`${at} text`, item.text);
    if (item.highlights === undefined) return;
    checkedObjects(`${at} highlights`, item.highlights, (highlight, position) => {
      checkedText(() => `${at} highlights[${position}] text`, highlight.text);
      optionalBoolean(() => `${at} highlights[${position}] strong`, highlight.strong);
    });
  });
}

const isEmpty = (items: DeclarationItem[], options: DeclarationsBoxOptions) => items.length === 0 && !options.intro;

/** The options checked and defaulted, before the items are looked at. */
interface DeclarationsFrame {
  /** Space before the items: the icon and its gap. */
  iconIndent: number;
  /** Text width of the items, after the padding and the icon. */
  itemWidth: number;
  spaceAfter: number;
}

function declarationsFrame(ctx: DrawingContext, options: DeclarationsBoxOptions): DeclarationsFrame {
  checkedObject('declarationsBox options', options);
  optionalText('declarationsBox intro', options.intro);
  optionalBoolean('declarationsBox bullet', options.bullet);
  optionalBoxStyle('declarationsBox', options.boxStyle);
  optionalLevel('declarationsBox', options.level);
  optionalText('declarationsBox icon', options.icon);
  const iconIndent = options.icon ? ICONS.size + ICONS.gap : 0;
  return {
    iconIndent,
    itemWidth: remainingTextWidth('declarationsBox', ctx.measure, BOX.padding * 2 + iconIndent),
    spaceAfter: ctx.resolveSpaceAfter(options.spaceAfter),
  };
}

/** Single source of layout for `drawDeclarationsBox` and `computeDeclarationsBoxHeight`. */
function layoutDeclarations(
  ctx: DrawingContext,
  declarations: DeclarationItem[],
  options: DeclarationsBoxOptions,
  { iconIndent, itemWidth }: DeclarationsFrame,
): DeclarationsLayout {
  const level = options.level ?? 'body';
  const { lineHeight, ascent } = measureTextLevel(ctx, level);
  const contentX = ctx.margins.left + BOX.padding;

  setTextStyle(ctx, level);

  let introLines: string[] = [];
  let introHeight = 0;
  if (options.intro) {
    // The intro runs under the icons too.
    introLines = wrap(ctx, options.intro, itemWidth + iconIndent);
    introHeight = introLines.length * lineHeight + DECLARATIONS.itemGap;
  }

  const style = resolveTextStyle(ctx, level);
  const prefix =
    options.bullet === true && !options.icon
      ? { text: LIST.bulletChar, style, width: LIST.bulletPrefixWidth }
      : undefined;
  const items = declarations.map((item) =>
    layoutFlow(ctx, itemRuns(item, style), { width: itemWidth, lineHeight, prefix }),
  );

  const itemsHeight = items.reduce((sum, item) => sum + item.height, 0);
  const gaps = Math.max(0, items.length - 1) * DECLARATIONS.itemGap;

  return {
    itemX: contentX + iconIndent,
    contentX,
    introLines,
    introHeight,
    items,
    level,
    ascent,
    height: BOX.padding * 2 + introHeight + itemsHeight + gaps,
  };
}

export function drawDeclarationsBox(
  ctx: DrawingContext,
  items: DeclarationItem[],
  options: DeclarationsBoxOptions = {},
): number {
  const frame = declarationsFrame(ctx, options);
  checkItems(items);
  if (isEmpty(items, options)) return ctx.peekYPos();
  return withDrawingState(ctx, () => {
    const boxStyle = options.boxStyle ?? 'background';
    const { spaceAfter } = frame;

    const layout = layoutDeclarations(ctx, items, options, frame);
    const { height, level, ascent } = layout;
    ctx.ensureSpace(height + spaceAfter);
    const currentY = ctx.getYPos();

    drawBox(ctx, { x: ctx.margins.left, y: currentY, width: ctx.measure, height, boxStyle });

    let contentY = currentY + BOX.padding;
    const { contentX, itemX } = layout;
    const iconSize = ICONS.size;

    setTextStyle(ctx, level);

    if (layout.introLines.length > 0) {
      text(ctx, layout.introLines, contentX, contentY + ascent);
      contentY += layout.introHeight;
    }

    layout.items.forEach((item, index) => {
      const isLast = index === layout.items.length - 1;

      if (options.icon) {
        drawIcon(ctx, options.icon, contentX, centerOnCapitals(contentY + ascent, layout, iconSize), iconSize);
      }

      drawFlow(ctx, item, itemX, contentY, ascent);

      contentY += item.height;
      if (!isLast) {
        contentY += DECLARATIONS.itemGap;
      }
    });

    return ctx.endBlock(currentY + height, spaceAfter);
  });
}

/**
 * Height (mm) of the box `doc.declarationsBox()` draws, `spaceAfter` excluded.
 *
 * @example
 * ```ts
 * import { computeDeclarationsBoxHeight } from '@mlt-a/jspdf-toolkit';
 *
 * const items = [{ text: 'I accept the terms.' }];
 * const height = computeDeclarationsBoxHeight(doc, items, { intro: 'The signatory declares that:' });
 * doc.ensureSpace(height);
 * ```
 */
export function computeDeclarationsBoxHeight(
  ctx: DrawingContext,
  items: DeclarationItem[],
  options: DeclarationsBoxOptions = {},
): number {
  const frame = declarationsFrame(ctx, options);
  checkItems(items);
  if (isEmpty(items, options)) return 0;
  return withDrawingState(ctx, () => layoutDeclarations(ctx, items, options, frame).height);
}

function buildHighlightMap(words: string[], highlights: Highlight[]): Map<number, Highlight> {
  const positions = new Map<number, Highlight>();

  highlights.forEach((highlight) => {
    const highlightWords = highlight.text.split(' ');
    for (let i = 0; i <= words.length - highlightWords.length; i++) {
      const match = highlightWords.every((hw, j) => normalizeText(words[i + j]) === normalizeText(hw));
      if (match) {
        for (let j = 0; j < highlightWords.length; j++) {
          positions.set(i + j, highlight);
        }
        break;
      }
    }
  });

  return positions;
}
