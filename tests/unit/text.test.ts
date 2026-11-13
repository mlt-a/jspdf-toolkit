import { describe, expect, it, vi } from 'vitest';

import { HEADING, TEXT_LEVELS, ascentMm, descentMm, lineHeightMm } from '../../src/core/constants';
import type { TextLevel } from '../../src/core/constants';
import type { DrawingContext } from '../../src/core/context';
import type { PDFDocument } from '../../src/core/document';
import { InvalidOptionError } from '../../src/core/errors';
import {
  computeParagraphHeight,
  drawHeading,
  drawParagraph,
  headingHeight,
  levelColor,
  measureTextLevel,
  resolveTextStyle,
  setTextStyle,
  textLevelSize,
} from '../../src/drawing/text';
import type { HeadingOptions } from '../../src/drawing/text';
import {
  breakLongToken,
  drawJustifiedLine,
  fitWithEllipsis,
  normalizeText,
  remainingTextWidth,
  text as drawText,
  trackedWidth,
  wrap,
} from '../../src/drawing/text-lines';
import { INTER_FAMILY, interFonts } from '../../src/fonts/inter';
import { parseRichText } from '../../src/text/markup';
import { createTheme } from '../../src/theme/defaults';
import {
  LONG,
  channels,
  drawingState,
  expectDrawnHeight,
  expectRejectedBeforeDrawing,
  expectTextWithin,
  inFirstOfTwoColumns,
  lastEntryPage,
  lastText,
  leaveRoom,
  makeDoc,
  pageStream,
  recordTexts,
  scanPage,
  textOf,
} from './helpers';
import type { DrawnText } from './helpers';

describe('normalizeText', () => {
  it('maps narrow no-break space grouping (locale, e.g. fr-FR) to U+00A0', () => {
    expect(normalizeText('1 200 € x')).toBe('1 200 € x');
  });

  it('normalizes real fr-FR output with narrow no-break space grouping', () => {
    const formatted = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(1200);
    expect(normalizeText(formatted)).not.toMatch(/[   ]/);
  });

  it('leaves regular spaces and other text alone', () => {
    expect(normalizeText('a b c')).toBe('a b c');
  });
});

// Captures the words `drawJustifiedLine` places, with their x offset from the line start.
function placeJustified(doc: PDFDocument, line: string, width: number): Array<{ word: string; offset: number }> {
  const text = vi.spyOn(doc.doc, 'text');
  drawJustifiedLine(doc, line, 0, 50, width);
  const placed = text.mock.calls.map(([word, x]) => ({ word: word as string, offset: x as number }));
  text.mockRestore();
  return placed;
}

describe('drawJustifiedLine', () => {
  it('stretches a line to exactly the target width', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const width = 120;
    const placed = placeJustified(doc, 'The quick brown fox jumps over the lazy dog', width);
    const last = placed[placed.length - 1];
    expect(placed).toHaveLength(9);
    expect(placed[0].offset).toBe(0);
    expect(last.offset + doc.doc.getTextWidth(last.word)).toBeCloseTo(width);
  });

  it('does not stretch at narrow no-break space grouping (locale, e.g. fr-FR)', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const placed = placeJustified(doc, 'Total 1 200 €', 80);
    expect(placed.map((p) => p.word)).toEqual(['Total', '1 200', '€']);
  });

  it('keeps a single word at the start of the line', () => {
    const doc = makeDoc();
    expect(placeJustified(doc, 'Word', 80)).toEqual([{ word: 'Word', offset: 0 }]);
  });

  it('justifies every wrapped line of a paragraph to the measure', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const width = 90;
    const lines = wrap(
      doc,
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '.repeat(3),
      width,
    );
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines.slice(0, -1)) {
      const placed = placeJustified(doc, line, width);
      const last = placed[placed.length - 1];
      expect(last.offset + doc.doc.getTextWidth(last.word)).toBeCloseTo(width);
    }
  });
});

describe('text gateway', () => {
  it('normalizes narrow no-break space grouping (locale, e.g. fr-FR) for jsPDF text, measuring and wrapping', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    expect(doc.doc.getTextWidth('1 200')).toBe(doc.doc.getTextWidth('1 200'));
    expect(doc.doc.splitTextToSize('1 200', 100)).toEqual(['1 200']);
  });
});

const widthOf = (doc: PDFDocument, line: string) => doc.doc.getTextWidth(line);

describe('wrap with oversized words', () => {
  it.each([
    ['an email', 'maximilian.vandenberghe@international-holdings.example.com', /[@.-]$/],
    ['a URL', 'https://example.com/a/very/long/path/to/some-document_final.pdf', /[./_-]$/],
  ])('breaks %s at its separators when wider than the column', (_name, token, ending) => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const width = 40;
    expect(widthOf(doc, token)).toBeGreaterThan(width);

    const lines = wrap(doc, `Write to ${token} please`, width);
    expect(lines[0]).toBe('Write to');
    expect(lines[lines.length - 1]).toMatch(/please$/);
    for (const line of lines) expect(widthOf(doc, line)).toBeLessThanOrEqual(width);
    // The token pieces rejoin to the token, each cut after a separator.
    const pieces = lines.slice(1, -1);
    for (const piece of pieces) expect(piece).toMatch(ending);
    expect(lines.slice(1).join('')).toBe(`${token} please`);
  });

  it('wraps text without oversized words exactly as jsPDF does', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.\nSecond line';
    expect(wrap(doc, text, 60)).toEqual(doc.doc.splitTextToSize(text, 60));
  });
});

describe('wrap with letter spacing', () => {
  const TEXT = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.';

  it.each([
    ['words', TEXT],
    ['an oversized token', 'Write to maximilian.vandenberghe@international-holdings.example.com please'],
    ['a token without separators', 'DE89370400440532013000DE89370400440532013000'],
  ])('fits every tracked line of %s and loses no character', (_name, value) => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const width = 40;
    const lines = wrap(doc, value, width, 0.6);
    for (const line of lines) expect(trackedWidth(doc.doc, line, 0.6)).toBeLessThanOrEqual(width + 1e-6);
    expect(lines.join('').replace(/\s/g, '')).toBe(value.replace(/\s/g, ''));
  });

  it('breaks earlier than without spacing', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    expect(wrap(doc, TEXT, 60, 0.6).length).toBeGreaterThan(wrap(doc, TEXT, 60).length);
  });
});

