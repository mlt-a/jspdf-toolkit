import { GState } from 'jspdf';
import { describe, expect, it } from 'vitest';

import { INTER_FAMILY, interFonts } from '../../src/fonts/inter';
import { createTheme } from '../../src/theme/defaults';
import { PNG, makeDoc } from './helpers';
import { decode, describeLayout } from './layout';

type Doc = ReturnType<typeof makeDoc>;

const lines = (doc: Doc) => describeLayout(doc).split('\n');
const linesOf = (doc: Doc, kind: string) => lines(doc).filter((line) => line.startsWith(`${kind} `));

/** The texts of the layout: where each string starts (mm), what it shows, and the rest of its line. */
function texts(doc: Doc) {
  return linesOf(doc, 'text').map((line) => {
    const [, x, y, rest, shown] = /^text +x=(\S+) y=(\S+) (.*) (".*")$/.exec(line)!;
    return { x: Number(x), y: Number(y), rest, text: JSON.parse(shown) as string };
  });
}

/** Points per millimetre. */
const K = 72 / 25.4;

/** Advance widths (thousandths of the font size) of jsPDF's Helvetica: the AFM ones rounded to tens, no kerning. */
const HELVETICA: Record<string, number> = {
  ' ': 280,
  d: 550,
  e: 550,
  h: 550,
  i: 220,
  l: 220,
  n: 550,
  o: 550,
  r: 330,
  s: 500,
  t: 280,
};

/** Width (mm) of `value` in Helvetica at `size` points. */
const helvetica = (value: string, size: number) =>
  ([...value].reduce((sum, char) => sum + HELVETICA[char], 0) * size) / 1000 / K;

/** The raw `doc.text` defaults: Helvetica 16 pt, lines 1.3 times the size apart (the theme `lineHeightFactor`). */
const SIZE = 16;
const LEADING = (SIZE * 1.3) / K;

const THREE = ['one', 'nine lines', 'the third line'];

