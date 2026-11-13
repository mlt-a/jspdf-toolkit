import type { TextLevel } from '../core/constants';
import { FIELD, LEADER, LINE_WIDTH, LIST, TEXT, ascentMm } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  checkedArray,
  checkedChoice,
  checkedObjects,
  checkedText,
  optionalBoolean,
  optionalChoice,
  optionalText,
} from '../core/errors';
import type { RichBlock, RichInline } from '../text/markup';
import { parseRichText } from '../text/markup';
import { withDrawingState, withStroke } from './drawing-state';
import type { HighlightMetrics } from './highlights';
import { drawPill, measureHighlightedText } from './highlights';
import { ALIGNMENTS, measureTextLevel, optionalLevel, resolveTextStyle } from './text';
import type { MeasuredLine } from './text-lines';
import {
  breakLongToken,
  fitLineWidth,
  normalizeText,
  resolveLineWidth,
  text,
  trackedWidth,
  wrapMeasured,
} from './text-lines';
import type { TextStyle } from './text-style';
import { applyFont, applyTextStyle, sameFont, sameTextStyle } from './text-style';

/**
 * Prefix (text and gutter width, mm) of the items of a list of `count`, numbers in the style `style`.
 * - Numbered: the default column, or the widest possible number (the font's widest digit repeated as many times
 *   as `count` has digits, plus the dot) and a gap when that is larger.
 * - Bulleted: the default gutter, or the bullet and a gap when a wide `bulletChar` needs more.
 */
export function listPrefixes(
  ctx: DrawingContext,
  style: TextStyle,
  numbered: boolean,
  count: number,
  bulletChar: string = LIST.bulletChar,
): (index: number) => { text: string; width: number } {
  const width = withDrawingState(ctx, () => {
    const { doc } = ctx;
    applyFont(doc, style);
    if (!numbered) return Math.max(LIST.bulletPrefixWidth, doc.getTextWidth(bulletChar) + LIST.prefixGap);
    const widestDigit = Math.max(...Array.from('0123456789', (digit) => doc.getTextWidth(digit)));
    const number = widestDigit * String(count).length + doc.getTextWidth('.');
    return Math.max(LIST.numberedPrefixWidth, number + LIST.prefixGap);
  });
  return (index) => ({ text: numbered ? `${index + 1}.` : bulletChar, width });
}

// === Inline flow ===

/** A styled run of text, a hyperlink when `link` is set. */
export type TextFlowRun = { text: string; style: TextStyle; link?: string };

/** A styled run of text, or a highlight pill. */
export type FlowRun = TextFlowRun | { pill: string; strong?: boolean };

type Piece =
  | { kind: 'text'; text: string; style: TextStyle; link?: string; width: number }
  | { kind: 'pill'; text: string; strong: boolean; metrics: HighlightMetrics };

/**
 * A piece placed on its line, `x` relative to the line start. `spaced`: a typed space separates it from the
 * fragment before it, so justification may stretch that gap.
 */
export type FlowFragment = Piece & { x: number; spaced?: boolean };

/** A fragment of text: the only kind a flow of text runs holds. */
type TextFragment = Extract<FlowFragment, { kind: 'text' }>;

export function fragmentWidth(piece: Piece): number {
  return piece.kind === 'pill' ? piece.metrics.width : piece.width;
}

/** Letter spacing (mm) that follows a text piece: it separates the piece from one glued right after it. */
function trailingSpace(piece: Piece | undefined): number {
  return piece?.kind === 'text' ? (piece.style.charSpace ?? 0) : 0;
}

export interface FlowLine<F extends FlowFragment = FlowFragment> {
  fragments: F[];
  /** One line height, or more for a pill that wraps inside itself. */
  height: number;
  /** Ends its source line (the end of the text, or a `\n` in it): a justified setting leaves it ragged. */
  end?: boolean;
}

export interface FlowLayout<F extends FlowFragment = FlowFragment> {
  lines: FlowLine<F>[];
  height: number;
}

