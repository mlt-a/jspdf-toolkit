import { describe, expect, it, vi } from 'vitest';

import { CHROME } from '../../src/core/constants';
import { PDFDocument } from '../../src/core/document';
import { setTextStyle } from '../../src/drawing/text';
import { createTheme } from '../../src/theme/defaults';
import { type DrawnText, currentPage, loadLogo, makeDoc, recordTexts } from './helpers';

type LineCall = { page: number; y: number };

/** Records every string, rule and image drawn from now on, with the page it lands on. */
function record(doc: PDFDocument): { texts: DrawnText[]; lines: LineCall[]; images: number[] } {
  const texts = recordTexts(doc);
  const lines: LineCall[] = [];
  const images: number[] = [];
  vi.spyOn(doc.doc, 'line').mockImplementation(function (...args: unknown[]) {
    lines.push({ page: currentPage(doc), y: args[1] as number });
    return doc.doc;
  });
  vi.spyOn(doc.doc, 'addImage').mockImplementation(function () {
    images.push(currentPage(doc));
    return doc.doc;
  });
  return { texts, lines, images };
}

/** The text of a call, its lines joined. */
const shown = (call: DrawnText) => call.lines.join(' ');

/** A document with a cover, two body pages and a back cover: physical pages 1 (cover), 2, 3, 4 (back cover). */
function coveredDoc(): PDFDocument {
  const doc = makeDoc();
  doc.cover('Title', { variant: 'wave' });
  // The cover leaves the document on a fresh page.
  doc.paragraph('Page two.');
  doc.addPage().paragraph('Page three.');
  doc.backCover({});
  return doc;
}

