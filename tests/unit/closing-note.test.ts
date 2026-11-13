import { describe, expect, it, vi } from 'vitest';

import { measureTextLevel } from '../../src/drawing/text';
import { drawClosingNote } from '../../src/page/closing-note';
import { type DrawnText, makeDoc, recordTexts } from './helpers';

/** The text of a call, its lines joined. */
const shown = (call: DrawnText) => call.lines.join(' ');

describe('closingNote', () => {
  it('closes the page: the next content starts on the next page', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.paragraph('Body').closingNote('Legal mention').paragraph('Next');

    const body = texts.find((call) => shown(call) === 'Body')!;
    const legal = texts.find((call) => shown(call) === 'Legal mention')!;
    const next = texts.find((call) => shown(call) === 'Next')!;
    const limit = doc.pageHeight - doc.margins.bottom;
    expect([body.page, legal.page, next.page]).toEqual([1, 1, 2]);
    expect(legal.y).toBeGreaterThan(body.y);
    expect(legal.y).toBeLessThan(limit);
    expect(next.y).toBeGreaterThan(doc.margins.top);
  });

  it('moves to the next page when it does not fit under the content, without overlap', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const limit = doc.pageHeight - doc.margins.bottom;
    doc.setYPos(limit - 1).closingNote('Legal mention');

    const legal = texts.find((call) => shown(call) === 'Legal mention')!;
    expect(legal.page).toBe(2);
    expect(legal.y).toBeLessThan(limit);
    expect(legal.y).toBeGreaterThan(doc.margins.top);
    expect(doc.getYPos()).toBe(limit);
  });

  it('draws nothing and closes nothing for an empty text', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.paragraph('Body', { spaceAfter: 3 });
    const y = doc.peekYPos();
    const bottom = doc.contentBottom();
    expect(drawClosingNote(doc, '')).toBe(y);
    doc.closingNote('').paragraph('Next');
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(doc.contentBottom()).toBeLessThan(doc.pageHeight - doc.margins.bottom);
    expect(texts.map(shown)).toEqual(['Body', 'Next']);
    expect(doc.contentBottom() - bottom).toBeGreaterThan(0);
  });

  it('keeps its own font when the page break runs an onNewPage hook that changes it', () => {
    const doc = makeDoc();
    const sizes: number[] = [];
    const nativeText = doc.doc.text.bind(doc.doc);
    vi.spyOn(doc.doc, 'text').mockImplementation(function (...args: Parameters<typeof nativeText>) {
      if (String(args[0]) === 'Legal mention') sizes.push(doc.doc.getFontSize());
      return nativeText(...args);
    });
    doc.onNewPage(() => {
      doc.doc.setFontSize(40);
    });
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 1).closingNote('Legal mention');
    expect(sizes).toEqual([doc.theme.typography.sizes.footer]);
  });

  it('sits theme.spacing.block above the bottom of the content area unless bottomGap says otherwise', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const limit = doc.pageHeight - doc.margins.bottom;
    const { lineHeight, ascent } = measureTextLevel(doc, 'footer');
    doc.closingNote('Default').closingNote('Custom', { bottomGap: 10 });
    const [defaultNote, customNote] = texts;
    expect(defaultNote.y).toBeCloseTo(limit - doc.theme.spacing.block - lineHeight + ascent, 6);
    expect(customNote.page).toBe(2);
    expect(customNote.y).toBeCloseTo(limit - 10 - lineHeight + ascent, 6);
    expect(doc.contentBottom()).toBe(limit);
  });

  it('draws in the secondary color', () => {
    const doc = makeDoc();
    doc.doc.setTextColor(doc.theme.colors.secondary);
    const expected = doc.doc.getTextColor();
    const colors: string[] = [];
    const nativeText = doc.doc.text.bind(doc.doc);
    vi.spyOn(doc.doc, 'text').mockImplementation(function (...args: Parameters<typeof nativeText>) {
      colors.push(doc.doc.getTextColor());
      return nativeText(...args);
    });
    doc.closingNote('Legal mention');
    expect(colors).toEqual([expected]);
  });
});
