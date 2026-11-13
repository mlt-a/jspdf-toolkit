// Every length the library draws with lives in this file, in millimeters unless a name says otherwise.
//
// - `SPACING` is the one scale of gaps. A gap anywhere in the drawing code is a step of it.
// - The rhythm between blocks (space under a block, around a heading) belongs to the theme: `theme.spacing`,
//   whose defaults are built from `SPACING` in `src/theme/defaults.ts`.
// - The objects below `SPACING` hold the geometry of one component each: sizes of what is drawn (an icon, a bar,
//   a radius, a margin) as plain numbers, and its gaps as `SPACING` steps.

// === Units ===

/** Points to millimeters conversion factor */
export const PT_TO_MM = 0.352778;

// === Spacing scale ===

/**
 * The spacing scale (mm), from `none` (0) to `xxxlarge` (16). Pick from it for a `spaceAfter`, an `addSpace` or a
 * custom component, and the document keeps one rhythm. The theme builds its default rhythm (`theme.spacing`) from it.
 */
export const SPACING = {
  /** 0 mm. */
  none: 0,
  /** 0.5 mm. */
  xxsmall: 0.5,
  /** 1 mm. */
  xsmall: 1,
  /** 2 mm. */
  small: 2,
  /** 4 mm: the default space under a block (`theme.spacing.block`). */
  medium: 4,
  /** 6 mm. */
  large: 6,
  /** 8 mm. */
  xlarge: 8,
  /** 12 mm. */
  xxlarge: 12,
  /** 16 mm: the default space above an `h1`. */
  xxxlarge: 16,
} as const;

// === Line widths and radii ===

/** Stroke widths (mm) of rules and borders: `thin`, `normal`, `thick`. */
export const LINE_WIDTH = {
  /** 0.2 mm: hairlines. */
  thin: 0.2,
  /** 0.3 mm: default rules and borders. */
  normal: 0.3,
  /** 0.4 mm: strong borders. */
  thick: 0.4,
} as const;

/** Corner radii (mm): `small` for boxes and pills, `medium` for callouts, `large` for badges. */
export const RADIUS = {
  /** 1 mm. */
  small: 1,
  /** 2 mm. */
  medium: 2,
  /** 3 mm. */
  large: 3,
} as const;

// === Page ===

/** Default page geometry (mm). */
export const LAYOUT = {
  pageMargin: 12,
  /** Gutter between side-by-side columns. */
  columnGap: SPACING.xlarge,
  footerMargin: 15,
  pageTopMargin: 20,
} as const;

// === Running header and footer ===

// Hoisted so the derived values below read from them.
const HEADER = {
  /** Baseline of the title and of the page number, from the top edge. */
  baselineFromTop: 10,
  /** Gap between that baseline and the rule under it. */
  ruleGap: SPACING.medium,
  /** Free space between the rule and the content that starts under it. */
  contentGap: SPACING.small,
  /** Smallest space kept between the title and the page number: a longer title is cut short. */
  titleGap: SPACING.large,
} as const;

const FOOTER = {
  /** Rule over the footer, below the content limit. */
  ruleBelowContent: SPACING.small,
  /** Gap between the rule and the top of the band that holds the labels and the logo. */
  bandTopGap: SPACING.small,
  /** Height of the band and of the logo. */
  bandHeight: 5,
  /** Free space under the band, down to the page edge. */
  bottomGap: SPACING.small,
  /** Free space on each side of the centered logo. */
  logoSideGap: SPACING.medium,
} as const;

/**
 * Geometry (mm) of `pageHeader` and `pageFooter`. The header lives in the top margin, which the document widens to
 * hold it; the footer lives in the footer zone. Neither takes space from the content.
 */
export const CHROME = {
  /** Extra space between letters of the labels. */
  tracking: 0.18,
  header: {
    /** Baseline of the title and of the page number, from the top edge. */
    baselineFromTop: HEADER.baselineFromTop,
    /** Smallest space kept between the title and the page number. */
    titleGap: HEADER.titleGap,
    /** Rule under the header, from the top edge. */
    ruleFromTop: HEADER.baselineFromTop + HEADER.ruleGap,
    /** Top margin the header needs: the content starts under its rule and gap. */
    reserve: HEADER.baselineFromTop + HEADER.ruleGap + HEADER.contentGap,
  },
  footer: {
    ...FOOTER,
    /** Smallest bottom margin (`margins.bottom`) that holds the rule, the band and the bottom gap. */
    minHeight: FOOTER.ruleBelowContent + FOOTER.bandTopGap + FOOTER.bandHeight + FOOTER.bottomGap,
  },
} as const;

