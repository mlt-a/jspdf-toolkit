import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COVER, LOGO, ascentMm } from '../../src/core/constants';
import { PDFDocument } from '../../src/core/document';
import { InvalidColorError, InvalidOptionError } from '../../src/core/errors';
import type { BackCoverOptions, CoverOptions } from '../../src/page/cover';
import { createTheme } from '../../src/theme/defaults';
import {
  LONG,
  PNG,
  changeEverything,
  drawingState,
  expectTextWithin,
  loadLogo,
  makeDoc,
  pageStream,
  recordTexts,
  sameColor,
  setForeignState,
  textOf,
  watchDrawing,
} from './helpers';

/** Where a logo was drawn: `addImage(data, x, y, width, height, alias)`. */
const logoBox = (image: ReturnType<typeof vi.spyOn>) => {
  const [, x, y, , height] = image.mock.calls[0] as unknown[];
  return { x, y, height };
};

/** The first filled rectangle that is not the page background: the accent bar of a wave cover. */
const accentBar = (rect: ReturnType<typeof vi.spyOn>): number[] =>
  rect.mock.calls.find(([left, , , , fillStyle]: unknown[]) => fillStyle === 'F' && left !== 0) as unknown as number[];

describe('wave cover image fallback', () => {
  let doc: PDFDocument;
  let pathOps: () => string[];

  beforeEach(() => {
    doc = makeDoc();
    doc.registerImage('photo', loadLogo());

    // Spies call through; the global call order interleaves the four into the drawing order.
    const spies = (['moveTo', 'clip', 'discardPath', 'fill'] as const).map((name) => ({
      name,
      spy: vi.spyOn(doc.doc, name),
    }));
    pathOps = () =>
      spies
        .flatMap(({ name, spy }) => spy.mock.invocationCallOrder.map((order) => ({ name, order })))
        .toSorted((a, b) => a.order - b.order)
        .map(({ name }) => name);
  });

  it('fills the wave zone with the tint when the image name is unknown', () => {
    doc.cover('Title', { variant: 'wave', image: 'missing' });

    expect(doc.warnings).toEqual([expect.stringMatching(/wave cover image/i)]);
    expect(pathOps()).toEqual(['moveTo', 'fill']);
  });

  it('fills the wave zone with the tint when the image cannot be drawn', () => {
    vi.spyOn(doc.doc, 'addImage').mockImplementation(() => {
      throw new Error('embed failed');
    });

    doc.cover('Title', { variant: 'wave', image: 'photo' });

    expect(doc.warnings).toEqual([expect.stringContaining('embed failed')]);
    // The clipped path is consumed: the tint draws a path of its own.
    expect(pathOps()).toEqual(['moveTo', 'clip', 'discardPath', 'moveTo', 'fill']);
  });

  it('clips the image to the wave and adds no warning', () => {
    doc.cover('Title', { variant: 'wave', image: 'photo' });

    expect(doc.warnings).toEqual([]);
    expect(pathOps()).toEqual(['moveTo', 'clip', 'discardPath']);
  });

  it('falls back to waveColor, not to the tint, when the image cannot be drawn', () => {
    const fill = vi.spyOn(doc.doc, 'setFillColor');
    doc.cover('Title', { variant: 'wave', image: 'missing', waveColor: '#112233' });

    expect(fill.mock.calls.map(([value]) => value)).toContain('#112233');
  });
});

/** Where the wave cover draws an image of `width` x `height` px: its size, in mm. */
const drawnSize = (width: number, height: number) => {
  const doc = makeDoc();
  // Mocked before the image is registered: the cache reads its size then.
  vi.spyOn(doc.doc, 'getImageProperties').mockReturnValue({ width, height } as never);
  doc.registerImage('photo', loadLogo());
  const addImage = vi.spyOn(doc.doc, 'addImage');
  doc.cover('Title', { variant: 'wave', image: 'photo' });
  const [, , , w, h] = addImage.mock.calls[0] as unknown as number[];
  return { doc, width: w, height: h };
};

