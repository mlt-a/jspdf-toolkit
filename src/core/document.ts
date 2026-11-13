import { jsPDF } from 'jspdf';

import { drawAddressBlock } from '../drawing/address';
import type { AddressLine, AddressBlockOptions } from '../drawing/address';
import { drawInfoBox } from '../drawing/boxes';
import type { InfoBoxOptions } from '../drawing/boxes';
import { drawColumnChart, drawDonutChart, drawLineChart, drawStackedBar } from '../drawing/charts';
import type {
  ChartColumn,
  ChartSlice,
  ColumnChartOptions,
  DonutChartOptions,
  LineChartData,
  LineChartOptions,
  StackedBarOptions,
} from '../drawing/charts';
import { drawCheckbox, drawInlineQuestion } from '../drawing/checkboxes';
import type { CheckboxOptions, InlineQuestionOptions } from '../drawing/checkboxes';
import { drawColumns } from '../drawing/columns';
import type { Column, ColumnsOptions } from '../drawing/columns';
import { drawDeclarationsBox } from '../drawing/declarations';
import type { DeclarationItem, DeclarationsBoxOptions } from '../drawing/declarations';
import { restateFillColor, trackDrawingState, withDrawingState } from '../drawing/drawing-state';
import { drawFields, drawFieldRows } from '../drawing/fields';
import type { Field, FieldsOptions } from '../drawing/fields';
import { drawBackgroundImage } from '../drawing/image-helpers';
import { drawBulletList, drawNumberedList, drawIconList } from '../drawing/lists';
import type { ListItem, ListOptions, IconListOptions } from '../drawing/lists';
import { drawRichBlocks, drawRichText } from '../drawing/rich';
import type { RichTextOptions } from '../drawing/rich';
import { drawSeparator } from '../drawing/sections';
import type { SeparatorOptions } from '../drawing/sections';
import { drawSignatureZone } from '../drawing/signatures';
import type { SignatureItem, SignatureZoneOptions } from '../drawing/signatures';
import {
  drawTableOfContents,
  renderTableOfContents,
  resolveTableOfContentsOptions,
} from '../drawing/table-of-contents';
import type { TableOfContentsOptions } from '../drawing/table-of-contents';
import {
  drawHeading,
  drawParagraph,
  drawParagraphs,
  headingHeight,
  resolveHeadingOptions,
  setTextStyle,
} from '../drawing/text';
import type { HeadingOptions, ParagraphOptions, ParagraphsOptions, ResolvedHeadingOptions } from '../drawing/text';
import { THIN_SPACE, normalizeText } from '../drawing/text-lines';
import { watermarkDrawer } from '../drawing/watermark';
import type { WatermarkOptions } from '../drawing/watermark';
import { checkFontSources, registerFonts } from '../fonts/register';
import type { FontSource } from '../fonts/types';
import { drawClosingNote } from '../page/closing-note';
import type { ClosingNoteOptions } from '../page/closing-note';
import { checkVariant, drawBackCover, drawCover } from '../page/cover';
import type { BackCoverOptions, CoverOptions, DesignedPage } from '../page/cover';
import { drawLogo, drawBadge, drawHeaderColumns } from '../page/header';
import type { BadgeOptions, HeaderColumn, HeaderColumnsOptions, LogoOptions } from '../page/header';
import {
  DEFAULT_PAGE_FOOTER,
  checkPageFooter,
  checkPageHeader,
  drawPageFooter,
  drawPageHeader,
  type PageFooterOptions,
  type PageHeaderOptions,
} from '../page/header-footer';
import { drawTable } from '../table/table';
import type { TableOptions, TableRow } from '../table/types';
import type { RichBlock } from '../text/markup';
import { normalizePalette } from '../theme/colors';
import { createTheme, resolveSpacing, resolveTypography } from '../theme/defaults';
import type { ResolvedTheme, ResolvedTypography, Theme } from '../theme/types';
import { errorMessage } from '../utils/errors';
import { CHROME } from './constants';
import {
  InvalidOptionError,
  POSITIVE,
  checkedFunction,
  checkedNumber,
  checkedObject,
  checkedText,
  checkedTexts,
  optionalBoolean,
  optionalNumber,
  optionalText,
} from './errors';
import { ImageCache } from './image-cache';
import type { EmbeddedImage } from './image-cache';
import { resolveInset } from './inset';
import type { InsetOptions } from './inset';
import { resolvePageFormat } from './page-format';
import type { PageFormat } from './page-format';
import { PageLayout, resolveMargins } from './page-layout';
import type { Margins } from './page-layout';
import { PageReferences } from './page-references';

/** Options of the `PDFDocument` constructor. All optional. */
export interface DocumentOptions {
  /** Colors, typography and spacing of every block: `createTheme(…)` or `presetTheme(…)`. Default: `createTheme()`. */
  theme?: Theme;
  /**
   * Page format: `'A3'`, `'A4'`, `'A5'`, `'letter'`, `'legal'`, or `[width, height]` in mm. Margins, content area,
   * covers, watermarks, backgrounds, header and footer follow it. Throws `InvalidOptionError` for an unknown name or a
   * size that is not two finite numbers above 0. Default: `'A4'`.
   */
  format?: PageFormat;
  /**
   * Default: `'portrait'`, or the shape of a custom `[width, height]` format (`[297, 210]` is landscape). Given with a
   * custom format, it turns the page to match.
   */
  orientation?: 'portrait' | 'landscape';
  /** Page margins (mm); omitted sides keep their default. */
  margins?: Partial<Margins>;
  /**
   * Font files to embed. When `theme.typography.fontFamily` is not set, the first family listed here becomes the
   * default family; without fonts, Helvetica.
   */
  fonts?: FontSource[];
  /**
   * Top of the content (mm) on the first page only, e.g. lower to leave room for a letterhead, higher to start
   * right away. Default: `margins.top`.
   */
  firstPageTop?: number;
  /**
   * Width (mm) of the reading column: the default width of text blocks (headings, paragraphs and rich text, lists,
   * fields, checkboxes, inline questions, whose answer ends on its right edge, badges, info boxes, declarations,
   * signatures, and address blocks), so lines stay short on a wide page. A reading column narrower than the content
   * width leaves air on the right. Tables, charts, columns, header columns, separators, the running header and footer,
   * covers and watermarks span the content width. Inside a `columns` callback, the reading column is the narrower of
   * the column and this width. Default: the content width.
   */
  measure?: number;
  /** Compresses the PDF streams. Default: `true`. */
  compress?: boolean;
  /** PDF metadata title. */
  title?: string;
  /** PDF metadata author. */
  author?: string;
  /** PDF metadata subject. */
  subject?: string;
  /** PDF metadata keywords. */
  keywords?: string[];
  /** PDF metadata creator. */
  creator?: string;
  /** Prints each warning to the console as it is raised, besides listing it in `warnings`. Default: `false`. */
  debug?: boolean;
}

/** Options of `background`. */
export interface BackgroundOptions {
  /**
   * The current page and every page added after it, blank pages excepted (`addPage({ blank: true })`, back cover).
   * Pages before the current one keep no background: drawn over their content, it would hide it. Default: `false`,
   * the current page only.
   */
  allPages?: boolean;
}

/** Options of `addPage`. */
export interface AddPageOptions {
  /**
   * A page that paints itself: it gets the theme background color, and `finalize()` draws the `allPages` watermarks
   * on it, but it gets neither the `onNewPage` callback nor the `allPages` background image. Default: `false`.
   */
  blank?: boolean;
}

/** Options of `ensureSpace`. */
export interface EnsureSpaceOptions {
  /**
   * Height (mm) the caller draws at the top of the new page before the block when the page breaks (a continuation
   * title, a repeated header). It does not decide the break; it counts in the warning for a block too tall for a page.
   * Default: 0.
   */
  lead?: number;
}

/**
 * Throws `InvalidOptionError` for a margin or `firstPageTop` that is not a finite number of 0 or more, margins that
 * leave no width or no height, or a `measure` outside the content width. The running header is declared after
 * construction: its reserve is not part of the height check.
 */
function validateOptions(options: DocumentOptions, resolved: Margins, pageWidth: number, pageHeight: number): void {
  const { margins, firstPageTop, measure } = options;

  const nonNegative = {
    'margins.top': margins?.top,
    'margins.right': margins?.right,
    'margins.bottom': margins?.bottom,
    'margins.left': margins?.left,
    firstPageTop,
  };
  for (const [name, value] of Object.entries(nonNegative)) {
    if (value !== undefined) checkedNumber(`${name} (mm)`, value, { min: 0 });
  }

  const { left, right } = resolved;
  if (left + right >= pageWidth) {
    throw new InvalidOptionError(
      `Invalid margins: left (${left}) + right (${right}) = ${left + right} >= page width (${pageWidth})`,
    );
  }

  const { top, bottom } = resolved;
  if (top + bottom >= pageHeight) {
    throw new InvalidOptionError(
      `Invalid margins: top (${top}) + bottom (${bottom}) = ${top + bottom} >= page height (${pageHeight})`,
    );
  }

  const contentWidth = pageWidth - left - right;
  if (measure !== undefined) checkedNumber('measure (mm)', measure, { ...POSITIVE, max: contentWidth });
}

/**
 * Throws `InvalidOptionError` for options that are no object, and for a metadata text, a flag or a `fonts` entry of the
 * wrong type, before jsPDF is created: jsPDF would only fail on export, with an error of its own.
 */
function checkDocumentOptions(options: DocumentOptions): void {
  checkedObject('document options', options);
  if (options.margins !== undefined) checkedObject('margins', options.margins);
  if (options.fonts !== undefined) checkFontSources(options.fonts);
  for (const key of ['title', 'author', 'subject', 'creator'] as const) optionalText(key, options[key]);
  if (options.keywords !== undefined) checkedTexts('keywords', options.keywords);
  optionalBoolean('compress', options.compress);
  optionalBoolean('debug', options.debug);
}

// Built-in jsPDF font: no embedding, but WinAnsi characters only.
const FALLBACK_FONT_FAMILY = 'helvetica';

/**
 * The theme as the document holds it: colors written `#RRGGBB` (a hand-built theme may write `#fff`), every font
 * family resolved: the theme's, else the first family of `fonts`, else Helvetica; title and label families fall back to
 * the default one. The types require a complete `spacing` and `typography`, an `assets` and a `chrome`, but a caller
 * without types may leave them out or set part of them: the defaults complete them, and the values are checked as
 * `createTheme` checks them. A theme, or a part of it, that is no object throws an `InvalidOptionError`.
 */
