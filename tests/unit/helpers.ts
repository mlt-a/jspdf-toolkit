import { expect, vi } from 'vitest';

import type { DrawingContext } from '../../src/core/context';
import type { DocumentOptions } from '../../src/core/document';
import { PDFDocument } from '../../src/core/document';
import { InvalidOptionError } from '../../src/core/errors';
import type { InsetOptions } from '../../src/core/inset';
import { lineStyle } from '../../src/drawing/drawing-state';
import { loadImageFromPath } from '../../src/node';
import { createTheme } from '../../src/theme/defaults';
import type { FilledShape, GraphicsStateOpacity, StrokedShape } from './content-stream';
import { scanStream } from './content-stream';

/** A document on the default layout, themed with a fixed primary color. */
export function makeDoc(options: DocumentOptions = {}): PDFDocument {
  return new PDFDocument({ theme: createTheme({ colors: { primary: '#3572B8' } }), ...options });
}

/** A 1x1 PNG as a data URI. */
export const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A 4x1 PNG, four times as wide as it is tall, as a data URI. */
export const WIDE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAADUlEQVR4nGNocFCAIwAYTQOBMAW23AAAAABJRU5ErkJggg==';

/** A 1x2 PNG, twice as tall as it is wide, as a data URI. */
export const TALL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAIAAAAW4yFwAAAADklEQVR4nGNocFBgAGIAB8gBwYvNqyMAAAAASUVORK5CYII=';

export const LOGO_PATH = 'assets/logos/logo-icon.png';

let logo: string | undefined;

/** The logo file as a data URI; read on first use, then kept for the calls that follow in the same file. */
export const loadLogo = (): string => (logo ??= loadImageFromPath(LOGO_PATH));

/** A paragraph that wraps over several lines in any box or column of the layout. */
export const LONG =
  'The undersigned confirms that every regulatory filing required under applicable national and European law ' +
  'has been submitted within the prescribed deadlines, and that this statement is a binding commitment of the ' +
  'company towards its shareholders for the whole of the current reporting period and the following one.';

/** The channels of a #RRGGBB color; jsPDF's 3-decimal round trip can shift one by one. */
export const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export type DrawnText = {
  lines: string[];
  /** Width (mm) of each line, in the font it is drawn in. */
  widths: number[];
  x: number;
  y: number;
  page: number;
  align?: string;
  /** jsPDF face the text is drawn in, e.g. `'bold'`. */
  fontStyle: string;
  /** Text color, as jsPDF reads it back. */
  color: string;
};

/** Records every text call from now on, a multi-line call as one entry, with its style, and lets it through. */
export function recordTexts(doc: PDFDocument): DrawnText[] {
  const drawn: DrawnText[] = [];
  const original = doc.doc.text.bind(doc.doc);
  vi.spyOn(doc.doc, 'text').mockImplementation(((...args: Parameters<typeof original>) => {
    const [value, x, y, options] = args;
    const lines = [value].flat().map(String);
    drawn.push({
      lines,
      widths: lines.map((line) => doc.doc.getTextWidth(line)),
      x: x as number,
      y: y as number,
      page: currentPage(doc),
      align: (options as { align?: string } | undefined)?.align,
      fontStyle: doc.doc.getFont().fontStyle,
      color: doc.doc.getTextColor(),
    });
    return original(...args);
  }) as typeof original);
  return drawn;
}

/** The first recorded text call whose first line is `label`. */
export const textOf = (texts: DrawnText[], label: string) => texts.find((call) => call.lines[0] === label)!;

/**
 * The last recorded text call whose first line is `label`: the one drawn after the measuring passes of `keepTogether`.
 */
export const lastText = (texts: DrawnText[], label: string) => texts.findLast((call) => call.lines[0] === label)!;

/** Y of the first recorded text call whose first line is `label`. */
export const titleY = (texts: DrawnText[], label: string) => textOf(texts, label).y;

/** Expects every recorded line, left-aligned, to lie between `left` and `right` (mm). */
export function expectTextWithin(texts: DrawnText[], left: number, right: number): void {
  expect(texts.length).toBeGreaterThan(0);
  for (const call of texts) {
    expect(call.x, call.lines[0]).toBeGreaterThanOrEqual(left - 0.01);
    for (const width of call.widths) expect(call.x + width, call.lines[0]).toBeLessThanOrEqual(right + 0.01);
  }
}

