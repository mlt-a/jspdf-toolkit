import { InvalidColorError } from '../core/errors';
import type { ColorInput, ColorPalette, Theme } from './types';

// === Color manipulation helpers ===

// #RGB and #RRGGBB, with or without the leading "#", any case.
const HEX_COLOR_REGEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseHex(hex: string, token?: string): string {
  // A caller without types may pass anything: it must read as an invalid color, not as a TypeError.
  const match = typeof hex === 'string' ? HEX_COLOR_REGEX.exec(hex.trim()) : null;
  if (!match) throw new InvalidColorError(hex, token);
  const clean = match[1];
  return clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean;
}

/**
 * Normalizes `#RGB`, `RGB` and `RRGGBB` to `#RRGGBB` (uppercase). Throws on anything else; `token` names the palette
 * entry in the error.
 */
export function normalizeHex(hex: string, token?: string): string {
  return `#${parseHex(hex, token).toUpperCase()}`;
}

/** Whether `input` names a palette token of `theme`; prototype keys (`toString`…) do not count. */
function isColorToken(theme: Pick<Theme, 'colors'>, input: ColorInput): input is keyof ColorPalette {
  return Object.hasOwn(theme.colors, input);
}

/**
 * The color a `ColorInput` stands for: the theme's token, or the `#RGB` / `#RRGGBB` color normalized. Throws
 * `InvalidColorError` on anything else, a mistyped token included; `source` names where the color was written (a theme
 * setting such as `theme.typography.levels.h2.color`) in the error.
 *
 * @example
 * ```ts
 * import { resolveColor } from '@mlt-a/jspdf-toolkit';
 *
 * resolveColor(doc.theme, 'primary'); // the palette color, e.g. '#2563EB'
 * resolveColor(doc.theme, '#f00'); // '#FF0000'
 * ```
 */
export function resolveColor(theme: Pick<Theme, 'colors'>, input: ColorInput, source?: string): string {
  // Normalized, so a hand-built theme gives the value the document draws with.
  if (isColorToken(theme, input)) return normalizeHex(theme.colors[input]);
  // The "#" is required: without it a mistyped token such as "bad" would pass for a 3-digit hex color.
  if (typeof input === 'string' && input.trim().startsWith('#')) return normalizeHex(input, source);
  throw new InvalidColorError(input, source);
}

/**
 * `resolveColor` of a color option: `fallback` when it is left out. `null` is no color: it throws like any other value
 * that is none, rather than standing in for the default.
 */
export function resolveOptionalColor(
  theme: Pick<Theme, 'colors'>,
  input: ColorInput | undefined,
  fallback: ColorInput,
): string {
  return resolveColor(theme, input === undefined ? fallback : input);
}

/** Returns `colors` with every token written as `#RRGGBB` uppercase. Throws `InvalidColorError` naming the token. */
export function normalizePalette(colors: ColorPalette): ColorPalette {
  const normalized = { ...colors };
  for (const token of Object.keys(normalized) as Array<keyof ColorPalette>) {
    normalized[token] = normalizeHex(normalized[token], token);
  }
  return normalized;
}

/**
 * Converts `#RGB` or `#RRGGBB` to `[r, g, b]` (0-255). Throws `InvalidColorError` on a malformed color.
 *
 * @example
 * ```ts
 * import { hexToRgb } from '@mlt-a/jspdf-toolkit';
 *
 * const [r, g, b] = hexToRgb('#3572B8'); // [53, 114, 184]
 * ```
 */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = parseHex(hex);
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function channelToHex(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
}

/**
 * Converts 0-255 channels to an uppercase `#RRGGBB` string; values are clamped and rounded.
 *
 * @example
 * ```ts
 * import { rgbToHex } from '@mlt-a/jspdf-toolkit';
 *
 * rgbToHex(53, 114, 184); // '#3572B8'
 * ```
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

/**
 * Mix a color with white.
 * factor 0 = original color, factor 1 = pure white.
 *
 *
 * @example
 * ```ts
 * import { tint } from '@mlt-a/jspdf-toolkit';
 *
 * tint('#3572B8', 0.9); // a pale blue, close to white
 * ```
 */
export function tint(hex: string, factor: number): string {
  return mixInk(hex, '#FFFFFF', factor);
}

// === Relative luminance and contrast (WCAG 2.x) ===