function resolveTheme(theme: Theme, fonts: FontSource[]): ResolvedTheme {
  checkedObject('theme', theme);
  checkedObject('theme colors', theme.colors);
  for (const part of ['typography', 'spacing', 'assets', 'chrome'] as const) {
    if (theme[part] !== undefined) checkedObject(`theme ${part}`, theme[part]);
  }
  // Left out by a caller without types: the defaults fill them, as they fill a partial one.
  const typography: Partial<Theme['typography']> = theme.typography ?? {};
  const fontFamily = typography.fontFamily ?? fonts[0]?.family ?? FALLBACK_FONT_FAMILY;
  const palette = normalizePalette(theme.colors);
  return {
    ...theme,
    assets: theme.assets ?? {},
    chrome: theme.chrome ?? {},
    colors: palette,
    // `createTheme` already resolved spacing and typography. This is for a theme that skipped it (a caller without
    // types), or changed its palette after: the level colors are checked against the palette drawn with.
    spacing: resolveSpacing(theme.spacing),
    typography: {
      ...resolveTypography(typography, palette),
      fontFamily,
      titleFontFamily: typography.titleFontFamily ?? fontFamily,
      labelFontFamily: typography.labelFontFamily ?? fontFamily,
    },
  };
}

// The theme only names families; a typo or a missing `fonts` option would otherwise
// surface as an obscure jsPDF error on the first text call. Returns a warning message, if any.
function checkThemeFonts(doc: jsPDF, typography: ResolvedTypography, fonts: FontSource[]): string | undefined {
  const available = Object.keys(doc.getFontList());
  // jsPDF lowercases built-in family names on lookup but matches registered ones exactly.
  const isAvailable = (family: string) => available.includes(family) || available.includes(family.toLowerCase());

  const themeFamilies = [typography.fontFamily, typography.titleFontFamily, typography.labelFontFamily];
  for (const family of themeFamilies) {
    if (!isAvailable(family)) {
      throw new InvalidOptionError(
        `Font family "${family}" is not available. Available families: ${available.join(', ')}. ` +
          `Register it with the \`fonts\` document option (see \`loadFontFromPath\` in the \`/node\` entry point, or \`loadFontFromBase64\` and \`loadFontFromBinary\`)`,
      );
    }
  }

  if (fonts.length > 0 && !fonts.some((font) => themeFamilies.includes(font.family))) {
    const registered = [...new Set(fonts.map((font) => font.family))].join(', ');
    return `Registered fonts (${registered}) are not referenced by theme.typography.fontFamily, titleFontFamily or labelFontFamily`;
  }
  return undefined;
}

/** A heading waiting for the next block, with the frame it was called in: it is measured and drawn there. */
type PendingHeading = { text: string; options: ResolvedHeadingOptions; frame: Frame };

/** Where the blocks lay themselves out across the page: the page content area, a branch of `parallel`, an inset. */
interface Frame {
  /** `left` and `right` are the edges of the frame, `bottom` the footer zone; `top` reads the header reserve live. */
  readonly margins: Readonly<Margins>;
  readonly contentWidth: number;
  readonly measure: number;
  /** Inside a branch of `parallel`: a page break there leaves the branches beside it behind. */
  readonly branch: boolean;
}

/** @internal A kind of block the next one may attach to: see `attachTo`. */
export type BlockKind = 'heading' | 'checkbox';

/** What the last block left under it. Never mutated: saving it is keeping the reference. */
interface Trailing {
  /** Space (mm) under it (`endBlock`), which the `spaceBefore` of the next block collapses into. */
  readonly space: number;
  /** Its kind and the frame it closed in, when it left its default space: only then may a block attach to it. */
  readonly block?: { readonly kind: BlockKind; readonly frame: Frame };
}

const NO_TRAILING: Trailing = { space: 0 };

/**
 * A frame from `left` to `right` (mm from each page edge), `contentWidth` mm wide, over a footer zone `bottom` mm high.
 * Its margins object is built once and frozen; a `pageHeader` declared while the frame is open still moves its `top`.
 */
function createFrame(
  layout: PageLayout,
  { left, right, bottom }: Pick<Margins, 'left' | 'right' | 'bottom'>,
  contentWidth: number,
  measure: number,
  branch: boolean,
): Frame {
  const margins = Object.defineProperties({} as Margins, {
    top: { get: () => layout.topFor(2), enumerable: true },
    right: { value: right, enumerable: true },
    bottom: { value: bottom, enumerable: true },
    left: { value: left, enumerable: true },
  });
  return { margins: Object.freeze(margins), contentWidth, measure, branch };
}

/** @internal A branch of `parallel`: `draw` lays out its blocks in the frame `width` mm wide from `left` (mm). */
export interface ParallelBranch {
  left: number;
  width: number;
  draw: () => void;
}

const BRANCH_PAGE_BREAK_WARNING =
  'A column of columns() ran onto a new page: columns do not continue across pages, so the columns after it ' +
  'start at the top of that page. Wrap the whole columns() call in keepTogether(), not a block inside a column';

// A designed page is one page: what is drawn past it is ordinary content, with a page number and a footer.
function designedPageOverflowWarning(kind: DesignedPage): string {
  const name = kind === 'cover' ? 'cover' : 'back cover';
  return `The ${name} drew past its page: only its first page is treated as the ${name}`;
}

const hasThinSpace = (item: unknown): item is string => typeof item === 'string' && THIN_SPACE.test(item);

// Strings and arrays of strings are normalized; any other value, or any other item of an array, goes to jsPDF as it
// is, so the wrapped methods stay transparent. Most strings are already clean: the test avoids a replace and an array
// copy on every text call.
function normalizeTextArg<T>(value: T): T {
  if (typeof value === 'string') return (hasThinSpace(value) ? normalizeText(value) : value) as T;
  if (!Array.isArray(value)) return value;
  return (
    value.some(hasThinSpace) ? value.map((item: unknown) => (hasThinSpace(item) ? normalizeText(item) : item)) : value
  ) as T;
}

/**
 * A themed PDF document: fluent methods draw blocks top to bottom, add pages when the content overflows, and export
 * the file.
 *
 * @example
 * ```ts
 * import { writeFileSync } from 'node:fs';
 * import { PDFDocument, presetTheme } from '@mlt-a/jspdf-toolkit';
 *
 * const doc = new PDFDocument({ theme: presetTheme('ocean'), title: 'Invoice INV-042' });
 *
 * doc
 *   .heading('Invoice INV-042')
 *   .paragraph('Thank you for your business.')
 *   .fields([
 *     { label: 'Client', value: 'TechStart Inc.' },
 *     { label: 'Status', value: 'Paid', highlight: true },
 *   ])
 *   .table([{ item: 'Design', total: '$2,750.00' }], {
 *     columns: [
 *       { header: 'Item', key: 'item' },
 *       { header: 'Total', key: 'total', align: 'right' },
 *     ],
 *   });
 *
 * writeFileSync('invoice.pdf', doc.toBuffer());
 * ```
 */
export class PDFDocument {
  /**
   * The raw jsPDF instance (unit `mm`), for drawing the library has no block for; the position does not follow what is
   * drawn on it. The constructor patches it: `addPage` also draws the page decorations (theme color,
   * `background`), the text and measuring methods (`text`, `getTextWidth`, `getTextDimensions`,
   * `getStringUnitWidth`, `splitTextToSize`) turn the thin spaces of a string or an array of strings into no-break
   * spaces and pass any other value to jsPDF as it is, and the default line height factor is the theme's.
   */
  readonly doc: jsPDF;
  /** The `theme` option, its colors normalized and its font families resolved. */
  readonly theme: ResolvedTheme;
  /** Page width (mm), from `format` and `orientation`. */
  readonly pageWidth: number;
  /** Page height (mm), from `format` and `orientation`. */
  readonly pageHeight: number;
  /** The `debug` option: warnings are printed to the console as they are raised. */
  readonly debug: boolean;
  /** @internal Where the content starts and ends on each page. */
  readonly layout: PageLayout;

  // `layout` keeps the page geometry; the frame is what the blocks read, narrowed by a column of `columns`.
  private readonly pageFrame: Frame;
  private frame: Frame;
  private yPos: number;
  // Where the start of the last page left the position, once its `onNewPage` hook ran: where the branches of
  // `parallel` after a page break restart. Read only after a page break: its starting value is never read.
  private startedAt = 0;
  private readonly warningList: string[] = [];
  private state: 'open' | 'finalized' | 'exported' = 'open';
  // Depth of nested `keepTogether` measuring passes. Scratch pages are deleted, so they get no
  // decoration; other side effects are rolled back from a snapshot.
  private measuring = 0;
  // The designed page `pageDecoration` is drawing: a page opened meanwhile is content, with a warning.
  private designing: DesignedPage | null = null;
  private trailing = NO_TRAILING;
  private newPageHook: (() => void) | null = null;
  /** @internal Every image drawn goes through it: decoded, measured and embedded once per image data. */
  readonly images: ImageCache;
  /** @internal Covers, table of contents entries and anchor, kept right when pages move. */
  readonly pageRefs = new PageReferences();
  // Headings that wait for the next block, to move to the next page with it: see `heading`.
  private pendingHeadings: PendingHeading[] = [];
  // Drawn on every new page after the theme background color, but not on designed pages. A later
  // `background(image, { allPages: true })` replaces it.
  private backgroundImage: EmbeddedImage | undefined;
  // `allPages` watermarks: `finalize()` draws them on every page, over everything else.
  private readonly watermarks: Array<() => void> = [];
  private headerOptions: PageHeaderOptions | null = null;
  // `false`: no footer at all.
  private footerOptions: PageFooterOptions | false | null = null;
  private readonly nativeAddPage: jsPDF['addPage'];

