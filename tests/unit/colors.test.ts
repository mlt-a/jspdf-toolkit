import { describe, expect, it } from 'vitest';

import { InvalidColorError } from '../../src/core/errors';
import { createTheme } from '../../src/theme';
import {
  contrastRatio,
  ensureReadableOn,
  generatePalette,
  hexToRgb,
  normalizeHex,
  readableOn,
  resolveColor,
  rgbToHex,
  tint,
} from '../../src/theme/colors';
import type { ColorInput } from '../../src/theme/types';

// WCAG relative luminance, recomputed here so the test does not depend on the implementation.
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('hexToRgb', () => {
  it.each([
    ['#3572B8', [53, 114, 184]],
    ['#ffffff', [255, 255, 255]],
    ['#000000', [0, 0, 0]],
  ])('parses %s', (hex, rgb) => {
    expect(hexToRgb(hex)).toEqual(rgb);
  });

  it.each([
    ['#abc', [170, 187, 204]],
    ['abc', [170, 187, 204]],
    ['AABBCC', [170, 187, 204]],
    ['#AbC', [170, 187, 204]],
    ['3572b8', [53, 114, 184]],
  ])('accepts lenient form %s', (hex, rgb) => {
    expect(hexToRgb(hex)).toEqual(rgb);
  });

  it.each(['#GGGGGG', '#abcd', '', 'nope', '#12345'])('rejects malformed input %s', (hex) => {
    expect(() => hexToRgb(hex)).toThrow(InvalidColorError);
  });
});

describe('rgbToHex', () => {
  it.each([
    [[53, 114, 184], '#3572B8'],
    [[0, 0, 0], '#000000'],
    [[300, -10, 127.6], '#FF0080'],
  ] as const)('formats %j as %s (rounded, clamped, uppercase)', ([r, g, b], hex) => {
    expect(rgbToHex(r, g, b)).toBe(hex);
  });

  it('round-trips with hexToRgb', () => {
    expect(rgbToHex(...hexToRgb('#12AB9F'))).toBe('#12AB9F');
  });
});

describe('tint', () => {
  it('returns the color at 0 and white at 1', () => {
    expect(tint('#3572B8', 0)).toBe('#3572B8');
    expect(tint('#3572B8', 1)).toBe('#FFFFFF');
  });
});