export type Extent = { what: string; from: number; to: number; page: number };

/** Expects every extent to lie between `from` and `to` (mm), and at least one to be recorded. */
export function expectWithin(extents: Extent[], from: number, to: number, tolerance = 0.01): void {
  expect(extents.length).toBeGreaterThan(0);
  for (const extent of extents) {
    expect(extent.from, `${extent.what} on page ${extent.page}`).toBeGreaterThanOrEqual(from - tolerance);
    expect(extent.to, `${extent.what} on page ${extent.page}`).toBeLessThanOrEqual(to + tolerance);
  }
}

/**
 * Records the horizontal extent of every drawing call from now on: text (its width measured in the font it is drawn in,
 * its alignment applied), rectangles, lines, the points of paths, images and links. Call it before `recordTexts`, which
 * spies on
 * `text` after this patch.
 */
export function recordExtents(doc: PDFDocument): Extent[] {
  const extents: Extent[] = [];
  const pdf = doc.doc;
  const push = (what: string, from: number, to: number) =>
    extents.push({ what, from: Math.min(from, to), to: Math.max(from, to), page: currentPage(doc) });
  const wrap = <K extends 'text' | 'rect' | 'roundedRect' | 'line' | 'moveTo' | 'lineTo' | 'addImage' | 'link'>(
    method: K,
    note: (args: unknown[]) => void,
  ) => {
    const original = (pdf[method] as (...args: unknown[]) => unknown).bind(pdf);
    // Patched rather than spied: `recordTexts` spies on `text` after it.
    (pdf as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      note(args);
      return original(...args);
    };
  };
  wrap('text', ([value, x, , options]) => {
    const { align, charSpace = 0 } = (options ?? {}) as { align?: string; charSpace?: number };
    for (const line of [value].flat().map(String)) {
      if (line.trim() === '') continue;
      const width = pdf.getTextWidth(line) + charSpace * line.length;
      const left = align === 'right' ? (x as number) - width : align === 'center' ? (x as number) - width / 2 : x;
      push(`text "${line}"`, left as number, (left as number) + width);
    }
  });
  wrap('rect', ([x, , width]) => push('rect', x as number, (x as number) + (width as number)));
  wrap('roundedRect', ([x, , width]) => push('roundedRect', x as number, (x as number) + (width as number)));
  wrap('line', ([x1, , x2]) => push('line', x1 as number, x2 as number));
  wrap('moveTo', ([x]) => push('path point', x as number, x as number));
  wrap('lineTo', ([x]) => push('path point', x as number, x as number));
  wrap('addImage', ([, x, , width]) => push('image', x as number, (x as number) + (width as number)));
  wrap('link', ([x, , width]) => push('link', x as number, (x as number) + (width as number)));
  return extents;
}

/** Leaves `room` mm above the bottom of the content area, under a paragraph so the page does not count as fresh. */
export function leaveRoom(doc: PDFDocument, room: number): PDFDocument {
  doc.paragraph('Opening text.');
  doc.setYPos(doc.layout.bottom(doc.pageHeight) - room);
  return doc;
}

/** The drawing state jsPDF keeps in JS, which a primitive must leave as it found it. */
export function drawingState(doc: PDFDocument) {
  const { fontName, fontStyle } = doc.doc.getFont();
  const { cap, join } = lineStyle(doc.doc);
  return {
    fontName,
    fontStyle,
    fontSize: doc.doc.getFontSize(),
    textColor: doc.doc.getTextColor(),
    fillColor: doc.doc.getFillColor(),
    drawColor: doc.doc.getDrawColor(),
    lineWidth: doc.doc.getLineWidth(),
    lineCap: cap,
    lineJoin: join,
  };
}

/** Sets a drawing state no primitive uses, so a leak shows. */
export function setForeignState(doc: PDFDocument): void {
  doc.doc.setFont('courier', 'bolditalic');
  doc.doc.setFontSize(7.5);
  doc.doc.setTextColor('#123456');
  doc.doc.setFillColor('#abcdef');
  doc.doc.setDrawColor('#fedcba');
  doc.doc.setLineWidth(0.9);
  doc.doc.setLineCap('square');
  doc.doc.setLineJoin('bevel');
}