  /**
   * Creates an empty document. Every option is optional: A4 portrait, `createTheme()` and Helvetica by default.
   *
   * @example
   * ```ts
   * import { PDFDocument, createTheme } from '@mlt-a/jspdf-toolkit';
   *
   * const doc = new PDFDocument({
   *   theme: createTheme({ colors: { primary: '#0F766E' } }),
   *   format: 'letter',
   *   margins: { left: 15, top: 25 },
   *   title: 'Quarterly review',
   * });
   * ```
   */
  constructor(options: DocumentOptions = {}) {
    checkDocumentOptions(options);
    this.doc = new jsPDF({
      ...resolvePageFormat(options.format, options.orientation),
      unit: 'mm',
      compress: options.compress ?? true,
    });

    // Before anything is drawn: `withDrawingState` reads what jsPDF cannot.
    trackDrawingState(this.doc);
    this.images = new ImageCache(this.doc);

    const fonts = options.fonts ?? [];
    registerFonts(this.doc, fonts);

    this.doc.setProperties({
      title: options.title ?? '',
      author: options.author ?? '',
      subject: options.subject ?? '',
      keywords: options.keywords?.join(', ') ?? '',
      creator: options.creator ?? '',
    });

    this.theme = resolveTheme(options.theme === undefined ? createTheme() : options.theme, fonts);
    this.debug = options.debug ?? false;

    const fontWarning = checkThemeFonts(this.doc, this.theme.typography, fonts);
    if (fontWarning) this.addWarning(fontWarning);

    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();

    const margins = resolveMargins(options.margins);
    validateOptions(options, margins, this.pageWidth, this.pageHeight);
    const contentWidth = this.pageWidth - margins.left - margins.right;
    this.layout = new PageLayout(margins, options.firstPageTop ?? margins.top);
    this.pageFrame = createFrame(this.layout, margins, contentWidth, options.measure ?? contentWidth, false);
    this.frame = this.pageFrame;
    this.yPos = this.layout.topFor(1);

    // Pages also come from jsPDF's own `addPage` and `insertPage` (raw page code, table of contents), which would
    // skip the theme background and the `onNewPage` hook. Patching the instance covers every page source.
    this.nativeAddPage = this.doc.addPage.bind(this.doc);
    this.doc.addPage = ((...args: Parameters<jsPDF['addPage']>) => {
      const result = this.nativeAddPage(...args);
      this.startPage();
      return result;
    }) as jsPDF['addPage'];

    // Single text gateway: primitives and raw page code all get thin spaces normalized, so measuring and drawing
    // see the same string.
    const nativeText = this.doc.text.bind(this.doc);
    const nativeGetTextWidth = this.doc.getTextWidth.bind(this.doc);
    const nativeGetTextDimensions = this.doc.getTextDimensions.bind(this.doc);
    const nativeGetStringUnitWidth = this.doc.getStringUnitWidth.bind(this.doc);
    const nativeSplitTextToSize = this.doc.splitTextToSize.bind(this.doc);
    this.doc.text = ((value: string | string[], ...rest: unknown[]) =>
      (nativeText as (...args: unknown[]) => jsPDF)(normalizeTextArg(value), ...rest)) as jsPDF['text'];
    this.doc.getTextWidth = (value: string) => nativeGetTextWidth(normalizeTextArg(value));
    this.doc.getTextDimensions = ((value: string | string[], ...rest: unknown[]) =>
      (nativeGetTextDimensions as (...args: unknown[]) => ReturnType<jsPDF['getTextDimensions']>)(
        normalizeTextArg(value),
        ...rest,
      )) as jsPDF['getTextDimensions'];
    this.doc.getStringUnitWidth = (value: string, ...rest: unknown[]) =>
      (nativeGetStringUnitWidth as (...args: unknown[]) => number)(normalizeTextArg(value), ...rest);
    this.doc.splitTextToSize = (value: string, ...rest: unknown[]) =>
      (nativeSplitTextToSize as (...args: unknown[]) => string[])(normalizeTextArg(value), ...rest);
    // Raw `doc.text` calls space multi-line text like the primitives do.
    this.doc.setLineHeightFactor(this.theme.typography.lineHeightFactor);

    this.paintBackgroundColor();
  }

  // === Layout ===

  /**
   * Page margins (mm), resolved: `top` is the top of the content on the pages after the first, widened to clear a
   * declared `pageHeader`; `bottom` is the height of the footer zone. Inside a column of `columns` or an `inset`, `left`
   * and `right` are the edges of that frame. One frozen object per frame, kept across reads: its `top` follows a
   * `pageHeader` declared after it was read; spread it for a copy.
   *
   * @group Layout
   *
   * @example
   * ```ts
   * const { left, right } = doc.margins;
   * doc.doc.line(left, 50, doc.pageWidth - right, 50);
   * ```
   */
  get margins(): Readonly<Margins> {
    return this.frame.margins;
  }

  /**
   * Width (mm) between the left and right margins. Inside a column of `columns` or an `inset`: its width.
   *
   * @group Layout
   *
   * @example
   * ```ts
   * doc.doc.rect(doc.margins.left, doc.getYPos(), doc.contentWidth, 10);
   * ```
   */
  get contentWidth(): number {
    return this.frame.contentWidth;
  }

  /**
   * Reading column width (mm): the `measure` option, or `contentWidth`. Inside a column of `columns`: its width, or the
   * measure of the frame around it when that is narrower. Inside an `inset`: the same, except that a `width` given to
   * the inset is its measure.
   *
   * @group Layout
   *
   * @example
   * ```ts
   * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
   *
   * const doc = new PDFDocument({ measure: 120 });
   * doc.paragraph('Wrapped to 120 mm.'); // doc.measure === 120
   * ```
   */
  get measure(): number {
    return this.frame.measure;
  }

  /**
   * A frame `width` mm wide from `left` (mm from the page edge) inside the current one, reading `measure` (mm), over the
   * same footer zone. `branch` tells whether it is a branch of `parallel`.
   */
  private childFrame(left: number, width: number, measure: number, branch: boolean): Frame {
    const right = this.pageWidth - left - width;
    const { bottom } = this.frame.margins;
    return createFrame(this.layout, { left, right, bottom }, width, measure, branch);
  }

  /** Runs `draw` in `frame`, and puts the current frame back after it, even when `draw` throws. */
  private inFrame<T>(frame: Frame, draw: () => T): T {
    const outer = this.frame;
    this.frame = frame;
    try {
      return draw();
    } finally {
      this.frame = outer;
    }
  }

  /**
   * @internal Runs `draw` in the page frame: what is declared or drawn at the scale of the page (decorations, running
   * header and footer, covers, table of contents, a logo placed from its page corner) has the page geometry, even when
   * it is called from a column. It is one drawing scope: called from a column or on its own, it leaves the same bytes.
   */
  inPageFrame<T>(draw: () => T): T {
    return this.inFrame(this.pageFrame, () => withDrawingState(this, draw));
  }

  /**
   * Top of the content (mm) on the first page: the `firstPageTop` option (default: the `margins.top` option), lowered
   * under a `pageHeader` declared while the page was still empty.
   *
   * @group Layout
   *
   * @example
   * ```ts
   * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
   *
   * const doc = new PDFDocument({ firstPageTop: 60 }); // room for a letterhead
   * doc.getYPos(); // 60
   * ```
   */
  get firstPageTop(): number {
    return this.layout.topFor(1);
  }

  /** @internal Number of the page the drawing goes to. */
  get pageNumber(): number {
    return this.doc.getCurrentPageInfo().pageNumber;
  }

  /** @internal Whether the position is at the top of the current page: nothing drawn on it yet. */
  atPageTop(): boolean {
    return this.yPos <= this.layout.topFor(this.pageNumber);
  }

  /**
   * Current position (mm). Places the headings waiting for the next block first, where they stand.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * const y = doc.getYPos();
   * doc.doc.line(doc.margins.left, y, doc.margins.left + 40, y);
   * ```
   */
  getYPos(): number {
    this.flushPendingHeadings();
    return this.yPos;
  }

  /**
   * @internal Current position without placing the waiting headings. For primitives that call `ensureSpace` right
   * after: reading the position through `getYPos` first would place the headings where they stand and defeat
   * keep-with-next.
   */
  peekYPos(): number {
    return this.yPos;
  }

  /**
   * Moves the position to `y` (mm from the top of the current page). The next block starts there, without collapsing.
   * Throws an `InvalidOptionError` for a `y` that is not a finite number.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * doc.setYPos(120).paragraph('Starts 120 mm from the top of the page.');
   * ```
   */
  setYPos(y: number): this {
    checkedNumber('setYPos y (mm)', y);
    this.flushPendingHeadings();
    this.yPos = y;
    this.trailing = NO_TRAILING;
    return this;
  }

  /**
   * Adds vertical space (mm), on top of the space the previous block left: it does not collapse. Ignored at the top of
   * a page. Pick the amount from `SPACING`. Throws an `InvalidOptionError` for an amount that is not a finite number.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * import { SPACING } from '@mlt-a/jspdf-toolkit';
   *
   * doc.paragraph('Before.').addSpace(SPACING.xlarge).paragraph('After, 8 mm lower than usual.');
   * ```
   */
  addSpace(mm: number): this {
    checkedNumber('addSpace (mm)', mm);
    this.flushPendingHeadings();
    if (this.atPageTop()) return this;
    this.yPos += mm;
    this.trailing = NO_TRAILING;
    return this;
  }

  /**
   * Opens a block that asks for `spaceBefore` mm above it: adds what the space left by the previous block does not
   * already cover, so the larger of the two separates them. Nothing at the top of a page. Call it after `ensureSpace`.
   * Returns the position.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * import { SPACING } from '@mlt-a/jspdf-toolkit';
   *
   * // A custom block that asks for 8 mm above it, like a heading does.
   * doc.ensureSpace(20);
   * const y = doc.beginBlock(SPACING.xlarge);
   * doc.doc.rect(doc.margins.left, y, doc.contentWidth, 12);
   * doc.endBlock(y + 12, doc.theme.spacing.block);
   * ```
   */
  beginBlock(spaceBefore: number): number {
    this.flushPendingHeadings();
    const gap = this.spaceAbove(spaceBefore);
    this.yPos += gap;
    // A block opened here attaches to nothing.
    this.trailing = { space: this.trailing.space + gap };
    return this.yPos;
  }

  /**
   * @internal Space (mm) a block asking for `spaceBefore` adds above it: what `trailing`, the space the block above
   * left under it, does not cover. Without `trailing`, the block opens at the position: none at the top of a page.
   */
  spaceAbove(spaceBefore: number, trailing?: number): number {
    if (trailing === undefined) {
      if (this.atPageTop()) return 0;
      trailing = this.trailing.space;
    }
    // A negative space under a block covers nothing, as `endBlock` keeps it.
    return Math.max(0, spaceBefore - Math.max(0, trailing));
  }

  /**
   * Space (mm) a block leaves under it: `spaceAfter`, else `fallback`, else `theme.spacing.block`. `endBlock` applies
   * it; a block reads it here before drawing anything, to reserve it with `ensureSpace`. A negative space is taken: it
   * pulls the next block up and covers none of the space that block asks above it. Throws an `InvalidOptionError` for a
   * `spaceAfter` that is not a finite number.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * // A custom block with a `spaceAfter` option: read the space first, reserve it, then close the block with it.
   * function drawRule(spaceAfter?: number): void {
   *   const after = doc.resolveSpaceAfter(spaceAfter);
   *   doc.ensureSpace(1 + after);
   *   const y = doc.getYPos();
   *   doc.doc.line(doc.margins.left, y, doc.margins.left + doc.contentWidth, y);
   *   doc.endBlock(y + 1, after);
   * }
   * drawRule();
   * ```
   */
  resolveSpaceAfter(spaceAfter?: number, fallback?: number): number {
    if (spaceAfter === undefined) return fallback ?? this.theme.spacing.block;
    return checkedNumber('spaceAfter (mm)', spaceAfter);
  }

  /**
   * Closes a block: moves the position to `y`, the bottom of what was drawn, and leaves `spaceAfter` mm under it
   * (default: `theme.spacing.block`). That space collapses with the `spaceBefore` of the next block (see
   * `beginBlock`). Every flow primitive ends with it. Returns the new position. It does not place a waiting heading:
   * a block calls `ensureSpace` (or reads `getYPos`) before drawing.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * // A custom block: reserve the room, draw from the position, close the block.
   * const height = 12;
   * doc.ensureSpace(height + doc.theme.spacing.block);
   * const y = doc.getYPos();
   * doc.doc.rect(doc.margins.left, y, doc.contentWidth, height);
   * doc.endBlock(y + height, doc.theme.spacing.block);
   * ```
   */
  endBlock(y: number, spaceAfter?: number): number;
  /**
   * @internal Closes a block whose default space is `fallback`, and of `kind` when the next block may attach to it
   * (`attachTo`). `spaceAfter` is the option as the caller gave it: a space the caller chose is kept, and nothing
   * attaches to it.
   */
  endBlock(y: number, spaceAfter: number | undefined, block: { kind?: BlockKind; fallback?: number }): number;
  endBlock(y: number, spaceAfter?: number, { kind, fallback }: { kind?: BlockKind; fallback?: number } = {}): number {
    const space = this.resolveSpaceAfter(spaceAfter, fallback);
    this.yPos = y + space;
    const trailing = Math.max(0, space);
    const attachable = kind !== undefined && spaceAfter === undefined;
    this.trailing = attachable ? { space: trailing, block: { kind, frame: this.frame } } : { space: trailing };
    return this.yPos;
  }

