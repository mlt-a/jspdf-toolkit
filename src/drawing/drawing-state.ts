import type { jsPDF } from 'jspdf';

import type { DrawingContext } from '../core/context';
import { hexToRgb } from '../theme/colors';

/**
 * Read back, a jsPDF color is rounded down to a whole level but written rounded to three decimals: a fifth of a level
 * is added so it comes back on the same level, capped at 255 (an operand over 1 is not valid PDF).
 * A color written back is RGB, since jsPDF reads every color back as RGB hex: a CMYK color not written back keeps its
 * CMYK operator.
 */
function colorLevels(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [Math.min(255, r + 0.2), Math.min(255, g + 0.2), Math.min(255, b + 0.2)];
}

/** Line cap and join, as PDF numbers: 0 butt and miter, 1 round, 2 square and bevel. */
export interface LineStyle {
  cap: number;
  join: number;
}

/** Where the page a fill color was last written ends: the page and the length of its content stream just after. */
interface WritePosition {
  page: unknown;
  length: number;
}

interface TrackedState extends LineStyle {
  /** The cap and join setters are intercepted. */
  tracked: boolean;
  /** Where `restateFillColor` and `withDrawingState` last wrote the fill color. */
  fill?: WritePosition;
}

const trackedStates = new WeakMap<jsPDF, TrackedState>();

function stateOf(doc: jsPDF): TrackedState {
  let state = trackedStates.get(doc);
  if (!state) trackedStates.set(doc, (state = { cap: 0, join: 0, tracked: false }));
  return state;
}

/** `native`, then `record` with the same arguments: the native method throws on a wrong value before it is recorded. */
const after = <F extends (...args: never[]) => jsPDF>(native: F, record: (...args: Parameters<F>) => void): F =>
  ((...args: Parameters<F>) => {
    const result = native(...args);
    record(...args);
    return result;
  }) as F;

/**
 * Records the line cap and join `doc` sets from now on, and what `restoreGraphicsState` puts back. Only these are
 * intercepted: jsPDF has a getter for every other value `withDrawingState` restores, and none for these. Calling it
 * again on the same document does nothing.
 */
export function trackDrawingState(doc: jsPDF): void {
  const state = stateOf(doc);
  if (state.tracked) return;
  state.tracked = true;
  // q/Q put cap and join back in the PDF, so they go back here too: a cap set in a saved state does not outlive it.
  const saved: LineStyle[] = [];
  doc.saveGraphicsState = after(doc.saveGraphicsState.bind(doc), () =>
    saved.push({ cap: state.cap, join: state.join }),
  );
  // A save made before the tracking began has nothing recorded: the cap and join stay as they are.
  doc.restoreGraphicsState = after(doc.restoreGraphicsState.bind(doc), () => Object.assign(state, saved.pop()));
  const ids = doc.CapJoinStyles as Record<string | number, number>;
  doc.setLineCap = after(doc.setLineCap.bind(doc), (value) => (state.cap = ids[value]));
  doc.setLineJoin = after(doc.setLineJoin.bind(doc), (value) => (state.join = ids[value]));
}

/** The line cap and join `doc` last set. A document `trackDrawingState` never saw reads the PDF defaults. */
export function lineStyle(doc: jsPDF): LineStyle {
  const { cap, join } = stateOf(doc);
  return { cap, join };
}

/** The page drawing goes to, and how many lines its content stream holds: a write to the page makes it grow. */
function writePosition(doc: jsPDF): WritePosition {
  const { pageNumber, pageContext } = doc.getCurrentPageInfo();
  return { page: pageContext, length: (doc.internal.pages[pageNumber] as unknown as string[]).length };
}

/**
 * Writes the fill color jsPDF reports to the current page. In PDF the text color is also the fill color, and a new
 * page starts black, while jsPDF keeps reporting the fill it last set.
 */
export function restateFillColor(doc: jsPDF): void {
  writeFillColor(doc, doc.getFillColor());
}

/** Writes `hex` as the fill color and remembers where: a scope ending there has nothing to write again. */
function writeFillColor(doc: jsPDF, hex: string): void {
  doc.setFillColor(...colorLevels(hex));
  stateOf(doc).fill = writePosition(doc);
}

const samePosition = (a: WritePosition | undefined, b: WritePosition) =>
  a !== undefined && a.page === b.page && a.length === b.length;

/**
 * Runs `fn` and puts back the font, size, text, fill and draw colors, line width, cap and join it found, so a
 * primitive never leaks its style to the next one. Only what changed is written back, and the fill color when the
 * scope wrote to the page or moved to another one (text and `Q` change the fill in force, and jsPDF does not say so),
 * unless the fill was just written there by a scope nested in it: a scope that writes nothing adds nothing to the
 * page. The state jsPDF reports is then the one in force. Returns the result of `fn`.
 * Known limit: a page the scope writes text on, other than the ones it enters and ends on, does not get the fill back.
 * `saveGraphicsState` is no substitute: q/Q restores the PDF operators, not the state jsPDF keeps in JS.
 */
export function withDrawingState<T>(ctx: DrawingContext, fn: () => T): T {
  const { doc } = ctx;
  const { fontName, fontStyle } = doc.getFont();
  const size = doc.getFontSize();
  const textColor = doc.getTextColor();
  const fillColor = doc.getFillColor();
  const drawColor = doc.getDrawColor();
  const lineWidth = doc.getLineWidth();
  const { cap, join } = lineStyle(doc);
  const entry = writePosition(doc);
  try {
    return fn();
  } finally {
    const font = doc.getFont();
    if (font.fontName !== fontName || font.fontStyle !== fontStyle) doc.setFont(fontName, fontStyle);
    if (doc.getFontSize() !== size) doc.setFontSize(size);
    if (doc.getTextColor() !== textColor) doc.setTextColor(...colorLevels(textColor));
    const exit = writePosition(doc);
    const wrote = !samePosition(entry, exit);
    // A nested scope that ended on the fill already wrote it back.
    const settled = wrote && samePosition(stateOf(doc).fill, exit);
    const restate = doc.getFillColor() !== fillColor || (wrote && !settled);
    if (restate) doc.setFillColor(...colorLevels(fillColor));
    if (doc.getDrawColor() !== drawColor) doc.setDrawColor(...colorLevels(drawColor));
    if (doc.getLineWidth() !== lineWidth) doc.setLineWidth(lineWidth);
    const line = lineStyle(doc);
    if (line.cap !== cap) doc.setLineCap(cap);
    if (line.join !== join) doc.setLineJoin(join);
    // After the stroke state, which writes to the page too: the scope around this one then finds the fill settled.
    if (restate || settled) stateOf(doc).fill = writePosition(doc);
  }
}

/** How a line is stroked: its color, its width (mm) and, for a dashed line, the dash and gap lengths (mm). */
export interface Stroke {
  color: string;
  width: number;
  dash?: readonly number[];
}

/**
 * Runs `fn` with `stroke` set, then puts back the stroke it found. The dash pattern has no getter: it is undone by
 * restoring the graphics state, which does not restore the color and width jsPDF keeps in JS: `withDrawingState` does.
 */
export function withStroke(ctx: DrawingContext, stroke: Stroke, fn: () => void): void {
  const { doc } = ctx;
  withDrawingState(ctx, () => {
    doc.saveGraphicsState();
    try {
      doc.setDrawColor(stroke.color);
      doc.setLineWidth(stroke.width);
      if (stroke.dash) doc.setLineDashPattern([...stroke.dash], 0);
      fn();
    } finally {
      doc.restoreGraphicsState();
    }
  });
}