// === Text ===

export const HEADING = {
  /** Gap between a heading number and its title. */
  numberGap: SPACING.medium,
  /** Gap between the descenders of the last line of a heading and its rule. */
  ruleGap: SPACING.xsmall,
} as const;

export const SEPARATOR = {
  /** Default space above the rule: wider than the space under a block, so the rule reads as a break. */
  spaceBefore: SPACING.large,
  /** Default space under the rule. */
  spaceAfter: SPACING.large,
} as const;

export const TEXT = {
  /** Offset of a link underline under its baseline. */
  linkUnderlineOffset: SPACING.xxsmall,
  /** Share of the line height (0 to 1) a link zone extends above the baseline. */
  linkZoneAscentRatio: 0.8,
} as const;

export const HIGHLIGHT = {
  /** Default padding around a highlighted run. */
  padding: SPACING.xsmall,
  radius: RADIUS.small,
} as const;

// === Lists ===

export const LIST = {
  /** Bullet glyph. */
  bulletChar: '•',
  /** Gutter reserved for a bullet, or the dash of a nested item: wrapped lines align under the text. */
  bulletPrefixWidth: 3,
  /** Gutter reserved for a number, widened when the numbers outgrow it. */
  numberedPrefixWidth: 5,
  /** Gap between a wide bullet or number and the text. */
  prefixGap: SPACING.xsmall,
  /** Indent of nested items. */
  subIndent: SPACING.medium,
  /** Default space between two items, and around nested items and details. */
  itemSpacing: SPACING.xsmall,
} as const;

export const ICONS = {
  /** Side of an icon set in a line of text. */
  size: 3,
  /** Side of the icon before an info box title. */
  infoSize: 4,
  /** Gap between an icon and its text. */
  gap: SPACING.small,
} as const;

// === Fields and forms ===

export const FIELD = {
  /** Stacked layout: gap between the label and the value under it. */
  labelGap: SPACING.xxsmall,
  /** Gap between a value and its complement note. */
  complementGap: SPACING.xsmall,
  /** Gap under a highlighted (pill) value. */
  pillGap: SPACING.small,
  /** `inline` and `leader` layouts: space between two fields of a row, each on its own line. */
  lineGap: SPACING.xsmall,
  /** Default space between two rows of `fieldRows`: stacked rows, and the groups of lines of the other layouts. */
  rowGap: { stacked: SPACING.small, inline: SPACING.medium, leader: SPACING.medium },
  /** Gap between the `Label:` of an inline field and its value. */
  inlineGap: SPACING.small,
  /**
   * Widest share of the line the side part of a one-line field may take: an inline label (wider: the field is
   * stacked) or a leader value (wider: it drops under the label).
   */
  sideMaxRatio: 0.5,
  /** Shortest dotted run between a leader label and its value. */
  leaderMinRun: SPACING.large,
} as const;

export const LEADER = {
  /** Dash and gap lengths of a dotted leader. */
  dash: [0.4, 1.2] satisfies readonly number[],
  /** Gap between the dots and the label or the value. */
  gap: SPACING.small,
  /** Narrowest label, as a share of the row width: below it the value goes under the label. */
  labelMinRatio: 0.25,
} as const;

export const CHECKBOX = {
  /** Side of the box. */
  size: 3.5,
  /** Gap between the box and its label. */
  gap: SPACING.small,
  /** Gap between consecutive checkboxes, which read as one group. */
  groupGap: SPACING.small,
} as const;

export const ANSWER_BADGE = {
  /** Side of the badge of an inline question. */
  size: 3,
  /** Gap between the badge and the answer. */
  gap: SPACING.small,
  /** Smallest space between a wrapped question and the badge. */
  questionGap: SPACING.medium,
} as const;

// === Boxes ===

export const BOX = {
  /** Padding on every side of a box. */
  padding: SPACING.medium,
  /** Default corner radius of a styled box. */
  radius: RADIUS.small,
} as const;

