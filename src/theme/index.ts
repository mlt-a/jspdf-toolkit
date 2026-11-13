export type {
  ColorInput,
  ColorPalette,
  Typography,
  ResolvedTypography,
  TypographySizes,
  TextLevelStyle,
  Spacing,
  SpacingOverrides,
  HeadingSpacing,
  CoverConfig,
  ThemeAssets,
  ChromeTokens,
  Theme,
  ResolvedTheme,
} from './types';

export { DEFAULT_COLORS, DEFAULT_TYPOGRAPHY, DEFAULT_SPACING, createTheme } from './defaults';
export type { ThemeOverrides } from './defaults';

export {
  hexToRgb,
  rgbToHex,
  tint,
  mixInk,
  contrastRatio,
  ensureReadableOn,
  generatePalette,
  resolveColor,
} from './colors';

export { presetTheme, PRESET_THEME_NAMES } from './presets';
export type { PresetThemeName } from './presets';