describe('wave cover image crop', () => {
  it('fits a taller image to the page width, and crops it top and bottom', () => {
    const { doc, width, height } = drawnSize(100, 100);
    expect(width).toBeCloseTo(doc.pageWidth, 6);
    expect(height).toBeCloseTo(doc.pageWidth, 6);
  });

  it('fits a wider image to the height of the zone, and crops it on the sides', () => {
    const tall = drawnSize(100, 100);
    const wide = drawnSize(1000, 100);
    expect(wide.width).toBeGreaterThan(wide.doc.pageWidth);
    expect(wide.height).toBeLessThan(tall.height);
    expect(wide.width / wide.height).toBeCloseTo(10, 6);
  });
});

describe('image cover with a subtitle', () => {
  it.each([
    ['in the subtitle color and at the gap of the layout', { subtitleColor: '#202020', titleGap: 12 }, '#202020', 12],
    ['in the title color and at the default gap when the layout sets neither', {}, '#101010', COVER.titleGap],
  ] as const)('draws the subtitle under the title, smaller, %s', (_name, subtitle, color, gap) => {
    const full = { titleX: 20, titleY: 100, color: '#101010', titleSize: 30, ...subtitle } as const;
    const doc = makeDoc({ theme: createTheme({ colors: { primary: '#3572B8' }, assets: { covers: { full } } }) });
    const texts = recordTexts(doc);
    doc.cover('Annual report', { variant: 'image', layout: 'full', subtitle: 'Fiscal year 2026' });
    const title = textOf(texts, 'Annual report');
    const drawn = textOf(texts, 'Fiscal year 2026');
    expect(title.x).toBe(20);
    expect(drawn.x).toBe(20);
    expect(drawn.y).toBeGreaterThan(title.y + gap);
    expect(sameColor(title.color, '#101010')).toBe(true);
    expect(sameColor(drawn.color, color)).toBe(true);
  });
});

describe('default variant', () => {
  it('is plain for a back cover', () => {
    const options = { contact: { lines: ['Acme Corp'] }, legalText: 'All rights reserved.' };
    const implicit = makeDoc().paragraph('Body.').backCover(options);
    const explicit = makeDoc()
      .paragraph('Body.')
      .backCover({ variant: 'plain', ...options });
    expect(implicit.backCoverPage).toBe(2);
    expect(pageStream(implicit, 2)).toContain('(Acme Corp)');
    expect(pageStream(implicit, 2)).toBe(pageStream(explicit, 2));
  });

  it('is none for a cover, which names the variants it knows', () => {
    const doc = makeDoc();
    expect(() => doc.cover('Title', {} as never)).toThrow(InvalidOptionError);
    expect(() => doc.cover('Title', {} as never)).toThrow(/wave.*image.*custom/);
    expect(doc.coverPage).toBeUndefined();
  });
});

describe('cover layouts', () => {
  it('throws, naming the key and the available layouts, when the image cover layout is missing', () => {
    const doc = makeDoc({
      theme: createTheme({
        colors: { primary: '#3572B8' },
        assets: { covers: { classic: { color: '#000000', titleX: 20, titleY: 40 } } },
      }),
    });
    const draw = () => doc.cover('Title', { variant: 'image', layout: 'missing' });
    expect(draw).toThrow(/"missing".*available: 'classic'/);
    expect(doc.coverPage).toBeUndefined();
    expect(doc.doc.getNumberOfPages()).toBe(1);
  });

  it('names no available layout when the theme has none', () => {
    const doc = makeDoc();
    expect(() => doc.cover('Title', { variant: 'image', layout: 'missing' })).toThrow(/available: none/);
  });

  it('keeps what the layout says for a logo field left undefined', () => {
    const doc = makeDoc({
      theme: createTheme({
        colors: { primary: '#3572B8' },
        assets: {
          covers: { full: { color: '#000000', titleX: 20, titleY: 40, logo: { x: 33, y: 44, height: 11 } } },
        },
      }),
    });
    doc.registerImage('logo', loadLogo());
    const image = vi.spyOn(doc.doc, 'addImage');

    doc.cover('Title', {
      variant: 'image',
      layout: 'full',
      logo: { image: 'logo', x: undefined, y: undefined, height: undefined, anchor: undefined },
    });

    expect(logoBox(image)).toEqual({ x: 33, y: 44, height: 11 });
  });

  it('overrides the fields of the layout logo that the option gives', () => {
    const doc = makeDoc({
      theme: createTheme({
        colors: { primary: '#3572B8' },
        assets: { covers: { full: { color: '#000000', titleX: 20, titleY: 40, logo: { x: 33, y: 44 } } } },
      }),
    });
    doc.registerImage('logo', loadLogo());
    const image = vi.spyOn(doc.doc, 'addImage');

    doc.cover('Title', { variant: 'image', layout: 'full', logo: { image: 'logo', x: 50 } });

    expect(logoBox(image)).toEqual({ x: 50, y: 44, height: LOGO.height });
  });
});

