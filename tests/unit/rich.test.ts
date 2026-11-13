import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { LIST, SPACING } from '../../src/core/constants';
import { PDFDocument } from '../../src/core/document';
import { measureHighlightedText } from '../../src/drawing/highlights';
import { drawBulletList } from '../../src/drawing/lists';
import type { FlowLine, FlowRun } from '../../src/drawing/rich';
import {
  computeRichBlocksHeight,
  computeRichTextHeight,
  drawFlow,
  drawRichBlocks,
  drawRichText,
  fragmentWidth,
  layoutFlow,
  layoutRichBlocks,
} from '../../src/drawing/rich';
import { measureTextLevel, resolveTextStyle } from '../../src/drawing/text';
import { trackedWidth } from '../../src/drawing/text-lines';
import { fontFace, resolveFontStyle } from '../../src/drawing/text-style';
import { loadFontFromBinary } from '../../src/fonts/loader';
import { registerFonts } from '../../src/fonts/register';
import type { FontSource } from '../../src/fonts/types';
import type { RichBlock } from '../../src/text/markup';
import { parseRichInline, parseRichText } from '../../src/text/markup';
import { LONG, currentPage, makeDoc, recordTexts } from './helpers';

describe('parseRichInline', () => {
  it('parses bold and italic', () => {
    expect(parseRichInline('a **b** *c* d')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' d' },
    ]);
  });

  it('nests italic in bold, closing both on a triple star', () => {
    expect(parseRichInline('**bold *and italic***')).toEqual([
      { text: 'bold ', bold: true },
      { text: 'and italic', bold: true, italic: true },
    ]);
    expect(parseRichInline('***both***')).toEqual([{ text: 'both', bold: true, italic: true }]);
    expect(parseRichInline('*a **b** c*')).toEqual([
      { text: 'a ', italic: true },
      { text: 'b', bold: true, italic: true },
      { text: ' c', italic: true },
    ]);
  });

  it('unescapes stars and backslashes', () => {
    expect(parseRichInline('\\*not italic\\* and \\\\')).toEqual([{ text: '*not italic* and \\' }]);
  });

  it('renders a closing marker with nothing to close literally', () => {
    expect(parseRichInline('close** done')).toEqual([{ text: 'close** done' }]);
    expect(parseRichInline('a* b')).toEqual([{ text: 'a* b' }]);
  });

  it('renders unmatched or space-flanked markers literally', () => {
    expect(parseRichInline('**open')).toEqual([{ text: '**open' }]);
    expect(parseRichInline('3 * 4 * 5')).toEqual([{ text: '3 * 4 * 5' }]);
    expect(parseRichInline('**open *it*')).toEqual([{ text: '**open ' }, { text: 'it', italic: true }]);
    expect(parseRichInline('*'.repeat(40))).toEqual([{ text: '*'.repeat(40) }]);
  });

  it('lets a star between two words close bold, not steal its closer', () => {
    expect(parseRichInline('**5*3 = 15**')).toEqual([{ text: '5*3 = 15', bold: true }]);
    expect(parseRichInline('**SKU AB*12 shipped**')).toEqual([{ text: 'SKU AB*12 shipped', bold: true }]);
  });

  it.each([
    ['nested openers', '*a **b '.repeat(3000) + ' c** d*'.repeat(3000)],
    ['unclosed italics', '*a '.repeat(1500) + 'b* '.repeat(1500)],
    ['escapes before stars', 'a\\\\*'.repeat(5000)],
  ])('parses hostile input in linear time: %s', (_, markup) => {
    const start = performance.now();
    expect(() => parseRichInline(markup)).not.toThrow();
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('splits paragraphs on blank lines and collapses other whitespace', () => {
    expect(parseRichText('one\ntwo  **b**\n\n  three ')).toEqual([
      { type: 'paragraph', runs: [{ text: 'one two ' }, { text: 'b', bold: true }] },
      { type: 'paragraph', runs: [{ text: 'three' }] },
    ]);
  });
});

/** End (mm) of the last fragment of a line, from the line start. */
function lineEnd(line: FlowLine): number {
  return Math.max(0, ...line.fragments.map((fragment) => fragment.x + fragmentWidth(fragment)));
}

