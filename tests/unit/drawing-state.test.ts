import { jsPDF } from 'jspdf';
import { describe, expect, it, vi } from 'vitest';

import { SPACING } from '../../src/core/constants';
import { PDFDocument } from '../../src/core/document';
import { computeInfoBoxHeight } from '../../src/drawing/boxes';
import {
  computeColumnChartHeight,
  computeDonutChartHeight,
  computeLineChartHeight,
  computeStackedBarHeight,
} from '../../src/drawing/charts';
import { computeDeclarationsBoxHeight } from '../../src/drawing/declarations';
import { lineStyle, trackDrawingState, withDrawingState, withStroke } from '../../src/drawing/drawing-state';
import { measureHighlightedText } from '../../src/drawing/highlights';
import { drawImage } from '../../src/drawing/image-helpers';
import { computeRichBlocksHeight, computeRichTextHeight } from '../../src/drawing/rich';
import { computeSignatureZoneHeight } from '../../src/drawing/signatures';
import { computeParagraphHeight, headingHeight, measureTextLevel, setTextStyle } from '../../src/drawing/text';
import * as publicApi from '../../src/index';
import { parseRichText } from '../../src/text/markup';
import {
  LONG,
  PNG,
  drawingState,
  filledShapes,
  makeDoc,
  pageStream,
  sameColor,
  setForeignState,
  strokedShapes,
} from './helpers';
import type { Case, PrimitiveCase } from './primitive-cases';
import { DIRECT, FLOW, imageCover, makeDocWithImage, primitive } from './primitive-cases';

const MEASURES: PrimitiveCase[] = [
  primitive(computeParagraphHeight, (fn, d) => fn(d, LONG, { level: 'caption' })),
  primitive(computeInfoBoxHeight, (fn, d) => fn(d, LONG, { title: 'Title', bulletPoints: ['One'] }), 'surface'),
  primitive(
    computeInfoBoxHeight,
    (fn, d) => fn(d, LONG, { variant: 'callout', title: 'Title', eyebrow: 'Note' }),
    'callout',
  ),
  primitive(computeRichTextHeight, (fn, d) => fn(d, 'A **bold** text')),
  primitive(computeRichBlocksHeight, (fn, d) => fn(d, parseRichText('A **bold** text'))),
  primitive(computeDeclarationsBoxHeight, (fn, d) => fn(d, [{ text: LONG }], { intro: 'Intro' })),
  primitive(computeDonutChartHeight, (fn, d) => fn(d, [{ label: 'A', value: 3 }], { centerLabel: 'Total' })),
  primitive(computeStackedBarHeight, (fn, d) =>
    fn(d, [
      { label: 'A', value: 3 },
      { label: 'B', value: 1 },
    ]),
  ),
  primitive(computeColumnChartHeight, (fn, d) =>
    fn(d, [{ label: 'Q1', valueLabel: '120', values: [80, 40] }], { series: [{ label: 'One' }, { label: 'Two' }] }),
  ),
  primitive(computeLineChartHeight, (fn, d) => fn(d, { xs: [1, 2], lines: [{ label: 'A', values: [1, 2] }] })),
  primitive(computeSignatureZoneHeight, (fn, d) => fn(d, [{ label: 'A', sublabel: 'B' }], { caption: 'C' })),
  primitive(measureHighlightedText, (fn, d) => fn(d, 'Total')),
  primitive(measureTextLevel, (fn, d) => fn(d, 'h1')),
  primitive(headingHeight, (fn, d) => fn(d, LONG, { level: 'h2', number: '2.1', rule: true })),
];

/** Starts so low on the page that the primitive breaks to a new page. */
function atBottom(run: Case[1]) {
  return (doc: PDFDocument) => {
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 4);
    return run(doc);
  };
}

const ALL: Case[] = [...FLOW, ...DIRECT, ...MEASURES].map(([name, run]) => [name, run]);