/** Y of the wave cover's accent bar, the first filled rect that is not the page background. */
function accentBarY(withHeader: boolean): number {
  // Small enough that the header has to raise the first-page top.
  const doc = makeDoc({ margins: { top: 5 }, firstPageTop: 5 });
  if (withHeader) doc.pageHeader({ title: 'Report' });
  const rect = vi.spyOn(doc.doc, 'rect');
  doc.cover('Title', { variant: 'wave' });
  return accentBar(rect)[1];
}

describe('wave cover position', () => {
  it('starts from the document margins', () => {
    const doc = makeDoc({ margins: { left: 25 }, firstPageTop: 40 });
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.cover('Title', { variant: 'wave' });
    // The accent bar, under the top of the first page.
    const [x, y] = accentBar(rect);
    expect(x).toBe(25);
    expect(y).toBeGreaterThanOrEqual(40);
  });

  it('starts at the same position with or without a running header', () => {
    expect(accentBarY(true)).toBe(accentBarY(false));
    expect(accentBarY(false)).toBeGreaterThanOrEqual(5);
  });

  it('starts from the top of the page it is drawn on, not of the first one', () => {
    const doc = makeDoc({ firstPageTop: 100 });
    doc.paragraph('A letter on the first page.').addPage();
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.cover('Title', { variant: 'wave' });
    expect(accentBar(rect)[1]).toBe(doc.margins.top);
    expect(doc.coverPage).toBe(2);
  });

  it('puts the logo in the flow above the accent bar', () => {
    const doc = makeDoc();
    doc.registerImage('logo', loadLogo());
    const rect = vi.spyOn(doc.doc, 'rect');
    const image = vi.spyOn(doc.doc, 'addImage');
    doc.cover('Title', { variant: 'wave', logo: { image: 'logo' } });

    expect(logoBox(image)).toEqual({ x: doc.margins.left, y: doc.margins.top, height: LOGO.height });
    expect(accentBar(rect)[1]).toBeCloseTo(doc.margins.top + LOGO.height + COVER.waveAccentBarGap, 6);
  });

  it('leaves a logo placed from its corner out of the flow', () => {
    const doc = makeDoc();
    doc.registerImage('logo', loadLogo());
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.cover('Title', { variant: 'wave', logo: { image: 'logo', anchor: 'bottom-right' } });

    expect(accentBar(rect)[1]).toBe(doc.margins.top);
  });

  it('takes no room for a logo that cannot be read', () => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.cover('Title', { variant: 'wave', logo: { image: 'missing' } });

    expect(accentBar(rect)[1]).toBe(doc.margins.top);
    expect(doc.warnings).toEqual([expect.stringMatching(/cover logo/)]);
  });

  it('sets the top of the title capitals under the bar, and the subtitle under the title', () => {
    const doc = makeDoc();
    const rect = vi.spyOn(doc.doc, 'rect');
    const texts = recordTexts(doc);
    doc.cover('Title', { variant: 'wave', subtitle: 'Sub' });

    const [, barY] = accentBar(rect);
    const titleCapsTop = barY + COVER.waveAccentBarHeight + COVER.waveTitleGap;
    expect(textOf(texts, 'Title').y).toBeCloseTo(titleCapsTop + ascentMm(COVER.waveTitleSize), 6);
    expect(textOf(texts, 'Sub').y).toBeCloseTo(
      textOf(texts, 'Title').y + COVER.waveSubtitleGap + ascentMm(COVER.waveSubtitleSize),
      6,
    );
  });

  it('wraps a long title and puts the subtitle under its last line', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.cover('A very long annual report title that has to wrap over several lines of the cover page', {
      variant: 'wave',
      subtitle: 'Sub',
    });

    const lines = texts.filter((call) => call.fontStyle === 'bold');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.x + line.widths[0]).toBeLessThanOrEqual(doc.margins.left + doc.contentWidth);
    expect(textOf(texts, 'Sub').y).toBeCloseTo(
      lines.at(-1)!.y + COVER.waveSubtitleGap + ascentMm(COVER.waveSubtitleSize),
      6,
    );
  });
});