/**
 * A hanging gutter: every line starts after `width`. Its `text` (bullet, number), when there is one, is drawn
 * in `style` at the start of the first line; without text the gutter stays free (an icon is drawn there).
 */
export type FlowPrefix =
  | {
      /** Gutter (mm) the prefix fragment spans. */
      width: number;
      text: string;
      style: TextStyle;
    }
  | { width: number; text?: undefined; style?: undefined };

export interface FlowOptions {
  /** Width (mm) of every line, prefix gutter included. */
  width: number;
  lineHeight: number;
  prefix?: FlowPrefix;
}

/** Spaces typed before a word, measured in the style of the first one. */
type Space = { style: TextStyle; count: number };

/** Pieces with no break between them. `space` is `null` when glued to the previous word. */
type Word = { pieces: Piece[]; width: number; space: Space | null } | 'break';

/**
 * The one inline layout: runs of mixed fonts, links and pills wrapped into lines of placed fragments.
 * Each word is measured once. A word wider than its line is cut by `breakLongToken`, as `wrap` does.
 */
export function layoutFlow(ctx: DrawingContext, runs: TextFlowRun[], options: FlowOptions): FlowLayout<TextFragment>;
export function layoutFlow(ctx: DrawingContext, runs: FlowRun[], options: FlowOptions): FlowLayout;
export function layoutFlow(ctx: DrawingContext, runs: FlowRun[], options: FlowOptions): FlowLayout {
  return withDrawingState(ctx, () => layoutFlowInternal(ctx, runs, options));
}

