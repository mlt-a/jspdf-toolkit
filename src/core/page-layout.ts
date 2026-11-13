import { LAYOUT } from './constants';

/** Page margins (mm). */
export interface Margins {
  /**
   * Top of the content on every page after the first. A declared `pageHeader` widens it to clear its rule.
   * Default: 20.
   */
  top: number;
  /** Space between the content and the right edge of the page. Default: `left`. */
  right: number;
  /** Height of the zone under the content, which holds the page footer. Default: 15. */
  bottom: number;
  /** Space between the content and the left edge of the page. Default: 12. */
  left: number;
}

/** The `margins` document option with its defaults filled in. */
export function resolveMargins(margins: Partial<Margins> = {}): Margins {
  const left = margins.left ?? LAYOUT.pageMargin;
  return {
    top: margins.top ?? LAYOUT.pageTopMargin,
    right: margins.right ?? left,
    bottom: margins.bottom ?? LAYOUT.footerMargin,
    left,
  };
}

export interface LayoutMark {
  readonly headerReserve: number;
  readonly firstPageClearsHeader: boolean;
}

/**
 * Geometry of the pages: the margins, where the content starts and where it ends. Page 1 has its own top
 * (`firstPageTop`); a running header widens the top of the numbered pages to clear its rule.
 */
export class PageLayout {
  // Top margin the declared running header needs, 0 without one.
  private headerReserve = 0;
  // Set when the header is declared while the first page is still empty: content laid out above the rule stays.
  private firstPageClearsHeader = false;

  constructor(
    private readonly configured: Readonly<Margins>,
    private readonly firstTop: number,
  ) {}

  /** Top of the content (mm) on `pageNumber`, below the running header. */
  topFor(pageNumber: number): number {
    if (pageNumber !== 1) return Math.max(this.configured.top, this.headerReserve);
    return this.firstPageClearsHeader ? Math.max(this.firstTop, this.headerReserve) : this.firstTop;
  }

  /** Top (mm) as configured, without the header reserve: a cover has no running header to clear. */
  baseTop(pageNumber: number): number {
    return pageNumber === 1 ? this.firstTop : this.configured.top;
  }

  /** Widens the top of the pages after the first to `height`, and of the first page with `firstPage`. */
  reserveHeader(height: number, firstPage: boolean): void {
    this.headerReserve = height;
    if (firstPage) this.firstPageClearsHeader = true;
  }

  /** Captures the header state; `rollback` puts it back, for a measuring pass that may declare the header. */
  mark(): LayoutMark {
    return { headerReserve: this.headerReserve, firstPageClearsHeader: this.firstPageClearsHeader };
  }

  rollback(mark: LayoutMark): void {
    this.headerReserve = mark.headerReserve;
    this.firstPageClearsHeader = mark.firstPageClearsHeader;
  }

  /** Bottom of the content (mm): the footer zone starts there. */
  bottom(pageHeight: number): number {
    return pageHeight - this.configured.bottom;
  }
}
