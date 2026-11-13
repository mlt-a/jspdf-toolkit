import type { jsPDF } from 'jspdf';

import { lineHeightMm } from '../core/constants';
import type { TextAlign } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { POSITIVE, checkedNumber, optionalNumber } from '../core/errors';

/** The thin spaces `Intl.NumberFormat` emits: U+202F, U+2009 and U+2007. Not global: `test` keeps no `lastIndex`. */
export const THIN_SPACE = /[\u202f\u2009\u2007]/;

const THIN_SPACES = new RegExp(THIN_SPACE, 'g');

/**
 * Maps the thin spaces that `Intl.NumberFormat` emits (U+202F, U+2009, U+2007) to U+00A0.
 * Embedded fonts have no glyph for them: jsPDF draws a zero-width gap and amounts render glued.
 * `PDFDocument` applies it to every `text`, `getTextWidth` and `splitTextToSize` call, so measuring
 * and drawing agree.
 */
export function normalizeText(value: string): string {
  return value.replace(THIN_SPACES, '\u00a0');
}

export interface TextOpts {
  align?: TextAlign;
  charSpace?: number;
  baseline?: 'alphabetic' | 'middle' | 'top' | 'bottom';
  maxWidth?: number;
  /** Multiplies the theme `lineHeightFactor` between lines of a multi-line text. */
  lineHeightScale?: number;
}

/** Width (mm) of `value` in the current font, `charSpace` added between letters, as `text` draws it. */
export function trackedWidth(doc: jsPDF, value: string, charSpace = 0): number {
  return doc.getTextWidth(value) + charSpace * Math.max(0, value.length - 1);
}

/**
 * Draws text. Multi-line text always gets the theme `lineHeightFactor` so jsPDF spaces lines exactly
 * as callers advance Y (see `lineHeightMm`).
 */
export function text(ctx: DrawingContext, value: string | string[], x: number, y: number, opts: TextOpts = {}): void {
  const { lineHeightScale = 1, ...rest } = opts;
  const { charSpace, align } = rest;
  const lineHeightFactor = ctx.theme.typography.lineHeightFactor * lineHeightScale;

  // jsPDF ignores `charSpace` when offsetting `center`/`right`, so tracked text overshoots its anchor.
  // Re-anchor each line from its tracked width and draw left-aligned, which does apply the tracking.
  if (charSpace && (align === 'center' || align === 'right')) {
    const lines = Array.isArray(value) ? value : [value];
    const step = lineHeightMm(ctx.doc.getFontSize(), lineHeightFactor);
    lines.forEach((line, index) => {
      const width = trackedWidth(ctx.doc, line, charSpace);
      const anchorX = align === 'right' ? x - width : x - width / 2;
      ctx.doc.text(line, anchorX, y + index * step, { ...rest, align: undefined, lineHeightFactor });
    });
    return;
  }

  ctx.doc.text(value, x, y, { ...rest, lineHeightFactor });
}

const ELLIPSIS = '…';

/**
 * `value` when it fits `maxWidth` in the current font and `charSpace`, else its longest start followed by an ellipsis
 * that fits, else `''`.
 */
export function fitWithEllipsis(ctx: DrawingContext, value: string, maxWidth: number, charSpace = 0): string {
  const fits = (candidate: string) => trackedWidth(ctx.doc, candidate, charSpace) <= maxWidth;
  if (fits(value)) return value;
  const cut = (end: number) => value.slice(0, end).trimEnd() + ELLIPSIS;
  if (!fits(cut(0))) return '';
  // A longer start is never narrower, so the longest one that fits is found by halving the range.
  let low = 0;
  let high = value.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(cut(middle))) low = middle;
    else high = middle - 1;
  }
  return cut(low);
}

/** Draws `lines`, one baseline every `lineHeight` from `y`, in the current style. Returns the baseline that follows. */
export function drawLines(
  ctx: DrawingContext,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  align?: TextAlign,
): number {
  lines.forEach((line, index) => ctx.doc.text(line, x, y + index * lineHeight, { align }));
  return y + lines.length * lineHeight;
}

/** A wrapped line and its width (mm) in the font it was wrapped with. */
export interface MeasuredLine {
  text: string;
  width: number;
}

/** Slack (mm) on the room a width is checked against: far under a visible overflow, over any rounding error. */
const FRAME_SLACK = 1e-6;

/**
 * A checked `width` (mm), or `room` (mm) with a warning when it is wider. `what` names the option in the warning;
 * `detail` says what reduces the room, or is empty when nothing does.
 */
export function fitToRoom(ctx: DrawingContext, what: string, width: number, room: number, detail: string): number {
  // A width built from the same parts in another order (`(a - b) - c` against `a - (b + c)`) may be a rounding error
  // over the room: that is no overflow.
  if (width <= room + FRAME_SLACK) return width;
  ctx.addWarning(
    `${what} of ${width.toFixed(1)} mm is wider than the available width (${room.toFixed(1)} mm` +
      `${detail === '' ? '' : `, ${detail}`}): it is brought down to fit`,
  );
  return room;
}

