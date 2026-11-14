import { LINE_WIDTH, TABLE, TEXT_ALIGNS } from '../core/constants';
import type { TextAlign, TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  InvalidOptionError,
  POSITIVE,
  checkedArray,
  checkedChoice,
  checkedNumber,
  checkedObject,
  checkedObjects,
  checkedText,
  optionalBoolean,
  optionalChoice,
  optionalFunction,
  optionalNumber,
  optionalText,
} from '../core/errors';
import { withDrawingState } from '../drawing/drawing-state';
import {
  computeParagraphHeight,
  drawParagraph,
  levelColor,
  measureTextLevel,
  optionalLevel,
  resolveTextStyle,
} from '../drawing/text';
import type { ParagraphOptions, TextLevelMetrics } from '../drawing/text';
import { text as drawText, widestUnbreakable, wrap, wrapMeasured } from '../drawing/text-lines';
import { applyFont, applyTextStyle } from '../drawing/text-style';
import type { TextStyle } from '../drawing/text-style';
import { resolveColor, tint } from '../theme/colors';
import type { TableCell, TableCellContext, TableCellStyle, TableColumn, TableOptions, TableRow } from './types';

type Section = TableCellContext['section'];

/** Text level of the cells when the table names none. */
const DEFAULT_CELL_LEVEL = 'small';

/** `TableOptions` checked, with their defaults filled in. */
interface ResolvedTableOptions extends Omit<TableOptions, 'showHead' | 'alternateRowFill' | 'level'> {
  /** Text level of every cell, as `theme.typography` styles it; the head and the foot are set in bold. */
  level: TextLevel;
  /** Whether the head row is drawn on the first page of the table, and on the pages it continues on. */
  headOn: { firstPage: boolean; continuationPages: boolean };
  alternateRowFill: boolean;
}

/** What a section gives each of its cells, before the zebra stripes and `cellStyle`. */
interface SectionStyle {
  color: string;
  fill: string;
  /** Bold on top of the weight of the cell level; left out, the level decides. */
  bold?: boolean;
  /** Color of the cell borders. */
  lineColor: string;
}

interface CellLayout {
  style: TextStyle;
  fill: string;
  align: TextAlign;
  /** Lines drawn in the cell; none for an empty cell. */
  lines: string[];
}

/** A cell before its column width is known: `lines` are its source lines, `width` the widest of them (mm). */
interface StyledCell extends CellLayout {
  text: string;
  width: number;
}

interface StyledRow {
  cells: StyledCell[];
  lineColor: string;
  /** Moves to the next page with the row under it. */
  keepWithNext: boolean;
  /** Least height (mm) of the row, whatever its cells hold; 0 for none. */
  minHeight: number;
}

interface RowLayout {
  cells: CellLayout[];
  lineColor: string;
  keepWithNext: boolean;
  height: number;
}

/**
 * What the cells drawn so far on the page have set: a cell sets again only what differs. The fill color is not kept:
 * in PDF the text color is the fill color, so every text block overrides it and each cell sets its own fill.
 */
interface Pen {
  style?: TextStyle;
  lineColor?: string;
}

function cellText(value: TableCell): string {
  return value === null || value === undefined ? '' : String(value);
}

const SHOW_HEAD = ['everyPage', 'firstPage', 'never'] as const satisfies readonly NonNullable<
  TableOptions['showHead']
>[];

/** What a `cellStyle` callback returned for a cell, checked: nothing, or an object whose flags and alignment are valid. */
function checkedCellStyle(style: TableCellStyle | undefined, cell: TableCellContext): TableCellStyle | undefined {
  if (style === undefined) return undefined;
  const what = () => `cellStyle result for the ${cell.section} cell ${cell.columnIndex} of row ${cell.rowIndex}`;
  checkedObject(what, style);
  optionalBoolean(() => `${what()} bold`, style.bold);
  optionalBoolean(() => `${what()} italic`, style.italic);
  optionalChoice(() => `${what()} align`, style.align, TEXT_ALIGNS);
  return style;
}