function luminanceOf([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function luminance(hex: string): number {
  return luminanceOf(hexToRgb(hex));
}

function contrastFromLuminance(la: number, lb: number): number {
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * WCAG contrast ratio between two colors, from 1 (identical) to 21 (black on white).
 *
 * @example
 * ```ts
 * import { contrastRatio } from '@mlt-a/jspdf-toolkit';
 *
 * contrastRatio('#FFFFFF', '#000000'); // 21
 * contrastRatio('#999999', '#FFFFFF'); // 2.85
 * if (contrastRatio('#999999', '#FFFFFF') < 4.5) console.warn('Hard to read'); // below the WCAG AA minimum
 * ```
 */
export function contrastRatio(a: string, b: string): number {
  return contrastFromLuminance(luminance(a), luminance(b));
}

// The WCAG floor for large text, held here for bold text of any size: the ratio undervalues white on saturated mid-tones.
const LIGHT_MIN_CONTRAST = 3;

/**
 * Of `light` and `dark`, the one to write bold text in over `fill`: `light` as soon as it reaches 3:1, else the one
 * with the better contrast, `light` on a tie. Its callers set bold text (a table head, a percentage in a bar): the
 * 3:1 floor is too low for regular text.
 */
export function readableOn(fill: string, light: string, dark: string): string {
  // The lighter ink is the one that gets the 3:1 floor, in whatever order they come: on a dark page the background is
  // the dark one.
  const [lighter, darker] = luminance(dark) > luminance(light) ? [dark, light] : [light, dark];
  const overLighter = contrastRatio(fill, lighter);
  return overLighter >= LIGHT_MIN_CONTRAST || overLighter >= contrastRatio(fill, darker) ? lighter : darker;
}

/** Mix `ink` into `paper`: factor 0 = pure ink, factor 1 = pure paper. */
export function mixInk(ink: string, paper: string, factor: number): string {
  const [ir, ig, ib] = hexToRgb(ink);
  const [pr, pg, pb] = hexToRgb(paper);
  return rgbToHex(ir + (pr - ir) * factor, ig + (pg - ig) * factor, ib + (pb - ib) * factor);
}

/**
 * Moves `color` toward white or black (whichever contrasts more with `background`) until it reaches `minRatio`.
 * Returns `color` unchanged when it already reads well; otherwise the closest step that gets there, or the
 * extreme if none does.
 *
 *
 * @example
 * ```ts
 * import { ensureReadableOn } from '@mlt-a/jspdf-toolkit';
 *
 * const readable = ensureReadableOn('#9CA3AF', '#FFFFFF'); // darker gray, 4.5:1 on white
 * ```
 */
export function ensureReadableOn(color: string, background: string, minRatio = 4.5): string {
  const backgroundLuminance = luminance(background);
  if (contrastFromLuminance(luminance(color), backgroundLuminance) >= minRatio) return color;
  const towardWhite = contrastFromLuminance(1, backgroundLuminance) >= contrastFromLuminance(0, backgroundLuminance);
  const target = towardWhite ? 255 : 0;
  const [r, g, b] = hexToRgb(color);
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const keep = 1 - i / steps;
    const candidate = rgbToHex(
      target + (r - target) * keep,
      target + (g - target) * keep,
      target + (b - target) * keep,
    );
    if (contrastFromLuminance(luminance(candidate), backgroundLuminance) >= minRatio) return candidate;
  }
  return rgbToHex(target, target, target);
}

/**
 * Alternate table row fill: a small step from the page background toward the ink, so it reads as a stripe on
 * light and dark themes alike. `surface` is too close to the background once the table grid is drawn. Dark
 * backgrounds get a larger step, since the same ink share is far less visible there.
 */
function zebraFill(background: string, ink: string): string {
  const inkShare = luminance(background) < 0.2 ? 0.17 : 0.08;
  return mixInk(ink, background, 1 - inkShare);
}

// === Palette derivation ===

const ON_PRIMARY_LIGHT = '#FFFFFF';
const ON_PRIMARY_DARK = '#1E293B';

/**
 * Derives the palette from `primary`; `overrides` replace derived tokens. This is the only place colors are
 * validated and written as `#RRGGBB` uppercase, so consumers can compare them as strings.
 *
 * @example
 * ```ts
 * import { generatePalette } from '@mlt-a/jspdf-toolkit';
 *
 * const colors = generatePalette('#0F766E', { text: '#111827' });
 * colors.tint; // a light mix of the primary color
 * ```
 */
export function generatePalette(primary: string, overrides?: Partial<ColorPalette>): ColorPalette {
  const main = normalizeHex(primary, 'primary');
  const explicit: Partial<ColorPalette> = {};
  for (const [token, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined) explicit[token as keyof ColorPalette] = normalizeHex(value, token);
  }

  const base: Omit<ColorPalette, 'zebraFill'> = {
    primary: main,
    onPrimary: readableOn(main, ON_PRIMARY_LIGHT, ON_PRIMARY_DARK),
    background: '#FFFFFF',
    surface: tint(main, 0.93),
    tint: tint(main, 0.85),
    tintLight: tint(main, 0.88),
    tintBorder: tint(main, 0.6),
    border: '#E2E8F0',
    surfaceBorder: tint(main, 0.8),
    text: '#1E293B',
    secondary: '#64748B',
    subtle: '#94A3B8',
    success: '#059669',
    error: '#E11D48',
  };

  const merged = { ...base, ...explicit };
  // Derived from the merged background/text, unless the caller sets it.
  return { ...merged, zebraFill: explicit.zebraFill ?? zebraFill(merged.background, merged.text) };
}