function mixedRuns(doc: PDFDocument): FlowRun[] {
  const body = resolveTextStyle(doc, 'body');
  const bold = resolveTextStyle(doc, 'body', { bold: true });
  return [
    { text: 'Lead in bold: ', style: bold },
    { text: LONG + ' contact.someone@a-very-long-domain-name.example.com ', style: body },
    { text: 'and a closing bold run.', style: bold },
  ];
}

describe('layoutFlow', () => {
  it('keeps every line and fragment within the width', () => {
    const doc = makeDoc();
    const { lineHeight } = measureTextLevel(doc, 'body');
    const layout = layoutFlow(doc, mixedRuns(doc), { width: 40, lineHeight });
    expect(layout.lines.length).toBeGreaterThan(5);
    for (const line of layout.lines) expect(lineEnd(line)).toBeLessThanOrEqual(40 + 1e-6);
    expect(layout.height).toBeCloseTo(layout.lines.length * lineHeight);
  });

  it('loses no word', () => {
    const doc = makeDoc();
    const { lineHeight } = measureTextLevel(doc, 'body');
    const runs = mixedRuns(doc);
    const layout = layoutFlow(doc, runs, { width: 60, lineHeight });
    const drawn = layout.lines.flatMap((line) => line.fragments.map((f) => f.text)).join(' ');
    const source = runs.map((run) => ('text' in run ? run.text : '')).join('');
    // Long tokens are cut without a hyphen, so compare without spaces.
    expect(drawn.replace(/\s/g, '')).toBe(source.replace(/\s/g, ''));
  });

  it.each([
    ['one style', false],
    ['mixed styles', true],
  ])('measures tracked text with its letter spacing (%s)', (_name, mixed) => {
    const doc = makeDoc();
    const { lineHeight } = measureTextLevel(doc, 'body');
    const tracked = { ...resolveTextStyle(doc, 'body'), charSpace: 0.5 };
    const runs: FlowRun[] = [{ text: `${LONG} `, style: tracked }];
    if (mixed) runs.push({ text: 'end', style: resolveTextStyle(doc, 'bodyBold') });
    const layout = layoutFlow(doc, runs, { width: 50, lineHeight });
    doc.doc.setFont(tracked.family, tracked.fontStyle).setFontSize(tracked.size);
    for (const line of layout.lines) {
      expect(lineEnd(line)).toBeLessThanOrEqual(50 + 1e-6);
      for (const fragment of line.fragments) {
        if (fragment.kind !== 'text' || fragment.style !== tracked) continue;
        expect(fragment.width).toBeCloseTo(trackedWidth(doc.doc, fragment.text, 0.5), 6);
      }
    }
  });

  it('adds the letter spacing between two glued pieces of a word', () => {
    const doc = makeDoc();
    const { lineHeight } = measureTextLevel(doc, 'body');
    const tracked = { ...resolveTextStyle(doc, 'body'), charSpace: 0.5 };
    const bold = { ...resolveTextStyle(doc, 'bodyBold'), charSpace: 0.5 };
    const layout = layoutFlow(
      doc,
      [
        { text: 'ab', style: tracked },
        { text: 'cd', style: tracked },
        { text: 'ef', style: bold },
      ],
      { width: 100, lineHeight },
    );
    const [merged, last] = layout.lines[0].fragments;
    if (merged.kind !== 'text' || last.kind !== 'text') throw new Error('expected text fragments');
    doc.doc.setFont(tracked.family, tracked.fontStyle).setFontSize(tracked.size);
    expect(merged.text).toBe('abcd');
    expect(merged.width).toBeCloseTo(trackedWidth(doc.doc, 'abcd', 0.5), 6);
    expect(last.x).toBeCloseTo(merged.width + 0.5, 6);
  });

  it('moves a pill that does not fit to the next line', () => {
    const doc = makeDoc();
    const { lineHeight } = measureTextLevel(doc, 'body');
    const body = resolveTextStyle(doc, 'body');
    const lead = 'Some words before the pill ';
    doc.doc.setFont(body.family, body.fontStyle).setFontSize(body.size);
    const width = doc.doc.getTextWidth(lead) + 2;
    const layout = layoutFlow(doc, [{ text: lead, style: body }, { pill: 'highlighted' }], { width, lineHeight });
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[1].fragments[0]).toMatchObject({ kind: 'pill', x: 0, text: 'highlighted' });
  });

  it('hangs a prefix: every line starts after its gutter, and fragments follow each other', () => {
    const doc = makeDoc();
    const { lineHeight } = measureTextLevel(doc, 'body');
    const body = resolveTextStyle(doc, 'body');
    const prefix = { text: '•', style: body, width: 4 };
    const plain: FlowRun[] = [{ text: LONG, style: body }];
    const linked: FlowRun[] = [{ text: LONG, style: body, link: 'https://example.com' }];
    for (const runs of [plain, linked]) {
      const layout = layoutFlow(doc, runs, { width: 60, lineHeight, prefix });
      expect(layout.lines.length).toBeGreaterThan(1);
      const [first, ...rest] = layout.lines;
      expect(first.fragments[0]).toMatchObject({ text: '•', x: 0, width: 4 });
      expect(first.fragments[1].x).toBe(4);
      for (const line of rest) expect(line.fragments[0].x).toBe(4);
      for (const line of layout.lines) {
        expect(lineEnd(line)).toBeLessThanOrEqual(60 + 1e-6);
        const prefixWidth = line === first ? 0 : 4;
        expect(lineEnd(line)).toBeCloseTo(prefixWidth + line.fragments.reduce((sum, f) => sum + fragmentWidth(f), 0));
      }
    }
  });

  it('gives a pill that wraps inside itself its own lines', () => {
    const doc = makeDoc();
    const { lineHeight } = measureTextLevel(doc, 'body');
    const body = resolveTextStyle(doc, 'body');
    const layout = layoutFlow(
      doc,
      [{ text: 'Before ', style: body }, { pill: LONG }, { text: ' after', style: body }],
      {
        width: 80,
        lineHeight,
      },
    );
    const pillLine = layout.lines[1];
    expect(pillLine.fragments[0].kind).toBe('pill');
    expect(pillLine.height).toBeGreaterThan(lineHeight);
    expect(layout.lines[2].fragments[0]).toMatchObject({ kind: 'text', text: 'after', x: 0 });
  });

  it('breaks lines and keeps spaces like the plain-text path', () => {
    const doc = makeDoc();
    const { lineHeight } = measureTextLevel(doc, 'body');
    const body = resolveTextStyle(doc, 'body');
    const bold = resolveTextStyle(doc, 'body', { bold: true });
    for (const source of ['x\n', 'a\n\nb', 'a  b\nc']) {
      const plain = layoutFlow(doc, [{ text: source, style: body }], { width: 60, lineHeight });
      // An empty bold run forces the word flow.
      const flow = layoutFlow(
        doc,
        [
          { text: source, style: body },
          { text: '', style: bold },
        ],
        { width: 60, lineHeight },
      );
      expect(flow.lines).toHaveLength(plain.lines.length);
      expect(flow.height).toBeCloseTo(plain.height);
      const texts = (layout: typeof plain) => layout.lines.map((line) => line.fragments.map((f) => f.text).join('|'));
      expect(texts(flow)).toEqual(texts(plain));
    }
  });

  it('keeps punctuation glued to a pill on the pill line', () => {
    const doc = makeDoc();
    const { lineHeight } = measureTextLevel(doc, 'body');
    const body = resolveTextStyle(doc, 'body');
    doc.doc.setFont(body.family, body.fontStyle).setFontSize(body.size);
    const lead = doc.doc.getTextWidth('Lead ');
    const pill = measureHighlightedText(doc, 'PILL');
    // The pill fills the first line: its comma does not fit after it.
    const layout = layoutFlow(
      doc,
      [{ text: 'Lead ', style: body }, { pill: 'PILL' }, { text: ', tail', style: body }],
      {
        width: lead + pill.width + 0.1,
        lineHeight,
      },
    );
    const lineOf = (match: (text: string) => boolean) =>
      layout.lines.findIndex((line) => line.fragments.some((fragment) => match(fragment.text)));
    expect(lineOf((text) => text === 'PILL')).toBe(1);
    expect(lineOf((text) => text.startsWith(','))).toBe(1);
  });

  it('keeps pills on adjacent lines from overlapping', () => {
    const doc = makeDoc();
    const { lineHeight, ascent } = measureTextLevel(doc, 'body');
    const body = resolveTextStyle(doc, 'body');
    const width = measureHighlightedText(doc, 'Second pill').width + 1;
    const layout = layoutFlow(doc, [{ pill: 'First pill' }, { text: ' ', style: body }, { pill: 'Second pill' }], {
      width,
      lineHeight,
    });
    expect(layout.lines).toHaveLength(2);
    const rect = vi.spyOn(doc.doc, 'roundedRect');
    drawFlow(doc, layout, doc.margins.left, 40, ascent);
    const [first, second] = rect.mock.calls.map(([, y, , h]) => ({
      top: y as number,
      bottom: (y as number) + (h as number),
    }));
    expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1e-6);
    // Each pill stays around its own line: it starts below the previous line's baseline.
    expect(first.top).toBeGreaterThan(40 + ascent - lineHeight);
  });
});