/**
 * A checked `width` (mm), brought down with a warning to what the frame leaves right of `indent` when it is wider: a
 * block never leaves its frame, as a table never does. `what` names the option in the warning.
 */
export function frameWidth(ctx: DrawingContext, what: string, width: number, indent = 0): number {
  return fitToRoom(
    ctx,
    what,
    width,
    ctx.contentWidth - indent,
    indent === 0 ? '' : `the content width less the ${indent.toFixed(1)} mm indent`,
  );
}

/** The indent (mm) of a text block, and its line width (mm) before `fitLineWidth` brings a `maxWidth` into the frame. */
export interface LineFrame {
  indent: number;
  width: number;
}

/**
 * The indent and the line width (mm) a text block of `options` takes: `maxWidth`, else the measure minus the indent.
 * Throws an `InvalidOptionError` for an indent that is not a number, a width that is not above 0, or an indent that
 * leaves a `maxWidth` no room in the frame, before anything is drawn.
 */
export function resolveLineWidth(
  ctx: DrawingContext,
  what: string,
  options?: { indent?: number; maxWidth?: number },
): LineFrame {
  const indent = optionalNumber(`${what} indent (mm)`, options?.indent) ?? 0;
  const maxWidth = optionalNumber(`${what} maxWidth (mm)`, options?.maxWidth, POSITIVE);
  if (maxWidth === undefined) {
    const width = checkedNumber(
      () => `${what} width (the ${ctx.measure} mm measure less its indent)`,
      ctx.measure - indent,
      POSITIVE,
    );
    return { indent, width };
  }
  checkedNumber(
    () => `${what} width (the ${ctx.contentWidth} mm content width less its indent)`,
    ctx.contentWidth - indent,
    POSITIVE,
  );
  return { indent, width: maxWidth };
}

/**
 * The line width of `frame` once there is text to lay out: a `maxWidth` wider than what the frame leaves right of the
 * indent is brought down to it, with a warning (`frameWidth`). The default width, from the measure, always fits.
 */
export function fitLineWidth(ctx: DrawingContext, what: string, frame: LineFrame): number {
  return frameWidth(ctx, `${what} maxWidth`, frame.width, frame.indent);
}

/**
 * Width (mm) left for text in a frame `width` wide once `taken` mm are set aside (padding, an icon, a gap). Throws an
 * `InvalidOptionError` naming `what` when nothing is left, or when `width` is not a finite number, before anything is
 * drawn.
 */
export function remainingTextWidth(what: string, width: number, taken: number): number {
  // A width that is not a number must not reach the subtraction, which would read `'50'` as 50.
  const left = typeof width === 'number' ? width - taken : Number.NaN;
  return checkedNumber(() => `text width of ${what} (${String(width)} mm less ${taken} mm)`, left, POSITIVE);
}

/**
 * Wraps text to `width` with the current font and `charSpace` (see `trackedWidth`), one paragraph at a time
 * (`wrapLine`). A word wider than `width` (email, IBAN, URL) goes through `breakLongToken` instead of being cut
 * mid-token.
 */
export function wrap(ctx: DrawingContext, value: string, width: number, charSpace = 0): string[] {
  return wrapMeasured(ctx, value, width, charSpace).map((line) => line.text);
}

/** `wrap` with the width of each line, measured while wrapping. */
export function wrapMeasured(ctx: DrawingContext, value: string, width: number, charSpace = 0): MeasuredLine[] {
  return value.split(/\r?\n/).flatMap((paragraph) => wrapLineMeasured(ctx, paragraph, width, charSpace));
}

function collapseSpaces(value: string): string {
  return value.trim().replace(/ +/g, ' ');
}

/** `wrap` for one source line (no line break in it). */
export function wrapLine(ctx: DrawingContext, line: string, width: number, charSpace = 0): string[] {
  return wrapLineMeasured(ctx, line, width, charSpace).map((measured) => measured.text);
}

/**
 * 1. a line that fits is returned as is;
 * 2. otherwise jsPDF `splitTextToSize` wraps it, and its result is kept when it only broke at spaces and
 *    no produced line exceeds `width`. jsPDF cuts an oversized word by character, so the produced lines
 *    would still fit: the cut shows as lines that no longer rejoin, with spaces, into the source line.
 *    jsPDF ignores `charSpace`: a tracked line it lets overflow fails the width check;
 * 3. otherwise a greedy wrap breaks the oversized word with `breakLongToken`.
 */
function wrapLineMeasured(ctx: DrawingContext, line: string, width: number, charSpace: number): MeasuredLine[] {
  const { doc } = ctx;
  const measure = (value: string) => trackedWidth(doc, value, charSpace);
  const lineWidth = measure(line);
  if (lineWidth <= width) return [{ text: normalizeText(line), width: lineWidth }];
  const split = doc.splitTextToSize(line, width) as string[];
  if (collapseSpaces(split.join(' ')) === collapseSpaces(normalizeText(line))) {
    const measured = split.map((produced) => ({ text: produced, width: measure(produced) }));
    if (measured.every((produced) => produced.width <= width)) return measured;
  }
  const words = normalizeText(line).split(' ');
  return wrapWithLongWords(ctx, words, words.map(measure), width, charSpace);
}

