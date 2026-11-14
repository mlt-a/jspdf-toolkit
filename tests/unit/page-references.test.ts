import { describe, expect, it } from 'vitest';

import type { PDFDocument } from '../../src/core/document';
import { PdfToolkitError } from '../../src/core/errors';
import { PageReferences, type PageReference, type TocEntry } from '../../src/core/page-references';
import { LONG, leaveRoom, makeDoc, pageStream } from './helpers';

const entry = (page: number, label = `Heading on ${page}`): TocEntry => ({ level: 1, label, page, y: 30 });

/** Cover on 1, back cover on 5, entries on 2 and 4, table on 3. */
function filled(): PageReferences {
  const refs = new PageReferences();
  refs.markCover(1);
  refs.markBackCover(5);
  refs.registerTocEntry(entry(2));
  refs.registerTocEntry(entry(4));
  refs.setTocAnchor({ page: 3, y: 30, depth: 2, startsPage: true });
  return refs;
}

// Named functions: the result reads which watermark went where.
const named = (name: string) => Object.defineProperty(() => {}, 'name', { value: name });
const names = (refs: PageReferences, page: number) => refs.watermarksOf(page).map((draw) => draw.name);

describe('PageReferences', () => {
  it('numbers every page but the cover and the back cover', () => {
    expect(filled().numberedPages(5)).toEqual([2, 3, 4]);
    expect(new PageReferences().numberedPages(3)).toEqual([1, 2, 3]);
  });

  it('moves the references past a page, and leaves the earlier ones', () => {
    const refs = filled();
    refs.shift(2, 2);
    expect(refs.cover).toBe(1);
    expect(refs.backCover).toBe(7);
    expect(refs.tocEntries.map((e) => e.page)).toEqual([2, 6]);
    expect(refs.tableOfContents?.page).toBe(5);
  });

  it('leaves absent references absent when it shifts', () => {
    const refs = new PageReferences();
    refs.shift(1, 3);
    expect(refs.cover).toBeUndefined();
    expect(refs.backCover).toBeUndefined();
    expect(refs.tableOfContents).toBeNull();
  });

  describe('drop', () => {
    it('forgets the cover and pulls the later pages back', () => {
      const refs = filled();
      refs.drop(1);
      expect(refs.cover).toBeUndefined();
      expect(refs.backCover).toBe(4);
      expect(refs.tocEntries.map((e) => e.page)).toEqual([1, 3]);
      expect(refs.tableOfContents?.page).toBe(2);
    });

    it('forgets the back cover', () => {
      const refs = filled();
      refs.drop(5);
      expect(refs.backCover).toBeUndefined();
      expect(refs.cover).toBe(1);
      expect(refs.tocEntries.map((e) => e.page)).toEqual([2, 4]);
    });

    it('forgets the entries and the table of the page', () => {
      const refs = filled();
      refs.drop(3);
      expect(refs.tableOfContents).toBeNull();
      expect(refs.tocEntries.map((e) => e.page)).toEqual([2, 3]);
      refs.drop(2);
      expect(refs.tocEntries.map((e) => e.label)).toEqual(['Heading on 4']);
      expect(refs.tocEntries[0].page).toBe(2);
    });
  });

  describe('watermarks of one page', () => {
    it('keeps the watermarks of each page, in the order they were added', () => {
      const refs = new PageReferences();
      refs.addWatermark(2, named('a'));
      refs.addWatermark(1, named('b'));
      refs.addWatermark(2, named('c'));
      expect([1, 2, 3].map((page) => names(refs, page))).toEqual([['b'], ['a', 'c'], []]);
    });

    it('move with their page, and go with a page that is dropped', () => {
      const refs = new PageReferences();
      refs.addWatermark(2, named('two'));
      refs.addWatermark(4, named('four'));
      refs.shift(2, 1);
      expect([2, 5].map((page) => names(refs, page))).toEqual([['two'], ['four']]);
      refs.drop(2);
      expect([1, 2, 3, 4].map((page) => names(refs, page))).toEqual([[], [], [], ['four']]);
    });

    it('recorded since a count are put on the page they end up on', () => {
      const refs = new PageReferences();
      refs.addWatermark(1, named('before'));
      const count = refs.watermarkCount;
      refs.addWatermark(9, named('hook'));
      refs.moveWatermarksSince(count, 3);
      expect([1, 3, 9].map((page) => names(refs, page))).toEqual([['before'], ['hook'], []]);
    });

    it('are put back by a rollback, the same each time a mark is restored', () => {
      const refs = new PageReferences();
      refs.addWatermark(1, named('kept'));
      const mark = refs.mark();
      refs.addWatermark(2, named('scratch'));
      refs.shift(0, 1);
      refs.rollback(mark);
      refs.addWatermark(1, named('again'));
      refs.rollback(mark);
      expect([1, 2].map((page) => names(refs, page))).toEqual([['kept'], []]);
    });
  });

  it('puts back what a measuring pass recorded, and keeps what came before', () => {
    const refs = new PageReferences();
    refs.registerTocEntry(entry(1));
    const mark = refs.mark();
    refs.markCover(2);
    refs.markBackCover(3);
    refs.registerTocEntry(entry(2));
    refs.setTocAnchor({ page: 2, y: 30, depth: 2, startsPage: false });
    refs.rollback(mark);
    expect(refs.cover).toBeUndefined();
    expect(refs.backCover).toBeUndefined();
    expect(refs.tableOfContents).toBeNull();
    expect(refs.tocEntries.map((e) => e.page)).toEqual([1]);
  });
});

