import { TOC } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { checkedNumber, checkedObject, checkedText, optionalFunction, optionalText } from '../core/errors';
import type { TableOfContentsAnchor, TocEntry } from '../core/page-references';
import { withDrawingState } from './drawing-state';
import type { LeaderRowLayout } from './rich';
import { drawLeaderRow, layoutLeaderRow, replaceLeaderValue } from './rich';
import { drawHeading, drawParagraph, measureTextLevel, resolveTextStyle } from './text';
import { trackedWidth } from './text-lines';
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
  /**
   * Writes the page number of an entry: receives the number printed in the footer (from 1, covers not counted) and
   * returns the text shown, e.g. `String(page).padStart(2, '0')` to match a running header. An empty string shows no
   * number. Default: the number itself (`2`, `12`).
   */
  formatPage?: (page: number) => string;
}

/** The options of the table, checked and defaulted. Throws an `InvalidOptionError` for one of the wrong type. */
export function resolveTableOfContentsOptions(options?: TableOfContentsOptions): {
  title: string;
  intro: string | undefined;
  depth: number;
  formatPage: ((page: number) => string) | undefined;
} {
  if (options !== undefined) checkedObject('tableOfContents options', options);
  return {
    title: optionalText('tableOfContents title', options?.title) ?? 'Contents',
    intro: optionalText('tableOfContents intro', options?.intro),
    depth:
      options?.depth === undefined
        ? 2
        : checkedNumber('tableOfContents depth', options.depth, { min: 1, max: 4, integer: true }),
    formatPage: optionalFunction('tableOfContents formatPage', options?.formatPage),
  };
}

/**
 * Draws the title and intro, then reserves the rest of the page: `renderTableOfContents` fills it from the
 * headings once pagination is final. The content that follows starts on a new page.
 */
export function drawTableOfContents(ctx: DrawingContext, options?: TableOfContentsOptions): number {
  // Before the waiting headings are placed: an invalid option must not draw them.
  const { title, intro, depth, formatPage } = resolveTableOfContentsOptions(options);
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
      formatPage,
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
  const pageText = pageTextOf(toc.formatPage);
  const { rows, placements, extraPages } = layoutRows(ctx, toc, entries, numberStyle, pageText);
  // Shifts the entries in place: from here, rows point to the pages their headings end up on.
  ctx.insertPagesAfter(toc.page, extraPages);
  const labels = ctx.pageLabels;

  rows.forEach((row, index) => {
    const { pageOffset, top } = placements[index];
    const { page, y } = row.entry;
    ctx.doc.setPage(toc.page + pageOffset);
    // Every listed entry is on a numbered page, before and after the shift.
    const folio = { text: pageText(labels.get(page)!), style: numberStyle };
    drawLeaderRow(ctx, replaceLeaderValue(ctx, row.layout, folio), ctx.margins.left + row.indent, top);
    // The whole row links to the heading itself, not only to its page.
    ctx.doc.link(ctx.margins.left, top, ctx.contentWidth, row.height, { pageNumber: page, top: y });
  });
}

/** The text of a page number: `formatPage` with its result checked, else the number itself. */
function pageTextOf(formatPage: ((page: number) => string) | undefined): (page: number) => string {
  if (formatPage === undefined) return String;
  // Called once per page: the same number is asked for by several entries and by the measuring passes.
  const texts = new Map<number, string>();
  return (page) => {
    let text = texts.get(page);
    if (text === undefined) {
      text = checkedText('value returned by tableOfContents formatPage', formatPage(page));
      texts.set(page, text);
    }
    return text;
  };
}

/**
 * Measures the rows, then places them. The room left to the page number depends on how many pages the entries end up
 * on: with `formatPage` it is the widest text of the numbers they can take, so the measuring is redone when the
 * rows need more continuation pages than it assumed (the rows only grow with the room: it settles). Only numbers of
 * pages the document will have are passed to `formatPage`.
 */
function layoutRows(
  ctx: DrawingContext,
  toc: TableOfContentsAnchor,
  entries: TocEntry[],
  numberStyle: TextStyle,
  pageText: (page: number) => string,
) {
  if (toc.formatPage === undefined) {
    const rows = measureRows(ctx, entries, numberStyle, defaultPageRoom(ctx, numberStyle));
    return { rows, ...placeRows(ctx, rows, toc.y) };
  }
  const labels = ctx.pageLabels;
  // An entry after the table moves down by the pages inserted after it.
  const labelsAfter = (extraPages: number) =>
    new Set(
      entries.flatMap(({ page }) =>
        Array.from({ length: (page > toc.page ? extraPages : 0) + 1 }, (_, shift) => labels.get(page)! + shift),
      ),
    );
  let assumed = 0;
  for (;;) {
    const room = withDrawingState(ctx, () => {
      applyFont(ctx.doc, numberStyle);
      return Math.max(
        ...[...labelsAfter(assumed)].map((page) => trackedWidth(ctx.doc, pageText(page), numberStyle.charSpace)),
      );
    });
    const rows = measureRows(ctx, entries, numberStyle, room);
    const placed = placeRows(ctx, rows, toc.y);
    if (placed.extraPages <= assumed) return { rows, ...placed };
    assumed = placed.extraPages;
  }
}

/** Room for the widest page number the document can reach, with a digit of slack for inserted pages. */
function defaultPageRoom(ctx: DrawingContext, numberStyle: TextStyle): number {
  return withDrawingState(ctx, () => {
    applyFont(ctx.doc, numberStyle);
    return ctx.doc.getTextWidth('9'.repeat(String(ctx.doc.getNumberOfPages()).length + 1));
  });
}

function measureRows(ctx: DrawingContext, entries: TocEntry[], numberStyle: TextStyle, valueRoom: number): TocRow[] {
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