describe('rich text heights', () => {
  const blocks: RichBlock[] = [
    { type: 'paragraph', runs: parseRichInline(`Intro with **bold** and *italic*. ${LONG}`) },
    {
      type: 'bulletList',
      items: [[{ text: LONG }], [{ text: 'Linked ' }, { text: 'item', link: 'https://example.com' }]],
    },
    { type: 'numberedList', items: [[{ text: 'First' }], [{ text: 'Second', bold: true }]] },
  ];

  it('computeRichTextHeight equals the Y advance of drawRichText', () => {
    const doc = makeDoc();
    doc.setYPos(40);
    const markup = `**Lead.** ${LONG}\n\nSecond *paragraph*.`;
    const height = computeRichTextHeight(doc, markup);
    drawRichText(doc, markup);
    // The height leaves `spaceAfter` out: here the block spacing.
    expect(doc.getYPos() - 40).toBeCloseTo(height + doc.theme.spacing.block, 6);
  });

  it('computeRichBlocksHeight equals the Y advance of drawRichBlocks, spaceAfter excluded', () => {
    const doc = makeDoc();
    doc.setYPos(40);
    const options = { indent: 10, spaceAfter: 7, align: 'justify' as const };
    const height = computeRichBlocksHeight(doc, blocks, options);
    drawRichBlocks(doc, blocks, options);
    expect(doc.getYPos() - 40).toBeCloseTo(height + 7, 6);
  });

  it('draws links with textWithLink', () => {
    const doc = makeDoc();
    const link = vi.spyOn(doc.doc, 'textWithLink');
    drawRichBlocks(doc, blocks);
    expect(link).toHaveBeenCalledWith(
      'item',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ url: 'https://example.com' }),
    );
  });

  it('sizes the link zone of a letter-spaced link from its tracked width', () => {
    const doc = makeDoc();
    const { lineHeight, ascent } = measureTextLevel(doc, 'body');
    const style = { ...resolveTextStyle(doc, 'body'), charSpace: 0.5 };
    const layout = layoutFlow(doc, [{ text: 'tracked', style, link: 'https://example.com' }], {
      width: 100,
      lineHeight,
    });
    const link = vi.spyOn(doc.doc, 'link');
    const withLink = vi.spyOn(doc.doc, 'textWithLink');
    drawFlow(doc, layout, doc.margins.left, 40, ascent);
    expect(withLink).not.toHaveBeenCalled();
    expect(link).toHaveBeenCalledTimes(1);
    const [x, , width] = link.mock.calls[0] as number[];
    doc.doc.setFont(style.family, style.fontStyle).setFontSize(style.size);
    expect(x).toBeCloseTo(doc.margins.left, 6);
    expect(width).toBeCloseTo(trackedWidth(doc.doc, 'tracked', 0.5), 6);
    expect(width).toBeGreaterThan(doc.doc.getTextWidth('tracked'));
  });

  it('draws a list item detail in the secondary style under the item', () => {
    const doc = makeDoc();
    const text = vi.spyOn(doc.doc, 'text');
    drawBulletList(doc, [{ text: 'Item', detail: parseRichText('Some **detail**') }]);
    const drawn = text.mock.calls.map(([value, x, y]) => ({ value: String(value), x: x as number, y: y as number }));
    const item = drawn.find(({ value }) => value === 'Item');
    const detail = drawn.find(({ value }) => value === 'Some');
    expect(item && detail).toBeTruthy();
    expect(detail!.x).toBeCloseTo(item!.x);
    expect(detail!.y).toBeGreaterThan(item!.y);
  });

  it('draws a string detail as plain text, like the item text', () => {
    const doc = makeDoc();
    const text = vi.spyOn(doc.doc, 'text');
    drawBulletList(doc, [{ text: 'Item', detail: 'Some **detail**' }]);
    expect(text.mock.calls.map(([value]) => String(value))).toContain('Some **detail**');
  });

  it('moves an item to the next page when its detail first line does not fit under it', () => {
    const doc = makeDoc();
    const pages = new Map<string, number>();
    const original = doc.doc.text.bind(doc.doc);
    vi.spyOn(doc.doc, 'text').mockImplementation(((...args: Parameters<typeof original>) => {
      pages.set(String(args[0]), currentPage(doc));
      return original(...args);
    }) as typeof original);
    const item = measureTextLevel(doc, 'body').lineHeight;
    const detailLine = computeRichBlocksHeight(doc, [{ type: 'paragraph', runs: [{ text: 'Detail' }] }], {
      level: 'smallMuted',
      spaceAfter: 0,
    });
    // Room for the item and the gap, half a detail line short.
    doc.setYPos(doc.pageHeight - doc.margins.bottom - (item + SPACING.xsmall + detailLine / 2));
    drawBulletList(doc, [
      { text: 'Item', detail: [{ type: 'numberedList', items: [[{ text: 'Detail', bold: true }]] }] },
    ]);
    expect(pages.get('Item')).toBe(2);
    expect(pages.get('Detail')).toBe(2);
  });
});

