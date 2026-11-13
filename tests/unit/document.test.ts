import { readFileSync } from 'node:fs';

import { jsPDF } from 'jspdf';
import { describe, expect, it, vi } from 'vitest';

import { CHROME, SPACING, TABLE, lineHeightMm } from '../../src/core/constants';
import { PDFDocument } from '../../src/core/document';
import { InvalidColorError, InvalidOptionError } from '../../src/core/errors';
import { drawHeading, measureTextLevel, setTextStyle } from '../../src/drawing/text';
import { INTER_FAMILY, interFonts } from '../../src/fonts/inter';
import { loadFontFromBase64, loadFontFromBinary } from '../../src/fonts/loader';
import { createTheme } from '../../src/theme/defaults';
import {
  currentPage,
  lastEntryPage,
  lastText,
  leaveRoom,
  makeDoc,
  pageStream,
  PNG,
  scanPage,
  scanPages,
  setForeignState,
  drawingState,
  LONG,
  TALL_PNG,
  WIDE_PNG,
  recordTexts,
  textOf,
  titleY,
} from './helpers';

function makeDocOnBackground(background = '#F5F0E6'): PDFDocument {
  return makeDoc({ theme: createTheme({ colors: { primary: '#3572B8', background } }) });
}

// Full-page fills are the theme background; tables draw smaller rects.
function countBackgroundFills(doc: PDFDocument, spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter(
    ([x, y, w, h, style]) => x === 0 && y === 0 && w === doc.pageWidth && h === doc.pageHeight && style === 'F',
  ).length;
}

/** Height (mm) of the content area of a page after the first. */
const usableHeight = (doc: PDFDocument) => doc.layout.bottom(doc.pageHeight) - doc.layout.topFor(2);

describe('ensureSpace', () => {
  it('does not add a page when already at the top of a page', () => {
    const doc = makeDocOnBackground();
    expect(doc.getYPos()).toBe(doc.margins.top);
    expect(doc.ensureSpace(50)).toBe(false);
    expect(doc.doc.getNumberOfPages()).toBe(1);
  });

  it('warns without adding a page when the block is taller than a page', () => {
    const doc = makeDocOnBackground();
    expect(doc.ensureSpace(doc.pageHeight)).toBe(false);
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(doc.warnings).toHaveLength(1);
  });

  it('adds a page when the remaining space is too small', () => {
    const doc = makeDocOnBackground();
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 5);
    expect(doc.ensureSpace(20)).toBe(true);
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(doc.getYPos()).toBe(doc.margins.top);
  });

  describe('with a lead', () => {
    it('warns once, on the lead and the block, when the page breaks', () => {
      const doc = makeDocOnBackground();
      doc.setYPos(doc.pageHeight - doc.margins.bottom - 5);
      const height = usableHeight(doc) - 10;
      expect(doc.ensureSpace(height, { lead: 20 })).toBe(true);
      expect(doc.warnings).toEqual([expect.stringContaining(`Block of ${(height + 20).toFixed(1)} mm`)]);
    });

    it('does not count the lead when the page does not break', () => {
      const doc = makeDocOnBackground();
      expect(doc.ensureSpace(usableHeight(doc) - 10, { lead: 20 })).toBe(false);
      expect(doc.warnings).toEqual([]);
    });

    it('does not let the lead decide the break', () => {
      const doc = makeDocOnBackground();
      doc.paragraph('Opening text.');
      doc.setYPos(doc.layout.bottom(doc.pageHeight) - 30);
      expect(doc.ensureSpace(20, { lead: 50 })).toBe(false);
    });
  });
});