  /**
   * @internal `ensureSpace(requiredHeight)` for a block that attaches to the block above it when that one is a `kind`
   * closed in the current frame. The room asked for counts the move, then the position moves up to `gap` mm under
   * that block. Returns the space that block left, for the new block to leave in its place, or `undefined` when
   * nothing was attached. It never moves down: a block that left less than `gap` keeps its space. Never at the top of
   * a page: a new page forgets the block above.
   */
  attachTo(kind: BlockKind, gap: number, requiredHeight: number): number | undefined {
    const above = this.attachableAbove();
    const pull = above?.kind === kind && above.frame === this.frame ? above.space - Math.min(gap, above.space) : 0;
    this.ensureSpace(requiredHeight - pull);
    // Read again: the waiting headings are placed, and a page break forgets the block above.
    const { space, block } = this.trailing;
    if (block?.kind !== kind || block.frame !== this.frame) return undefined;
    const kept = Math.min(gap, space);
    this.yPos += kept - space;
    this.trailing = { space: kept };
    return space;
  }

  /** What the next block will find above it once the waiting headings are placed, when it may be attached to. */
  private attachableAbove(): { kind: BlockKind; frame: Frame; space: number } | undefined {
    const waiting = this.pendingHeadings.at(-1);
    if (waiting === undefined) return this.trailing.block && { ...this.trailing.block, space: this.trailing.space };
    const { spaceAfter, resolvedSpaceAfter } = waiting.options;
    return spaceAfter === undefined ? { kind: 'heading', frame: waiting.frame, space: resolvedSpaceAfter } : undefined;
  }

  /**
   * Puts the flow back as it stood: the position at `y`, under the block above that left `trailing`. For what draws
   * several times from the same place (`parallel`, measuring passes).
   */
  private restoreFlow(y: number, trailing: Trailing): void {
    this.yPos = y;
    this.trailing = trailing;
  }

  /** @internal Bottom of the last block drawn: the position, less the space that block left under it. */
  contentBottom(): number {
    return this.yPos - this.trailing.space;
  }

  /**
   * @internal Draws `branches` side by side, each in its frame, whose `margins`, `contentWidth` and `measure` the
   * blocks read. Every branch starts where the flow stands, as the block above left it: its first heading collapses
   * into that space. A branch that runs onto a new page raises a warning, and the branches after it start where the
   * start of that page left the position. A heading that ends a branch is drawn in it.
   *
   * Returns the bottom (mm) of the lowest branch on the last page, without the space its last block left under it,
   * for the caller to close the block. Returns `undefined` when no branch drew in the flow: the flow then stands as
   * it did.
   */
  parallel(branches: readonly ParallelBranch[]): number | undefined {
    // Headings waiting above the branches are drawn where they stand, across the frame around them.
    this.flushPendingHeadings();
    let page = this.pageNumber;
    // Where a branch starts on `page`, and what the block above it left. A branch has a frame of its own: nothing
    // in it attaches to that block.
    let startY = this.yPos;
    let start = this.trailing;
    // Pages only grow: the lowest bottom on the last page is all that is kept.
    let bottom = startY;
    for (const { left, width, draw } of branches) {
      this.inFrame(this.childFrame(left, width, Math.min(width, this.frame.measure), true), () => {
        this.restoreFlow(startY, start);
        draw();
        this.flushPendingHeadings();
      });
      if (this.pageNumber !== page) {
        page = this.pageNumber;
        startY = this.startedAt;
        start = NO_TRAILING;
        bottom = startY;
      }
      // A branch that draws nothing in the flow ends where it started: the bottom never moves above the start.
      bottom = Math.max(bottom, this.contentBottom());
    }
    if (bottom !== startY) return bottom;
    this.restoreFlow(startY, start);
    return undefined;
  }

  /**
   * Breaks the page when less than `requiredHeight` is left. Headings waiting for the next block are placed first,
   * on the next page when they and `requiredHeight` do not fit: call it with the first line of a block before
   * drawing it. `lead` is what the caller draws at the top of the new page before the block when the page breaks,
   * such as a repeated table header. Returns whether a page break happened. Throws an `InvalidOptionError` for a
   * `requiredHeight` that is not a finite number, or a `lead` that is not a finite number of 0 or more.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * doc.ensureSpace(40); // breaks the page when less than 40 mm is left
   * const y = doc.getYPos();
   * doc.doc.rect(doc.margins.left, y, doc.contentWidth, 40);
   * doc.endBlock(y + 40, doc.theme.spacing.block);
   *
   * // A 20 mm block that repeats a 6 mm title when it starts a page: `lead` counts it for the too-tall-block warning.
   * doc.ensureSpace(20, { lead: 6 });
   * ```
   */
  ensureSpace(requiredHeight: number, options?: EnsureSpaceOptions): boolean {
    checkedNumber('ensureSpace requiredHeight (mm)', requiredHeight);
    if (options !== undefined) optionalNumber('ensureSpace lead (mm)', options.lead, { min: 0 });
    const pageBefore = this.pageNumber;
    this.placePendingHeadings(requiredHeight);
    this.breakIfShort(requiredHeight);
    const pageBreak = this.pageNumber !== pageBefore;
    const height = requiredHeight + (pageBreak ? (options?.lead ?? 0) : 0);
    const usableHeight = this.usableHeight();
    if (height > usableHeight) {
      // No page break can make room: the block will overflow, so say so instead of failing silently.
      this.addWarning(
        `Block of ${height.toFixed(1)} mm is taller than the usable page height ` +
          `(${usableHeight.toFixed(1)} mm) and may be clipped`,
      );
    }
    return pageBreak;
  }

  private usableHeight(): number {
    return this.layout.bottom(this.pageHeight) - this.layout.topFor(2);
  }

  private breakIfShort(height: number): boolean {
    // At the top of a page a break would only leave a blank page behind.
    if (this.atPageTop()) return false;
    if (this.layout.bottom(this.pageHeight) - this.yPos >= height) return false;
    this.addPage();
    return true;
  }

  /**
   * Draws the waiting headings with `next` mm of the following block under them: the page breaks first when they
   * do not fit. Headings taller than a page together cannot be kept: each then breaks on its own.
   */
  private placePendingHeadings(next: number): void {
    const chain = this.takePendingHeadings();
    if (chain.length === 0) return;
    const height = this.chainHeight(chain) + next;
    if (height <= this.usableHeight()) this.breakIfShort(height);
    for (const heading of chain) this.drawPendingHeading(heading);
  }

  /**
   * @internal Draws the waiting headings where they stand, before anything that moves or draws outside `ensureSpace`.
   */
  flushPendingHeadings(): void {
    for (const heading of this.takePendingHeadings()) this.drawPendingHeading(heading);
  }

  /** Draws a waiting heading in the frame it was called in, whatever frame the block that places it is in. */
  private drawPendingHeading({ text, options, frame }: PendingHeading): void {
    this.inFrame(frame, () => drawHeading(this, text, options));
  }

  /** Detached first: the page break and the drawing that follow must not place the headings again. */
  private takePendingHeadings(): PendingHeading[] {
    const chain = this.pendingHeadings;
    // Called on every `ensureSpace`: nothing waits most of the time, and nothing is allocated then.
    if (chain.length === 0) return chain;
    this.pendingHeadings = [];
    return chain;
  }

  /** Height of the headings drawn from the current position, as `drawHeading` reserves each one. */
  private chainHeight(chain: PendingHeading[]): number {
    let height = 0;
    let trailing: number | undefined;
    for (const { text, options, frame } of chain) {
      const own = this.inFrame(frame, () => headingHeight(this, text, options));
      height += this.spaceAbove(options.spaceBefore, trailing) + own + options.resolvedSpaceAfter;
      trailing = options.resolvedSpaceAfter;
    }
    return height;
  }

  /**
   * Keeps a block together on one page when possible.
   *
   * Uses a draw-twice pattern: the callback is first invoked on a scratch page, from the current position, to see
   * whether it fits there. When it does not, a second scratch pass from the top of a page tells whether a page break
   * makes it fit; a block taller than a page is drawn with normal pagination. Then the callback is invoked again for
   * real. Measuring from the current position keeps the space before a heading, which a page top would collapse.
   * Headings waiting for the next block are part of the block. Cover marks, warnings and table of contents entries
   * written while measuring are rolled back; any other side effect of the callback (counters, external mutations,
   * array pushes, etc.) must be idempotent.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * doc.keepTogether(() => {
   *   doc.heading('Approval', { level: 'h2' }).signatureZone([{ label: 'Client' }, { label: 'Supplier' }]);
   * });
   * ```
   */
  keepTogether(draw: () => void): this {
    this.checkNotFinalized();
    checkedFunction('keepTogether draw', draw);
    // At the top of a page a break gains nothing: skip the measuring passes. A block that fits where it stands costs
    // one pass; a break is only worth it when the block fits on a page of its own.
    if (
      !this.atPageTop() &&
      !this.fitsOnOnePage(draw, this.yPos, this.trailing) &&
      this.fitsOnOnePage(draw, this.layout.topFor(2), NO_TRAILING)
    ) {
      // The waiting headings move with the block: hidden from the `onNewPage` hook, which may read the position.
      const waiting = this.takePendingHeadings();
      this.doc.addPage();
      this.pendingHeadings = waiting;
    }
    draw();
    return this;
  }

  /**
   * Lays out the blocks `draw` adds in a frame narrowed inside the current one: `margins`, `contentWidth` and `measure`
   * read the inset while `draw` runs, and the current frame comes back after it, even when `draw` throws. The options
   * are in mm from the edges of the current frame (the page, a column, another inset), so insets nest and compose
   * with `columns`. The flow runs on: the position and the space left above carry in and out, and a page break inside
   * goes on in the inset without a warning. A `width` given is also the `measure` of the inset, wider than the `measure`
   * option of the document if need be. A heading keeps the frame it was called in: one called just before spans
   * the frame around the inset and stays with its first block. Throws an `InvalidOptionError` for an option out of its
   * bounds, for `left`, `right` and `width` together, or for `left` and `right` that leave no width.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * doc.inset({ left: 20 }, () => {
   *   doc.paragraph('Indented 20 mm, wrapped to the narrower frame.');
   * });
   * doc.inset({ right: 0, width: 80 }, () => {
   *   doc.infoBox('Bank transfer, 30 days net.', { title: 'Payment' });
   * });
   * ```
   */
  inset(options: InsetOptions, draw: () => void): this {
    this.checkNotFinalized();
    checkedFunction('inset draw', draw);
    const { left, width, measure } = resolveInset(this, options);
    this.inFrame(this.childFrame(this.margins.left + left, width, measure, this.frame.branch), draw);
    return this;
  }

