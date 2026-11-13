import { describe, expect, it, vi } from 'vitest';

import { LEADER } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import { measureTextLevel, resolveTextStyle } from '../../src/drawing/text';
import { trackedWidth } from '../../src/drawing/text-lines';
import type { TextStyle } from '../../src/drawing/text-style';
import { applyFont } from '../../src/drawing/text-style';
import type { DrawnText } from './helpers';
import { currentPage, lastEntryPage, leaveRoom, makeDoc, pageStream, recordTexts, scanPages, titleY } from './helpers';

/** A document with room left for the title line and the space under it, not for the space above it as well. */
function nearBottom() {
  const doc = makeDoc();
  const { before, after } = doc.theme.spacing.heading.h1;
  return leaveRoom(doc, measureTextLevel(doc, 'h1').lineHeight + after + before / 2);
}

/**
 * Checks every entry of a finalized table against the pages the headings really are on, and that the row ends with
 * that page's number. `texts` records the document from its first call. A heading outside the table pages is found
 * in their streams; one on the page the table starts on shares it with the rows, and stays on that page.
 */
function expectEntriesTrue(doc: PDFDocument, texts: DrawnText[]) {
  const toc = doc.pageRefs.tableOfContents!;
  const pageCount = doc.doc.getNumberOfPages();
  const labels = doc.pageLabels;
  const tablePages: number[] = [];
  for (const call of texts) if (/^\d+$/.test(call.lines[0]) && call.align === 'right') tablePages.push(call.page);
  const first = toc.page;
  const last = Math.max(...tablePages);
  expect(last).toBeGreaterThanOrEqual(first);
  for (const entry of doc.pageRefs.tocEntries) {
    const drawnOn: number[] = [];
    for (let page = 1; page <= pageCount; page++) {
      if (page >= first && page <= last) continue;
      if (pageStream(doc, page).includes(`(${entry.label})`)) drawnOn.push(page);
    }
    if (drawnOn.length === 0) {
      expect({ label: entry.label, page: entry.page }).toEqual({ label: entry.label, page: first });
      expect(texts.find((call) => call.lines[0] === entry.label)!.page).toBe(first);
    } else {
      expect({ label: entry.label, pages: drawnOn }).toEqual({ label: entry.label, pages: [entry.page] });
    }
    // The row is drawn by `finalize`, after the heading.
    const row = texts.findLastIndex((call) => call.lines[0] === entry.label && call.page >= first && call.page <= last);
    expect(row).toBeGreaterThanOrEqual(0);
    const folio = texts.slice(row + 1).find((call) => call.align === 'right');
    expect(folio?.lines[0]).toBe(String(labels.get(entry.page)));
  }
}