/** Checks the options and fills in their defaults. */
function resolveTableOptions(ctx: DrawingContext, options: TableOptions): ResolvedTableOptions {
  const { showHead = 'everyPage', alternateRowFill = true, level, ...rest } = checkedObject('table options', options);
  checkedChoice('table showHead', showHead, SHOW_HEAD);
  optionalBoolean('table alternateRowFill', alternateRowFill);
  const cellLevel = optionalLevel('table', level) ?? DEFAULT_CELL_LEVEL;
  optionalText('table continuationTitle', rest.continuationTitle);
  optionalFunction('table cellStyle', rest.cellStyle);
  // A row taller than the page cannot be drawn whole: the page height is the limit of what is meant.
  optionalNumber('table minRowHeight (mm)', rest.minRowHeight, { min: 0, max: ctx.pageHeight });
  checkedObjects('table columns', rest.columns, (column, index) => {
    checkedText(() => `table columns[${index}] header`, column.header);
    checkedText(() => `table columns[${index}] key`, column.key);
    optionalChoice(() => `table columns[${index}] align`, column.align, TEXT_ALIGNS);
  });
  if (rest.columns.length === 0) throw new InvalidOptionError('A table needs at least one column');
  for (const { key, width } of rest.columns) {
    if (width !== undefined && width !== 'auto') {
      checkedNumber(`width for table column "${key}"`, width, { ...POSITIVE, or: "'auto'" });
    }
  }
  if (rest.footRow !== undefined) checkedArray('table footRow', rest.footRow);
  return {
    ...rest,
    level: cellLevel,
    headOn: { firstPage: showHead !== 'never', continuationPages: showHead === 'everyPage' },
    alternateRowFill,
  };
}

/** `ink` is the text color of the cell level: the body and the foot are set in it, the head on the primary fill. */
function sectionStyle(ctx: DrawingContext, section: Section, ink: string): SectionStyle {
  const { colors } = ctx.theme;
  switch (section) {
    case 'head':
      return {
        color: colors.onPrimary,
        fill: colors.primary,
        bold: true,
        lineColor: tint(colors.primary, TABLE.headBorderTint),
      };
    case 'body':
      return { color: ink, fill: colors.background, lineColor: colors.border };
    case 'foot':
      return { color: ink, fill: colors.tint, bold: true, lineColor: colors.surfaceBorder };
  }
}

/**
 * Resolves the text style of a (bold, italic, color) triple once for the table: only a few occur across its cells,
 * and cells that share one share the same object.
 */
function textStyleResolver(
  ctx: DrawingContext,
  level: TextLevel,
): (bold: boolean | undefined, italic: boolean | undefined, color: string) => TextStyle {
  const styles = new Map<string, TextStyle>();
  return (bold, italic, color) => {
    const key = `${String(bold)}/${String(italic)}/${color}`;
    let style = styles.get(key);
    if (!style) {
      style = { ...resolveTextStyle(ctx, level, { bold, italic }), color };
      styles.set(key, style);
    }
    return style;
  };
}

