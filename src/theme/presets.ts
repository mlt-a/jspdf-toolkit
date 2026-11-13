import { createTheme } from './defaults';
import type { ThemeOverrides } from './defaults';
import type { Theme } from './types';

// === Theme name type ===

/** Name of a built-in theme, for `presetTheme`. */
export type PresetThemeName =
  | 'ocean'
  | 'emerald'
  | 'slate'
  | 'rose'
  | 'amber'
  | 'violet'
  | 'teal'
  | 'indigo'
  | 'coral'
  | 'graphite';

// === Primary colors ===

const PRESET_PRIMARIES: Record<PresetThemeName, string> = {
  ocean: '#3572B8',
  emerald: '#2E8B6E',
  slate: '#5A6578',
  rose: '#C4536A',
  amber: '#C08B40',
  violet: '#7B68AE',
  teal: '#3A8F87',
  indigo: '#5B68A8',
  coral: '#CB7054',
  graphite: '#4A5262',
};

/** Every preset name, for pickers and loops. */
export const PRESET_THEME_NAMES: readonly PresetThemeName[] = Object.keys(PRESET_PRIMARIES) as PresetThemeName[];

/**
 * A ready theme from a preset: its primary color drives the palette. `overrides` go through `createTheme` on top
 * of it, a `colors.primary` of their own included.
 *
 * @example
 * ```ts
 * import { PDFDocument, presetTheme } from '@mlt-a/jspdf-toolkit';
 *
 * const doc = new PDFDocument({ theme: presetTheme('emerald') });
 * const branded = presetTheme('ocean', { typography: { fontFamily: 'Inter' } });
 * ```
 */
export function presetTheme(name: PresetThemeName, overrides: ThemeOverrides = {}): Theme {
  return createTheme({
    ...overrides,
    name: overrides.name ?? name,
    colors: { ...overrides.colors, primary: overrides.colors?.primary ?? PRESET_PRIMARIES[name] },
  });
}