/** Greedy wrap of one paragraph where some word exceeds `width`. Each word is measured once. */
function wrapWithLongWords(
  ctx: DrawingContext,
  words: string[],
  wordWidths: number[],
  width: number,
  charSpace: number,
): MeasuredLine[] {
  const { doc } = ctx;
  // A space adds its width and the letter spacing before it; a word after it adds the spacing before the word.
  const spaceWidth = doc.getTextWidth(' ') + charSpace;
  const lines: MeasuredLine[] = [];
  let line = '';
  let lineWidth = 0;
  words.forEach((word, index) => {
    const wordWidth = wordWidths[index];
    const withWordWidth = line ? lineWidth + spaceWidth + (word ? charSpace : 0) + wordWidth : wordWidth;
    if (withWordWidth <= width) {
      line = line ? `${line} ${word}` : word;
      lineWidth = withWordWidth;
      return;
    }
    if (line) {
      lines.push({ text: line, width: lineWidth });
      line = '';
    }
    if (wordWidth <= width) {
      line = word;
      lineWidth = wordWidth;
      return;
    }
    const broken = breakLongToken(ctx, word, width, charSpace);
    for (const part of broken.slice(0, -1)) lines.push({ text: part, width: trackedWidth(doc, part, charSpace) });
    line = broken[broken.length - 1];
    lineWidth = trackedWidth(doc, line, charSpace);
  });
  lines.push({ text: line, width: lineWidth });
  return lines;
}

/** Segments end after a delimiter (`.` `/` `\` `_` `-`), which stays on the left. */
const SEGMENT_BREAK = /(?<=[./\\_-])/;

/**
 * Splits a token wider than `width` (email, IBAN, URL) into lines. It cuts at `@` first (local part
 * and `@` on one line, domain on the next), then packs each side at `.` `/` `_` `-`. Only a segment
 * that is still too wide is cut by character. The current font must be set by the caller.
 */
export function breakLongToken(ctx: DrawingContext, token: string, width: number, charSpace = 0): string[] {
  const { doc } = ctx;
  const at = token.lastIndexOf('@');
  const groups = at >= 0 ? [token.slice(0, at + 1), token.slice(at + 1)] : [token];
  const lines: string[] = [];
  for (const group of groups) {
    let line = '';
    let lineWidth = 0;
    for (const segment of group.split(SEGMENT_BREAK)) {
      const segmentWidth = trackedWidth(doc, segment, charSpace);
      // Joining adds the letter spacing between the line and the segment.
      if (line && lineWidth + charSpace + segmentWidth <= width) {
        line += segment;
        lineWidth += charSpace + segmentWidth;
        continue;
      }
      if (line) lines.push(line);
      line = segment;
      lineWidth = segmentWidth;
      if (segmentWidth > width) {
        const pieces = chopByCharacter(ctx, line, width, charSpace);
        lines.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1];
        lineWidth = trackedWidth(doc, line, charSpace);
      }
    }
    if (line) lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
}

/**
 * Last resort for a segment wider than `width`: jsPDF chops it by character. `splitTextToSize` ignores the letter
 * spacing, so a tracked segment gets a greedy cut instead.
 */
function chopByCharacter(ctx: DrawingContext, segment: string, width: number, charSpace: number): string[] {
  const { doc } = ctx;
  if (!charSpace) return doc.splitTextToSize(segment, width) as string[];
  const pieces: string[] = [];
  let piece = '';
  for (const char of segment) {
    if (piece && trackedWidth(doc, piece + char, charSpace) > width) {
      pieces.push(piece);
      piece = char;
    } else {
      piece += char;
    }
  }
  pieces.push(piece);
  return pieces;
}

/**
 * Word offsets that stretch `line` to exactly `width`. Spaces are the only stretch points: U+00A0
 * stays rigid, so amounts never split apart.
 */
function layoutJustifiedLine(doc: jsPDF, line: string, width: number): Array<{ word: string; offset: number }> {
  const words = line.split(' ').filter((word) => word.length > 0);
  if (words.length < 2) return [{ word: line.trim(), offset: 0 }];

  const widths = words.map((word) => doc.getTextWidth(word));
  // A line already wider than `width` (an unbreakable word) keeps natural spacing instead of overlapping words.
  const natural = doc.getTextWidth(' ');
  const gap = Math.max(natural, (width - widths.reduce((sum, w) => sum + w, 0)) / (words.length - 1));

  let offset = 0;
  return words.map((word, index) => {
    const placed = { word, offset };
    offset += widths[index] + gap;
    return placed;
  });
}

/**
 * jsPDF only justifies a whole block passed with `maxWidth`, and then owns line breaks and Y, which
 * defeats per-line page breaks. So justified lines are laid out here, word by word. Word placement
 * also works with embedded (Identity-H) fonts, where PDF word spacing has no effect.
 */
export function drawJustifiedLine(ctx: DrawingContext, line: string, x: number, y: number, width: number): void {
  for (const { word, offset } of layoutJustifiedLine(ctx.doc, line, width)) {
    ctx.doc.text(word, x + offset, y);
  }
}