describe('wave cover options', () => {
  it('colors the title with titleColor', () => {
    const doc = makeDoc();
    const color = vi.spyOn(doc.doc, 'setTextColor');
    doc.cover('Title', { variant: 'wave', subtitle: 'Sub', titleColor: 'primary' });
    expect(color.mock.calls.map(([value]) => value)).toContain(doc.theme.colors.primary);
  });

  it('colors the subtitle with subtitleColor', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.cover('Title', { variant: 'wave', subtitle: 'Sub', subtitleColor: '#FF0000' });
    expect(textOf(texts, 'Sub').color).toBe('#ff0000');
  });

  it('fills the wave with waveColor and drops the accent bar on request', () => {
    const doc = makeDoc();
    const fill = vi.spyOn(doc.doc, 'setFillColor');
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.cover('Title', { variant: 'wave', waveColor: '#112233', accentBar: false });
    expect(fill.mock.calls.map(([value]) => value)).toContain('#112233');
    expect(rect).not.toHaveBeenCalled();
  });

  it('starts the title at the top of the page without a bar or a logo', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.cover('Title', { variant: 'wave', accentBar: false });
    expect(textOf(texts, 'Title').y).toBeCloseTo(doc.margins.top + ascentMm(COVER.waveTitleSize), 6);
  });

  it.each([
    ['titleColor', { titleColor: 'nope' }],
    ['subtitleColor', { subtitleColor: 'nope' }],
    ['waveColor', { waveColor: 'nope' }],
  ])('throws on an invalid %s before drawing anything', (_, colors) => {
    const doc = makeDoc();
    const text = vi.spyOn(doc.doc, 'text');
    expect(() => doc.cover('Title', { variant: 'wave', ...colors } as never)).toThrow(InvalidColorError);
    expect(text).not.toHaveBeenCalled();
    expect(doc.coverPage).toBeUndefined();
    expect(doc.doc.getNumberOfPages()).toBe(1);
  });
});

/** A callback that throws. */
const boom = (): never => {
  throw new Error('boom');
};

/** `cover` or `backCover` through the same calls, for what both do with a custom `draw`. */
const DESIGNED_PAGES = [
  {
    name: 'cover',
    call: (doc: PDFDocument, options: object) => doc.cover('Title', options as CoverOptions),
    marked: (doc: PDFDocument) => doc.coverPage,
    // The page it goes on, from a document of one page.
    page: 1,
    variants: /"nope".*'wave', 'image', 'custom'/,
  },
  {
    name: 'back cover',
    call: (doc: PDFDocument, options: object) => doc.backCover(options as BackCoverOptions),
    marked: (doc: PDFDocument) => doc.backCoverPage,
    page: 2,
    variants: /"nope".*'plain', 'custom'/,
  },
];