describe('label font role', () => {
  it('uses labelFontFamily for label levels and falls back to the default family', () => {
    const theme = createTheme({ typography: { fontFamily: 'helvetica', labelFontFamily: 'times' } });
    const doc = makeDoc({ theme });
    setTextStyle(doc, 'fieldLabel');
    expect(doc.doc.getFont().fontName).toBe('times');
    setTextStyle(doc, 'body');
    expect(doc.doc.getFont().fontName).toBe('helvetica');

    const plain = makeDoc();
    setTextStyle(plain, 'label');
    expect(plain.doc.getFont().fontName).toBe(plain.theme.typography.fontFamily);
  });
});

describe('measure', () => {
  const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '.repeat(6);

  it('defaults to the content width and narrows paragraphs', () => {
    const wide = makeDoc();
    expect(wide.measure).toBe(wide.contentWidth);

    const narrow = makeDoc({ theme: wide.theme, measure: wide.contentWidth / 2 });
    expect(narrow.measure).toBe(wide.contentWidth / 2);
    expect(computeParagraphHeight(narrow, text)).toBeGreaterThan(computeParagraphHeight(wide, text));
  });

  it.each([0, -5, 500])('rejects an invalid measure of %s', (measure) => {
    expect(() => makeDoc({ theme: makeDoc().theme, measure })).toThrow(/Invalid measure/);
  });
});

describe('paragraph line height', () => {
  it('advances Y by the level line height for each wrapped line', () => {
    const doc = makeDoc();
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(8);
    const { lineHeight } = measureTextLevel(doc, 'small', { lineHeightScale: 1.5 });
    setTextStyle(doc, 'small');
    const lines = wrap(doc, text, doc.contentWidth).length;

    const start = doc.getYPos();
    doc.paragraph(text, { level: 'small', lineHeightScale: 1.5, spaceAfter: 0 });
    expect(doc.getYPos() - start).toBeCloseTo(lines * lineHeight);
    // The height leaves `spaceAfter` out, so the level spacing is not counted.
    expect(computeParagraphHeight(doc, text, { level: 'small', lineHeightScale: 1.5 })).toBeCloseTo(lines * lineHeight);
  });
});

describe('paragraph indent', () => {
  const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(8);

  it('starts every line at the indent and keeps the right edge of the reading column', () => {
    const doc = makeDoc();
    const calls = vi.spyOn(doc.doc, 'text');
    doc.paragraph(text, { indent: 20, align: 'justify' });
    const xs = calls.mock.calls.map((call) => Number(call[1]));
    expect(Math.min(...xs)).toBeCloseTo(doc.margins.left + 20, 6);

    setTextStyle(doc, 'body');
    const right = Math.max(...calls.mock.calls.map((call) => Number(call[1]) + doc.doc.getTextWidth(String(call[0]))));
    expect(right).toBeCloseTo(doc.margins.left + doc.measure, 1);
  });

  it('narrows the wrap width, which computeParagraphHeight follows', () => {
    const doc = makeDoc();
    const indented = computeParagraphHeight(doc, text, { indent: 60 });
    expect(indented).toBeGreaterThan(computeParagraphHeight(doc, text));

    const start = doc.getYPos();
    doc.paragraph(text, { indent: 60, spaceAfter: 0 });
    expect(doc.getYPos() - start).toBeCloseTo(indented, 6);
  });
});

function setup() {
  const doc = makeDoc();
  setTextStyle(doc, 'fieldValue');
  return doc;
}

describe('breakLongToken', () => {
  it('breaks an email after @ and at dots, never mid-word', () => {
    const doc = setup();
    const email = 'maximilian.vandenberghe@international-holdings.example.com';
    const width = 45;
    const lines = breakLongToken(doc, email, width);
    expect(lines.join('')).toBe(email);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(widthOf(doc, line)).toBeLessThanOrEqual(width);
    for (const line of lines.slice(0, -1)) expect(line).toMatch(/[@./_-]$/);
    expect(lines.some((line) => line.endsWith('@'))).toBe(true);
  });

  it('breaks a dashed IBAN at the dashes', () => {
    const doc = setup();
    const iban = 'FR76-3000-6000-0112-3456-7890-189';
    const lines = breakLongToken(doc, iban, 25);
    expect(lines.join('')).toBe(iban);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(0, -1)) expect(line).toMatch(/-$/);
  });

  it('falls back to a character cut for a token without separators', () => {
    const doc = setup();
    const iban = 'DE89370400440532013000';
    const width = 20;
    const lines = breakLongToken(doc, iban, width);
    expect(lines.join('')).toBe(iban);
    for (const line of lines) expect(widthOf(doc, line)).toBeLessThanOrEqual(width);
  });

  it('gives one empty line for an empty token, and keeps the @ of an address with no domain', () => {
    const doc = setup();
    expect(breakLongToken(doc, '', 20)).toEqual(['']);
    expect(breakLongToken(doc, 'maximilian.vandenberghe@', 20).join('')).toBe('maximilian.vandenberghe@');
  });

  it('cuts a tracked token by character within the width, the tracking counted', () => {
    const doc = setup();
    const token = 'W'.repeat(40);
    const lines = breakLongToken(doc, token, 30, 0.5);
    expect(lines.join('')).toBe(token);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(trackedWidth(doc.doc, line, 0.5)).toBeLessThanOrEqual(30);
  });

  it('wrap keeps normal words whole and breaks only the oversized token', () => {
    const doc = setup();
    const lines = wrap(doc, 'Contact: maximilian.vandenberghe@international-holdings.example.com today', 45);
    expect(lines[0]).toBe('Contact:');
    expect(lines[lines.length - 1]).toMatch(/today$/);
    for (const line of lines) expect(widthOf(doc, line)).toBeLessThanOrEqual(45);
  });
});

const metrics = (lineHeightFactor: number, level: 'body' | 'fieldValue') =>
  measureTextLevel(
    makeDoc({ theme: createTheme({ colors: { primary: '#3572B8' }, typography: { lineHeightFactor } }) }),
    level,
  );

describe('measureTextLevel', () => {
  it('derives the line height from lineHeightMm and the level size', () => {
    const theme = createTheme({ colors: { primary: '#3572B8' } });
    const { lineHeight } = metrics(theme.typography.lineHeightFactor, 'body');
    expect(lineHeight).toBeCloseTo(lineHeightMm(theme.typography.sizes.body, theme.typography.lineHeightFactor));
  });

  it('scales the line height linearly with lineHeightFactor', () => {
    expect(metrics(2.3, 'fieldValue').lineHeight).toBeCloseTo(metrics(1.15, 'fieldValue').lineHeight * 2);
  });

  it('derives the ascent from the font size, independent of lineHeightFactor', () => {
    const theme = createTheme({ colors: { primary: '#3572B8' } });
    expect(metrics(1.15, 'body').ascent).toBeCloseTo(ascentMm(theme.typography.sizes.body));
    expect(metrics(1.6, 'body').ascent).toBe(metrics(1.15, 'body').ascent);
  });

  it('derives the descent from the font size, independent of lineHeightFactor', () => {
    const theme = createTheme({ colors: { primary: '#3572B8' } });
    expect(metrics(1.15, 'body').descent).toBeCloseTo(descentMm(theme.typography.sizes.body));
    expect(metrics(1.6, 'body').descent).toBe(metrics(1.15, 'body').descent);
  });
});