function layoutFlowInternal(ctx: DrawingContext, runs: FlowRun[], options: FlowOptions): FlowLayout {
  const { doc } = ctx;
  const { width, lineHeight, prefix } = options;
  const gutter = prefix?.width ?? 0;
  const prefixFragment = (): FlowFragment[] =>
    prefix?.text === undefined ? [] : [{ kind: 'text', x: 0, width: gutter, text: prefix.text, style: prefix.style }];

  let font: TextStyle | null = null;
  const useFont = (style: TextStyle) => {
    if (font !== null && sameFont(font, style)) return;
    applyFont(doc, style);
    font = style;
  };

  // Plain text wraps through `wrap`, so it breaks exactly like a paragraph. The word flow below breaks lines
  // and keeps spaces the same way, with one difference: spaces opening a source line, which `wrap` keeps on
  // a line that fits, are dropped.
  const plain = runs[0];
  if (
    plain !== undefined &&
    'style' in plain &&
    runs.every(
      (run): run is TextFlowRun => 'style' in run && run.link === undefined && sameTextStyle(run.style, plain.style),
    )
  ) {
    useFont(plain.style);
    const source = runs.map((run) => run.text).join('');
    // Wrapped one source line at a time, as `wrapMeasured` does, to know where each one ends.
    const lines: FlowLine[] = [];
    for (const sourceLine of source.split(/\r?\n/)) {
      const measuredLines = wrapMeasured(ctx, sourceLine, width - gutter, plain.style.charSpace);
      measuredLines.forEach((measured, index) => {
        const fragments = lines.length === 0 ? prefixFragment() : [];
        if (measured.text) fragments.push({ kind: 'text', x: gutter, ...measured, style: plain.style });
        lines.push({ fragments, height: lineHeight, end: index === measuredLines.length - 1 });
      });
    }
    return { lines, height: lines.length * lineHeight };
  }

  const spaceWidths = new Map<string, number>();
  const spaceWidth = (style: TextStyle) => {
    const key = `${style.family}|${style.fontStyle}|${style.size}`;
    let measured = spaceWidths.get(key);
    if (measured === undefined) {
      useFont(style);
      measured = doc.getTextWidth(' ');
      spaceWidths.set(key, measured);
    }
    return measured;
  };
  // Each space adds its width and the letter spacing before it, plus the spacing before the word.
  const gapBefore = (word: Exclude<Word, 'break'>) => {
    if (!word.space) return 0;
    const { style, count } = word.space;
    const charSpace = style.charSpace ?? 0;
    return (spaceWidth(style) + charSpace) * count + charSpace;
  };

  // === Words ===
  const words: Word[] = [];
  let current: Exclude<Word, 'break'> | null = null;
  let pendingSpace: Space | null = null;

  for (const run of runs) {
    if ('pill' in run) {
      const metrics = measureHighlightedText(ctx, run.pill, { maxWidth: width - gutter });
      const pill: Piece = { kind: 'pill', text: run.pill, strong: run.strong ?? false, metrics };
      if (metrics.lines.length > 1) {
        // A pill that wraps inside itself owns its lines: it stays alone in its word.
        words.push({ pieces: [pill], width: metrics.width, space: pendingSpace });
        current = null;
      } else if (current !== null) {
        // Glued to the text before it (`(` + pill): they break as one word.
        current.width += trailingSpace(current.pieces[current.pieces.length - 1]) + metrics.width;
        current.pieces.push(pill);
      } else {
        current = { pieces: [pill], width: metrics.width, space: pendingSpace };
        words.push(current);
      }
      pendingSpace = null;
      continue;
    }
    const { style, link } = run;
    useFont(style);
    normalizeText(run.text)
      .split(/\r?\n/)
      .forEach((sourceLine, lineIndex) => {
        if (lineIndex > 0) {
          words.push('break');
          current = null;
          pendingSpace = null;
        }
        sourceLine.split(' ').forEach((part, partIndex) => {
          if (partIndex > 0) {
            if (pendingSpace) pendingSpace.count += 1;
            else pendingSpace = { style, count: 1 };
            current = null;
          }
          if (part === '') return;
          const piece: Piece = {
            kind: 'text',
            text: part,
            style,
            link,
            width: trackedWidth(doc, part, style.charSpace),
          };
          if (current === null) {
            current = { pieces: [], width: 0, space: pendingSpace };
            words.push(current);
            pendingSpace = null;
          }
          current.width += trailingSpace(current.pieces[current.pieces.length - 1]) + piece.width;
          current.pieces.push(piece);
        });
      });
  }

  // === Lines ===
  const lines: FlowLine[] = [];
  let line = prefixFragment();
  let x = gutter;
  // No content placed after the prefix yet.
  let empty = true;
  // A source line is started: like `wrap`, it yields a line even when empty.
  let open = true;
  const flush = (height = lineHeight, end = false) => {
    lines.push({ fragments: line, height, end });
    line = [];
    x = gutter;
    empty = true;
    open = false;
  };

  // Same-style text on a line becomes one fragment: one text call, and extraction keeps its spaces.
  const place = (piece: Piece, at: number, space: Space | null) => {
    const previous = line[line.length - 1];
    if (
      !empty &&
      piece.kind === 'text' &&
      previous?.kind === 'text' &&
      previous.link === piece.link &&
      sameTextStyle(previous.style, piece.style) &&
      (space === null || sameTextStyle(space.style, piece.style))
    ) {
      previous.text += (space ? ' '.repeat(space.count) : '') + piece.text;
      previous.width = at + piece.width - previous.x;
    } else {
      line.push({ ...piece, x: at, spaced: !empty && space !== null });
    }
    x = at + fragmentWidth(piece);
    empty = false;
  };

  const placeWord = (word: Exclude<Word, 'break'>, at: number, space: Space | null) => {
    word.pieces.forEach((piece, index) => {
      place(piece, at, index === 0 ? space : null);
      at += fragmentWidth(piece) + (index < word.pieces.length - 1 ? trailingSpace(piece) : 0);
    });
  };

  for (const word of words) {
    if (word === 'break') {
      if (open || !empty) flush(lineHeight, true);
      open = true;
      continue;
    }
    const [first] = word.pieces;
    if (first.kind === 'pill' && first.metrics.lines.length > 1) {
      // Alone in its word (see above), it owns its lines.
      if (!empty) flush();
      place(first, x, null);
      flush(first.metrics.lines.length * lineHeight);
      continue;
    }

    const gap = gapBefore(word);
    if (!empty && x + gap + word.width <= width) {
      placeWord(word, x + gap, word.space);
      continue;
    }
    if (!empty) flush();
    if (x + word.width <= width) {
      placeWord(word, x, null);
      continue;
    }

    // Oversized word: its pieces go one by one, and an oversized piece is cut like a long token.
    let previous: Piece | undefined;
    for (const piece of word.pieces) {
      const pieceWidth = fragmentWidth(piece);
      const joint = empty ? 0 : trailingSpace(previous);
      if (!empty && x + joint + pieceWidth > width) flush();
      else x += joint;
      previous = piece;
      if (piece.kind === 'pill' || x + pieceWidth <= width) {
        place(piece, x, null);
        continue;
      }
      useFont(piece.style);
      const { charSpace } = piece.style;
      breakLongToken(ctx, piece.text, width - gutter, charSpace).forEach((part, index) => {
        if (index > 0) flush();
        place({ ...piece, text: part, width: trackedWidth(doc, part, charSpace) }, x, null);
      });
    }
  }
  if (open || !empty) flush(lineHeight, true);

  return { lines, height: lines.reduce((sum, { height }) => sum + height, 0) };
}