  /** Draws `draw` on a scratch page from `startY` and tells whether it ended on that page, within the content area. */
  private fitsOnOnePage(draw: () => void, startY: number, trailing: Trailing): boolean {
    const pageCount = this.doc.getNumberOfPages();
    const restore = this.snapshot();
    this.measuring++;
    try {
      this.doc.addPage();
      this.restoreFlow(startY, trailing);
      draw();
      // The space the last block leaves under it may run past the bottom: only what is drawn has to fit.
      return (
        this.doc.getNumberOfPages() === pageCount + 1 && this.contentBottom() <= this.layout.bottom(this.pageHeight)
      );
    } finally {
      this.measuring--;
      restore();
    }
  }

  /**
   * Captures the pages and what a measuring pass may record about the document. The returned function deletes the
   * pages added since, goes back to the current page and puts the rest back.
   */
  private snapshot(): () => void {
    // The current page is not necessarily the last one: new pages go after the last page.
    const startPage = this.pageNumber;
    const pageCount = this.doc.getNumberOfPages();
    const { yPos, trailing } = this;
    const pending = [...this.pendingHeadings];
    const warningCount = this.warningList.length;
    const pages = this.pageRefs.mark();
    const layout = this.layout.mark();
    const headerOptions = this.headerOptions;
    return () => {
      // Deleted without `removePage`: the page references are put back below, not shifted.
      for (let page = this.doc.getNumberOfPages(); page > pageCount; page--) this.doc.deletePage(page);
      this.doc.setPage(startPage);
      this.restoreFlow(yPos, trailing);
      this.pendingHeadings = pending;
      this.warningList.length = warningCount;
      this.pageRefs.rollback(pages);
      this.layout.rollback(layout);
      this.headerOptions = headerOptions;
    };
  }

  /**
   * Starts a new page. `blank: true` makes it a designed page, for pages that paint themselves (back cover).
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * doc.addPage().heading('Appendix');
   * ```
   */
  addPage(options?: AddPageOptions): this {
    this.checkNotFinalized();
    const blank = optionalBoolean('addPage blank', options?.blank) === true;
    this.flushPendingHeadings();
    if (blank) {
      this.nativeAddPage();
      this.startPage(true);
    } else {
      // The patched `doc.addPage` starts the page, so it is decorated exactly once.
      this.doc.addPage();
    }
    return this;
  }

  // Runs for every page jsPDF creates, whoever asks for it.
  private startPage(blank = false): void {
    // jsPDF writes the stroke color, line width, cap and join it keeps at the top of a new page, but not the fill.
    restateFillColor(this.doc);
    this.yPos = this.layout.topFor(2);
    this.trailing = NO_TRAILING;
    // Scratch pages of a measuring pass are deleted: they get no decoration, hook or warning, but `parallel` still
    // restarts the branches that follow from the top of the page it broke.
    if (this.measuring === 0) {
      // A page broken from inside a branch of `parallel` is decorated, and its hook run, with the page geometry.
      this.inPageFrame(() => this.decoratePage(blank));
    }
    this.startedAt = this.yPos;
    // Raised here, where the page breaks: once for nested branches. Pages `finalize` inserts are in the page frame.
    if (this.measuring === 0) {
      if (this.frame.branch) this.addWarning(BRANCH_PAGE_BREAK_WARNING);
      if (this.designing !== null) this.addWarning(designedPageOverflowWarning(this.designing));
      else if (this.pageRefs.backCover !== undefined && this.pageNumber > this.pageRefs.backCover) {
        this.addWarning(
          `A page was added after the back cover (page ${this.pageRefs.backCover}): the back cover is no longer the ` +
            'last page; call backCover() last',
        );
      }
    }
  }

  // The primitive that broke the page goes on with its own style: nothing drawn here may leak to it.
  private decoratePage(blank: boolean): void {
    withDrawingState(this, () => {
      this.paintBackgroundColor();
      // A blank page paints itself: no `allPages` image.
      if (this.backgroundImage !== undefined && !blank) {
        drawBackgroundImage(this, this.backgroundImage);
      }
      // Only a page added after `finalize()` is marked under its content: nothing runs after it.
      if (this.state !== 'open') for (const draw of this.watermarks) draw();
      if (blank) return;
      // The hook always starts from the same known text style, not from the one the primitive measured with.
      setTextStyle(this, 'body');
      this.newPageHook?.();
    });
  }

  /** Runs `draw` on every existing page, then goes back to the current one. */
  private onExistingPages(draw: (page: number) => void): void {
    const current = this.pageNumber;
    try {
      for (let page = 1; page <= this.doc.getNumberOfPages(); page++) {
        this.doc.setPage(page);
        draw(page);
      }
    } finally {
      // Also when `draw` throws: jsPDF must not be left on another page.
      this.doc.setPage(current);
    }
  }

  /**
   * Runs `callback` on every new page, after its decorations: content pages, table continuation and table of
   * contents pages. Not on pages added with `blank: true` (back cover). Only one callback is kept: a new call
   * replaces the previous one.
   * The callback starts from the `body` text style. The fill and draw colors, line width, cap and join it finds are
   * the ones jsPDF reports, in force on the page: on a theme with a background color, the fill is that color. What
   * it changes is undone after it, so the content that follows is drawn as if the callback had not run.
   *
   * @group Flow control
   *
   * @example
   * ```ts
   * doc.onNewPage(() => {
   *   doc.doc.setFontSize(7);
   *   doc.doc.text('Draft', doc.margins.left, 8);
   * });
   * ```
   */
  onNewPage(callback: () => void): this {
    checkedFunction('onNewPage callback', callback);
    this.newPageHook = callback;
    return this;
  }

  // === Document state ===

  /** @internal Records a warning for `warnings`, printed in `debug` mode. */
  addWarning(message: string): void {
    // A primitive drawn in a loop would otherwise repeat the same warning for every item.
    if (this.warningList.includes(message)) return;
    this.warningList.push(message);
    // A measuring pass rolls its warnings back and the real pass raises them again: print only once.
    if (this.debug && this.measuring === 0) {
      console.warn(message);
    }
  }

  /**
   * Problems met while drawing (unreadable images, overflowing blocks, missing font faces…), each listed once.
   *
   * @group Export
   *
   * @example
   * ```ts
   * const bytes = doc.toBuffer();
   * for (const warning of doc.warnings) console.warn(warning);
   * ```
   */
  get warnings(): readonly string[] {
    return [...this.warningList];
  }

  /**
   * Names `image` (data URI or raw base64) for every image option: `icon`, `logo`, `image`, `background`, the footer
   * logo, signatures. Every use then refers to the same embedded image. An image that cannot be read is recorded as
   * a warning; a name already registered keeps its first image, with a warning when the new one differs.
   *
   * @group Images
   *
   * @example
   * ```ts
   * import { loadImageFromPath } from '@mlt-a/jspdf-toolkit/node';
   *
   * doc.registerImage('logo', loadImageFromPath('./logo.png'));
   * doc.logo('logo', { height: 12 });
   * ```
   */
  registerImage(name: string, image: string): this {
    this.checkNotFinalized();
    // A value that is no string is a wrong call, not an image that cannot be read: it is no warning.
    checkedText('registerImage name', name);
    checkedText(`registerImage image "${name}"`, image);
    try {
      if (this.images.register(name, image) === 'conflict') {
        this.addWarning(`Image "${name}" is already registered: the first image is kept, the new one is ignored`);
      }
    } catch (error) {
      this.addWarning(`Failed to register image "${name}": ${errorMessage(error)}`);
    }
    return this;
  }

  /**
   * `registerImage` for each entry, keyed by name.
   *
   * @group Images
   *
   * @example
   * ```ts
   * doc.registerImages({ logo: logoDataUri, star: starDataUri });
   * doc.iconList(['Verified', 'Insured'], { icon: 'star' });
   * ```
   */
  registerImages(images: Record<string, string>): this {
    // Every entry is checked before the first one is registered.
    const entries = Object.entries(checkedObject('registerImages images', images));
    for (const [name, image] of entries) checkedText(`registerImages image "${name}"`, image);
    for (const [name, image] of entries) this.registerImage(name, image);
    return this;
  }

  /**
   * Draws `image` (a registered name or image data) across the page width, anchored to the bottom of the page and
   * shifted by `theme.assets.backgroundOffsetY`. Call it before the page content so the content renders on top: on a
   * page that already has content, the image is drawn over it, with a warning. `allPages: true` also draws it on every
   * page added after this one, blank pages excepted.
   *
   * @group Images
   *
   * @example
   * ```ts
   * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
   *
   * const doc = new PDFDocument();
   * doc.registerImage('letterhead', letterheadDataUri);
   * doc.background('letterhead', { allPages: true }).heading('Drawn over the letterhead');
   * ```
   */
  background(image: string, options?: BackgroundOptions): this {
    this.checkNotFinalized();
    checkedText('background image', image);
    const allPages = optionalBoolean('background allPages', options?.allPages) === true;
    // The image is painted where it is called: over what the flow already drew on the page.
    if (!this.atPageTop()) {
      this.addWarning(
        `background() called on page ${this.pageNumber} after content: the image is drawn over it; ` +
          'call background() before the content of the page',
      );
    }
    const embedded = this.inPageFrame(() => drawBackgroundImage(this, image));
    // An unreadable image is reported once, here, not again on every new page. A measuring pass registers nothing:
    // the real pass does.
    if (allPages && embedded !== undefined && this.measuring === 0) this.backgroundImage = embedded;
    return this;
  }

  private paintBackgroundColor(): void {
    const { background } = this.theme.colors;
    // A fresh jsPDF page is already white.
    if (background === '#FFFFFF') return;
    this.doc.setFillColor(background);
    this.doc.rect(0, 0, this.pageWidth, this.pageHeight, 'F');
  }

  /**
   * Physical page number of the cover, tracked when it is drawn rather than assumed to be 1.
   *
   * @group Layout
   *
   * @example
   * ```ts
   * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
   *
   * const doc = new PDFDocument();
   * doc.cover('Annual report', { variant: 'wave' });
   * doc.coverPage; // 1
   * ```
   */
  get coverPage(): number | undefined {
    return this.pageRefs.cover;
  }

  /**
   * Physical page number of the back cover, tracked rather than assumed to be the last page.
   *
   * @group Layout
   *
   * @example
   * ```ts
   * doc.backCover();
   * doc.backCoverPage; // the last page
   * ```
   */
  get backCoverPage(): number | undefined {
    return this.pageRefs.backCover;
  }

  /**
   * Number printed on each page that gets a page number and footer, by physical page, in page order: every page but
   * the cover and the back cover, counted from 1.
   *
   * @group Layout
   *
   * @example
   * ```ts
   * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
   *
   * const doc = new PDFDocument();
   * doc.cover('Report', { variant: 'wave' }).paragraph('First numbered page.');
   * doc.pageLabels; // Map { 2 => 1 }: physical page 2 is printed as page 1
   * ```
   */
  get pageLabels(): Map<number, number> {
    const pages = this.pageRefs.numberedPages(this.doc.getNumberOfPages());
    return new Map(pages.map((page, index) => [page, index + 1]));
  }

