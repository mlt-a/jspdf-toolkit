import { describe, expect, it } from 'vitest';

import type { DocumentOptions, PDFDocument } from '../../src/core/document';
import { createTheme } from '../../src/theme/defaults';
import { filledShapes, sameColor } from './helpers';
import { DIRECT, FLOW, makeDocWithImage } from './primitive-cases';

/** Text in a color no primitive uses: whatever is filled right after it must not take it. */
function writePoison(doc: PDFDocument): void {
  doc.doc.setTextColor('#ff00ff');
  doc.doc.text('Poison', 20, 20);
}

const pagesOf = (doc: PDFDocument) => Array.from({ length: doc.doc.getNumberOfPages() }, (_, i) => i + 1);

/** Expects every shape of every page to be filled with the color the drawing code set, and not the poison. */
function expectFillsAsSet(doc: PDFDocument): void {
  for (const page of pagesOf(doc)) {
    for (const shape of filledShapes(doc, page)) {
      const where = `page ${page}, ${shape.op} at ${shape.x.toFixed(1)},${shape.y.toFixed(1)}`;
      expect(sameColor(shape.color, shape.intended), `${where}: ${shape.color} instead of ${shape.intended}`).toBe(
        true,
      );
      expect(shape.color, where).not.toBe('#ff00ff');
    }
  }
}

// A non-white background paints the whole page first on every page, so a primitive follows a fill it never set.
const THEMES: Array<[name: string, options: DocumentOptions]> = [
  ['default theme', {}],
  ['dark background', { theme: createTheme({ colors: { primary: '#3572B8', background: '#1B2430' } }) }],
];

describe.each(THEMES)('fill colors, %s', (_theme, options) => {
  describe.each([
    ['at the top of the page', (_doc: PDFDocument) => {}],
    ['at the bottom of the page', (doc: PDFDocument) => doc.setYPos(doc.pageHeight - doc.margins.bottom - 4)],
  ])('%s', (_position, place) => {
    it.each(FLOW)('%s fills every shape with the color it set, after text of another color', (_, run) => {
      const doc = makeDocWithImage(options);
      writePoison(doc);
      place(doc);
      run(doc);
      expectFillsAsSet(doc);
    });
  });

  // Coordinate primitives ignore the Y position: there is no bottom of the page for them.
  it.each(DIRECT)('%s fills every shape with the color it set, after text of another color', (_, run) => {
    const doc = makeDocWithImage(options);
    writePoison(doc);
    run(doc);
    expectFillsAsSet(doc);
  });
});

/** Draws `run` after text of another color and returns the colors the page is filled with, in order. */
function fillsAfterText(run: (doc: PDFDocument) => unknown): { doc: PDFDocument; fills: string[] } {
  const doc = makeDocWithImage();
  writePoison(doc);
  run(doc);
  const fills = pagesOf(doc).flatMap((page) => filledShapes(doc, page).map((shape) => shape.color));
  return { doc, fills };
}

/** Expects the fills to be exactly the `expected` colors, each at least once, and none other. */
function expectFillColors(fills: string[], expected: string[]): void {
  expect(fills.length).toBeGreaterThan(0);
  for (const color of expected)
    expect(
      fills.some((fill) => sameColor(fill, color)),
      color,
    ).toBe(true);
  for (const fill of fills)
    expect(
      expected.some((color) => sameColor(fill, color)),
      fill,
    ).toBe(true);
}