describe('drawing state', () => {
  describe.each([
    ['at the top of the page', (run: Case[1]) => run],
    ['at the bottom of the page', atBottom],
  ])('%s', (_position, start) => {
    it.each(ALL)('%s leaves font, colors and line width as it found them', (_, run) => {
      const doc = makeDocWithImage();
      setForeignState(doc);
      const before = drawingState(doc);
      start(run)(doc);
      expect(drawingState(doc)).toEqual(before);
    });
  });

  it.each(MEASURES)('%s leaves the position and the pages alone', (_, run) => {
    const doc = makeDocWithImage();
    const y = doc.peekYPos();
    run(doc);
    expect(doc.peekYPos()).toBe(y);
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(doc.warnings).toEqual([]);
  });

  it('a custom theme with an image cover leaves the state as well', () => {
    const doc = new PDFDocument({ theme: imageCover() });
    doc.registerImage('img', PNG);
    setForeignState(doc);
    const before = drawingState(doc);
    doc.cover('Title', { variant: 'image', layout: 'full', image: 'img' });
    expect(drawingState(doc)).toEqual(before);
  });
});

/** The font, size and text color a freshly set `body` level leaves. */
function bodyState() {
  const doc = makeDocWithImage();
  setTextStyle(doc, 'body');
  const { fontName, fontStyle, fontSize, textColor } = drawingState(doc);
  return { fontName, fontStyle, fontSize, textColor };
}

// Cases whose primitive never starts a content page: the hook has nothing to observe.
const NO_HOOK = new Set([
  'logo',
  'logo on the page',
  'badge',
  'watermark',
  'watermark on every page',
  'background',
  'cover, wave',
  'cover, wave without image',
  'cover, wave with colors',
  'cover, custom',
  'backCover',
  'backCover, empty',
  'backCover, custom',
  'pageHeader and pageFooter',
  'toBuffer',
  // Drawn at fixed coordinates: they never ask for space.
  'columns',
  'headerColumns',
]);

describe('onNewPage hook', () => {
  it.each(FLOW)('%s: the hook starts from the body style', (name, run) => {
    const doc = makeDocWithImage();
    setForeignState(doc);
    const expected = bodyState();
    const seen: Array<ReturnType<typeof bodyState>> = [];
    doc.onNewPage(() => {
      const { fontName, fontStyle, fontSize, textColor } = drawingState(doc);
      seen.push({ fontName, fontStyle, fontSize, textColor });
    });
    atBottom(run)(doc);
    if (!NO_HOOK.has(name)) expect(seen.length, 'the primitive started no page').toBeGreaterThan(0);
    for (const state of seen) expect(state).toEqual(expected);
  });

  it.each(FLOW)('%s: what the hook changes does not reach the primitive that goes on', (_, run) => {
    // The state at every drawing call, with a hook that does nothing and with one that changes everything.
    const record = (hook: (doc: PDFDocument) => void) => {
      const doc = makeDocWithImage();
      setForeignState(doc);
      const calls: unknown[] = [];
      for (const method of ['text', 'rect', 'roundedRect', 'line', 'addImage'] as const) {
        const original = doc.doc[method].bind(doc.doc) as (...args: unknown[]) => unknown;
        (doc.doc as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
          calls.push([method, args[0], drawingState(doc)]);
          return original(...args);
        };
      }
      doc.onNewPage(() => hook(doc));
      atBottom(run)(doc);
      return calls;
    };
    const untouched = record(() => {});
    const changed = record((doc) => {
      setForeignState(doc);
      doc.doc.setFont('times', 'italic');
      doc.doc.setFontSize(30);
      doc.doc.setTextColor('#ff0000');
      doc.doc.setFillColor('#00ff00');
      doc.doc.setDrawColor('#0000ff');
      doc.doc.setLineWidth(2);
      doc.doc.setLineCap('round');
      doc.doc.setLineJoin('round');
    });
    expect(changed).toEqual(untouched);
  });
});