/** What a user callback may do: change every piece of state a primitive restores, and draw. */
export function changeEverything(ctx: PDFDocument): void {
  ctx.doc.setFont('times', 'italic');
  ctx.doc.setFontSize(48);
  ctx.doc.setTextColor('#ff0000');
  ctx.doc.setFillColor('#00ff00');
  ctx.doc.setDrawColor('#0000ff');
  ctx.doc.setLineWidth(3);
  ctx.doc.setLineCap('round');
  ctx.doc.setLineJoin('round');
  ctx.doc.text('Drawn', 20, 40);
}

/** The content stream of a page, as jsPDF has written it so far. */
export const pageStream = (doc: PDFDocument, page: number) =>
  (doc.doc.internal.pages[page] as unknown as string[]).join('\n');

export const currentPage = (doc: PDFDocument) => doc.pageNumber;
export const lastEntryPage = (doc: PDFDocument) => doc.pageRefs.tocEntries.at(-1)!.page;

/**
 * Computed height must equal the Y advance of the drawing (spacing after is 0 in every case), on a new document or
 * on `ctx`, such as the document a column receives.
 */
export function expectDrawnHeight<C, T extends { spaceAfter?: number }>(
  compute: (ctx: DrawingContext, content: C, options: T) => number,
  draw: (ctx: DrawingContext, content: C, options: T) => unknown,
  content: C,
  options: T,
  ctx: DrawingContext = makeDoc(),
): DrawingContext {
  const height = compute(ctx, content, options);
  const startY = ctx.getYPos();
  draw(ctx, content, options);
  expect(ctx.getYPos() - startY).toBeCloseTo(height, 6);
  return ctx;
}

/** What the blocks read of the frame they are drawn in, copied. */
export const frameOf = (doc: PDFDocument) => ({
  margins: { ...doc.margins },
  contentWidth: doc.contentWidth,
  measure: doc.measure,
});

/** What `fn` returns, run in an inset of `options`. */
export function inInset<T>(doc: PDFDocument, options: InsetOptions, fn: () => T): T {
  let result!: T;
  doc.inset(options, () => {
    result = fn();
  });
  return result;
}

/** Values a number option never takes: not finite, or not a number at all. */
export const NOT_FINITE = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '5' as unknown as number,
  // Set, `null` is a value like any other: it is no stand-in for a default.
  null as unknown as number,
];

/** The jsPDF calls that put something on a page. */
const DRAWING_METHODS = [
  'text',
  'rect',
  'roundedRect',
  'line',
  'lines',
  'circle',
  'ellipse',
  'moveTo',
  'addImage',
  'link',
] as const;

/** Spies on every jsPDF call that draws; `nothingDrawn` expects none of them to have been made since. */
export function watchDrawing(doc: PDFDocument): { nothingDrawn: () => void } {
  const spies = DRAWING_METHODS.map((method) => [method, vi.spyOn(doc.doc, method)] as const);
  return {
    nothingDrawn: () => {
      for (const [method, spy] of spies) expect(spy, method).not.toHaveBeenCalled();
    },
  };
}

/**
 * `call` throws an `InvalidOptionError` before anything is drawn, a page added, the position moved or a warning
 * raised.
 */
export function expectRejectedBeforeDrawing(doc: PDFDocument, call: () => unknown): void {
  const drawing = watchDrawing(doc);
  const start = doc.peekYPos();
  const pages = doc.doc.getNumberOfPages();
  const warnings = [...doc.warnings];
  expect(call).toThrow(InvalidOptionError);
  drawing.nothingDrawn();
  expect(doc.peekYPos()).toBe(start);
  expect(doc.doc.getNumberOfPages()).toBe(pages);
  expect(doc.warnings).toEqual(warnings);
}

/**
 * Draws `draw` in the first of two columns, a paragraph in the second, and returns the frame of the first one: its
 * left edge and its width (mm).
 */
export function inFirstOfTwoColumns(
  doc: PDFDocument,
  draw: (column: PDFDocument) => unknown,
): { left: number; width: number } {
  let frame!: { left: number; width: number };
  doc.columns([
    (column) => {
      frame = { left: column.margins.left, width: column.contentWidth };
      draw(column);
    },
    (column) => column.paragraph('Beside.'),
  ]);
  return frame;
}