/** Draws the fragments of one line. Leaves the font and colors to the caller's `withDrawingState`. */
function drawFlowLine(ctx: DrawingContext, line: FlowLine, x: number, top: number, ascent: number): void {
  const { doc } = ctx;
  const baseline = top + ascent;
  for (const fragment of line.fragments) {
    const fragmentX = x + fragment.x;
    if (fragment.kind === 'pill') {
      drawPill(ctx, fragment.metrics, fragmentX, baseline, fragment.strong);
      continue;
    }
    const { style } = fragment;
    const { charSpace } = style;
    applyTextStyle(doc, style);
    if (fragment.link === undefined) {
      text(ctx, fragment.text, fragmentX, baseline, { charSpace });
      continue;
    }
    if (charSpace) {
      // `textWithLink` sizes the zone without the letter spacing: draw the text, then link the tracked width.
      text(ctx, fragment.text, fragmentX, baseline, { charSpace });
      const linkHeight = (doc.getFontSize() * doc.getLineHeightFactor()) / doc.internal.scaleFactor;
      doc.link(fragmentX, baseline - linkHeight * TEXT.linkZoneAscentRatio, fragment.width, linkHeight, {
        url: fragment.link,
      });
    } else {
      doc.textWithLink(fragment.text, fragmentX, baseline, { url: fragment.link });
    }
    const underlineY = baseline + TEXT.linkUnderlineOffset;
    doc.setDrawColor(style.color);
    doc.setLineWidth(LINE_WIDTH.thin);
    doc.line(fragmentX, underlineY, fragmentX + fragment.width, underlineY);
  }
}

/**
 * Draws a flow at a fixed position (inside a box). `top` is the top of the first line. Leaves the font and colors to
 * the caller's `withDrawingState`: a loop over several flows is one scope.
 */
export function drawFlow(ctx: DrawingContext, layout: FlowLayout, x: number, top: number, ascent: number): void {
  let y = top;
  for (const line of layout.lines) {
    drawFlowLine(ctx, line, x, y, ascent);
    y += line.height;
  }
}

// === Leader row ===

/** The value of a leader row: styled text, or a highlight pill. */
export type LeaderValue = { text: string; style: TextStyle } | { pill: string; strong?: boolean };

export interface LeaderRowOptions {
  label: string;
  labelStyle: TextStyle;
  /** Hanging prefix (an entry number) on the first line: every label line starts after its `width`. */
  prefix?: FlowPrefix;
  value: LeaderValue;
  /** Row width (mm). */
  width: number;
  lineHeight: number;
  /** Shortest dotted run (mm) kept between the label and the value. Default `0`. */
  minRun?: number;
  /**
   * Room (mm) the label leaves for the value on its last line, in place of the value width. A value known only at
   * drawing time (a page number before pagination) then keeps the label lines of the measuring pass.
   */
  valueRoom?: number;
}