describe('lists across a page break', () => {
  const linked = [{ text: 'Linked item', link: 'https://example.com' }];
  // `reserved` is the height (mm) the first item needs on top of its own text line.
  const lists: [string, (doc: PDFDocument) => unknown, number][] = [
    [
      'rich',
      (doc) => doc.richBlocks([{ type: 'bulletList', items: [linked, [{ text: 'Next item' }], [{ text: 'Last' }]] }]),
      0,
    ],
    [
      'bullet with a linked detail',
      (doc) => doc.bulletList([{ text: 'One', detail: [{ type: 'paragraph', runs: linked }] }, 'Next item', 'Last']),
      SPACING.xsmall + measureTextLevel(makeDoc(), 'smallMuted').lineHeight,
    ],
  ];

  it.each(lists)('shows %s list items on a new page the body text style, not the item above', (_, draw, reserved) => {
    const doc = makeDocWithImage();
    setForeignState(doc);
    const before = drawingState(doc);
    const { lineHeight } = measureTextLevel(doc, 'body');
    // Room for the first item only: the next one breaks the page.
    doc.setYPos(doc.pageHeight - doc.margins.bottom - (reserved + lineHeight * 1.5));
    const seen: ReturnType<typeof drawingState>[] = [];
    doc.onNewPage(() => seen.push(drawingState(doc)));
    draw(doc);
    expect(seen.length).toBeGreaterThan(0);
    // The hook starts from the body text style; the stroke is the caller's.
    for (const state of seen) {
      expect(state).toMatchObject(bodyState());
      expect(state.drawColor).toBe(before.drawColor);
      expect(state.lineWidth).toBe(before.lineWidth);
    }
    expect(drawingState(doc)).toEqual(before);
  });
});

/** The color the last filled shape of `page` is really painted with. */
const lastFill = (doc: PDFDocument, page: number) => filledShapes(doc, page).at(-1)!.color;

const channelHex = (level: number) => level.toString(16).padStart(2, '0');

