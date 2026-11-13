import { createHash } from 'node:crypto';

import type { PDFDocument } from '../../src/core/document';
import type { Dash, PageMark } from './content-stream';
import { pageContext, pageFrame, scanPages } from './helpers';

/** What a font resource is, how its strings are encoded, and how it names its glyphs. */
type FontEntry = { name: string; style: string; encoding: string; glyphs?: Record<number, number> };

/** The fonts of the document by resource name (`F15`), read through jsPDF's own lookup by family and style. */
function fontsOf(doc: PDFDocument): Map<string, FontEntry> {
  const fonts = new Map<string, FontEntry>();
  const lookup = doc.doc.internal as unknown as {
    getFont(
      family: string,
      style: string,
    ): { id: string; fontName: string; fontStyle: string; encoding: string; metadata?: unknown };
  };
  for (const [family, styles] of Object.entries(doc.doc.getFontList())) {
    for (const style of styles) {
      const { id, fontName, fontStyle, encoding, metadata } = lookup.getFont(family, style);
      const glyphs = (metadata as { toUnicode?: Record<number, number> } | undefined)?.toUnicode;
      fonts.set(id, { name: fontName, style: fontStyle, encoding, glyphs });
    }
  }
  return fonts;
}

/** The characters of WinAnsiEncoding (cp1252) from 0x80 to 0x9f; the five bytes it leaves undefined are `null`. */
const WIN_ANSI_HIGH = [
  0x20ac,
  null,
  0x201a,
  0x0192,
  0x201e,
  0x2026,
  0x2020,
  0x2021,
  0x02c6,
  0x2030,
  0x0160,
  0x2039,
  0x0152,
  null,
  0x017d,
  null,
  null,
  0x2018,
  0x2019,
  0x201c,
  0x201d,
  0x2022,
  0x2013,
  0x2014,
  0x02dc,
  0x2122,
  0x0161,
  0x203a,
  0x0153,
  null,
  0x017e,
  0x0178,
];

/** A byte of a WinAnsi string as its character: printable ASCII, cp1252 from 0x80, Latin-1 from 0xa0. */
function winAnsi(byte: number, font: FontEntry): string {
  const code = byte >= 0x80 && byte < 0xa0 ? WIN_ANSI_HIGH[byte - 0x80] : byte;
  if (code === null || byte < 0x20 || byte === 0x7f || byte > 0xff) {
    throw new Error(`Byte 0x${byte.toString(16)} of ${font.name} has no WinAnsi character`);
  }
  return String.fromCharCode(code);
}

/** The string a `Tj` operand shows: glyph ids of an embedded font, or a literal WinAnsi string of a standard one. */
export function decode(raw: string, font: FontEntry): string {
  if (font.encoding === 'Identity-H' && raw.startsWith('<')) {
    const glyphs = raw.slice(1, -1).match(/.{4}/g) ?? [];
    return glyphs
      .map((glyph) => {
        const code = font.glyphs?.[parseInt(glyph, 16)];
        if (code === undefined) throw new Error(`Glyph ${glyph} of ${font.name} has no character in the font`);
        if (code >= 0xd800 && code <= 0xdfff) {
          throw new Error(`Glyph ${glyph} of ${font.name} maps to half of a surrogate pair: 0x${code.toString(16)}`);
        }
        return String.fromCodePoint(code);
      })
      .join('');
  }
  if (font.encoding === 'WinAnsiEncoding' && raw.startsWith('(')) {
    const bytes = raw
      .slice(1, -1)
      .replace(/\\([0-7]{1,3}|.)/gs, (_, escape: string) =>
        /^[0-7]+$/.test(escape)
          ? String.fromCharCode(parseInt(escape, 8))
          : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[escape] ?? escape),
      );
    return [...bytes].map((char) => winAnsi(char.charCodeAt(0), font)).join('');
  }
  throw new Error(`String ${raw.slice(0, 20)} in ${font.name}, encoded ${font.encoding}: the reader cannot decode it`);
}

/** A number as the baselines write it: two decimals, never `-0.00`. */
const mm = (value: number) => (Math.round(value * 100) / 100 + 0).toFixed(2);