describe('page decoration', () => {
  it('paints the background and runs the hook once per added page', () => {
    const doc = makeDocOnBackground();
    const hook = vi.fn();
    doc.onNewPage(hook);
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.addPage();
    expect(countBackgroundFills(doc, rect)).toBe(1);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('decorates table continuation pages', () => {
    const doc = makeDocOnBackground();
    const hook = vi.fn();
    doc.onNewPage(hook);
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.table(
      Array.from({ length: 120 }, (_, i) => ({ item: `Row ${i}`, value: String(i) })),
      {
        columns: [
          { header: 'Item', key: 'item' },
          { header: 'Value', key: 'value' },
        ],
      },
    );
    const added = doc.doc.getNumberOfPages() - 1;
    expect(added).toBeGreaterThan(0);
    expect(hook).toHaveBeenCalledTimes(added);
    expect(countBackgroundFills(doc, rect)).toBe(added);
  });

  it('skips the fill for a white background', () => {
    const doc = makeDocOnBackground('#ffffff');
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.addPage();
    expect(countBackgroundFills(doc, rect)).toBe(0);
  });

  it.each(['#fff', 'FFF', 'ffffff'])('skips the fill for the white shorthand %s', (white) => {
    const doc = makeDocOnBackground(white);
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.addPage();
    expect(countBackgroundFills(doc, rect)).toBe(0);
  });

  it('paints the theme background on a back cover', () => {
    const doc = makeDocOnBackground();
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.backCover({});
    expect(countBackgroundFills(doc, rect)).toBe(1);
  });
});

/** The strings each page paints, in the order its content stream paints them, as the stream writes them. */
const paintedTexts = (doc: PDFDocument) =>
  scanPages(doc).map((scan) => scan.marks.flatMap((mark) => (mark.kind === 'text' ? [mark.raw] : [])));

describe('watermark', () => {
  it('is the last thing drawn on its page, over the content, the running header and the footer', () => {
    const doc = makeDocOnBackground();
    doc.watermark('DRAFT').pageHeader({ title: 'Report' });
    doc
      .paragraph('Body.')
      .infoBox('Boxed.', { title: 'Box' })
      .table([{ a: 'Cell' }], { columns: [{ header: 'A', key: 'a' }] });
    doc.finalize();
    const marks = scanPage(doc, 1).marks;
    expect(marks.at(-1)).toMatchObject({ kind: 'text', raw: '(DRAFT)', opacity: 0.08, angle: -45 });
    expect(marks.filter((mark) => mark.kind === 'text' && mark.raw === '(DRAFT)')).toHaveLength(1);
    expect(paintedTexts(doc)[0]).toEqual(expect.arrayContaining(['(Body.)', '(1/1)', '(REPORT)']));
  });

  it('with allPages, marks every page once: cover, blank page, back cover and pages added before or after it', () => {
    const doc = makeDocOnBackground();
    doc.cover('Title', { variant: 'wave' }).paragraph('Before.');
    doc.watermark('DRAFT', { allPages: true });
    doc.addPage({ blank: true }).addPage().paragraph('After.').backCover({});
    doc.finalize();
    expect(paintedTexts(doc).map((texts) => [texts.at(-1), texts.filter((text) => text === '(DRAFT)').length])).toEqual(
      Array.from({ length: 5 }, () => ['(DRAFT)', 1]),
    );
  });

  it('without allPages, marks only the page where it is called', () => {
    const doc = makeDoc();
    doc.paragraph('One.').addPage().paragraph('Two.').watermark('DRAFT').addPage().paragraph('Three.');
    doc.finalize();
    expect(paintedTexts(doc).map((texts) => texts.includes('(DRAFT)'))).toEqual([false, true, false]);
  });

  it('follows a keepTogether block it is called in to the next page, once', () => {
    const doc = makeDoc();
    leaveRoom(doc, 10);
    doc.keepTogether(() => doc.watermark('DRAFT').infoBox(LONG, { title: 'Moved' }));
    expect(doc.pageNumber).toBe(2);
    doc.finalize();
    expect(paintedTexts(doc).map((texts) => texts.filter((text) => text === '(DRAFT)').length)).toEqual([0, 1]);
  });

  it('registers an allPages watermark once, not once per measuring pass', () => {
    const doc = makeDoc();
    leaveRoom(doc, 10);
    doc.keepTogether(() => doc.watermark('DRAFT', { allPages: true }).infoBox(LONG, { title: 'Moved' }));
    doc.finalize();
    expect(paintedTexts(doc).map((texts) => texts.filter((text) => text === '(DRAFT)').length)).toEqual([1, 1]);
  });

  it.each([
    ['before the content', (doc: PDFDocument, mark: () => void) => (mark(), doc.paragraph('Body.'))],
    ['after the content', (doc: PDFDocument, mark: () => void) => (doc.paragraph('Body.'), mark())],
  ])('draws the same page, without a warning, called %s', (_name, order) => {
    const render = (allPages: boolean) => {
      const doc = makeDoc();
      order(doc, () => doc.watermark('DRAFT', { allPages }));
      doc.finalize();
      expect(doc.warnings).toEqual([]);
      return pageStream(doc, 1);
    };
    const reference = makeDoc().paragraph('Body.').watermark('DRAFT').finalize();
    expect(render(false)).toBe(pageStream(reference, 1));
    expect(render(true)).toBe(pageStream(reference, 1));
  });

  it('draws the allPages watermarks first, then those of the page in call order', () => {
    const doc = makeDoc();
    doc.watermark('B').paragraph('Body.').watermark('A', { allPages: true }).watermark('C');
    doc.finalize();
    expect(paintedTexts(doc)[0].slice(-3)).toEqual(['(A)', '(B)', '(C)']);
  });

  it('is drawn once, however many times the document is finalized or exported', () => {
    const doc = makeDoc();
    doc.watermark('DRAFT').watermark('ALL', { allPages: true }).finalize().finalize();
    doc.toBuffer();
    doc.toBuffer();
    expect(paintedTexts(doc)[0]).toEqual(['(1/1)', '(ALL)', '(DRAFT)']);
  });

  it('throws for an invalid option at the call, and leaves nothing to draw', () => {
    const doc = makeDoc();
    expect(() => doc.watermark('DRAFT', { opacity: 2 })).toThrow(InvalidOptionError);
    expect(() => doc.watermark('DRAFT', { allPages: true, fontSize: 0 })).toThrow(InvalidOptionError);
    doc.finalize();
    expect(paintedTexts(doc)[0]).not.toContain('(DRAFT)');
  });

  it('leaves jsPDF on the page it was on, with the drawing state it had', () => {
    const doc = makeDoc().pageFooter(false);
    doc.watermark('DRAFT', { allPages: true }).addPage().addPage();
    doc.doc.setPage(2);
    setForeignState(doc);
    const before = drawingState(doc);
    doc.finalize();
    expect(doc.pageNumber).toBe(2);
    expect(drawingState(doc)).toEqual(before);
    expect(paintedTexts(doc)).toEqual([['(DRAFT)'], ['(DRAFT)'], ['(DRAFT)']]);
  });

  describe('after finalize()', () => {
    const LATE =
      'Drawing after finalize(): page numbers and footers are already rendered and do not account for new content';

    it('draws a watermark of the current page at once, with a warning', () => {
      const doc = makeDoc().pageFooter(false);
      doc.paragraph('Body.').addPage().finalize();
      doc.doc.setPage(1);
      doc.watermark('LATE');
      expect(doc.warnings).toEqual([LATE]);
      expect(paintedTexts(doc)).toEqual([['(Body.)', '(LATE)'], []]);
    });

    it('draws an allPages watermark on every page at once, and on the pages added later, with a warning', () => {
      const doc = makeDoc().pageFooter(false);
      doc.addPage().finalize();
      doc.watermark('LATE', { allPages: true });
      doc.addPage();
      expect(doc.warnings).toEqual([LATE]);
      expect(paintedTexts(doc)).toEqual([['(LATE)'], ['(LATE)'], ['(LATE)']]);
    });

    it('draws on a page added after it the allPages watermarks registered before it', () => {
      const doc = makeDoc().pageFooter(false);
      doc.watermark('DRAFT', { allPages: true }).finalize().addPage({ blank: true });
      expect(paintedTexts(doc)).toEqual([['(DRAFT)'], ['(DRAFT)']]);
    });
  });
});

describe('insertPagesAfter', () => {
  it('does nothing for a count of zero or less', () => {
    const doc = makeDocOnBackground();
    doc.cover('Title', { variant: 'wave' });
    doc.backCover({});
    const pages = doc.doc.getNumberOfPages();
    const backCover = doc.backCoverPage;
    doc.insertPagesAfter(1, 0);
    doc.insertPagesAfter(1, -2);
    expect(doc.doc.getNumberOfPages()).toBe(pages);
    expect(doc.backCoverPage).toBe(backCover);
  });

  it('shifts the references past the inserted pages', () => {
    const doc = makeDocOnBackground();
    doc.cover('Title', { variant: 'wave' });
    doc.backCover({});
    const backCover = doc.backCoverPage!;
    doc.insertPagesAfter(1, 2);
    expect(doc.backCoverPage).toBe(backCover + 2);
    expect(doc.coverPage).toBe(1);
  });
});

describe('watermarks recorded by the onNewPage hook on inserted pages', () => {
  it('stay on the inserted page, not on the page that took its number', () => {
    const doc = makeDocOnBackground().pageFooter(false);
    doc.paragraph('One').addPage().paragraph('Two').addPage().paragraph('Three');
    doc.onNewPage(() => doc.watermark('NEW'));
    doc.insertPagesAfter(1, 1);
    doc.finalize();
    expect(paintedTexts(doc).map((texts) => texts.includes('(NEW)'))).toEqual([false, true, false, false]);
  });
});

describe('hand-built theme background', () => {
  it('treats a short-hand white background as no fill', () => {
    const base = createTheme({ name: 't' });
    const theme = { ...base, colors: { ...base.colors, background: '#fff' } };
    const doc = new PDFDocument({ theme });
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.addPage();
    expect(countBackgroundFills(doc, rect)).toBe(0);
  });

  it('throws on an invalid background color', () => {
    const base = createTheme({ name: 't' });
    const theme = { ...base, colors: { ...base.colors, background: 'white' } };
    expect(() => new PDFDocument({ theme })).toThrow();
  });
});

describe('keepTogether', () => {
  it('keeps measuring-pass warnings and pages out of the document', () => {
    const doc = makeDocOnBackground();
    doc.paragraph('Intro');
    doc.keepTogether(() => doc.addWarning('once'));
    expect(doc.warnings).toEqual(['once']);
    expect(doc.doc.getNumberOfPages()).toBe(1);
  });

  it('prints a debug warning once, not once per pass', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = makeDoc({ debug: true });
    doc.keepTogether(() => doc.addWarning('once'));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('covers', () => {
  it('tracks cover pages by number and keeps the back cover undecorated', () => {
    const doc = makeDocOnBackground();
    doc.cover('Title', { variant: 'wave' });
    expect(doc.coverPage).toBe(1);
    doc.paragraph('Body');
    const hook = vi.fn();
    doc.onNewPage(hook);
    doc.backCover({});
    expect(doc.backCoverPage).toBe(doc.doc.getNumberOfPages());
    expect(hook).not.toHaveBeenCalled();
  });

  it('numbers every page except the covers', () => {
    const doc = makeDocOnBackground();
    doc.cover('Title', { variant: 'wave' });
    doc.addPage();
    doc.backCover({});
    expect([...doc.pageLabels]).toEqual([
      [2, 1],
      [3, 2],
    ]);
  });

  it('rolls back cover marks made during a keepTogether measuring pass', () => {
    const doc = makeDocOnBackground();
    doc.paragraph('Intro');
    // Only the measuring pass runs on a second (scratch) page.
    doc.keepTogether(() => {
      if (doc.doc.getNumberOfPages() > 1) doc.pageRefs.markBackCover(doc.pageNumber);
    });
    expect(doc.backCoverPage).toBeUndefined();
  });
});

describe('finalize', () => {
  it('warns once when drawing after finalize', () => {
    const doc = makeDocOnBackground();
    doc.finalize();
    doc.paragraph('late').paragraph('later');
    expect(doc.warnings).toHaveLength(1);
  });

  it('warns when finalize is called after export', () => {
    const doc = makeDocOnBackground();
    doc.toBuffer();
    doc.finalize();
    expect(doc.warnings).toHaveLength(1);
  });

  it('draws the page numbers, footers and header once: a second finalize or export adds nothing', () => {
    const doc = makeDoc();
    doc.paragraph('Body').pageHeader({ title: 'Report' }).pageFooter({ left: 'Acme', right: '{page}/{pages}' });
    const texts = recordTexts(doc);
    doc.finalize();
    const drawn = texts.map(({ lines }) => lines.join(' '));
    expect(drawn).toEqual(expect.arrayContaining(['REPORT', 'ACME', '1/1']));
    const stream = pageStream(doc, 1);

    doc.finalize();
    doc.toBuffer();
    doc.toBuffer();
    expect(texts).toHaveLength(drawn.length);
    expect(pageStream(doc, 1)).toBe(stream);
  });
});

describe.each([
  ['toDataUri', (doc: PDFDocument) => doc.toDataUri()],
  ['toBlob', (doc: PDFDocument) => doc.toBlob()],
] as const)('%s', (_method, exportDoc) => {
  it('finalizes the document first: the page numbers are drawn', () => {
    const doc = makeDocOnBackground().paragraph('Body');
    const text = vi.spyOn(doc.doc, 'text');
    exportDoc(doc);
    expect(text.mock.calls.map(([value]) => String(value))).toContain('1/1');
  });

  it('draws a heading that was still waiting for its block', () => {
    const doc = makeDocOnBackground().heading('Last heading');
    const text = vi.spyOn(doc.doc, 'text');
    exportDoc(doc);
    expect(text.mock.calls.map(([value]) => String(value))).toContain('Last heading');
  });

  it('draws a heading that came after finalize()', () => {
    const doc = makeDocOnBackground().paragraph('Body').finalize();
    doc.heading('Late heading');
    const text = vi.spyOn(doc.doc, 'text');
    exportDoc(doc);
    expect(text.mock.calls.map(([value]) => String(value))).toContain('Late heading');
  });

  it('marks the document as exported: drawing afterwards warns once', () => {
    const doc = makeDocOnBackground();
    exportDoc(doc);
    doc.paragraph('late').paragraph('later');
    expect(doc.warnings).toHaveLength(1);
  });
});

describe('toDataUri', () => {
  it('returns the PDF as a base64 data URI', () => {
    const uri = makeDocOnBackground().paragraph('Body').toDataUri();
    const match = /^data:application\/pdf;(?:[\w-]+=[^;]*;)*base64,(.+)$/.exec(uri);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('carries every page of the document', () => {
    const uri = makeDocOnBackground().paragraph('Body').addPage().paragraph('Next').toDataUri();
    const pdf = Buffer.from(uri.slice(uri.indexOf('base64,') + 7), 'base64').toString('latin1');
    expect(pdf).toMatch(/\/Count 2\b/);
  });
});

describe('toBlob', () => {
  it('returns a Blob of type application/pdf', () => {
    const blob = makeDocOnBackground().paragraph('Body').toBlob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });

  it('holds the bytes of the PDF', async () => {
    const doc = makeDocOnBackground().paragraph('Body');
    const blob = doc.toBlob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBe(doc.toBuffer().length);
  });
});

describe('addWarning', () => {
  it('records an identical message once', () => {
    const doc = makeDocOnBackground();
    doc.addWarning('same');
    doc.addWarning('same');
    doc.addWarning('other');
    expect(doc.warnings).toEqual(['same', 'other']);
  });
});

const themeWith = (fontFamily: string, titleFontFamily?: string, labelFontFamily?: string) =>
  createTheme({ typography: { fontFamily, titleFontFamily, labelFontFamily } });

describe('registerImage', () => {
  const JPEG =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

  it('lets icon options refer to the image by name', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('dot', PNG);
    doc.iconList(['One'], { icon: 'dot' });
    expect(doc.warnings).toEqual([]);
  });

  it('resolves a name that is not valid base64', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('arrow-right', PNG);
    doc.iconList(['One', 'Two'], { icon: 'arrow-right' });
    expect(doc.warnings).toEqual([]);
  });

  it('warns that the first image is kept when a name is registered again with another image', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('dot', PNG);
    doc.registerImage('dot', PNG);
    expect(doc.warnings).toEqual([]);
    doc.registerImage('dot', JPEG);
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toMatch(/"dot".*first image is kept/);
  });

  it('draws raw image data given as the icon, decoded once', () => {
    const doc = makeDocOnBackground('#FFFFFF');
    const addImage = vi.spyOn(doc.doc, 'addImage');
    doc.iconList(['One', 'Two'], { icon: PNG });
    expect(addImage).toHaveBeenCalledTimes(2);
    expect(addImage.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(addImage.mock.calls[1][0]).toBe(addImage.mock.calls[0][0]);
    expect(doc.warnings).toEqual([]);
  });

  it('draws a JPEG icon', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('photo', JPEG);
    doc.iconList(['One'], { icon: 'photo' });
    expect(doc.warnings).toEqual([]);
    expect(Buffer.from(doc.toBuffer()).toString('latin1')).toContain('/DCTDecode');
  });

  it('warns without throwing or loading a file for an icon name that was never registered', () => {
    const doc = makeDocOnBackground('#FFFFFF');
    const addImage = vi.spyOn(doc.doc, 'addImage');
    expect(() => doc.iconList(['One'], { icon: 'arrow-right' })).not.toThrow();
    expect(addImage).not.toHaveBeenCalled();
    expect(doc.warnings).toEqual([
      'Failed to draw icon: "arrow-right" is neither a registered image name nor readable image data',
    ]);
  });

  it('names raw base64 that is no image like an unknown name, since jsPDF would read it as a path', () => {
    const doc = makeDocOnBackground('#FFFFFF');
    const addImage = vi.spyOn(doc.doc, 'addImage');
    doc.iconList(['One'], { icon: 'QUJDREVGR0hJSktMTU5PUA==' });
    expect(addImage).not.toHaveBeenCalled();
    expect(doc.warnings).toEqual([
      'Failed to draw icon: "QUJDREVGR0hJSktMTU5PUA==" is neither a registered image name nor readable image data',
    ]);
  });

  it('keeps the jsPDF message for a data URL it cannot read', () => {
    const doc = makeDocOnBackground('#FFFFFF');
    doc.iconList(['One'], { icon: 'data:image/png;base64,QUJDREVGR0hJSktMTU5PUA==' });
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toMatch(/^Failed to draw icon: /);
    expect(doc.warnings[0]).not.toMatch(/neither a registered/);
  });

  it('warns for an image jsPDF reads as empty', () => {
    const doc = makeDocOnBackground('#FFFFFF');
    vi.spyOn(doc.doc, 'getImageProperties').mockReturnValue({ width: 0, height: 0 } as never);
    doc.iconList(['One'], { icon: PNG });
    expect(doc.warnings).toEqual(['Failed to draw icon: invalid image size 0x0']);
  });

  it('records a warning for an image jsPDF cannot read', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImages({ broken: 'not an image' });
    expect(doc.warnings.join()).toMatch(/image "broken"/);
  });
});

describe('theme fonts', () => {
  const face = { type: 'base64', family: 'Custom', style: 'normal', data: '', fileName: 'Custom.ttf' } as const;

  it('accepts built-in families regardless of case', () => {
    expect(() => new PDFDocument({ theme: themeWith('Helvetica', 'Times') })).not.toThrow();
  });

  it('throws when the theme names a family that was not registered', () => {
    expect(() => new PDFDocument({ theme: themeWith('Inter') })).toThrow(/Font family "Inter" is not available/);
    expect(() => new PDFDocument({ theme: themeWith('helvetica', 'Nope') })).toThrow(/"Nope"/);
    expect(() => new PDFDocument({ theme: themeWith('helvetica', undefined, 'Nope') })).toThrow(/"Nope"/);
  });

  it('warns when registered fonts are not referenced by the theme', () => {
    const doc = new PDFDocument({ theme: themeWith('helvetica'), fonts: [face] });
    expect(doc.warnings.some((warning) => warning.includes('Registered fonts (Custom)'))).toBe(true);
  });
});

/** The first page of a document that drew `value` through jsPDF's `text`. */
const streamOfText = (value: string | string[]) => {
  const doc = makeDocOnBackground();
  doc.doc.text(value, 10, 10);
  return pageStream(doc, 1);
};

const textOperators = (doc: jsPDF) =>
  (doc.internal as unknown as { pages: string[][] }).pages[1].filter((line) => /T[jJ]$/.test(line));
const outcome = (run: () => unknown) => {
  try {
    return { result: run() };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

describe('text gateway', () => {
  it('measures thin spaces like the non-breaking space it draws', () => {
    const doc = makeDocOnBackground().doc;
    const thin = '1 200';
    const nbsp = '1 200';
    expect(doc.getTextWidth(thin)).toBe(doc.getTextWidth(nbsp));
    expect(doc.getStringUnitWidth(thin)).toBe(doc.getStringUnitWidth(nbsp));
    expect(doc.getTextDimensions(thin).w).toBe(doc.getTextDimensions(nbsp).w);
    expect(doc.splitTextToSize(thin, 100)).toEqual([nbsp]);
  });

  it('draws the thin spaces of a string and of an array of strings as non-breaking spaces', () => {
    expect(streamOfText('1\u2009200')).toBe(streamOfText('1\u00a0200'));
    expect(streamOfText(['1\u2009200', 'a\u202fb'])).toBe(streamOfText(['1\u00a0200', 'a\u00a0b']));
    expect(streamOfText(['1\u2009200', 'plain'])).toBe(streamOfText(['1\u00a0200', 'plain']));
  });

  // The wrapped methods only normalize strings and arrays of strings: anything else gets what a bare jsPDF gives.
  const WRAPPED: [name: string, call: (doc: jsPDF, value: unknown) => unknown][] = [
    ['text', (doc, value) => (doc.text as (...args: unknown[]) => unknown)(value, 10, 10) && textOperators(doc)],
    ['getTextWidth', (doc, value) => (doc.getTextWidth as (value: unknown) => number)(value)],
    ['getTextDimensions', (doc, value) => (doc.getTextDimensions as (value: unknown) => unknown)(value)],
    ['getStringUnitWidth', (doc, value) => (doc.getStringUnitWidth as (value: unknown) => number)(value)],
    ['splitTextToSize', (doc, value) => (doc.splitTextToSize as (value: unknown, size: number) => unknown)(value, 50)],
  ];
  const NOT_TEXT = [123, null, undefined, true, {}, [1, 2], ['a', 3], [undefined]];
  it.each(WRAPPED)('passes a value that is not text to %s as jsPDF does', (_name, call) => {
    for (const value of NOT_TEXT) {
      const bare = new jsPDF({ unit: 'mm' });
      bare.setFontSize(11);
      const wrapped = makeDoc().doc;
      wrapped.setFontSize(11);
      wrapped.setLineHeightFactor(bare.getLineHeightFactor());
      expect(
        outcome(() => call(wrapped, value)),
        String(value),
      ).toEqual(outcome(() => call(bare, value)));
    }
  });
});

describe('addSpace', () => {
  it('moves the position under a block, and not at the top of a page', () => {
    const doc = makeDoc();
    doc.addSpace(10);
    expect(doc.getYPos()).toBe(doc.margins.top);
    doc.paragraph('Text');
    const end = doc.getYPos();
    doc.addSpace(10);
    expect(doc.getYPos()).toBe(end + 10);
  });
});

describe('calls made after the content they belong before', () => {
  const COVER_WARNING =
    'cover() called on page 1 after content: the cover is drawn over it; call cover() before the content, or after addPage()';
  const BACKGROUND_WARNING =
    'background() called on page 1 after content: the image is drawn over it; call background() before the content of the page';

  it('warns about a cover drawn over content, and draws it all the same', () => {
    const doc = makeDoc();
    doc.paragraph('Already here.').cover('Title', { variant: 'wave' });
    expect(doc.warnings).toEqual([COVER_WARNING]);
    expect(doc.coverPage).toBe(1);
    expect(doc.pageNumber).toBe(2);
  });

  it('counts a heading waiting for the next block as content', () => {
    const doc = makeDoc();
    doc.heading('Waiting').cover('Title', { variant: 'wave' });
    expect(doc.warnings).toEqual([COVER_WARNING]);
  });

  it('draws a cover on an empty page without a warning: the first page, or one after addPage()', () => {
    const first = makeDoc();
    first.cover('Title', { variant: 'wave' });
    expect(first.warnings).toEqual([]);

    const later = makeDoc();
    later.paragraph('Letter.').addPage().cover('Title', { variant: 'wave' });
    expect(later.warnings).toEqual([]);
    expect(later.coverPage).toBe(2);
  });

  it('takes the cover warning back with a cover that throws', () => {
    const doc = makeDoc();
    doc.paragraph('Already here.');
    expect(() =>
      doc.cover('Title', {
        variant: 'custom',
        draw: () => {
          throw new Error('boom');
        },
      }),
    ).toThrow('boom');
    expect(doc.warnings).toEqual([]);
  });

  it('warns about a background drawn over content', () => {
    const doc = makeDoc();
    doc.paragraph('Already here.').background(PNG);
    expect(doc.warnings).toEqual([BACKGROUND_WARNING]);
  });

  it('draws a background before the content, or on every later page, without a warning', () => {
    const doc = makeDoc();
    doc.background(PNG, { allPages: true }).paragraph('On top.').addPage().paragraph('On top too.');
    expect(doc.warnings).toEqual([]);
  });
});

const AFTER_BACK_COVER = (page: number) =>
  `A page was added after the back cover (page ${page}): the back cover is no longer the last page; ` +
  'call backCover() last';

describe('content after the back cover', () => {
  it('starts on a new page, numbered, with a warning', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.paragraph('Content.').backCover().paragraph('Too late.');
    expect(doc.backCoverPage).toBe(2);
    expect(doc.doc.getNumberOfPages()).toBe(3);
    expect(textOf(texts, 'Too late.').page).toBe(3);
    expect(textOf(texts, 'Too late.').y).toBeCloseTo(doc.layout.topFor(3) + measureTextLevel(doc, 'body').ascent, 6);
    expect(doc.warnings).toEqual([AFTER_BACK_COVER(2)]);
    // The back cover keeps no page number; the page after it gets the next one.
    expect([...doc.pageLabels]).toEqual([
      [1, 1],
      [3, 2],
    ]);
    const drawn = texts.length;
    doc.finalize();
    const footers = texts.slice(drawn);
    expect(footers.filter((call) => /^\d\/2$/.test(call.lines[0])).map((call) => [call.page, call.lines[0]])).toEqual([
      [1, '1/2'],
      [3, '2/2'],
    ]);
  });

  it('leaves a back cover drawn last alone: no page after it, no warning', () => {
    const doc = makeDoc();
    doc.paragraph('Content.').backCover({ legalText: 'Legal' });
    doc.finalize();
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(doc.warnings).toEqual([]);
    expect([...doc.pageLabels.keys()]).toEqual([1]);
  });

  it.each([
    ['a heading and its block', (doc: PDFDocument) => doc.heading('Late').paragraph('Text.')],
    ['a table', (doc: PDFDocument) => doc.table([{ a: '1' }], { columns: [{ header: 'A', key: 'a' }] })],
    ['a closing note', (doc: PDFDocument) => doc.closingNote('Legal.')],
    ['a page', (doc: PDFDocument) => doc.addPage()],
    ['a table of contents', (doc: PDFDocument) => doc.tableOfContents()],
  ])('puts %s on a page of its own', (_name, add) => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.paragraph('Content.').backCover();
    add(doc);
    expect(texts.filter((call) => call.page === doc.backCoverPage)).toEqual([]);
    expect(doc.warnings).toEqual([AFTER_BACK_COVER(2)]);
  });

  it('raises no warning for the pages a long table of contents inserts before it', () => {
    const doc = makeDoc();
    doc.tableOfContents();
    for (let index = 0; index < 120; index++) doc.heading(`Section ${index}`, { level: 'h2', keepWithNext: false });
    doc.backCover();
    const pages = doc.doc.getNumberOfPages();
    doc.finalize();
    expect(doc.doc.getNumberOfPages()).toBeGreaterThan(pages + 1);
    expect(doc.backCoverPage).toBe(doc.doc.getNumberOfPages());
    expect(doc.warnings).toEqual([]);
  });

  it('gives a cover after it a page of its own', () => {
    const doc = makeDoc();
    doc.paragraph('Content.').backCover().cover('Second part', { variant: 'wave' });
    expect(doc.backCoverPage).toBe(2);
    expect(doc.coverPage).toBe(3);
    expect(doc.warnings).toEqual([AFTER_BACK_COVER(2)]);
  });
});

describe('page decoration calls', () => {
  it('fills the table of contents once, and warns about a second one', () => {
    const doc = makeDoc();
    doc.tableOfContents();
    expect(doc.warnings).toEqual([]);
    doc.tableOfContents();
    expect(doc.warnings).toEqual(['tableOfContents() called twice: only the first table is filled']);
  });

  it('reserves the header space on the cover page it is declared on, without a warning', () => {
    const doc = makeDoc();
    doc.cover('Title', {
      variant: 'custom',
      draw: (page) => page.pageHeader({ title: 'Report' }),
    });
    expect(doc.warnings).toEqual([]);
    expect(doc.layout.topFor(2)).toBeGreaterThanOrEqual(CHROME.header.reserve);
  });
});

// Pages `addImage` drew on, in call order.
function imagePages(doc: PDFDocument): number[] {
  const pages: number[] = [];
  const addImage = doc.doc.addImage.bind(doc.doc);
  vi.spyOn(doc.doc, 'addImage').mockImplementation((...args: Parameters<typeof addImage>) => {
    pages.push(currentPage(doc));
    return addImage(...args);
  });
  return pages;
}

describe('document options', () => {
  it('defaults the theme', () => {
    const doc = new PDFDocument();
    expect(doc.theme.name).toBe('custom');
    expect(doc.theme.typography.fontFamily).toBe('helvetica');
    doc.paragraph('Body');
    expect(doc.warnings).toEqual([]);
  });

  it('makes the first registered family the default when the theme names none', () => {
    const doc = new PDFDocument({ fonts: interFonts });
    expect(doc.theme.typography.fontFamily).toBe(INTER_FAMILY);
    setTextStyle(doc, 'body');
    expect(doc.doc.getFont().fontName).toBe(INTER_FAMILY);
    setTextStyle(doc, 'fieldLabel');
    expect(doc.doc.getFont().fontName).toBe(INTER_FAMILY);
    setTextStyle(doc, 'italic');
    expect(doc.doc.getFont().fontStyle).toBe('italic');
    expect(doc.warnings).toEqual([]);
  });

  it('keeps the theme family over the registered fonts', () => {
    const doc = new PDFDocument({ theme: themeWith('times'), fonts: interFonts });
    expect(doc.theme.typography.fontFamily).toBe('times');
  });

  it('resolves the margins', () => {
    const doc = new PDFDocument({ margins: { top: 30, bottom: 20, left: 15 } });
    expect(doc.margins).toEqual({ top: 30, right: 15, bottom: 20, left: 15 });
    expect(doc.firstPageTop).toBe(30);
    expect(doc.getYPos()).toBe(30);
    expect(() => new PDFDocument({ margins: { bottom: -1 } })).toThrow(/margins\.bottom/);
  });

  it('throws when the margins leave no width', () => {
    expect(() => new PDFDocument({ margins: { left: 106, right: 106 } })).toThrow(InvalidOptionError);
    expect(() => new PDFDocument({ margins: { left: 106, right: 106 } })).toThrow(
      /left \(106\) \+ right \(106\) = 212 >= page width/,
    );
    expect(new PDFDocument({ margins: { left: 104, right: 105 } }).contentWidth).toBeCloseTo(1, 2);
  });

  it('throws when the margins leave no height, as they do for the width', () => {
    // A page 30 mm high under the default 20 mm top and 15 mm bottom margins.
    expect(() => new PDFDocument({ format: [100, 30] })).toThrow(InvalidOptionError);
    expect(() => new PDFDocument({ format: [100, 30] })).toThrow(
      'Invalid margins: top (20) + bottom (15) = 35 >= page height (30)',
    );
    expect(() => new PDFDocument({ margins: { top: 150, bottom: 150 } })).toThrow(/page height \(297/);
    expect(() => new PDFDocument({ margins: { top: 300 } })).toThrow(/top \(300\)/);
    expect(() => new PDFDocument({ margins: { bottom: 297.5 } })).toThrow(/bottom \(297.5\)/);
  });

  it('keeps a document whose margins leave a little height', () => {
    const doc = new PDFDocument({ margins: { top: 148, bottom: 148 } });
    expect(doc.pageHeight - doc.margins.top - doc.margins.bottom).toBeCloseTo(1, 2);
    const small = new PDFDocument({ format: [100, 36] });
    expect(small.pageHeight - small.margins.top - small.margins.bottom).toBeCloseTo(1, 2);
    expect(small.warnings).toEqual([]);
  });

  it('widens the top margin under a running header: the margins follow it, a copy taken before does not', () => {
    const doc = new PDFDocument({ margins: { top: 5 } });
    const margins = doc.margins;
    const copy = { ...doc.margins };
    doc.pageHeader({ title: 'Report' });
    expect(doc.margins.top).toBeGreaterThan(5);
    expect(margins.top).toBe(doc.margins.top);
    expect(copy.top).toBe(5);
  });

  it('writes the metadata texts and the keywords into the PDF', () => {
    const doc = new PDFDocument({
      title: 'Report',
      author: 'Ada',
      subject: 'Review',
      keywords: ['one', 'two'],
      creator: 'Toolkit',
      compress: false,
      debug: false,
    });
    const file = new TextDecoder('latin1').decode(doc.toBuffer());
    for (const value of ['/Title (Report)', '/Author (Ada)', '/Subject (Review)', '/Keywords (one, two)']) {
      expect(file).toContain(value);
    }
    expect(file).toContain('/Creator (Toolkit)');
  });

  it('completes a hand-built theme that leaves out its typography, spacing, assets and chrome', () => {
    const { name, colors } = createTheme({ colors: { primary: '#3572B8' } });
    const doc = new PDFDocument({ theme: { name, colors } as never });
    doc.heading('Title').paragraph('Body.').pageFooter({ right: '{page}' });
    expect(() => doc.toBuffer()).not.toThrow();
    expect(doc.theme.typography.fontFamily).toBe('helvetica');
    expect(doc.theme.assets).toEqual({});
    expect(doc.warnings).toEqual([]);
  });

  it('registers a font given as bytes', () => {
    const font = loadFontFromBinary(new Uint8Array(readFileSync('assets/fonts/inter/Inter-Regular.ttf')), {
      family: 'Brand',
    });
    const doc = new PDFDocument({ fonts: [font] });
    expect(doc.theme.typography.fontFamily).toBe('Brand');
    setTextStyle(doc, 'body');
    expect(doc.doc.getFont().fontName).toBe('Brand');
  });

  it('names the font entry it refuses', () => {
    const font = loadFontFromBase64('AAAA', { family: 'Brand' });
    expect(() => new PDFDocument({ fonts: [font, { ...font, style: 'heavy' as never }] })).toThrow(
      'Unknown fonts[1] style "heavy"',
    );
    expect(() => new PDFDocument({ fonts: [{ ...font, type: 'binary' }] as never })).toThrow(
      'Invalid fonts[0] data: AAAA — must be a Uint8Array',
    );
  });

  it('gives the same frozen margins object on every read, its four values enumerable', () => {
    const doc = new PDFDocument({ margins: { top: 30, bottom: 20, left: 15 } });
    expect(doc.margins).toBe(doc.margins);
    expect(Object.isFrozen(doc.margins)).toBe(true);
    expect({ ...doc.margins }).toEqual({ top: 30, right: 15, bottom: 20, left: 15 });
    expect(new Set(Object.keys(doc.margins))).toEqual(new Set(['top', 'right', 'bottom', 'left']));
  });
});

describe('logo', () => {
  it('draws a registered image by name, in the flow', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    const addImage = vi.spyOn(doc.doc, 'addImage');
    const top = doc.getYPos();
    doc.logo('brand', { height: 10, spaceAfter: 5 });
    expect(addImage).toHaveBeenCalledTimes(1);
    const [data, x, y, width, height] = addImage.mock.calls[0] as unknown[];
    expect(data).toBeInstanceOf(Uint8Array);
    expect([x, y, width, height]).toEqual([doc.margins.left, top, 10, 10]);
    expect(doc.getYPos()).toBe(top + 15);
    expect(doc.warnings).toEqual([]);
  });

  it('places a logo from its anchor corner without moving the position', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    const addImage = vi.spyOn(doc.doc, 'addImage');
    const top = doc.getYPos();
    doc.logo('brand', { height: 10, x: 5, y: 7, anchor: 'bottom-right' });
    const [, x, y] = addImage.mock.calls[0] as unknown[];
    expect([x, y]).toEqual([doc.pageWidth - 10 - 5, doc.pageHeight - 10 - 7]);
    expect(doc.getYPos()).toBe(top);
  });

  it('keeps the default height and position for options left undefined', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    const addImage = vi.spyOn(doc.doc, 'addImage');
    doc.logo('brand', { height: undefined, x: undefined });
    doc.backCover({ logo: { image: 'brand', height: undefined, x: undefined, y: undefined } });
    const sizes = (addImage.mock.calls as unknown[][]).map(([, x, y, width, height]) => [x, y, width, height]);
    expect(sizes[0]).toEqual([doc.margins.left, expect.any(Number), 15, 15]);
    expect(sizes[1]).toEqual([20, 20, 15, 15]);
  });

  it('resolves a registered name in the cover and back cover logos', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    const pages = imagePages(doc);
    doc.cover('Title', { variant: 'wave', logo: { image: 'brand' } });
    doc.backCover({ logo: { image: 'brand', anchor: 'top-right' } });
    expect(pages).toEqual([1, doc.backCoverPage]);
    expect(doc.warnings).toEqual([]);
  });

  it.each([
    [
      'taller',
      TALL_PNG,
      { height: 400, x: 0 },
      'The logo is 400.0 mm tall, more than the 297.0 mm the page leaves from its position, and may be clipped',
    ],
    [
      'wider',
      WIDE_PNG,
      { height: 60, anchor: 'top-right' as const },
      'The logo is 240.0 mm wide, more than the 198.0 mm the page leaves from its position, and may be clipped',
    ],
    [
      'wider and taller',
      PNG,
      { height: 300, anchor: 'bottom-left' as const },
      'The logo is 300.0 mm wide, more than the 198.0 mm the page leaves from its position and 300.0 mm tall, ' +
        'more than the 297.0 mm the page leaves from its position, and may be clipped',
    ],
  ])('warns for a logo placed from its corner %s than the page', (_name, image, position, warning) => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', image);
    doc.logo('brand', { ...position, y: 0 });
    expect(doc.warnings).toEqual([warning]);
  });

  it('warns for a cover or back cover logo larger than the page', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    doc.cover('Title', { variant: 'wave', logo: { image: 'brand', height: 250, anchor: 'bottom-left' } });
    doc.backCover({ logo: { image: 'brand', height: 400 } });
    expect(doc.warnings).toEqual([
      'The cover logo is 250.0 mm wide, more than the 198.0 mm the page leaves from its position, and may be clipped',
      'The logo is 400.0 mm wide, more than the 190.0 mm the page leaves from its position and 400.0 mm tall, ' +
        'more than the 277.0 mm the page leaves from its position, and may be clipped',
    ]);
  });

  it('warns for a logo in the flow wider than the page, and leaves its height to the block warning', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    doc.logo('brand', { height: 300 });
    expect(doc.warnings).toHaveLength(2);
    expect(doc.warnings[0]).toMatch(/^Block of .* is taller than the usable page height/);
    expect(doc.warnings[1]).toBe(
      'The logo is 300.0 mm wide, more than the 198.0 mm the page leaves from its position, and may be clipped',
    );
  });

  it.each([
    ['at the margin', { height: 205, x: 12 }, 198],
    ['from the left edge', { height: 100, x: 120 }, 90],
    ['from the right edge', { height: 100, x: 120, anchor: 'top-right' as const }, 90],
  ])('warns for a logo wider than the page leaves %s', (_name, position, room) => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    doc.logo('brand', { ...position, y: 0 });
    expect(doc.warnings).toEqual([
      `The logo is ${position.height.toFixed(1)} mm wide, more than the ${room.toFixed(1)} mm the page leaves from ` +
        'its position, and may be clipped',
    ]);
  });

  it.each([
    ['from the top edge', 'top-left' as const],
    ['from the bottom edge', 'bottom-left' as const],
  ])('warns for a logo taller than the page leaves %s', (_name, anchor) => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    doc.logo('brand', { height: 100, x: 100, y: 250, anchor });
    expect(doc.warnings).toEqual([
      'The logo is 100.0 mm tall, more than the 47.0 mm the page leaves from its position, and may be clipped',
    ]);
  });

  it('measures the room of a logo in the flow from the left edge of its column', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    doc.columns([() => {}, (column) => column.logo('brand', { height: 110 })]);
    const room = doc.pageWidth - (doc.margins.left + (doc.contentWidth - 8) / 2 + 8);
    expect(doc.warnings).toEqual([
      `The logo is 110.0 mm wide, more than the ${room.toFixed(1)} mm the page leaves from its position, and may be clipped`,
    ]);
  });

  it('warns for a logo wider than the page leaves, on a cover', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    doc.cover('Title', { variant: 'wave', logo: { image: 'brand', height: 100, x: 150, y: 10 } });
    expect(doc.warnings).toEqual([
      'The cover logo is 100.0 mm wide, more than the 60.0 mm the page leaves from its position, and may be clipped',
    ]);
  });

  it('places a logo as large as the page without a warning', () => {
    const doc = makeDocOnBackground('#FFFFFF').registerImage('brand', PNG);
    doc.logo('brand', { height: doc.pageWidth, x: 0, y: 0 });
    expect(doc.warnings).toEqual([]);
  });

  it('warns for a name that was never registered', () => {
    const doc = makeDocOnBackground('#FFFFFF');
    doc.logo('missing');
    expect(doc.warnings).toEqual([
      'Failed to draw logo: "missing" is neither a registered image name nor readable image data',
    ]);
  });
});