  // === Page insertion ===

  /**
   * @internal Inserts `count` decorated pages right after `afterPage` and shifts every page reference past it (covers,
   * table of contents entries), so page numbers stay right. Used by the table of contents when it overflows.
   * A count of zero or less does nothing.
   */
  insertPagesAfter(afterPage: number, count: number): void {
    // Nothing to insert, and a negative count would shift the references without any page behind them.
    if (count <= 0) return;
    // Shifted first: a page inserted before the back cover must not read as one added after it.
    this.pageRefs.shift(afterPage, count);
    for (let index = 0; index < count; index++) {
      const target = afterPage + 1 + index;
      // The `onNewPage` hook runs while the page is still the last one: a watermark it records follows the page.
      const recorded = this.pageRefs.watermarkCount;
      this.doc.insertPage(target);
      this.pageRefs.moveWatermarksSince(recorded, target);
    }
  }

  /** @internal Deletes a page and shifts every page reference past it, the reverse of `insertPagesAfter`. */
  removePage(page: number): void {
    this.doc.deletePage(page);
    this.pageRefs.drop(page);
  }

  // Content drawn after finalize() misses page numbers and footers.
  private checkNotFinalized(): void {
    if (this.state === 'open') return;
    this.addWarning(
      'Drawing after finalize(): page numbers and footers are already rendered and do not account for new content',
    );
  }

  // === Text ===

  /**
   * Heading drawn with the block that follows it: it waits for that block's first `ensureSpace`, and both move to
   * the next page when they do not fit (see `keepWithNext`). A long title wraps to the reading column; the table of
   * contents lists it whole. Anything that moves the position or draws outside the
   * flow places it first, where it stands: `getYPos`, `setYPos`, `addSpace`, `addPage`, `columns`, export. A heading
   * keeps the frame it was called in: one that ends a column is drawn in that column, one called before an `inset`
   * spans the frame around it.
   *
   * @group Text
   *
   * @example
   * ```ts
   * doc.heading('Annual report'); // h1
   * doc.heading('Scope', { level: 'h2', number: '2.1', rule: true });
   * ```
   */
  heading(text: string, options?: HeadingOptions): this {
    this.checkNotFinalized();
    checkedText('heading text', text);
    const resolved = resolveHeadingOptions(this, options);
    // Laid out once now: a number that leaves the title no width throws here, not where the heading is placed.
    headingHeight(this, text, resolved);
    this.pendingHeadings.push({ text, options: resolved, frame: this.frame });
    // Drawn now, still with the headings waiting above it.
    if (options?.keepWithNext === false) this.placePendingHeadings(0);
    return this;
  }

  /**
   * Plain text wrapped to the reading column. Stars are literal; use `richText` for emphasis.
   *
   * @group Text
   *
   * @example
   * ```ts
   * doc.paragraph('Plain text.\nA new line starts a new line.', { align: 'justify' });
   * doc.paragraph('A note.', { level: 'smallMuted' });
   * ```
   */
  paragraph(text: string, options?: ParagraphOptions): this {
    this.checkNotFinalized();
    drawParagraph(this, text, options);
    return this;
  }

  /**
   * Several paragraphs, spaced by `itemSpacing`, then `spaceAfter` like `paragraph`.
   *
   * @group Text
   *
   * @example
   * ```ts
   * doc.paragraphs(['First paragraph.', 'Second paragraph.']);
   * ```
   */
  paragraphs(texts: string[], options?: ParagraphsOptions): this {
    this.checkNotFinalized();
    drawParagraphs(this, texts, options);
    return this;
  }

  /**
   * Prose with inline emphasis: `**bold**`, `*italic*`, nested, `\*` for a literal star. Paragraphs are
   * separated by a blank line. Unlike `paragraph`, stars are markup: escape one that could pair up.
   *
   * @group Text
   *
   * @example
   * ```ts
   * doc.richText('Payment is due within **30 days**. *Late fees apply.*\n\nA blank line starts a new paragraph.');
   * ```
   */
  richText(markup: string, options?: RichTextOptions): this {
    this.checkNotFinalized();
    drawRichText(this, markup, options);
    return this;
  }

  /**
   * Rich paragraphs and lists built as data: runs with `bold`, `italic` and `link` (a hyperlink).
   *
   * @group Text
   *
   * @example
   * ```ts
   * doc.richBlocks([
   *   { type: 'paragraph', runs: [{ text: 'Terms: ' }, { text: 'net 30', bold: true }] },
   *   { type: 'bulletList', items: [[{ text: 'See ' }, { text: 'our site', link: 'https://example.com' }]] },
   * ]);
   * ```
   */
  richBlocks(blocks: RichBlock[], options?: RichTextOptions): this {
    this.checkNotFinalized();
    drawRichBlocks(this, blocks, options);
    return this;
  }

  // === Sections ===

  /**
   * Horizontal rule across the content area.
   *
   * @group Text
   *
   * @example
   * ```ts
   * doc.paragraph('Above.').separator().paragraph('Below.');
   * doc.separator({ color: 'primary', lineWidth: 0.4 });
   * ```
   */
  separator(options?: SeparatorOptions): this {
    this.checkNotFinalized();
    drawSeparator(this, options);
    return this;
  }

  // === Lists ===

  /**
   * Bulleted list. An item can carry sub-items and a detail line.
   *
   * @group Lists
   *
   * @example
   * ```ts
   * doc.bulletList([
   *   'Plain item',
   *   { text: 'With sub-items', subItems: ['One', 'Two'] },
   *   { text: 'With detail', detail: 'Muted line under the item' },
   * ]);
   * ```
   */
  bulletList(items: ListItem[], options?: ListOptions): this {
    this.checkNotFinalized();
    drawBulletList(this, items, options);
    return this;
  }

  /**
   * Numbered list. An item can carry sub-items and a detail line.
   *
   * @group Lists
   *
   * @example
   * ```ts
   * doc.numberedList(['Sign the contract', 'Pay the deposit', { text: 'Start', subItems: ['Kick-off call'] }]);
   * ```
   */
  numberedList(items: ListItem[], options?: ListOptions): this {
    this.checkNotFinalized();
    drawNumberedList(this, items, options);
    return this;
  }

  /**
   * List whose bullets are an image (`icon`: a registered name or image data).
   *
   * @group Lists
   *
   * @example
   * ```ts
   * doc.registerImage('star', starDataUri);
   * doc.iconList(['Verified', 'Insured'], { icon: 'star' });
   * ```
   */
  iconList(items: ListItem[], options: IconListOptions): this {
    this.checkNotFinalized();
    drawIconList(this, items, options);
    return this;
  }

  // === Form elements ===

  /**
   * Checkbox with its label: empty, checked or crossed (`variant`).
   *
   * @group Fields and forms
   *
   * @example
   * ```ts
   * doc
   *   .checkbox('Terms accepted', { variant: 'checked' })
   *   .checkbox('Newsletter')
   *   .checkbox('Rejected', { variant: 'cross' });
   * ```
   */
  checkbox(label: string, options?: CheckboxOptions): this {
    this.checkNotFinalized();
    drawCheckbox(this, label, options);
    return this;
  }

  /**
   * Question on the left, an answer box (`variant`) and the `answer` text right-aligned on the reading column.
   *
   * @group Fields and forms
   *
   * @example
   * ```ts
   * doc.inlineQuestion('Is the audit complete?', { variant: 'checked', answer: 'Yes' });
   * ```
   */
  inlineQuestion(question: string, options?: InlineQuestionOptions): this {
    this.checkNotFinalized();
    drawInlineQuestion(this, question, options);
    return this;
  }

  /**
   * One row of label/value fields. See `FieldsOptions.layout` for the stacked, inline and leader layouts.
   *
   * @group Fields and forms
   *
   * @example
   * ```ts
   * doc.fields([
   *   { label: 'Client', value: 'TechStart Inc.' },
   *   { label: 'Status', value: 'Paid', highlight: true },
   * ]);
   * doc.fields([{ label: 'Capital', value: '€250,000' }], { layout: 'leader' });
   * ```
   */
  fields(fieldList: Field[], options?: FieldsOptions): this {
    this.checkNotFinalized();
    drawFields(this, fieldList, options);
    return this;
  }

  /**
   * Several rows of label/value fields, each inner array being one row, `rowGap` apart.
   *
   * @group Fields and forms
   *
   * @example
   * ```ts
   * doc.fieldRows([
   *   [{ label: 'Name', value: 'Jane Smith' }, { label: 'Role', value: 'CEO' }],
   *   [{ label: 'Email', value: 'jane@example.com', complement: 'Preferred contact' }],
   * ]);
   * ```
   */
  fieldRows(fieldList: Field[][], options?: FieldsOptions): this {
    this.checkNotFinalized();
    drawFieldRows(this, fieldList, options);
    return this;
  }

  // === Boxes ===

  /**
   * `content` is the body text under the title. A callout may pass `''`: it then draws no body block, and the other
   * blocks (eyebrow, title, bullets) close up.
   *
   * @group Boxes
   *
   * @example
   * ```ts
   * doc.infoBox('Bank transfer, 30 days net.', { title: 'Payment', bulletPoints: ['IBAN on request'] });
   * doc.infoBox('Prices exclude VAT.', { variant: 'callout', eyebrow: 'Good to know' });
   * ```
   */
  infoBox(content: string, options: InfoBoxOptions): this {
    this.checkNotFinalized();
    drawInfoBox(this, content, options);
    return this;
  }

  /**
   * Box listing declarations, each with optional highlighted fragments, under an optional intro.
   *
   * @group Boxes
   *
   * @example
   * ```ts
   * doc.declarationsBox(
   *   [{ text: 'I accept the terms.', highlights: [{ text: 'accept', strong: true }] }],
   *   { intro: 'The signatory declares that:', bullet: true },
   * );
   * ```
   */
  declarationsBox(items: DeclarationItem[], options?: DeclarationsBoxOptions): this {
    this.checkNotFinalized();
    drawDeclarationsBox(this, items, options);
    return this;
  }

  /**
   * Boxed block of address lines (title, subtitle, address), as wide as the reading column; `inset` narrows it.
   *
   * @group Boxes
   *
   * @example
   * ```ts
   * doc.addressBlock([
   *   { text: 'Acme Corp', role: 'title' },
   *   { text: 'Billing department', role: 'subtitle' },
   *   { text: '1 Main Street, Springfield', role: 'address' },
   * ]);
   * ```
   */
  addressBlock(lines: AddressLine[], options?: AddressBlockOptions): this {
    this.checkNotFinalized();
    drawAddressBlock(this, lines, options);
    return this;
  }

  // === Layout blocks ===