describe.each(DESIGNED_PAGES)('custom $name', (kind) => {
  const custom = (doc: PDFDocument, draw: (ctx: PDFDocument) => unknown) => kind.call(doc, { variant: 'custom', draw });

  it('runs the callback once, with the document, on its page already marked and left unnumbered', () => {
    const doc = makeDoc();
    const seen: Array<[PDFDocument, number, number | undefined]> = [];
    custom(doc, (ctx) => seen.push([ctx, ctx.pageNumber, kind.marked(ctx)]));
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe(doc);
    expect(seen[0].slice(1)).toEqual([kind.page, kind.page]);
    expect(kind.marked(doc)).toBe(kind.page);
    expect(doc.pageLabels.has(kind.page)).toBe(false);
  });

  it('draws with the primitives', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    custom(doc, (ctx) => ctx.heading('Drawn').paragraph('Draft'));
    expect(textOf(texts, 'Drawn').page).toBe(kind.page);
    expect(textOf(texts, 'Draft').page).toBe(kind.page);
  });

  it('keeps its first page when the callback runs onto other pages, which are content, and warns once', () => {
    const doc = makeDoc();
    custom(doc, (ctx) => ctx.addPage().addPage());
    expect(kind.marked(doc)).toBe(kind.page);
    expect(doc.warnings).toEqual([
      `The ${kind.name} drew past its page: only its first page is treated as the ${kind.name}`,
    ]);
    expect(doc.pageLabels.has(kind.page + 1)).toBe(true);
    expect(doc.pageLabels.has(kind.page + 2)).toBe(true);
  });

  it('does not warn for the scratch pages of a keepTogether in the callback', () => {
    // In debug mode a warning is printed when raised, even if a measuring pass rolls it back.
    const doc = makeDoc({ debug: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    custom(doc, (ctx) => ctx.paragraph('Intro.').keepTogether(() => ctx.paragraph('Kept.')));
    expect(warn).not.toHaveBeenCalled();
    expect(doc.warnings).toEqual([]);
    warn.mockRestore();
  });

  it('rejects an unknown variant before drawing anything, waiting headings included', () => {
    const doc = makeDoc();
    doc.heading('Waiting');
    const text = vi.spyOn(doc.doc, 'text');
    expect(() => kind.call(doc, { variant: 'nope' })).toThrow(InvalidOptionError);
    expect(() => kind.call(doc, { variant: 'nope' })).toThrow(kind.variants);
    expect(text).not.toHaveBeenCalled();
    expect(kind.marked(doc)).toBeUndefined();
    expect(doc.doc.getNumberOfPages()).toBe(1);
  });

  it('rejects a custom variant without a draw function before drawing anything', () => {
    const doc = makeDoc();
    doc.heading('Waiting');
    const text = vi.spyOn(doc.doc, 'text');
    expect(() => kind.call(doc, { variant: 'custom' })).toThrow(InvalidOptionError);
    expect(text).not.toHaveBeenCalled();
    expect(doc.doc.getNumberOfPages()).toBe(1);
  });

  it('draws a heading the callback leaves waiting on its page, with no overflow warning', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    custom(doc, (ctx) => ctx.heading('Thanks'));
    expect(textOf(texts, 'Thanks').page).toBe(kind.page);
    expect(doc.warnings).toEqual([]);
  });

  describe('when the callback throws', () => {
    it('lets the error through and leaves the document as it was', () => {
      const doc = makeDoc();
      doc.paragraph('Body.');
      const y = doc.peekYPos();
      setForeignState(doc);
      const before = drawingState(doc);

      const run = () =>
        custom(doc, (ctx) => {
          ctx.addPage();
          ctx.addWarning('Half done');
          changeEverything(ctx);
          boom();
        });
      expect(run).toThrow('boom');

      expect(doc.doc.getNumberOfPages()).toBe(1);
      expect(doc.pageNumber).toBe(1);
      expect(kind.marked(doc)).toBeUndefined();
      expect(doc.peekYPos()).toBe(y);
      expect(doc.warnings).toEqual([]);
      expect(drawingState(doc)).toEqual(before);
    });

    it('leaves the document usable', () => {
      const doc = makeDoc();
      expect(() => custom(doc, boom)).toThrow('boom');

      custom(doc, () => {});
      expect(kind.marked(doc)).toBe(kind.page);
      expect(doc.pageLabels.size).toBe(1);
      expect(doc.toBuffer().byteLength).toBeGreaterThan(0);
    });

    it('puts the page frame back when it is called from a column', () => {
      const doc = makeDoc();
      const seen: number[] = [];
      doc.columns([
        (column, x) => {
          expect(() => custom(column, boom)).toThrow('boom');
          seen.push(column.margins.left - x);
        },
      ]);
      expect(seen).toEqual([0]);
    });
  });
});