function font(style: 'normal' | 'italic', file: string): FontSource {
  const data = new Uint8Array(readFileSync(new URL(`../../assets/fonts/inter/${file}`, import.meta.url)));
  return loadFontFromBinary(data, { family: 'Late', style });
}

describe('italic fallback', () => {
  it('uses bold italic when the font has it', () => {
    const doc = makeDoc();
    const style = fontFace(doc.theme.typography, true, true);
    expect(resolveFontStyle(doc, 'helvetica', style)).toBe('bolditalic');
  });

  it('falls back to normal, and bold italic to bold, without an italic face', () => {
    const doc = makeDoc();
    // A family registered without italic faces.
    doc.doc.addFont('Helvetica', 'Plain', 'normal');
    doc.doc.addFont('Helvetica-Bold', 'Plain', 'bold');
    expect(resolveFontStyle(doc, 'Plain', 'italic')).toBe('normal');
    expect(resolveFontStyle(doc, 'Plain', 'bolditalic')).toBe('bold');
    expect(doc.warnings.filter((w) => w.includes('no italic face'))).toHaveLength(1);
  });

  it('uses a face added after a first render, even straight through jsPDF', () => {
    const doc = makeDoc();
    registerFonts(doc.doc, [font('normal', 'Inter-Regular.ttf')]);
    expect(resolveFontStyle(doc, 'Late', 'italic')).toBe('normal');
    const file = new URL('../../assets/fonts/inter/Inter-Italic.ttf', import.meta.url);
    doc.doc.addFileToVFS('Inter-Italic.ttf', readFileSync(file).toString('base64'));
    doc.doc.addFont('Inter-Italic.ttf', 'Late', 'italic', undefined, 'Identity-H');
    expect(resolveFontStyle(doc, 'Late', 'italic')).toBe('italic');
  });

  it('warns about a missing face once', () => {
    const doc = makeDoc();
    doc.doc.addFont('Helvetica', 'Plain', 'normal');
    resolveFontStyle(doc, 'Plain', 'italic');
    resolveFontStyle(doc, 'Plain', 'italic');
    expect(doc.warnings.filter((w) => w.includes('no italic face'))).toHaveLength(1);
  });
});

