import { describe, expect, it } from 'vitest';

import type { DocumentOptions } from '../../src/core/document';
import { fontFace, hasFontFace, setFont } from '../../src/drawing/text-style';
import { INTER_FAMILY, interFonts } from '../../src/fonts/inter';
import { createTheme } from '../../src/theme/defaults';
import { makeDoc } from './helpers';

describe('setFont', () => {
  it('sets the family of the role, the weight through the theme, and the size', () => {
    const theme = createTheme({ typography: { fontFamily: 'times', titleFontFamily: 'courier' } });
    const doc = makeDoc({ theme });
    setFont(doc, 'title', 'bold', 18);
    expect(doc.doc.getFont()).toMatchObject({ fontName: 'courier', fontStyle: 'bold' });
    expect(doc.doc.getFontSize()).toBe(18);
    setFont(doc, 'body', 'regular', 9, true);
    expect(doc.doc.getFont()).toMatchObject({ fontName: 'times', fontStyle: 'italic' });
    setFont(doc, 'label', 'regular', 9);
    expect(doc.doc.getFont().fontName).toBe('times');
  });

  it('maps the weight through typography.weights', () => {
    const theme = createTheme({ typography: { weights: { regular: 'normal', bold: 'normal' } } });
    const doc = makeDoc({ theme });
    setFont(doc, 'body', 'bold', 9);
    expect(doc.doc.getFont().fontStyle).toBe('normal');
    setFont(doc, 'body', 'bold', 9, true);
    expect(doc.doc.getFont().fontStyle).toBe('italic');
  });
});

const withoutItalic = interFonts.filter((font) => font.style !== 'italic');

describe('hasFontFace', () => {
  it('tells the faces of the family of a role, through typography.weights', () => {
    const doc = makeDoc({ fonts: withoutItalic });
    expect(hasFontFace(doc, 'body', 'regular')).toBe(true);
    expect(hasFontFace(doc, 'title', 'bold')).toBe(true);
    expect(hasFontFace(doc, 'label', 'regular', true)).toBe(false);
    expect(hasFontFace(doc, 'body', 'bold', true)).toBe(false);
    expect(makeDoc({ fonts: interFonts }).theme.typography.fontFamily).toBe(INTER_FAMILY);
    expect(hasFontFace(makeDoc({ fonts: interFonts }), 'body', 'regular', true)).toBe(true);
    expect(hasFontFace(makeDoc(), 'body', 'bold', true)).toBe(true);
    const mapped = makeDoc({ theme: createTheme({ typography: { weights: { regular: 'normal', bold: 'normal' } } }) });
    expect(hasFontFace(mapped, 'body', 'bold', true)).toBe(true);
  });

  it('follows the family of each role, and does not warn or change the font', () => {
    const theme = createTheme({ typography: { fontFamily: INTER_FAMILY, titleFontFamily: 'times' } });
    const doc = makeDoc({ fonts: withoutItalic, theme });
    const before = doc.doc.getFont();
    expect(hasFontFace(doc, 'body', 'regular', true)).toBe(false);
    expect(hasFontFace(doc, 'title', 'regular', true)).toBe(true);
    expect(doc.doc.getFont()).toBe(before);
    expect(doc.warnings).toEqual([]);
  });

  it('is not changed by a declared fallback', () => {
    const doc = makeDoc({ fonts: withoutItalic, fontFallbacks: { [INTER_FAMILY]: ['italic'] } });
    expect(hasFontFace(doc, 'body', 'regular', true)).toBe(false);
  });
});

const draw = (options: DocumentOptions) => {
  const doc = makeDoc({ fonts: withoutItalic, ...options });
  doc.richText('Plain *italic* **bold** **bold *and italic***.');
  doc.paragraph('A note.', { level: 'italic' });
  return doc;
};

describe('fontFallbacks', () => {
  it('keeps the warnings of a family without italic by default', () => {
    expect(draw({}).warnings).toEqual([
      `Font family "${INTER_FAMILY}" has no italic face: italic text is drawn upright`,
      `Font family "${INTER_FAMILY}" has no bolditalic face: drawn as bold`,
    ]);
  });

  it('draws the same without a warning when the family is declared without italic', () => {
    const declared = draw({ fontFallbacks: { [INTER_FAMILY]: ['italic'] } });
    expect(declared.warnings).toEqual([]);
  });

  it('is silent for setFont and for a family named by the declared role only', () => {
    const doc = makeDoc({ fonts: withoutItalic, fontFallbacks: { [INTER_FAMILY.toLowerCase()]: ['italic'] } });
    setFont(doc, 'body', 'bold', 9, true);
    expect(doc.doc.getFont().fontStyle).toBe('bold');
    expect(doc.warnings).toEqual([]);
    const other = makeDoc({ fonts: withoutItalic, fontFallbacks: { Other: ['italic'] } });
    setFont(other, 'body', 'regular', 9, true);
    expect(other.warnings).toHaveLength(1);
  });
});

describe('fontFace', () => {
  it('puts italic on the weight face', () => {
    const { typography } = createTheme();
    expect(fontFace(typography, false, false)).toBe('normal');
    expect(fontFace(typography, true, false)).toBe('bold');
    expect(fontFace(typography, false, true)).toBe('italic');
    expect(fontFace(typography, true, true)).toBe('bolditalic');
  });
});

describe('the font families of doc.theme', () => {
  it.each<[string, DocumentOptions, [string, string, string]]>([
    ['Helvetica without fonts', {}, ['helvetica', 'helvetica', 'helvetica']],
    [
      'the first registered family when the theme names none',
      { fonts: interFonts },
      [INTER_FAMILY, INTER_FAMILY, INTER_FAMILY],
    ],
    [
      'the ones the theme names, the label falling back to the default one',
      { theme: createTheme({ typography: { fontFamily: 'times', titleFontFamily: 'courier' } }) },
      ['times', 'courier', 'times'],
    ],
  ])('are all resolved: %s', (_, options, [body, title, label]) => {
    const { typography } = makeDoc(options).theme;
    expect([typography.fontFamily, typography.titleFontFamily, typography.labelFontFamily]).toEqual([
      body,
      title,
      label,
    ]);
  });

  it('leave the theme given as it was', () => {
    const theme = createTheme({ typography: { fontFamily: 'times' } });
    makeDoc({ theme });
    expect(theme.typography.labelFontFamily).toBeUndefined();
    expect(theme.typography.fontFamily).toBe('times');
  });
});
