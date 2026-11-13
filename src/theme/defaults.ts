import { FONT_ROLES, HEADING_LEVELS, SPACING, TEXT_LEVELS } from '../core/constants';
import type { TextLevel } from '../core/constants';
import { InvalidOptionError, POSITIVE, checkedNumber, unknownOption } from '../core/errors';
import { defined } from '../utils/defined';
import { generatePalette, resolveColor } from './colors';
import type {
  ChromeTokens,
  ColorPalette,
  Spacing,
  SpacingOverrides,
  TextLevelStyle,
  Theme,
  ThemeAssets,
  Typography,
  TypographySizes,
} from './types';

/** Overrides given to `createTheme`; every key is merged over the defaults. */
export interface ThemeOverrides {
  /** Default: `'custom'`. */
  name?: string;
  /** Palette tokens to set; `primary` drives the ones left out. */
  colors?: Partial<ColorPalette>;
  /** Typography to set; each size and weight left out keeps its default. */
  typography?: Partial<Omit<Typography, 'sizes' | 'weights'>> & {
    /** Font sizes (pt) by text level. */
    sizes?: Partial<TypographySizes>;
    /** Faces of regular and bold text. */
    weights?: Partial<Typography['weights']>;
  };
  /** Vertical rhythm to set; each value left out, level by level and side by side, keeps its default. */
  spacing?: SpacingOverrides;
  /** Assets of the theme; replaces the default (none) as a whole. */
  assets?: ThemeAssets;
  /** Running header and footer look. */
  chrome?: ChromeTokens;
}

const DEFAULT_PRIMARY = '#2563EB';

/** Palette generated from the default primary color (`#2563EB`). */
export const DEFAULT_COLORS: ColorPalette = generatePalette(DEFAULT_PRIMARY);

/** No `fontFamily`: the document picks the first family of its `fonts` option, else Helvetica. */
export const DEFAULT_TYPOGRAPHY: Typography = {
  sizes: {
    h1: 24,
    h2: 14,
    h3: 10,
    h4: 8,
    body: 9,
    small: 8,
    caption: 7,
    label: 9,
    fieldLabel: 8,
    fieldValue: 10,
    footer: 7,
  },
  weights: {
    regular: 'normal',
    bold: 'bold',
  },
  lineHeightFactor: 1.3,
};

/**
 * The default rhythm, in steps of `SPACING`: every block leaves `SPACING.medium` under it; a heading asks for more
 * space above it than it leaves under it, so it reads with the section it opens, and the spaces shrink level by level.
 */
export const DEFAULT_SPACING: Spacing = {
  block: SPACING.medium,
  heading: {
    h1: { before: SPACING.xxxlarge, after: SPACING.xlarge },
    h2: { before: SPACING.xxlarge, after: SPACING.medium },
    h3: { before: SPACING.xlarge, after: SPACING.small },
    h4: { before: SPACING.medium, after: SPACING.small },
  },
};

/**
 * A space (mm) under or above a block: 0 or more, a negative or non-finite one would break the flow. `name` is its path
 * in the theme.
 */
const checkedSpace = (value: number, name: string) => checkedNumber(`theme.spacing.${name} (mm)`, value, { min: 0 });

/**
 * The spacing a document draws with: `overrides` over `DEFAULT_SPACING`, level by level and side by side. Throws an
 * `InvalidOptionError` for a negative or non-finite space.
 */
export function resolveSpacing(overrides: SpacingOverrides | undefined): Spacing {
  const heading = Object.fromEntries(
    HEADING_LEVELS.map((level) => {
      const merged = { ...DEFAULT_SPACING.heading[level], ...defined(overrides?.heading?.[level]) };
      return [
        level,
        {
          before: checkedSpace(merged.before, `heading.${level}.before`),
          after: checkedSpace(merged.after, `heading.${level}.after`),
        },
      ];
    }),
  ) as Spacing['heading'];
  return { block: checkedSpace(overrides?.block ?? DEFAULT_SPACING.block, 'block'), heading };
}

/**
 * The font sizes a document draws with: `overrides` over `DEFAULT_TYPOGRAPHY.sizes`. Throws an `InvalidOptionError`
 * for a size that is not finite or not above 0.
 */
export function resolveSizes(overrides: Partial<TypographySizes> | undefined): TypographySizes {
  const merged = { ...DEFAULT_TYPOGRAPHY.sizes, ...defined(overrides) };
  // Above 0: a size of 0 piles the lines on each other, where a space of 0 is a space.
  for (const [level, size] of Object.entries(merged))
    checkedNumber(`theme.typography.sizes.${level} (pt)`, size, POSITIVE);
  return merged;
}

const WEIGHT_FACES = ['normal', 'bold'] as const;