describe('generatePalette', () => {
  const TOKENS = [
    'primary',
    'onPrimary',
    'background',
    'surface',
    'tint',
    'tintLight',
    'tintBorder',
    'border',
    'surfaceBorder',
    'zebraFill',
    'text',
    'secondary',
    'subtle',
    'success',
    'error',
  ];

  it('derives the 15 tokens from the primary color', () => {
    const palette = generatePalette('#3572B8');
    expect(Object.keys(palette).toSorted()).toEqual(TOKENS.toSorted());
    expect(palette.primary).toBe('#3572B8');
  });

  it('derives zebraFill from the background and text colors', () => {
    const light = generatePalette('#3572B8');
    expect(light.zebraFill).not.toBe(light.background);
    expect(luminance(light.zebraFill)).toBeLessThan(luminance(light.background));
    const dark = generatePalette('#3572B8', { background: '#1a1a1a', text: '#f5f5f5' });
    expect(luminance(dark.zebraFill)).toBeGreaterThan(luminance(dark.background));
    expect(generatePalette('#3572B8', { zebraFill: '#123456' }).zebraFill).toBe('#123456');
  });

  it('outputs valid hex for every token', () => {
    for (const value of Object.values(generatePalette('#3572B8'))) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('keeps onPrimary readable on dark and light primaries', () => {
    for (const primary of ['#3572B8', '#0f172a', '#7c3aed', '#FDE047', '#FBBF24', '#ffffff', '#000000']) {
      const { onPrimary } = generatePalette(primary);
      expect(contrastRatio(primary, onPrimary), primary).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks dark text on a light primary and white on a dark one', () => {
    expect(generatePalette('#FDE047').onPrimary).toBe('#1E293B');
    expect(generatePalette('#0f172a').onPrimary).toBe('#FFFFFF');
  });

  it('applies overrides over derived tokens', () => {
    const palette = generatePalette('#3572B8', { background: '#000000', error: '#ff0000' });
    expect(palette.background).toBe('#000000');
    expect(palette.error).toBe('#FF0000');
    expect(palette.primary).toBe('#3572B8');
  });

  it('rejects an invalid primary', () => {
    expect(() => generatePalette('blue')).toThrow(InvalidColorError);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, in either order, and 1 for identical colors', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3572B8', '#3572B8')).toBe(1);
  });
});

describe('ensureReadableOn', () => {
  it('leaves a readable color unchanged', () => {
    expect(ensureReadableOn('#000000', '#FFFFFF')).toBe('#000000');
  });

  it('lightens a dark color on a dark background until it reaches the ratio', () => {
    const result = ensureReadableOn('#1f2a44', '#111111');
    expect(contrastRatio(result, '#111111')).toBeGreaterThanOrEqual(4.5);
  });

  it('darkens a pale color on a light background', () => {
    const result = ensureReadableOn('#FDE047', '#FFFFFF');
    expect(contrastRatio(result, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('honours a custom ratio', () => {
    expect(contrastRatio(ensureReadableOn('#999999', '#FFFFFF', 7), '#FFFFFF')).toBeGreaterThanOrEqual(7);
  });
});

// An input the compiler would reject: the runtime check is what these tests exercise.
const unknown = (value: string) => value as ColorInput;

describe('resolveColor', () => {
  const theme = createTheme({ colors: { primary: '#3572B8' } });

  it('reads a palette token from the theme', () => {
    expect(resolveColor(theme, 'primary')).toBe(theme.colors.primary);
  });

  it('normalizes a hex color', () => {
    expect(resolveColor(theme, '#abc')).toBe('#AABBCC');
  });

  it('throws on a name that is neither a token nor a hex color', () => {
    expect(() => resolveColor(theme, unknown('teal'))).toThrow(InvalidColorError);
    expect(() => resolveColor(theme, unknown('toString'))).toThrow(InvalidColorError);
    expect(() => resolveColor(theme, unknown('bad'))).toThrow(InvalidColorError);
    expect(() => resolveColor(theme, unknown('bad'))).toThrow(/"bad"/);
    expect(() => resolveColor(theme, unknown('#12'))).toThrow(/"#12"/);
    expect(() => resolveColor(theme, unknown(' #abc'))).not.toThrow();
  });

  it('rejects a token typo at compile time', () => {
    // @ts-expect-error not a palette token, and no "#"
    expect(() => resolveColor(theme, 'primry')).toThrow(InvalidColorError);
  });
});

describe('readableOn', () => {
  it.each([
    ['a dark fill', '#001133', '#FFFFFF'],
    ['a light fill', '#F4F4C8', '#1E293B'],
    ['a mid grey', '#777777', '#FFFFFF'],
  ])('picks the ink that reads better over %s', (_, fill, ink) => {
    expect(readableOn(fill, '#FFFFFF', '#1E293B')).toBe(ink);
  });

  it.each([
    ['success', '#059669', '#FFFFFF'],
    ['secondary', '#64748B', '#FFFFFF'],
    ['subtle', '#94A3B8', '#1E293B'],
    ['tintBorder', '#AEC7E3', '#1E293B'],
  ])('picks %s the way the ocean palette expects', (_, fill, ink) => {
    expect(readableOn(fill, '#FFFFFF', '#1E293B')).toBe(ink);
  });

  it('takes the light ink as soon as it reaches 3:1, the dark one just below', () => {
    // White over grey 148 makes 3.03:1, over grey 149 2.995:1.
    const lightEnough = '#949494';
    const justBelow = '#959595';
    expect(contrastRatio(lightEnough, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(justBelow, '#FFFFFF')).toBeLessThan(3);
    expect(readableOn(lightEnough, '#FFFFFF', '#000000')).toBe('#FFFFFF');
    expect(readableOn(justBelow, '#FFFFFF', '#000000')).toBe('#000000');
  });

  it('gives the 3:1 floor to the lighter ink, whatever the order of the two', () => {
    // A dark page: the background (first) is the dark ink, the text the light one.
    expect(readableOn('#2563EB', '#0F172A', '#E2E8F0')).toBe(readableOn('#2563EB', '#E2E8F0', '#0F172A'));
    expect(readableOn('#2563EB', '#0F172A', '#E2E8F0')).toBe('#E2E8F0');
  });

  it('picks the light ink on a tie', () => {
    expect(readableOn('#808080', '#123456', '#123456')).toBe('#123456');
    expect(readableOn('#000000', '#ffffff', '#FFFFFF')).toBe('#ffffff');
  });

  it('chooses onPrimary in the palette', () => {
    for (const primary of ['#FDE047', '#0f172a', '#3572B8']) {
      expect(generatePalette(primary).onPrimary).toBe(readableOn(primary.toUpperCase(), '#FFFFFF', '#1E293B'));
    }
  });
});

describe('ensureReadableOn when no step reaches the ratio', () => {
  it('goes to the extreme that contrasts more with the background', () => {
    expect(ensureReadableOn('#777777', '#808080', 21)).toBe('#000000');
    expect(ensureReadableOn('#999999', '#333333', 21)).toBe('#FFFFFF');
  });
});

describe('a color that is not a string', () => {
  it('is an invalid color, not a TypeError', () => {
    expect(() => normalizeHex(123 as unknown as string)).toThrow(InvalidColorError);
    expect(() => normalizeHex(null as unknown as string, 'border')).toThrow(InvalidColorError);
  });
});

describe('palette overrides', () => {
  it('ignore an override left undefined', () => {
    expect(generatePalette('#3572B8', { text: undefined })).toEqual(generatePalette('#3572B8'));
  });
});
