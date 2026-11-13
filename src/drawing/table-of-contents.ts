import { TOC } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { checkedNumber, checkedObject, optionalText } from '../core/errors';
import type { TableOfContentsAnchor, TocEntry } from '../core/page-references';
import { withDrawingState } from './drawing-state';
import type { LeaderRowLayout } from './rich';
import { drawLeaderRow, layoutLeaderRow, replaceLeaderValue } from './rich';
import { drawHeading, drawParagraph, measureTextLevel, resolveTextStyle } from './text';
import { applyFont } from './text-style';
import type { TextStyle } from './text-style';

/** Options of `tableOfContents`. */
export interface TableOfContentsOptions {
  /** Title of the table, drawn as an `h1` that the table does not list. Default: `'Contents'`. */
  title?: string;
  /** A few sentences under the title. */
  intro?: string;
  /**
   * Deepest heading level listed (`1` = h1 … `4` = h4). A heading's `toc` option overrides it. Default: 2.
   */
  depth?: 1 | 2 | 3 | 4;
}

/** The options of the table, checked and defaulted. Throws an `InvalidOptionError` for one of the wrong type. */
export function resolveTableOfContentsOptions(options?: TableOfContentsOptions): {
  title: string;
  intro: string | undefined;
  depth: number;
} {
  if (options !== undefined) checkedObject('tableOfContents options', options);
  return {
    title: optionalText('tableOfContents title', options?.title) ?? 'Contents',
    intro: optionalText('tableOfContents intro', options?.intro),
    depth:
      options?.depth === undefined
        ? 2
        : checkedNumber('tableOfContents depth', options.depth, { min: 1, max: 4, integer: true }),
  };
}

/**
 * Draws the title and intro, then reserves the rest of the page: `renderTableOfContents` fills it from the
 * headings once pagination is final. The content that follows starts on a new page.
 */
export function drawTableOfContents(ctx: DrawingContext, options?: TableOfContentsOptions): number {
  // Before the waiting headings are placed: an invalid option must not draw them.
  const { title, intro, depth } = resolveTableOfContentsOptions(options);
  return withDrawingState(ctx, () => {
    // The waiting headings are content above the table: `atPageTop` must see them placed.
    ctx.flushPendingHeadings();
    const page = ctx.pageNumber;
    const atTop = ctx.atPageTop();
    drawHeading(ctx, title, { toc: false });
    // A title that did not fit moved to a new page, which holds nothing else.
    const startsPage = atTop || ctx.pageNumber !== page;
    if (intro) drawParagraph(ctx, intro);
    ctx.pageRefs.setTocAnchor({
      page: ctx.pageNumber,
      y: ctx.getYPos(),
      depth,
      startsPage,
    });
    ctx.addPage();
    return ctx.peekYPos();
  });
}

/** The headings recorded so far that a table of `depth` lists. Headings on a cover have no page number to point to. */
export function listedTocEntries(ctx: DrawingContext, depth: number): Readonly<TocEntry>[] {
  const numbered = ctx.pageLabels;
  return ctx.pageRefs.tocEntries.filter((entry) => (entry.toc ?? entry.level <= depth) && numbered.has(entry.page));
}

/** Nothing to list: the reserved page goes away when it holds only the table, else it stays and a warning says so. */
function dropEmptyTable(ctx: DrawingContext, toc: TableOfContentsAnchor): void {
  const reason = `Table of contents has no heading within depth ${toc.depth}`;
  if (!toc.startsPage) {
    ctx.addWarning(`${reason}: the page is kept because it holds other content, with an empty table`);
    return;
  }
  ctx.removePage(toc.page);
  ctx.addWarning(`${reason}: its page was removed`);
}

interface TocRow {
  entry: TocEntry;
  indent: number;
  /** The row measured without its page number, known once the table is paginated. */
  layout: LeaderRowLayout;
  height: number;
}