/** The opacities of the extended graphics states of the document (`GS1`…), as its PDF output writes them. */
export function graphicsStatesOf(doc: PDFDocument): Record<string, GraphicsStateOpacity> {
  const pdf = doc.doc.output();
  const states: Record<string, GraphicsStateOpacity> = {};
  const dictionary = /\/ExtGState <<\n([^>]*)>>/.exec(pdf)?.[1] ?? '';
  for (const [, key, object] of dictionary.matchAll(/\/(\S+) (\d+) 0 R/g)) {
    const entries = new RegExp(`\\n${object} 0 obj\\n<<\\n([^>]*)>>`).exec(pdf)![1];
    const opacity: GraphicsStateOpacity = {};
    for (const entry of entries.trim().split('\n')) {
      const [, field, value] = /^\/(ca|CA) ([\d.]+)$/.exec(entry) ?? [];
      if (field === undefined) throw new Error(`Graphics state ${key} sets what the reader does not follow: ${entry}`);
      opacity[field === 'ca' ? 'fill' : 'stroke'] = Number(value);
    }
    states[key] = opacity;
  }
  return states;
}

type MediaBox = { bottomLeftX: number; bottomLeftY: number; topRightX: number; topRightY: number };

/** What jsPDF keeps of a page until it writes the PDF: its media box (points) and its annotations. */
export const pageContext = (doc: PDFDocument, page: number) =>
  (
    doc.doc.internal as unknown as {
      getPageInfo(page: number): { pageContext: { mediaBox: MediaBox; annotations: unknown[] } };
    }
  ).getPageInfo(page).pageContext;

/** Page `page` as the stream reader reads it: `k` points per unit, and its size in units, from its own media box. */
export function pageFrame(doc: PDFDocument, page: number) {
  const k = doc.doc.internal.scaleFactor;
  const { mediaBox } = pageContext(doc, page);
  return {
    k,
    width: (mediaBox.topRightX - mediaBox.bottomLeftX) / k,
    height: (mediaBox.topRightY - mediaBox.bottomLeftY) / k,
  };
}

/**
 * Reads the pages up to `last` in one pass each: the shapes they fill and stroke (see `filledShapes`,
 * `strokedShapes`), and every mark they paint. A page starts black in PDF, and jsPDF keeps its fill color from one
 * page to the next without writing it again (the document does): `intended` starts, on each page, with the one the
 * pages before it ended on.
 */
export function scanPages(doc: PDFDocument, last = doc.doc.getNumberOfPages()) {
  const pages = Array.from({ length: last }, (_, index) => index + 1);
  // Writing the PDF out is the one way to read the graphics states: only done when a page names one.
  const states = pages.some((page) => / gs\b/.test(pageStream(doc, page))) ? graphicsStatesOf(doc) : {};
  let intended = '#000000';
  return pages.map((page) => {
    const { k, height } = pageFrame(doc, page);
    const scan = scanStream(pageStream(doc, page), k, height, intended, states);
    intended = scan.intended;
    return scan;
  });
}

/** `scanPages` for page `page`. */
export const scanPage = (doc: PDFDocument, page: number) => scanPages(doc, page)[page - 1];

/**
 * Every shape a page fills (`re` or a path followed by `f`, `f*`, `F`, `B`, `B*`, `b`, `b*`), with the color it is
 * really filled with. Follows the graphics state of the content stream: a fill color set by `rg`, `g` or `k`, including
 * the one every text block sets for its text (in PDF the text color is the fill color), and `q`/`Q`. What jsPDF
 * reports through `getFillColor` is not that color.
 */
export const filledShapes = (doc: PDFDocument, page: number): FilledShape[] => scanPage(doc, page).shapes;

/**
 * Every shape a page strokes (a path followed by `S`, `s`, `B`, `B*`, `b`, `b*`), with the color, width, cap and join
 * it is really stroked with: set by `RG`, `G`, `K`, `w`, `J` and `j`, undone by `Q`, from the PDF defaults (black,
 * 1 point, butt, miter) at the top of the page.
 */
export const strokedShapes = (doc: PDFDocument, page: number): StrokedShape[] => scanPage(doc, page).strokes;

/** Whether two #rrggbb colors are the same one: the PDF color operators round to two decimals. */
export const sameColor = (a: string, b: string) =>
  channels(a).every((level, i) => Math.abs(level - channels(b)[i]) <= 2);