describe('describeLayout', () => {
  it('opens with the document properties, then lists the marks of each page in painting order, one line each', () => {
    const doc = makeDoc();
    doc.registerImage('dot', PNG);
    doc.doc.setFillColor('#336699');
    doc.doc.rect(10, 20, 30, 5, 'F');
    doc.doc.setDrawColor('#990000');
    doc.doc.setLineWidth(0.5);
    doc.doc.line(10, 30, 50, 30);
    doc.doc.text('Hello', 12, 40);
    doc.doc.addImage(PNG, 'PNG', 15, 50, 8, 4);
    doc.addPage();
    doc.doc.text('Next', 12, 40);
    const image = linesOf(doc, 'image')[0];
    expect(image).toMatch(/^image {2}x=15\.00 y=50\.00 w=8\.00 h=4\.00 I0 [0-9a-f]{8}$/);
    expect(lines(doc).filter((line) => !line.startsWith('text') || line.includes('"'))).toEqual([
      'properties none',
      '',
      '## page 1 (210.00 x 297.00 mm)',
      'fill   x=10.00 y=20.00 w=30.00 h=5.00 #336699 f',
      'stroke x=10.00 y=30.00 w=40.00 h=0.00 #990000 line=0.50 S',
      'text   x=12.00 y=40.00 16pt #000000 helvetica-normal "Hello"',
      image,
      '',
      '## page 2 (210.00 x 297.00 mm)',
      'text   x=12.00 y=40.00 16pt #000000 helvetica-normal "Next"',
      '',
    ]);
  });

  it('names the properties the document sets, and its bookmarks', () => {
    const doc = makeDoc({ title: 'Report', author: 'Acme' });
    doc.addPage();
    const intro = doc.doc.outline.add(null, 'Intro', { pageNumber: 1 });
    doc.doc.outline.add(intro, 'Detail', { pageNumber: 2 });
    doc.doc.outline.add(null, 'End', { pageNumber: 2 });
    expect(lines(doc).slice(0, 3)).toEqual([
      'properties title="Report" author="Acme"',
      'bookmarks "Intro" p1 ["Detail" p2], "End" p2',
      '',
    ]);
  });

  it.each([
    ['left', (x: number) => x],
    ['center', (x: number, width: number) => x - width / 2],
    ['right', (x: number, width: number) => x - width],
  ] as const)('places each line of a three-line text aligned %s', (align, left) => {
    const doc = makeDoc();
    doc.doc.text(THREE, 100, 50, { align });
    const drawn = texts(doc);
    expect(drawn.map(({ text }) => text)).toEqual(THREE);
    drawn.forEach(({ x, y }, index) => {
      expect(x).toBeCloseTo(left(100, helvetica(THREE[index], SIZE)), 2);
      expect(y).toBeCloseTo(50 + index * LEADING, 2);
    });
  });

  it('gives the word spacing of each justified line, and none on the last one', () => {
    const doc = makeDoc();
    doc.doc.text(['the third line', 'one'], 20, 50, { align: 'justify', maxWidth: 80 });
    const [first, last] = texts(doc);
    // Two spaces share what the line leaves of the 80 mm.
    const spacing = (80 - helvetica('the third line', SIZE)) / 2;
    expect(first.rest).toContain(`words=${spacing.toFixed(2)}`);
    expect([first.x, first.y, last.x, last.y]).toEqual([20, 50, 20, Number((50 + LEADING).toFixed(2))]);
    expect(last.rest).not.toContain('words');
  });

  it('gives the tracking of spaced letters on each line', () => {
    const doc = makeDoc();
    doc.doc.text(['SPACED', 'OUT'], 12, 40, { charSpace: 0.5 });
    const drawn = texts(doc);
    expect(drawn.map(({ rest }) => rest)).toEqual([
      '16pt #000000 helvetica-normal tracking=0.50',
      '16pt #000000 helvetica-normal tracking=0.50',
    ]);
    expect(drawn[1].y).toBeCloseTo(40 + LEADING, 2);
  });

  it('turns a rotated text, its second line one leading further along the turned vertical', () => {
    const doc = makeDoc();
    doc.doc.text('TILTED', 100, 100, { angle: 45 });
    doc.doc.text(['First', 'Second'], 60, 150, { angle: 30 });
    const [tilted, first, second] = texts(doc);
    expect(tilted).toMatchObject({ x: 100, y: 100, rest: '16pt #000000 helvetica-normal angle=45.00' });
    expect(first).toMatchObject({ x: 60, y: 150, rest: '16pt #000000 helvetica-normal angle=30.00' });
    // Down the page is the text's -y: at 30 degrees, sin 30 to the right and cos 30 down.
    expect(second.x).toBeCloseTo(60 + LEADING * Math.sin(Math.PI / 6), 2);
    expect(second.y).toBeCloseTo(150 + LEADING * Math.cos(Math.PI / 6), 2);
    expect(second.rest).toBe(first.rest);
  });

  it('reads a hand-written stream that moves to the next line and shows a string on the same line', () => {
    const doc = makeDoc();
    const { write } = doc.doc.internal as unknown as { write: (...parts: string[]) => void };
    write('BT /F1 12 Tf 14 TL 0 0 1 rg 72 720 Td (One) Tj T* (Two) Tj 36 -28 Td (Three) Tj ET');
    const height = 297;
    expect(texts(doc)).toEqual([
      { x: 25.4, y: Number((height - 720 / K).toFixed(2)), rest: '12pt #0000ff helvetica-normal', text: 'One' },
      { x: 25.4, y: Number((height - 706 / K).toFixed(2)), rest: '12pt #0000ff helvetica-normal', text: 'Two' },
      { x: 38.1, y: Number((height - 678 / K).toFixed(2)), rest: '12pt #0000ff helvetica-normal', text: 'Three' },
    ]);
  });

  it('decodes the WinAnsi bytes of a standard font', () => {
    const doc = makeDoc();
    doc.doc.text('Prix – été €', 12, 40);
    expect(texts(doc)[0].text).toBe('Prix – été €');
  });

  it('decodes the glyphs of an embedded font, and names its face', () => {
    const doc = makeDoc({
      theme: createTheme({ colors: { primary: '#3572B8' }, typography: { fontFamily: INTER_FAMILY } }),
      fonts: interFonts,
    });
    doc.paragraph('Amount: 1 200 €');
    expect(linesOf(doc, 'text')[0]).toMatch(/Inter-normal "Amount: 1\\u00a0200 €"$/);
  });

  it('gives the opacity of fills, text and images, and the stroke opacity of strokes', () => {
    const doc = makeDoc();
    doc.doc.saveGraphicsState();
    doc.doc.setGState(new GState({ opacity: 0.4, 'stroke-opacity': 0.6 }));
    doc.doc.rect(10, 20, 30, 5, 'F');
    doc.doc.line(10, 30, 50, 30);
    doc.doc.text('Faint', 12, 40);
    doc.doc.addImage(PNG, 'PNG', 15, 50, 8, 4);
    doc.doc.restoreGraphicsState();
    doc.doc.rect(10, 60, 30, 5, 'F');
    const [fill, solid] = linesOf(doc, 'fill');
    expect(fill).toMatch(/ f opacity=0\.40$/);
    expect(linesOf(doc, 'stroke')[0]).toMatch(/ S opacity=0\.60$/);
    expect(texts(doc)[0].rest).toContain('opacity=0.40');
    expect(linesOf(doc, 'image')[0]).toMatch(/ opacity=0\.40$/);
    expect(solid).toMatch(/ f$/);
  });

  it('gives the dash of a dashed stroke, in mm, and none once the dash is reset', () => {
    const doc = makeDoc();
    doc.doc.setLineDashPattern([2, 1], 0.5);
    doc.doc.line(10, 30, 50, 30);
    doc.doc.setLineDashPattern([], 0);
    doc.doc.line(10, 40, 50, 40);
    const [dashed, solid] = linesOf(doc, 'stroke');
    expect(dashed).toMatch(/ S dash=\[2\.00 1\.00\]\+0\.50$/);
    expect(solid).toMatch(/ S$/);
  });

  it('gives the box of a clip', () => {
    const doc = makeDoc();
    doc.doc.rect(10, 20, 30, 40, null);
    doc.doc.clip();
    doc.doc.discardPath();
    expect(linesOf(doc, 'clip')).toEqual(['clip   x=10.00 y=20.00 w=30.00 h=40.00 W']);
  });

  it('lists the links of a page after its marks: their box, and their URL or target', () => {
    const doc = makeDoc();
    doc.addPage();
    doc.doc.setPage(1);
    doc.doc.link(10, 20, 30, 5, { url: 'https://example.com' });
    doc.doc.link(10, 40, 50, 6, { pageNumber: 2, top: 15 });
    doc.doc.text('After', 12, 80);
    const page = lines(doc).slice(2, 6);
    expect(page).toEqual([
      '## page 1 (210.00 x 297.00 mm)',
      expect.stringMatching(/^text .*"After"$/),
      'link   x=10.00 y=20.00 w=30.00 h=5.00 url "https://example.com"',
      'link   x=10.00 y=40.00 w=50.00 h=6.00 page 2 y=15.00',
    ]);
  });

  it.each([
    ['a text that starts below the page', (doc: Doc) => doc.doc.text('Away', 12, 300), /text lies off page 1/],
    ['a shape past the right edge', (doc: Doc) => doc.doc.rect(200, 20, 30, 5, 'F'), /fill lies off page 1/],
    ['an image above the page', (doc: Doc) => doc.doc.addImage(PNG, 'PNG', 15, -10, 8, 4), /image lies off page 1/],
  ])('refuses %s', (_name, draw, error) => {
    const doc = makeDoc();
    draw(doc);
    expect(() => describeLayout(doc)).toThrow(error);
  });

  it.each([
    ['a font that is not one of the document', 'BT /F99 12 Tf 10 10 Td (Lost) Tj ET', /Font F99/],
    ['a graphics state that is not one of the document', '/GS9 gs', /Graphics state not in the document/],
    ['an image that is not one of the document', 'q 10 0 0 10 50 50 cm /I9 Do Q', /Image I9/],
    ['a string a standard font cannot show', 'BT /F1 12 Tf 10 10 Td <0041> Tj ET', /cannot decode/],
  ])('refuses %s', (_name, stream, error) => {
    const doc = makeDoc();
    doc.registerImage('dot', PNG);
    (doc.doc.internal as unknown as { write: (value: string) => void }).write(stream);
    expect(() => describeLayout(doc)).toThrow(error);
  });

  it('refuses an annotation or a bookmark it does not read', () => {
    const note = makeDoc();
    note.doc.createAnnotation({ type: 'text', title: 'Note', bounds: { x: 10, y: 10, w: 5, h: 5 }, contents: 'Hi' });
    expect(() => describeLayout(note)).toThrow(/Annotation the reader does not follow/);
    const named = makeDoc();
    named.doc.link(10, 20, 30, 5, { pageNumber: 1, zoom: 2 });
    expect(() => describeLayout(named)).toThrow(/Annotation the reader does not follow/);
    const bookmark = makeDoc();
    bookmark.doc.outline.add(null, 'Somewhere', { url: 'https://example.com' } as never);
    expect(() => describeLayout(bookmark)).toThrow(/Bookmark the reader does not follow/);
  });
});

describe('decode', () => {
  const winAnsi = { name: 'helvetica', style: 'normal', encoding: 'WinAnsiEncoding' };
  const embedded = { name: 'Inter', style: 'normal', encoding: 'Identity-H', glyphs: { 1: 0x41, 2: 0xd800 } };

  it('reads the escapes of a literal string', () => {
    expect(decode('(\\(a\\) \\\\ \\351)', winAnsi)).toBe('(a) \\ é');
  });

  it.each([
    ['a byte WinAnsi leaves undefined', '(\\201)', winAnsi, /0x81 of helvetica has no WinAnsi character/],
    ['a control byte', '(\\001)', winAnsi, /0x1 of helvetica/],
    ['a glyph the font does not map', '<0003>', embedded, /Glyph 0003 of Inter has no character/],
    ['a glyph mapped to half of a surrogate pair', '<0002>', embedded, /half of a surrogate pair/],
    ['a hex string in a standard font', '<0001>', winAnsi, /cannot decode/],
  ])('refuses %s', (_name, raw, font, error) => {
    expect(() => decode(raw, font)).toThrow(error);
  });

  it('reads the glyphs of an embedded font', () => {
    expect(decode('<00010001>', embedded)).toBe('AA');
  });
});