describe('what a scope writes back', () => {
  it('restores the font, colors, line width, cap and join a scope changed', () => {
    const doc = makeDocWithImage();
    setForeignState(doc);
    const before = drawingState(doc);
    withDrawingState(doc, () => {
      doc.doc.setFont('times', 'italic');
      doc.doc.setFontSize(30);
      doc.doc.setTextColor('#ff0000');
      doc.doc.setFillColor('#00ff00');
      doc.doc.setDrawColor('#0000ff');
      doc.doc.setLineWidth(3);
      doc.doc.setLineCap('round');
      doc.doc.setLineJoin('round');
    });
    expect(drawingState(doc)).toEqual(before);
  });

  it('writes the fill back after text, which jsPDF does not see change it', () => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => {
      doc.doc.setTextColor('#ff00ff');
      doc.doc.text('Text', 20, 20);
    });
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 1)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  // Neither goes through the `doc.text` the document patches: the fill is told by the page, not by what was called.
  it("writes the fill back after text written through jsPDF's private API", () => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => {
      doc.doc.setTextColor('#ff00ff');
      const privateApi = Reflect.get(doc.doc, '__private__') as { text: (...args: unknown[]) => void };
      privateApi.text.call(doc.doc, 'Text', 20, 20);
    });
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 1)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  it('writes the fill back after a text block written through internal.write', () => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => {
      const write = (doc.doc.internal as unknown as { write: (...parts: string[]) => void }).write;
      for (const operator of ['BT', '1 0 1 rg', '(Text) Tj', 'ET']) write(operator);
    });
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 1)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  it('writes the fill back after a Q written through internal.write', () => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => {
      const write = (doc.doc.internal as unknown as { write: (...parts: string[]) => void }).write;
      for (const operator of ['q', '1 0 1 rg', 'Q']) write(operator);
    });
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 1)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  it('writes the fill back on the page a scope ends on', () => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => {
      doc.doc.addPage();
      doc.doc.setTextColor('#ff00ff');
      doc.doc.text('Text', 20, 20);
    });
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 2)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  it('writes the fill back on a page the scope went back to', () => {
    const doc = makeDocWithImage();
    doc.doc.addPage();
    doc.doc.setTextColor('#ff00ff');
    doc.doc.text('Text', 20, 20);
    doc.doc.setPage(1);
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => doc.doc.setPage(2));
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 2)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  it('writes nothing for a scope that drew only out of the page', () => {
    const doc = makeDocWithImage();
    doc.doc.addPage();
    doc.doc.setPage(1);
    setForeignState(doc);
    const before = pageStream(doc, 1);
    withDrawingState(doc, () => {
      doc.doc.setPage(2);
      doc.doc.text('Text', 20, 20);
      doc.doc.setPage(1);
    });
    expect(pageStream(doc, 1)).toBe(before);
  });

  it('adds no operator to the page when nothing changed', () => {
    const doc = makeDocWithImage();
    setForeignState(doc);
    const before = pageStream(doc, 1);
    withDrawingState(doc, () => {});
    expect(pageStream(doc, 1)).toBe(before);
  });

  it('adds no operator for a primitive that draws nothing', () => {
    const doc = makeDocWithImage();
    setForeignState(doc);
    const before = pageStream(doc, 1);
    drawImage(doc, 'missing', { x: 20, y: 40, width: 10 });
    expect(pageStream(doc, 1)).toBe(before);
  });

  it.each(MEASURES)('%s adds no operator to the page', (_, run) => {
    const doc = makeDocWithImage();
    setForeignState(doc);
    const before = pageStream(doc, 1);
    run(doc);
    expect(pageStream(doc, 1)).toBe(before);
  });

  it.each(MEASURES)('%s, called alone, writes nothing to the page and leaves the fill in force', (_, run) => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    doc.doc.rect(1, 1, 1, 1, 'F');
    const before = pageStream(doc, 1);
    run(doc);
    expect(pageStream(doc, 1)).toBe(before);
    expect(doc.doc.getNumberOfPages()).toBe(1);
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 1)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  it('writes back only the color that changed', () => {
    const doc = makeDocWithImage();
    setForeignState(doc);
    const before = pageStream(doc, 1);
    withDrawingState(doc, () => {
      doc.doc.setFillColor('#000000');
    });
    // The scope's own fill, then the fill put back: no draw color, no line width.
    const added = pageStream(doc, 1).slice(before.length).trim().split('\n');
    expect(added).toHaveLength(2);
    expect(added.every((operator) => operator.endsWith(' g') || operator.endsWith(' rg'))).toBe(true);
  });

  it('puts back a color set in CMYK, read as RGB', () => {
    const doc = makeDocWithImage();
    doc.doc.setTextColor(0.1, 0.5, 0.2, 0.3);
    doc.doc.setFillColor(0.4, 0, 0.6, 0.1);
    doc.doc.setDrawColor(0, 0, 0, 1);
    const before = drawingState(doc);
    expect(before.textColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(() =>
      withDrawingState(doc, () => {
        doc.doc.setTextColor('#ff0000');
        doc.doc.setFillColor('#00ff00');
        doc.doc.setDrawColor('#0000ff');
      }),
    ).not.toThrow();
    expect(drawingState(doc)).toEqual(before);
  });
});

describe('color round trip', () => {
  it('puts back every level of every channel unchanged', () => {
    const doc = makeDocWithImage();
    const drifted: string[] = [];
    for (let level = 0; level <= 255; level++) {
      const hex = `#${channelHex(level)}${channelHex((level + 85) % 256)}${channelHex((level + 170) % 256)}`;
      doc.doc.setTextColor(hex);
      doc.doc.setFillColor(hex);
      doc.doc.setDrawColor(hex);
      const before = drawingState(doc);
      withDrawingState(doc, () => {});
      if (JSON.stringify(drawingState(doc)) !== JSON.stringify(before)) drifted.push(hex);
    }
    expect(drifted).toEqual([]);
  });

  it('writes no color operand above 1 when it puts back a pure white', () => {
    const doc = makeDocWithImage();
    doc.doc.setTextColor('#ffffff');
    doc.doc.setFillColor('#ffffff');
    doc.doc.setDrawColor('#ffffff');
    withDrawingState(doc, () => {});
    // jsPDF writes the text color when text is drawn.
    doc.doc.text('x', 10, 10);
    const stream = pageStream(doc, 1);
    const operands = [...stream.matchAll(/((?:[\d.]+\s+)+)(?:rg|RG|g|G)(?=\s|$)/g)].flatMap((match) =>
      match[1].trim().split(/\s+/).map(Number),
    );
    expect(operands.length).toBeGreaterThan(0);
    expect(operands.filter((operand) => operand > 1)).toEqual([]);
  });
});

