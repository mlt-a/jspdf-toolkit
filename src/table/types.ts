import type { TextAlign, TextLevel } from '../core/constants';
import type { ColorInput } from '../theme/types';

/** A cell value: numbers are printed as they are, `null` and `undefined` leave the cell empty. */
export type TableCell = string | number | null | undefined;

/** One record per row, read by each column `key`. */
export type TableRow = Record<string, TableCell>;

/** A table column: its header, the row key it reads, and its width and alignment. */
export interface TableColumn {
  /** Text of the head cell. */
  header: string;
  /** Key of the row record whose value fills the cells of this column; a missing key gives an empty cell. */
  key: string;
  /**
   * Width (mm): a finite number above 0, else `InvalidOptionError`. `'auto'` or absent: the column is sized from its
   * content, and the automatic columns share what the fixed ones leave of the content width, each at least as wide as
   * its longest word while the longest words fit together (a URL or an email counts its longest segment between
   * separators). A table whose columns are all fixed is as wide as their sum, up to the content width (wider ones are scaled down, with a warning).
   * Default: `'auto'`.
   */
  width?: number | 'auto';
  /** Horizontal alignment of the column, head cell included. Default: `'left'`. */
  align?: TextAlign;
}

/** The cell a `cellStyle` callback is asked about. */
export interface TableCellContext {
  /** `head` for the head row, `body` for a row of `data`, `foot` for `footRow`. */
  section: 'head' | 'body' | 'foot';
  /** Index of the row in `data` for a body cell; 0 for the head and the foot. */
  rowIndex: number;
  /** Index of the column in `columns`. */
  columnIndex: number;
  /** The column of the cell. */
  column: TableColumn;
  /** The cell text: the value as printed, `''` for an empty cell. */
  text: string;
  /** The record of a body row; absent for the head and the foot. */
  row?: TableRow;
}

/** What a `cellStyle` callback may change on a cell; what it leaves out keeps the table style. */
export interface TableCellStyle {
  /** Text color. */
  color?: ColorInput;
  /** Cell fill. */
  fill?: ColorInput;
  /**
   * Bold text; `false` removes the weight too. Default: bold in the head and the foot, the weight of the table `level`
   * in the body.
   */
  bold?: boolean;
  /** Italic text; `false` removes the slant too. Default: the slant of the table `level`. */
  italic?: boolean;
  /** Horizontal alignment of the cell. Default: the column `align`. */
  align?: TextAlign;
}

/** Options of `table`: columns plus header, row fill and continuation behavior. */
export interface TableOptions {
  /** Columns, left to right. At least one, else `InvalidOptionError`. */
  columns: TableColumn[];
  /** Pages that show the head row: every page of the table, its first page only, or none. Default: `'everyPage'`. */
  showHead?: 'everyPage' | 'firstPage' | 'never';
  /** Zebra stripes on every other body row, the first included, in `colors.zebraFill`. Default: `true`. */
  alternateRowFill?: boolean;
  /** Bold line drawn above the table on each page it continues on, e.g. `'Orders (continued)'`. */
  continuationTitle?: string;
  /**
   * Text level of the head, the body and the foot row; a dense table takes `'caption'`. It sets the size of the text,
   * so the natural width of the columns, the wrapping, the row height and the pagination follow it; the body and the
   * foot take its color and slant, the head and the foot are bold on top of it, and a `cellStyle` result composes
   * with it. The cell padding and the continuation title (`'bodyBold'`) keep their size. Any text level, else
   * `InvalidOptionError`. Default: `'small'`.
   */
  level?: TextLevel;
  /** Closing row, one cell per column, in bold on the `tint` fill. It stays with the last body row. */
  footRow?: TableCell[];
  /**
   * Styles cells one by one, e.g. a negative amount in the error color:
   * `({ section, text }) => (section === 'body' && text.startsWith('-') ? { color: 'error' } : undefined)`.
   * Asked about every cell drawn: head (unless `showHead: 'never'`), body and foot. It may be called more than once
   * for the same cell (`keepTogether` measures before it draws): keep it free of side effects.
   */
  cellStyle?: (cell: TableCellContext) => TableCellStyle | undefined;
  /**
   * Least height (mm) of each body row, for a table meant to be filled in by hand once printed (a register, an
   * attendance sheet): an empty or short row keeps this height, and the text stays at the top of the cell. A taller
   * row keeps its own height. The head and the foot row are not affected. A finite number from 0 to the page height,
   * else `InvalidOptionError`. Default: none.
   */
  minRowHeight?: number;
  /** Space (mm) under the table. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}
