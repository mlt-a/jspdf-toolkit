import type { TextLevel } from '../core/constants';
import { ICONS, LIST, centerOnCapitals } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  checkedArray,
  checkedLeftOut,
  checkedObject,
  checkedText,
  checkedTexts,
  optionalNumber,
  optionalText,
} from '../core/errors';
import type { RichBlock } from '../text/markup';
import { withDrawingState } from './drawing-state';
import { drawIcon } from './image-helpers';
import type { FlowLayout, FlowPrefix, RichLayout } from './rich';
import { checkRichBlocks, drawFlow, drawRichLayout, layoutFlow, layoutRichBlocks, listPrefixes } from './rich';
import { measureTextLevel, optionalLevel, resolveTextStyle } from './text';
import { fitLineWidth, remainingTextWidth, resolveLineWidth } from './text-lines';
import type { TextStyle } from './text-style';

/** A list entry: plain text, or an object with sub-items and a detail line. */
export type ListItem =
  | string
  | {
      /** The item text, behind the bullet or number. */
      text: string;
      /** Items nested under it, one dash each, indented 4 mm. Plain text: no sub-items of their own. */
      subItems?: string[];
      /**
       * Text under the item, aligned with its text and set in `smallMuted`. A string is plain text, like
       * `text`; emphasis and links come as blocks (`parseRichText('Some **detail**')`). Only its first
       * line is kept with the item; a long detail may continue on the next page.
       */
      detail?: string | RichBlock[];
    };

const DETAIL_LEVEL = 'smallMuted';

/** Options of `bulletList` and `numberedList`. */
export interface ListOptions {
  /** Text level of the items. Default: `'body'`. */
  level?: TextLevel;
  /** Indent (mm) of the whole list from the left margin, taken off its width. Default: 0. */
  indent?: number;
  /**
   * Width (mm) of the list, bullets included, above 0. Wider than the available width (the content width less `indent`): brought down to it,
   * with a warning. Default: the document `measure` minus `indent`.
   */
  maxWidth?: number;
  /** Space (mm) between two items: 0 or more. Default: 1. */
  itemSpacing?: number;
  /**
   * Bullet glyph of `bulletList`, a string. `numberedList` checks it and draws its numbers instead; `iconList` has no
   * glyph, so it throws `InvalidOptionError`. Default: `'•'`.
   */
  bulletChar?: string;
  /** Multiplies the line height. Default: 1. */
  lineHeightScale?: number;
  /** Space (mm) under the list. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

interface ItemLayout {
  text: FlowLayout;
  subItems: FlowLayout[];
  detail: RichLayout | null;
  /** Total height (mm): lines wrapped once, shared by the page-break check and the drawing. */
  height: number;
}

/**
 * Single source of layout for the text lists. Items are plain text (stars stay literal), set as one run
 * behind a hanging prefix.
 */
function layoutItem(
  ctx: DrawingContext,
  item: ListItem,
  { indent, width }: { indent: number; width: number },
  prefix: FlowPrefix,
  style: TextStyle,
  lineHeight: number,
): ItemLayout {
  const itemText = typeof item === 'string' ? item : item.text;
  const subItems = typeof item === 'string' ? [] : (item.subItems ?? []);
  const rawDetail = typeof item === 'string' ? undefined : item.detail;
  const detailBlocks: RichBlock[] =
    typeof rawDetail === 'string'
      ? rawDetail
        ? [{ type: 'paragraph', runs: [{ text: rawDetail }] }]
        : []
      : (rawDetail ?? []);

  // Checked before the flows: a frame too narrow for its prefix is a wrong call, not text to squeeze.
  remainingTextWidth('a list item', width, prefix.width);
  const text = layoutFlow(ctx, [{ text: itemText, style }], { width, lineHeight, prefix });
  const subPrefix = { text: '-', style, width: LIST.bulletPrefixWidth };
  const subWidth = width - LIST.subIndent;
  if (subItems.length > 0) remainingTextWidth('a list sub-item', subWidth, subPrefix.width);
  const subLayouts = subItems.map((subItem) =>
    layoutFlow(ctx, [{ text: subItem, style }], { width: subWidth, lineHeight, prefix: subPrefix }),
  );

  let height = text.height;
  if (subLayouts.length > 0) {
    height += LIST.itemSpacing;
    for (const sub of subLayouts) height += sub.height + LIST.itemSpacing;
  }
  // The detail paginates line by line: only its first line is reserved, so the item is never orphaned. It keeps to
  // the width of the item text.
  const detailFrame = { indent: indent + prefix.width, maxWidth: width - prefix.width };
  const detail =
    detailBlocks.length > 0
      ? layoutRichBlocks(ctx, detailBlocks, { level: DETAIL_LEVEL, ...detailFrame, spaceAfter: 0 })
      : null;
  if (detail && detail.lines.length > 0) height += LIST.itemSpacing + detail.lines[0].line.height;
  return { text, subItems: subLayouts, detail, height };
}