describe('pageHeader', () => {
  it('draws on the numbered pages only', () => {
    const doc = coveredDoc();
    doc.pageHeader({ title: 'Annual report', folio: true });
    const { texts, lines } = record(doc);
    doc.finalize();

    expect(texts.filter((call) => shown(call) === 'ANNUAL REPORT').map((call) => call.page)).toEqual([2, 3]);
    expect(texts.filter((call) => /^0\d$/.test(shown(call))).map((call) => shown(call))).toEqual(['01', '02']);
    expect(lines.filter((call) => call.y === CHROME.header.ruleFromTop).map((call) => call.page)).toEqual([2, 3]);
  });

  it('draws the folio alone, and the title alone', () => {
    const folioOnly = makeDoc();
    folioOnly.paragraph('Body').addPage().paragraph('More').pageHeader({ folio: true });
    const folios = record(folioOnly);
    folioOnly.finalize();
    expect(folios.texts.filter((call) => /^0\d$/.test(shown(call))).map((call) => shown(call))).toEqual(['01', '02']);
    expect(folios.texts.filter((call) => /[A-Z]{3}/.test(shown(call)))).toEqual([]);

    const titleOnly = makeDoc();
    titleOnly.paragraph('Body').pageHeader({ title: 'Report' });
    const titles = record(titleOnly);
    titleOnly.finalize();
    expect(titles.texts.map((call) => shown(call))).toContain('REPORT');
    expect(titles.texts.filter((call) => /^0\d$/.test(shown(call)))).toEqual([]);
  });

  it('is drawn on the pages the table of contents inserts', () => {
    const doc = makeDoc();
    doc.cover('Title', { variant: 'wave' });
    doc.tableOfContents();
    for (let index = 1; index <= 90; index++) doc.heading(`Section ${index}`, { level: 'h2' }).paragraph('Body.');
    doc.pageHeader({ title: 'Report' });
    const pagesBefore = doc.doc.getNumberOfPages();
    const { texts } = record(doc);
    doc.finalize();

    const total = doc.doc.getNumberOfPages();
    expect(total).toBeGreaterThan(pagesBefore);
    const pages = texts.filter((call) => shown(call) === 'REPORT').map((call) => call.page);
    expect(pages).toEqual(Array.from({ length: total - 1 }, (_, index) => index + 2));
  });

  it('is drawn on a continuation page, whose content starts below the rule', () => {
    const doc = makeDoc();
    doc.pageHeader({ title: 'Report' });
    for (let index = 0; index < 120; index++) doc.paragraph(`Line ${index}`);
    const { lines } = record(doc);
    doc.finalize();

    expect(doc.doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(lines.some((call) => call.page === 2 && call.y === CHROME.header.ruleFromTop)).toBe(true);
    expect(doc.margins.top).toBeGreaterThan(CHROME.header.ruleFromTop);
  });

  it('places the first body line of page two below the rule', () => {
    const doc = makeDoc();
    doc.pageHeader({ title: 'Report' });
    const { texts } = record(doc);
    doc.addPage().paragraph('First line');
    const first = texts.find((call) => shown(call) === 'First line')!;
    expect(first.page).toBe(2);
    expect(first.y).toBeGreaterThan(CHROME.header.ruleFromTop);
  });

  it('starts an empty first page under the rule, not at margins.top, when firstPageTop < rule < margins.top', () => {
    const rule = CHROME.header.reserve;
    const doc = makeDoc({ firstPageTop: 10, margins: { top: 30 } });
    doc.pageHeader({ title: 'Report' });
    expect(doc.warnings).toEqual([]);
    expect(doc.firstPageTop).toBe(rule);
    expect(doc.getYPos()).toBe(rule);
    expect(doc.margins.top).toBe(30);
    expect(doc.addPage().getYPos()).toBe(30);
  });

  it('widens a small top margin so the content starts below the rule, without a warning', () => {
    const doc = makeDoc({ margins: { top: 10 }, firstPageTop: 10 });
    doc.pageHeader({ title: 'Report' });
    expect(doc.warnings).toEqual([]);
    expect(doc.margins.top).toBe(CHROME.header.reserve);
    expect(doc.getYPos()).toBe(doc.margins.top);

    const { texts } = record(doc);
    doc.paragraph('First line').addPage().paragraph('Continuation line');
    for (const value of ['First line', 'Continuation line']) {
      const call = texts.find((entry) => shown(entry) === value)!;
      expect(call.y).toBeGreaterThan(CHROME.header.ruleFromTop);
    }
    expect(doc.warnings).toEqual([]);
  });

  it('keeps a larger top margin', () => {
    const doc = makeDoc({ margins: { top: 30 } });
    doc.pageHeader({ title: 'Report' });
    expect(doc.margins.top).toBe(30);
  });

  it('restores the header reserve after a keepTogether measuring pass', () => {
    const doc = makeDoc({ margins: { top: 10 }, firstPageTop: 10 });
    doc.paragraph('Intro');
    let calls = 0;
    // Declares the header on the measuring pass only: nothing of it may remain.
    doc.keepTogether(() => {
      if (calls++ === 0) doc.pageHeader({ title: 'Report' });
    });
    expect(calls).toBe(2);
    expect(doc.margins.top).toBe(10);
    const { texts } = record(doc);
    doc.finalize();
    expect(texts.some((call) => shown(call) === 'Report')).toBe(false);
    expect(doc.warnings).toEqual([]);
  });

  it('applies the header reserve and its warning once when keepTogether declares it', () => {
    const rule = CHROME.header.reserve;
    const doc = makeDoc({ margins: { top: 10 }, firstPageTop: 10 });
    doc.paragraph('Intro');
    doc.keepTogether(() => doc.pageHeader({ title: 'Report' }));
    expect(doc.margins.top).toBe(rule);
    expect(doc.warnings.filter((warning) => warning.includes('pageHeader()'))).toHaveLength(1);
  });

  it('warns when the first page already has content above the rule', () => {
    const doc = makeDoc({ margins: { top: 10 } });
    doc.paragraph('Already there');
    doc.pageHeader({ title: 'Report' });
    expect(doc.warnings.some((warning) => warning.includes('pageHeader()'))).toBe(true);
    expect(makeDoc().paragraph('Body').pageHeader({ title: 'x' }).warnings).toEqual([]);
  });

  it('moves the start of a fresh page after the cover under the rule', () => {
    const doc = makeDoc({ margins: { top: 10 } });
    doc.cover('T', { variant: 'wave' });
    doc.pageHeader({ title: 'Report' });
    expect(doc.warnings).toEqual([]);
    expect(doc.getYPos()).toBe(doc.margins.top);
  });

  it('cuts a title too long for the line short with an ellipsis, before the page number', () => {
    const doc = makeDoc();
    doc.pageHeader({ title: 'A very long running title that cannot possibly fit on one line '.repeat(4), folio: true });
    doc.paragraph('Body');
    const { texts } = record(doc);
    doc.finalize();

    const title = texts.find((call) => shown(call).endsWith('…'))!;
    const folio = texts.find((call) => shown(call) === '01')!;
    expect(title).toBeDefined();
    doc.doc.setFont(doc.doc.getFont().fontName, 'bold');
    doc.doc.setFontSize(doc.theme.typography.sizes.footer);
    const end = title.x + doc.doc.getTextWidth(shown(title)) + CHROME.tracking * (shown(title).length - 1);
    const folioStart = folio.x - doc.doc.getTextWidth('01');
    expect(end).toBeLessThanOrEqual(folioStart);
  });

  it('keeps a title that fits', () => {
    const doc = makeDoc();
    doc.pageHeader({ title: 'Report', folio: true });
    doc.paragraph('Body');
    const { texts } = record(doc);
    doc.finalize();
    expect(texts.some((call) => shown(call) === 'REPORT')).toBe(true);
  });

  it('draws nothing when it is not declared', () => {
    const doc = makeDoc();
    doc.paragraph('Body');
    const { lines } = record(doc);
    doc.finalize();
    expect(lines.filter((call) => call.y === CHROME.header.ruleFromTop)).toEqual([]);
  });
});

describe('pageFooter', () => {
  it('replaces the default page numbers and skips the covers', () => {
    const doc = coveredDoc();
    doc.pageFooter({ left: 'Acme Corp', right: '{page}/{pages}' });
    const { texts, lines } = record(doc);
    doc.finalize();

    expect(texts.filter((call) => shown(call) === 'ACME CORP').map((call) => call.page)).toEqual([2, 3]);
    expect(texts.filter((call) => /^\d+\/\d+$/.test(shown(call))).map((call) => [call.page, shown(call)])).toEqual([
      [2, '1/2'],
      [3, '2/2'],
    ]);
    expect(lines.map((call) => call.page)).toEqual([2, 3]);
  });

  it('draws the default "n/N" on the right of the same footer when none is declared, and none without the tokens', () => {
    const plain = coveredDoc();
    const plainCalls = record(plain);
    plain.finalize();
    expect(plainCalls.texts.map((call) => [call.page, shown(call)])).toEqual([
      [2, '1/2'],
      [3, '2/2'],
    ]);
    const declared = coveredDoc();
    declared.pageFooter({ right: '{page}/{pages}' });
    const declaredCalls = record(declared);
    declared.finalize();
    expect(plainCalls.texts).toEqual(declaredCalls.texts);
    expect(plainCalls.lines).toEqual(declaredCalls.lines);
    const inFooterZone = plainCalls.texts[0].y > plain.pageHeight - plain.margins.bottom;
    expect(inFooterZone).toBe(true);
    expect(plainCalls.texts[0].x).toBeGreaterThan(plain.margins.left + plain.contentWidth / 2);

    const labelled = makeDoc();
    labelled.paragraph('Body');
    labelled.pageFooter({ left: 'Only a label' });
    const labelledCalls = record(labelled);
    labelled.finalize();
    expect(labelledCalls.texts.map((call) => shown(call))).toEqual(['ONLY A LABEL']);
  });

  it('draws no footer at all with false, even with a theme logo', () => {
    const doc = new PDFDocument({ theme: createTheme({ name: 't', assets: { footerLogo: loadLogo() } }) });
    doc.paragraph('Body').pageFooter(false);
    const { texts, lines, images } = record(doc);
    doc.finalize();
    expect(texts).toEqual([]);
    expect(lines).toEqual([]);
    expect(images).toEqual([]);
    expect(doc.warnings).toEqual([]);
  });

  it('draws the labels without the rule with rule: false', () => {
    const doc = makeDoc();
    doc.paragraph('Body').pageFooter({ right: '{page}/{pages}', rule: false });
    const { texts, lines } = record(doc);
    doc.finalize();
    expect(lines).toEqual([]);
    expect(texts.map((call) => shown(call))).toEqual(['1/1']);
  });

  it('draws inside the footer zone, below the content limit', () => {
    const doc = makeDoc();
    doc.paragraph('Body');
    doc.pageFooter({ left: 'Left', logo: loadLogo() });
    const { texts, lines } = record(doc);
    doc.finalize();
    const limit = doc.pageHeight - doc.margins.bottom;
    expect(lines[0].y).toBeGreaterThan(limit);
    expect(texts[0].y).toBeGreaterThan(lines[0].y);
    expect(texts[0].y).toBeLessThan(doc.pageHeight - 2);
  });

  it('draws the logo on the numbered pages only, from the option or the theme asset', () => {
    const doc = coveredDoc();
    doc.pageFooter({ logo: loadLogo() });
    const { images } = record(doc);
    doc.finalize();
    expect(images).toEqual([2, 3]);

    const themed = new PDFDocument({ theme: createTheme({ name: 't', assets: { footerLogo: loadLogo() } }) });
    themed.paragraph('Body').pageFooter({ right: '{page}' });
    const themedCalls = record(themed);
    themed.finalize();
    expect(themedCalls.images).toEqual([1]);
  });

  it('drops the logo with a warning when the labels leave no room', () => {
    const doc = makeDoc();
    doc.paragraph('Body');
    doc.pageFooter({ left: 'A very long left label '.repeat(8), logo: loadLogo() });
    const { images } = record(doc);
    doc.finalize();
    expect(images).toEqual([]);
    expect(doc.warnings.some((warning) => warning.startsWith('Failed to draw footer logo: '))).toBe(true);
  });

  it('drops a logo that cannot be read, once, with a warning', () => {
    const doc = makeDoc();
    doc.paragraph('Body').addPage().paragraph('More');
    doc.pageFooter({ logo: 'missing' });
    const { images } = record(doc);
    doc.finalize();
    expect(images).toEqual([]);
    expect(doc.warnings).toEqual([
      'Failed to draw footer logo: "missing" is neither a registered image name nor readable image data',
    ]);
  });

  it('warns when the footer zone is too small', () => {
    const doc = makeDoc({ margins: { bottom: 8 } });
    doc.pageFooter({ left: 'x' });
    expect(doc.warnings.some((warning) => warning.includes('pageFooter()'))).toBe(true);
  });

  it('keeps the default footer on the page and warns when the zone is too small', () => {
    const doc = makeDoc({ margins: { bottom: 5 } });
    doc.paragraph('Body');
    const { texts } = record(doc);
    doc.finalize();
    expect(texts[0].y).toBeLessThan(doc.pageHeight);
    expect(doc.warnings.some((warning) => warning.includes('bottom margin'))).toBe(true);
  });

  it('follows the chrome tokens of the theme', () => {
    const doc = new PDFDocument({ theme: createTheme({ name: 't', chrome: { uppercase: false } }) });
    doc.paragraph('Body').pageFooter({ left: 'Mixed Case page {page}' });
    const { texts } = record(doc);
    doc.finalize();
    expect(shown(texts[0])).toBe('Mixed Case page 1');
  });
});

describe('custom pageHeader and pageFooter', () => {
  it('runs draw on the numbered pages, the footer first, with the printed number and the page count', () => {
    const doc = coveredDoc();
    const calls: string[] = [];
    const log =
      (kind: string) =>
      (ctx: PDFDocument, { page, pages }: { page: number; pages: number }) => {
        calls.push(`${kind} on ${currentPage(ctx)}: ${page}/${pages}`);
      };
    doc.pageHeader({ variant: 'custom', draw: log('header') });
    doc.pageFooter({ variant: 'custom', draw: log('footer') });
    doc.finalize();

    expect(calls).toEqual(['footer on 2: 1/2', 'footer on 3: 2/2', 'header on 2: 1/2', 'header on 3: 2/2']);
  });

  it('draws nothing of the plain chrome: no default footer, no theme logo, no short-margin warning', () => {
    const doc = new PDFDocument({
      theme: createTheme({ name: 't', assets: { footerLogo: loadLogo() } }),
      margins: { bottom: 5 },
    });
    doc.paragraph('Body');
    doc.pageHeader({ variant: 'custom', draw: () => {} }).pageFooter({ variant: 'custom', draw: () => {} });
    const { texts, lines, images } = record(doc);
    doc.finalize();
    expect(texts).toEqual([]);
    expect(lines).toEqual([]);
    expect(images).toEqual([]);
    expect(doc.warnings).toEqual([]);
  });

  it('starts every page from the body style, whatever the page before set', () => {
    const doc = makeDoc();
    doc.paragraph('One').addPage().paragraph('Two');
    const seen: unknown[] = [];
    doc.pageHeader({
      variant: 'custom',
      draw: (ctx) => {
        const { fontName, fontStyle } = ctx.doc.getFont();
        seen.push({ fontName, fontStyle, size: ctx.doc.getFontSize(), color: ctx.doc.getTextColor() });
        ctx.doc.setFont('times', 'italic');
        ctx.doc.setFontSize(48);
        ctx.doc.setTextColor('#ff0000');
      },
    });
    doc.finalize();

    const reference = makeDoc();
    setTextStyle(reference, 'body');
    const { fontName, fontStyle } = reference.doc.getFont();
    const body = { fontName, fontStyle, size: reference.doc.getFontSize(), color: reference.doc.getTextColor() };
    expect(seen).toEqual([body, body]);
  });

  it('raises a lower top margin to its reserve and starts an empty first page under it', () => {
    const doc = makeDoc({ margins: { top: 10 }, firstPageTop: 10 });
    doc.pageHeader({ variant: 'custom', reserve: 30, draw: () => {} });
    expect(doc.margins.top).toBe(30);
    expect(doc.getYPos()).toBe(30);
    expect(doc.addPage().getYPos()).toBe(30);
    expect(doc.warnings).toEqual([]);
  });

  it('leaves the margins as they are without a reserve', () => {
    const doc = makeDoc({ margins: { top: 10 }, firstPageTop: 10 });
    doc.pageHeader({ variant: 'custom', draw: () => {} });
    expect(doc.margins.top).toBe(10);
    expect(doc.getYPos()).toBe(10);
  });

  it('warns when content already sits in its reserve', () => {
    const doc = makeDoc();
    doc.paragraph('Already there');
    doc.pageHeader({ variant: 'custom', reserve: 30, draw: () => {} });
    expect(doc.warnings).toEqual([
      'pageHeader() declared after content started above its rule: the header needs the top 30 mm; ' +
        'declare it before the content',
    ]);
  });

  it('replaces a plain header: an empty page goes back up to the top it sets', () => {
    const doc = makeDoc({ margins: { top: 10 }, firstPageTop: 10 });
    doc.pageHeader({ title: 'Report' });
    expect(doc.getYPos()).toBe(CHROME.header.reserve);
    doc.pageHeader({ variant: 'custom', draw: () => {} });
    expect(doc.margins.top).toBe(10);
    expect(doc.getYPos()).toBe(10);
    doc.paragraph('Body');
    const { texts } = record(doc);
    doc.finalize();
    expect(texts.some((call) => shown(call) === 'REPORT')).toBe(false);
  });

  it("takes variant: 'plain' as the default", () => {
    const doc = makeDoc();
    doc.paragraph('Body');
    doc.pageHeader({ variant: 'plain', title: 'Report' }).pageFooter({ variant: 'plain', left: 'Acme' });
    const { texts } = record(doc);
    doc.finalize();
    expect(texts.map((call) => shown(call))).toEqual(['ACME', 'REPORT']);
  });

  it('warns that a block drawn from draw comes after finalize()', () => {
    const doc = makeDoc();
    doc.paragraph('Body');
    doc.pageFooter({ variant: 'custom', draw: (ctx) => ctx.separator() });
    doc.finalize();
    expect(doc.warnings.some((warning) => warning.startsWith('Drawing after finalize()'))).toBe(true);
  });

  it('draws a block from the top of each page and leaves the flow as it was', () => {
    const doc = makeDoc();
    doc.paragraph('One').addPage().paragraph('Two').addPage().paragraph('Three');
    const end = doc.peekYPos();
    const starts: number[] = [];
    doc.pageFooter({
      variant: 'custom',
      draw: (ctx) => {
        starts.push(ctx.peekYPos());
        ctx.heading('Waiting');
        ctx.separator();
      },
    });
    doc.finalize();
    expect(starts).toEqual([doc.margins.top, doc.margins.top, doc.margins.top]);
    expect(doc.peekYPos()).toBe(end);
    expect(doc.doc.getNumberOfPages()).toBe(3);
  });

  it('puts the flow back when draw throws', () => {
    const doc = makeDoc();
    doc.paragraph('One');
    const end = doc.peekYPos();
    doc.pageFooter({
      variant: 'custom',
      draw: (ctx) => {
        ctx.heading('Waiting');
        throw new Error('boom');
      },
    });
    expect(() => doc.finalize()).toThrow('boom');
    expect(doc.peekYPos()).toBe(end);
  });

  it('stops finalize and propagates when draw throws, jsPDF back on its page', () => {
    const doc = makeDoc();
    doc.paragraph('One').addPage().paragraph('Two').addPage().paragraph('Three').backCover();
    doc.pageFooter(false);
    const reached: number[] = [];
    doc.pageHeader({
      variant: 'custom',
      draw: (_ctx, { page }) => {
        reached.push(page);
        if (page === 2) throw new Error('boom');
      },
    });
    expect(() => doc.finalize()).toThrow('boom');
    expect(reached).toEqual([1, 2]);
    expect(doc.pageNumber).toBe(4);
  });
});
