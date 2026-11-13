// === Document ===
export { PDFDocument } from './core/document';
export type { DocumentOptions, AddPageOptions, BackgroundOptions, EnsureSpaceOptions } from './core/document';
export type { InsetOptions } from './core/inset';
export type { Margins } from './core/page-layout';
export type { PageFormat } from './core/page-format';
export type { DrawingContext } from './core/context';

// === Theme ===
export {
  createTheme,
  DEFAULT_COLORS,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_SPACING,
  presetTheme,
  PRESET_THEME_NAMES,
} from './theme';
export type {
  Theme,
  ResolvedTheme,
  ThemeOverrides,
  ColorPalette,
  ColorInput,
  Typography,
  ResolvedTypography,
  TypographySizes,
  TextLevelStyle,
  Spacing,
  SpacingOverrides,
  HeadingSpacing,
  ThemeAssets,
  CoverConfig,
  ChromeTokens,
  PresetThemeName,
} from './theme';

// === Colors ===
export { generatePalette, resolveColor, hexToRgb, rgbToHex, tint, contrastRatio, ensureReadableOn } from './theme';

// === Fonts and images ===
// Fonts go through the `fonts` document option; the path loaders live in the `/node` entry point.
export { loadFontFromBase64, loadFontFromBinary } from './fonts';
export type { FontSource, FontStyle, LoadFontOptions } from './fonts';
export { loadImageFromBase64, loadImageFromBinary } from './images';
export type { LoadImageOptions } from './images';

// === Errors ===
export { PdfToolkitError, InvalidColorError, InvalidOptionError, AssetLoadError } from './core/errors';

// === Units and scales ===
// The steps the built-in blocks use, so custom code matches them.
export { PT_TO_MM, SPACING, LINE_WIDTH, RADIUS } from './core/constants';
export type { TextLevel, HeadingLevel, TextAlign } from './core/constants';

// === Option types of the PDFDocument methods ===
export type { HeadingOptions, ParagraphOptions, ParagraphsOptions } from './drawing/text';
export type { RichTextOptions } from './drawing/rich';
export type { RichBlock, RichInline } from './text/markup';
export type { SeparatorOptions } from './drawing/sections';
export type { ListItem, ListOptions, IconListOptions } from './drawing/lists';
export type { CheckboxVariant, CheckboxOptions, InlineQuestionOptions } from './drawing/checkboxes';
export type { Field, FieldLayout, FieldsOptions } from './drawing/fields';
export type { InfoBoxOptions, InfoBoxCommon, SurfaceInfoBoxOptions, CalloutInfoBoxOptions } from './drawing/boxes';
export type { DeclarationItem, DeclarationsBoxOptions } from './drawing/declarations';
export type { AddressLine, AddressBlockOptions } from './drawing/address';
export type { SignatureItem, SignatureBoxBounds, SignatureZoneOptions } from './drawing/signatures';
export type { Column, ColumnsOptions } from './drawing/columns';
export type {
  ChartSlice,
  DonutChartOptions,
  StackedBarOptions,
  ChartSeries,
  ChartColumn,
  ColumnChartOptions,
  ChartLine,
  ChartBand,
  LineChartData,
  LineChartOptions,
} from './drawing/charts';
export type { LogoOptions, BadgeOptions, HeaderField, HeaderColumn, HeaderColumnsOptions } from './page/header';
export type { LogoAnchor, LogoPosition, LogoPlacement } from './page/logo';
export type { TableCell, TableCellContext, TableCellStyle, TableColumn, TableOptions, TableRow } from './table';
export type { WatermarkOptions } from './drawing/watermark';
export type {
  CoverOptions,
  CoverBaseOptions,
  ImageCoverOptions,
  WaveCoverOptions,
  CustomCoverOptions,
  BackCoverOptions,
  PlainBackCoverOptions,
  CustomBackCoverOptions,
  BackCoverContact,
} from './page/cover';
export type { TableOfContentsOptions } from './drawing/table-of-contents';
export type { PageHeaderOptions, PageFooterOptions } from './page/header-footer';
export type { ClosingNoteOptions } from './page/closing-note';

// === Low-level drawing primitives and measures ===
// For what the PDFDocument methods do not cover. They take the document as `DrawingContext`, then the content, then
// options: `{ x, y, … }` for what is drawn at coordinates. Each returns the Y under what it drew.
// `computeXHeight` takes the options of the matching method and excludes `spaceAfter`; `measureX` returns metrics.
export { setTextStyle, measureTextLevel, computeParagraphHeight } from './drawing/text';
export { setFont } from './drawing/text-style';
export type { FontRole } from './drawing/text-style';
export type { TextLevelMetrics, MeasureTextLevelOptions } from './drawing/text';
export { computeRichTextHeight, computeRichBlocksHeight } from './drawing/rich';
export { parseRichText, parseRichInline } from './text/markup';
export { drawBox, computeInfoBoxHeight } from './drawing/boxes';
export type { BoxStylePreset, BoxOptions } from './drawing/boxes';
export { drawHighlightedText, measureHighlightedText } from './drawing/highlights';
export type { HighlightedTextOptions, HighlightMetrics } from './drawing/highlights';
export { drawIconWithText } from './drawing/icons';
export type { IconWithTextOptions } from './drawing/icons';
export { drawImage } from './drawing/image-helpers';
export type { ImageOptions } from './drawing/image-helpers';
export { computeDeclarationsBoxHeight } from './drawing/declarations';
export { parseAddressLines } from './drawing/address';
export type { ParseAddressLinesOptions } from './drawing/address';
export { computeSignatureZoneHeight } from './drawing/signatures';
export {
  computeDonutChartHeight,
  computeStackedBarHeight,
  computeColumnChartHeight,
  computeLineChartHeight,
} from './drawing/charts';