/** Styles and measures one row of cells: section, zebra stripes, then the `cellStyle` callback. */
function rowStyler(
  ctx: DrawingContext,
  options: ResolvedTableOptions,
  bodyRowCount: number,
): (section: Section, texts: string[], rowIndex: number, row?: TableRow) => StyledRow {
  const { theme, doc } = ctx;
  const textStyle = textStyleResolver(ctx, options.level);
  const ink = levelColor(ctx, options.level);
  let font: TextStyle | undefined;
  return (section, texts, rowIndex, row) => {
    const base = sectionStyle(ctx, section, ink);
    // The first row is striped, so a striped row always follows the head.
    const fill =
      section === 'body' && options.alternateRowFill && rowIndex % 2 === 0 ? theme.colors.zebraFill : base.fill;
    const cells = options.columns.map((column, columnIndex): StyledCell => {
      const text = texts[columnIndex] ?? '';
      const context: TableCellContext = { section, rowIndex, columnIndex, column, text, row };
      const custom = checkedCellStyle(options.cellStyle?.(context), context);
      const color = custom?.color === undefined ? base.color : resolveColor(theme, custom.color);
      const style = textStyle(custom?.bold ?? base.bold, custom?.italic, color);
      if (style !== font) {
        applyFont(doc, style);
        font = style;
      }
      // Measured as the wrapping measures it: a cell whose widest line fits its column is not wrapped again.
      const lines = text === '' ? [] : wrapMeasured(ctx, text, Number.POSITIVE_INFINITY);
      return {
        text,
        style,
        fill: custom?.fill === undefined ? fill : resolveColor(theme, custom.fill),
        // The head follows its column, so a header sits over the figures it names.
        align: custom?.align ?? column.align ?? 'left',
        lines: lines.map((line) => line.text),
        width: lines.reduce((widest, line) => Math.max(widest, line.width), 0),
      };
    });
    // The head stays with the first row, the last body row with the foot.
    const keepWithNext =
      section === 'head' || (section === 'body' && options.footRow !== undefined && rowIndex === bodyRowCount - 1);
    // Only the rows of `data` are meant to be filled in by hand: the head and the foot stay as tall as their text.
    const minHeight = section === 'body' ? (options.minRowHeight ?? 0) : 0;
    return { cells, lineColor: base.lineColor, keepWithNext, minHeight };
  };
}

/**
 * Narrowest first, each column of `indices` takes the smaller of its `caps` width and the equal share of what the
 * ones after it leave: once a column takes the share, every wider one after it takes the same share. Writes into
 * `widths` and returns the room left, positive only when every cap was met. `indices` is sorted in place.
 */
function shareRoom(indices: number[], caps: number[], room: number, widths: number[]): number {
  let left = room;
  let remaining = indices.length;
  indices.sort((a, b) => caps[a] - caps[b]);
  for (const index of indices) {
    widths[index] = Math.min(caps[index], left / remaining);
    left -= widths[index];
    remaining -= 1;
  }
  return left;
}

/**
 * Width (mm) of the widest word of each automatic column, padding included, at most its natural width: the least a
 * column takes without cutting a word in two. A cell no wider than the widest word found so far is not looked at.
 */
function wordFloors(ctx: DrawingContext, rows: StyledRow[], auto: number[], natural: number[], padding: number) {
  const floors = natural.map(() => padding);
  for (const index of auto) {
    for (const { cells } of rows) {
      const cell = cells[index];
      if (cell.width + padding <= floors[index]) continue;
      applyFont(ctx.doc, cell.style);
      for (const line of cell.lines) {
        floors[index] = Math.max(floors[index], widestUnbreakable(ctx.doc, line) + padding);
      }
    }
    floors[index] = Math.min(floors[index], natural[index]);
  }
  return floors;
}

/**
 * Shares `room` between `auto` columns some of which are cut short of their natural width, so that no word is cut in
 * two when the longest words fit: a column narrower than its floor takes the floor, and the others share what is left
 * as before (a column can fall under its own floor once another is raised: the pass is repeated). When the floors
 * together are wider than `room` a word is cut whatever is done: the same sharing runs on the floors instead of the
 * natural widths, so that the columns whose longest word fits the equal share keep it whole, and the others split
 * what is left.
 */
function shareAboveFloors(auto: number[], natural: number[], floors: number[], room: number, widths: number[]): void {
  const pinned: number[] = [];
  let free = auto;
  for (;;) {
    const short = free.filter((index) => widths[index] < floors[index] - TABLE.wrapSlack);
    if (short.length === 0) return;
    pinned.push(...short);
    free = free.filter((index) => !short.includes(index));
    const pinnedWidth = pinned.reduce((sum, index) => sum + floors[index], 0);
    if (pinnedWidth > room) {
      shareRoom(auto, floors, room, widths);
      return;
    }
    for (const index of pinned) widths[index] = floors[index];
    shareRoom(free, natural, room - pinnedWidth, widths);
  }
}