  /**
   * One or two signature boxes side by side. A third box throws an `InvalidOptionError`.
   *
   * @group Boxes
   *
   * @example
   * ```ts
   * doc.signatureZone(
   *   [{ label: 'Client', sublabel: 'Jane Smith, CEO' }, { label: 'Supplier' }],
   *   { caption: 'Signed in London on May 22, 2026' },
   * );
   * ```
   */
  signatureZone(boxes: SignatureItem[], options?: SignatureZoneOptions): this {
    this.checkNotFinalized();
    drawSignatureZone(this, boxes, options);
    return this;
  }

  /**
   * Side-by-side columns of equal width across the content width. Each column is a callback that receives the
   * document, laid out in the column: the blocks it draws (`heading`, `paragraph`, `table`, even `columns`…) wrap to
   * the column width at the column X. It also receives the column X and width (mm), for raw jsPDF drawing. Every
   * column starts from the same top, with the font, colors and line width the call found, and the position ends under
   * the tallest one. The page methods (`pageHeader`, `pageFooter`, `watermark`, `background`, `tableOfContents`, the
   * covers, a logo placed from a page corner, `finalize`) act on the whole page, even from a column.
   *
   * Columns do not continue on the next page: a column that runs onto a new page raises a warning, and the columns
   * after it start at the top of that page. Wrap the call in `keepTogether` when the columns may reach the bottom.
   * Throws an `InvalidOptionError` for a `gap` below 0, or one that leaves the columns no width.
   *
   * @group Layout blocks
   *
   * @example
   * ```ts
   * doc.columns([
   *   (column) => column.heading('Sales', { level: 'h3' }).bulletList(['12 people', '3 offices']),
   *   (column) => column.heading('Support', { level: 'h3' }).paragraph('Open 24/5, in four languages.'),
   * ]);
   * ```
   */
  columns(columnList: Column[], options?: ColumnsOptions): this {
    this.checkNotFinalized();
    drawColumns(this, columnList, options);
    return this;
  }

  // === Page elements ===

  /**
   * `image` (a registered name or image data) at the current position, then the content under it. With a `y` or a
   * bottom `anchor`, it is placed from its page corner and the position stays.
   *
   * @group Layout blocks
   *
   * @example
   * ```ts
   * doc.registerImage('logo', logoDataUri);
   * doc.logo('logo', { height: 12 }); // at the position, which moves under it
   * doc.logo('logo', { height: 8, anchor: 'top-right', y: 10 }); // from a page corner
   * ```
   */
  logo(image: string, options?: LogoOptions): this {
    this.checkNotFinalized();
    drawLogo(this, image, options);
    return this;
  }

  /**
   * Pill-shaped label in the primary color. Called right after a heading, it attaches to it: 2 mm under the heading,
   * and the space the heading leaves under the badge.
   *
   * @group Layout blocks
   *
   * @example
   * ```ts
   * doc.badge('Confidential');
   * doc.heading('Acme Summit 2026').badge('Registration form');
   * ```
   */
  badge(text: string, options?: BadgeOptions): this {
    this.checkNotFinalized();
    drawBadge(this, text, options);
    return this;
  }

  /**
   * Titled columns of label/value fields, e.g. the parties of a document. The block reserves its height: when it does
   * not fit under the position it starts on the next page. It is never split between two pages.
   *
   * @group Layout blocks
   *
   * @example
   * ```ts
   * doc.headerColumns([
   *   { title: 'Invoice', fields: [{ label: 'No.', value: 'INV-042' }, { label: 'Date', value: 'April 9, 2026' }] },
   *   { title: 'Client', fields: [{ label: 'Company', value: 'TechStart Inc.' }] },
   * ]);
   * ```
   */
  headerColumns(columns: HeaderColumn[], options?: HeaderColumnsOptions): this {
    this.checkNotFinalized();
    drawHeaderColumns(this, columns, options);
    return this;
  }

  // === Table ===

  /**
   * Table in the theme colors. `data` holds one record per row, read by each column `key`. Rows never split across
   * pages: the table continues on the next page under its head row, and the foot row stays with the last body row.
   * Its width follows its columns (see `TableColumn.width`).
   *
   * @group Table
   *
   * @example
   * ```ts
   * doc.table(
   *   [
   *     { description: 'Design', qty: 5, total: '$2,750.00' },
   *     { description: 'Audit', qty: 3, total: '$2,400.00' },
   *   ],
   *   {
   *     columns: [
   *       { header: 'Description', key: 'description' },
   *       { header: 'Qty', key: 'qty', width: 15, align: 'center' },
   *       { header: 'Total', key: 'total', width: 30, align: 'right' },
   *     ],
   *     footRow: ['', 'Total', '$5,150.00'],
   *     // Style one cell: a refund in the error color.
   *     cellStyle: ({ section, text }) => (section === 'body' && text.startsWith('-') ? { color: 'error' } : undefined),
   *   },
   * );
   * ```
   */
  table(data: TableRow[], options: TableOptions): this {
    this.checkNotFinalized();
    drawTable(this, data, options);
    return this;
  }

  // === Charts ===

  /**
   * Parts of a whole as a ring, with a legend on its right: see `DonutChartOptions`.
   *
   * @group Charts
   *
   * @example
   * ```ts
   * doc.donutChart(
   *   [
   *     { label: 'Equities', value: 60 },
   *     { label: 'Bonds', value: 30 },
   *     { label: 'Cash', value: 10, color: 'secondary' },
   *   ],
   *   { centerLabel: '$1.2M' },
   * );
   * ```
   */
  donutChart(slices: ChartSlice[], options?: DonutChartOptions): this {
    this.checkNotFinalized();
    drawDonutChart(this, slices, options);
    return this;
  }

  /**
   * Parts of a whole as one horizontal bar, with a legend under it: see `StackedBarOptions`.
   *
   * @group Charts
   *
   * @example
   * ```ts
   * doc.stackedBar([
   *   { label: 'Done', value: 14, color: 'success' },
   *   { label: 'In progress', value: 5 },
   *   { label: 'Blocked', value: 2, color: 'error' },
   * ]);
   * ```
   */
  stackedBar(slices: ChartSlice[], options?: StackedBarOptions): this {
    this.checkNotFinalized();
    drawStackedBar(this, slices, options);
    return this;
  }

  /**
   * Vertical columns on a common scale, each with its label and value under it: see `ColumnChartOptions`.
   *
   * @group Charts
   *
   * @example
   * ```ts
   * doc.columnChart(
   *   [
   *     { label: 'Q1', valueLabel: '$120k', values: [80, 40] },
   *     { label: 'Q2', valueLabel: '$150k', values: [95, 55] },
   *   ],
   *   { series: [{ label: 'Licenses' }, { label: 'Services' }], reference: { value: 140, label: 'Target $140k' } },
   * );
   * ```
   */
  columnChart(columns: ChartColumn[], options?: ColumnChartOptions): this {
    this.checkNotFinalized();
    drawColumnChart(this, columns, options);
    return this;
  }

  /**
   * Lines over a common X axis, with a grid, axis labels and a legend: see `LineChartOptions`.
   *
   * @group Charts
   *
   * @example
   * ```ts
   * doc.lineChart(
   *   {
   *     xs: [2026, 2027, 2028, 2029],
   *     lines: [{ label: 'Forecast', values: [100, 108, 117, 126], emphasis: true }],
   *     band: { label: 'Range', lower: [100, 102, 104, 106], upper: [100, 114, 130, 148] },
   *   },
   *   { yTitle: 'Value', formatValue: (value) => value + 'k' },
   * );
   * ```
   */
  lineChart(data: LineChartData, options?: LineChartOptions): this {
    this.checkNotFinalized();
    drawLineChart(this, data, options);
    return this;
  }

  // === Watermark ===

  /**
   * Text across the middle of the page, at an angle and faint, over everything else on the page: content, running
   * header and footer. `allPages: true` marks every page, covers, back cover, blank pages and the pages the table of
   * contents inserts included; without it, only the page where it is called, which it follows when pages move. The
   * order of the calls does not matter: `finalize()` draws the watermarks last, `allPages` ones first, the others in
   * call order. Invalid options throw at the call. Called after `finalize()`, it is drawn at once, with the warning of
   * any drawing after it; a page added after `finalize()` carries the `allPages` watermarks under its content.
   *
   * @group Page elements
   *
   * @example
   * ```ts
   * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
   *
   * const doc = new PDFDocument();
   * doc.watermark('DRAFT', { allPages: true, opacity: 0.1 }).infoBox('Under the watermark.', { title: 'Status' });
   * ```
   */
  watermark(text: string, options?: WatermarkOptions): this {
    this.checkNotFinalized();
    this.inPageFrame(() => {
      const draw = watermarkDrawer(this, text, options);
      // `finalize()` has drawn the watermarks: one that comes after it is drawn now rather than lost.
      const drawNow = this.state !== 'open';
      if (options?.allPages === true) {
        // A measuring pass would register it twice.
        if (this.measuring > 0) return;
        this.watermarks.push(draw);
        if (drawNow) this.onExistingPages(draw);
      } else if (drawNow) {
        draw();
      } else {
        // In the page references: a measuring pass takes it back, and it follows its page when pages move.
        this.pageRefs.addWatermark(this.pageNumber, draw);
      }
    });
    return this;
  }

  // === Cover pages ===

  /**
   * Cover on the current page, then a new page for the content. Call it before the content of its page: on a page that
   * already has content, the cover is drawn over it, with a warning. The cover gets no page number and no running header
   * or footer. `variant: 'wave'` lays out a logo, the title and a wave-shaped image zone from the document margins;
   * `variant: 'image'` places the title and logo as a layout of `theme.assets.covers` says, over a full-page image;
   * `variant: 'custom'` runs your `draw(ctx, title)` on the page, its theme background color painted.
   *
   * `ctx` is the document, with the geometry of the page (`margins`, `contentWidth`) even when `cover` is called from
   * a column. The fonts, colors and line width the cover sets do not reach the pages that follow. What `draw` draws
   * past its page is content, with a warning. Throws `InvalidOptionError` on an unknown `variant` or an option of another variant before
   * drawing anything. When `draw` throws, the pages it added are deleted and the position, page references and warnings are put
   * back; what it already drew on the current page stays, and so does what it registered (`onNewPage`, `background`).
   *
   * @group Page elements
   *
   * @example
   * ```ts
   * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
   *
   * const doc = new PDFDocument();
   * doc.cover('Annual report', { variant: 'wave', subtitle: '2026' });
   *
   * // Or draw your own:
   * const custom = new PDFDocument();
   * custom.cover('Annual report', {
   *   variant: 'custom',
   *   draw: (ctx, title) => {
   *     ctx.doc.setFontSize(40);
   *     ctx.doc.text(title, ctx.margins.left, 120);
   *   },
   * });
   * ```
   */
  cover(title: string, options: CoverOptions): this {
    this.checkNotFinalized();
    checkVariant('cover', options);
    checkedText('cover title', title);
    this.pageDecoration('cover', () => drawCover(this, title, options));
    return this;
  }

