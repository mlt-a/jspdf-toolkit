import { BADGE, FIELD, HEADER_COLUMNS, LINE_WIDTH, LOGO, capitalMiddle } from '../core/constants';
import type { TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { InvalidOptionError, checkedObjects, checkedText, optionalNumber } from '../core/errors';
import { columnGap, columnWidth, drawColumns } from '../drawing/columns';
import { withDrawingState } from '../drawing/drawing-state';
import { levelColor, measureTextLevel, optionalLevel, resolveTextStyle, setTextStyle } from '../drawing/text';
import type { TextLevelMetrics } from '../drawing/text';
import { text as drawText, remainingTextWidth, wrap, wrapMeasured } from '../drawing/text-lines';
import { applyFont, applyTextStyle } from '../drawing/text-style';
import type { TextStyle } from '../drawing/text-style';
import { drawFlowLogo } from './logo';
import type { LogoPosition } from './logo';

/**
 * Without `y` and anchored at the top, the logo is drawn at the position, which moves under it. With `y`, or anchored
 * at the bottom, it is placed on the page from its corner and the position stays.
 */
export interface LogoOptions extends LogoPosition {
  /** Space (mm) under a logo drawn at the position. Default: `SPACING.xlarge`. */
  spaceAfter?: number;
}

export function drawLogo(ctx: DrawingContext, image: string, options: LogoOptions = {}): number {
  const { spaceAfter, ...position } = options;
  return drawFlowLogo(ctx, image, position, {
    defaultHeight: LOGO.height,
    what: 'logo',
    spaceAfter: ctx.resolveSpaceAfter(spaceAfter, LOGO.spaceAfter),
  });
}

/** Options of `badge`. */
export interface BadgeOptions {
  /** Text level of the label; the primary color overrides the color of the level. Default: `'bodyBold'`. */
  level?: TextLevel;
  /**
   * Space (mm) under the badge. Default: under a heading it attaches to, the space that heading leaves; else
   * `theme.spacing.block`.
   */
  spaceAfter?: number;
}

/** Single measuring pass of a badge, shared by its height and its drawing: the lines of the label and the pill. */
function layoutBadge(
  ctx: DrawingContext,
  text: string,
  style: TextStyle,
  metrics: TextLevelMetrics,
): { lines: string[]; width: number; height: number } {
  applyFont(ctx.doc, style);
  // A label wraps to the reading column like any text block; one that leaves no width is a wrong call.
  const room = remainingTextWidth('the badge', ctx.measure, BADGE.paddingX * 2);
  const lines = wrapMeasured(ctx, text, room);
  return {
    lines: lines.map((line) => line.text),
    width: Math.max(...lines.map((line) => line.width)) + BADGE.paddingX * 2,
    height: lines.length * metrics.lineHeight + BADGE.paddingY * 2,
  };
}

export function drawBadge(ctx: DrawingContext, text: string, options?: BadgeOptions): number {
  checkedText('badge text', text);
  const level = optionalLevel('badge', options?.level) ?? 'bodyBold';
  return withDrawingState(ctx, () => {
    const { doc, theme } = ctx;
    const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter);

    const metrics = measureTextLevel(ctx, level);
    // The label is set on the tint of the pill: in the primary color, whatever the level.
    const style = { ...resolveTextStyle(ctx, level), color: theme.colors.primary };
    const { lines, width, height } = layoutBadge(ctx, text, style, metrics);

    // Under a heading, the badge joins it and leaves the space the heading left.
    const headingSpace = ctx.attachTo('heading', BADGE.headingGap, height + spaceAfter);

    const x = ctx.margins.left;
    const y = ctx.getYPos();

    doc.setFillColor(theme.colors.tint);
    doc.setDrawColor(theme.colors.tint);
    doc.setLineWidth(LINE_WIDTH.normal);
    doc.roundedRect(x, y, width, height, BADGE.radius, BADGE.radius, 'FD');

    // After the room is reserved: placing a waiting heading restores the color it found, rounded by jsPDF.
    applyTextStyle(doc, style);
    // Centred on the pill: the middle of the capitals of the first line on the middle of its line box.
    drawText(ctx, lines, x + BADGE.paddingX, y + BADGE.paddingY + metrics.lineHeight / 2 + capitalMiddle(metrics));

    return ctx.endBlock(y + height, options?.spaceAfter, { fallback: headingSpace });
  });
}

/** A label/value line of a header column. */
export interface HeaderField {
  /**
   * Left part, in the font of the `fieldValue` level and the color of the `fieldLabel` level (`secondary` unless the
   * theme restyles it); wraps within the column `labelWidth`.
   */
  label: string;
  /** Right part, in the `fieldValue` level; wraps in what the label leaves of the column. */
  value: string;
}

/** A titled column of fields for `headerColumns`. */
export interface HeaderColumn {
  /** Heading of the column, in `h2` and the text color, unless the theme colors `h2`. */
  title: string;
  /** Lines under the title, one per field. */
  fields: HeaderField[];
  /**
   * Width (mm) of the label part, from the column edge to the values. Default: 35. Must exceed the 2 mm kept between
   * a label and its value, else an `InvalidOptionError` is thrown. At most half the column: the value keeps the rest.
   * A longer label wraps inside it.
   */
  labelWidth?: number;
}