const LEVELS: TextLevel[] = [...TEXT_LEVELS];

/** Expects a color read back from jsPDF, which rounds the channels, to be `expected`. */
function expectColor(actual: string, expected: string): void {
  channels(actual).forEach((channel, index) =>
    expect(Math.abs(channel - channels(expected)[index])).toBeLessThanOrEqual(1),
  );
}

/** A size of its own for every entry of `typography.sizes`, so a level that reads the wrong entry shows. */
const DISTINCT_SIZES = {
  h1: 30,
  h2: 20,
  h3: 13,
  h4: 11,
  body: 10,
  small: 8.5,
  caption: 7.5,
  label: 9.5,
  fieldLabel: 8.25,
  fieldValue: 10.5,
  footer: 7.25,
};

describe('the size of a text level', () => {
  // [level, default size, size with DISTINCT_SIZES]: the derived levels read their base level's entry.
  it.each<[TextLevel, number, number]>([
    ['h1', 24, 30],
    ['h2', 14, 20],
    ['h3', 10, 13],
    ['h4', 8, 11],
    ['body', 9, 10],
    ['bodyBold', 9, 10],
    ['small', 8, 8.5],
    ['smallMuted', 8, 8.5],
    ['caption', 7, 7.5],
    ['label', 9, 9.5],
    ['fieldLabel', 8, 8.25],
    ['fieldValue', 10, 10.5],
    ['footer', 7, 7.25],
    ['italic', 8, 8.5],
  ])('%s is %s pt by default, %s pt from its entry of typography.sizes', (level, byDefault, distinct) => {
    expect(textLevelSize(makeDoc(), level)).toBe(byDefault);
    const doc = makeDoc({ theme: createTheme({ typography: { sizes: DISTINCT_SIZES } }) });
    expect(textLevelSize(doc, level)).toBe(distinct);
    expect(measureTextLevel(doc, level).ascent).toBeCloseTo(ascentMm(distinct));
    expect(measureTextLevel(doc, level).descent).toBeCloseTo(descentMm(distinct));
    expect(resolveTextStyle(doc, level).size).toBe(distinct);
    setTextStyle(doc, level);
    expect(doc.doc.getFontSize()).toBe(distinct);
  });

  it('is shared by the levels derived from a base level', () => {
    const doc = makeDoc({ theme: createTheme({ typography: { sizes: { body: 13, small: 6 } } }) });
    expect(textLevelSize(doc, 'bodyBold')).toBe(13);
    expect(textLevelSize(doc, 'smallMuted')).toBe(6);
    expect(textLevelSize(doc, 'italic')).toBe(6);
    expect(measureTextLevel(doc, 'italic').lineHeight).toBe(measureTextLevel(doc, 'small').lineHeight);
  });
});

/** A document whose `small` and `h2` levels are restyled, on Helvetica with Times for titles and Courier for labels. */
function restyledDoc(): PDFDocument {
  const theme = createTheme({
    colors: { primary: '#3572B8' },
    typography: {
      fontFamily: 'helvetica',
      titleFontFamily: 'times',
      labelFontFamily: 'courier',
      sizes: { small: 12, h2: 20 },
      levels: { small: { color: '#C00000', bold: true, italic: true, font: 'title' }, h2: { color: 'error' } },
    },
  });
  return makeDoc({ theme });
}

const rowHeight = (size: number) => {
  const doc = makeDoc({ theme: createTheme({ typography: { sizes: { small: size } } }) });
  const start = doc.getYPos();
  doc.table([{ a: 'Cell' }], { columns: [{ header: 'A', key: 'a' }], spaceAfter: 0 });
  return doc.getYPos() - start;
};

