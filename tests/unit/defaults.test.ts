import { describe, expect, it } from 'vitest';

import { InvalidColorError, InvalidOptionError } from '../../src/core/errors';
import { levelColor } from '../../src/drawing/text';
import { DEFAULT_SPACING, DEFAULT_TYPOGRAPHY, createTheme, presetTheme } from '../../src/theme';
import { resolveLevels, resolveSizes, resolveTypography, resolveWeights } from '../../src/theme/defaults';
import type { Theme } from '../../src/theme/types';
import { makeDoc } from './helpers';

describe('createTheme color validation', () => {
  it('throws an error naming the token and the value', () => {
    expect(() => createTheme({ name: 't', colors: { primary: 'nope' } })).toThrow(/"nope".*"primary"/);
    expect(() => createTheme({ name: 't', colors: { text: 'red' } })).toThrow(/"red".*"text"/);
  });

  it('writes every color as #RRGGBB uppercase', () => {
    const { colors } = createTheme({ name: 't', colors: { primary: '#abc', background: '#fff' } });
    expect(colors.primary).toBe('#AABBCC');
    expect(colors.background).toBe('#FFFFFF');
    for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('createTheme name', () => {
  it('defaults to custom', () => {
    expect(createTheme().name).toBe('custom');
  });
});

describe('createTheme overrides given as undefined', () => {
  it('keep the default of a typography size and weight', () => {
    const { typography } = createTheme({
      typography: { sizes: { h2: undefined, body: 11 }, weights: { bold: undefined } },
    });
    expect(typography.sizes.h2).toBe(DEFAULT_TYPOGRAPHY.sizes.h2);
    expect(typography.sizes.body).toBe(11);
    expect(typography.weights.bold).toBe(DEFAULT_TYPOGRAPHY.weights.bold);
  });

  it('keep the other defaults: line height, levels, chrome, assets, spacing', () => {
    const theme = createTheme({
      typography: { lineHeightFactor: undefined, levels: undefined, fontFamily: undefined },
      chrome: { tracking: undefined, uppercase: undefined },
      assets: { footerLogo: undefined, backgroundOffsetY: undefined },
      spacing: { block: undefined, heading: { h1: undefined, h3: { before: undefined } } },
    });
    expect(theme.typography.lineHeightFactor).toBe(DEFAULT_TYPOGRAPHY.lineHeightFactor);
    expect(theme.typography.levels).toEqual({});
    expect(theme.typography.fontFamily).toBeUndefined();
    expect(theme.chrome).toEqual({});
    expect(theme.assets).toEqual({});
    expect(theme.spacing).toEqual(DEFAULT_SPACING);
  });

  it('leave no key behind, so a later spread over a default cannot erase it', () => {
    const theme = createTheme({ chrome: { uppercase: undefined }, assets: { footerLogo: undefined } });
    expect(Object.keys(theme.chrome)).toEqual([]);
    expect(Object.keys(theme.assets)).toEqual([]);
  });

  it('keep the other values of the same group', () => {
    const theme = createTheme({ chrome: { tracking: 0.1, uppercase: undefined }, assets: { backgroundOffsetY: 3 } });
    expect(theme.chrome).toEqual({ tracking: 0.1 });
    expect(theme.assets).toEqual({ backgroundOffsetY: 3 });
  });

  it('draw with the default size, not NaN', () => {
    const doc = makeDoc({ theme: createTheme({ typography: { sizes: { body: undefined } } }) });
    const start = doc.getYPos();
    doc.paragraph('One line.', { spaceAfter: 0 });
    expect(doc.getYPos() - start).toBeGreaterThan(0);
    expect(Number.isFinite(doc.getYPos())).toBe(true);
  });
});

describe('typography.levels', () => {
  it('rejects a key that is not a style of a level, a size included', () => {
    const levels = { h2: { size: 20 } } as never;
    expect(() => createTheme({ typography: { levels } })).toThrow(/style key of theme.typography.levels.h2 "size"/);
  });

  it('is empty by default', () => {
    expect(createTheme().typography.levels).toEqual({});
  });

  it('is kept level by level, an entry left undefined dropped', () => {
    const { levels } = createTheme({
      typography: { levels: { h2: { color: 'text', bold: undefined }, caption: { italic: true }, label: undefined } },
    }).typography;
    expect(levels).toEqual({ h2: { color: 'text' }, caption: { italic: true } });
  });

  it('keeps a palette token as written, and does not write to the overrides', () => {
    const levels = { h2: { color: 'tint' as const, font: 'label' as const } };
    expect(createTheme({ typography: { levels } }).typography.levels).toEqual(levels);
    expect(levels).toEqual({ h2: { color: 'tint', font: 'label' } });
  });

  it('accepts a hex color, a falsy flag and every text level', () => {
    const levels = { body: { color: '#abc' as const, bold: false, italic: false, font: 'title' as const } };
    expect(createTheme({ typography: { levels } }).typography.levels).toEqual(levels);
    for (const level of [
      'h1',
      'h2',
      'h3',
      'h4',
      'body',
      'bodyBold',
      'small',
      'smallMuted',
      'caption',
      'label',
    ] as const) {
      expect(() => createTheme({ typography: { levels: { [level]: { bold: true } } } })).not.toThrow();
    }
  });

  it('checks the colors against the palette of the theme, not the default one', () => {
    expect(() =>
      createTheme({ colors: { primary: '#3572B8' }, typography: { levels: { h2: { color: 'error' } } } }),
    ).not.toThrow();
  });

  it('goes through presetTheme', () => {
    expect(presetTheme('ocean', { typography: { levels: { h3: { bold: false } } } }).typography.levels).toEqual({
      h3: { bold: false },
    });
  });

  it('throws for a color that is neither a token nor a hex color', () => {
    expect(() => createTheme({ typography: { levels: { h2: { color: 'nope' as never } } } })).toThrow(
      InvalidColorError,
    );
    expect(() => createTheme({ typography: { levels: { h2: { color: 'toString' as never } } } })).toThrow(
      InvalidColorError,
    );
    expect(() => createTheme({ typography: { levels: { h2: { color: '#12' } } } })).toThrow(InvalidColorError);
  });

  it('lists the font roles when a font is not one', () => {
    expect(() => createTheme({ typography: { levels: { h2: { font: 'mono' as never } } } })).toThrow(
      `Unknown font of theme.typography.levels.h2 "mono" (available: 'body', 'title', 'label')`,
    );
  });

  it('names the setting of a color that is not valid', () => {
    expect(() => createTheme({ typography: { levels: { h2: { color: 'nope' as never } } } })).toThrow(
      'Invalid color "nope" for token "theme.typography.levels.h2.color"',
    );
    expect(() => createTheme({ typography: { levels: { caption: { color: '#12' } } } })).toThrow(
      /theme\.typography\.levels\.caption\.color/,
    );
    expect(() => makeDoc({ theme: handBuilt({ levels: { h2: { color: 'nope' as never } } }) })).toThrow(
      /theme\.typography\.levels\.h2\.color/,
    );
  });

  it('throws for a level that does not exist', () => {
    expect(() => createTheme({ typography: { levels: { h7: { bold: true } } as never } })).toThrow(
      /text level.*"h7".*'h1'/,
    );
  });

  it.each([
    ['a bold that is not a boolean', { bold: 'yes' }],
    ['an italic that is not a boolean', { italic: 1 }],
    ['a font that is not a role', { font: 'mono' }],
  ])('throws an InvalidOptionError for %s', (_, style) => {
    expect(() => createTheme({ typography: { levels: { h2: style as never } } })).toThrow(InvalidOptionError);
  });
});

describe('typography.sizes', () => {
  it.each([
    ['not finite', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['zero', 0],
    ['negative zero', -0],
    ['not a number', '9'],
  ])('throws an InvalidOptionError naming the level for a size that is %s', (_, size) => {
    expect(() => createTheme({ typography: { sizes: { caption: size as number } } })).toThrow(InvalidOptionError);
    expect(() => createTheme({ typography: { sizes: { caption: size as number } } })).toThrow(/sizes\.caption/);
  });

  it('accepts any size above 0', () => {
    expect(createTheme({ typography: { sizes: { caption: 0.5, h1: 30.5 } } }).typography.sizes).toMatchObject({
      caption: 0.5,
      h1: 30.5,
    });
  });

  it('says a size is more than 0, and a space 0 or more', () => {
    expect(() => createTheme({ typography: { sizes: { body: 0 } } })).toThrow(
      'Invalid theme.typography.sizes.body (pt): 0 — must be a finite number, greater than 0',
    );
    expect(() => createTheme({ spacing: { block: -1 } })).toThrow(
      'Invalid theme.spacing.block (mm): -1 — must be a finite number, at least 0',
    );
    expect(createTheme({ spacing: { block: 0 } }).spacing.block).toBe(0);
  });

  it('completes and checks the sizes of a hand-built theme', () => {
    expect(resolveSizes({ body: 10 })).toEqual({ ...DEFAULT_TYPOGRAPHY.sizes, body: 10 });
    expect(resolveSizes(undefined)).toEqual(DEFAULT_TYPOGRAPHY.sizes);
    expect(() => resolveSizes({ body: -2 })).toThrow(InvalidOptionError);
    expect(() => resolveSizes({ body: 0 })).toThrow(InvalidOptionError);
  });
});

describe('typography.weights', () => {
  it('throws an InvalidOptionError for a face other than normal or bold', () => {
    expect(() => createTheme({ typography: { weights: { bold: 'heavy' as never } } })).toThrow(InvalidOptionError);
    expect(() => createTheme({ typography: { weights: { regular: 700 as never } } })).toThrow(/weights\.regular/);
  });

  it('accepts bold for the regular weight and normal for the bold one', () => {
    expect(resolveWeights({ regular: 'bold', bold: 'normal' })).toEqual({ regular: 'bold', bold: 'normal' });
    expect(resolveWeights(undefined)).toEqual(DEFAULT_TYPOGRAPHY.weights);
  });
});

const handBuilt = (typography: Partial<Theme['typography']>): Theme => {
  const base = createTheme();
  return { ...base, typography: { ...base.typography, ...typography } };
};

describe('a hand-built theme in a document', () => {
  it('is checked like createTheme checks it', () => {
    const sizes = { ...DEFAULT_TYPOGRAPHY.sizes, body: Number.NaN };
    expect(() => makeDoc({ theme: handBuilt({ sizes }) })).toThrow(InvalidOptionError);
    expect(() => makeDoc({ theme: handBuilt({ levels: { h2: { color: 'nope' as never } } }) })).toThrow(
      InvalidColorError,
    );
    expect(() => makeDoc({ theme: handBuilt({ levels: { h2: { font: 'mono' as never } } }) })).toThrow(
      InvalidOptionError,
    );
  });

  it('keeps the level colors as given, and draws a token from the palette of the document', () => {
    const theme = createTheme({
      colors: { primary: '#3572B8', text: '#abc' },
      typography: { levels: { h2: { color: 'text' }, body: { color: '#f00' }, caption: { bold: true } } },
    });
    const doc = makeDoc({ theme });
    const written = { h2: { color: 'text' }, body: { color: '#f00' }, caption: { bold: true } };
    expect(doc.theme.typography.levels).toEqual(written);
    expect(theme.typography.levels).toEqual(written);
    expect(levelColor(doc, 'h2')).toBe('#AABBCC');
    expect(levelColor(doc, 'body')).toBe('#FF0000');
  });

  it('follows a palette that was replaced after createTheme', () => {
    const theme = createTheme({ typography: { levels: { h2: { color: 'text' } } } });
    const swapped: Theme = { ...theme, colors: { ...theme.colors, text: '#112233' } };
    expect(levelColor(makeDoc({ theme: swapped }), 'h2')).toBe('#112233');
  });

  it('completes the sizes, weights, line height and levels a theme left out', () => {
    const theme = handBuilt({
      sizes: { body: 12 } as never,
      weights: undefined as never,
      lineHeightFactor: undefined as never,
      levels: undefined,
    });
    const { typography } = makeDoc({ theme }).theme;
    expect(typography.sizes).toEqual({ ...DEFAULT_TYPOGRAPHY.sizes, body: 12 });
    expect(typography.weights).toEqual(DEFAULT_TYPOGRAPHY.weights);
    expect(typography.lineHeightFactor).toBe(DEFAULT_TYPOGRAPHY.lineHeightFactor);
    expect(typography.levels).toEqual({});
  });
});

describe('resolveTypography', () => {
  it('is the typography createTheme builds', () => {
    const overrides = {
      fontFamily: 'times',
      sizes: { body: 11 },
      weights: { bold: 'normal' as const },
      levels: { h2: { color: 'text' as const, bold: undefined } },
    };
    const theme = createTheme({ colors: { primary: '#3572B8' }, typography: overrides });
    expect(resolveTypography(overrides, theme.colors)).toEqual(theme.typography);
    expect(resolveTypography(undefined, theme.colors)).toEqual({ ...DEFAULT_TYPOGRAPHY, levels: {} });
  });

  it('checks the level colors against the palette it is given', () => {
    const { colors } = createTheme();
    expect(resolveLevels({ h2: { color: 'primary' } }, colors)).toEqual({ h2: { color: 'primary' } });
    expect(() => resolveLevels({ h2: { color: 'primary' } }, {} as never)).toThrow(InvalidColorError);
    expect(resolveLevels(undefined, colors)).toEqual({});
  });
});