/** A string with the spaces that look alike told apart, and the quotes and breaks escaped. */
const visible = (value: string) =>
  JSON.stringify(value).replace(/[    ]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** The parts of a line that only show when they are not the default. */
const extras = (parts: Array<[boolean, string]>) =>
  parts
    .filter(([shown]) => shown)
    .map(([, part]) => ` ${part}`)
    .join('');

const dashOf = ({ array, phase }: Dash) => `dash=[${array.map(mm).join(' ')}]${phase === 0 ? '' : `+${mm(phase)}`}`;

/**
 * The image resources by name (`I0`), with a short fingerprint of the data each one writes. The data is what jsPDF
 * re-encodes: a new `jspdf` or `fflate` version can change the fingerprint without any change of layout.
 */
function imagesOf(doc: PDFDocument): Map<string, string> {
  const images = (doc.doc.internal as unknown as { collections: Record<string, unknown> }).collections
    .addImage_images as Record<string, { index: number; data: string }> | undefined;
  return new Map(
    Object.values(images ?? {}).map(({ index, data }) => [
      `I${index}`,
      createHash('sha256').update(data, 'latin1').digest('hex').slice(0, 8),
    ]),
  );
}

function describeMark(mark: PageMark, fonts: Map<string, FontEntry>, images: Map<string, string>): string {
  const at = `x=${mm(mark.x)} y=${mm(mark.y)}`;
  const opacity: [boolean, string] = [mark.opacity !== 1, `opacity=${mm(mark.opacity)}`];
  switch (mark.kind) {
    case 'text': {
      const font = fonts.get(mark.font);
      if (font === undefined) throw new Error(`Font ${mark.font} is not a font of the document`);
      const parts = extras([
        [mark.charSpace !== 0, `tracking=${mm(mark.charSpace)}`],
        [mark.wordSpace !== 0, `words=${mm(mark.wordSpace)}`],
        [mark.angle !== 0, `angle=${mm(mark.angle)}`],
        opacity,
      ]);
      return `text   ${at} ${mark.size}pt ${mark.color} ${font.name}-${font.style}${parts} ${visible(decode(mark.raw, font))}`;
    }
    case 'fill':
      return `fill   ${at} w=${mm(mark.width)} h=${mm(mark.height)} ${mark.color} ${mark.op}${extras([opacity])}`;
    case 'stroke': {
      const parts = extras([[mark.dash.array.length > 0, dashOf(mark.dash)], opacity]);
      return `stroke ${at} w=${mm(mark.width)} h=${mm(mark.height)} ${mark.color} line=${mm(mark.lineWidth)} ${mark.op}${parts}`;
    }
    case 'image': {
      const fingerprint = images.get(mark.name);
      if (fingerprint === undefined) throw new Error(`Image ${mark.name} is not an image of the document`);
      return `image  ${at} w=${mm(mark.width)} h=${mm(mark.height)} ${mark.name} ${fingerprint}${extras([opacity])}`;
    }
    case 'clip':
      return `clip   ${at} w=${mm(mark.width)} h=${mm(mark.height)} ${mark.op}`;
  }
}

/** A link as jsPDF keeps it until the PDF is written: its rectangle in points, and where it leads. */
type Annotation = {
  type: string;
  finalBounds?: { x: string; y: string; w: string; h: string };
  options?: Record<string, unknown>;
};

/**
 * Options of a link that change nothing at these values: jsPDF fills the first three in while it writes the PDF, and
 * its BiDi engine leaves `isInputVisual` on the options of a text with a link.
 */
const LINK_DEFAULTS: Record<string, unknown> = { magFactor: 'XYZ', left: 0, zoom: 0, isInputVisual: true };

/** One line per annotation of the page: its box (mm, from the top left of the page), and its URL or target page. */
function describeAnnotations(doc: PDFDocument, page: number): string[] {
  const { k, height } = pageFrame(doc, page);
  const annotations = pageContext(doc, page).annotations as Annotation[];
  return annotations.map(({ type, finalBounds, options = {} }) => {
    const { url, pageNumber, top, ...rest } = options;
    const unread = Object.entries(rest).filter(([key, value]) => LINK_DEFAULTS[key] !== value);
    if (
      type !== 'link' ||
      finalBounds === undefined ||
      unread.length > 0 ||
      (url === undefined) === (pageNumber === undefined)
    ) {
      throw new Error(`Annotation the reader does not follow on page ${page}: ${JSON.stringify({ type, options })}`);
    }
    const [left, upper, right, lower] = [finalBounds.x, finalBounds.y, finalBounds.w, finalBounds.h].map(Number);
    const box = `x=${mm(left / k)} y=${mm(height - upper / k)} w=${mm((right - left) / k)} h=${mm((upper - lower) / k)}`;
    const target = url === undefined ? `page ${pageNumber} y=${mm(Number(top ?? 0))}` : `url ${visible(String(url))}`;
    return `link   ${box} ${target}`;
  });
}

/** The properties of the document jsPDF writes in its information dictionary, its date and id aside. */
function describeProperties(doc: PDFDocument): string {
  type Private = { __private__: { getDocumentProperties(): Record<string, string> } };
  // oxlint-disable-next-line no-underscore-dangle -- jsPDF reads its properties back through `__private__` only.
  const properties = (doc.doc as unknown as Private).__private__.getDocumentProperties();
  const known = ['title', 'subject', 'author', 'keywords', 'creator'];
  const unknown = Object.keys(properties).filter((key) => !known.includes(key));
  if (unknown.length > 0) throw new Error(`Document properties the reader does not follow: ${unknown.join(', ')}`);
  const set = known.filter((key) => properties[key] !== '').map((key) => `${key}=${visible(properties[key])}`);
  return `properties ${set.length > 0 ? set.join(' ') : 'none'}`;
}

type OutlineItem = { title: string; options?: Record<string, unknown>; children: OutlineItem[] };

/** The bookmarks of the document on one line: each title and its page, the children in brackets. */
function describeOutline(doc: PDFDocument): string[] {
  const { root } = (doc.doc as unknown as { outline: { root: OutlineItem } }).outline;
  const item = ({ title, options = {}, children }: OutlineItem): string => {
    const { pageNumber, ...rest } = options;
    if (pageNumber === undefined || Object.keys(rest).length > 0) {
      throw new Error(`Bookmark the reader does not follow: ${JSON.stringify({ title, options })}`);
    }
    const nested = children.length > 0 ? ` [${children.map(item).join(', ')}]` : '';
    return `${visible(title)} p${pageNumber}${nested}`;
  };
  return root.children.length > 0 ? [`bookmarks ${root.children.map(item).join(', ')}`] : [];
}

/** Throws when a mark lies off its page: a text origin, or the box of a shape or an image. */
function checkOnPage(mark: PageMark, page: number, width: number, height: number): void {
  const [right, bottom] = mark.kind === 'text' ? [mark.x, mark.y] : [mark.x + mark.width, mark.y + mark.height];
  const tolerance = 0.01;
  if (mark.x < -tolerance || mark.y < -tolerance || right > width + tolerance || bottom > height + tolerance) {
    throw new Error(
      `A ${mark.kind} lies off page ${page}: x=${mm(mark.x)} y=${mm(mark.y)} to ${mm(right)}, ${mm(bottom)}`,
    );
  }
}

/**
 * The document, then every mark of every page, one line each, in the order the page paints them (which is the order
 * that stacks them): the text with its position, size, color and font, the filled and stroked shapes with their box
 * and color, the clips, the images with their resource and a fingerprint of their data, then the links of the page.
 * Opacity, dash, letter and word spacing and angle show when set. Positions are millimetres from the top left of the
 * page, rounded to 0.01. Nothing in it depends on the machine: no date, no document id, no path. Throws on what lies
 * off its page, and on whatever the reader does not know how to read.
 */
export function describeLayout(doc: PDFDocument): string {
  const fonts = fontsOf(doc);
  const images = imagesOf(doc);
  const lines = [describeProperties(doc), ...describeOutline(doc), ''];
  scanPages(doc).forEach(({ marks }, index) => {
    const page = index + 1;
    const { width, height } = pageFrame(doc, page);
    lines.push(`## page ${page} (${mm(width)} x ${mm(height)} mm)`);
    for (const mark of marks) {
      checkOnPage(mark, page, width, height);
      lines.push(describeMark(mark, fonts, images));
    }
    lines.push(...describeAnnotations(doc, page), '');
  });
  return lines.join('\n');
}