describe('a restyled text level', () => {
  it.each(LEVELS)('is set by setTextStyle, whatever the level: %s', (level) => {
    const typography = { fontFamily: 'helvetica', labelFontFamily: 'courier' };
    const doc = makeDoc({
      theme: createTheme({
        typography: {
          ...typography,
          levels: { [level]: { color: '#102030', bold: true, italic: true, font: 'label' } },
        },
      }),
    });
    const plain = makeDoc({ theme: createTheme({ typography }) });
    setTextStyle(doc, level);
    expect(doc.doc.getFont()).toMatchObject({ fontName: 'courier', fontStyle: 'bolditalic' });
    expectColor(doc.doc.getTextColor(), '#102030');
    expect(doc.doc.getFontSize()).toBe(textLevelSize(doc, level));
    // The other levels keep their own style.
    for (const other of LEVELS.filter((name) => name !== level)) {
      expect(resolveTextStyle(doc, other)).toEqual(resolveTextStyle(plain, other));
    }
  });

  it('can turn the built-in bold of a level off, and its built-in color to another token', () => {
    const doc = makeDoc({
      theme: createTheme({
        typography: { levels: { h1: { bold: false, color: 'secondary' }, label: { bold: false } } },
      }),
    });
    expect(resolveTextStyle(doc, 'h1')).toMatchObject({ fontStyle: 'normal', color: doc.theme.colors.secondary });
    expect(resolveTextStyle(doc, 'label').fontStyle).toBe('normal');
    // An emphasis asked by the caller goes on top.
    expect(resolveTextStyle(doc, 'label', { bold: true }).fontStyle).toBe('bold');
    expect(resolveTextStyle(doc, 'label', { italic: true }).fontStyle).toBe('italic');
  });

  it('reads the weights of the theme: bold on a family without a bold face', () => {
    const theme = createTheme({
      typography: { weights: { regular: 'normal', bold: 'normal' }, levels: { body: { bold: true, italic: true } } },
    });
    expect(resolveTextStyle(makeDoc({ theme }), 'body').fontStyle).toBe('italic');
  });

  it('is what a paragraph is set in', () => {
    const doc = restyledDoc();
    const texts = recordTexts(doc);
    const setFont = vi.spyOn(doc.doc, 'setFont');
    doc.paragraph('Small text', { level: 'small' });
    doc.paragraph('Body text');

    const small = textOf(texts, 'Small text');
    expect(small.fontStyle).toBe('bolditalic');
    expectColor(small.color, '#C00000');
    expect(setFont).toHaveBeenCalledWith('times', 'bolditalic');
    expect(textOf(texts, 'Body text').fontStyle).toBe('normal');
    expectColor(textOf(texts, 'Body text').color, doc.theme.colors.text);
  });

  it('is what measureTextLevel and the height of a paragraph measure: its size from typography.sizes', () => {
    const doc = restyledDoc();
    const plain = makeDoc();
    expect(measureTextLevel(doc, 'small').lineHeight).toBeCloseTo(
      lineHeightMm(12, doc.theme.typography.lineHeightFactor),
    );
    expect(measureTextLevel(doc, 'small').ascent).toBeCloseTo(ascentMm(12));
    expect(measureTextLevel(doc, 'h2').lineHeight).toBeGreaterThan(measureTextLevel(plain, 'h2').lineHeight);
    // The same size at another weight and family wraps by the width it has.
    const text = 'A line long enough to wrap in a column of a few words only, more than once';
    expect(computeParagraphHeight(doc, text, { level: 'small', maxWidth: 40 })).toBeGreaterThan(
      computeParagraphHeight(plain, text, { level: 'small', maxWidth: 40 }),
    );
  });

  it('is what a heading is set in', () => {
    const doc = restyledDoc();
    const texts = recordTexts(doc);
    doc.heading('Section', { level: 'h2', keepWithNext: false });
    expect(textOf(texts, 'Section').fontStyle).toBe('bold');
    expectColor(textOf(texts, 'Section').color, doc.theme.colors.error);
  });

  it('keeps its color on a heading title that has a number or a rule, where the built-in accent gives way', () => {
    const doc = restyledDoc();
    const plain = makeDoc();
    const texts = recordTexts(doc);
    const plainTexts = recordTexts(plain);
    for (const target of [doc, plain]) {
      target
        .heading('Numbered', { level: 'h2', number: '1', keepWithNext: false })
        .heading('Ruled', { level: 'h2', rule: true, keepWithNext: false });
    }

    expectColor(textOf(texts, '1').color, doc.theme.colors.primary);
    expectColor(textOf(texts, 'Numbered').color, doc.theme.colors.error);
    expectColor(textOf(texts, 'Ruled').color, doc.theme.colors.error);
    expectColor(textOf(plainTexts, 'Numbered').color, plain.theme.colors.text);
    expectColor(textOf(plainTexts, 'Ruled').color, plain.theme.colors.text);
  });

  it('gives its color to levelColor over the fallback of the block, else the fallback, else the built-in color', () => {
    const doc = restyledDoc();
    expect(levelColor(doc, 'h2', 'text')).toBe(doc.theme.colors.error);
    expect(levelColor(doc, 'small', 'secondary')).toBe('#C00000');
    expect(levelColor(doc, 'h4', 'text')).toBe(doc.theme.colors.text);
    expect(levelColor(doc, 'h4', '#abc')).toBe('#AABBCC');
    expect(levelColor(doc, 'h4')).toBe(doc.theme.colors.secondary);
  });

  it('is what the cells of a table are set in: font, size and the color of the body and the foot', () => {
    const doc = restyledDoc();
    const texts = recordTexts(doc);
    doc.table([{ a: 'Cell', b: 'Other' }], {
      columns: [
        { header: 'Head', key: 'a' },
        { header: 'Head 2', key: 'b' },
      ],
      footRow: ['Total', '1'],
    });

    for (const label of ['Cell', 'Total']) {
      expect(textOf(texts, label).fontStyle).toBe('bolditalic');
      expectColor(textOf(texts, label).color, '#C00000');
    }
    // The head is set on the primary fill: its color stays the one that reads on it.
    expect(textOf(texts, 'Head').fontStyle).toBe('bolditalic');
    expectColor(textOf(texts, 'Head').color, doc.theme.colors.onPrimary);
    const plain = makeDoc();
    const plainTexts = recordTexts(plain);
    plain.table([{ a: 'Cell', b: 'Other' }], {
      columns: [
        { header: 'Head', key: 'a' },
        { header: 'Head 2', key: 'b' },
      ],
    });
    expect(textOf(plainTexts, 'Cell').fontStyle).toBe('normal');
    expectColor(textOf(plainTexts, 'Cell').color, plain.theme.colors.text);
  });

  it('sizes the rows of a table by the size of the level', () => {
    expect(rowHeight(14)).toBeGreaterThan(rowHeight(8));
  });

  it('leaves the drawing state as it was', () => {
    const doc = restyledDoc();
    const before = drawingState(doc);
    doc.heading('Section', { level: 'h2', number: '1' }).paragraph('Text', { level: 'small' });
    expect(drawingState(doc)).toEqual(before);
  });

  it('is the title color of the header columns, where the title is set in ink', () => {
    const doc = restyledDoc();
    const plain = makeDoc();
    const texts = recordTexts(doc);
    const plainTexts = recordTexts(plain);
    const columns = [{ title: 'Seller', fields: [{ label: 'Name', value: 'Acme' }] }];
    doc.headerColumns(columns);
    plain.headerColumns(columns);
    expectColor(textOf(texts, 'Seller').color, doc.theme.colors.error);
    expectColor(textOf(plainTexts, 'Seller').color, plain.theme.colors.text);
  });
});

const RESTYLED = '#102030';

const HEADER = [{ title: 'Seller', fields: [{ label: 'Name', value: 'Acme' }] }];

/** A document whose `level` the theme colors `RESTYLED`, else the default theme. */
const levelDoc = (level?: TextLevel) =>
  makeDoc({
    theme: createTheme({
      colors: { primary: '#3572B8' },
      typography: { levels: level === undefined ? {} : { [level]: { color: RESTYLED } } },
    }),
  });