/**
 * Width (mm) of each column. Fixed widths are kept. The automatic columns share what is left: one whose content fits
 * in an equal share keeps its natural width, the others split the rest; room left over once every content fits is
 * handed out in proportion. A column never gets less than its longest word, padding included (a URL or an email: its
 * longest segment between separators), unless the longest words of the automatic columns together are wider than
 * the room: see `shareAboveFloors`.
 */
function columnWidths(ctx: DrawingContext, columns: TableColumn[], rows: StyledRow[], tableWidth: number): number[] {
  const padding = TABLE.cellPadding.left + TABLE.cellPadding.right;
  const widths = columns.map((column) => (typeof column.width === 'number' ? column.width : 0));
  const auto = columns.flatMap((column, index) => (typeof column.width === 'number' ? [] : [index]));
  const natural = columns.map(() => padding);
  for (const row of rows) {
    row.cells.forEach((cell, index) => {
      natural[index] = Math.max(natural[index], cell.width + padding);
    });
  }

  const taken = widths.reduce((sum, width) => sum + width, 0);
  const minimum = auto.length * (padding + TABLE.minTextWidth);
  // Fixed columns that leave the automatic ones less than their minimum make the table too wide.
  const overflow = taken + minimum > tableWidth;
  const room = overflow ? minimum : tableWidth - taken;
  const left = shareRoom(auto, natural, room, widths);
  if (!overflow && auto.some((index) => widths[index] < natural[index])) {
    // A column cut short of its content may be cut inside a word: the floors say whether it is.
    shareAboveFloors(auto, natural, wordFloors(ctx, rows, auto, natural, padding), room, widths);
  } else if (left > 0) {
    const total = auto.reduce((sum, index) => sum + widths[index], 0);
    for (const index of auto) widths[index] += (left * widths[index]) / total;
  }
  return overflow ? scaleToTable(ctx, widths, tableWidth) : widths;
}

/** Columns wider than the table together are scaled down to it, with a warning: a table never leaves the page. */
function scaleToTable(ctx: DrawingContext, widths: number[], tableWidth: number): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  ctx.addWarning(
    `Table columns are ${total.toFixed(1)} mm wide together, more than the available width ` +
      `(${tableWidth.toFixed(1)} mm): they are scaled down to fit`,
  );
  return widths.map((width) => (width * tableWidth) / total);
}

/** Wraps each cell of `row` to its column and gives the row its height. */
function wrapRow(ctx: DrawingContext, row: StyledRow, widths: number[], metrics: TextLevelMetrics): RowLayout {
  const { top, right, bottom, left } = TABLE.cellPadding;
  const cells = row.cells.map((cell, index): CellLayout => {
    const textWidth = Math.max(widths[index] - left - right, TABLE.minTextWidth) + TABLE.wrapSlack;
    if (cell.width <= textWidth) return cell;
    applyFont(ctx.doc, cell.style);
    return { ...cell, lines: wrap(ctx, cell.text, textWidth) };
  });
  const lineCount = cells.reduce((most, cell) => Math.max(most, cell.lines.length), 1);
  // The text stays at the top of a row made taller than its content: the room left under it is for writing by hand.
  const height = Math.max(lineCount * metrics.lineHeight + top + bottom, row.minHeight);
  return { cells, lineColor: row.lineColor, keepWithNext: row.keepWithNext, height };
}

function drawRow(ctx: DrawingContext, row: RowLayout, widths: number[], pen: Pen, metrics: TextLevelMetrics): void {
  const { doc } = ctx;
  const { top, right, left } = TABLE.cellPadding;
  const y = ctx.getYPos();

  if (row.lineColor !== pen.lineColor) {
    doc.setDrawColor(row.lineColor);
    pen.lineColor = row.lineColor;
  }
  let x = ctx.margins.left;
  row.cells.forEach((cell, index) => {
    const width = widths[index];
    doc.setFillColor(cell.fill);
    doc.rect(x, y, width, row.height, 'FD');
    if (cell.lines.length > 0) {
      if (cell.style !== pen.style) {
        applyTextStyle(doc, cell.style);
        pen.style = cell.style;
      }
      const anchor = cell.align === 'right' ? x + width - right : cell.align === 'center' ? x + width / 2 : x + left;
      drawText(ctx, cell.lines, anchor, y + top + metrics.ascent, { align: cell.align });
    }
    x += width;
  });

  ctx.setYPos(y + row.height);
}