type LeaderValueLayout =
  | { kind: 'text'; style: TextStyle; lines: MeasuredLine[] }
  | { kind: 'pill'; text: string; strong: boolean; metrics: HighlightMetrics };

export interface LeaderRowLayout {
  width: number;
  lineHeight: number;
  prefix?: FlowPrefix;
  labelStyle: TextStyle;
  /** Distance (mm) from the top of a line to its baseline, from the label font size. */
  ascent: number;
  labelLines: MeasuredLine[];
  value: LeaderValueLayout;
  /**
   * `beside`: right-aligned on the last label line, dots in between. `below`: on its own right-aligned lines under
   * the label, without dots.
   */
  placement: 'beside' | 'below';
  height: number;
}

function layoutLeaderValue(ctx: DrawingContext, value: LeaderValue, width: number): LeaderValueLayout {
  if ('pill' in value) {
    const metrics = measureHighlightedText(ctx, value.pill, { maxWidth: width });
    return { kind: 'pill', text: value.pill, strong: value.strong ?? false, metrics };
  }
  applyFont(ctx.doc, value.style);
  return { kind: 'text', style: value.style, lines: wrapMeasured(ctx, value.text, width, value.style.charSpace) };
}

/**
 * Single layout of a `label ..... value` row, shared by measuring and drawing. The label wraps in what the value
 * leaves on its line, dots included. A value on several lines, or wider than `FIELD.sideMaxRatio` of the row, goes
 * below the label.
 */
export function layoutLeaderRow(ctx: DrawingContext, options: LeaderRowOptions): LeaderRowLayout {
  return withDrawingState(ctx, () => {
    const { label, labelStyle, prefix, width, lineHeight, minRun = 0 } = options;
    const value = layoutLeaderValue(ctx, options.value, width);
    const valueLines = value.kind === 'pill' ? value.metrics.lines.length : value.lines.length;
    const room = options.valueRoom ?? (value.kind === 'pill' ? value.metrics.width : value.lines[0].width);

    // Without a required run the label only keeps a gap from the value: the dots may vanish.
    const reserved = room + LEADER.gap + (minRun > 0 ? minRun + LEADER.gap : 0);
    const labelRoom = width - (prefix?.width ?? 0) - reserved;
    const beside = valueLines === 1 && room <= width * FIELD.sideMaxRatio && labelRoom >= width * LEADER.labelMinRatio;
    const placement = beside ? 'beside' : 'below';

    const labelWidth = beside ? labelRoom : width - (prefix?.width ?? 0);
    applyFont(ctx.doc, labelStyle);
    const labelLines = wrapMeasured(ctx, label, Math.max(1, labelWidth), labelStyle.charSpace);
    const lines = labelLines.length + (beside ? 0 : valueLines);
    const ascent = ascentMm(labelStyle.size);
    return { width, lineHeight, prefix, labelStyle, ascent, labelLines, value, placement, height: lines * lineHeight };
  });
}

/**
 * The row with another value, label lines and placement kept. For a value known only at drawing time, after the row
 * was measured with `valueRoom`: the new value must fit that room.
 */
export function replaceLeaderValue(ctx: DrawingContext, layout: LeaderRowLayout, value: LeaderValue): LeaderRowLayout {
  return withDrawingState(ctx, () => ({ ...layout, value: layoutLeaderValue(ctx, value, layout.width) }));
}

/**
 * Dotted leader between a label and a value on the same line. Drawn from the right so the dots line up under
 * aligned values. Draws nothing when there is no room.
 */
function drawLeader(ctx: DrawingContext, options: { leftX: number; rightX: number; y: number; color: string }): void {
  const { leftX, rightX, y, color } = options;
  if (rightX <= leftX) return;
  withStroke(ctx, { color, width: LINE_WIDTH.normal, dash: LEADER.dash }, () => ctx.doc.line(rightX, y, leftX, y));
}