describe('a block that sets a level in a color of its own', () => {
  // [block, what it draws, the text drawn, its level, its color in the default theme]
  it.each<[string, (doc: PDFDocument) => unknown, string, TextLevel, keyof PDFDocument['theme']['colors']]>([
    [
      'a heading title with a number',
      (doc) => doc.heading('Title', { level: 'h2', number: '1', keepWithNext: false }),
      'Title',
      'h2',
      'text',
    ],
    [
      'a heading title with a rule',
      (doc) => doc.heading('Title', { level: 'h1', rule: true, keepWithNext: false }),
      'Title',
      'h1',
      'text',
    ],
    ['the title of a header column', (doc) => doc.headerColumns(HEADER), 'Seller', 'h2', 'text'],
    ['the label of a header column field', (doc) => doc.headerColumns(HEADER), 'Name', 'fieldLabel', 'secondary'],
    ['the value of a header column field', (doc) => doc.headerColumns(HEADER), 'Acme', 'fieldValue', 'text'],
    ['the back cover contact', (doc) => doc.backCover({ contact: { lines: ['Contact'] } }), 'Contact', 'small', 'text'],
    ['the back cover legal text', (doc) => doc.backCover({ legalText: 'Legal' }), 'Legal', 'footer', 'secondary'],
    ['a closing note', (doc) => doc.closingNote('Closing'), 'Closing', 'footer', 'secondary'],
    [
      'a closing note in another level',
      (doc) => doc.closingNote('Closing', { level: 'body' }),
      'Closing',
      'body',
      'secondary',
    ],
    [
      'the label of a leader field',
      (doc) => doc.fields([{ label: 'Status', value: 'Open' }], { layout: 'leader' }),
      'Status',
      'fieldLabel',
      'secondary',
    ],
    [
      'a signature sublabel',
      (doc) => doc.signatureZone([{ label: 'Client', sublabel: 'Sublabel' }]),
      'Sublabel',
      'smallMuted',
      'subtle',
    ],
    [
      'the eyebrow of a callout',
      (doc) => doc.infoBox('Body', { variant: 'callout', eyebrow: 'Note' }),
      'NOTE',
      'fieldLabel',
      'primary',
    ],
  ])('%s follows the theme color of its level, else keeps its own', (_, draw, label, level, own) => {
    const plain = levelDoc();
    const plainTexts = recordTexts(plain);
    draw(plain);
    expectColor(lastText(plainTexts, label).color, plain.theme.colors[own]);

    const doc = levelDoc(level);
    const texts = recordTexts(doc);
    draw(doc);
    expectColor(lastText(texts, label).color, RESTYLED);
  });

  it.each<[string, (doc: PDFDocument) => unknown, string]>([
    ['a badge', (doc) => doc.badge('Badge'), 'Badge'],
    ['a closing note', (doc) => doc.closingNote('Closing'), 'Closing'],
  ])('sets %s in its exact color after placing a waiting heading', (_, draw, label) => {
    // The color operator jsPDF writes in the text block: reading the color back would round both alike.
    const colorOf = (doc: PDFDocument) => {
      const block = pageStream(doc, 1)
        .split('BT')
        .find((text) => text.includes(`(${label}) Tj`));
      return block?.match(/[\d. ]+ rg/)?.[0];
    };
    const alone = makeDoc();
    draw(alone);
    const doc = makeDoc();
    doc.heading('Waiting');
    draw(doc);
    expect(colorOf(alone)).toBeDefined();
    expect(colorOf(doc)).toBe(colorOf(alone));
  });

  // The font of a label is its own; its color is the one of the `fieldLabel` level, whatever level its font comes from.
  it.each<[string, (doc: PDFDocument) => unknown, string, TextLevel]>([
    ['the label of a header column field', (doc) => doc.headerColumns(HEADER), 'Name', 'fieldValue'],
    [
      'the label of a leader field',
      (doc) => doc.fields([{ label: 'Status', value: 'Open' }], { layout: 'leader' }),
      'Status',
      'body',
    ],
  ])('keeps %s apart from the color of the level its font comes from', (_, draw, label, fontLevel) => {
    const plain = levelDoc();
    const plainTexts = recordTexts(plain);
    draw(plain);
    const doc = levelDoc(fontLevel);
    const texts = recordTexts(doc);
    draw(doc);
    expect(lastText(texts, label).color).toBe(lastText(plainTexts, label).color);
    expect(lastText(texts, label).fontStyle).toBe(lastText(plainTexts, label).fontStyle);
  });

  it('gives way to a color its options name', () => {
    const doc = levelDoc('footer');
    const texts = recordTexts(doc);
    doc.closingNote('Closing', { color: 'error' }).backCover({ contact: { lines: ['Contact'], color: 'error' } });
    expectColor(textOf(texts, 'Closing').color, doc.theme.colors.error);
    expectColor(textOf(texts, 'Contact').color, doc.theme.colors.error);
  });

  it('sets the back cover contact in the font of the small level', () => {
    const doc = makeDoc({
      theme: createTheme({
        typography: { labelFontFamily: 'courier', levels: { small: { bold: true, font: 'label' } } },
      }),
    });
    const setFont = vi.spyOn(doc.doc, 'setFont');
    doc.backCover({ contact: { lines: ['Contact'] } });
    expect(setFont).toHaveBeenCalledWith('courier', 'bold');
  });
});

const isItalic = (message: unknown) => String(message).includes('no italic face');