describe('every page', () => {
  it('draws an allPages background on the pages added after the call, blank pages excepted', () => {
    const doc = makeDocOnBackground('#FFFFFF');
    const pages = imagePages(doc);
    doc.background(PNG, { allPages: true });
    doc.addPage();
    doc.addPage({ blank: true });
    doc.addPage();
    expect(pages).toEqual([1, 2, 4]);
  });

  it('draws a background on the current page only by default', () => {
    const doc = makeDocOnBackground('#FFFFFF');
    const pages = imagePages(doc);
    doc.background(PNG);
    doc.addPage();
    expect(pages).toEqual([1]);
  });

  it('keeps one allPages background, drawn on a new page before the watermark', () => {
    const doc = makeDocOnBackground('#FFFFFF').pageFooter(false);
    doc.watermark('DRAFT', { allPages: true });
    doc.background(PNG, { allPages: true });
    doc.background(PNG, { allPages: true });
    const calls: string[] = [];
    vi.spyOn(doc.doc, 'addImage').mockImplementation(() => {
      calls.push('image');
      return doc.doc;
    });
    vi.spyOn(doc.doc, 'text').mockImplementation(() => {
      calls.push('text');
      return doc.doc;
    });
    doc.addPage();
    expect(calls).toEqual(['image']);
    doc.finalize();
    expect(calls).toEqual(['image', 'text', 'text']);
  });
});