function rightEdge(line: FlowLine): number {
  const last = line.fragments[line.fragments.length - 1];
  return last.x + fragmentWidth(last);
}

describe('rich text align and indent', () => {
  const markup = `**Lead.** ${'Lorem ipsum dolor sit amet, *consectetur* adipiscing elit, sed do eiusmod tempor. '.repeat(4)}`;

  it('justifies every line but the last one of each paragraph to the line width', () => {
    const doc = makeDoc();
    const blocks = parseRichText(`${markup}\n\nShort closing paragraph.`);
    const { lines } = layoutRichBlocks(doc, blocks, { align: 'justify', indent: 15 });
    const width = doc.measure - 15;
    const ends = lines.map(({ line }) => line.end === true);
    expect(ends.filter((end) => !end).length).toBeGreaterThan(1);
    lines.forEach(({ line }) => {
      if (line.end) expect(rightEdge(line)).toBeLessThan(width - 1);
      else expect(rightEdge(line)).toBeCloseTo(width, 6);
    });
  });

  it('keeps a word glued to the run before it, and the line unchanged without align', () => {
    const doc = makeDoc();
    const filler = 'Filler words to wrap the line. ';
    const blocks = parseRichText(`${filler.repeat(2)}**bold**, ${filler.repeat(8)}`);
    const plain = layoutRichBlocks(doc, blocks).lines.map(({ line }) => line);
    expect(plain.every((line) => line.fragments.every((fragment) => fragment.kind === 'text'))).toBe(true);

    const justified = layoutRichBlocks(doc, blocks, { align: 'justify' }).lines.map(({ line }) => line);
    const fragments = justified.flatMap((line) => line.fragments);
    const bold = fragments.findIndex((fragment) => fragment.kind === 'text' && fragment.text === 'bold');
    const comma = fragments[bold + 1];
    expect(justified[0].end).toBe(false);
    expect(comma).toMatchObject({ text: ',', spaced: false });
    expect(comma.x).toBeCloseTo(fragments[bold].x + fragmentWidth(fragments[bold]), 6);
  });

  it('draws from the left margin plus the indent', () => {
    const doc = makeDoc();
    const calls = vi.spyOn(doc.doc, 'text');
    doc.richText(markup, { indent: 12, align: 'justify' });
    const xs = calls.mock.calls.map((call) => Number(call[1]));
    expect(Math.min(...xs)).toBeCloseTo(doc.margins.left + 12, 6);
  });

  it('justifies list items after their prefix', () => {
    const doc = makeDoc();
    const blocks: RichBlock[] = [{ type: 'bulletList', items: [parseRichInline(markup), [{ text: 'Last' }]] }];
    const { lines } = layoutRichBlocks(doc, blocks, { align: 'justify' });
    const [first] = lines;
    expect(first.line.fragments[0]).toMatchObject({ text: LIST.bulletChar, x: 0 });
    expect(rightEdge(first.line)).toBeCloseTo(doc.measure, 6);
  });
});