describe('the style of a level', () => {
  it('is resolved once per document, level and emphasis', () => {
    const doc = makeDoc();
    expect(resolveTextStyle(doc, 'body')).toBe(resolveTextStyle(doc, 'body'));
    expect(resolveTextStyle(doc, 'body', { bold: true })).toBe(resolveTextStyle(doc, 'body', { bold: true }));
    expect(resolveTextStyle(doc, 'body', { bold: true })).not.toBe(resolveTextStyle(doc, 'body'));
    expect(resolveTextStyle(doc, 'body')).not.toBe(resolveTextStyle(makeDoc(), 'body'));
    expect(Object.isFrozen(resolveTextStyle(doc, 'body'))).toBe(true);
  });

  it('lets an emphasis of true or false win over the level, and undefined leave it to the level', () => {
    const doc = makeDoc({ theme: createTheme({ typography: { levels: { small: { bold: true, italic: true } } } }) });
    expect(resolveTextStyle(doc, 'small').fontStyle).toBe('bolditalic');
    expect(resolveTextStyle(doc, 'small', {}).fontStyle).toBe('bolditalic');
    expect(resolveTextStyle(doc, 'small', { bold: undefined, italic: undefined })).toBe(resolveTextStyle(doc, 'small'));
    expect(resolveTextStyle(doc, 'small', { bold: false }).fontStyle).toBe('italic');
    expect(resolveTextStyle(doc, 'small', { italic: false }).fontStyle).toBe('bold');
    expect(resolveTextStyle(doc, 'small', { bold: false, italic: false }).fontStyle).toBe('normal');
    expect(resolveTextStyle(doc, 'body', { bold: true, italic: true }).fontStyle).toBe('bolditalic');
    // Built-in emphasis too: a bold level and an italic one.
    expect(resolveTextStyle(makeDoc(), 'bodyBold', { bold: false }).fontStyle).toBe('normal');
    expect(resolveTextStyle(makeDoc(), 'italic', { italic: false }).fontStyle).toBe('normal');
  });

  it('keeps false and undefined apart in the cache', () => {
    const doc = makeDoc({ theme: createTheme({ typography: { levels: { small: { bold: true } } } }) });
    const unset = resolveTextStyle(doc, 'small', { bold: undefined });
    const off = resolveTextStyle(doc, 'small', { bold: false });
    expect(unset.fontStyle).toBe('bold');
    expect(off.fontStyle).toBe('normal');
    expect(resolveTextStyle(doc, 'small', { bold: false })).toBe(off);
    expect(resolveTextStyle(doc, 'small')).toBe(unset);
  });

  it('keeps the weight of a bold level for the runs of rich text that are not marked', () => {
    const doc = makeDoc({ theme: createTheme({ typography: { levels: { small: { bold: true } } } }) });
    const texts = recordTexts(doc);
    doc.richText('Plain and *slanted*', { level: 'small' });
    expect(textOf(texts, 'Plain and').fontStyle).toBe('bold');
    expect(textOf(texts, 'slanted').fontStyle).toBe('bolditalic');
  });

  it('sets the runs marked bold in a regular level in bold', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.richText('Plain and **strong**', { level: 'small' });
    expect(textOf(texts, 'Plain and').fontStyle).toBe('normal');
    expect(textOf(texts, 'strong').fontStyle).toBe('bold');
  });

  it('warns once for a missing face, after a measuring pass rolled the warning back as well', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = makeDoc({ fonts: interFonts.filter((font) => font.style !== 'italic'), debug: true });
    doc.keepTogether(() => doc.paragraph('Italic', { level: 'italic' }));
    doc.paragraph('Italic', { level: 'italic' }).paragraph('Italic again', { level: 'italic' });
    expect(doc.warnings.filter(isItalic)).toHaveLength(1);
    expect(warn.mock.calls.filter(([message]) => isItalic(message))).toHaveLength(1);
    warn.mockRestore();
  });

  it('sees a face registered after it was first resolved', () => {
    const doc = makeDoc({ fonts: interFonts.filter((font) => font.style !== 'bold') });
    expect(resolveTextStyle(doc, 'bodyBold').fontStyle).toBe('normal');
    const bold = interFonts.find((font) => font.style === 'bold')!;
    doc.doc.addFileToVFS('Late-Bold.ttf', bold.data as string);
    doc.doc.addFont('Late-Bold.ttf', INTER_FAMILY, 'bold', undefined, 'Identity-H');
    expect(resolveTextStyle(doc, 'bodyBold').fontStyle).toBe('bold');
  });
});

/** The search it replaces: one character less at a time, from the end. */
function oneByOne(doc: PDFDocument, value: string, maxWidth: number, charSpace = 0): string {
  if (trackedWidth(doc.doc, value, charSpace) <= maxWidth) return value;
  for (let end = value.length - 1; end >= 0; end--) {
    const candidate = `${value.slice(0, end).trimEnd()}…`;
    if (trackedWidth(doc.doc, candidate, charSpace) <= maxWidth) return candidate;
  }
  return '';
}

describe('fitWithEllipsis', () => {
  it.each([
    ['a word', 'Total'],
    ['words and spaces', 'Equities   and other listed securities'],
    ['a long paragraph', LONG.repeat(4)],
  ])('cuts %s where a search one character at a time does', (_, value) => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    for (const width of [-1, 0, 1, 2.5, 7, 18, 40, 95, 300, 5000]) {
      for (const charSpace of [0, 0.4]) {
        expect(fitWithEllipsis(doc, value, width, charSpace), `${width} mm, ${charSpace}`).toBe(
          oneByOne(doc, value, width, charSpace),
        );
      }
    }
  });

  it('keeps a text that fits, and gives nothing when even the ellipsis is wider', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    expect(fitWithEllipsis(doc, 'Total', 100)).toBe('Total');
    expect(fitWithEllipsis(doc, '', 0)).toBe('');
    expect(fitWithEllipsis(doc, 'Total', 0.5)).toBe('');
  });

  it('measures a long text a few times, not once per character', () => {
    const doc = makeDoc();
    setTextStyle(doc, 'body');
    const measure = vi.spyOn(doc.doc, 'getTextWidth');
    const value = LONG.repeat(40);
    expect(fitWithEllipsis(doc, value, 60).endsWith('…')).toBe(true);
    expect(measure.mock.calls.length).toBeLessThan(2 * Math.log2(value.length) + 4);
  });
});

// The values they refuse are in `option-validation.test.ts`.
describe('paragraph indent and width', () => {
  it('names the option it refuses, and the measure an indent leaves no width in', () => {
    const doc = makeDoc();
    expect(() => computeParagraphHeight(doc, 'Text', { indent: Number.NaN })).toThrow(/paragraph indent/);
    expect(() => computeParagraphHeight(doc, 'Text', { maxWidth: 0 })).toThrow(/paragraph maxWidth/);
    expect(() => doc.paragraph('Text', { indent: doc.measure })).toThrow(/measure less its indent/);
  });

  it('accepts a negative indent and an indent just under the measure', () => {
    expect(() => makeDoc().paragraph('Text', { indent: -2 })).not.toThrow();
    const doc = makeDoc();
    expect(() => doc.paragraph('Text', { indent: doc.measure - 5 })).not.toThrow();
  });

  it('refuses an indent that leaves a maxWidth no room in the content width', () => {
    const doc = makeDoc({ measure: 100 });
    expect(() => doc.paragraph('Text', { indent: doc.contentWidth, maxWidth: 50 })).toThrow(
      /content width less its indent/,
    );
  });
});

/** The blocks that take a `maxWidth`, drawing `LONG` with the options given. */
const WIDE_BLOCKS: [string, (doc: PDFDocument, options: { indent?: number; maxWidth: number }) => unknown][] = [
  ['paragraph', (doc, options) => doc.paragraph(LONG, options)],
  ['paragraphs', (doc, options) => doc.paragraphs([LONG, LONG], options)],
  ['richText', (doc, options) => doc.richText(`**${LONG}**`, options)],
  ['richBlocks', (doc, options) => doc.richBlocks(parseRichText(LONG), options)],
  ['list', (doc, options) => doc.bulletList([LONG, { text: LONG, subItems: [LONG], detail: LONG }], options)],
];