const bodyLine = (doc: PDFDocument) => measureTextLevel(doc, 'body').lineHeight;
const headingBlock = (doc: PDFDocument, level: 'h2' | 'h3') =>
  measureTextLevel(doc, level).lineHeight + doc.theme.spacing.heading[level].after;

describe('heading keepWithNext', () => {
  it('moves a heading that would end a page alone to the next page, with its first line', () => {
    const doc = makeDocOnBackground();
    leaveRoom(doc, headingBlock(doc, 'h2') + 1);
    doc.heading('Section', { level: 'h2', spaceBefore: 0 }).paragraph('Body.');
    expect(lastEntryPage(doc)).toBe(2);
    expect(currentPage(doc)).toBe(2);
  });

  it('keeps the heading where it is as long as it and one body line fit', () => {
    const doc = makeDocOnBackground();
    // No room reserved for a sub-heading the paragraph does not have.
    leaveRoom(doc, headingBlock(doc, 'h2') + bodyLine(doc) + 0.5);
    doc.heading('Section', { level: 'h2', spaceBefore: 0 }).paragraph('Body.');
    expect(lastEntryPage(doc)).toBe(1);
    expect(currentPage(doc)).toBe(1);
  });

  it('leaves the heading in place when disabled', () => {
    const doc = makeDocOnBackground();
    leaveRoom(doc, headingBlock(doc, 'h2') + 1);
    doc.heading('Section', { level: 'h2', spaceBefore: 0, keepWithNext: false });
    expect(lastEntryPage(doc)).toBe(1);
    doc.paragraph('Body.');
    expect(currentPage(doc)).toBe(2);
  });

  it('moves consecutive headings together with the first line under them', () => {
    const doc = makeDocOnBackground();
    const { h2, h3 } = doc.theme.spacing.heading;
    const gap = Math.max(0, h3.before - h2.after);
    const chain = headingBlock(doc, 'h2') + gap + headingBlock(doc, 'h3');
    // Room for both headings, not for a body line under them.
    leaveRoom(doc, chain + bodyLine(doc) - 0.5);
    doc.heading('Section', { level: 'h2', spaceBefore: 0 }).heading('Subsection', { level: 'h3' }).paragraph('Body.');
    expect(doc.pageRefs.tocEntries.map((entry) => entry.page)).toEqual([2, 2]);
    expect(currentPage(doc)).toBe(2);

    const fits = makeDocOnBackground();
    leaveRoom(fits, chain + bodyLine(fits) + 0.5);
    fits.heading('Section', { level: 'h2', spaceBefore: 0 }).heading('Subsection', { level: 'h3' }).paragraph('Body.');
    expect(fits.pageRefs.tocEntries.map((entry) => entry.page)).toEqual([1, 1]);
  });

  it('moves a heading with the head of the table under it', () => {
    const doc = makeDocOnBackground();
    // Two body lines fit under the heading, the table header and first row do not.
    leaveRoom(doc, headingBlock(doc, 'h2') + bodyLine(doc) * 2);
    doc
      .heading('Table', { level: 'h2', spaceBefore: 0 })
      .table([{ name: 'One' }, { name: 'Two' }], { columns: [{ header: 'Name', key: 'name' }] });
    expect(lastEntryPage(doc)).toBe(2);
    expect(doc.doc.getNumberOfPages()).toBe(2);
  });

  it('places a waiting heading where it stands before a raw position read', () => {
    const doc = makeDocOnBackground();
    doc.paragraph('Intro');
    const before = doc.getYPos();
    doc.heading('Raw', { level: 'h3', spaceBefore: 0 });
    expect(doc.getYPos()).toBeCloseTo(before + headingBlock(doc, 'h3'), 6);
    expect(lastEntryPage(doc)).toBe(1);
  });

  it('moves a heading with the separator under it', () => {
    // The separator reserves its space above and its space under.
    const room = headingBlock(makeDocOnBackground(), 'h2') + SPACING.large + SPACING.large;
    const tight = makeDocOnBackground();
    leaveRoom(tight, room - 0.5);
    tight.heading('Section', { level: 'h2', spaceBefore: 0 }).separator();
    expect(lastEntryPage(tight)).toBe(2);
    expect(currentPage(tight)).toBe(2);

    const fits = makeDocOnBackground();
    leaveRoom(fits, room + 0.5);
    fits.heading('Section', { level: 'h2', spaceBefore: 0 }).separator();
    expect(lastEntryPage(fits)).toBe(1);
    expect(currentPage(fits)).toBe(1);
  });

  it('keeps a heading waiting through field rows without a field', () => {
    const doc = makeDocOnBackground();
    leaveRoom(doc, headingBlock(doc, 'h2') + 1);
    doc.heading('Section', { level: 'h2', spaceBefore: 0 }).fields([]).fieldRows([[]]);
    expect(doc.pageRefs.tocEntries).toHaveLength(0);
    doc.paragraph('Body.');
    expect(lastEntryPage(doc)).toBe(2);
  });

  it('measures a wrapped table header before keeping the heading with it', () => {
    const table = {
      columns: [
        { header: 'Quarterly revenue forecast by region', key: 'a', width: 25 },
        { header: 'Name', key: 'b' },
      ],
      data: [{ a: 'One', b: 'Two' }],
    };
    const doc = makeDocOnBackground();
    const { small } = doc.theme.typography.sizes;
    const oneLineRow =
      lineHeightMm(small, doc.theme.typography.lineHeightFactor) + TABLE.cellPadding.top + TABLE.cellPadding.bottom;
    // Room for a heading and two one-line rows: the header takes three lines.
    leaveRoom(doc, headingBlock(doc, 'h2') + oneLineRow * 2 + 0.5);
    doc.heading('Table', { level: 'h2', spaceBefore: 0 }).table(table.data, table);
    expect(lastEntryPage(doc)).toBe(2);
    expect(doc.doc.getNumberOfPages()).toBe(2);
  });

  it('does not count a hidden table header', () => {
    const doc = makeDocOnBackground();
    const { small } = doc.theme.typography.sizes;
    const oneLineRow =
      lineHeightMm(small, doc.theme.typography.lineHeightFactor) + TABLE.cellPadding.top + TABLE.cellPadding.bottom;
    leaveRoom(doc, headingBlock(doc, 'h2') + oneLineRow + 0.5);
    doc.heading('Table', { level: 'h2', spaceBefore: 0 }).table([{ a: 'One' }], {
      columns: [{ header: 'Quarterly revenue forecast by region', key: 'a', width: 25 }],
      showHead: 'never',
    });
    expect(lastEntryPage(doc)).toBe(1);
  });
});