describe('tableOfContents', () => {
  it('opens its title like an h1: its space above collapses into the block above, none at the top of a page', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const { block, heading } = doc.theme.spacing;
    const { ascent } = measureTextLevel(doc, 'h1');
    doc.paragraph('Intro');
    const afterIntro = doc.getYPos();
    doc.tableOfContents();
    expect(titleY(texts, 'Contents')).toBeCloseTo(afterIntro + heading.h1.before - block + ascent, 6);

    const top = makeDoc();
    const topTexts = recordTexts(top);
    top.tableOfContents();
    expect(titleY(topTexts, 'Contents')).toBeCloseTo(top.firstPageTop + ascent, 6);
  });

  it('lists h1 and h2 by default and honours the toc option', () => {
    const doc = makeDoc();
    doc.tableOfContents();
    doc
      .heading('One')
      .heading('Two', { level: 'h2' })
      .heading('Three', { level: 'h3' })
      .heading('Listed', { level: 'h3', toc: true });
    // The paragraph places the waiting headings, which `finalize` would otherwise draw under the spy.
    doc.heading('Hidden', { level: 'h2', toc: false }).paragraph('Body.');
    const labels: string[] = [];
    const text = vi.spyOn(doc.doc, 'text');
    doc.finalize();
    for (const [value] of text.mock.calls) if (typeof value === 'string') labels.push(value);
    expect(labels).toEqual(expect.arrayContaining(['One', 'Two', 'Listed']));
    expect(labels).not.toContain('Three');
    expect(labels).not.toContain('Hidden');
  });

  it('inserts continuation pages when it overflows and renumbers entries and footers', () => {
    const doc = makeDoc();
    doc.cover('Title', { variant: 'wave' });
    doc.tableOfContents();

    // Physical page of each heading as drawn, before the table inserts pages.
    const drawnOn = new Map<string, number>();
    const sectionCount = 90;
    for (let index = 1; index <= sectionCount; index++) {
      const label = `Section ${index}`;
      // The heading is drawn with the paragraph under it.
      doc
        .heading(label, { level: 'h2', number: String(index) })
        .paragraph('A short paragraph under the section heading.');
      drawnOn.set(label, lastEntryPage(doc));
    }
    const pagesBefore = doc.doc.getNumberOfPages();

    // Rows, links and page numbers drawn by finalize, with the page they land on.
    const drawn: { value: string; page: number; align?: string }[] = [];
    const text = vi.spyOn(doc.doc, 'text').mockImplementation(function (this: unknown, ...args: unknown[]) {
      const [value, , , options] = args as [unknown, number, number, { align?: string } | undefined];
      if (typeof value === 'string') drawn.push({ value, page: currentPage(doc), align: options?.align });
      return doc.doc;
    });
    const link = vi.spyOn(doc.doc, 'link');
    doc.finalize();
    text.mockRestore();

    const inserted = doc.doc.getNumberOfPages() - pagesBefore;
    expect(inserted).toBeGreaterThan(0);
    const tocPage = 2;
    const labels = doc.pageLabels;
    const total = labels.size;

    // Every heading moved down by the inserted pages; its entry, row, link and footer agree.
    const entries = doc.pageRefs.tocEntries;
    expect(entries).toHaveLength(sectionCount);
    for (const entry of entries) {
      const page = drawnOn.get(entry.label)! + inserted;
      expect(entry.page).toBe(page);
      const label = labels.get(page)!;
      // The cover is not numbered.
      expect(label).toBe(page - 1);

      const row = drawn.findIndex((call) => call.value === entry.label);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(drawn[row].page).toBeGreaterThanOrEqual(tocPage);
      expect(drawn[row].page).toBeLessThanOrEqual(tocPage + inserted);
      const folio = drawn.slice(row + 1).find((call) => call.align === 'right');
      expect(folio?.value).toBe(String(label));

      const footer = drawn.find((call) => call.page === page && /^\d+\/\d+$/.test(call.value));
      expect(footer?.value).toBe(`${label}/${total}`);
    }

    // Links target the heading pages after the shift.
    const targets = link.mock.calls.map(([, , , , options]) => (options as { pageNumber: number }).pageNumber);
    expect(targets).toEqual(entries.map((entry) => entry.page));
    expect(doc.coverPage).toBe(1);
  });

  describe('placed after headings it lists', () => {
    it('lists the headings above and below it, over continuation pages, behind a cover, without a warning', () => {
      const doc = makeDoc();
      const texts = recordTexts(doc);
      doc.cover('Title', { variant: 'wave' });
      for (let index = 1; index <= 60; index++) doc.heading(`Before ${index}`, { level: 'h2' }).paragraph('Body.');
      doc.tableOfContents();
      for (let index = 1; index <= 60; index++) doc.heading(`After ${index}`, { level: 'h2' }).paragraph('Body.');
      const pagesBefore = doc.doc.getNumberOfPages();
      doc.finalize();
      expect(doc.doc.getNumberOfPages() - pagesBefore).toBeGreaterThan(1);
      expect(doc.pageRefs.tocEntries).toHaveLength(120);
      expectEntriesTrue(doc, texts);
      // The cover is not numbered: the first heading is on page 2 and numbered 1.
      expect(doc.pageRefs.tocEntries[0]).toMatchObject({ label: 'Before 1', page: 2 });
      expect(doc.pageLabels.get(2)).toBe(1);
      expect(doc.warnings).toEqual([]);
    });

    it('lists the headings above it when it is the last thing in the document, over continuation pages', () => {
      const doc = makeDoc();
      const texts = recordTexts(doc);
      // Enough entries for the table to run past the page it starts on and the next one, wherever the content ends.
      for (let index = 1; index <= 100; index++) doc.heading(`Before ${index}`, { level: 'h2' }).paragraph('Body.');
      doc.tableOfContents();
      const pagesBefore = doc.doc.getNumberOfPages();
      doc.finalize();
      expect(doc.doc.getNumberOfPages() - pagesBefore).toBeGreaterThan(1);
      expectEntriesTrue(doc, texts);
      expect(doc.warnings).toEqual([]);
    });

    it('lists the heading placed just before it, on the page it is drawn on', () => {
      const doc = makeDoc();
      const texts = recordTexts(doc);
      doc.heading('Overview').paragraph('Text.').addPage().heading('Outline');
      doc.tableOfContents({ title: 'Index' });
      doc.heading('Details').paragraph('Text.');
      doc.finalize();
      expect(doc.pageRefs.tocEntries.map((entry) => [entry.label, entry.page])).toEqual([
        ['Overview', 1],
        ['Outline', 2],
        ['Details', 3],
      ]);
      expectEntriesTrue(doc, texts);
      expect(doc.warnings).toEqual([]);
    });
  });

  it('watermarks once every page, the inserted ones included, and keeps a page watermark on its page', () => {
    const doc = makeDoc();
    doc.tableOfContents();
    for (let index = 1; index <= 90; index++) doc.heading(`Section ${index}`, { level: 'h2' }).paragraph('Body.');
    doc.watermark('DRAFT', { allPages: true });
    doc.addPage().watermark('LAST').paragraph('Last page.');
    const pagesBefore = doc.doc.getNumberOfPages();
    doc.finalize();
    expect(doc.doc.getNumberOfPages()).toBeGreaterThan(pagesBefore);
    // jsPDF draws an inserted page last, then moves it: read the content of the pages where they end up.
    const pages = scanPages(doc).map((scan) => scan.marks.flatMap((mark) => (mark.kind === 'text' ? [mark.raw] : [])));
    pages.forEach((texts, index) => {
      const page = index + 1;
      const last = page === pages.length ? ['(DRAFT)', '(LAST)'] : ['(DRAFT)'];
      const count = (raw: string) => texts.filter((text) => text === raw).length;
      expect({ page, last: texts.slice(-last.length), drafts: count('(DRAFT)'), lasts: count('(LAST)') }).toEqual({
        page,
        last,
        drafts: 1,
        lasts: last.length - 1,
      });
    });
  });

  it('removes its page when no heading is listed, and shifts the page references', () => {
    const doc = makeDoc();
    doc.cover('Title', { variant: 'wave' });
    doc.tableOfContents();
    doc.heading('Too deep', { level: 'h3' }).paragraph('Body.');
    doc.backCover({});
    const pagesBefore = doc.doc.getNumberOfPages();
    const backCover = doc.backCoverPage!;
    const deepPage = doc.pageRefs.tocEntries[0].page;

    doc.finalize();

    expect(doc.doc.getNumberOfPages()).toBe(pagesBefore - 1);
    expect(doc.coverPage).toBe(1);
    expect(doc.backCoverPage).toBe(backCover - 1);
    expect(doc.pageRefs.tocEntries[0].page).toBe(deepPage - 1);
    expect(doc.pageRefs.tableOfContents).toBeNull();
    expect(doc.warnings.some((warning) => warning.includes('no heading within depth 2'))).toBe(true);
  });

  it('keeps its page, with a warning, when the page holds other content', () => {
    const doc = makeDoc();
    doc.paragraph('Opening text.');
    doc.tableOfContents();
    doc.heading('Too deep', { level: 'h3' });
    const pagesBefore = doc.doc.getNumberOfPages();
    doc.finalize();
    expect(doc.doc.getNumberOfPages()).toBe(pagesBefore);
    expect(doc.warnings.some((warning) => warning.includes('the page is kept'))).toBe(true);
  });

  describe('with its title near the bottom of a page', () => {
    it('moves the title to a new page that the table starts', () => {
      const doc = nearBottom();
      const texts = recordTexts(doc);
      doc.tableOfContents();
      expect(texts.find((call) => call.lines[0] === 'Contents')!.page).toBe(2);
      expect(doc.pageRefs.tableOfContents).toMatchObject({ page: 2, startsPage: true });
    });

    it('removes that page when no heading is listed, and keeps the page above', () => {
      const doc = nearBottom();
      doc.tableOfContents();
      doc.heading('Too deep', { level: 'h3' }).paragraph('Body.');
      const pagesBefore = doc.doc.getNumberOfPages();
      doc.finalize();
      expect(doc.doc.getNumberOfPages()).toBe(pagesBefore - 1);
      expect(pageStream(doc, 1)).toContain('(Opening text.)');
      expect(pageStream(doc, 2)).toContain('(Too deep)');
      expect(doc.warnings.some((warning) => warning.includes('its page was removed'))).toBe(true);
    });

    it('lists the headings on that page', () => {
      const doc = nearBottom();
      doc.tableOfContents();
      doc.heading('One').paragraph('Body.');
      const pagesBefore = doc.doc.getNumberOfPages();
      const texts = recordTexts(doc);
      doc.finalize();
      expect(doc.doc.getNumberOfPages()).toBe(pagesBefore);
      expect(texts.find((call) => call.lines[0] === 'One')!.page).toBe(2);
      expect(pageStream(doc, 1)).toContain('(Opening text.)');
    });
  });

  it('draws no dots when a title reaches its page number, and draws the title and the number', () => {
    const doc = makeDoc();
    const measure = (style: TextStyle, value: string) => {
      applyFont(doc.doc, style);
      return trackedWidth(doc.doc, value, style.charSpace);
    };
    const numberStyle = resolveTextStyle(doc, 'label');
    const titleStyle = resolveTextStyle(doc, 'bodyBold');
    // A title stays on one line beside its number while it leaves room for the widest number (`99` in a short
    // document); with a one-digit number drawn, the dots start past where they end once it is wider than this.
    const widest = doc.contentWidth - measure(numberStyle, '99') - LEADER.gap;
    const crowded = doc.contentWidth - measure(numberStyle, '1') - 2 * LEADER.gap;
    expect(crowded).toBeLessThan(widest);
    let title = '';
    search: for (let wide = 0; wide < 60; wide++) {
      for (let narrow = 0; narrow < 60; narrow++) {
        const candidate = 'm'.repeat(wide) + 'i'.repeat(narrow);
        const width = measure(titleStyle, candidate);
        if (width > crowded && width <= widest) {
          title = candidate;
          break search;
        }
      }
    }
    expect(title).not.toBe('');

    doc.tableOfContents();
    doc.heading('Short').paragraph('Body.').heading(title).paragraph('Body.');
    const dashes = vi.spyOn(doc.doc, 'setLineDashPattern');
    const texts = recordTexts(doc);
    doc.finalize();
    const leaders = dashes.mock.calls.filter(([dash]) => dash.length > 0 && dash[0] === LEADER.dash[0]);
    expect(leaders).toHaveLength(1);
    const row = texts.findIndex((call) => call.lines[0] === title);
    expect(row).toBeGreaterThan(-1);
    expect(texts[row + 1].lines[0]).toMatch(/^\d$/);
  });
});
