import { describe, expect, it } from 'vitest';

import type { DocumentOptions, PDFDocument } from '../../src/core/document';
import { createTheme } from '../../src/theme/defaults';
import { drawingState, sameColor, scanPage, setForeignState } from './helpers';
import type { Case } from './primitive-cases';
import { DIRECT, FLOW, makeDocWithImage } from './primitive-cases';

// What raw jsPDF drawing finds on the page: in PDF the text color is also the fill color and a new page starts black,
// while jsPDF reports the fill it last set. A rectangle and a line drawn without setting anything show what is in
// force.

type PageState = { fill: string; stroke: string; lineWidth: number; cap: number; join: number };

/** The state `setForeignState` sets. */
const FOREIGN: PageState = { fill: '#abcdef', stroke: '#fedcba', lineWidth: 0.9, cap: 2, join: 2 };

/** Where the raw shapes go: a spot and a size no primitive draws at. */
const RAW = { x: 3.3, y: 5.7, size: 1.9, lineGap: 3 };

function drawRaw(doc: PDFDocument): void {
  doc.doc.rect(RAW.x, RAW.y, RAW.size, RAW.size, 'F');
  doc.doc.line(RAW.x, RAW.y + RAW.lineGap, RAW.x + RAW.size, RAW.y + RAW.lineGap);
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Expects the raw shapes drawn last on `page` to be painted with `expected`. */
function expectRawShapes(doc: PDFDocument, page: number, expected: PageState): void {
  const { shapes, strokes } = scanPage(doc, page);
  const fill = shapes.findLast((shape) => near(shape.x, RAW.x) && near(shape.width, RAW.size));
  const stroke = strokes.findLast(
    (shape) => near(shape.x, RAW.x) && near(shape.y, RAW.y + RAW.lineGap) && near(shape.width, RAW.size),
  );
  expect(fill, `no raw rectangle on page ${page}`).toBeDefined();
  expect(stroke, `no raw line on page ${page}`).toBeDefined();
  expect(sameColor(fill!.color, expected.fill), `filled with ${fill!.color} instead of ${expected.fill}`).toBe(true);
  expect(sameColor(stroke!.color, expected.stroke), `stroked ${stroke!.color} instead of ${expected.stroke}`).toBe(
    true,
  );
  expect(stroke!.lineWidth).toBeCloseTo(expected.lineWidth, 2);
  expect({ cap: stroke!.cap, join: stroke!.join }).toEqual({ cap: expected.cap, join: expected.join });
}

/** Starts so low on the page that a flow primitive breaks to a new page. */
const atBottom = (doc: PDFDocument) => doc.setYPos(doc.pageHeight - doc.margins.bottom - 4);

// A non-white background paints every new page before the primitive goes on.
const THEMES: Array<[name: string, options: DocumentOptions]> = [
  ['default theme', {}],
  ['dark background', { theme: createTheme({ colors: { primary: '#3572B8', background: '#1B2430' } }) }],
];

const POSITIONS: Array<[name: string, place: (doc: PDFDocument) => void]> = [
  ['at the top of the page', () => {}],
  ['at the bottom of the page', atBottom],
];

// Coordinate primitives ignore the position: the top of the page is all there is for them.
const CASES: Array<[name: string, run: Case[1], place: (doc: PDFDocument) => void]> = [
  ...POSITIONS.flatMap(([position, place]) =>
    FLOW.map(([name, run]): [string, Case[1], typeof place] => [`${name}, ${position}`, run, place]),
  ),
  ...DIRECT.map(([name, run]): [string, Case[1], (doc: PDFDocument) => void] => [name, run, () => {}]),
];

describe.each(THEMES)('raw drawing, %s', (_theme, options) => {
  it.each(CASES)('after %s, takes the fill and stroke set before it', (_, run, place) => {
    const doc = makeDocWithImage(options);
    setForeignState(doc);
    place(doc);
    run(doc);
    drawRaw(doc);
    expectRawShapes(doc, doc.pageNumber, FOREIGN);
  });

  it.each(POSITIONS.flatMap(([position, place]) => FLOW.map(([name, run]) => [`${name}, ${position}`, run, place])))(
    'in the onNewPage hook of %s, takes the fill and stroke jsPDF reports',
    (_, run, place) => {
      const doc = makeDocWithImage(options);
      setForeignState(doc);
      const seen: Array<{ page: number; state: PageState }> = [];
      doc.onNewPage(() => {
        const { fillColor, drawColor, lineWidth, lineCap, lineJoin } = drawingState(doc);
        seen.push({
          page: doc.pageNumber,
          state: { fill: fillColor, stroke: drawColor, lineWidth, cap: lineCap, join: lineJoin },
        });
        drawRaw(doc);
      });
      (place as (doc: PDFDocument) => void)(doc);
      (run as Case[1])(doc);
      for (const { page, state } of seen) expectRawShapes(doc, page, state);
      // A non-white theme paints the page before the hook: the hook finds the background as the fill.
      if (options.theme) for (const { state } of seen) expect(sameColor(state.fill, '#1B2430')).toBe(true);
    },
  );

  it('a page added with raw jsPDF starts with the fill and stroke jsPDF reports', () => {
    const doc = makeDocWithImage(options);
    setForeignState(doc);
    doc.doc.setTextColor('#ff00ff');
    doc.doc.text('Text', 20, 20);
    doc.doc.addPage();
    drawRaw(doc);
    // The page background, when the theme has one, is painted in a fill that does not stay.
    expectRawShapes(doc, 2, FOREIGN);
  });
});