const drawSectionChain = (doc: PDFDocument) =>
  doc.heading('Section', { level: 'h2' }).heading('Subsection', { level: 'h3' }).paragraph('Body.');

describe('space above a heading', () => {
  it('is opened by drawHeading itself: collapsed into the block above, none at the top of a page', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const { block, heading } = doc.theme.spacing;
    const { ascent } = measureTextLevel(doc, 'h2');
    drawHeading(doc, 'Top', { level: 'h2' });
    expect(titleY(texts, 'Top')).toBeCloseTo(doc.firstPageTop + ascent, 6);

    doc.paragraph('Body.');
    const afterBody = doc.getYPos();
    drawHeading(doc, 'Next', { level: 'h2' });
    expect(titleY(texts, 'Next')).toBeCloseTo(afterBody + heading.h2.before - block + ascent, 6);
  });

  it('collapses into a waiting heading drawn before it', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    const { h2, h3 } = doc.theme.spacing.heading;
    doc.paragraph('Body.').heading('Waiting', { level: 'h2' });
    doc.heading('Direct', { level: 'h3', keepWithNext: false });
    const gap = Math.max(0, h3.before - h2.after);
    const { ascent } = measureTextLevel(doc, 'h3');
    const below = titleY(texts, 'Waiting') - measureTextLevel(doc, 'h2').ascent + headingBlock(doc, 'h2');
    expect(titleY(texts, 'Direct')).toBeCloseTo(below + gap + ascent, 6);
  });

  it('is reserved with the heading drawn at once', () => {
    const { before } = makeDoc().theme.spacing.heading.h2;
    const short = makeDocOnBackground();
    // Room for the line and the space under it, not for the space above as well.
    leaveRoom(short, headingBlock(short, 'h2') + before / 2);
    short.heading('Section', { level: 'h2', keepWithNext: false });
    expect(lastEntryPage(short)).toBe(2);

    const fits = makeDocOnBackground();
    leaveRoom(fits, before + headingBlock(fits, 'h2') + 0.5);
    fits.heading('Section', { level: 'h2', keepWithNext: false });
    expect(lastEntryPage(fits)).toBe(1);
  });

  it('is counted in the waiting headings as drawHeading reserves it', () => {
    const { h2, h3 } = makeDoc().theme.spacing.heading;
    const chain = (doc: PDFDocument) =>
      h2.before + headingBlock(doc, 'h2') + Math.max(0, h3.before - h2.after) + headingBlock(doc, 'h3');

    const short = makeDocOnBackground();
    leaveRoom(short, chain(short) + bodyLine(short) - 0.5);
    drawSectionChain(short);
    expect(short.pageRefs.tocEntries.map((entry) => entry.page)).toEqual([2, 2]);

    const fits = makeDocOnBackground();
    leaveRoom(fits, chain(fits) + bodyLine(fits) + 0.5);
    drawSectionChain(fits);
    expect(fits.pageRefs.tocEntries.map((entry) => entry.page)).toEqual([1, 1]);
  });
});