export const INFOBOX = {
  /** Gap between the title line and the content. */
  titleGap: SPACING.small,
  /** Gap between the content and the bullets. */
  bulletsGap: SPACING.small,
} as const;

export const CALLOUT = {
  radius: RADIUS.medium,
  /** Width of the accent bar on the left edge. */
  barWidth: 1.2,
  /** Gap between the accent bar and the text. */
  barGap: SPACING.small,
  /** Letter spacing of the eyebrow. */
  eyebrowTracking: 0.4,
  /** Gap between the eyebrow and the title. */
  eyebrowGap: SPACING.xsmall,
} as const;

export const DECLARATIONS = {
  /** Gap between the intro and the items, and between two items. */
  itemGap: SPACING.small,
} as const;

export const SIGNATURE = {
  /** Smallest image area under the text block: the box grows rather than squash a signature. */
  minImageHeight: 14,
  /** Box height when the caller gives none. */
  defaultHeight: 30,
  /** Gap between the text block and the signature image. */
  imageGap: SPACING.small,
  /** Gap between the caption line and the boxes. */
  captionGap: SPACING.small,
} as const;

// === Table ===

export const TABLE = {
  /** Cell padding (mm). The bottom is shorter: the line height already leaves air under the text. */
  cellPadding: { top: SPACING.small, right: SPACING.small, bottom: SPACING.xsmall, left: SPACING.small },
  /** Tint level (0 to 1) of the header cell borders, mixed from the primary color. */
  headBorderTint: 0.25,
  /** Gap (mm) between the continuation title and the table under it. */
  continuationTitleGap: SPACING.small,
  /**
   * Slack (mm) on the text width of a cell: a column sized from its content gets back, once the padding is taken off,
   * a width that may be a rounding error short of the text it was measured from.
   */
  wrapSlack: 1e-6,
  /** Narrowest text width (mm) an automatic column keeps when the fixed columns take the whole table. */
  minTextWidth: 1,
} as const;

export const TOC = {
  /** Indent per heading level below the shallowest listed one. */
  levelIndent: SPACING.large,
  /** Gap between an entry number and its label. */
  numberGap: SPACING.small,
  /** Space between two entries. */
  rowGap: SPACING.small,
} as const;

// === Page elements ===

export const LOGO = {
  /** Default height (mm) of a logo in the page header and on a cover. */
  height: 15,
  /** Default space (mm) under a logo drawn in the flow. */
  spaceAfter: SPACING.xlarge,
} as const;

export const BADGE = {
  /** Padding between the pill edge and the label, left and right. */
  paddingX: SPACING.large,
  /** Padding above and under the line of the label. */
  paddingY: SPACING.small,
  radius: RADIUS.large,
  /** Space between a heading and the badge that follows it: the badge reads as part of the heading. */
  headingGap: SPACING.small,
} as const;

export const HEADER_COLUMNS = {
  /** Default width (mm) reserved for the labels of a column. */
  labelWidth: 35,
  /** Smallest space between a wrapped label and its value. */
  labelGap: SPACING.small,
  /** Space between the title line of a column and its first field. */
  titleGap: SPACING.small,
  /** Space between two fields of a column. */
  rowGap: SPACING.xsmall,
  /** Default space under the columns. */
  spaceAfter: SPACING.xxlarge,
} as const;

export const WATERMARK = {
  /** Default rotation (degrees). */
  angle: -45,
  /** Default font size (pt). */
  fontSize: 60,
  /** Default opacity (0 to 1). */
  opacity: 0.08,
} as const;

// === Covers ===