/** Draws a leader row at `x`, `top` at the top of its first line. Leaves the font and colors as it found them. */
export function drawLeaderRow(ctx: DrawingContext, layout: LeaderRowLayout, x: number, top: number): void {
  const { doc } = ctx;
  const { prefix, labelStyle, labelLines, lineHeight, value, placement, ascent } = layout;
  const right = x + layout.width;
  const baseline = top + ascent;
  withDrawingState(ctx, () => {
    if (prefix?.text !== undefined) {
      applyTextStyle(doc, prefix.style);
      text(ctx, prefix.text, x, baseline, { charSpace: prefix.style.charSpace });
    }
    const labelX = x + (prefix?.width ?? 0);
    applyTextStyle(doc, labelStyle);
    labelLines.forEach((line, index) =>
      text(ctx, line.text, labelX, baseline + index * lineHeight, { charSpace: labelStyle.charSpace }),
    );

    const lastBaseline = baseline + (labelLines.length - 1) * lineHeight;
    const offset = placement === 'below' ? 1 : 0;
    let valueWidth: number;
    if (value.kind === 'pill') {
      valueWidth = value.metrics.width;
      drawPill(ctx, value.metrics, right - valueWidth, lastBaseline + offset * lineHeight, value.strong);
    } else {
      valueWidth = value.lines[0].width;
      applyTextStyle(doc, value.style);
      value.lines.forEach((line, index) =>
        text(ctx, line.text, right, lastBaseline + (index + offset) * lineHeight, {
          align: 'right',
          charSpace: value.style.charSpace,
        }),
      );
    }
    if (placement === 'beside') {
      drawLeader(ctx, {
        leftX: labelX + labelLines[labelLines.length - 1].width + LEADER.gap,
        rightX: right - valueWidth - LEADER.gap,
        y: lastBaseline,
        color: ctx.theme.colors.subtle,
      });
    }
  });
}

/** A line of paged content and the space (mm) that follows it. */
interface PagedLine {
  line: FlowLine;
  after: number;
}

/** Rich blocks laid out as lines drawn at `x`, ready to paginate. */
export interface RichLayout {
  lines: PagedLine[];
  x: number;
  ascent: number;
}

/**
 * Draws a rich layout at the document Y, breaking pages between lines. One scope per line, entered after the page
 * break: the `onNewPage` hook and the next line never see the underline of a link above.
 */
export function drawRichLayout(ctx: DrawingContext, { lines, x, ascent }: RichLayout): void {
  for (const { line, after } of lines) {
    ctx.ensureSpace(line.height);
    const y = ctx.getYPos();
    withDrawingState(ctx, () => drawFlowLine(ctx, line, x, y, ascent));
    ctx.endBlock(y + line.height, after);
  }
}

// === Rich blocks ===

/** Options of `richText` and `richBlocks`. */
export interface RichTextOptions {
  /** Text level of the block (size, color, base weight). Emphasis is set run by run. Default: `body`. */
  level?: TextLevel;
  /** Indent (mm) from the left margin. Default: 0. */
  indent?: number;
  /**
   * Line width (mm), above 0. Wider than the available width (the content width less `indent`): brought down to it, with a warning. Default:
   * the document `measure` minus `indent`.
   */
  maxWidth?: number;
  /**
   * `justify` stretches the spaces of every line but the last one of each paragraph and list item, and the line before
   * a `\n` in the text of a run. Default: `left`.
   */
  align?: 'justify' | 'left';
  /** Space (mm) after the last block. Default: `theme.spacing.block`, also the space between two blocks. */
  spaceAfter?: number;
}

function linkStyle(ctx: DrawingContext, style: TextStyle): TextStyle {
  return { ...style, color: ctx.theme.colors.primary };
}

function richRuns(ctx: DrawingContext, runs: RichInline[], level: TextLevel): TextFlowRun[] {
  return runs.map((run) => {
    const style = resolveTextStyle(ctx, level, run);
    if (run.link === undefined) return { text: run.text, style };
    return { text: run.text, style: linkStyle(ctx, style), link: run.link };
  });
}