describe('ensureSpace return value', () => {
  it('is true when it moves a waiting heading to the next page', () => {
    const doc = makeDocOnBackground();
    leaveRoom(doc, headingBlock(doc, 'h2') + 1);
    doc.heading('Section', { level: 'h2', spaceBefore: 0 });
    expect(doc.ensureSpace(bodyLine(doc))).toBe(true);
    expect(currentPage(doc)).toBe(2);
  });

  it('is true when the waiting headings break the page while they are drawn', () => {
    const doc = makeDocOnBackground();
    // Together taller than a page: they cannot be kept, so each breaks on its own.
    for (let index = 0; index < 30; index++) doc.heading(`Heading ${index}`);
    expect(doc.ensureSpace(1)).toBe(true);
    expect(currentPage(doc)).toBeGreaterThan(1);
  });

  it('is false when nothing moves', () => {
    const doc = makeDocOnBackground();
    doc.heading('Section', { level: 'h2' });
    expect(doc.ensureSpace(1)).toBe(false);
    expect(currentPage(doc)).toBe(1);
  });
});

describe('keepTogether', () => {
  it('keeps a heading with the box under it near the bottom of a page', () => {
    // From a generous gap down to one too small for both: the heading never lands apart from its box.
    for (let gap = 10; gap <= 70; gap += 2) {
      const doc = makeDocOnBackground();
      doc.paragraph('Intro');
      doc.setYPos(doc.pageHeight - doc.margins.bottom - gap);
      let headingPage = 0;
      let boxPage = 0;
      doc.keepTogether(() => {
        doc.heading('Title', { level: 'h2' });
        headingPage = currentPage(doc);
        doc.infoBox('Some content in the box', { title: 'Box' });
        boxPage = currentPage(doc);
      });
      expect({ gap, headingPage }).toEqual({ gap, headingPage: boxPage });
    }
  });

  it('records table of contents entries once, from the real pass', () => {
    const doc = makeDocOnBackground();
    doc.tableOfContents();
    doc.paragraph('Intro');
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 20);
    doc.keepTogether(() => {
      doc.heading('Kept', { level: 'h2' });
      doc.paragraph('Body under the heading, kept with it.');
    });
    const entries = doc.pageRefs.tocEntries;
    expect(entries.map((entry) => entry.label)).toEqual(['Kept']);
    expect(entries[0].page).toBe(currentPage(doc));
  });

  it('draws a waiting heading after the new-page hook, below what the hook leaves', () => {
    const doc = makeDocOnBackground();
    const hookY = 40;
    doc.onNewPage(() => doc.setYPos(hookY));
    doc.paragraph('Intro');
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 30);
    doc.heading('Waiting', { level: 'h2' });
    doc.keepTogether(() => doc.infoBox('x'.repeat(2000), { title: 'Box' }));
    expect(lastEntryPage(doc)).toBe(2);
    expect(doc.pageRefs.tocEntries.at(-1)!.y).toBeGreaterThanOrEqual(hookY);
  });

  it('leaves a heading ending the callback waiting for the next block', () => {
    const doc = leaveRoom(makeDocOnBackground(), 24);
    const texts = recordTexts(doc);
    doc.keepTogether(() => {
      doc.infoBox('Alone, it fits at the bottom.', { title: 'Block' });
      doc.heading('Waiting', { level: 'h2' });
    });
    doc.infoBox('Next block.', { title: 'Next' });
    // The last call is the real one: measuring passes draw on scratch pages.
    const pageOf = (label: string) => lastText(texts, label).page;
    // The heading does not count in what must fit, so the block stays; it then moves with the block that follows.
    expect(pageOf('Block')).toBe(1);
    expect(pageOf('Waiting')).toBe(2);
    expect(pageOf('Next')).toBe(2);
    // Nor is it drawn while measuring: a measuring pass that placed it would draw it a second time, on a scratch page.
    expect(texts.filter((call) => call.lines[0] === 'Waiting')).toHaveLength(1);
  });

  it('measures once when the block fits where it stands', () => {
    const doc = makeDocOnBackground();
    doc.paragraph('Intro');
    const draw = vi.fn(() => doc.paragraph('Fits.'));
    doc.keepTogether(draw);
    // One measuring pass and the real one.
    expect(draw).toHaveBeenCalledTimes(2);
  });
});

describe('hand-built theme palette', () => {
  it('is normalized to #RRGGBB uppercase by the document', () => {
    const base = createTheme({ name: 't' });
    const theme = { ...base, colors: { ...base.colors, primary: '#abc', text: '1e293b' } };
    const doc = new PDFDocument({ theme });
    expect(doc.theme.colors.primary).toBe('#AABBCC');
    expect(doc.theme.colors.text).toBe('#1E293B');
    for (const value of Object.values(doc.theme.colors)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('throws InvalidColorError naming the token of an invalid color', () => {
    const base = createTheme({ name: 't' });
    const theme = { ...base, colors: { ...base.colors, border: 'grey' } };
    expect(() => new PDFDocument({ theme })).toThrow(InvalidColorError);
    expect(() => new PDFDocument({ theme })).toThrow(/"border"/);
  });
});
