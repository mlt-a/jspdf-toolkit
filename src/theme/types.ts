import type { FontRole, HeadingLevel, TextAlign, TextLevel } from '../core/constants';
import type { LogoPosition } from '../page/logo';

/** The 15 color tokens every block draws from. `generatePalette` derives them from one primary color. */
export interface ColorPalette {
  /** The accent: `h2` headings and `label`, table head, badge text, accent bars, ticked boxes, strong pills. */
  primary: string;
  /**
   * Text on a `primary` fill (table head, strong pills): white when it reaches 3:1 on it, else white or dark slate,
   * whichever contrasts more.
   */
  onPrimary: string;
  /** Page color, and the fill of table body rows and of the `background` box preset. Default: `#FFFFFF`. */
  background: string;
  /** Rules, signature boxes, table lines and the `border` and `background` box presets. Default: `#E2E8F0`. */
  border: string;
  /** Fill of the `surface` box preset and of the default info box: `primary` mixed far toward white. */
  surface: string;
  /**
   * Border of the `surface` and `surfaceBorder` box presets, and the table foot lines: `primary` mixed toward white.
   */
  surfaceBorder: string;
  /** Alternate table row fill, a small step from the page background toward the text color. */
  zebraFill: string;
  /** Body text, `h1` and `h3`. Default: `#1E293B`. */
  text: string;
  /** Muted text: `h4`, `smallMuted`, `italic`, labels, closing note, header and footer. Default: `#64748B`. */
  secondary: string;
  /** Faintest text: `caption`, `footer` level and signature sublabels. Default: `#94A3B8`. */
  subtle: string;
  /** Soft `primary` fill: tint boxes and callouts, badge, table foot, cover wave. */
  tint: string;
  /** Border of the `tint` box preset: `primary` mixed toward white. */
  tintBorder: string;
  /** Fill of regular (not strong) highlight pills: a little lighter than `tint`. */
  tintLight: string;
  /** Answered "yes" of an inline question. Default: `#059669`. */
  success: string;
  /** Crossed boxes. Default: `#E11D48`. */
  error: string;
}

/**
 * A color option: a palette token (`'primary'`, `'secondary'`…), read from the document theme, or a hex color
 * (`#RGB`, `#RRGGBB`) with its `#`.
 */
export type ColorInput = keyof ColorPalette | `#${string}`;

/**
 * Font size (pt) of each text level. Derived levels share the size of their base: `bodyBold` reads `body`,
 * `smallMuted` and `italic` read `small`.
 */
export interface TypographySizes {
  /** Size (pt) of `h1` headings, the page title. Default: 24. */
  h1: number;
  /** Size (pt) of `h2` headings, the section title. Default: 14. */
  h2: number;
  /** Size (pt) of `h3` headings, the sub-section title. Default: 10. */
  h3: number;
  /** Size (pt) of `h4` headings, the smallest title. Default: 8. */
  h4: number;
  /** Size (pt) of paragraphs, lists and boxes: the `body` and `bodyBold` levels. Default: 9. */
  body: number;
  /** Size (pt) of table cells and notes: the `small`, `smallMuted` and `italic` levels. Default: 8. */
  small: number;
  /** Size (pt) of captions, the faintest small text. Default: 7. */
  caption: number;
  /** Size (pt) of `label` text, such as an info box title. Default: 9. */
  label: number;
  /** Size (pt) of the name above or beside a field value. Default: 8. */
  fieldLabel: number;
  /** Size (pt) of field values. Default: 10. */
  fieldValue: number;
  /** Size (pt) of the running footer and the `footer` level. Default: 7. */
  footer: number;
}

/**
 * What a theme may change on a text level; what it leaves out keeps the built-in style. The size of a level is set in
 * `typography.sizes`.
 */
export interface TextLevelStyle {
  /** Text color: a palette token or a hex color. */
  color?: ColorInput;
  /** Bold face, through `typography.weights`. */
  bold?: boolean;
  /** Italic style on top of the weight. */
  italic?: boolean;
  /** Family the level is set in: the default one (`body`), `titleFontFamily` or `labelFontFamily`. */
  font?: FontRole;
}

/** Font families, sizes (per `TextLevel`) and weights of a theme. */
export interface Typography {
  /**
   * Default family. Absent: the first family of the `fonts` document option, else Helvetica. The document resolves
   * it once, in `doc.theme.typography`.
   */
  fontFamily?: string;
  /** Family of headings. Absent: falls back to the default family. */
  titleFontFamily?: string;
  /** Family of labels and field names. Absent: falls back to the default family. */
  labelFontFamily?: string;
  /** Font size (pt) of each text level. */
  sizes: TypographySizes;
  /** jsPDF face of each weight, e.g. `bold: 'normal'` for a family without a bold face. Italic is a style on top. */
  weights: {
    /** Face of regular text. Default: `'normal'`. */
    regular: 'normal' | 'bold';
    /** Face of bold text. Default: `'bold'`. */
    bold: 'normal' | 'bold';
  };
  /** Line spacing: the distance between two baselines is the font size times this factor. Default: 1.3. */
  lineHeightFactor: number;
  /**
   * Style of the text levels, level by level, over the built-in one: e.g. `{ h2: { color: 'text' } }` for section
   * headings in the text color rather than the primary one. Every block set in that level follows. A value that is
   * not valid throws in `createTheme`.
   */
  levels?: Partial<Record<TextLevel, TextLevelStyle>>;
}