/** Writes `text` where the flow stands, then takes a reference to its page: the text shows which page it names. */
function marked(doc: PDFDocument, text: string): PageReference {
  doc.doc.text(text, doc.margins.left, doc.getYPos() + 5);
  return doc.pageReference();
}

const shows = (doc: PDFDocument, page: number, text: string) => pageStream(doc, page).includes(`(${text})`);

/** Headings for the table of contents to list, over a few pages: enough of them make it overflow its page. */
function sections(doc: PDFDocument, count: number): void {
  for (let index = 1; index <= count; index++) doc.heading(`Section ${index}`, { level: 'h2' }).paragraph('Text.');
}

/** Reads a reference as a whole, or the error it throws. */
const read = (ref: PageReference) => ({ page: ref.page, label: ref.label });

describe('pageReference', () => {
  it('names the page it was taken on and its number, in a document without a table of contents', () => {
    const doc = makeDoc();
    const first = marked(doc, 'first');
    doc.addPage();
    const second = marked(doc, 'second');
    doc.finalize();
    expect([read(first), read(second)]).toEqual([
      { page: 1, label: 1 },
      { page: 2, label: 2 },
    ]);
    expect(shows(doc, 2, 'second')).toBe(true);
  });

  it('throws when read before finalize(), page and label alike', () => {
    const doc = makeDoc();
    const ref = doc.pageReference();
    expect(() => ref.page).toThrow(PdfToolkitError);
    expect(() => ref.label).toThrow(/^Page reference read before finalize\(\): pages may still move/);
    doc.toBuffer();
    expect(read(ref)).toEqual({ page: 1, label: 1 });
  });

  it('follows the pages a table of contents inserts when it is filled, and keeps the pages before it', () => {
    const doc = makeDoc();
    const before = marked(doc, 'before');
    doc.addPage().tableOfContents();
    sections(doc, 120);
    const takenOn = doc.pageNumber;
    const after = marked(doc, 'after');
    const pagesBefore = doc.doc.getNumberOfPages();
    doc.finalize();
    const inserted = doc.doc.getNumberOfPages() - pagesBefore;
    // Over more than one continuation page.
    expect(inserted).toBeGreaterThanOrEqual(2);
    expect(after.page).toBe(takenOn + inserted);
    expect(shows(doc, after.page, 'after')).toBe(true);
    expect(after.label).toBe(doc.pageLabels.get(after.page));
    expect(read(before)).toEqual({ page: 1, label: 1 });
  });

  it('stays on its page after a table of contents that fits on the page it reserved', () => {
    const doc = makeDoc();
    doc.tableOfContents();
    sections(doc, 3);
    const takenOn = doc.pageNumber;
    const pagesBefore = doc.doc.getNumberOfPages();
    const after = marked(doc, 'after');
    doc.finalize();
    expect(doc.doc.getNumberOfPages()).toBe(pagesBefore);
    expect(read(after)).toEqual({ page: takenOn, label: takenOn });
  });

  it('names the cover and the back cover, with no number, taken in their draw', () => {
    const doc = makeDoc();
    let cover: PageReference | undefined;
    let backCover: PageReference | undefined;
    doc.cover('Report', { variant: 'custom', draw: (ctx) => void (cover = ctx.pageReference()) });
    doc.tableOfContents();
    sections(doc, 120);
    const content = marked(doc, 'content');
    doc.backCover({ variant: 'custom', draw: (ctx) => void (backCover = ctx.pageReference()) });
    doc.finalize();
    const last = doc.doc.getNumberOfPages();
    expect(read(cover!)).toEqual({ page: 1, label: undefined });
    expect(read(backCover!)).toEqual({ page: last, label: undefined });
    expect(read(content)).toEqual({ page: last - 1, label: last - 2 });
    expect(shows(doc, content.page, 'content')).toBe(true);
  });

  it('follows the empty table of contents page finalize() removes, and throws for a reference on it', () => {
    const doc = makeDoc();
    const onTable = doc.pageReference();
    doc.tableOfContents();
    doc.paragraph('No heading to list.');
    const after = marked(doc, 'after');
    doc.finalize();
    expect(doc.warnings).toContain('Table of contents has no heading within depth 2: its page was removed');
    expect(read(after)).toEqual({ page: 1, label: 1 });
    expect(shows(doc, 1, 'after')).toBe(true);
    expect(() => onTable.page).toThrow(
      new PdfToolkitError('Page reference taken on page 1: that page was deleted since'),
    );
  });

  it('in a keepTogether replayed: the references of the measuring passes throw, the last one names its page', () => {
    const doc = leaveRoom(makeDoc(), 10);
    doc.tableOfContents();
    sections(doc, 120);
    leaveRoom(doc, 10);
    const refs: PageReference[] = [];
    doc.keepTogether(() => {
      doc.paragraph(LONG);
      refs.push(marked(doc, 'kept'));
    });
    const takenOn = doc.pageNumber;
    const pagesBefore = doc.doc.getNumberOfPages();
    doc.finalize();
    // Measured where it stands, then on a page of its own, then drawn.
    expect(refs).toHaveLength(3);
    for (const scratch of refs.slice(0, 2)) {
      expect(() => scratch.page).toThrow(/^Page reference taken while keepTogether\(\) measured its block/);
    }
    expect(refs[2].page).toBe(takenOn + doc.doc.getNumberOfPages() - pagesBefore);
    expect(shows(doc, refs[2].page, 'kept')).toBe(true);
  });

  it('names the page of each column, the one a column broke onto included', () => {
    const doc = makeDoc();
    doc.tableOfContents();
    sections(doc, 120);
    leaveRoom(doc, 20);
    const takenOn = doc.pageNumber;
    let left: PageReference | undefined;
    let right: PageReference | undefined;
    doc.columns([
      () => void (left = marked(doc, 'left')),
      () => {
        doc.paragraph(LONG.repeat(2));
        right = marked(doc, 'right');
      },
    ]);
    const pagesBefore = doc.doc.getNumberOfPages();
    doc.finalize();
    const inserted = doc.doc.getNumberOfPages() - pagesBefore;
    expect([left!.page, right!.page]).toEqual([takenOn + inserted, takenOn + 1 + inserted]);
    expect(shows(doc, left!.page, 'left') && shows(doc, right!.page, 'right')).toBe(true);
  });

  it('names the page of an inset, past a table of contents that grew', () => {
    const doc = makeDoc();
    doc.tableOfContents();
    sections(doc, 120);
    const takenOn = doc.pageNumber;
    let inset: PageReference | undefined;
    doc.inset({ left: 20 }, () => void (inset = marked(doc, 'inset')));
    const pagesBefore = doc.doc.getNumberOfPages();
    doc.finalize();
    expect(inset!.page).toBe(takenOn + doc.doc.getNumberOfPages() - pagesBefore);
    expect(shows(doc, inset!.page, 'inset')).toBe(true);
  });

  it('reads in the draw of a custom running header, on the page it draws', () => {
    const doc = makeDoc();
    const seen: Array<{ page: number; label: number | undefined }> = [];
    const expected: Array<{ page: number; label: number | undefined }> = [];
    doc.pageHeader({
      variant: 'custom',
      draw: (ctx, numbers) => {
        seen.push(read(ctx.pageReference()));
        expected.push({ page: ctx.doc.getCurrentPageInfo().pageNumber, label: numbers.page });
      },
    });
    doc.cover('Report', { variant: 'wave' });
    doc.tableOfContents();
    sections(doc, 120);
    doc.finalize();
    expect(seen).toEqual(expected);
    expect(seen.at(-1)!.page).toBe(doc.doc.getNumberOfPages());
  });

  it('follows pages raw jsPDF code moves, and throws for a page it deletes', () => {
    const doc = makeDoc();
    doc.addPage().addPage();
    const moved = marked(doc, 'moved');
    doc.doc.setPage(2);
    const deleted = doc.pageReference();
    doc.doc.movePage(3, 1);
    doc.doc.deletePage(3);
    doc.finalize();
    expect(read(moved)).toEqual({ page: 1, label: 1 });
    expect(shows(doc, 1, 'moved')).toBe(true);
    expect(() => deleted.label).toThrow(/^Page reference taken on page 2: that page was deleted since$/);
  });

  it('gives no number to a page added after finalize(), which gets no footer', () => {
    const doc = makeDoc();
    doc.finalize();
    doc.addPage();
    expect(read(doc.pageReference())).toEqual({ page: 2, label: undefined });
  });

  it('throws for a page a cover that failed added: the page is deleted with the cover', () => {
    const doc = makeDoc();
    let ref: PageReference | undefined;
    expect(() =>
      doc.cover('Report', {
        variant: 'custom',
        draw: (ctx) => {
          ctx.addPage();
          ref = ctx.pageReference();
          throw new Error('cover failed');
        },
      }),
    ).toThrow('cover failed');
    doc.finalize();
    expect(() => ref!.page).toThrow(/^Page reference taken on page 2: that page was deleted since$/);
  });
});
