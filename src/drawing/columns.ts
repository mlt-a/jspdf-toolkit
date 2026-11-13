import { LAYOUT } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { POSITIVE, checkedArray, checkedFunction, checkedNumber, optionalNumber } from '../core/errors';
import { withDrawingState } from './drawing-state';

/**
 * Draws one column. `ctx` is the document, laid out in the column: its `margins`, `contentWidth` and `measure` are the
 * column's, so the blocks drawn through it stay inside. `columnX` and `columnWidth` (mm) serve raw jsPDF drawing.
 * Every column starts from the fonts, colors and line style the call found; what it changes stays in it.
 */
export type Column = (ctx: DrawingContext, columnX: number, columnWidth: number) => void;

/** Options of `columns`. */
export interface ColumnsOptions {
  /** Space (mm) between two columns: 0 or more. Default: `SPACING.xlarge`. */
  gap?: number;
  /** Space (mm) under the tallest column. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

/**
 * Width (mm) of each of `count` equal columns `gap` apart across `total` mm. Throws an `InvalidOptionError` when the
 * gaps leave no width.
 */
export function columnWidth(total: number, count: number, gap: number): number {
  return checkedNumber(
    () => `column width of ${count} columns ${gap} mm apart across ${total} mm`,
    (total - gap * (count - 1)) / count,
    POSITIVE,
  );
}

/** The `gap` option of a block of columns, checked: 0 or more. Default: `LAYOUT.columnGap`. */
export function columnGap(what: string, gap: number | undefined): number {
  return optionalNumber(`${what} gap (mm)`, gap, { min: 0 }) ?? LAYOUT.columnGap;
}

export function drawColumns(ctx: DrawingContext, columns: Column[], options?: ColumnsOptions): number {
  // Checked before the columns: an invalid option throws even without a column.
  const gap = columnGap('columns', options?.gap);
  const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter);
  checkedArray('columns', columns).forEach((column, index) => checkedFunction(() => `columns[${index}]`, column));
  if (columns.length === 0) {
    return ctx.peekYPos();
  }

  const margin = ctx.margins.left;
  const width = columnWidth(ctx.contentWidth, columns.length, gap);

  const bottom = ctx.parallel(
    columns.map((column, index) => {
      const left = margin + index * (width + gap);
      // Every column starts from the style the call found: what one sets, or its text leaves as the fill, stays in it.
      return { left, width, draw: () => withDrawingState(ctx, () => column(ctx, left, width)) };
    }),
  );
  // No column drew in the flow: the block is empty.
  if (bottom === undefined) return ctx.peekYPos();
  // The columns leave one space under them, their own.
  return ctx.endBlock(bottom, spaceAfter);
}