/**
 * `Typography` as the document holds it in `doc.theme`: every family resolved. A level color stays as the theme wrote
 * it: a palette token is read from `doc.theme.colors`.
 */
export interface ResolvedTypography extends Typography {
  fontFamily: string;
  titleFontFamily: string;
  labelFontFamily: string;
}

/**
 * Where an image cover (`cover(title, { variant: 'image' })`) places its title, subtitle and logo. Positions in mm.
 */
export interface CoverConfig {
  /** Position of the cover `logo`, which the `logo` option of the cover overrides field by field. */
  logo?: LogoPosition;
  /** Title color, and the subtitle's unless `subtitleColor` is set. */
  color: ColorInput;
  /** X (mm) the title and subtitle are aligned to: their left edge, center or right edge, per `titleAlign`. */
  titleX: number;
  /** Baseline Y (mm) of the first title line. */
  titleY: number;
  /** Width (mm) the title and subtitle wrap within. Default: 60% of the page width. */
  titleMaxWidth?: number;
  /** Title font size (pt). Default: 32. */
  titleSize?: number;
  /** Alignment of the title and subtitle on `titleX`. Default: `'left'`. */
  titleAlign?: TextAlign;
  /** Space (mm) between the title and the subtitle. Default: 8. */
  titleGap?: number;
  /** Subtitle font size (pt). Default: 60% of the title size. */
  subtitleSize?: number;
  /** Subtitle color. Default: `color`. */
  subtitleColor?: ColorInput;
}

/** Images and layouts a theme brings along. */
export interface ThemeAssets {
  /**
   * Vertical shift (mm) of the background images, which sit on the bottom edge of the page: a positive value moves them
   * down, a negative one up.
   */
  backgroundOffsetY?: number;
  /** Default `logo` of `pageFooter`: a name given to `registerImage`, or image data. */
  footerLogo?: string;
  /** Layouts of the image covers, by the key `cover(title, { variant: 'image', layout })` names. */
  covers?: Record<string, CoverConfig>;
}

/**
 * Look of the running header and footer (`pageHeader`, `pageFooter`) that the palette does not decide: text in
 * `colors.secondary`, accent in `colors.primary`, rules in `colors.border`, size `typography.sizes.footer`.
 */
export interface ChromeTokens {
  /** Extra space between letters (mm). Default: a light tracking that suits capitals. */
  tracking?: number;
  /** Labels in capitals. Default: `true`. */
  uppercase?: boolean;
}

/** Space (mm) above and under a heading level. */
export interface HeadingSpacing {
  /** Space above the heading: its default `spaceBefore`. */
  before: number;
  /** Space under the heading: its default `spaceAfter`. */
  after: number;
}

/**
 * Vertical rhythm of a document (mm). Two blocks are separated by the larger of the space the first leaves under it
 * and the space the second asks above it: spaces collapse, they do not add up. Pick the values from `SPACING`.
 */
export interface Spacing {
  /**
   * Space under a block (paragraph, list, table, box, fields, signatures, columns…) and between two paragraphs: the
   * default `spaceAfter`. Default: `SPACING.medium` (4).
   */
  block: number;
  /**
   * Space above and under each heading level: the default `spaceBefore` and `spaceAfter` of `heading`. Defaults
   * (before / after): h1 16 / 8, h2 12 / 4, h3 8 / 2, h4 4 / 2.
   */
  heading: Record<HeadingLevel, HeadingSpacing>;
}

/** Spacing to set: each value left out, level by level and side by side, keeps its default (`DEFAULT_SPACING`). */
export interface SpacingOverrides {
  /**
   * Space (mm) under a block (paragraph, list, table, box, fields, signatures, columns…) and between two paragraphs: the
   * default `spaceAfter`. Default: `SPACING.medium` (4).
   */
  block?: number;
  /**
   * Space (mm) above and under each heading level, `{ before, after }`: the default `spaceBefore` and `spaceAfter` of
   * `heading`. A level or a side left out keeps its default.
   */
  heading?: Partial<Record<HeadingLevel, Partial<HeadingSpacing>>>;
}

/** Everything that styles a document: palette, typography, spacing, assets and running header/footer look. */
export interface Theme {
  /** Label of the theme, for the caller's own use; the library does not read it. */
  name: string;
  /** Palette every block draws its colors from. */
  colors: ColorPalette;
  /** Font families, sizes and line spacing. */
  typography: Typography;
  /**
   * Vertical rhythm: the space under a block, and around each heading level. Always complete: `createTheme` fills what
   * `ThemeOverrides.spacing` leaves out from `DEFAULT_SPACING` and throws an `InvalidOptionError` for a negative or
   * non-finite space.
   */
  spacing: Spacing;
  /** Footer logo, background offset and image cover layouts. */
  assets: ThemeAssets;
  /** Look of the running header and footer. */
  chrome: ChromeTokens;
}

/** The theme of a document (`doc.theme`): colors normalized to `#RRGGBB`, font families and spacing resolved. */
export interface ResolvedTheme extends Theme {
  typography: ResolvedTypography;
}