/**
 * Every item checked before the first one is drawn: a string, or an object with its `text`, `subItems` that are
 * strings and a `detail` that is a string or rich blocks. Checked at runtime for JavaScript callers.
 */
function checkListItems(items: ListItem[]): void {
  checkedArray('list items', items).forEach((item, index) => {
    if (typeof item === 'string') return;
    const at = `list items[${index}]`;
    checkedObject(at, item, 'a string');
    checkedText(`${at} text`, item.text);
    if (item.subItems !== undefined) checkedTexts(`${at} subItems`, item.subItems);
    if (item.detail !== undefined && typeof item.detail !== 'string') checkRichBlocks(`${at} detail`, item.detail);
  });
}

/** What starts each item: a bullet, a number, or an icon in the same gutter. */
type ListKind = 'bullet' | 'number' | { icon: string };

function drawListInternal(ctx: DrawingContext, items: ListItem[], kind: ListKind, options?: ListOptions): number {
  // The options are checked before the items: an invalid one throws even on an empty list.
  const level = optionalLevel('list', options?.level) ?? 'body';
  optionalText('list bulletChar', options?.bulletChar);
  const lineFrame = resolveLineWidth(ctx, 'list', options);
  const itemSpacing = optionalNumber('list itemSpacing (mm)', options?.itemSpacing, { min: 0 }) ?? LIST.itemSpacing;
  const { lineHeight, ascent } = measureTextLevel(ctx, level, options);
  const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter);
  checkListItems(items);
  if (items.length === 0) return ctx.peekYPos();
  const frame = { indent: lineFrame.indent, width: fitLineWidth(ctx, 'list', lineFrame) };
  const style = resolveTextStyle(ctx, level);
  const icon = typeof kind === 'object' ? kind.icon : undefined;
  const textPrefixOf =
    icon === undefined ? listPrefixes(ctx, style, kind === 'number', items.length, options?.bulletChar) : null;
  const prefixOf = (index: number): FlowPrefix =>
    textPrefixOf === null ? { width: ICONS.size + ICONS.gap } : { ...textPrefixOf(index), style };
  const x = ctx.margins.left + frame.indent;
  // Every item is laid out before the first one is drawn: the width a sub-item or a detail leaves is checked there.
  const layouts = items.map((item, index) => layoutItem(ctx, item, frame, prefixOf(index), style, lineHeight));

  items.forEach((_item, index) => {
    const layout = layouts[index];
    ctx.ensureSpace(layout.height);

    // One scope per item, entered after the page break: a new page never starts with the previous item's state.
    let currentY = ctx.getYPos();
    withDrawingState(ctx, () => {
      if (icon !== undefined) {
        drawIcon(ctx, icon, x, centerOnCapitals(currentY + ascent, { ascent }, ICONS.size), ICONS.size);
      }
      drawFlow(ctx, layout.text, x, currentY, ascent);
      currentY += layout.text.height;
      if (layout.subItems.length > 0) {
        currentY += LIST.itemSpacing;
        for (const sub of layout.subItems) {
          drawFlow(ctx, sub, x + LIST.subIndent, currentY, ascent);
          currentY += sub.height + LIST.itemSpacing;
        }
      }
    });

    if (layout.detail) {
      ctx.setYPos(currentY + LIST.itemSpacing);
      drawRichLayout(ctx, layout.detail);
      currentY = ctx.getYPos();
    }

    if (index < items.length - 1) currentY += itemSpacing;
    ctx.setYPos(currentY);
  });

  return ctx.endBlock(ctx.getYPos(), spaceAfter);
}

export function drawBulletList(ctx: DrawingContext, items: ListItem[], options?: ListOptions): number {
  return drawListInternal(ctx, items, 'bullet', options);
}

export function drawNumberedList(ctx: DrawingContext, items: ListItem[], options?: ListOptions): number {
  return drawListInternal(ctx, items, 'number', options);
}

/** Options of `iconList`. */
export interface IconListOptions extends Omit<ListOptions, 'bulletChar'> {
  /** Image of every bullet: a name given to `doc.registerImage`, or image data. The library ships no icon. */
  icon: string;
}

export function drawIconList(ctx: DrawingContext, items: ListItem[], options: IconListOptions): number {
  // The image is the bullet: its glyph cannot be set, and without an image there is no bullet to draw.
  checkedObject('iconList options', options);
  checkedLeftOut('iconList', options, ['bulletChar']);
  checkedText('iconList icon', options.icon);
  return drawListInternal(ctx, items, { icon: options.icon }, options);
}