  /**
   * Back cover on a new page, without page number, running header, footer or `onNewPage` callback. `variant: 'custom'`
   * runs your `draw(ctx)` on that page, its theme background color painted. Call it last: it closes its page, so a
   * block added after it starts a new page, numbered like any other, and a warning says the back cover is no longer the
   * last page.
   *
   * `ctx` is the document, with the geometry of the page (`margins`, `contentWidth`) even when `backCover` is called
   * from a column. The fonts, colors and line width the back cover sets do not reach what follows. What `draw` draws
   * past its page is content, with a warning. Throws `InvalidOptionError` on an unknown `variant` or an option of another variant before
   * drawing anything. When `draw` throws, the back cover's page is deleted and the position, page references and warnings are
   * put back; what `draw` registered (`onNewPage`, `background`, an `allPages` watermark) stays.
   *
   * @group Page elements
   *
   * @example
   * ```ts
   * doc.backCover({
   *   contact: { lines: ['hello@example.com', '+1 555 0100'] },
   *   legalText: 'Acme Corp, all rights reserved.',
   * });
   * ```
   */
  backCover(options: BackCoverOptions = {}): this {
    this.checkNotFinalized();
    checkVariant('backCover', options);
    this.pageDecoration('backCover', () => drawBackCover(this, options));
    return this;
  }

  /**
   * Draws a designed page in the page frame, as `finalize` does, and marks it before `draw` runs: the cover on the
   * current page, followed by a new page for the content; the back cover on a new blank page. If `draw` throws, the
   * pages added are deleted and the position, page references and warnings are put back, then the error goes on.
   * What was drawn on the starting page stays: jsPDF cannot truncate the content of a page.
   */
  private pageDecoration(kind: DesignedPage, draw: () => void): void {
    // A designed page is no block for a heading to wait for: headings declared before it are drawn where they stand.
    this.flushPendingHeadings();
    const restore = this.snapshot();
    // The back cover page is closed: a cover after it takes a page of its own, after a warning.
    if (kind === 'cover' && this.pageNumber === this.pageRefs.backCover) this.addPage();
    // The cover takes the current page whole: what the flow already drew there ends up under it. Raised after the
    // snapshot, so a cover that throws takes its warning back with it.
    if (kind === 'cover' && !this.atPageTop()) {
      this.addWarning(
        `cover() called on page ${this.pageNumber} after content: the cover is drawn over it; ` +
          'call cover() before the content, or after addPage()',
      );
    }
    // Only `draw` is watched for a page break: the pages the call adds itself, and those of a designed page it
    // draws in turn, are not an overflow.
    const outer = this.designing;
    this.designing = null;
    try {
      this.inPageFrame(() => {
        if (kind === 'backCover') this.addPage({ blank: true });
        if (kind === 'cover') this.pageRefs.markCover(this.pageNumber);
        else this.pageRefs.markBackCover(this.pageNumber);
        this.designing = kind;
        try {
          // Its fonts and colors must not leak into the next page or its `onNewPage` hook. A heading it leaves
          // waiting is drawn on its page, not carried to the next block.
          withDrawingState(this, () => {
            draw();
            this.flushPendingHeadings();
          });
        } finally {
          this.designing = null;
        }
        if (kind === 'cover') this.addPage();
        // The back cover closes its page, as `closingNote` does: what follows starts on a new page, after a warning.
        else this.restoreFlow(this.layout.bottom(this.pageHeight), NO_TRAILING);
      });
    } catch (error) {
      restore();
      throw error;
    } finally {
      this.designing = outer;
    }
  }

  // === Table of contents ===

  /**
   * Table of contents on the current page, filled by `finalize()` with the headings and the page numbers
   * printed in the footer. h1 and h2 are listed by default (`depth`, or a heading's `toc` option); entries link
   * to their heading. Entries that outgrow the page get continuation pages inserted after it. The content that
   * follows starts on a new page. Called from a column, it spans the page all the same, like its entries. It lists
   * the headings of the whole document, those above it and those below it.
   *
   * @group Page elements
   *
   * @example
   * ```ts
   * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
   *
   * const doc = new PDFDocument();
   * doc.tableOfContents({ depth: 3 });
   * doc.heading('Introduction', { number: '1' }).paragraph('Listed in the contents, with its page number.');
   * ```
   */
  tableOfContents(options?: TableOfContentsOptions): this {
    this.checkNotFinalized();
    // Before anything moves: the waiting headings are placed below.
    resolveTableOfContentsOptions(options);
    if (this.pageRefs.tableOfContents !== null) {
      this.addWarning('tableOfContents() called twice: only the first table is filled');
      return this;
    }
    // Headings waiting above it are drawn in the frame each was called in; the table itself spans the page, like the
    // entries `finalize` writes in it.
    this.flushPendingHeadings();
    this.inPageFrame(() => drawTableOfContents(this, options));
    return this;
  }

  // === Closing note ===

  /**
   * Small muted text at the bottom of the content area, e.g. legal notices. It closes the page: the position moves
   * to the end of the content area, so what follows starts on a new page. Breaks the page first when the text does
   * not fit under the current position. An empty text draws nothing and moves nothing.
   *
   * @group Page elements
   *
   * @example
   * ```ts
   * doc.closingNote('Acme Corp Ltd, registered in England and Wales No. 12345678.');
   * ```
   */
  closingNote(text: string, options?: ClosingNoteOptions): this {
    this.checkNotFinalized();
    drawClosingNote(this, text, options);
    return this;
  }

  /**
   * Running header: declared once, drawn by `finalize()` on every numbered page (not the covers). It sits in the
   * top margin, above a rule. The document widens the top margin of every page to clear the rule, whatever
   * `margins.top` says. Declare it before the content: when the first page already has content above the rule, that
   * page keeps it and a warning is raised; on a first page that is still empty the start moves under the rule.
   *
   * @group Page elements
   *
   * @example
   * ```ts
   * doc.pageHeader({ title: 'Annual report 2026', folio: true });
   * ```
   */
  pageHeader(options: PageHeaderOptions): this {
    this.checkNotFinalized();
    checkPageHeader(options);
    this.inPageFrame(() => this.declareHeader(options));
    return this;
  }

  private declareHeader(options: PageHeaderOptions): void {
    const { reserve } = CHROME.header;
    this.headerOptions = { ...options };

    const page = this.pageNumber;
    if (page === this.pageRefs.cover) {
      this.layout.reserveHeader(reserve, false);
      return;
    }
    // Tops as the pages were laid out so far: the first page may start elsewhere than the others.
    const firstTop = this.layout.topFor(1);
    const nextTop = this.layout.topFor(2);
    const pageTop = this.layout.topFor(page);
    // Earlier numbered pages were laid out with the old margins and cannot move.
    const earlierTooHigh =
      (page > 1 && this.pageRefs.cover !== 1 && firstTop < reserve) || (page > 2 && nextTop < reserve);
    const untouched = this.pendingHeadings.length === 0 && this.yPos === pageTop;

    this.layout.reserveHeader(reserve, page === 1 && untouched);
    if (pageTop < reserve && untouched) this.yPos = this.layout.topFor(page);
    if (earlierTooHigh || (pageTop < reserve && !untouched)) {
      this.addWarning(
        `pageHeader() declared after content started above its rule: the header needs the top ${reserve} mm; ` +
          'declare it before the content',
      );
    }
  }

  /**
   * Running footer: declared once, drawn by `finalize()` on every numbered page (not the covers). It replaces the
   * default footer (page number on the right): use `{page}` and `{pages}` in `left` or `right` to keep it. It sits in
   * the footer zone, below the content limit. `false` removes the footer altogether (no rule, no numbers, no
   * logo); `rule: false` keeps the labels and the logo but not the rule.
   *
   * @group Page elements
   *
   * @example
   * ```ts
   * doc.pageFooter({ left: 'Acme Corp', right: 'Page {page} of {pages}' });
   * doc.pageFooter(false); // no footer at all
   * ```
   */
  pageFooter(options: PageFooterOptions | false): this {
    this.checkNotFinalized();
    checkPageFooter(options);
    this.inPageFrame(() => {
      if (options !== false) this.warnShortFooter('pageFooter()');
      this.footerOptions = options === false ? false : { ...options };
    });
    return this;
  }

  // The footer is clamped to the page when the zone is shorter, so it overlaps the content instead of leaving the page.
  private warnShortFooter(caller: string): void {
    const { bottom } = this.margins;
    if (bottom >= CHROME.footer.minHeight) return;
    this.addWarning(
      `${caller} needs a bottom margin of at least ${CHROME.footer.minHeight} mm to fit below the content, got ${bottom} mm`,
    );
  }

  /**
   * Renders the table of contents, page footers, the running header, then the watermarks. Runs once; the export
   * methods call it.
   *
   * @group Export
   *
   * @example
   * ```ts
   * doc.finalize();
   * console.log(doc.doc.getNumberOfPages(), doc.warnings);
   * ```
   */
  finalize(): this {
    if (this.state === 'exported') {
      this.addWarning('finalize() after export has no effect: export already finalized the document');
      return this;
    }
    if (this.state === 'finalized') return this;
    // A heading left waiting at the end of the document is drawn before the table of contents lists it, in the frame
    // it was called in.
    this.flushPendingHeadings();
    // Called from a branch of `parallel`, the page furniture still spans the page.
    this.inPageFrame(() => {
      // Before the state change: pages it inserts run the `onNewPage` hook like any other page.
      renderTableOfContents(this);
      this.state = 'finalized';
      if (this.footerOptions === null) this.warnShortFooter('The default page footer');
      const labels = this.pageLabels;
      if (this.footerOptions !== false) drawPageFooter(this, this.footerOptions ?? DEFAULT_PAGE_FOOTER, labels);
      if (this.headerOptions !== null) drawPageHeader(this, this.headerOptions, labels);
      // Last, so nothing covers them.
      if (this.watermarks.length > 0 || this.pageRefs.watermarkCount > 0) {
        this.onExistingPages((page) => {
          for (const draw of this.watermarks) draw();
          for (const draw of this.pageRefs.watermarksOf(page)) draw();
        });
      }
    });
    return this;
  }

  // === Export ===

  /**
   * Finalizes the document and returns the PDF bytes.
   *
   * @group Export
   *
   * @example
   * ```ts
   * import { writeFileSync } from 'node:fs';
   *
   * writeFileSync('report.pdf', doc.toBuffer());
   * ```
   */
  toBuffer(): Uint8Array {
    this.prepareExport();
    return new Uint8Array(this.doc.output('arraybuffer'));
  }

  /**
   * Finalizes the document and returns the PDF as a `data:` URI.
   *
   * @group Export
   *
   * @example
   * ```ts
   * // browser only
   * const frame = document.createElement('iframe');
   * frame.src = doc.toDataUri();
   * ```
   */
  toDataUri(): string {
    this.prepareExport();
    return this.doc.output('datauristring');
  }

  /**
   * Finalizes the document and returns the PDF as a `Blob`.
   *
   * @group Export
   *
   * @example
   * ```ts
   * // browser only
   * const url = URL.createObjectURL(doc.toBlob());
   * window.open(url);
   * ```
   */
  toBlob(): Blob {
    this.prepareExport();
    return this.doc.output('blob');
  }

  private prepareExport(): void {
    // A heading drawn after finalize() still waits.
    this.flushPendingHeadings();
    if (this.state === 'open') this.finalize();
    this.state = 'exported';
  }
}