describe('custom cover', () => {
  it('receives the title, then starts the content on a new page', () => {
    const doc = makeDoc();
    const draw = vi.fn();
    doc.cover('Annual report', { variant: 'custom', draw });
    expect(draw).toHaveBeenCalledWith(doc, 'Annual report');
    expect(doc.pageNumber).toBe(2);
    expect(doc.pageLabels.get(2)).toBe(1);
  });

  it('paints the theme background color before the callback runs', () => {
    const doc = makeDoc({ theme: createTheme({ colors: { primary: '#3572B8', background: '#F5F0E6' } }) });
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.addPage();
    let fills = 0;
    doc.cover('Title', {
      variant: 'custom',
      draw: () => {
        fills = rect.mock.calls.filter(
          ([x, y, w, h]) => x === 0 && y === 0 && w === doc.pageWidth && h === doc.pageHeight,
        ).length;
      },
    });
    expect(fills).toBe(1);
  });

  it('marks the page it started on, wherever the callback leaves the document', () => {
    const doc = makeDoc();
    doc.paragraph('Letter.').addPage();
    doc.cover('Title', { variant: 'custom', draw: () => {} });
    expect(doc.coverPage).toBe(2);
  });
});

describe('custom back cover', () => {
  it('runs no `onNewPage` hook on its page', () => {
    const doc = makeDoc();
    const hook = vi.fn();
    doc.onNewPage(hook);
    doc.paragraph('Content');
    doc.backCover({ variant: 'custom', draw: (ctx) => ctx.paragraph('Bye') });
    expect(hook).not.toHaveBeenCalled();
  });

  it('accepts the plain variant by name, like no variant', () => {
    const named = makeDoc();
    named.backCover({ variant: 'plain', legalText: 'Legal' });
    const bare = makeDoc();
    bare.backCover({ legalText: 'Legal' });
    expect(named.backCoverPage).toBe(bare.backCoverPage);
    expect(pageStream(named, 2)).toBe(pageStream(bare, 2));
  });
});

describe('plain back cover', () => {
  it('keeps the logo fields left undefined at their default', () => {
    const doc = makeDoc();
    doc.registerImage('logo', loadLogo());
    const image = vi.spyOn(doc.doc, 'addImage');
    doc.backCover({ logo: { image: 'logo', x: undefined, y: undefined, height: undefined } });

    expect(logoBox(image)).toEqual({ x: COVER.backInset, y: COVER.backInset, height: LOGO.height });
  });

  it('draws the contact lines and the legal text, and closes its page', () => {
    const doc = makeDoc();
    doc.paragraph('Content');
    const texts = recordTexts(doc);
    doc.backCover({ contact: { lines: ['a@b.c', '+1 555 0100'], x: 30, y: 60 }, legalText: 'Legal' });

    expect(textOf(texts, 'a@b.c').x).toBe(30);
    expect(textOf(texts, 'a@b.c').y).toBe(60);
    expect(textOf(texts, 'Legal').align).toBe('center');
    expect(textOf(texts, 'Legal').y).toBe(doc.pageHeight - COVER.legalBottomMargin);
    expect(doc.peekYPos()).toBe(doc.layout.bottom(doc.pageHeight));
    expect(doc.warnings).toEqual([]);
  });

  it('wraps a long contact line to the page right of its position, less the inset', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.backCover({ contact: { lines: [LONG, 'hello@example.com'], x: 60, y: 60 } });
    const lines = texts.filter((call) => call.page === 2);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.at(-1)!.lines).toEqual(['hello@example.com']);
    expectTextWithin(lines, 60, doc.pageWidth - COVER.backInset);
    // One baseline after the other, from `y`.
    const step = lines[1].y - lines[0].y;
    lines.forEach((line, index) => expect(line.y).toBeCloseTo(60 + index * step, 6));
  });

  it('wraps a long legal text to the page less the insets, its last line on the bottom baseline', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.backCover({ legalText: LONG });
    const lines = texts.filter((call) => call.page === 2);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.align).toBe('center');
      expect(line.x - line.widths[0] / 2).toBeGreaterThanOrEqual(COVER.backInset - 1e-6);
      expect(line.x + line.widths[0] / 2).toBeLessThanOrEqual(doc.pageWidth - COVER.backInset + 1e-6);
    }
    expect(lines.at(-1)!.y).toBe(doc.pageHeight - COVER.legalBottomMargin);
    expect(lines.map((line) => line.lines.join(' ')).join(' ')).toBe(LONG);
  });

  it('refuses a contact position that leaves its lines no width, before drawing', () => {
    const doc = makeDoc();
    const drawing = watchDrawing(doc);
    expect(() => doc.backCover({ image: PNG, contact: { lines: ['a'], x: doc.pageWidth - COVER.backInset } })).toThrow(
      /backCover contact/,
    );
    drawing.nothingDrawn();
  });

  it('draws nothing for a contact without a line', () => {
    const doc = makeDoc();
    const text = vi.spyOn(doc.doc, 'text');
    doc.backCover({ contact: { lines: [] } });
    expect(text).not.toHaveBeenCalled();
  });
});

