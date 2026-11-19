import { describe, expect, it } from 'vitest';

import { BOX, ascentMm } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import type { PanelOptions } from '../../src/drawing/panel';
import { measureTextLevel } from '../../src/drawing/text';
import { LONG, expectTextWithin, leaveRoom, makeDoc, recordTexts, sameColor, scanPage } from './helpers';

const PADDING = BOX.padding;
const PARAGRAPHS = Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1} of the panel.`);

type Frame = { top: number; bottom: number; left: number; right: number };

/** The frames a page fills in `color`, top to bottom. */
function framesOn(doc: PDFDocument, page: number, color = doc.theme.colors.surface): Frame[] {
  return scanPage(doc, page)
    .marks.filter((mark) => mark.kind === 'fill' && sameColor(mark.color, color))
    .map((mark) => mark as { x: number; y: number; width: number; height: number })
    .map(({ x, y, width, height }) => ({ top: y, bottom: y + height, left: x, right: x + width }));
}

/** The lines a page shows: text, baseline, and top of the capitals. */
function linesOn(doc: PDFDocument, page: number) {
  return scanPage(doc, page)
    .marks.filter((mark) => mark.kind === 'text')
    .map((mark) => mark as { y: number; size: number; raw: string })
    .map(({ y, size }) => ({ baseline: y, top: y - ascentMm(size) }));
}

const pages = (doc: PDFDocument) => doc.doc.getNumberOfPages();

/** Expects every line of `page` under the top of `frame` to stand inside it, the padding clear above and below it. */
function expectLinesInside(doc: PDFDocument, page: number, frame: Frame): void {
  const lines = linesOn(doc, page).filter(({ baseline }) => baseline > frame.top);
  expect(lines.length).toBeGreaterThan(0);
  for (const { baseline, top } of lines) {
    expect(top).toBeGreaterThanOrEqual(frame.top + PADDING - 0.01);
    expect(baseline).toBeLessThanOrEqual(frame.bottom - PADDING + 0.01);
  }
}

const tallPanel = (doc: PDFDocument, options?: PanelOptions) =>
  doc.panel(() => {
    doc.heading('Terms', { level: 'h4' });
    doc.paragraphs(PARAGRAPHS);
  }, options);

describe('panel on one page', () => {
  it('draws one frame around its blocks, the padding on its four sides', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const top = doc.getYPos();
    doc.panel(() => doc.heading('Plan', { level: 'h4' }).paragraph(LONG), { spaceAfter: 0 });
    expect(pages(doc)).toBe(1);
    const [frame] = framesOn(doc, 1);
    expect(framesOn(doc, 1)).toHaveLength(1);
    expect(frame.top).toBeCloseTo(top, 3);
    expect(frame.left).toBeCloseTo(doc.margins.left, 3);
    expect(frame.right).toBeCloseTo(doc.margins.left + doc.measure, 3);
    expect(doc.getYPos()).toBeCloseTo(frame.bottom, 3);
    expectTextWithin(texts, doc.margins.left + PADDING, doc.margins.left + doc.measure - PADDING);
    expectLinesInside(doc, 1, frame);
  });

  it('sets its first block at the top of the content, without the space above it', () => {
    const doc = leaveRoom(makeDoc(), 200);
    const top = doc.getYPos();
    doc.panel(() => doc.addSpace(10).heading('Plan', { level: 'h2' }));
    const [first] = linesOn(doc, 1).slice(-1);
    const ascent = measureTextLevel(doc, 'h2').ascent;
    expect(first.baseline).toBeCloseTo(top + PADDING + ascent, 3);
  });

  it('takes the style, padding and radius it is given, and the space under it', () => {
    const doc = makeDoc();
    const top = doc.getYPos();
    doc.panel(() => doc.paragraph('Inside.', { spaceAfter: 0 }), { boxStyle: 'tint', padding: 6, spaceAfter: 3 });
    const [frame] = framesOn(doc, 1, doc.theme.colors.tint);
    const line = measureTextLevel(doc, 'body').lineHeight;
    expect(frame.bottom - frame.top).toBeCloseTo(line + 12, 3);
    expect(doc.getYPos()).toBeCloseTo(top + line + 12 + 3, 3);
  });

  it('draws no frame without padding or content', () => {
    const doc = makeDoc();
    const top = doc.getYPos();
    doc.panel(() => {}, { padding: 0, spaceAfter: 0 });
    expect(framesOn(doc, 1)).toEqual([]);
    expect(doc.getYPos()).toBe(top);
  });

  it('draws its frame under its content', () => {
    const doc = makeDoc();
    doc.panel(() => doc.paragraph('Inside.'));
    const kinds = scanPage(doc, 1).marks.map((mark) => mark.kind);
    expect(kinds.indexOf('fill')).toBeLessThan(kinds.indexOf('text'));
  });
});

describe('panel at the bottom of a page', () => {
  it('starts on the next page when it fits there, with the heading waiting above it', () => {
    const doc = leaveRoom(makeDoc(), 30);
    doc.heading('Solutions', { level: 'h3' });
    doc.panel(() => doc.paragraphs(PARAGRAPHS.slice(0, 6)));
    expect(pages(doc)).toBe(2);
    expect(framesOn(doc, 1)).toEqual([]);
    const [frame] = framesOn(doc, 2);
    const [heading] = linesOn(doc, 2);
    expect(heading.baseline).toBeLessThan(frame.top);
    expect(frame.top).toBeGreaterThan(doc.layout.topFor(2));
    expectLinesInside(doc, 2, frame);
  });

  it('starts on the next page when its first frame would hold nothing', () => {
    const doc = leaveRoom(makeDoc(), 2 * PADDING + 1);
    tallPanel(doc);
    expect(framesOn(doc, 1)).toEqual([]);
    expect(framesOn(doc, 2)[0].top).toBeCloseTo(doc.layout.topFor(2), 3);
  });
});

describe('panel across pages', () => {
  it('draws one closed frame per page, each holding its content within the padding', () => {
    const doc = leaveRoom(makeDoc(), 80);
    const texts = recordTexts(doc);
    tallPanel(doc);
    expect(pages(doc)).toBeGreaterThan(2);
    const bottom = doc.layout.bottom(doc.pageHeight);
    for (let page = 1; page <= pages(doc); page++) {
      const frames = framesOn(doc, page);
      expect(frames, `page ${page}`).toHaveLength(1);
      const [frame] = frames;
      if (page > 1) expect(frame.top).toBeCloseTo(doc.layout.topFor(2), 3);
      expect(frame.bottom).toBeLessThanOrEqual(bottom + 0.01);
      expectLinesInside(doc, page, frame);
    }
    expectTextWithin(
      texts.filter((call) => call.lines[0] !== 'Opening text.'),
      doc.margins.left + PADDING,
      doc.margins.left + doc.measure - PADDING,
    );
  });

  it('leaves the flow as it was after it: margins, top of the next page', () => {
    const doc = makeDoc();
    tallPanel(doc);
    doc.paragraphs(PARAGRAPHS);
    const last = pages(doc);
    expect(framesOn(doc, last)).toEqual([]);
    expect(linesOn(doc, last)[0].top).toBeLessThan(doc.layout.topFor(2) + PADDING);
    expect(doc.contentWidth).toBe(makeDoc().contentWidth);
  });

  it('nests: the inner frame within the outer one on every page', () => {
    const doc = makeDoc();
    doc.panel(() => {
      doc.paragraph('Outer.');
      doc.panel(() => doc.paragraphs(PARAGRAPHS), { boxStyle: 'tint' });
      doc.paragraph('Outer again.');
    });
    expect(pages(doc)).toBeGreaterThan(1);
    for (let page = 1; page <= pages(doc); page++) {
      const [outer] = framesOn(doc, page);
      const [inner] = framesOn(doc, page, doc.theme.colors.tint);
      expect(inner.top).toBeGreaterThanOrEqual(outer.top + PADDING - 0.01);
      expect(inner.bottom).toBeLessThanOrEqual(outer.bottom - PADDING + 0.01);
      expect(inner.left).toBeCloseTo(outer.left + PADDING, 3);
    }
  });

  it('keeps a block together inside it, measured within its padding', () => {
    const doc = makeDoc();
    doc.panel(() => {
      doc.paragraphs(PARAGRAPHS.slice(0, 30));
      doc.keepTogether(() => doc.heading('Kept', { level: 'h4' }).paragraphs(PARAGRAPHS.slice(0, 8)));
    });
    expect(pages(doc)).toBe(2);
    const [frame] = framesOn(doc, 2);
    expectLinesInside(doc, 2, frame);
  });

  it('runs a frame it did not measure to the bottom of the content', () => {
    const doc = makeDoc();
    let runs = 0;
    doc.panel(() => {
      runs++;
      // More on the real pass than on the measuring one.
      doc.paragraphs(runs === 1 ? ['Short.'] : PARAGRAPHS);
    });
    expect(pages(doc)).toBe(2);
    const [frame] = framesOn(doc, 2);
    expect(frame.bottom).toBeCloseTo(doc.layout.bottom(doc.pageHeight), 3);
  });
});

describe('panel in a column that runs onto a new page', () => {
  it('leaves the columns after it starting at the top of that page, without its padding', () => {
    const doc = makeDoc();
    doc.columns([() => tallPanel(doc), () => doc.panel(() => doc.paragraph('Beside.'), { boxStyle: 'tint' })]);
    const [beside] = framesOn(doc, 2, doc.theme.colors.tint);
    expect(beside.top).toBeCloseTo(doc.layout.topFor(2), 3);
  });
});

describe('panel callback that throws', () => {
  it('leaves the flow and the frame as they were', () => {
    const doc = makeDoc();
    const frame = { ...doc.margins };
    expect(() =>
      doc.panel(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect({ ...doc.margins }).toEqual(frame);
    doc.paragraphs(PARAGRAPHS).paragraphs(PARAGRAPHS);
    expect(linesOn(doc, 2)[0].top).toBeLessThan(doc.layout.topFor(2) + PADDING);
  });
});