/**
 * Fills the table of contents with the listed headings and their page numbers, as printed in the footer
 * (covers are not counted). Entries that outgrow the reserved page get continuation pages inserted after
 * it, which shifts every later page: entries, covers and page numbers follow. No-op without a table. With
 * nothing to list, the reserved page is removed.
 */
export function renderTableOfContents(ctx: DrawingContext): void {
  const toc = ctx.pageRefs.tableOfContents;
  if (toc === null) return;

  // Being numbered survives the page shift below.
  const entries = listedTocEntries(ctx, toc.depth);
  if (entries.length === 0) {
    dropEmptyTable(ctx, toc);
    return;
  }

  const numberStyle = resolveTextStyle(ctx, 'label');
  const rows = measureRows(ctx, entries, numberStyle);
  const { placements, extraPages } = placeRows(ctx, rows, toc.y);
  // Shifts the entries in place: from here, rows point to the pages their headings end up on.
  ctx.insertPagesAfter(toc.page, extraPages);
  const labels = ctx.pageLabels;

  rows.forEach((row, index) => {
    const { pageOffset, top } = placements[index];
    const { page, y } = row.entry;
    ctx.doc.setPage(toc.page + pageOffset);
    // Every listed entry is on a numbered page, before and after the shift.
    const folio = { text: String(labels.get(page)!), style: numberStyle };
    drawLeaderRow(ctx, replaceLeaderValue(ctx, row.layout, folio), ctx.margins.left + row.indent, top);
    // The whole row links to the heading itself, not only to its page.
    ctx.doc.link(ctx.margins.left, top, ctx.contentWidth, row.height, { pageNumber: page, top: y });
  });
}

function measureRows(ctx: DrawingContext, entries: TocEntry[], numberStyle: TextStyle): TocRow[] {
  const { doc, contentWidth } = ctx;
  const topLevel = Math.min(...entries.map((entry) => entry.level));
  const { lineHeight } = measureTextLevel(ctx, 'body');

  return withDrawingState(ctx, () => {
    // Labels of a level line up past the widest number of that level.
    applyFont(doc, numberStyle);
    const numberWidths = new Map<number, number>();
    for (const { level, number } of entries) {
      if (number === undefined) continue;
      numberWidths.set(level, Math.max(numberWidths.get(level) ?? 0, doc.getTextWidth(number) + TOC.numberGap));
    }
    // Room for the widest page number the document can reach, with a digit of slack for inserted pages.
    const valueRoom = doc.getTextWidth('9'.repeat(String(doc.getNumberOfPages()).length + 1));

    return entries.map((entry): TocRow => {
      const indent = (entry.level - topLevel) * TOC.levelIndent;
      const prefixWidth = numberWidths.get(entry.level) ?? 0;
      const layout = layoutLeaderRow(ctx, {
        label: entry.label,
        labelStyle: resolveTextStyle(ctx, entry.level === topLevel ? 'bodyBold' : 'body'),
        // Labels of a level start past the widest number of that level.
        prefix: entry.number ? { text: entry.number, style: numberStyle, width: prefixWidth } : { width: prefixWidth },
        width: contentWidth - indent,
        lineHeight,
        value: { text: '', style: numberStyle },
        valueRoom,
      });
      return { entry, indent, layout, height: layout.height };
    });
  });
}

/** Rows flow from the reserved space onto continuation pages; a row never splits. */
function placeRows(ctx: DrawingContext, rows: TocRow[], startY: number) {
  const bottom = ctx.layout.bottom(ctx.pageHeight);
  const placements: { pageOffset: number; top: number }[] = [];
  let pageOffset = 0;
  let top = startY;
  for (const row of rows) {
    if (top + row.height > bottom && top > ctx.layout.topFor(2)) {
      pageOffset++;
      top = ctx.layout.topFor(2);
    }
    placements.push({ pageOffset, top });
    top += row.height + TOC.rowGap;
  }
  return { placements, extraPages: pageOffset };
}
