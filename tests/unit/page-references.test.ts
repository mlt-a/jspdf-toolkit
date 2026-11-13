import { describe, expect, it } from 'vitest';

import { PageReferences, type TocEntry } from '../../src/core/page-references';

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