export const COVER = {
  /** Default title font size (pt) of an image cover. */
  titleSize: 32,
  /** Default subtitle size of an image cover, as a share of the title size. */
  subtitleSizeRatio: 0.6,
  /** Default gap (mm) between the title and the subtitle of an image cover. */
  titleGap: SPACING.xlarge,
  /** Wave cover: title size (pt). */
  waveTitleSize: 28,
  /** Wave cover: subtitle size (pt). */
  waveSubtitleSize: 14,
  /** Wave cover: width (mm) of the accent bar. */
  waveAccentBarWidth: 30,
  /** Wave cover: height (mm) of the accent bar. */
  waveAccentBarHeight: 1.5,
  /** Wave cover: gap (mm) between the logo and the accent bar. */
  waveAccentBarGap: SPACING.xlarge,
  /** Wave cover: gap (mm) between the accent bar and the top of the title capitals. */
  waveTitleGap: SPACING.large,
  /** Wave cover: gap (mm) between the last baseline of the title and the top of the subtitle capitals. */
  waveSubtitleGap: SPACING.xlarge,
  /** Wave cover: position of the wave axis, as a share of the page height from the top. */
  waveYRatio: 0.65,
  /** Wave cover: amplitude (mm) of the wave around its axis. */
  waveDip: 15,
  titleWidthRatio: 0.6,
  /** Line height factor of the titles and subtitles of the covers. */
  lineHeightFactor: 1.25,
  contactLineHeightFactor: 1.4,
  legalBottomMargin: 15,
  /** Back cover: default distance of the logo and the contact block from the top-left corner. */
  backInset: 20,
  /** Back cover: default top of the contact block. */
  backContactTop: 50,
} as const;

// === Charts ===

export const CHART = {
  /** Side of a legend swatch. */
  swatch: 3,
  /** Length of the line sample of a line chart legend. */
  lineSwatch: 6,
  /** Gap between a swatch and its label. */
  swatchGap: SPACING.small,
  /** Gap between two legend entries on a line, and between a chart and the legend beside it. */
  legendGap: SPACING.large,
  /** Gap between two legend lines. */
  legendRowGap: SPACING.xsmall,
  /** Gap between a plot and the labels or legend under it. */
  captionGap: SPACING.small,
  /** Lightest shade of the default series colors, as a share of the way from the primary color to the page. */
  lightestShade: 0.75,
  /** Angle (radians) of a full turn of a ring. */
  fullTurn: Math.PI * 2,
  /** Angle (radians) of one segment of an arc: 6° keeps arcs smooth. */
  arcStep: Math.PI / 30,
  /** Fewest segments of an arc, so a thin slice still has a shape. */
  minArcSteps: 2,
  donut: {
    /** Angle (radians) where the first slice starts: the top of the ring. */
    startAngle: -Math.PI / 2,
    /** Diameter, as far as the legend beside it leaves room. */
    diameter: 46,
    /** Smallest diameter the default gives way to, in a narrow column. */
    minDiameter: 20,
    /** Radius of the hole, as a share of the radius: 0 draws a pie. */
    innerRatio: 0.62,
    /** Width kept for the legend beside the donut before the default diameter shrinks. */
    legendMinWidth: 36,
    /** Narrowest a legend label gets before the ellipsis cuts it. */
    minLabelWidth: SPACING.xlarge,
  },
  stackedBar: {
    height: 9,
    /** Narrowest slice that carries its percentage. */
    minLabelWidth: 12,
  },
  column: {
    /** Height of the tallest possible column. */
    height: 42,
    /** Smallest gap between two columns. */
    gap: SPACING.large,
    /** Widest a column gets, however few there are. */
    maxWidth: 28,
    /** Smallest room for a column label, however many columns share the width. */
    minLabelWidth: 1,
    /** Lines kept for a column label; the value sits under them. */
    labelLines: 2,
    /** Dash and gap lengths of the reference line. */
    referenceDash: [1, 1] satisfies readonly number[],
    /** Gap between the reference line and its label. */
    referenceGap: SPACING.xsmall,
    /** Largest share of the chart width the reference label takes; a longer label is cut with an ellipsis. */
    referenceLabelShare: 1 / 3,
  },
  line: {
    /** Height of the plot. */
    height: 62,
    /** Horizontal grid lines above the axis, and most labels under it. */
    yTicks: 4,
    xTicks: 6,
    /** Default stroke width of a line. */
    lineWidth: 0.5,
    /** Opacity of the band and of the highlighted area. */
    areaOpacity: 0.15,
    /** Opacity of their legend samples: at the opacity of the area, a sample that small would barely show. */
    areaSwatchOpacity: 0.3,
    /** Opacity of the grid lines above the axis. */
    gridOpacity: 0.5,
    /** Gap between the Y labels and the plot, and between two X labels. */
    axisGap: SPACING.small,
    /** Round numbers, in steps of a power of ten, that the top of the Y scale rounds up to. */
    niceSteps: [1, 2, 2.5, 5, 10] satisfies readonly number[],
    /** Significant digits a grid label prints exactly. */
    labelDigits: 3,
    /** Narrowest plot that is drawn: under it, the points and the labels would sit on top of each other. */
    minPlotWidth: 10,
  },
} as const;