/**
 * The faces of the regular and bold weights: `overrides` over `DEFAULT_TYPOGRAPHY.weights`. Throws an
 * `InvalidOptionError` for a face other than `'normal'` or `'bold'`.
 */
export function resolveWeights(overrides: Partial<Typography['weights']> | undefined): Typography['weights'] {
  const merged = { ...DEFAULT_TYPOGRAPHY.weights, ...defined(overrides) };
  for (const [weight, face] of Object.entries(merged)) {
    if (!WEIGHT_FACES.includes(face)) {
      throw unknownOption(`face of theme.typography.weights.${weight}`, face, WEIGHT_FACES);
    }
  }
  return merged;
}

const LEVEL_STYLE_KEYS: readonly string[] = ['color', 'bold', 'italic', 'font'];

function resolveLevelStyle(level: string, style: TextLevelStyle, palette: ColorPalette): TextLevelStyle {
  const { color, bold, italic, font } = defined(style);
  const where = `theme.typography.levels.${level}`;
  // A size or a typo would otherwise be dropped without a word: the size of a level is set in `typography.sizes`.
  const unknown = Object.keys(defined(style)).filter((key) => !LEVEL_STYLE_KEYS.includes(key));
  if (unknown.length > 0) throw unknownOption(`style key of ${where}`, unknown[0], LEVEL_STYLE_KEYS);
  for (const [name, flag] of Object.entries({ bold, italic })) {
    if (flag !== undefined && typeof flag !== 'boolean') {
      throw new InvalidOptionError(`${where}.${name} must be true or false, got ${String(flag)}`);
    }
  }
  if (font !== undefined && !FONT_ROLES.includes(font)) throw unknownOption(`font of ${where}`, font, FONT_ROLES);
  // Checked only: a token stays a token, read from the palette of the document that draws it.
  if (color !== undefined) resolveColor({ colors: palette }, color, `${where}.color`);
  return defined({ color, bold, italic, font });
}

/**
 * The text level styles of a theme, each one checked, with the entries left `undefined` dropped. Throws an
 * `InvalidOptionError` for a level that does not exist, a `bold` or `italic` that is not a boolean or a `font` that is
 * not a role, and an `InvalidColorError` for a color that is neither a token of `palette` nor a hex color.
 */
export function resolveLevels(levels: Typography['levels'], palette: ColorPalette): Required<Typography>['levels'] {
  const resolved: Partial<Record<TextLevel, TextLevelStyle>> = {};
  for (const [level, style] of Object.entries(defined(levels))) {
    if (!isTextLevel(level)) throw unknownOption('text level of theme.typography.levels', level, TEXT_LEVELS);
    resolved[level] = resolveLevelStyle(level, style, palette);
  }
  return resolved;
}

const isTextLevel = (name: string): name is TextLevel => (TEXT_LEVELS as readonly string[]).includes(name);

/**
 * The typography a theme draws with: sizes, weights and levels completed and checked, the line height defaulted, the
 * families kept as given. `createTheme` and the document both go through it, so a theme built without `createTheme`
 * is checked the same way.
 */
export function resolveTypography(
  typography: ThemeOverrides['typography'] | undefined,
  palette: ColorPalette,
): Typography {
  return {
    ...defined(typography),
    sizes: resolveSizes(typography?.sizes),
    weights: resolveWeights(typography?.weights),
    lineHeightFactor: typography?.lineHeightFactor ?? DEFAULT_TYPOGRAPHY.lineHeightFactor,
    levels: resolveLevels(typography?.levels, palette),
  };
}

/**
 * Builds a theme from a single `colors.primary`: the other palette tokens derive from it unless overridden. Without
 * overrides, the default blue theme.
 *
 * @example
 * ```ts
 * import { PDFDocument, createTheme } from '@mlt-a/jspdf-toolkit';
 *
 * const theme = createTheme({
 *   name: 'corporate',
 *   colors: { primary: '#1E40AF' }, // the other 14 tokens are derived
 *   typography: { sizes: { h2: 16 }, lineHeightFactor: 1.35 },
 *   spacing: { block: 5, heading: { h2: { before: 16 } } },
 * });
 * const doc = new PDFDocument({ theme });
 * ```
 */
export function createTheme(overrides: ThemeOverrides = {}): Theme {
  const { primary = DEFAULT_PRIMARY, ...rest } = overrides.colors ?? {};
  const colors: ColorPalette = generatePalette(primary, rest);

  const theme: Theme = {
    name: overrides.name ?? 'custom',
    colors,
    // Checked here as well as by the document, like the colors: a bad value throws where the theme is written.
    typography: resolveTypography(overrides.typography, colors),
    spacing: resolveSpacing(overrides.spacing),
    assets: defined(overrides.assets),
    chrome: defined(overrides.chrome),
  };

  return theme;
}