describe.each(WIDE_BLOCKS)('a %s maxWidth wider than the available width', (what, draw) => {
  const name = what === 'paragraphs' ? 'paragraph' : what === 'richBlocks' ? 'richText' : what;

  it('is brought down to the available width, with a warning', () => {
    const doc = makeDoc({ measure: 100 });
    const texts = recordTexts(doc);
    draw(doc, { maxWidth: 500 });
    expectTextWithin(texts, doc.margins.left, doc.margins.left + doc.contentWidth);
    // It takes the content width, not the measure.
    expect(Math.max(...texts.flatMap((call) => call.x + Math.max(...call.widths)))).toBeGreaterThan(
      doc.margins.left + doc.measure,
    );
    expect(doc.warnings).toEqual([
      `${name} maxWidth of 500.0 mm is wider than the available width (${doc.contentWidth.toFixed(1)} mm): ` +
        'it is brought down to fit',
    ]);
  });

  it('is brought down to what its indent leaves', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    draw(doc, { indent: 30, maxWidth: doc.contentWidth });
    expectTextWithin(texts, doc.margins.left + 30, doc.margins.left + doc.contentWidth);
    expect(doc.warnings).toEqual([
      `${name} maxWidth of ${doc.contentWidth.toFixed(1)} mm is wider than the available width ` +
        `(${(doc.contentWidth - 30).toFixed(1)} mm, the content width less the 30.0 mm indent): it is brought down to fit`,
    ]);
  });

  it('is brought down to its column', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const pageWidth = doc.contentWidth;
    const frame = inFirstOfTwoColumns(doc, (column) => draw(column, { maxWidth: pageWidth }));
    expectTextWithin(
      texts.filter((call) => call.lines[0] !== 'Beside.'),
      frame.left,
      frame.left + frame.width,
    );
    expect(doc.warnings).toEqual([
      `${name} maxWidth of ${pageWidth.toFixed(1)} mm is wider than the available width ` +
        `(${frame.width.toFixed(1)} mm): it is brought down to fit`,
    ]);
  });

  it('is kept, without a warning, when it fits the content width', () => {
    const doc = makeDoc({ measure: 100 });
    draw(doc, { maxWidth: doc.contentWidth });
    expect(doc.warnings).toEqual([]);
  });
});

describe('a maxWidth wider than the available width, with nothing to draw', () => {
  it.each([
    ['paragraph', (doc: PDFDocument) => doc.paragraph('', { maxWidth: 500 })],
    ['computeParagraphHeight', (doc: PDFDocument) => computeParagraphHeight(doc, '', { maxWidth: 500 })],
    ['richText', (doc: PDFDocument) => doc.richText('', { maxWidth: 500 })],
    ['bulletList', (doc: PDFDocument) => doc.bulletList([], { maxWidth: 500 })],
  ])('%s raises no warning', (_name, run) => {
    const doc = makeDoc();
    run(doc);
    expect(doc.warnings).toEqual([]);
  });
});

describe('the height of a paragraph whose maxWidth is brought down', () => {
  it('is the height it draws', () => {
    expectDrawnHeight(computeParagraphHeight, drawParagraph, LONG, { maxWidth: 500, spaceAfter: 0 });
  });
});

/** Where the page stream starts each string (mm), by the literal it shows. */
const drawnAt = (doc: PDFDocument) =>
  new Map(scanPage(doc, 1).marks.flatMap((mark) => (mark.kind === 'text' ? [[mark.raw, mark] as const] : [])));

/** The width of a line drawn with 0.6 mm between its letters: one spacing fewer than letters. */
const tracked = (doc: PDFDocument, line: string) => doc.doc.getTextWidth(line) + 0.6 * (line.length - 1);

describe('text with letter spacing and an anchor', () => {
  it.each([
    ['right', (x: number, width: number) => x - width],
    ['center', (x: number, width: number) => x - width / 2],
  ] as const)('starts each line of tracked text at its anchor less its tracked width, aligned %s', (align, left) => {
    const doc = setup();
    drawText(doc, ['Alpha', 'Beta gamma'], 100, 50, { align, charSpace: 0.6 });
    const drawn = drawnAt(doc);
    const [alpha, beta] = [drawn.get('(Alpha)')!, drawn.get('(Beta gamma)')!];
    expect(alpha.x).toBeCloseTo(left(100, tracked(doc, 'Alpha')), 2);
    expect(beta.x).toBeCloseTo(left(100, tracked(doc, 'Beta gamma')), 2);
    expect(alpha.y).toBeCloseTo(50, 2);
    expect(beta.y).toBeGreaterThan(alpha.y);
  });

  it('anchors a single string the same way', () => {
    const doc = setup();
    drawText(doc, 'Alpha', 100, 50, { align: 'right', charSpace: 0.6 });
    expect(drawnAt(doc).get('(Alpha)')!.x).toBeCloseTo(100 - tracked(doc, 'Alpha'), 2);
  });
});

describe('remainingTextWidth', () => {
  it('leaves the width less what is taken', () => {
    expect(remainingTextWidth('box', 50, 8)).toBe(42);
  });

  it.each([['5' as unknown as number], [Number.NaN], [8], [3]])('rejects %s mm with nothing left', (width) => {
    expect(() => remainingTextWidth('box', width, 8)).toThrow(InvalidOptionError);
  });
});

/** A heading drawn at once, without the space above it: what `headingHeight` measures. */
const drawBareHeading = (ctx: DrawingContext, text: string, options: HeadingOptions) =>
  drawHeading(ctx, text, { ...options, spaceBefore: 0 });

describe('headingHeight', () => {
  it.each([
    ['an h1 line by default', 'Title', {}],
    ['the line of its level', 'Title', { level: 'h3' as const }],
    ['the line and the rule gap with a rule', 'Title', { rule: true }],
    ['the line alone without a rule', 'Title', { rule: false }],
    ['every line of a long title', LONG, {}],
    ['every line of a long numbered title with a rule', LONG, { level: 'h2' as const, number: '12.4', rule: true }],
    ['a line per line break', 'One\nTwo', { level: 'h3' as const }],
  ])('is the height a heading draws: %s', (_name, text, options) => {
    expectDrawnHeight(headingHeight, drawBareHeading, text, { ...options, spaceAfter: 0 });
  });

  it('is the height a heading draws in a column', () => {
    const doc = makeDoc();
    inFirstOfTwoColumns(doc, (column) =>
      expectDrawnHeight(headingHeight, drawBareHeading, LONG, { spaceAfter: 0 }, column),
    );
  });
});