/** Height (mm) of `rows[index]` and of the rows it keeps with it. */
function heightKeptWith(rows: RowLayout[], index: number): number {
  let height = rows[index].height;
  for (let next = index; rows[next].keepWithNext && next + 1 < rows.length; next += 1) height += rows[next + 1].height;
  return height;
}

/**
 * Draws a table, as wide as the content or as its fixed columns (see `TableColumn.width`). Rows never split: a row
 * that does not fit goes to the next page, under the continuation title and the head row. The foot row stays with
 * the last body row. Throws `InvalidOptionError` on a table without columns, with an invalid column width, with an
 * invalid `minRowHeight` or with a `level` that is no text level.
 */
export function drawTable(ctx: DrawingContext, data: TableRow[], tableOptions: TableOptions): number {
  const options = resolveTableOptions(ctx, tableOptions);
  checkedObjects('table data', data);
  const { columns, footRow, continuationTitle } = options;
  const spaceAfter = ctx.resolveSpaceAfter(tableOptions.spaceAfter);
  // Nothing to show: leave the position, and the headings waiting for a block, alone.
  if (data.length === 0 && !footRow && !options.headOn.firstPage) return ctx.peekYPos();

  return withDrawingState(ctx, () => {
    const styleRow = rowStyler(ctx, options, data.length);
    const styled = [
      // A hidden head is not styled: its bold face is not resolved, and `cellStyle` is not asked about it.
      ...(options.headOn.firstPage
        ? [
            styleRow(
              'head',
              columns.map((column) => column.header),
              0,
            ),
          ]
        : []),
      ...data.map((row, index) =>
        styleRow(
          'body',
          // Own properties only: a key such as `constructor` must not read the prototype.
          columns.map((column) => cellText(Object.hasOwn(row, column.key) ? row[column.key] : undefined)),
          index,
          row,
        ),
      ),
      ...(footRow ? [styleRow('foot', footRow.map(cellText), 0)] : []),
    ];

    // One layout for the whole table: the same widths and line breaks on every page.
    const widths = columnWidths(ctx, columns, styled, ctx.contentWidth);
    // Constant for the table: every cell is set in the same level.
    const metrics = measureTextLevel(ctx, options.level);
    const rows = styled.map((row) => wrapRow(ctx, row, widths, metrics));
    const head = options.headOn.continuationPages ? rows[0] : undefined;

    const titleOptions: ParagraphOptions = {
      level: 'bodyBold',
      maxWidth: widths.reduce((sum, width) => sum + width, 0),
      spaceAfter: TABLE.continuationTitleGap,
    };
    const titleHeight = continuationTitle
      ? computeParagraphHeight(ctx, continuationTitle, titleOptions) + TABLE.continuationTitleGap
      : 0;
    // What a continuation page draws before its first row.
    const lead = titleHeight + (head?.height ?? 0);

    ctx.doc.setLineWidth(LINE_WIDTH.normal);
    let pen: Pen = {};
    rows.forEach((row, index) => {
      // The first row opens the table: a page break before it moves the whole table, with nothing to repeat.
      const opening = index === 0;
      // The first row sits under the head, whose check already reserved the room for both: a break between them would
      // leave the head alone on a page, and count a row too tall for a page twice.
      const underHead = index === 1 && options.headOn.firstPage;
      if (!underHead && ctx.ensureSpace(heightKeptWith(rows, index), { lead: opening ? 0 : lead })) {
        // A new page starts from the PDF defaults, and its decorations may have set other colors.
        pen = {};
        if (!opening) {
          if (continuationTitle) drawParagraph(ctx, continuationTitle, titleOptions);
          if (head) drawRow(ctx, head, widths, pen, metrics);
        }
      }
      drawRow(ctx, row, widths, pen, metrics);
    });

    return ctx.endBlock(ctx.getYPos(), spaceAfter);
  });
}