interface HeaderRowLayout {
  labelLines: string[];
  valueLines: string[];
  height: number;
}

interface HeaderColumnLayout {
  titleLines: string[];
  /** Left edge (mm) of the values, from the column edge. */
  valueOffset: number;
  rows: HeaderRowLayout[];
  height: number;
}

/** Single measuring pass, shared by the drawing: line breaks and height of a column of `width`. */
function layoutHeaderColumn(ctx: DrawingContext, config: HeaderColumn, width: number): HeaderColumnLayout {
  const title = measureTextLevel(ctx, 'h2');
  const field = measureTextLevel(ctx, 'fieldValue');

  setTextStyle(ctx, 'h2');
  const titleLines = wrap(ctx, config.title, width);
  let height = titleLines.length * title.lineHeight;

  const labelWidth = config.labelWidth ?? HEADER_COLUMNS.labelWidth;
  if (!(labelWidth > HEADER_COLUMNS.labelGap)) {
    throw new InvalidOptionError(
      `A header column labelWidth must exceed ${HEADER_COLUMNS.labelGap} mm to leave room for the label, got ${labelWidth}`,
    );
  }
  const valueOffset = Math.min(labelWidth, width * FIELD.sideMaxRatio);
  setTextStyle(ctx, 'fieldValue');
  const rows = config.fields.map((item): HeaderRowLayout => {
    const labelLines = wrap(ctx, item.label, valueOffset - HEADER_COLUMNS.labelGap);
    const valueLines = wrap(ctx, item.value, width - valueOffset);
    return { labelLines, valueLines, height: Math.max(labelLines.length, valueLines.length) * field.lineHeight };
  });
  if (rows.length > 0) {
    height += HEADER_COLUMNS.titleGap;
    height += rows.reduce((sum, row) => sum + row.height, 0) + (rows.length - 1) * HEADER_COLUMNS.rowGap;
  }

  return { titleLines, valueOffset, rows, height };
}

function drawHeaderColumn(ctx: DrawingContext, layout: HeaderColumnLayout, x: number, top: number): void {
  const { doc } = ctx;
  const title = measureTextLevel(ctx, 'h2');
  const field = measureTextLevel(ctx, 'fieldValue');
  // The title is set in ink; a label takes the color of the `fieldLabel` level, in the font of the value.
  const value = resolveTextStyle(ctx, 'fieldValue');
  const label = { ...value, color: levelColor(ctx, 'fieldLabel') };

  applyTextStyle(doc, { ...resolveTextStyle(ctx, 'h2'), color: levelColor(ctx, 'h2', 'text') });
  drawText(ctx, layout.titleLines, x, top + title.ascent);
  let y = top + layout.titleLines.length * title.lineHeight + HEADER_COLUMNS.titleGap;

  for (const row of layout.rows) {
    applyTextStyle(doc, label);
    drawText(ctx, row.labelLines, x, y + field.ascent);
    applyTextStyle(doc, value);
    drawText(ctx, row.valueLines, x + layout.valueOffset, y + field.ascent);
    y += row.height + HEADER_COLUMNS.rowGap;
  }
}

/** Options of `headerColumns`. */
export interface HeaderColumnsOptions {
  /** Space (mm) between the columns: 0 or more. Default: `SPACING.xlarge`. */
  gap?: number;
  /** Space (mm) under the tallest column. Default: `SPACING.xxlarge`. */
  spaceAfter?: number;
}

/**
 * Every column checked before anything is drawn: its `title`, its `labelWidth` when it sets one, and the `label` and
 * `value` of each of its `fields`.
 */
function checkColumns(columns: HeaderColumn[]): void {
  checkedObjects('headerColumns columns', columns, (column, index) => {
    const at = `headerColumns columns[${index}]`;
    checkedText(`${at} title`, column.title);
    optionalNumber(`${at} labelWidth (mm)`, column.labelWidth);
    checkedObjects(`${at} fields`, column.fields, (field, position) => {
      checkedText(() => `${at} fields[${position}] label`, field.label);
      checkedText(() => `${at} fields[${position}] value`, field.value);
    });
  });
}

export function drawHeaderColumns(
  ctx: DrawingContext,
  columns: HeaderColumn[],
  options?: HeaderColumnsOptions,
): number {
  // Checked before the columns: an invalid option throws even without a column.
  const gap = columnGap('headerColumns', options?.gap);
  const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter, HEADER_COLUMNS.spaceAfter);
  checkColumns(columns);
  if (columns.length === 0) {
    return ctx.peekYPos();
  }
  return withDrawingState(ctx, () => {
    // Measured before drawing, so the whole block is reserved: it never starts below the page end.
    const width = columnWidth(ctx.contentWidth, columns.length, gap);
    const layouts = columns.map((config) => layoutHeaderColumn(ctx, config, width));
    ctx.ensureSpace(Math.max(...layouts.map((layout) => layout.height)) + spaceAfter);

    return drawColumns(
      ctx,
      layouts.map((layout) => (columnCtx, columnX) => {
        const top = columnCtx.getYPos();
        drawHeaderColumn(columnCtx, layout, columnX, top);
        columnCtx.setYPos(top + layout.height);
      }),
      { gap, spaceAfter },
    );
  });
}