const withLayout = () =>
  makeDoc({
    theme: createTheme({
      colors: { primary: '#3572B8' },
      assets: { covers: { full: { color: '#000000', titleX: 20, titleY: 40 } } },
    }),
  });
// The values they refuse are in `option-validation.test.ts`.
describe('invalid logo and contact positions', () => {
  it('leave no cover or back cover recorded', () => {
    const doc = withLayout();
    doc.registerImage('logo', loadLogo());
    expect(() => doc.cover('Title', { variant: 'wave', logo: { image: 'logo', height: 0 } })).toThrow(
      InvalidOptionError,
    );
    expect(() => doc.backCover({ contact: { lines: ['a@b.c'], x: Number.NaN } })).toThrow(/backCover contact x/);
    expect(doc.coverPage).toBeUndefined();
    expect(doc.backCoverPage).toBeUndefined();
  });
});

describe('covers called from a column', () => {
  it('draw a wave cover with the geometry of the page, not the column', () => {
    const doc = makeDoc({ margins: { left: 25 } });
    const rect = vi.spyOn(doc.doc, 'rect');
    doc.columns([() => {}, (column, x) => column.cover('Title', { variant: 'wave' }).paragraph(`at ${x}`)]);

    // The accent bar sits on the left margin of the page, not at the left of the column.
    expect(accentBar(rect)[0]).toBe(25);
    expect(doc.coverPage).toBe(1);
  });

  it('give a custom cover and back cover the page margins and content width', () => {
    const doc = makeDoc({ margins: { left: 25, right: 15 } });
    const seen: Record<string, number> = {};
    doc.columns([
      () => {},
      (column, x, width) => {
        column.cover('Title', {
          variant: 'custom',
          draw: (ctx) => Object.assign(seen, { coverLeft: ctx.margins.left, coverWidth: ctx.contentWidth }),
        });
        // The column is back after the cover.
        Object.assign(seen, { columnLeft: column.margins.left - x, columnWidth: column.contentWidth - width });
        column.backCover({
          variant: 'custom',
          draw: (ctx) => Object.assign(seen, { backLeft: ctx.margins.left, backWidth: ctx.contentWidth }),
        });
      },
    ]);

    const pageWidth = doc.pageWidth - 25 - 15;
    expect(seen).toEqual({
      coverLeft: 25,
      coverWidth: pageWidth,
      columnLeft: 0,
      columnWidth: 0,
      backLeft: 25,
      backWidth: pageWidth,
    });
    expect(doc.coverPage).toBe(1);
    expect(doc.backCoverPage).toBe(3);
  });

  it('place the plain back cover contact from the page, and raise no column warning', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.columns([() => {}, (column) => column.backCover({ contact: { lines: ['Contact'] } })]);

    expect(textOf(texts, 'Contact').x).toBe(COVER.backInset);
    expect(doc.warnings).toEqual([]);
  });

  it('draw an image cover logo from the page margin', () => {
    const doc = makeDoc({
      margins: { left: 25 },
      theme: createTheme({
        colors: { primary: '#3572B8' },
        assets: { covers: { full: { color: '#000000', titleX: 20, titleY: 40 } } },
      }),
    });
    doc.registerImage('logo', PNG);
    const image = vi.spyOn(doc.doc, 'addImage');
    doc.columns([
      () => {},
      (column) => column.cover('Title', { variant: 'image', layout: 'full', logo: { image: 'logo' } }),
    ]);

    expect(logoBox(image).x).toBe(25);
  });
});

