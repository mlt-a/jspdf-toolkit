import type { DocumentOptions } from '../../src/core/document';
import { PDFDocument } from '../../src/core/document';
import { drawBox, drawInfoBox } from '../../src/drawing/boxes';
import { drawHighlightedText } from '../../src/drawing/highlights';
import { drawIconWithText } from '../../src/drawing/icons';
import { drawImage } from '../../src/drawing/image-helpers';
import { parseRichText } from '../../src/text/markup';
import { createTheme } from '../../src/theme/defaults';
import { LONG, PNG, changeEverything, makeDoc } from './helpers';

/** A document with the image `img` registered, for the primitives that draw one. */
export function makeDocWithImage(options: DocumentOptions = {}): PDFDocument {
  const doc = makeDoc(options);
  doc.registerImage('img', PNG);
  return doc;
}

export const imageCover = () =>
  createTheme({
    name: 't',
    colors: { primary: '#3572B8' },
    assets: { covers: { full: { titleX: 20, titleY: 100, color: 'primary', logo: {} } } },
  } as never);

export type Case = [name: string, run: (doc: PDFDocument) => unknown];

/** A public function a case exercises: the coverage guard compares it to the exports, not its label. */
type Primitive = (doc: PDFDocument, ...args: never[]) => unknown;
export type PrimitiveCase = [...Case, fn: Primitive];

/** The case of `fn`: `call` receives `fn` itself, and the label is derived from `fn.name`. */
export function primitive<F extends Primitive>(
  fn: F,
  call: (fn: F, doc: PDFDocument) => unknown,
  detail?: string,
): PrimitiveCase {
  return [detail ? `${fn.name}, ${detail}` : fn.name, (doc) => call(fn, doc), fn];
}