// A public `draw*`, `compute*` or `measure*` function has to be exercised above: a primitive added without a case
// would leak its style unnoticed. The cases carry the function itself, so a case that calls another one does not count.
describe('coverage of the public primitives', () => {
  // Public functions with nothing to restore. Add the reason next to the name.
  const EXCLUDED = new Set<string>([]);

  it('has a case for every exported draw, compute and measure function', () => {
    const covered = new Set<unknown>([...DIRECT, ...MEASURES].map(([, , fn]) => fn));
    const missing = Object.entries(publicApi)
      .filter(([name, value]) => typeof value === 'function' && /^(draw|compute|measure)[A-Z]/.test(name))
      .filter(([name, value]) => !EXCLUDED.has(name) && !covered.has(value))
      .map(([name]) => name);
    expect(missing, `no case in DIRECT or MEASURES for: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('withStroke', () => {
  it('strokes with the color, width and dash given, then puts back the stroke it found', () => {
    const doc = makeDoc();
    setForeignState(doc);
    const before = drawingState(doc);
    const dash = vi.spyOn(doc.doc, 'setLineDashPattern');
    let inside: ReturnType<typeof drawingState> | undefined;
    withStroke(doc, { color: '#AA0000', width: 0.7, dash: [1, 2] }, () => {
      inside = drawingState(doc);
      doc.doc.line(10, 10, 50, 10);
    });
    expect(inside).toMatchObject({ drawColor: '#aa0000', lineWidth: 0.7 });
    expect(dash).toHaveBeenCalledWith([1, 2], 0);
    expect(drawingState(doc)).toEqual(before);
    // The dash pattern has no getter: the graphics state saved around the stroke undoes it.
    expect(pageStream(doc, 1)).toMatch(/q\n[^Q]*\[[^\]]+\] 0\.? d[^Q]*\nQ/);
  });

  it('sets no dash pattern for a solid stroke', () => {
    const doc = makeDoc();
    const dash = vi.spyOn(doc.doc, 'setLineDashPattern');
    withStroke(doc, { color: '#000000', width: 0.3 }, () => doc.doc.line(10, 10, 50, 10));
    expect(dash).not.toHaveBeenCalled();
  });

  it('puts the stroke back when the drawing throws', () => {
    const doc = makeDoc();
    const before = drawingState(doc);
    const restore = vi.spyOn(doc.doc, 'restoreGraphicsState');
    expect(() =>
      withStroke(doc, { color: '#AA0000', width: 2, dash: [1, 1] }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(restore).toHaveBeenCalledTimes(1);
    expect(drawingState(doc)).toEqual(before);
  });
});

describe('line cap and join', () => {
  it('are not shared between two documents', () => {
    const first = new PDFDocument();
    first.doc.setLineCap('round');
    first.doc.setLineJoin('bevel');
    const second = new PDFDocument();
    expect(lineStyle(second.doc)).toEqual({ cap: 0, join: 0 });
    second.doc.setLineCap('square');
    expect(lineStyle(first.doc)).toEqual({ cap: 1, join: 2 });
    expect(lineStyle(second.doc)).toEqual({ cap: 2, join: 0 });
    // A scope on the second document writes back its own cap, not the first one's.
    withDrawingState(second, () => second.doc.setLineCap('butt'));
    expect(lineStyle(second.doc)).toEqual({ cap: 2, join: 0 });
    expect(pageStream(second, 1)).not.toContain('1 J');
  });

  it('go back with the graphics state, as in the PDF', () => {
    const doc = new PDFDocument();
    doc.doc.saveGraphicsState();
    doc.doc.setLineCap('round');
    doc.doc.setLineJoin('bevel');
    expect(lineStyle(doc.doc)).toEqual({ cap: 1, join: 2 });
    doc.doc.restoreGraphicsState();
    expect(lineStyle(doc.doc)).toEqual({ cap: 0, join: 0 });
  });

  it('stay as they are for a restore of a save made before the tracking began', () => {
    const pdf = new jsPDF();
    pdf.saveGraphicsState();
    trackDrawingState(pdf);
    pdf.setLineCap('round');
    pdf.restoreGraphicsState();
    expect(lineStyle(pdf)).toEqual({ cap: 1, join: 0 });
  });

  it('are put back after a checkbox drawn when a saved state set them', () => {
    const doc = new PDFDocument();
    doc.doc.saveGraphicsState();
    doc.doc.setLineCap('round');
    doc.doc.restoreGraphicsState();
    doc.checkbox('Option', { variant: 'checked' });
    doc.doc.line(10, 10, 50, 10);
    expect(strokedShapes(doc, 1).at(-1)).toMatchObject({ cap: 0, join: 0 });
  });

  it('are tracked once when trackDrawingState is called again', () => {
    const doc = new PDFDocument();
    const { setLineCap, setLineJoin } = doc.doc;
    trackDrawingState(doc.doc);
    expect(doc.doc.setLineCap).toBe(setLineCap);
    expect(doc.doc.setLineJoin).toBe(setLineJoin);
    doc.doc.setLineCap('round');
    expect(lineStyle(doc.doc).cap).toBe(1);
  });
});

/** The fill operators (`g`, `rg`, `k`) written after the last text block of `page`. */
function fillsAfterText(doc: PDFDocument, page: number): number {
  const stream = pageStream(doc, page);
  return stream
    .slice(stream.lastIndexOf('ET') + 2)
    .split('\n')
    .filter((line) => /^[\d. -]+ (?:g|rg|k)$/.test(line)).length;
}

/** Text in a color no primitive uses. */
function text(doc: PDFDocument): void {
  doc.doc.setTextColor('#ff00ff');
  doc.doc.text('Text', 20, 20);
}

describe('nested scopes', () => {
  it.each([2, 3])('%i nested scopes that write text write the fill back once', (depth) => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    const nest = (level: number): void => {
      withDrawingState(doc, () => (level === 1 ? text(doc) : nest(level - 1)));
    };
    nest(depth);
    expect(fillsAfterText(doc, 1)).toBe(1);
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 1)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  it('writes the fill back for text an outer scope writes after the inner one', () => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => {
      withDrawingState(doc, () => text(doc));
      text(doc);
    });
    expect(fillsAfterText(doc, 1)).toBe(1);
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 1)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  it('writes the fill back once when the inner scope also restores a stroke', () => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => {
      withDrawingState(doc, () => {
        doc.doc.setLineWidth(3);
        text(doc);
      });
    });
    expect(fillsAfterText(doc, 1)).toBe(1);
  });

  it('writes the fill back once through a page break', () => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => {
      withDrawingState(doc, () => {
        doc.doc.addPage();
        text(doc);
      });
    });
    expect(fillsAfterText(doc, 2)).toBe(1);
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 2)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });

  it('writes the fill back for text an outer scope writes after a page break in the inner one', () => {
    const doc = makeDocWithImage();
    doc.doc.setFillColor('#abcdef');
    withDrawingState(doc, () => {
      withDrawingState(doc, () => doc.doc.addPage());
      text(doc);
    });
    expect(fillsAfterText(doc, 2)).toBe(1);
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(lastFill(doc, 2)).toSatisfy((color: string) => sameColor(color, '#abcdef'));
  });
});
