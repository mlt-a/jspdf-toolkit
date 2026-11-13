/** A heading recorded for the table of contents, on the physical page it was drawn on. */
export interface TocEntry {
  /** 1 for h1 … 4 for h4. */
  level: 1 | 2 | 3 | 4;
  label: string;
  number?: string;
  /** `true` when the heading asked to be listed whatever the table depth. */
  toc?: boolean;
  page: number;
  /** Top of the heading (mm), the target of the table's link. */
  y: number;
}

/** Where `finalize()` fills the table of contents: page, top of the free space, deepest listed level. */
export interface TableOfContentsAnchor {
  page: number;
  y: number;
  depth: number;
  /** The table started at the top of its page: the page holds nothing but the table. */
  startsPage: boolean;
}

/**
 * Physical page numbers the document stores, moved together when pages are inserted or removed. Written only
 * through the methods below, so no caller can leave a reference stale; read through the getters.
 * @internal
 */
export class PageReferences {
  private coverPage: number | undefined;
  private backCoverPage: number | undefined;
  private entries: TocEntry[] = [];
  private anchor: TableOfContentsAnchor | null = null;
  // Watermarks of a single page, in call order: drawn by `finalize()`, over everything else on their page.
  private watermarks: ReadonlyArray<{ readonly page: number; readonly draw: () => void }> = [];

  get cover(): number | undefined {
    return this.coverPage;
  }

  get backCover(): number | undefined {
    return this.backCoverPage;
  }

  get tocEntries(): ReadonlyArray<Readonly<TocEntry>> {
    return this.entries;
  }

  get tableOfContents(): Readonly<TableOfContentsAnchor> | null {
    return this.anchor;
  }

  markCover(page: number): void {
    this.coverPage = page;
  }

  markBackCover(page: number): void {
    this.backCoverPage = page;
  }

  /** Records a watermark of `page` alone, to draw when the document is finalized. */
  addWatermark(page: number, draw: () => void): void {
    this.watermarks = [...this.watermarks, { page, draw }];
  }

  /** How many watermarks of one page are recorded. */
  get watermarkCount(): number {
    return this.watermarks.length;
  }

  /** Puts the watermarks recorded after the first `count` on `page`: a page is numbered before it is moved. */
  moveWatermarksSince(count: number, page: number): void {
    this.watermarks = this.watermarks.map((watermark, index) => (index < count ? watermark : { ...watermark, page }));
  }

  /** The watermarks of `page` alone, in the order they were added. */
  watermarksOf(page: number): Array<() => void> {
    return this.watermarks.filter((watermark) => watermark.page === page).map((watermark) => watermark.draw);
  }

  /** Whether `page` is the cover or the back cover. */
  isCoverOrBackCover(page: number): boolean {
    return page === this.coverPage || page === this.backCoverPage;
  }

  /**
   * Pages, out of `total`, that get a page number, the running header and the footer: all but the cover and the
   * back cover. Blank pages keep theirs.
   */
  numberedPages(total: number): number[] {
    const pages: number[] = [];
    for (let page = 1; page <= total; page++) {
      if (!this.isCoverOrBackCover(page)) pages.push(page);
    }
    return pages;
  }

  registerTocEntry(entry: TocEntry): void {
    this.entries.push(entry);
  }

  setTocAnchor(anchor: TableOfContentsAnchor): void {
    this.anchor = anchor;
  }

  /** Moves every reference past `afterPage` by `delta` pages. */
  shift(afterPage: number, delta: number): void {
    const move = (page: number) => (page > afterPage ? page + delta : page);
    if (this.coverPage !== undefined) this.coverPage = move(this.coverPage);
    if (this.backCoverPage !== undefined) this.backCoverPage = move(this.backCoverPage);
    for (const entry of this.entries) entry.page = move(entry.page);
    if (this.anchor !== null) this.anchor = { ...this.anchor, page: move(this.anchor.page) };
    this.watermarks = this.watermarks.map((watermark) => ({ ...watermark, page: move(watermark.page) }));
  }

  /** Forgets the references to a deleted page and pulls the later ones back. */
  drop(page: number): void {
    if (this.coverPage === page) this.coverPage = undefined;
    if (this.backCoverPage === page) this.backCoverPage = undefined;
    this.entries = this.entries.filter((entry) => entry.page !== page);
    if (this.anchor?.page === page) this.anchor = null;
    this.watermarks = this.watermarks.filter((watermark) => watermark.page !== page);
    this.shift(page, -1);
  }

  /** What a measuring pass may record: entries are only appended, so their count is enough. */
  mark() {
    return {
      cover: this.coverPage,
      backCover: this.backCoverPage,
      anchor: this.anchor,
      entryCount: this.entries.length,
      watermarks: this.watermarks,
    };
  }

  rollback(mark: ReturnType<PageReferences['mark']>): void {
    this.coverPage = mark.cover;
    this.backCoverPage = mark.backCover;
    this.anchor = mark.anchor;
    this.entries.length = mark.entryCount;
    // Never changed in place, so a mark restored twice gives the same state twice.
    this.watermarks = mark.watermarks;
  }
}