// Flow primitives: drawn through the fluent API, from the top of the page and from its bottom (page break).
export const FLOW: Case[] = [
  ['heading', (d) => d.heading('Title', { keepWithNext: false })],
  ['heading with number and rule', (d) => d.heading('Title', { number: '1', rule: true, keepWithNext: false })],
  ['heading kept with the next block', (d) => d.heading('Title').paragraph('Next')],
  ['paragraph', (d) => d.paragraph(LONG)],
  ['paragraph, justified', (d) => d.paragraph(LONG, { align: 'justify', level: 'small' })],
  ['paragraphs', (d) => d.paragraphs(['One', 'Two'], { level: 'caption' })],
  ['richText', (d) => d.richText('A **bold** and *italic* [link](https://example.com) text.')],
  ['richBlocks', (d) => d.richBlocks(parseRichText('One **two**\n\nThree'))],
  ['separator', (d) => d.separator()],
  ['bulletList', (d) => d.bulletList(['One', { text: 'Two', subItems: ['Sub'], detail: 'Detail' }])],
  ['numberedList', (d) => d.numberedList(['One', 'Two'])],
  ['iconList', (d) => d.iconList(['One', 'Two'], { icon: 'img' })],
  ['iconList, unknown icon', (d) => d.iconList(['One', 'Two'], { icon: 'missing' })],
  ['checkbox', (d) => d.checkbox('Agreed', { variant: 'checked' })],
  ['inlineQuestion', (d) => d.inlineQuestion('Agreed?', { answer: 'yes' })],
  [
    'fields, stacked',
    (d) =>
      d.fields([
        { label: 'A', value: 'b', highlight: true, complement: 'c' },
        { label: 'D', value: 'e' },
      ]),
  ],
  ['fields, inline', (d) => d.fields([{ label: 'A', value: LONG, highlight: true }], { layout: 'inline' })],
  ['fields, leader', (d) => d.fields([{ label: 'A', value: 'b', highlight: true }], { layout: 'leader' })],
  ['fieldRows', (d) => d.fieldRows([[{ label: 'A', value: 'b' }], [{ label: 'C', value: 'd' }]])],
  ['infoBox, surface', (d) => d.infoBox('Content', { title: 'Title', bulletPoints: ['One', 'Two'], icon: 'img' })],
  ['infoBox, callout', (d) => d.infoBox('Content', { variant: 'callout', eyebrow: 'Note', title: 'Title' })],
  [
    'declarationsBox',
    (d) =>
      d.declarationsBox([{ text: 'I declare it', highlights: [{ text: 'declare', strong: true }] }], {
        intro: 'Intro',
        icon: 'img',
      }),
  ],
  [
    'addressBlock',
    (d) =>
      d.addressBlock([
        { text: 'Acme Corp', role: 'title' },
        { text: 'Subtitle', role: 'subtitle' },
        { text: '1 Main Street', role: 'address' },
      ]),
  ],
  [
    'signatureZone',
    (d) =>
      d.signatureZone([{ label: 'Client', sublabel: 'Jane', image: 'img' }, { label: 'Supplier' }], {
        caption: 'London',
      }),
  ],
  [
    'donutChart',
    (d) =>
      d.donutChart(
        [
          { label: 'A', value: 3, legendValue: '$3' },
          { label: 'B', value: 1 },
        ],
        { centerLabel: 'Total' },
      ),
  ],
  ['donutChart, pie without legend', (d) => d.donutChart([{ label: 'A', value: 3 }], { innerRatio: 0, legend: false })],
  ['donutChart, empty text', (d) => d.donutChart([], { emptyText: 'No data' })],
  [
    'stackedBar',
    (d) =>
      d.stackedBar([
        { label: 'A', value: 3, color: 'success' },
        { label: 'B', value: 1 },
      ]),
  ],
  ['stackedBar, empty text', (d) => d.stackedBar([], { emptyText: 'No data' })],
  [
    'columnChart',
    (d) =>
      d.columnChart(
        [
          { label: 'Q1', valueLabel: '120', values: [80, 40] },
          { label: 'Q2', valueLabel: '150', values: [95, 55] },
        ],
        {
          series: [{ label: 'Licences' }, { label: 'Services', color: 'secondary' }],
          reference: { value: 140, label: 'Target' },
        },
      ),
  ],
  ['columnChart, empty text', (d) => d.columnChart([], { emptyText: 'No data' })],
  [
    'lineChart',
    (d) =>
      d.lineChart(
        {
          xs: [1, 2, 3],
          lines: [
            { label: 'A', values: [1, 2, 3], emphasis: true },
            { label: 'B', values: [3, 2, 1], dash: [2, 1] },
          ],
          band: { label: 'Range', lower: [0, 1, 1], upper: [2, 3, 4] },
        },
        { xTitle: 'Year', yTitle: 'Value', highlight: { from: 1, to: 2, label: 'Period' } },
      ),
  ],
  ['lineChart, empty text', (d) => d.lineChart({ xs: [1], lines: [] }, { emptyText: 'No data' })],
  ['columns', (d) => d.columns([(c, x) => c.doc.text('a', x, 30), (c, x) => c.doc.text('b', x, 30)])],
  [
    'columns of blocks',
    (d) =>
      d.columns([
        (c) => c.heading('Left', { level: 'h3' }).paragraph(LONG),
        (c) => c.bulletList(['One', 'Two']).fields([{ label: 'A', value: 'b', highlight: true }]),
      ]),
  ],
  ['logo', (d) => d.logo('img')],
  ['logo on the page', (d) => d.logo('img', { x: 10, y: 10, anchor: 'top-right' })],
  ['badge', (d) => d.badge('Draft')],
  [
    'headerColumns',
    (d) =>
      d.headerColumns([
        { title: 'Seller', fields: [{ label: 'Name', value: 'Acme' }] },
        { title: 'Buyer', fields: [{ label: 'Name', value: 'Corp' }] },
      ]),
  ],
  [
    'table',
    (d) =>
      d.table(
        [
          { a: 'one', b: 'two' },
          { a: 'three', b: 'four' },
        ],
        {
          columns: [
            { header: 'A', key: 'a' },
            { header: 'B', key: 'b', align: 'right' },
          ],
          footRow: ['x', 'y'],
        },
      ),
  ],
  [
    'table across pages, styled cells',
    (d) =>
      d.table(
        Array.from({ length: 60 }, (_, i) => ({ a: `Row ${i}`, b: i })),
        {
          columns: [
            { header: 'A', key: 'a' },
            { header: 'B', key: 'b', align: 'right' },
          ],
          continuationTitle: 'Rows (continued)',
          cellStyle: ({ section, rowIndex }) =>
            section === 'body' && rowIndex % 3 === 0 ? { color: 'error', fill: 'tint', italic: true } : undefined,
        },
      ),
  ],
  // Drawn by `finalize()`, which runs on every page.
  ['watermark', (d) => d.watermark('DRAFT').finalize()],
  ['watermark on every page', (d) => d.watermark('DRAFT', { allPages: true }).addPage().finalize()],
  ['background', (d) => d.background('img')],
  ['closingNote', (d) => d.closingNote('Legal mentions')],
  ['tableOfContents', (d) => d.tableOfContents({ title: 'Contents', intro: 'Intro' })],
  ['cover, wave', (d) => d.cover('Title', { variant: 'wave', subtitle: 'Sub', image: 'img', logo: { image: 'img' } })],
  ['cover, wave without image', (d) => d.cover('Title', { variant: 'wave', subtitle: 'Sub' })],
  [
    'cover, wave with colors',
    (d) =>
      d.cover('Title', {
        variant: 'wave',
        subtitle: 'Sub',
        titleColor: 'primary',
        subtitleColor: '#112233',
        waveColor: 'tint',
        accentBar: false,
      }),
  ],
  ['cover, custom', (d) => d.cover('Title', { variant: 'custom', draw: changeEverything })],
  [
    'backCover',
    (d) => d.backCover({ image: 'img', logo: { image: 'img' }, contact: { lines: ['a', 'b'] }, legalText: 'Legal' }),
  ],
  ['backCover, empty', (d) => d.backCover()],
  ['backCover, custom', (d) => d.backCover({ variant: 'custom', draw: changeEverything })],
  [
    'pageHeader and pageFooter',
    (d) =>
      d
        .pageHeader({ title: 'Report', folio: true })
        .pageFooter({ left: 'Left', right: '{page}/{pages}' })
        .paragraph('Body')
        .finalize(),
  ],
  ['toBuffer', (d) => d.heading('Title').paragraph('Body').toBuffer()],
];

// Coordinate primitives and measures take the document directly.
export const DIRECT: PrimitiveCase[] = [
  primitive(drawBox, (fn, d) => fn(d, { x: 10, y: 10, width: 50, height: 10, boxStyle: 'tint' })),
  primitive(drawBox, (fn, d) => fn(d, { x: 10, y: 10, width: 50, height: 10, boxStyle: 'border' }), 'border'),
  primitive(drawInfoBox, (fn, d) => fn(d, 'Content', { title: 'Title' }), 'surface'),
  primitive(drawHighlightedText, (fn, d) => fn(d, 'Total', { x: 20, y: 40, strong: true })),
  primitive(drawIconWithText, (fn, d) =>
    fn(d, 'Text', { x: 20, y: 40, icon: 'img', level: 'small', color: 'primary' }),
  ),
  primitive(drawImage, (fn, d) => fn(d, 'img', { x: 20, y: 40, width: 10 })),
  primitive(drawImage, (fn, d) => fn(d, 'missing', { x: 20, y: 40, width: 10 }), 'unreadable'),
];