/** A custom cover, a table of contents, two sections and a custom back cover. */
function customCoveredDoc(): PDFDocument {
  const doc = makeDoc();
  doc.cover('Title', { variant: 'custom', draw: (ctx, title) => ctx.doc.text(title, 20, 40) });
  doc.tableOfContents();
  doc.heading('First', { level: 'h2' }).paragraph('One.');
  doc.addPage().heading('Second', { level: 'h2' }).paragraph('Two.');
  doc.backCover({ variant: 'custom', draw: (ctx) => ctx.doc.text('Bye', 20, 40) });
  return doc;
}

describe('page numbers and table of contents', () => {
  it('numbers neither the custom cover nor the custom back cover', () => {
    const doc = customCoveredDoc();
    expect([...doc.pageLabels]).toEqual([
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
    expect(doc.coverPage).toBe(1);
    expect(doc.backCoverPage).toBe(5);
  });

  it('draws the footer and the running header on the content pages only', () => {
    const doc = customCoveredDoc();
    doc.pageHeader({ title: 'Report' }).pageFooter({ left: 'Acme Corp', right: '{page}/{pages}' });
    const texts = recordTexts(doc);
    doc.finalize();

    expect(texts.filter((call) => call.lines[0] === 'ACME CORP').map((call) => call.page)).toEqual([2, 3, 4]);
    expect(texts.filter((call) => call.lines[0] === 'REPORT').map((call) => call.page)).toEqual([2, 3, 4]);
    expect(texts.filter((call) => /^\d\/\d$/.test(call.lines[0])).map((call) => call.lines[0])).toEqual([
      '1/3',
      '2/3',
      '3/3',
    ]);
  });

  it('lists the headings with their printed page number, the covers left out', () => {
    const doc = customCoveredDoc();
    const texts = recordTexts(doc);
    doc.finalize();

    expect(doc.pageRefs.tocEntries.map((entry) => [entry.label, entry.page])).toEqual([
      ['First', 3],
      ['Second', 4],
    ]);
    const numbers = texts.filter((call) => call.page === 2 && /^\d$/.test(call.lines[0])).map((c) => c.lines[0]);
    // Printed numbers count from the first page after the cover.
    expect(numbers).toEqual(['2', '3']);
  });

  it('moves a custom cover drawn after the table of contents when the table inserts pages', () => {
    const doc = makeDoc();
    doc.tableOfContents();
    for (let index = 1; index <= 90; index++) doc.heading(`Section ${index}`, { level: 'h2' }).paragraph('Body.');
    doc.addPage().cover('Part two', { variant: 'custom', draw: (ctx, title) => ctx.doc.text(title, 20, 40) });
    doc.paragraph('After.');
    const coverPage = doc.coverPage!;
    const pagesBefore = doc.doc.getNumberOfPages();

    doc.finalize();

    const inserted = doc.doc.getNumberOfPages() - pagesBefore;
    expect(inserted).toBeGreaterThan(0);
    expect(doc.coverPage).toBe(coverPage + inserted);
    expect(pageStream(doc, doc.coverPage!)).toContain('(Part two)');
    expect(doc.pageLabels.has(doc.coverPage!)).toBe(false);
    expect(doc.pageLabels.size).toBe(doc.doc.getNumberOfPages() - 1);
  });

  it('keeps the references right when the table of contents inserts pages', () => {
    const doc = makeDoc();
    doc.cover('Title', { variant: 'custom', draw: () => {} });
    doc.tableOfContents();
    for (let index = 1; index <= 90; index++) doc.heading(`Section ${index}`, { level: 'h2' }).paragraph('Body.');
    doc.backCover({ variant: 'custom', draw: () => {} });
    const pagesBefore = doc.doc.getNumberOfPages();

    doc.finalize();

    expect(doc.doc.getNumberOfPages()).toBeGreaterThan(pagesBefore);
    expect(doc.coverPage).toBe(1);
    expect(doc.backCoverPage).toBe(doc.doc.getNumberOfPages());
    expect(doc.pageLabels.size).toBe(doc.doc.getNumberOfPages() - 2);
  });
});