/**
 * Stretches the typed spaces of `line` so its last word ends at `width`. Every word becomes its own fragment; a
 * word glued to the one before it (a comma after a bold run) moves with it. Fragments before `gutter` (a list
 * prefix) stay put. A line without a space to stretch, or already full, is returned as is.
 */
function justifyLine(
  ctx: DrawingContext,
  line: FlowLine<TextFragment>,
  width: number,
  gutter: number,
): FlowLine<TextFragment> {
  return withDrawingState(ctx, () => {
    const fixed: TextFragment[] = [];
    const words: { fragment: TextFragment; spaced: boolean }[] = [];
    for (const fragment of line.fragments) {
      if (fragment.x < gutter) {
        fixed.push(fragment);
        continue;
      }
      applyFont(ctx.doc, fragment.style);
      const charSpace = fragment.style.charSpace ?? 0;
      for (const match of fragment.text.matchAll(/[^ ]+/g)) {
        const before = fragment.text.slice(0, match.index);
        // `trackedWidth` stops at the last letter: the next one starts a letter spacing further.
        const offset = before ? trackedWidth(ctx.doc, before, charSpace) + charSpace : 0;
        words.push({
          fragment: {
            ...fragment,
            text: match[0],
            width: trackedWidth(ctx.doc, match[0], charSpace),
            x: fragment.x + offset,
          },
          spaced: match.index > 0 || fragment.spaced === true,
        });
      }
    }
    const gaps = words.slice(1).filter((word) => word.spaced).length;
    if (gaps === 0) return line;
    const { fragment: last } = words[words.length - 1];
    const slack = width - (last.x + last.width);
    if (slack <= 0) return line;

    const extra = slack / gaps;
    let shift = 0;
    const fragments = fixed;
    words.forEach(({ fragment, spaced }, index) => {
      if (index > 0 && spaced) shift += extra;
      fragments.push({ ...fragment, x: fragment.x + shift });
    });
    return { ...line, fragments };
  });
}

/** `layoutFlow` with the lines justified when `justify` is set. */
function layoutAlignedFlow(
  ctx: DrawingContext,
  runs: TextFlowRun[],
  options: FlowOptions,
  justify: boolean,
): FlowLayout<TextFragment> {
  const layout = layoutFlow(ctx, runs, options);
  if (!justify) return layout;
  const gutter = options.prefix?.width ?? 0;
  const lines = layout.lines.map((line) => (line.end ? line : justifyLine(ctx, line, options.width, gutter)));
  return { ...layout, lines };
}

const BLOCK_TYPES = ['paragraph', 'bulletList', 'numberedList'] as const satisfies readonly RichBlock['type'][];

/** The runs of a paragraph or of a list item: each one an object with its `text`, and the emphasis and link it may set. */
function checkRichRuns(what: string, runs: readonly RichInline[]): void {
  checkedObjects(what, runs, (run, index) => {
    checkedText(() => `${what}[${index}] text`, run.text);
    optionalBoolean(() => `${what}[${index}] bold`, run.bold);
    optionalBoolean(() => `${what}[${index}] italic`, run.italic);
    optionalText(() => `${what}[${index}] link`, run.link);
  });
}

/**
 * Throws an `InvalidOptionError` naming `what` for blocks that cannot be drawn, before anything is: blocks that are
 * not an array of objects with a known `type`, runs (or the items of a list) that are not arrays of objects, a run
 * without its `text`. Checked at runtime for JavaScript callers.
 */
export function checkRichBlocks(what: string, blocks: readonly RichBlock[]): void {
  checkedObjects(what, blocks, (block, index) => {
    const at = `${what}[${index}]`;
    checkedChoice(`${at} type`, block.type, BLOCK_TYPES);
    if (block.type === 'paragraph') {
      checkRichRuns(`${at} runs`, block.runs);
      return;
    }
    checkedArray(`${at} items`, block.items).forEach((runs, item) => checkRichRuns(`${at} items[${item}]`, runs));
  });
}