describe('fill colors of the primitives', () => {
  it('fills an info box with the surface and a callout with the tint and the primary bar', () => {
    const surface = fillsAfterText((d) => d.infoBox('Content', { title: 'Title', bulletPoints: ['One'] }));
    expectFillColors(surface.fills, [surface.doc.theme.colors.surface]);
    const callout = fillsAfterText((d) =>
      d.infoBox('Content', { variant: 'callout', eyebrow: 'Note', title: 'Title' }),
    );
    expectFillColors(callout.fills, [callout.doc.theme.colors.tint, callout.doc.theme.colors.primary]);
  });

  it('fills the declarations box and its strong highlight', () => {
    const { doc, fills } = fillsAfterText((d) =>
      d.declarationsBox([{ text: 'I declare it', highlights: [{ text: 'declare', strong: true }] }], {
        intro: 'Intro',
      }),
    );
    expectFillColors(fills, [doc.theme.colors.background, doc.theme.colors.primary]);
  });

  it('fills a highlighted field value with the light tint', () => {
    const { doc, fills } = fillsAfterText((d) => d.fields([{ label: 'A', value: 'b', highlight: true }]));
    expectFillColors(fills, [doc.theme.colors.tintLight]);
  });

  it('fills a badge with the tint', () => {
    const { doc, fills } = fillsAfterText((d) => d.badge('Draft'));
    expectFillColors(fills, [doc.theme.colors.tint]);
  });

  it('only strokes checkboxes, signature boxes and the running header and footer', () => {
    const { fills } = fillsAfterText((d) =>
      d
        .checkbox('Agreed', { variant: 'checked' })
        .inlineQuestion('Agreed?', { answer: 'yes' })
        .signatureZone([{ label: 'Client' }, { label: 'Supplier' }], { caption: 'London' })
        .pageHeader({ title: 'Report', folio: true })
        .pageFooter({ left: 'Left', right: '{page}/{pages}' })
        .paragraph('Body')
        .finalize(),
    );
    expect(fills).toEqual([]);
  });

  it('fills the wave cover with its colors, whatever text precedes', () => {
    const { doc, fills } = fillsAfterText((d) =>
      d.cover('Title', { variant: 'wave', subtitle: 'Sub', waveColor: 'tint', accentBar: false }),
    );
    expectFillColors(fills, [doc.theme.colors.tint]);
    const plain = fillsAfterText((d) => d.cover('Title', { variant: 'wave', subtitle: 'Sub' }));
    expectFillColors(plain.fills, [plain.doc.theme.colors.primary, plain.doc.theme.colors.tint]);
  });

  it('fills the donut parts and the legend dots with the slice colors', () => {
    const { doc, fills } = fillsAfterText((d) =>
      d.donutChart(
        [
          { label: 'A', value: 3, color: 'success' },
          { label: 'B', value: 1, color: '#CC3300' },
        ],
        { centerLabel: 'Total' },
      ),
    );
    expectFillColors(fills, [doc.theme.colors.success, '#CC3300']);
    // Two parts and two legend dots.
    expect(fills).toHaveLength(4);
  });

  it('fills the stacked bar slices and the legend dots with the slice colors', () => {
    const { doc, fills } = fillsAfterText((d) =>
      d.stackedBar([
        { label: 'A', value: 3, color: 'success' },
        { label: 'B', value: 1, color: '#CC3300' },
      ]),
    );
    expectFillColors(fills, [doc.theme.colors.success, '#CC3300']);
    expect(fills).toHaveLength(4);
  });

  it('fills the columns and the legend dots with the series colors', () => {
    const { doc, fills } = fillsAfterText((d) =>
      d.columnChart(
        [
          { label: 'Q1', valueLabel: '120', values: [80, 40] },
          { label: 'Q2', valueLabel: '150', values: [95, 55] },
        ],
        {
          series: [
            { label: 'Licences', color: 'success' },
            { label: 'Services', color: '#CC3300' },
          ],
        },
      ),
    );
    expectFillColors(fills, [doc.theme.colors.success, '#CC3300']);
    // Four columns and two legend dots.
    expect(fills).toHaveLength(6);
  });

  it('fills the highlight zone and the band of a line chart with their colors', () => {
    const { doc, fills } = fillsAfterText((d) =>
      d.lineChart(
        {
          xs: [1, 2, 3],
          lines: [{ label: 'A', values: [1, 2, 3], emphasis: true }],
          band: { label: 'Range', lower: [0, 1, 1], upper: [2, 3, 4], color: '#CC3300' },
        },
        { highlight: { from: 1, to: 2, label: 'Period', color: 'success' } },
      ),
    );
    expectFillColors(fills, [doc.theme.colors.success, '#CC3300']);
    // Each area and its legend swatch.
    expect(fills.filter((fill) => sameColor(fill, doc.theme.colors.success))).toHaveLength(2);
    expect(fills.filter((fill) => sameColor(fill, '#CC3300'))).toHaveLength(2);
  });
});