// === Line height ===

/** Ratio from font size (pt) to visual ascent (mm). Empirical for Inter; close for Helvetica and other Latin fonts. */
const ASCENT_RATIO = 0.72;

/** Ratio from font size (pt) to the depth of descenders below the baseline: Helvetica 0.21 em, Inter 0.24 em. */
const DESCENT_RATIO = 0.22;

/**
 * The single line-height model: jsPDF advances multi-line text by `fontSize * lineHeightFactor` points,
 * so every Y advance uses the same product to stay aligned with what jsPDF draws.
 */
export function lineHeightMm(fontSizePt: number, lineHeightFactor: number, scale = 1): number {
  return fontSizePt * PT_TO_MM * lineHeightFactor * scale;
}

/** Font size (pt) to the distance (mm) from the top of a line to its baseline. */
export function ascentMm(fontSizePt: number): number {
  return fontSizePt * PT_TO_MM * ASCENT_RATIO;
}

/** Font size (pt) to the depth (mm) of descenders below the baseline. */
export function descentMm(fontSizePt: number): number {
  return fontSizePt * PT_TO_MM * DESCENT_RATIO;
}

/** The text a mark is centered on: a font size (pt), or the metrics of a text level, whose ascent is already known. */
export type CapitalsOf = number | { ascent: number };

/**
 * Height (mm) of the middle of the capitals above the baseline, for text of `text`. A baseline that many mm under the
 * middle of a band centers the text on it; a mark centered that many mm over the baseline lines up with the text.
 */
export function capitalMiddle(text: CapitalsOf): number {
  return (typeof text === 'number' ? ascentMm(text) : text.ascent) / 2;
}

/**
 * Top (mm) of a mark `size` tall (checkbox, icon, badge) centered on the capitals of `text` whose baseline is at
 * `baseline`: the mark lines up with the text whatever the text level.
 */
export function centerOnCapitals(baseline: number, text: CapitalsOf, size: number): number {
  return baseline - capitalMiddle(text) - size / 2;
}

// === Text levels ===

/** Semantic text style (size, weight, color) that blocks and theme typography are keyed by. */
export type TextLevel =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'body'
  | 'bodyBold'
  | 'small'
  | 'smallMuted'
  | 'caption'
  | 'label'
  | 'fieldLabel'
  | 'fieldValue'
  | 'footer'
  | 'italic';

/** The text levels, in the order of `TextLevel`. The theme checks `typography.levels` against it. */
export const TEXT_LEVELS = [
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
  'fieldLabel',
  'fieldValue',
  'footer',
  'italic',
] as const satisfies readonly TextLevel[];

// A level added to `TextLevel` and left out of `TEXT_LEVELS` would be refused by `typography.levels`: fail the build.
type AssertAllLevelsListed = Exclude<TextLevel, (typeof TEXT_LEVELS)[number]> extends never ? true : never;
export const ALL_LEVELS_LISTED: AssertAllLevelsListed = true;

/**
 * Font role: `body` = the default family (`fontFamily`), `title` = headings (`titleFontFamily`), `label` = labels and
 * field names (`labelFontFamily`). The document resolves the title and label families to the default one when the
 * theme leaves them out.
 */
export type FontRole = 'body' | 'title' | 'label';

/** The font roles, in the order of `FontRole`. The theme checks the `font` of a text level against it. */
export const FONT_ROLES = ['body', 'title', 'label'] as const satisfies readonly FontRole[];

// A role added to `FontRole` and left out of `FONT_ROLES` would be refused by `typography.levels`: fail the build.
type AssertAllRolesListed = Exclude<FontRole, (typeof FONT_ROLES)[number]> extends never ? true : never;
export const ALL_ROLES_LISTED: AssertAllRolesListed = true;

/** Heading level, `h1` to `h4`. */
export type HeadingLevel = Extract<TextLevel, 'h1' | 'h2' | 'h3' | 'h4'>;

/** Horizontal alignment of a line of text on its anchor. */
export type TextAlign = 'left' | 'center' | 'right';

/** The alignments a `TextAlign` takes. */
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const satisfies readonly TextAlign[];

/** The heading levels in order, `h1` first. */
export const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4'] as const satisfies readonly HeadingLevel[];