/** Single source of layout for `drawRichBlocks`, `computeRichBlocksHeight` and the list details. */
export function layoutRichBlocks(ctx: DrawingContext, blocks: RichBlock[], options?: RichTextOptions): RichLayout {
  const level = optionalLevel('richText', options?.level) ?? 'body';
  const align = optionalChoice('richText align', options?.align, ALIGNMENTS);
  const frame = resolveLineWidth(ctx, 'richText', options);
  // Brought into the frame only when there is text: nothing to draw raises no warning.
  const width = blocks.length > 0 ? fitLineWidth(ctx, 'richText', frame) : frame.width;
  const justify = align === 'justify';
  const blockSpacing = ctx.theme.spacing.block;
  const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter);
  const prefixStyle = resolveTextStyle(ctx, level);
  const { lineHeight, ascent } = measureTextLevel(ctx, level);

  const lines: PagedLine[] = [];
  const add = (layout: FlowLayout, after: number) => {
    layout.lines.forEach((line, index) => {
      lines.push({ line, after: index === layout.lines.length - 1 ? after : 0 });
    });
  };

  blocks.forEach((block, blockIndex) => {
    const blockAfter = blockIndex === blocks.length - 1 ? spaceAfter : blockSpacing;
    if (block.type === 'paragraph') {
      add(layoutAlignedFlow(ctx, richRuns(ctx, block.runs, level), { width, lineHeight }, justify), blockAfter);
      return;
    }
    const numbered = block.type === 'numberedList';
    const count = block.items.length;
    const prefixOf = listPrefixes(ctx, prefixStyle, numbered, count);
    block.items.forEach((runs, itemIndex) => {
      const prefix = { ...prefixOf(itemIndex), style: prefixStyle };
      const layout = layoutAlignedFlow(ctx, richRuns(ctx, runs, level), { width, lineHeight, prefix }, justify);
      add(layout, itemIndex === count - 1 ? blockAfter : LIST.itemSpacing);
    });
  });

  return { lines, x: ctx.margins.left + frame.indent, ascent };
}

/** Rich paragraphs and lists built as data. Returns the Y under them, `spaceAfter` included. */
export function drawRichBlocks(ctx: DrawingContext, blocks: RichBlock[], options?: RichTextOptions): number {
  checkRichBlocks('richBlocks', blocks);
  drawRichLayout(ctx, layoutRichBlocks(ctx, blocks, options));
  return ctx.peekYPos();
}

/**
 * Height (mm) `doc.richBlocks()` takes on one page, `spaceAfter` excluded.
 *
 * @example
 * ```ts
 * import { computeRichBlocksHeight, parseRichText } from '@mlt-a/jspdf-toolkit';
 *
 * const height = computeRichBlocksHeight(doc, parseRichText('Due within **30 days**.'));
 * ```
 */
export function computeRichBlocksHeight(ctx: DrawingContext, blocks: RichBlock[], options?: RichTextOptions): number {
  checkRichBlocks('richBlocks', blocks);
  const { lines } = layoutRichBlocks(ctx, blocks, options);
  // The space after the last line is the block's `spaceAfter`.
  return lines.reduce((sum, { line, after }, index) => sum + line.height + (index < lines.length - 1 ? after : 0), 0);
}

/** Markup prose (`**bold**`, `*italic*`), paragraphs separated by a blank line. */
export function drawRichText(ctx: DrawingContext, markup: string, options?: RichTextOptions): number {
  return drawRichBlocks(ctx, parseRichText(markup), options);
}

/**
 * Height (mm) `doc.richText()` takes on one page, `spaceAfter` excluded.
 *
 * @example
 * ```ts
 * import { computeRichTextHeight } from '@mlt-a/jspdf-toolkit';
 *
 * const height = computeRichTextHeight(doc, 'Due within **30 days**.', { level: 'small' });
 * ```
 */
export function computeRichTextHeight(ctx: DrawingContext, markup: string, options?: RichTextOptions): number {
  return computeRichBlocksHeight(ctx, parseRichText(markup), options);
}
