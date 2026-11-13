import { describe, expect, it } from 'vitest';

import type { DocumentOptions } from '../../src/core/document';
import { fontFace, setFont } from '../../src/drawing/text-style';
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