/** The title lines a heading drew, in order: the texts set at `left` and after it, the number left out. */
const titleLines = (texts: DrawnText[], left: number) => texts.filter((call) => call.x > left - 0.01);

describe('a heading longer than its line', () => {
  it('wraps to the reading column, one line under the other, and lists its whole text', () => {
    const doc = makeDoc({ measure: 120 });
    const texts = recordTexts(doc);
    const start = doc.getYPos();
    doc.heading(LONG).paragraph('After.');
    const lines = texts.filter((call) => call.lines[0] !== 'After.');
    expect(lines.length).toBeGreaterThan(2);
    expectTextWithin(lines, doc.margins.left, doc.margins.left + doc.measure);
    const { lineHeight, ascent } = measureTextLevel(doc, 'h1');
    lines.forEach((line, index) => expect(line.y).toBeCloseTo(start + ascent + index * lineHeight, 6));
    expect(lines.map((line) => line.lines.join(' ')).join(' ')).toBe(LONG);
    expect(doc.pageRefs.tocEntries.map((entry) => entry.label)).toEqual([LONG]);
  });

  it('wraps to its column', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const frame = inFirstOfTwoColumns(doc, (column) => column.heading(LONG, { level: 'h2' }));
    const lines = texts.filter((call) => call.lines[0] !== 'Beside.');
    expect(lines.length).toBeGreaterThan(2);
    expectTextWithin(lines, frame.left, frame.left + frame.width);
  });

  it('keeps its number on the first line, the title lines aligned after it', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const start = doc.getYPos();
    doc.heading(LONG, { level: 'h2', number: '12.4' }).flushPendingHeadings();
    const number = textOf(texts, '12.4');
    const { ascent } = measureTextLevel(doc, 'h2');
    expect(number.x).toBe(doc.margins.left);
    expect(number.y).toBeCloseTo(start + ascent, 6);
    const titleX = doc.margins.left + number.widths[0] + HEADING.numberGap;
    const lines = titleLines(texts, titleX).filter((call) => call !== number);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0].y).toBeCloseTo(number.y, 6);
    for (const line of lines) expect(line.x).toBeCloseTo(titleX, 6);
    expectTextWithin(lines, titleX, doc.margins.left + doc.measure);
  });

  it('draws its rule under its last line', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const line = vi.spyOn(doc.doc, 'line');
    const start = doc.getYPos();
    doc.heading(LONG, { level: 'h2', rule: true }).flushPendingHeadings();
    const { lineHeight, ascent, descent } = measureTextLevel(doc, 'h2');
    expect(texts.length).toBeGreaterThan(1);
    const [[left, ruleY, right]] = line.mock.calls as number[][];
    expect(ruleY).toBeCloseTo(start + (texts.length - 1) * lineHeight + ascent + descent + HEADING.ruleGap, 6);
    expect([left, right]).toEqual([doc.margins.left, doc.margins.left + doc.measure]);
    expect(doc.getYPos()).toBeCloseTo(ruleY + doc.theme.spacing.heading.h2.after, 6);
  });

  it.each([
    ['one line', 'Title'],
    ['two lines', 'One\nTwo'],
  ])('puts the rule of %s ruleGap under the descenders of the last line', (_name, title) => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const line = vi.spyOn(doc.doc, 'line');
    doc.heading(title, { level: 'h2', rule: true }).flushPendingHeadings();
    const { descent } = measureTextLevel(doc, 'h2');
    const [[, ruleY]] = line.mock.calls as number[][];
    expect(ruleY - texts[texts.length - 1].y).toBeCloseTo(descent + HEADING.ruleGap, 6);
  });

  it('moves to the next page with the block it waits for when all its lines and that block do not fit', () => {
    const probe = makeDoc();
    const { spacing } = probe.theme;
    const room =
      // `leaveRoom` moves the position with `setYPos`: no space left under a block to collapse into.
      spacing.heading.h2.before +
      measureTextLevel(probe, 'h2').lineHeight +
      spacing.heading.h2.after +
      measureTextLevel(probe, 'body').lineHeight +
      1;
    // Room for a heading of one line and a line of text: it stays.
    const short = leaveRoom(makeDoc(), room);
    short.heading('Short', { level: 'h2' }).paragraph('Under it.');
    expect(short.doc.getNumberOfPages()).toBe(1);
    // Not for a heading of several lines: it moves, with the line under it.
    const doc = leaveRoom(makeDoc(), room);
    const texts = recordTexts(doc);
    doc.heading(LONG, { level: 'h2' }).paragraph('Under it.');
    expect(doc.doc.getNumberOfPages()).toBe(2);
    for (const call of texts) expect(call.page, call.lines[0]).toBe(2);
    expect(lastEntryPage(doc)).toBe(2);
  });

  describe('taller than a page', () => {
    // Thousands of lines: no page break can make room, so it is drawn whole, as any block taller than a page is.
    const TALL = 'A title that runs on and on, line after line. '.repeat(3000);

    it.each([
      ['alone', (doc: PDFDocument) => doc.heading(TALL), 2],
      ['after a paragraph', (doc: PDFDocument) => doc.paragraph('Before.').heading(TALL), 3],
      ['without keepWithNext', (doc: PDFDocument) => doc.heading(TALL, { keepWithNext: false }), 2],
      ['at its level and with a rule', (doc: PDFDocument) => doc.heading(TALL, { level: 'h3', rule: true }), 2],
    ])('is drawn from the top of a page, once, with one warning: %s', (_name, build, pages) => {
      const doc = makeDoc();
      const texts = recordTexts(doc);
      build(doc).paragraph('After.');

      expect(doc.warnings).toHaveLength(1);
      expect(doc.warnings[0]).toMatch(/^Block of \d+\.\d mm is taller than the usable page height/);
      // The heading takes the page it starts on whole, the text after it the next one: no page is left empty.
      expect(doc.doc.getNumberOfPages()).toBe(pages);
      const title = texts.filter((call) => call.lines[0] !== 'After.' && call.lines[0] !== 'Before.');
      expect(new Set(title.map((call) => call.page)).size).toBe(1);
      expect(title[0].y).toBeLessThan(doc.layout.topFor(2) + 20);
      expect(textOf(texts, 'After.').page).toBe(pages);
      expect(doc.pageRefs.tocEntries.map((entry) => entry.page)).toEqual([pages - 1]);
    });
  });

  it('throws at the call when its number leaves the title no width', () => {
    const doc = makeDoc({ measure: 40 });
    expectRejectedBeforeDrawing(doc, () => doc.heading('Title', { number: '1.2.3.4.5.6.7.8.9.10.11' }));
  });
});
