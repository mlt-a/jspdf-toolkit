/**
 * Inline emphasis markup: `**bold**`, `*italic*`, nesting (`**bold *and italic***`) and `\*` to escape
 * a star. Anything unmatched renders literally, so `3 * 4` or a lone `**` never disappears.
 * Pure: no PDF dependency.
 */

import { checkedText } from '../core/errors';

/** A piece of inline text and its emphasis. `link` makes it a hyperlink. */
export interface RichInline {
  /** The text of the run, without markup. */
  text: string;
  /** Drawn in bold. */
  bold?: boolean;
  /** Drawn in italics. */
  italic?: boolean;
  /** Target URL: the run is underlined and clickable. */
  link?: string;
}

/** A block of rich content: a paragraph, a bullet list or a numbered list (one run array per item). */
export type RichBlock =
  | {
      /** A paragraph of inline runs. */
      type: 'paragraph';
      /** The runs of the paragraph, in order. */
      runs: RichInline[];
    }
  | {
      /** A bulleted list. */
      type: 'bulletList';
      /** One array of runs per item. */
      items: RichInline[][];
    }
  | {
      /** A numbered list. */
      type: 'numberedList';
      /** One array of runs per item. */
      items: RichInline[][];
    };

type Emphasis = 'bold' | 'italic';

/** A run of unescaped stars, linked into the delimiter stack while it may still open or close. */
interface StarRun {
  /** Order in the text: openers below a closer's bottom are never scanned again. */
  position: number;
  /** Stars as typed, for the multiple-of-3 rule. */
  length: number;
  /** Stars not yet matched: rendered literally. */
  count: number;
  canOpen: boolean;
  canClose: boolean;
  /** Emphasis closed by its first stars, then opened by its last ones. */
  closes: Emphasis[];
  opens: Emphasis[];
  previous: StarRun | null;
  next: StarRun | null;
}

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);

/**
 * Markup → runs, adjacent runs of the same emphasis merged. CommonMark's delimiter stack, for `*` only:
 * a run opens when a non-space follows it and closes when a non-space precedes it, so a star between two
 * words may do both. A closer takes the nearest compatible opener; `***` gives bold and italic. Throws an
 * `InvalidOptionError` for a `markup` that is no string.
 *
 *
 * @example
 * ```ts
 * import { parseRichInline } from '@mlt-a/jspdf-toolkit';
 *
 * parseRichInline('Net **30** days');
 * // [{ text: 'Net ' }, { text: '30', bold: true }, { text: ' days' }]
 * ```
 */
export function parseRichInline(markup: string): RichInline[] {
  checkedText('rich markup', markup);
  const tokens: Array<string | StarRun> = [];
  let first: StarRun | null = null;
  let top: StarRun | null = null;
  let text = '';
  for (let i = 0; i < markup.length; ) {
    const char = markup[i];
    if (char === '\\' && (markup[i + 1] === '*' || markup[i + 1] === '\\')) {
      text += markup[i + 1];
      i += 2;
      continue;
    }
    if (char !== '*') {
      text += char;
      i += 1;
      continue;
    }
    let end = i;
    while (markup[end] === '*') end += 1;
    if (text) tokens.push(text);
    text = '';
    const length = end - i;
    const run: StarRun = {
      position: tokens.length,
      length,
      count: length,
      canOpen: !isSpace(markup[end]),
      canClose: !isSpace(markup[i - 1]),
      closes: [],
      opens: [],
      previous: top,
      next: null,
    };
    tokens.push(run);
    if (run.canOpen || run.canClose) {
      if (top) top.next = run;
      else first = run;
      top = run;
    } else {
      run.previous = null;
    }
    i = end;
  }
  if (text) tokens.push(text);

  matchEmphasis(first);

  const runs: RichInline[] = [];
  const push = (value: string, bold: boolean, italic: boolean) => {
    if (value === '') return;
    const last = runs[runs.length - 1];
    if (last && !!last.bold === bold && !!last.italic === italic) {
      last.text += value;
      return;
    }
    runs.push({ text: value, ...(bold && { bold }), ...(italic && { italic }) });
  };
  const depth = { bold: 0, italic: 0 };
  for (const token of tokens) {
    if (typeof token === 'string') {
      push(token, depth.bold > 0, depth.italic > 0);
      continue;
    }
    for (const emphasis of token.closes) depth[emphasis] -= 1;
    push('*'.repeat(token.count), depth.bold > 0, depth.italic > 0);
    for (const emphasis of token.opens) depth[emphasis] += 1;
  }
  return runs;
}

/**
 * CommonMark "process emphasis". Each closer, left to right, looks back for an opener; star runs between
 * a matched pair leave the stack and stay literal. A failed lookup records how far down it went, per kind
 * of closer, so no opener is scanned twice by closers of the same kind: the pass stays linear.
 */
function matchEmphasis(first: StarRun | null): void {
  const remove = (run: StarRun) => {
    if (run.previous) run.previous.next = run.next;
    if (run.next) run.next.previous = run.previous;
  };
  // Indexed by the closer's `canOpen` and its length modulo 3, the two inputs of the matching rule.
  const bottoms = [-1, -1, -1, -1, -1, -1];
  let closer = first;
  while (closer) {
    if (!closer.canClose) {
      closer = closer.next;
      continue;
    }
    const kind = (closer.canOpen ? 3 : 0) + (closer.length % 3);
    let opener = closer.previous;
    while (opener && opener.position > bottoms[kind]) {
      // A run that may open and close only pairs when the lengths do not add up to a multiple of 3.
      const oddMatch =
        (closer.canOpen || opener.canClose) && closer.length % 3 !== 0 && (opener.length + closer.length) % 3 === 0;
      if (opener.canOpen && !oddMatch) break;
      opener = opener.previous;
    }
    if (!opener || opener.position <= bottoms[kind]) {
      bottoms[kind] = closer.previous?.position ?? -1;
      const next: StarRun | null = closer.next;
      if (!closer.canOpen) remove(closer);
      closer = next;
      continue;
    }
    const strong = opener.count >= 2 && closer.count >= 2;
    const emphasis: Emphasis = strong ? 'bold' : 'italic';
    opener.count -= strong ? 2 : 1;
    closer.count -= strong ? 2 : 1;
    // The opener's last stars and the closer's first ones: an earlier match sits further out.
    opener.opens.unshift(emphasis);
    closer.closes.push(emphasis);
    opener.next = closer;
    closer.previous = opener;
    if (opener.count === 0) remove(opener);
    if (closer.count === 0) {
      const next: StarRun | null = closer.next;
      remove(closer);
      closer = next;
    }
  }
}

// Collapses whitespace runs but keeps non-breaking and thin spaces, which hold amounts together.
const COLLAPSIBLE_SPACE = /[^\S\u00a0\u202f\u2007\u2009]+/g;

/**
 * Markup → paragraph blocks. Paragraphs are separated by a blank line; other line breaks are spaces. Throws an
 * `InvalidOptionError` for a `markup` that is no string.
 *
 * @example
 * ```ts
 * import { parseRichText } from '@mlt-a/jspdf-toolkit';
 *
 * doc.bulletList([{ text: 'Warranty', detail: parseRichText('Two years, **parts and labour**.') }]);
 * ```
 */
export function parseRichText(markup: string): RichBlock[] {
  checkedText('rich markup', markup);
  return markup
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(COLLAPSIBLE_SPACE, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => ({ type: 'paragraph', runs: parseRichInline(paragraph) }));
}