describe('richText indent and width', () => {
  it('names the option it refuses', () => {
    const doc = makeDoc();
    expect(() => computeRichTextHeight(doc, 'Text', { indent: Number.NaN })).toThrow(/richText indent/);
    expect(() => doc.richText('Text', { maxWidth: 0 })).toThrow(/richText maxWidth/);
  });
});

function flowSetup() {
  const doc = makeDoc();
  const { lineHeight } = measureTextLevel(doc, 'body');
  const body = resolveTextStyle(doc, 'body');
  const bold = resolveTextStyle(doc, 'body', { bold: true });
  return { doc, lineHeight, body, bold };
}

describe('layoutFlow word flow, edge cases', () => {
  it('glues a pill to the text right before it, with no gap', () => {
    const { doc, lineHeight, body } = flowSetup();
    const layout = layoutFlow(doc, [{ text: '(', style: body }, { pill: 'Alpha' }, { text: ')', style: body }], {
      width: 80,
      lineHeight,
    });
    expect(layout.lines).toHaveLength(1);
    const [open, pill, close] = layout.lines[0].fragments;
    expect(open).toMatchObject({ kind: 'text', text: '(', x: 0 });
    expect(pill.kind).toBe('pill');
    expect(pill.x).toBeCloseTo(fragmentWidth(open), 6);
    expect(close.x).toBeCloseTo(pill.x + fragmentWidth(pill), 6);
  });

  it('adds no empty line for a hard break right after a pill that wraps inside itself', () => {
    const { doc, lineHeight, body } = flowSetup();
    const withPill = layoutFlow(doc, [{ pill: LONG }, { text: '\nafter', style: body }], { width: 60, lineHeight });
    const pillOnly = layoutFlow(doc, [{ pill: LONG }], { width: 60, lineHeight });
    expect(withPill.lines).toHaveLength(pillOnly.lines.length + 1);
    expect(withPill.lines.at(-1)?.fragments.map((fragment) => fragment.text)).toEqual(['after']);
  });

  it('starts with an empty line for a hard break at the start, like the plain-text path', () => {
    const { doc, lineHeight, body, bold } = flowSetup();
    const runs: FlowRun[] = [
      { text: '\nStart', style: body },
      { text: ' now', style: bold },
    ];
    const layout = layoutFlow(doc, runs, { width: 60, lineHeight });
    expect(layout.lines.map((line) => line.fragments.length)).toEqual([0, 2]);
    expect(layout.lines[0].end).toBe(true);
  });

  it('places the pieces of a word wider than the line one by one, cutting the text piece', () => {
    const { doc, lineHeight, body } = flowSetup();
    const long = 'w'.repeat(60);
    const layout = layoutFlow(doc, [{ text: long, style: body }, { pill: 'tail' }], { width: 30, lineHeight });
    const texts = layout.lines.flatMap((line) => line.fragments).filter((fragment) => fragment.kind === 'text');
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.map((fragment) => fragment.text).join('')).toBe(long);
    expect(layout.lines.at(-1)?.fragments.map((fragment) => fragment.kind)).toContain('pill');
    for (const { fragments } of layout.lines) {
      const last = fragments[fragments.length - 1];
      expect(last.x + fragmentWidth(last)).toBeLessThanOrEqual(30 + 0.01);
    }
  });

  it('moves a piece of an oversized word to the next line when it no longer fits after the one before it', () => {
    const { doc, lineHeight, body } = flowSetup();
    const layout = layoutFlow(
      doc,
      [{ text: 'w'.repeat(8), style: body }, { pill: 'PILL' }, { text: 'x'.repeat(40), style: body }],
      { width: 26, lineHeight },
    );
    const kinds = layout.lines.map((line) => line.fragments.map((fragment) => fragment.kind).join());
    expect(kinds).toEqual(['text', 'pill', 'text', 'text', 'text']);
  });
});

describe('justified rich text, edge cases', () => {
  it('leaves a line made of one cut token as it is', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.richText('x'.repeat(300), { align: 'justify' });
    expect(texts.length).toBeGreaterThan(1);
    for (const call of texts) expect(call.x).toBeCloseTo(doc.margins.left, 6);
  });

  it('leaves a line its words already fill as it is, one fragment', () => {
    const doc = makeDoc();
    const words = 'The line is full';
    // The width of the words, measured as the layout measures them: the line fits exactly, with no room to stretch.
    const [natural] = layoutRichBlocks(doc, parseRichText(words), { maxWidth: 200 }).lines;
    const width = fragmentWidth(natural.line.fragments[0]);
    const plain = layoutRichBlocks(doc, parseRichText(`${words} tail`), { maxWidth: width });
    const justified = layoutRichBlocks(doc, parseRichText(`${words} tail`), { maxWidth: width, align: 'justify' });
    expect(plain.lines[0].line.fragments).toEqual([expect.objectContaining({ text: words, x: 0, width })]);
    expect(justified.lines[0].line).toEqual(plain.lines[0].line);
  });
});
