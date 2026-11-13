import { describe, expect, it } from 'vitest';

import { BADGE, BOX, CALLOUT, CHECKBOX, ICONS, LIST } from '../../src/core/constants';
import { PDFDocument } from '../../src/core/document';
import { InvalidColorError, InvalidOptionError } from '../../src/core/errors';
import { parseAddressLines } from '../../src/drawing/address';
import type { InfoBoxOptions } from '../../src/drawing/boxes';
import { computeInfoBoxHeight, drawBox } from '../../src/drawing/boxes';
import {
  computeColumnChartHeight,
  computeDonutChartHeight,
  computeLineChartHeight,
  computeStackedBarHeight,
} from '../../src/drawing/charts';
import { computeDeclarationsBoxHeight } from '../../src/drawing/declarations';
import { drawHighlightedText, measureHighlightedText } from '../../src/drawing/highlights';
import { drawIconWithText } from '../../src/drawing/icons';
import { drawImage } from '../../src/drawing/image-helpers';
import { computeRichBlocksHeight, computeRichTextHeight } from '../../src/drawing/rich';
import { computeSignatureZoneHeight } from '../../src/drawing/signatures';
import { computeParagraphHeight, measureTextLevel, setTextStyle } from '../../src/drawing/text';
import { setFont } from '../../src/drawing/text-style';
import { loadFontFromBase64 } from '../../src/fonts/loader';
import { parseRichInline, parseRichText } from '../../src/text/markup';
import { createTheme } from '../../src/theme/defaults';
import { NOT_FINITE, PNG, expectRejectedBeforeDrawing, leaveRoom, watchDrawing } from './helpers';
import { imageCover, makeDocWithImage } from './primitive-cases';

// Every option a primitive checks before it draws, with the values it refuses. Each case runs on content to draw and,
// for a primitive that takes content, on nothing to draw: an invalid option throws in both, before anything is drawn,
// a page added, the position moved or a warning raised. The structures of content (an item of a list, a field, a
// column, a part of a chart) are checked the same way, at the end of this file: what a type makes required, and the
// options of another variant. A check whose meaning is particular to one block (the length of a chart series, a table
// column width) stays in the file of that block.

/** Any finite number: a space under or above a block, a coordinate, an indent. */
const FINITE = NOT_FINITE;
/** 0 or more: a gap, a padding, a radius. */
const GAP = [-1, ...NOT_FINITE];
/** Values that are not text, for an option that must be a string. */
const NOT_TEXT = [5, null, {}, ['a']];
/** Above 0: a width, a height, a scale. */
const SIZE = [0, -1, ...NOT_FINITE];

type Run = (doc: PDFDocument) => unknown;
type Case = [label: string, run: Run, makeDoc: () => PDFDocument];

const show = (value: unknown) => (typeof value === 'string' ? JSON.stringify(value) : String(value));

/**
 * The cases of one option: `call` draws with the option set to each of `values`; `empty`, when given, makes the same
 * call with nothing to draw.
 */
function option<V>(
  name: string,
  values: readonly V[],
  call: (doc: PDFDocument, value: V) => unknown,
  empty?: (doc: PDFDocument, value: V) => unknown,
  makeDoc: () => PDFDocument = makeDocWithImage,
): Case[] {
  return values.flatMap((value): Case[] => [
    [`${name} ${show(value)}`, (doc) => call(doc, value), makeDoc],
    ...(empty ? [[`${name} ${show(value)}, nothing to draw`, (doc) => empty(doc, value), makeDoc] as Case] : []),
  ]);
}

/** One call that must throw before drawing. */
const single = (label: string, run: Run, makeDoc: () => PDFDocument = makeDocWithImage): Case[] => [
  [label, run, makeDoc],
];

/** Widths (mm) a list frame needs: its bullet, and the nested dash under the sub-item indent. */
const LIST_FRAME = { item: LIST.bulletPrefixWidth, subItem: LIST.subIndent + LIST.bulletPrefixWidth };

const STACKED = { label: 'Name', value: 'Acme' };
const TABLE = { columns: [{ header: 'A', key: 'a' }] };
const BOX_OPTIONS = { x: 10, y: 10, width: 40, height: 20, boxStyle: 'tint' } as const;
const COLUMN = { title: 'Seller', fields: [STACKED] };

// === Spaces between blocks and inside them ===

const SPACES: Case[] = [
  ...option(
    'paragraph spaceAfter',
    FINITE,
    (d, v) => d.paragraph('Text', { spaceAfter: v }),
    (d, v) => d.paragraph('', { spaceAfter: v }),
  ),
  ...option(
    'paragraphs spaceAfter',
    FINITE,
    (d, v) => d.paragraphs(['One', 'Two'], { spaceAfter: v }),
    (d, v) => d.paragraphs([], { spaceAfter: v }),
  ),
  ...option(
    'paragraphs itemSpacing',
    GAP,
    (d, v) => d.paragraphs(['One', 'Two'], { itemSpacing: v }),
    (d, v) => d.paragraphs(['', ''], { itemSpacing: v }),
  ),
  ...option('heading spaceBefore', FINITE, (d, v) => d.heading('Title', { spaceBefore: v, keepWithNext: false })),
  ...option('heading spaceAfter', FINITE, (d, v) => d.heading('Title', { spaceAfter: v, keepWithNext: false })),
  ...option(
    'richText spaceAfter',
    FINITE,
    (d, v) => d.richText('**Bold**', { spaceAfter: v }),
    (d, v) => d.richText('', { spaceAfter: v }),
  ),
  ...option('separator spaceBefore', FINITE, (d, v) => d.separator({ spaceBefore: v })),
  ...option('separator spaceAfter', FINITE, (d, v) => d.separator({ spaceAfter: v })),
  ...option('separator lineWidth', SIZE, (d, v) => d.separator({ lineWidth: v })),
  ...option(
    'bulletList spaceAfter',
    FINITE,
    (d, v) => d.bulletList(['One'], { spaceAfter: v }),
    (d, v) => d.bulletList([], { spaceAfter: v }),
  ),
  ...option(
    'bulletList itemSpacing',
    GAP,
    (d, v) => d.bulletList(['One', 'Two'], { itemSpacing: v }),
    (d, v) => d.bulletList([], { itemSpacing: v }),
  ),
  ...option(
    'numberedList itemSpacing',
    GAP,
    (d, v) => d.numberedList(['One', 'Two'], { itemSpacing: v }),
    (d, v) => d.numberedList([], { itemSpacing: v }),
  ),
  ...option(
    'iconList spaceAfter',
    FINITE,
    (d, v) => d.iconList(['One'], { icon: 'img', spaceAfter: v }),
    (d, v) => d.iconList([], { icon: 'img', spaceAfter: v }),
  ),
  ...option('checkbox spaceAfter', FINITE, (d, v) => d.checkbox('Agreed', { spaceAfter: v })),
  ...option('inlineQuestion spaceAfter', FINITE, (d, v) => d.inlineQuestion('Agreed?', { spaceAfter: v })),
  ...option(
    'fields spaceAfter',
    FINITE,
    (d, v) => d.fields([STACKED], { spaceAfter: v }),
    (d, v) => d.fields([], { spaceAfter: v }),
  ),
  ...option(
    'fieldRows rowGap',
    GAP,
    (d, v) => d.fieldRows([[STACKED], [STACKED]], { rowGap: v }),
    (d, v) => d.fieldRows([], { rowGap: v }),
  ),
  ...option(
    'fieldRows rowGap, leader',
    GAP,
    (d, v) => d.fieldRows([[STACKED], [STACKED]], { layout: 'leader', rowGap: v }),
    (d, v) => d.fieldRows([[]], { layout: 'leader', rowGap: v }),
  ),
  ...option('infoBox spaceAfter', FINITE, (d, v) => d.infoBox('Content', { title: 'Title', spaceAfter: v })),
  ...option(
    'declarationsBox spaceAfter',
    FINITE,
    (d, v) => d.declarationsBox([{ text: 'Statement' }], { spaceAfter: v }),
    (d, v) => d.declarationsBox([], { spaceAfter: v }),
  ),
  ...option(
    'addressBlock spaceAfter',
    FINITE,
    (d, v) => d.addressBlock([{ text: 'Acme', role: 'title' }], { spaceAfter: v }),
    (d, v) => d.addressBlock([], { spaceAfter: v }),
  ),
  ...option(
    'signatureZone spaceAfter',
    FINITE,
    (d, v) => d.signatureZone([{ label: 'Client' }], { spaceAfter: v }),
    (d, v) => d.signatureZone([], { spaceAfter: v }),
  ),
  ...option(
    'signatureZone gap',
    GAP,
    (d, v) => d.signatureZone([{ label: 'Client' }, { label: 'Supplier' }], { gap: v }),
    (d, v) => d.signatureZone([], { gap: v }),
  ),
  ...option(
    'columns spaceAfter',
    FINITE,
    (d, v) => d.columns([(c) => c.paragraph('Left')], { spaceAfter: v }),
    (d, v) => d.columns([], { spaceAfter: v }),
  ),
  ...option(
    'columns gap',
    GAP,
    (d, v) => d.columns([(c) => c.paragraph('Left'), (c) => c.paragraph('Right')], { gap: v }),
    (d, v) => d.columns([], { gap: v }),
  ),
  ...option('logo spaceAfter', FINITE, (d, v) => d.logo('img', { spaceAfter: v })),
  ...option('badge spaceAfter', FINITE, (d, v) => d.badge('Draft', { spaceAfter: v })),
  ...option(
    'headerColumns spaceAfter',
    FINITE,
    (d, v) => d.headerColumns([COLUMN], { spaceAfter: v }),
    (d, v) => d.headerColumns([], { spaceAfter: v }),
  ),
  ...option(
    'headerColumns gap',
    GAP,
    (d, v) => d.headerColumns([COLUMN, COLUMN], { gap: v }),
    (d, v) => d.headerColumns([], { gap: v }),
  ),
  ...option(
    'table spaceAfter',
    FINITE,
    (d, v) => d.table([{ a: 'one' }], { ...TABLE, spaceAfter: v }),
    (d, v) => d.table([], { ...TABLE, spaceAfter: v }),
  ),
  ...option(
    'donutChart spaceAfter',
    FINITE,
    (d, v) => d.donutChart([{ label: 'A', value: 1 }], { spaceAfter: v }),
    (d, v) => d.donutChart([], { spaceAfter: v }),
  ),
  ...option(
    'stackedBar spaceAfter',
    FINITE,
    (d, v) => d.stackedBar([{ label: 'A', value: 1 }], { spaceAfter: v }),
    (d, v) => d.stackedBar([], { spaceAfter: v }),
  ),
  ...option(
    'columnChart spaceAfter',
    FINITE,
    (d, v) => d.columnChart([{ label: 'Q1', values: [1] }], { spaceAfter: v }),
    (d, v) => d.columnChart([], { spaceAfter: v }),
  ),
  ...option(
    'lineChart spaceAfter',
    FINITE,
    (d, v) => d.lineChart({ xs: [1, 2], lines: [{ label: 'A', values: [1, 2] }] }, { spaceAfter: v }),
    (d, v) => d.lineChart({ xs: [1, 2], lines: [] }, { spaceAfter: v }),
  ),
  ...option(
    'computeDonutChartHeight spaceAfter',
    FINITE,
    (d, v) => computeDonutChartHeight(d, [{ label: 'A', value: 1 }], { spaceAfter: v }),
    (d, v) => computeDonutChartHeight(d, [], { spaceAfter: v }),
  ),
  ...option(
    'computeStackedBarHeight spaceAfter',
    FINITE,
    (d, v) => computeStackedBarHeight(d, [{ label: 'A', value: 1 }], { spaceAfter: v }),
    (d, v) => computeStackedBarHeight(d, [], { spaceAfter: v }),
  ),
  ...option(
    'computeColumnChartHeight spaceAfter',
    FINITE,
    (d, v) => computeColumnChartHeight(d, [{ label: 'Q1', values: [1] }], { spaceAfter: v }),
    (d, v) => computeColumnChartHeight(d, [], { spaceAfter: v }),
  ),
  ...option(
    'computeLineChartHeight spaceAfter',
    FINITE,
    (d, v) => computeLineChartHeight(d, { xs: [1, 2], lines: [{ label: 'A', values: [1, 2] }] }, { spaceAfter: v }),
    (d, v) => computeLineChartHeight(d, { xs: [1, 2], lines: [] }, { spaceAfter: v }),
  ),
  ...option(
    'closingNote bottomGap',
    GAP,
    (d, v) => d.closingNote('Legal', { bottomGap: v }),
    (d, v) => d.closingNote('', { bottomGap: v }),
  ),
  ...option('addSpace', FINITE, (d, v) => d.addSpace(v)),
];

// === Text widths: indent, maxWidth, line height ===

const TEXT_WIDTHS: Case[] = [
  ...option(
    'paragraph indent',
    FINITE,
    (d, v) => d.paragraph('Text', { indent: v }),
    (d, v) => d.paragraph('', { indent: v }),
  ),
  ...option(
    'paragraph maxWidth',
    SIZE,
    (d, v) => d.paragraph('Text', { maxWidth: v }),
    (d, v) => d.paragraph('', { maxWidth: v }),
  ),
  ...option(
    'paragraph lineHeightScale',
    SIZE,
    (d, v) => d.paragraph('Text', { lineHeightScale: v }),
    (d, v) => d.paragraph('', { lineHeightScale: v }),
  ),
  ...option(
    'computeParagraphHeight indent',
    FINITE,
    (d, v) => computeParagraphHeight(d, 'Text', { indent: v }),
    (d, v) => computeParagraphHeight(d, '', { indent: v }),
  ),
  ...option(
    'computeParagraphHeight maxWidth',
    SIZE,
    (d, v) => computeParagraphHeight(d, 'Text', { maxWidth: v }),
    (d, v) => computeParagraphHeight(d, '', { maxWidth: v }),
  ),
  ...option(
    'paragraphs maxWidth',
    SIZE,
    (d, v) => d.paragraphs(['One', 'Two'], { maxWidth: v }),
    (d, v) => d.paragraphs([''], { maxWidth: v }),
  ),
  ...option(
    'richText indent',
    FINITE,
    (d, v) => d.richText('**Bold** text', { indent: v }),
    (d, v) => d.richText('', { indent: v }),
  ),
  ...option('richText maxWidth', SIZE, (d, v) => d.richText('Text', { maxWidth: v })),
  ...option(
    'richBlocks maxWidth',
    SIZE,
    (d, v) => d.richBlocks(parseRichText('Text'), { maxWidth: v }),
    (d, v) => d.richBlocks([], { maxWidth: v }),
  ),
  ...option('computeRichTextHeight indent', FINITE, (d, v) => computeRichTextHeight(d, 'Text', { indent: v })),
  ...option(
    'bulletList indent',
    FINITE,
    (d, v) => d.bulletList(['One'], { indent: v }),
    (d, v) => d.bulletList([], { indent: v }),
  ),
  ...option(
    'numberedList indent',
    FINITE,
    (d, v) => d.numberedList(['One'], { indent: v }),
    (d, v) => d.numberedList([], { indent: v }),
  ),
  ...option(
    'iconList indent',
    FINITE,
    (d, v) => d.iconList(['One'], { icon: 'img', indent: v }),
    (d, v) => d.iconList([], { icon: 'img', indent: v }),
  ),
  ...option(
    'bulletList maxWidth',
    SIZE,
    (d, v) => d.bulletList(['One'], { maxWidth: v }),
    (d, v) => d.bulletList([], { maxWidth: v }),
  ),
  // An indent that leaves a `maxWidth` no room in the content width: there is nothing to bring it down to.
  ...option(
    'paragraph indent past the content width, with a maxWidth',
    [0, 10],
    (d, v) => d.paragraph('Text', { indent: d.contentWidth + v, maxWidth: 50 }),
    (d, v) => d.paragraph('', { indent: d.contentWidth + v, maxWidth: 50 }),
  ),
  ...option('richText indent past the content width, with a maxWidth', [0], (d, v) =>
    d.richText('Text', { indent: d.contentWidth + v, maxWidth: 50 }),
  ),
  ...option('bulletList indent past the content width, with a maxWidth', [0], (d, v) =>
    d.bulletList(['One'], { indent: d.contentWidth + v, maxWidth: 50 }),
  ),
  ...option(
    'bulletList lineHeightScale',
    SIZE,
    (d, v) => d.bulletList(['One'], { lineHeightScale: v }),
    (d, v) => d.bulletList([], { lineHeightScale: v }),
  ),
  ...option('bulletList indent that leaves the item no width', [LIST_FRAME.item, LIST_FRAME.item - 1], (d, v) =>
    d.bulletList(['One'], { indent: d.measure - v }),
  ),
  ...option('bulletList indent that leaves the item a detail no width', [LIST_FRAME.item], (d, v) =>
    d.bulletList([{ text: 'One', detail: 'Detail' }], { indent: d.measure - v }),
  ),
  ...option('bulletList indent that leaves the sub-items no width', [LIST_FRAME.subItem], (d, v) =>
    d.bulletList([{ text: 'One', subItems: ['Two'] }], { indent: d.measure - v }),
  ),
  ...option('bulletList indent that leaves the sub-items and the detail no width', [LIST_FRAME.subItem], (d, v) =>
    d.bulletList([{ text: 'One', subItems: ['Two'], detail: 'Detail' }], { indent: d.measure - v }),
  ),
  ...single('paragraph with an indent that leaves no width', (d) => d.paragraph('Text', { indent: d.measure })),
  ...single('richText with an indent that leaves no width', (d) => d.richText('Text', { indent: d.measure })),
  ...single('bulletList with an indent that leaves no width', (d) => d.bulletList(['One'], { indent: d.measure })),
];

// === Boxes: position, width, and the text width they leave ===

/** The cases of a call made in an inset `width` mm wide, narrower than a box allows: `call`, and `empty` with nothing to draw. */
const inPaddingInset = (
  name: string,
  width: number,
  call: (d: PDFDocument) => unknown,
  empty?: (d: PDFDocument) => unknown,
): Case[] =>
  option(
    name,
    [width],
    (d, v) => d.inset({ width: v }, () => call(d)),
    empty && ((d, v) => d.inset({ width: v }, () => empty(d))),
  );

/** The cases of an info box variant: a frame that is all padding. */
function infoBoxCases(variant: 'surface' | 'callout'): Case[] {
  const base = variant === 'surface' ? { title: 'Box' } : ({ variant, title: 'Note' } as const);
  const padding = BOX.padding * 2 + (variant === 'callout' ? CALLOUT.barWidth + CALLOUT.barGap : 0);
  return [
    ...inPaddingInset(`infoBox ${variant} in an inset as wide as its padding`, padding, (d) =>
      d.infoBox('Content', base),
    ),
    ...inPaddingInset(`computeInfoBoxHeight ${variant} in an inset as wide as its padding`, padding, (d) =>
      computeInfoBoxHeight(d, 'Content', base),
    ),
    ...option(`infoBox ${variant} title`, NOT_TEXT, (d, v) => d.infoBox('Content', { ...base, title: v as string })),
    ...option(`computeInfoBoxHeight ${variant} title`, NOT_TEXT, (d, v) =>
      computeInfoBoxHeight(d, 'Content', { ...base, title: v as string }),
    ),
    ...(variant === 'callout'
      ? option('infoBox callout eyebrow', NOT_TEXT, (d, v) =>
          d.infoBox('Content', { variant: 'callout', eyebrow: v as string }),
        )
      : [
          // The icon sits on the title line: a title is required with it, even an empty one is enough.
          ...single('infoBox surface icon without a title', (d) =>
            d.infoBox('Content', { icon: 'img' } as unknown as InfoBoxOptions),
          ),
          ...single('computeInfoBoxHeight surface icon without a title', (d) =>
            computeInfoBoxHeight(d, 'Content', { icon: 'img' } as unknown as InfoBoxOptions),
          ),
        ]),
  ];
}

const BOXES: Case[] = [
  ...infoBoxCases('surface'),
  ...infoBoxCases('callout'),
  ...option(
    'addressBlock options',
    [5, 'text', ['a']],
    (d, v) => d.addressBlock([{ text: 'Acme', role: 'title' }], v as never),
    (d, v) => d.addressBlock([], v as never),
  ),
  ...inPaddingInset(
    'addressBlock in an inset as wide as its padding',
    BOX.padding * 2,
    (d) => d.addressBlock([{ text: 'Acme', role: 'title' }]),
    (d) => d.addressBlock([]),
  ),
  ...inPaddingInset(
    'declarationsBox in an inset as wide as its padding',
    BOX.padding * 2,
    (d) => d.declarationsBox([{ text: 'Statement' }]),
    (d) => d.declarationsBox([]),
  ),
  ...inPaddingInset(
    'declarationsBox in an inset as wide as its padding and icon',
    BOX.padding * 2 + ICONS.size + ICONS.gap,
    (d) => d.declarationsBox([{ text: 'Statement' }], { icon: 'img' }),
    (d) => d.declarationsBox([], { icon: 'img' }),
  ),
  ...inPaddingInset(
    'computeDeclarationsBoxHeight in an inset as wide as its padding',
    BOX.padding * 2,
    (d) => computeDeclarationsBoxHeight(d, [{ text: 'Statement' }]),
    (d) => computeDeclarationsBoxHeight(d, []),
  ),
  ...option(
    'signatureZone height',
    SIZE,
    (d, v) => d.signatureZone([{ label: 'Client' }], { height: v }),
    (d, v) => d.signatureZone([], { height: v }),
  ),
  ...option(
    'computeSignatureZoneHeight height',
    SIZE,
    (d, v) => computeSignatureZoneHeight(d, [{ label: 'Client' }], { height: v }),
    (d, v) => computeSignatureZoneHeight(d, [], { height: v }),
  ),
  ...option(
    'computeSignatureZoneHeight gap',
    GAP,
    (d, v) => computeSignatureZoneHeight(d, [{ label: 'A' }, { label: 'B' }], { gap: v }),
    (d, v) => computeSignatureZoneHeight(d, [], { gap: v }),
  ),
  ...option('signatureZone imageOffsetX', FINITE, (d, v) =>
    d.signatureZone([{ label: 'Client', image: 'img', imageOffsetX: v }]),
  ),
  ...option('signatureZone imageOffsetY', FINITE, (d, v) =>
    d.signatureZone([{ label: 'Client', image: 'img', imageOffsetY: v }]),
  ),
  ...single('signatureZone with a gap that leaves the boxes no text width', (d) =>
    d.signatureZone([{ label: 'A' }, { label: 'B' }], { gap: d.measure }),
  ),
  ...single(
    'checkbox in a frame the box leaves no text width',
    (d) => d.checkbox('Agreed'),
    () => makeDocWithImage({ measure: CHECKBOX.size + CHECKBOX.gap }),
  ),
  ...single(
    'badge in a frame its padding leaves no text width',
    (d) => d.badge('Draft'),
    () => makeDocWithImage({ measure: BADGE.paddingX * 2 }),
  ),
  ...single(
    'inlineQuestion whose answer leaves the question no width',
    (d) => d.inlineQuestion('Agreed?', { answer: 'A rather long answer' }),
    () => makeDocWithImage({ measure: 20 }),
  ),
];

// === Columns: a gap and a count that leave no width ===

const COLUMNS: Case[] = [
  ...single('columns too many for the width', (d) => d.columns(Array.from({ length: 30 }, () => () => {}))),
  ...single('headerColumns too many for the width', (d) => d.headerColumns(Array.from({ length: 30 }, () => COLUMN))),
  ...single('fields too many for the width', (d) => d.fields(Array.from({ length: 30 }, () => STACKED))),
  // Checked before the first row is drawn.
  ...single('fieldRows whose second row is too wide', (d) =>
    d.fieldRows([[STACKED], Array.from({ length: 30 }, () => STACKED)]),
  ),
];

// === Coordinate primitives: x, y, width, height ===

const COORDINATES: Case[] = [
  ...option('drawBox x', FINITE, (d, v) => drawBox(d, { ...BOX_OPTIONS, x: v })),
  ...option('drawBox y', FINITE, (d, v) => drawBox(d, { ...BOX_OPTIONS, y: v })),
  ...option('drawBox width', SIZE, (d, v) => drawBox(d, { ...BOX_OPTIONS, width: v })),
  ...option('drawBox height', SIZE, (d, v) => drawBox(d, { ...BOX_OPTIONS, height: v })),
  ...option('drawBox radius', GAP, (d, v) => drawBox(d, { ...BOX_OPTIONS, radius: v })),
  ...option('drawImage x', FINITE, (d, v) => drawImage(d, 'img', { x: v, y: 10, width: 20 })),
  ...option('drawImage y', FINITE, (d, v) => drawImage(d, 'img', { x: 10, y: v, width: 20 })),
  ...option('drawImage width', SIZE, (d, v) => drawImage(d, 'img', { x: 10, y: 10, width: v })),
  ...option('drawImage height', SIZE, (d, v) => drawImage(d, 'img', { x: 10, y: 10, height: v })),
  ...single('drawImage without a size', (d) => drawImage(d, 'img', { x: 10, y: 10 } as never)),
  ...option('drawHighlightedText x', FINITE, (d, v) => drawHighlightedText(d, 'Paid', { x: v, y: 10 })),
  ...option('drawHighlightedText y', FINITE, (d, v) => drawHighlightedText(d, 'Paid', { x: 10, y: v })),
  ...option('drawHighlightedText padding', GAP, (d, v) => drawHighlightedText(d, 'Paid', { x: 10, y: 10, padding: v })),
  ...option('drawHighlightedText maxWidth', SIZE, (d, v) =>
    drawHighlightedText(d, 'Paid', { x: 10, y: 10, maxWidth: v }),
  ),
  ...option('drawHighlightedText maxWidth that padding takes whole', [4, 3], (d, v) =>
    drawHighlightedText(d, 'Paid', { x: 10, y: 10, padding: 2, maxWidth: v }),
  ),
  ...option('measureHighlightedText maxWidth that padding takes whole', [4, 3], (d, v) =>
    measureHighlightedText(d, 'Paid', { padding: 2, maxWidth: v }),
  ),
  ...option('measureHighlightedText padding', GAP, (d, v) => measureHighlightedText(d, 'Paid', { padding: v })),
  ...option('measureHighlightedText maxWidth', SIZE, (d, v) => measureHighlightedText(d, 'Paid', { maxWidth: v })),
  ...option('drawIconWithText x', FINITE, (d, v) => drawIconWithText(d, 'Phone', { x: v, y: 10, icon: 'img' })),
  ...option('drawIconWithText y', FINITE, (d, v) => drawIconWithText(d, 'Phone', { x: 10, y: v, icon: 'img' })),
  ...option('drawIconWithText iconSize', SIZE, (d, v) =>
    drawIconWithText(d, 'Phone', { x: 10, y: 10, icon: 'img', iconSize: v }),
  ),
  ...option('drawIconWithText gap', GAP, (d, v) => drawIconWithText(d, 'Phone', { x: 10, y: 10, icon: 'img', gap: v })),
  ...option('drawIconWithText maxWidth', SIZE, (d, v) =>
    drawIconWithText(d, 'Phone', { x: 10, y: 10, icon: 'img', maxWidth: v }),
  ),
  ...single('drawIconWithText whose icon and gap leave the text no width', (d) =>
    drawIconWithText(d, 'Phone', { x: 10, y: 10, icon: 'img', maxWidth: 5, iconSize: 3, gap: 2 }),
  ),
];

// === Logos and designed pages: checked before the page is drawn ===

const withCoverLayout = () => makeDocWithImage({ theme: imageCover() });

/**
 * The cases of one key of the `logo` of the covers and the back cover. Each page has a background image, drawn before
 * the logo: it must not be drawn when the logo is invalid.
 */
function coverLogoCases(key: 'height' | 'x' | 'y'): Case[] {
  const values = key === 'height' ? SIZE : FINITE;
  return [
    ...option(
      `image cover logo ${key}`,
      values,
      (d, v) => d.cover('Title', { variant: 'image', layout: 'full', image: 'img', logo: { image: 'img', [key]: v } }),
      undefined,
      withCoverLayout,
    ),
    ...option(`wave cover logo ${key}`, values, (d, v) =>
      d.cover('Title', { variant: 'wave', image: 'img', logo: { image: 'img', [key]: v } }),
    ),
    ...option(`backCover logo ${key}`, values, (d, v) =>
      d.backCover({ image: 'img', logo: { image: 'img', [key]: v } }),
    ),
  ];
}

const LOGOS: Case[] = [
  ...option('logo height', SIZE, (d, v) => d.logo('img', { height: v })),
  ...option('logo x', FINITE, (d, v) => d.logo('img', { x: v })),
  ...option('logo y', FINITE, (d, v) => d.logo('img', { y: v })),
  ...coverLogoCases('height'),
  ...coverLogoCases('x'),
  ...coverLogoCases('y'),
  ...option('backCover contact x', FINITE, (d, v) => d.backCover({ image: 'img', contact: { lines: ['a'], x: v } })),
  ...option('backCover contact y', FINITE, (d, v) => d.backCover({ image: 'img', contact: { lines: ['a'], y: v } })),
];

// === Content structures: what the types make required, and the options of another variant ===

/** What is no array. */
const NOT_ARRAY = [null, 5, 'text', {}];
/** What is no object, for an item that must be one. */
const NOT_OBJECT = [null, 5, 'text', ['a']];
/** A required text that is left out, or is none. */
const NOT_TEXT_OR_MISSING = [undefined, ...NOT_TEXT];

/** How a call takes the structure under test, which the case builds invalid on purpose. */
type Use = (doc: PDFDocument, value: unknown) => unknown;
/** A call under test and its name: the draw and the `compute*Height` of a block are two of them. */
type Target = readonly [name: string, use: Use];

/**
 * The cases of a list of objects that `use` takes: what is no array, an item that is no object, an item without any of
 * its fields, and an item without each of its required `fields` or with something that is no text there. The invalid
 * item comes after a valid one: a block that draws item by item must still throw before it draws the first.
 */
function listOf(name: string, use: Use, item: object, fields: readonly string[], notArrays = NOT_ARRAY): Case[] {
  return [
    ...option(`${name} that is not an array`, notArrays, use),
    ...option(`${name} with an item that is not an object`, NOT_OBJECT, (d, v) => use(d, [item, v])),
    ...single(`${name} with an item without any field`, (d) => use(d, [item, {}])),
    ...fields.flatMap((field) =>
      option(`${name} with an item whose ${field}`, NOT_TEXT_OR_MISSING, (d, v) =>
        use(d, [item, { ...item, [field]: v }]),
      ),
    ),
  ];
}

/** The cases of an array of texts: what is no array, and an entry that is no text. */
function textsOf(name: string, use: Use): Case[] {
  return [
    ...option(`${name} that is not an array`, NOT_ARRAY, use),
    ...option(`${name} with an entry that is not a text`, NOT_TEXT, (d, v) => use(d, ['One', v])),
  ];
}

const FIELD = { label: 'A', value: 'b' };
const DECLARATION = { text: 'Statement' };
const SLICE = { label: 'A', value: 1 };
const CHART_COLUMN = { label: 'Q1', values: [1] };
const LINE_DATA = { xs: [1, 2], lines: [{ label: 'A', values: [1, 2] }] };

// --- Rich blocks and lists ---

const PARAGRAPH = { type: 'paragraph', runs: [{ text: 'One' }] };

const paragraphOf = (runs: unknown) => ({ type: 'paragraph', runs });

/** The cases of the lists of rich blocks, `bulletList` or `numberedList`: its items, their runs and their text. */
function richListsOf(name: string, use: Use, type: string): Case[] {
  return [
    ...option(`${name} ${type} items`, [undefined, ...NOT_ARRAY], (d, v) => use(d, [PARAGRAPH, { type, items: v }])),
    ...option(`${name} ${type} item that is not an array`, NOT_ARRAY, (d, v) =>
      use(d, [PARAGRAPH, { type, items: [[{ text: 'One' }], v] }]),
    ),
    ...option(`${name} ${type} item run that is not an object`, NOT_OBJECT, (d, v) =>
      use(d, [PARAGRAPH, { type, items: [[v]] }]),
    ),
    ...option(`${name} ${type} item run text`, NOT_TEXT_OR_MISSING, (d, v) =>
      use(d, [PARAGRAPH, { type, items: [[{ text: v }]] }]),
    ),
  ];
}

/** The cases of rich blocks that `use` takes: the kind of block, its runs and the text of each run. */
function richBlocksOf(name: string, use: Use, notArrays = NOT_ARRAY): Case[] {
  return [
    ...listOf(`${name} blocks`, use, PARAGRAPH, [], notArrays),
    ...option(`${name} block type`, [undefined, 'heading', 5], (d, v) => use(d, [PARAGRAPH, { type: v }])),
    ...option(`${name} paragraph runs`, NOT_ARRAY, (d, v) => use(d, [PARAGRAPH, paragraphOf(v)])),
    ...option(`${name} paragraph run that is not an object`, NOT_OBJECT, (d, v) =>
      use(d, [PARAGRAPH, paragraphOf([v])]),
    ),
    ...option(`${name} paragraph run text`, NOT_TEXT_OR_MISSING, (d, v) =>
      use(d, [PARAGRAPH, paragraphOf([{ text: v }])]),
    ),
    ...richListsOf(name, use, 'bulletList'),
    ...richListsOf(name, use, 'numberedList'),
  ];
}

const LISTS: Target[] = [
  ['bulletList', (d, items) => d.bulletList(items as never)],
  ['numberedList', (d, items) => d.numberedList(items as never)],
  ['iconList', (d, items) => d.iconList(items as never, { icon: 'img' })],
];

/** The cases of the items of a list that `use` takes: a string or an object with a `text`, `subItems` and a `detail`. */
function itemsOf(name: string, use: Use): Case[] {
  return [
    ...option(`${name} items that are not an array`, NOT_ARRAY, use),
    // A string is an item: only what is neither a string nor an object is refused.
    ...option(`${name} item that is neither a string nor an object`, [null, 5, ['a']], (d, v) => use(d, ['One', v])),
    ...single(`${name} item without a text`, (d) => use(d, ['One', {}])),
    ...option(`${name} item text`, NOT_TEXT, (d, v) => use(d, ['One', { text: v }])),
    ...textsOf(`${name} subItems`, (d, v) => use(d, ['One', { text: 'Two', subItems: v }])),
    ...option(`${name} item detail`, [null, 5, {}], (d, v) => use(d, ['One', { text: 'Two', detail: v }])),
    // A string is a detail: it is plain text, not blocks.
    ...richBlocksOf(`${name} detail`, (d, blocks) => use(d, ['One', { text: 'Two', detail: blocks }]), [null, 5, {}]),
  ];
}

const STRUCTURE_TEXTS: Case[] = [
  ...textsOf('paragraphs texts', (d, texts) => d.paragraphs(texts as never)),
  ...richBlocksOf('richBlocks', (d, blocks) => d.richBlocks(blocks as never)),
  ...richBlocksOf('computeRichBlocksHeight', (d, blocks) => computeRichBlocksHeight(d, blocks as never)),
  ...LISTS.flatMap(([name, use]) => itemsOf(name, use)),
  ...option('iconList icon', NOT_TEXT_OR_MISSING, (d, v) => d.iconList(['One'], { icon: v } as never)),
];

// --- Fields, declarations, address lines, signatures, header columns, layout columns ---

const DECLARATIONS: Target[] = [
  ['declarationsBox', (d, items) => d.declarationsBox(items as never)],
  ['computeDeclarationsBoxHeight', (d, items) => computeDeclarationsBoxHeight(d, items as never)],
];

const SIGNATURES: Target[] = [
  ['signatureZone', (d, boxes) => d.signatureZone(boxes as never)],
  ['computeSignatureZoneHeight', (d, boxes) => computeSignatureZoneHeight(d, boxes as never)],
];

/** The cases of the items of a declarations box, and of the highlights of an item. */
function declarationsOf(name: string, use: Use): Case[] {
  const withHighlights = (highlights: unknown) => [DECLARATION, { text: 'I declare it', highlights }];
  return [
    ...listOf(`${name} items`, use, DECLARATION, ['text']),
    ...option(`${name} highlights`, NOT_ARRAY, (d, v) => use(d, withHighlights(v))),
    ...option(`${name} highlight that is not an object`, NOT_OBJECT, (d, v) => use(d, withHighlights([v]))),
    ...single(`${name} highlight without a text`, (d) => use(d, withHighlights([{}]))),
    ...option(`${name} highlight text`, NOT_TEXT, (d, v) => use(d, withHighlights([{ text: v }]))),
  ];
}

const STRUCTURE_BLOCKS: Case[] = [
  ...listOf('fields', (d, fields) => d.fields(fields as never), FIELD, ['label', 'value']),
  ...listOf('fieldRows row', (d, row) => d.fieldRows([row] as never), FIELD, ['label', 'value']),
  ...option('fieldRows rows that are not an array', NOT_ARRAY, (d, rows) => d.fieldRows(rows as never)),
  ...option('fieldRows row that is not an array', NOT_ARRAY, (d, v) => d.fieldRows([[FIELD], v] as never)),
  // Every row is checked before the first one is drawn, in any layout.
  ...(['stacked', 'inline', 'leader'] as const).flatMap((layout) =>
    single(`fieldRows ${layout} with an invalid field in the second row`, (d) =>
      d.fieldRows([[FIELD], [{ label: 'B' }]] as never, { layout }),
    ),
  ),
  ...DECLARATIONS.flatMap(([name, use]) => declarationsOf(name, use)),
  ...listOf('addressBlock lines', (d, lines) => d.addressBlock(lines as never), { text: 'Acme', role: 'title' }, [
    'text',
    'role',
  ]),
  ...option('addressBlock line role', ['footer', 5, null], (d, v) =>
    d.addressBlock([
      { text: 'Acme', role: 'title' },
      { text: 'Acme', role: v },
    ] as never),
  ),
  ...SIGNATURES.flatMap(([name, use]) => listOf(`${name} boxes`, use, { label: 'Client' }, ['label'])),
  ...listOf('headerColumns columns', (d, columns) => d.headerColumns(columns as never), COLUMN, ['title']),
  ...option('headerColumns column fields', NOT_ARRAY, (d, v) =>
    d.headerColumns([{ title: 'Seller', fields: v }] as never),
  ),
  ...listOf(
    'headerColumns column fields',
    (d, fields) => d.headerColumns([{ title: 'Seller', fields }] as never),
    STACKED,
    ['label', 'value'],
  ),
  ...option('columns column that is not a function', [null, 5, 'text', {}], (d, v) =>
    d.columns([(column: PDFDocument) => column.paragraph('Left'), v] as never),
  ),
  ...option('columns that are not an array', NOT_ARRAY, (d, v) => d.columns(v as never)),
];

// --- Tables, charts ---

const SLICES: Target[] = [
  ['donutChart', (d, slices) => d.donutChart(slices as never)],
  ['stackedBar', (d, slices) => d.stackedBar(slices as never)],
  ['computeDonutChartHeight', (d, slices) => computeDonutChartHeight(d, slices as never)],
  ['computeStackedBarHeight', (d, slices) => computeStackedBarHeight(d, slices as never)],
];

const CHART_COLUMNS: Target[] = [
  ['columnChart', (d, columns) => d.columnChart(columns as never)],
  ['computeColumnChartHeight', (d, columns) => computeColumnChartHeight(d, columns as never)],
];

const STRUCTURE_DATA: Case[] = [
  ...option('table columns', [undefined, ...NOT_ARRAY], (d, v) => d.table([{ a: 'one' }], { columns: v as never })),
  ...listOf('table columns', (d, columns) => d.table([{ a: 'one' }], { columns: columns as never }), TABLE.columns[0], [
    'header',
    'key',
  ]),
  ...option('table data', NOT_ARRAY, (d, v) => d.table(v as never, TABLE)),
  ...option('table row that is not an object', NOT_OBJECT, (d, v) => d.table([{ a: 'one' }, v] as never, TABLE)),
  ...option('table footRow', NOT_ARRAY, (d, v) => d.table([{ a: 'one' }], { ...TABLE, footRow: v as never })),
  ...SLICES.flatMap(([name, use]) => listOf(`${name} parts`, use, SLICE, ['label'])),
  ...CHART_COLUMNS.flatMap(([name, use]) => listOf(`${name} columns`, use, CHART_COLUMN, ['label'])),
  ...option('columnChart series', NOT_ARRAY, (d, v) => d.columnChart([CHART_COLUMN], { series: v as never })),
  ...listOf(
    'columnChart series',
    (d, series) => d.columnChart([CHART_COLUMN], { series: series as never }),
    { label: 'S' },
    ['label'],
  ),
  ...option('columnChart reference', NOT_OBJECT, (d, v) => d.columnChart([CHART_COLUMN], { reference: v as never })),
  ...option('computeColumnChartHeight reference', [null], (d, v) =>
    computeColumnChartHeight(d, [CHART_COLUMN], { reference: v as never }),
  ),
  ...option('lineChart data', NOT_OBJECT, (d, v) => d.lineChart(v as never)),
  ...listOf('lineChart lines', (d, lines) => d.lineChart({ ...LINE_DATA, lines: lines as never }), LINE_DATA.lines[0], [
    'label',
  ]),
  ...option('lineChart band', NOT_OBJECT, (d, v) => d.lineChart({ ...LINE_DATA, band: v as never })),
  ...option('lineChart highlight', NOT_OBJECT, (d, v) => d.lineChart(LINE_DATA, { highlight: v as never })),
  ...option('computeLineChartHeight highlight', [null], (d, v) =>
    computeLineChartHeight(d, LINE_DATA, { highlight: v as never }),
  ),
];

// --- Pills, back cover contact, logos ---

const PILL_METRICS = { lines: ['Paid'], width: 10, height: 5, lineHeight: 4, padding: 1, ascent: 3, descent: 1 };
const withMetrics = (metrics: unknown) => (d: PDFDocument) =>
  drawHighlightedText(d, 'Paid', { x: 10, y: 10, metrics: metrics as never });

/** The cases of the `logo` of a designed page: no object, and an image that is no text. */
function logoOf(name: string, use: (doc: PDFDocument, logo: unknown) => unknown, makeDoc = makeDocWithImage): Case[] {
  return [
    ...option(`${name} logo`, [null, 5, 'text'], (d, v) => use(d, v), undefined, makeDoc),
    ...option(`${name} logo image`, NOT_TEXT_OR_MISSING, (d, v) => use(d, { image: v }), undefined, makeDoc),
  ];
}

const STRUCTURE_PAGES: Case[] = [
  ...option('badge text', NOT_TEXT, (d, v) => d.badge(v as never)),
  ...option('drawHighlightedText text', NOT_TEXT, (d, v) => drawHighlightedText(d, v as never, { x: 10, y: 10 })),
  ...option('measureHighlightedText text', NOT_TEXT, (d, v) => measureHighlightedText(d, v as never)),
  ...option('drawHighlightedText metrics', NOT_OBJECT, (d, v) => withMetrics(v)(d)),
  ...option('drawHighlightedText metrics lines', NOT_ARRAY, (d, v) => withMetrics({ ...PILL_METRICS, lines: v })(d)),
  ...option('drawHighlightedText metrics line', NOT_TEXT, (d, v) => withMetrics({ ...PILL_METRICS, lines: [v] })(d)),
  ...['width', 'height', 'lineHeight', 'padding', 'ascent', 'descent'].flatMap((size) =>
    option(`drawHighlightedText metrics ${size}`, [undefined, '5', -1, ...NOT_FINITE], (d, v) =>
      withMetrics({ ...PILL_METRICS, [size]: v })(d),
    ),
  ),
  ...option('backCover contact', [null, 5, 'text', ['a']], (d, v) => d.backCover({ contact: v as never })),
  ...option('backCover contact lines', [undefined, ...NOT_ARRAY], (d, v) =>
    d.backCover({ image: 'img', contact: { lines: v } as never }),
  ),
  ...single('backCover contact without any field', (d) => d.backCover({ image: 'img', contact: {} as never })),
  ...option('backCover contact line', NOT_TEXT, (d, v) =>
    d.backCover({ image: 'img', contact: { lines: ['a', v] } as never }),
  ),
  ...logoOf('backCover', (d, logo) => d.backCover({ image: 'img', logo: logo as never })),
  ...logoOf('wave cover', (d, logo) => d.cover('Title', { variant: 'wave', image: 'img', logo: logo as never })),
  ...logoOf(
    'image cover',
    (d, logo) => d.cover('Title', { variant: 'image', layout: 'full', image: 'img', logo: logo as never }),
    withCoverLayout,
  ),
];

// --- Options that are no object ---

const NOT_OPTIONS = [undefined, null, 5, 'text', ['a']];

const STRUCTURE_OPTIONS: Case[] = [
  ...option('infoBox options', NOT_OPTIONS, (d, v) => d.infoBox('Content', v as never)),
  ...option('computeInfoBoxHeight options', NOT_OPTIONS, (d, v) => computeInfoBoxHeight(d, 'Content', v as never)),
  ...option('table options', NOT_OPTIONS, (d, v) => d.table([], v as never)),
  ...option('iconList options', NOT_OPTIONS, (d, v) => d.iconList(['One'], v as never)),
  ...option('cover options', NOT_OPTIONS, (d, v) => d.cover('Title', v as never)),
  ...option('backCover options', NOT_OPTIONS.slice(1), (d, v) => d.backCover(v as never)),
  ...option('drawBox options', NOT_OPTIONS, (d, v) => drawBox(d, v as never)),
  ...option('drawImage options', NOT_OPTIONS, (d, v) => drawImage(d, 'img', v as never)),
  ...option('drawHighlightedText options', NOT_OPTIONS, (d, v) => drawHighlightedText(d, 'Paid', v as never)),
  ...option('drawIconWithText options', NOT_OPTIONS, (d, v) => drawIconWithText(d, 'Phone', v as never)),
  ...option('drawIconWithText icon', NOT_TEXT_OR_MISSING, (d, v) =>
    drawIconWithText(d, 'Phone', { x: 10, y: 10, icon: v } as never),
  ),
];

// --- Options of another variant ---

/** The options each cover variant takes: what another variant takes is refused. Same table as the source, written out. */
const COVER_OPTIONS = {
  wave: {
    subtitle: 'Sub',
    image: 'img',
    logo: { image: 'img' },
    titleColor: 'primary',
    subtitleColor: 'primary',
    accentBar: true,
    waveColor: 'tint',
  },
  image: { layout: 'full', subtitle: 'Sub', image: 'img', logo: { image: 'img' } },
  custom: { draw: () => {} },
};

/** A cover of `variant` that also sets `key`, an option of another variant. */
const coverWith = (variant: keyof typeof COVER_OPTIONS, key: string, value: unknown): Case => [
  `${variant} cover with ${key}`,
  (d) =>
    d.cover('Title', {
      variant,
      ...(variant === 'image' ? { layout: 'full' } : {}),
      ...(variant === 'custom' ? { draw: () => {} } : {}),
      [key]: value,
    } as never),
  variant === 'image' ? withCoverLayout : makeDocWithImage,
];

const FOREIGN_COVER_KEYS = Object.values(COVER_OPTIONS).flatMap((options) => Object.entries(options));

const STRUCTURE_VARIANTS: Case[] = [
  ...option('infoBox callout icon', ['img', '', 5], (d, v) =>
    d.infoBox('Content', { variant: 'callout', icon: v } as never),
  ),
  ...option('computeInfoBoxHeight callout icon', ['img'], (d, v) =>
    computeInfoBoxHeight(d, 'Content', { variant: 'callout', icon: v } as never),
  ),
  ...option('infoBox surface eyebrow', ['Note', '', 5], (d, v) =>
    d.infoBox('Content', { title: 'T', eyebrow: v } as never),
  ),
  ...option('infoBox surface accentBar', [true, false], (d, v) =>
    d.infoBox('Content', { title: 'T', accentBar: v } as never),
  ),
  ...option('computeInfoBoxHeight surface eyebrow', ['Note'], (d, v) =>
    computeInfoBoxHeight(d, 'Content', { title: 'T', eyebrow: v } as never),
  ),
  ...option('computeInfoBoxHeight surface accentBar', [false], (d, v) =>
    computeInfoBoxHeight(d, 'Content', { variant: 'surface', title: 'T', accentBar: v } as never),
  ),
  ...option('infoBox variant', ['card', 5, null], (d, v) => d.infoBox('Content', { title: 'T', variant: v } as never)),
  ...textsOf('infoBox bulletPoints', (d, v) => d.infoBox('Content', { title: 'T', bulletPoints: v } as never)),
  ...textsOf('infoBox boldPrefixes', (d, v) => d.infoBox('Content', { title: 'T', boldPrefixes: v } as never)),
  ...textsOf('computeInfoBoxHeight bulletPoints', (d, v) =>
    computeInfoBoxHeight(d, 'Content', { title: 'T', bulletPoints: v } as never),
  ),
  ...option('iconList bulletChar', ['*', ''], (d, v) => d.iconList(['One'], { icon: 'img', bulletChar: v } as never)),
  // A cover takes the options of its own variant only; every option another variant takes is refused.
  ...(Object.keys(COVER_OPTIONS) as (keyof typeof COVER_OPTIONS)[]).flatMap((variant) =>
    FOREIGN_COVER_KEYS.filter(([key]) => !(key in COVER_OPTIONS[variant])).map(([key, value]) =>
      coverWith(variant, key, value),
    ),
  ),
  ...['image', 'logo', 'contact', 'legalText'].flatMap((key) =>
    single(`custom back cover with ${key}`, (d) =>
      d.backCover({ variant: 'custom', draw: () => {}, [key]: 'x' } as never),
    ),
  ),
  ...single('plain back cover with draw', (d) => d.backCover({ draw: () => {} } as never)),
  ...single('plain back cover with draw, the variant given', (d) =>
    d.backCover({ variant: 'plain', draw: () => {} } as never),
  ),
];

// === Optional fields: left out is allowed, set it must have its type ===

/** What is no flag. */
const NOT_FLAG = ['true', 1, 0, null, {}];
/** What is no callback. */
const NOT_FUNCTION = [null, 5, 'text', {}];
/** What is none of the choices of an option. */
const NOT_CHOICE = ['bogus', 5, null];

/** A call that takes a block of content and its options, to try one option on content and on none. */
type WithOptions = (doc: PDFDocument, content: unknown[], options: object) => unknown;

const LIST_CALLS: [name: string, call: WithOptions][] = [
  ['bulletList', (d, items, options) => d.bulletList(items as never, options)],
  ['numberedList', (d, items, options) => d.numberedList(items as never, options)],
  ['iconList', (d, items, options) => d.iconList(items as never, { icon: 'img', ...options })],
];

const DECLARATION_CALLS: [name: string, call: WithOptions][] = [
  ['declarationsBox', (d, items, options) => d.declarationsBox(items as never, options)],
  ['computeDeclarationsBoxHeight', (d, items, options) => computeDeclarationsBoxHeight(d, items as never, options)],
];

const SIGNATURE_CALLS: [name: string, call: WithOptions][] = [
  ['signatureZone', (d, boxes, options) => d.signatureZone(boxes as never, options)],
  ['computeSignatureZoneHeight', (d, boxes, options) => computeSignatureZoneHeight(d, boxes as never, options)],
];

/** The charts of parts, the options that are flags, and the calls that take them. */
const PART_CHARTS: [name: string, call: WithOptions, flags: string[]][] = [
  ['donutChart', (d, parts, options) => d.donutChart(parts as never, options), ['legend']],
  ['computeDonutChartHeight', (d, parts, options) => computeDonutChartHeight(d, parts as never, options), ['legend']],
  ['stackedBar', (d, parts, options) => d.stackedBar(parts as never, options), ['legend', 'percentages']],
  [
    'computeStackedBarHeight',
    (d, parts, options) => computeStackedBarHeight(d, parts as never, options),
    ['legend', 'percentages'],
  ],
];

const OPTIONAL_TEXT: Case[] = [
  ...option(
    'paragraph level',
    NOT_CHOICE,
    (d, v) => d.paragraph('Text', { level: v as never }),
    (d, v) => d.paragraph('', { level: v as never }),
  ),
  ...option(
    'paragraph align',
    ['center', 5, null],
    (d, v) => d.paragraph('Text', { align: v as never }),
    (d, v) => d.paragraph('', { align: v as never }),
  ),
  ...option(
    'computeParagraphHeight level',
    NOT_CHOICE,
    (d, v) => computeParagraphHeight(d, 'Text', { level: v as never }),
    (d, v) => computeParagraphHeight(d, '', { level: v as never }),
  ),
  ...option(
    'computeParagraphHeight align',
    ['center', 5, null],
    (d, v) => computeParagraphHeight(d, 'Text', { align: v as never }),
    (d, v) => computeParagraphHeight(d, '', { align: v as never }),
  ),
  ...option(
    'paragraphs level',
    NOT_CHOICE,
    (d, v) => d.paragraphs(['One', 'Two'], { level: v as never }),
    (d, v) => d.paragraphs([], { level: v as never }),
  ),
  ...option(
    'paragraphs align',
    ['center', 5, null],
    (d, v) => d.paragraphs(['One', 'Two'], { align: v as never }),
    (d, v) => d.paragraphs([], { align: v as never }),
  ),
  // `body` is a text level, not a heading level.
  ...option('heading level', ['h5', 'body', 5, null], (d, v) => d.heading('Title', { level: v as never })),
  ...option('heading number', NOT_TEXT, (d, v) => d.heading('Title', { number: v as never })),
  ...(['rule', 'keepWithNext', 'toc'] as const).flatMap((key) =>
    option(`heading ${key}`, NOT_FLAG, (d, v) => d.heading('Title', { [key]: v } as never)),
  ),
  ...option(
    'richText level',
    NOT_CHOICE,
    (d, v) => d.richText('**Bold**', { level: v as never }),
    (d, v) => d.richText('', { level: v as never }),
  ),
  ...option(
    'richText align',
    ['center', 5, null],
    (d, v) => d.richText('**Bold**', { align: v as never }),
    (d, v) => d.richText('', { align: v as never }),
  ),
  ...option(
    'computeRichTextHeight level',
    NOT_CHOICE,
    (d, v) => computeRichTextHeight(d, 'Text', { level: v as never }),
    (d, v) => computeRichTextHeight(d, '', { level: v as never }),
  ),
  ...option(
    'richBlocks level',
    NOT_CHOICE,
    (d, v) => d.richBlocks(parseRichText('Text'), { level: v as never }),
    (d, v) => d.richBlocks([], { level: v as never }),
  ),
  ...option(
    'computeRichBlocksHeight align',
    ['center', 5, null],
    (d, v) => computeRichBlocksHeight(d, parseRichText('Text'), { align: v as never }),
    (d, v) => computeRichBlocksHeight(d, [], { align: v as never }),
  ),
  ...LIST_CALLS.flatMap(([name, call]) =>
    option(
      `${name} level`,
      NOT_CHOICE,
      (d, v) => call(d, ['One'], { level: v }),
      (d, v) => call(d, [], { level: v }),
    ),
  ),
  // `numberedList` ignores the glyph, but a glyph that is no text is still a wrong call.
  ...LIST_CALLS.slice(0, 2).flatMap(([name, call]) =>
    option(
      `${name} bulletChar`,
      NOT_TEXT,
      (d, v) => call(d, ['One'], { bulletChar: v }),
      (d, v) => call(d, [], { bulletChar: v }),
    ),
  ),
  ...option('checkbox variant', NOT_CHOICE, (d, v) => d.checkbox('Agreed', { variant: v as never })),
  ...option('checkbox level', NOT_CHOICE, (d, v) => d.checkbox('Agreed', { level: v as never })),
  ...option('inlineQuestion variant', NOT_CHOICE, (d, v) => d.inlineQuestion('Agreed?', { variant: v as never })),
  ...option('inlineQuestion answer', NOT_TEXT, (d, v) => d.inlineQuestion('Agreed?', { answer: v as never })),
  ...option('badge level', NOT_CHOICE, (d, v) => d.badge('Draft', { level: v as never })),
  ...option(
    'closingNote level',
    NOT_CHOICE,
    (d, v) => d.closingNote('Legal', { level: v as never }),
    (d, v) => d.closingNote('', { level: v as never }),
  ),
  ...option('drawIconWithText level', NOT_CHOICE, (d, v) =>
    drawIconWithText(d, 'Phone', { x: 10, y: 10, icon: 'img', level: v as never }),
  ),
];

/** The cases of the options of a declarations box, drawn or measured. */
function declarationOptionCases(name: string, call: WithOptions): Case[] {
  return [
    ...option(
      `${name} intro`,
      NOT_TEXT,
      (d, v) => call(d, [DECLARATION], { intro: v }),
      (d, v) => call(d, [], { intro: v }),
    ),
    ...option(
      `${name} bullet`,
      NOT_FLAG,
      (d, v) => call(d, [DECLARATION], { bullet: v }),
      (d, v) => call(d, [], { bullet: v }),
    ),
    ...option(
      `${name} icon`,
      NOT_TEXT,
      (d, v) => call(d, [DECLARATION], { icon: v }),
      (d, v) => call(d, [], { icon: v }),
    ),
    ...option(
      `${name} boxStyle`,
      NOT_CHOICE,
      (d, v) => call(d, [DECLARATION], { boxStyle: v }),
      (d, v) => call(d, [], { boxStyle: v }),
    ),
    ...option(
      `${name} level`,
      NOT_CHOICE,
      (d, v) => call(d, [DECLARATION], { level: v }),
      (d, v) => call(d, [], { level: v }),
    ),
    ...option(`${name} highlight strong`, NOT_FLAG, (d, v) =>
      call(d, [{ text: 'I declare it', highlights: [{ text: 'declare', strong: v }] }], {}),
    ),
  ];
}

/** The cases of the options and the boxes of a signature zone, drawn or measured. */
function signatureOptionCases(name: string, call: WithOptions): Case[] {
  return [
    ...['sublabel', 'image', 'anchorKey'].flatMap((key) =>
      option(`${name} box ${key}`, NOT_TEXT, (d, v) => call(d, [{ label: 'A' }, { label: 'B', [key]: v }], {})),
    ),
    ...option(`${name} caption`, NOT_TEXT, (d, v) => call(d, [{ label: 'A' }], { caption: v })),
    ...option(`${name} renderAnchor`, NOT_FUNCTION, (d, v) => call(d, [{ label: 'A' }], { renderAnchor: v })),
  ];
}

const OPTIONAL_BLOCKS: Case[] = [
  ...option('fields field highlight', NOT_FLAG, (d, v) => d.fields([FIELD, { ...FIELD, highlight: v as never }])),
  ...option('fields field complement', NOT_TEXT, (d, v) => d.fields([FIELD, { ...FIELD, complement: v as never }])),
  ...option('fieldRows field highlight', NOT_FLAG, (d, v) =>
    d.fieldRows([[FIELD], [{ ...FIELD, highlight: v as never }]]),
  ),
  ...option('fieldRows field complement', NOT_TEXT, (d, v) =>
    d.fieldRows([[FIELD], [{ ...FIELD, complement: v as never }]]),
  ),
  ...option(
    'fields layout',
    NOT_CHOICE,
    (d, v) => d.fields([FIELD], { layout: v as never }),
    (d, v) => d.fields([], { layout: v as never }),
  ),
  ...option(
    'fieldRows layout',
    NOT_CHOICE,
    (d, v) => d.fieldRows([[FIELD]], { layout: v as never }),
    (d, v) => d.fieldRows([], { layout: v as never }),
  ),
  ...option('infoBox callout accentBar', NOT_FLAG, (d, v) =>
    d.infoBox('Content', { variant: 'callout', accentBar: v as never }),
  ),
  ...option('computeInfoBoxHeight callout accentBar', NOT_FLAG, (d, v) =>
    computeInfoBoxHeight(d, 'Content', { variant: 'callout', accentBar: v as never }),
  ),
  ...option('infoBox surface icon', NOT_TEXT, (d, v) => d.infoBox('Content', { title: 'T', icon: v as never })),
  ...option('computeInfoBoxHeight surface icon', NOT_TEXT, (d, v) =>
    computeInfoBoxHeight(d, 'Content', { title: 'T', icon: v as never }),
  ),
  ...option('drawBox boxStyle', [undefined, 'bogus', 5, null], (d, v) =>
    drawBox(d, { ...BOX_OPTIONS, boxStyle: v as never }),
  ),
  ...DECLARATION_CALLS.flatMap(([name, call]) => declarationOptionCases(name, call)),
  ...option(
    'addressBlock boxStyle',
    NOT_CHOICE,
    (d, v) => d.addressBlock([{ text: 'Acme', role: 'title' }], { boxStyle: v as never }),
    (d, v) => d.addressBlock([], { boxStyle: v as never }),
  ),
  ...option('parseAddressLines hasSubtitle', NOT_FLAG, (d, v) =>
    parseAddressLines('A\nB', { hasSubtitle: v as never }),
  ),
  ...SIGNATURE_CALLS.flatMap(([name, call]) => signatureOptionCases(name, call)),
  ...option('headerColumns column labelWidth', NOT_FINITE, (d, v) =>
    d.headerColumns([COLUMN, { ...COLUMN, labelWidth: v }]),
  ),
  ...option('drawHighlightedText strong', NOT_FLAG, (d, v) =>
    drawHighlightedText(d, 'Paid', { x: 10, y: 10, strong: v as never }),
  ),
];

/** A rich text run with one of its fields set. */
const runWith = (field: string, value: unknown) => ({ text: 'One', [field]: value });

const OPTIONAL_RUNS: Case[] = [
  ...(['bold', 'italic'] as const).flatMap((field) =>
    option(`richBlocks run ${field}`, NOT_FLAG, (d, v) =>
      d.richBlocks([PARAGRAPH, paragraphOf([runWith(field, v)])] as never),
    ),
  ),
  ...option('richBlocks run link', NOT_TEXT, (d, v) =>
    d.richBlocks([PARAGRAPH, paragraphOf([runWith('link', v)])] as never),
  ),
  ...option('computeRichBlocksHeight list item run bold', NOT_FLAG, (d, v) =>
    computeRichBlocksHeight(d, [PARAGRAPH, { type: 'numberedList', items: [[runWith('bold', v)]] }] as never),
  ),
  ...LISTS.flatMap(([name, use]) =>
    (['bold', 'italic'] as const).flatMap((field) =>
      option(`${name} detail run ${field}`, NOT_FLAG, (d, v) =>
        use(d, ['One', { text: 'Two', detail: [paragraphOf([runWith(field, v)])] }]),
      ),
    ),
  ),
];

// --- Pages: logos, covers, running header and footer, table of contents, watermarks, the document ---

/** A call that takes the options of a cover or a back cover, with the document it needs. */
type CoverCall = [name: string, call: (doc: PDFDocument, options: object) => unknown, makeDoc: () => PDFDocument];

const COVER_CALLS: CoverCall[] = [
  ['wave cover', (d, o) => d.cover('Title', { variant: 'wave', ...o } as never), makeDocWithImage],
  ['image cover', (d, o) => d.cover('Title', { variant: 'image', layout: 'full', ...o } as never), withCoverLayout],
];

/** The cases of the texts a cover takes, for each variant that takes them. */
function coverTextCases(name: string, call: CoverCall[1], makeDoc: () => PDFDocument): Case[] {
  return ['subtitle', 'image'].flatMap((key) =>
    option(`${name} ${key}`, NOT_TEXT, (d, v) => call(d, { [key]: v }), undefined, makeDoc),
  );
}

const OPTIONAL_PAGES: Case[] = [
  ...option('logo anchor', NOT_CHOICE, (d, v) => d.logo('img', { anchor: v as never })),
  ...option('backCover logo anchor', NOT_CHOICE, (d, v) => d.backCover({ logo: { image: 'img', anchor: v as never } })),
  ...option('wave cover logo anchor', NOT_CHOICE, (d, v) =>
    d.cover('Title', { variant: 'wave', logo: { image: 'img', anchor: v as never } }),
  ),
  ...option(
    'image cover logo anchor',
    NOT_CHOICE,
    (d, v) => d.cover('Title', { variant: 'image', layout: 'full', logo: { image: 'img', anchor: v as never } }),
    undefined,
    withCoverLayout,
  ),
  ...COVER_CALLS.flatMap(([name, call, makeDoc]) => coverTextCases(name, call, makeDoc)),
  ...option('wave cover title', NOT_TEXT_OR_MISSING, (d, v) => d.cover(v as never, { variant: 'wave' })),
  ...option('wave cover accentBar', NOT_FLAG, (d, v) => d.cover('Title', { variant: 'wave', accentBar: v as never })),
  ...option(
    'image cover title',
    NOT_TEXT_OR_MISSING,
    (d, v) => d.cover(v as never, { variant: 'image', layout: 'full' }),
    undefined,
    withCoverLayout,
  ),
  ...option('custom cover title', NOT_TEXT_OR_MISSING, (d, v) =>
    d.cover(v as never, { variant: 'custom', draw: () => {} }),
  ),
  ...['image', 'legalText'].flatMap((key) =>
    option(`backCover ${key}`, NOT_TEXT, (d, v) => d.backCover({ [key]: v } as never)),
  ),
  ...option('pageHeader options', NOT_OBJECT, (d, v) => d.pageHeader(v as never)),
  ...option('pageHeader title', NOT_TEXT, (d, v) => d.pageHeader({ title: v as never })),
  ...option('pageHeader folio', NOT_FLAG, (d, v) => d.pageHeader({ folio: v as never })),
  ...option('pageFooter options', [...NOT_OBJECT, true], (d, v) => d.pageFooter(v as never)),
  ...['left', 'right', 'logo'].flatMap((key) =>
    option(`pageFooter ${key}`, NOT_TEXT, (d, v) => d.pageFooter({ [key]: v } as never)),
  ),
  ...option('pageFooter rule', NOT_FLAG, (d, v) => d.pageFooter({ rule: v as never })),
  // The table of contents places the waiting headings: an invalid option must come first.
  ...(['title', 'intro'] as const).flatMap((key) =>
    option(`tableOfContents ${key}`, NOT_TEXT, (d, v) => {
      d.heading('Waiting');
      d.tableOfContents({ [key]: v } as never);
    }),
  ),
  ...option('tableOfContents depth', [0, 5, 1.5, '2', null, ...NOT_FINITE], (d, v) => {
    d.heading('Waiting');
    d.tableOfContents({ depth: v as never });
  }),
  ...option('tableOfContents options', [null, 5, 'text'], (d, v) => d.tableOfContents(v as never)),
  ...option('watermark text', NOT_TEXT_OR_MISSING, (d, v) => d.watermark(v as never)),
  ...option('watermark allPages', NOT_FLAG, (d, v) => d.watermark('Draft', { allPages: v as never })),
  ...option('watermark opacity', [-0.1, 1.1, ...NOT_FINITE], (d, v) => d.watermark('Draft', { opacity: v })),
  ...option('watermark angle', NOT_FINITE, (d, v) => d.watermark('Draft', { angle: v })),
  ...option('watermark fontSize', SIZE, (d, v) => d.watermark('Draft', { fontSize: v })),
  ...option('addPage blank', NOT_FLAG, (d, v) => d.addPage({ blank: v as never })),
  ...option('background image', NOT_TEXT_OR_MISSING, (d, v) => d.background(v as never)),
  ...option('background allPages', NOT_FLAG, (d, v) => d.background('img', { allPages: v as never })),
  ...option('ensureSpace lead', [-1, ...NOT_FINITE], (d, v) => d.ensureSpace(10, { lead: v })),
  ...option('keepTogether draw', NOT_FUNCTION, (d, v) => d.keepTogether(v as never)),
  ...option('inset draw', NOT_FUNCTION, (d, v) => d.inset({ left: 10 }, v as never)),
  ...option('inset options', NOT_OBJECT, (d, v) => d.inset(v as never, () => d.paragraph('Inside'))),
  ...option('inset left', GAP, (d, v) => d.inset({ left: v }, () => d.paragraph('Inside'))),
  ...option('inset right', GAP, (d, v) => d.inset({ right: v }, () => d.paragraph('Inside'))),
  ...option('inset width', SIZE, (d, v) => d.inset({ width: v }, () => d.paragraph('Inside'))),
  ...single('inset left, right and width together', (d) =>
    d.inset({ left: 10, right: 10, width: 50 }, () => d.paragraph('Inside')),
  ),
  ...single('inset left and right that leave no width', (d) =>
    d.inset({ left: d.contentWidth / 2, right: d.contentWidth / 2 }, () => d.paragraph('Inside')),
  ),
  ...single('inset left that leaves no width', (d) => d.inset({ left: d.contentWidth }, () => d.paragraph('Inside'))),
  ...single('inset right that leaves no width, with a valid width', (d) =>
    d.inset({ right: d.contentWidth, width: 10 }, () => d.paragraph('Inside')),
  ),
  ...option('onNewPage callback', NOT_FUNCTION, (d, v) => d.onNewPage(v as never)),
  ...option('registerImage name', NOT_TEXT_OR_MISSING, (d, v) => d.registerImage(v as never, PNG)),
  ...option('registerImage image', NOT_TEXT_OR_MISSING, (d, v) => d.registerImage('other', v as never)),
  ...option('registerImages images', [null, 5, 'text', ['a']], (d, v) => d.registerImages(v as never)),
  // Registered all or none: the valid entry before the invalid one must not stay registered.
  ...option('registerImages image', NOT_TEXT_OR_MISSING, (d, v) =>
    d.registerImages({ first: PNG, second: v as never }),
  ),
  ...option('drawImage image', NOT_TEXT_OR_MISSING, (d, v) => drawImage(d, v as never, { x: 10, y: 10, width: 20 })),
  ...option('logo image', NOT_TEXT_OR_MISSING, (d, v) => d.logo(v as never)),
];

// --- The document: its options, the flow and the text styles ---

const NOT_LEVEL = ['bogus', 5, null, undefined];

/** A font source the document would register: each case breaks one of its fields. */
const FONT = loadFontFromBase64('AAAA', { family: 'Brand' });

const DOCUMENT: Case[] = [
  ...option('document options', [null, 5, 'text', ['a']], (_d, v) => new PDFDocument(v as never)),
  ...(['title', 'author', 'subject', 'creator'] as const).flatMap((key) =>
    option(`document ${key}`, NOT_TEXT, (_d, v) => new PDFDocument({ [key]: v } as never)),
  ),
  ...option(
    'document keywords',
    [...NOT_ARRAY, [5], ['a', null]],
    (_d, v) => new PDFDocument({ keywords: v as never }),
  ),
  ...(['compress', 'debug'] as const).flatMap((key) =>
    option(`document ${key}`, NOT_FLAG, (_d, v) => new PDFDocument({ [key]: v } as never)),
  ),
  ...option('document margins', NOT_OBJECT, (_d, v) => new PDFDocument({ margins: v as never })),
  ...option('document theme', NOT_OBJECT, (_d, v) => new PDFDocument({ theme: v as never })),
  ...(['colors', 'typography', 'spacing', 'assets', 'chrome'] as const).flatMap((key) =>
    option(`document theme ${key}`, NOT_OBJECT, (_d, v) => new PDFDocument({ theme: { ...createTheme(), [key]: v } })),
  ),
  ...option('document fonts', NOT_ARRAY, (_d, v) => new PDFDocument({ fonts: v as never })),
  ...option('document fonts entry', NOT_OBJECT, (_d, v) => new PDFDocument({ fonts: [v] as never })),
  ...(
    [
      ['type', NOT_CHOICE],
      ['family', NOT_TEXT_OR_MISSING],
      ['style', NOT_CHOICE],
      ['fileName', NOT_TEXT_OR_MISSING],
      ['data', NOT_TEXT_OR_MISSING],
    ] as const
  ).flatMap(([key, values]) =>
    option(`document fonts ${key}`, values, (_d, v) => new PDFDocument({ fonts: [{ ...FONT, [key]: v }] as never })),
  ),
  ...option(
    'document fonts binary data',
    ['text', [1, 2], null],
    (_d, v) => new PDFDocument({ fonts: [{ ...FONT, type: 'binary', data: v }] as never }),
  ),
  ...option('setYPos', FINITE, (d, v) => d.setYPos(v)),
  ...option('ensureSpace requiredHeight', FINITE, (d, v) => {
    d.heading('Waiting');
    d.ensureSpace(v);
  }),
  ...option('setTextStyle level', NOT_LEVEL, (d, v) => setTextStyle(d, v as never)),
  ...option('measureTextLevel level', NOT_LEVEL, (d, v) => measureTextLevel(d, v as never)),
  ...option('setFont role', NOT_LEVEL, (d, v) => setFont(d, v as never, 'bold', 10)),
  ...option('setFont weight', ['heavy', 5, null, undefined], (d, v) => setFont(d, 'body', v as never, 10)),
  ...option('setFont size', SIZE, (d, v) => setFont(d, 'body', 'bold', v)),
  ...option('setFont italic', NOT_FLAG, (d, v) => setFont(d, 'body', 'bold', 10, v as never)),
];

// --- Tables and charts ---

/** The cases of a formatter of `lineChart`, drawn or measured. */
function lineFormatCases(key: 'formatValue' | 'formatX'): Case[] {
  return [
    ...option(`lineChart ${key}`, NOT_FUNCTION, (d, v) => d.lineChart(LINE_DATA, { [key]: v } as never)),
    ...option(`computeLineChartHeight ${key}`, NOT_FUNCTION, (d, v) =>
      computeLineChartHeight(d, LINE_DATA, { [key]: v } as never),
    ),
  ];
}

const OPTIONAL_DATA: Case[] = [
  ...option(
    'table showHead',
    NOT_CHOICE,
    (d, v) => d.table([{ a: 'one' }], { ...TABLE, showHead: v as never }),
    (d, v) => d.table([], { ...TABLE, showHead: v as never }),
  ),
  ...option(
    'table alternateRowFill',
    NOT_FLAG,
    (d, v) => d.table([{ a: 'one' }], { ...TABLE, alternateRowFill: v as never }),
    (d, v) => d.table([], { ...TABLE, alternateRowFill: v as never }),
  ),
  ...option(
    'table continuationTitle',
    NOT_TEXT,
    (d, v) => d.table([{ a: 'one' }], { ...TABLE, continuationTitle: v as never }),
    (d, v) => d.table([], { ...TABLE, continuationTitle: v as never }),
  ),
  ...option('table cellStyle', NOT_FUNCTION, (d, v) => d.table([{ a: 'one' }], { ...TABLE, cellStyle: v as never })),
  ...option('table column align', NOT_CHOICE, (d, v) =>
    d.table([{ a: 'one' }], { columns: [{ ...TABLE.columns[0], align: v as never }] }),
  ),
  // What the callback returns is checked before the first cell is drawn.
  ...option('table cellStyle result', NOT_OBJECT, (d, v) =>
    d.table([{ a: 'one' }], { ...TABLE, cellStyle: () => v as never }),
  ),
  ...(['bold', 'italic'] as const).flatMap((key) =>
    option(`table cellStyle result ${key}`, NOT_FLAG, (d, v) =>
      d.table([{ a: 'one' }], { ...TABLE, cellStyle: () => ({ [key]: v }) as never }),
    ),
  ),
  ...option('table cellStyle result align', NOT_CHOICE, (d, v) =>
    d.table([{ a: 'one' }], { ...TABLE, cellStyle: () => ({ align: v }) as never }),
  ),
  ...PART_CHARTS.flatMap(([name, call, flags]) =>
    flags.flatMap((flag) =>
      option(
        `${name} ${flag}`,
        NOT_FLAG,
        (d, v) => call(d, [SLICE], { [flag]: v }),
        (d, v) => call(d, [], { [flag]: v }),
      ),
    ),
  ),
  ...option(
    'columnChart legend',
    NOT_FLAG,
    (d, v) => d.columnChart([CHART_COLUMN], { legend: v as never }),
    (d, v) => d.columnChart([], { legend: v as never }),
  ),
  ...option('computeColumnChartHeight legend', NOT_FLAG, (d, v) =>
    computeColumnChartHeight(d, [CHART_COLUMN], { legend: v as never }),
  ),
  ...option('lineChart line emphasis', NOT_FLAG, (d, v) =>
    d.lineChart({ ...LINE_DATA, lines: [LINE_DATA.lines[0], { ...LINE_DATA.lines[0], emphasis: v as never }] }),
  ),
  ...(['formatValue', 'formatX'] as const).flatMap((key) => lineFormatCases(key)),
];

// --- Text arguments: what a primitive takes as text is a string ---

const TEXT_ARGUMENTS: Case[] = [
  ...option('paragraph text', NOT_TEXT_OR_MISSING, (d, v) => d.paragraph(v as never)),
  ...option('computeParagraphHeight text', NOT_TEXT_OR_MISSING, (d, v) => computeParagraphHeight(d, v as never)),
  ...option('heading text', NOT_TEXT_OR_MISSING, (d, v) => d.heading(v as never)),
  ...option('richText markup', NOT_TEXT_OR_MISSING, (d, v) => d.richText(v as never)),
  ...option('computeRichTextHeight markup', NOT_TEXT_OR_MISSING, (d, v) => computeRichTextHeight(d, v as never)),
  ...option('parseRichText markup', NOT_TEXT_OR_MISSING, (_d, v) => parseRichText(v as never)),
  ...option('parseRichInline markup', NOT_TEXT_OR_MISSING, (_d, v) => parseRichInline(v as never)),
  ...option('parseAddressLines address', NOT_TEXT_OR_MISSING, (_d, v) => parseAddressLines(v as never)),
  ...option('checkbox label', NOT_TEXT_OR_MISSING, (d, v) => d.checkbox(v as never)),
  ...option('inlineQuestion question', NOT_TEXT_OR_MISSING, (d, v) => d.inlineQuestion(v as never)),
  ...option('closingNote text', NOT_TEXT_OR_MISSING, (d, v) => d.closingNote(v as never)),
  ...option('infoBox surface content', NOT_TEXT_OR_MISSING, (d, v) => d.infoBox(v as never, { title: 'T' })),
  ...option('infoBox callout content', NOT_TEXT_OR_MISSING, (d, v) => d.infoBox(v as never, { variant: 'callout' })),
  ...option('computeInfoBoxHeight content', NOT_TEXT_OR_MISSING, (d, v) =>
    computeInfoBoxHeight(d, v as never, { title: 'T' }),
  ),
  ...option('drawIconWithText text', NOT_TEXT_OR_MISSING, (d, v) =>
    drawIconWithText(d, v as never, { x: 10, y: 10, icon: 'img' }),
  ),
  ...option('measureHighlightedText text', NOT_TEXT_OR_MISSING, (d, v) => measureHighlightedText(d, v as never)),
  // The text is checked even when the pill is already measured.
  ...option('drawHighlightedText text, metrics given', NOT_TEXT_OR_MISSING, (d, v) =>
    drawHighlightedText(d, v as never, { x: 10, y: 10, metrics: PILL_METRICS }),
  ),
  ...option('drawHighlightedText text', NOT_TEXT_OR_MISSING, (d, v) =>
    drawHighlightedText(d, v as never, { x: 10, y: 10 }),
  ),
];

// --- A list is checked whole before its first item is drawn ---

/** The cases of a list whose second or third item cannot be drawn. */
function listItemCases(name: string, call: WithOptions): Case[] {
  return [
    // The first item fits; the sub-items of the second leave their dash no width.
    ...single(`${name} whose second item has sub-items that leave no width`, (d) =>
      call(d, ['One', { text: 'Two', subItems: ['Dash'] }], { indent: d.measure - LIST_FRAME.subItem }),
    ),
    ...single(`${name} whose third item has sub-items and a detail that leave no width`, (d) =>
      call(d, ['One', 'Two', { text: 'Three', subItems: ['Dash'], detail: 'Detail' }], {
        indent: d.measure - LIST_FRAME.subItem,
      }),
    ),
  ];
}

const LIST_ITEMS: Case[] = LIST_CALLS.flatMap(([name, call]) => listItemCases(name, call));

describe.each([
  ['spaces', SPACES],
  ['text widths', TEXT_WIDTHS],
  ['boxes', BOXES],
  ['columns', COLUMNS],
  ['coordinates', COORDINATES],
  ['logos and designed pages', LOGOS],
  ['structures: texts, rich blocks and lists', STRUCTURE_TEXTS],
  ['structures: fields, declarations, addresses, signatures, header columns', STRUCTURE_BLOCKS],
  ['structures: tables and charts', STRUCTURE_DATA],
  ['structures: pills, back cover, logos', STRUCTURE_PAGES],
  ['options that are no object', STRUCTURE_OPTIONS],
  ['options of another variant', STRUCTURE_VARIANTS],
  ['optional fields: text blocks', [...OPTIONAL_TEXT, ...OPTIONAL_RUNS]],
  ['optional fields: boxes, fields, declarations, signatures', OPTIONAL_BLOCKS],
  ['optional fields: pages and the document', OPTIONAL_PAGES],
  ['optional fields: tables and charts', OPTIONAL_DATA],
  ['text arguments', TEXT_ARGUMENTS],
  ['the document, the flow and the text styles', DOCUMENT],
  ['lists checked whole', LIST_ITEMS],
])('invalid options, %s', (_, cases) => {
  it.each(cases)('%s throws before drawing', (_label, run, makeDoc) => {
    const doc = makeDoc();
    // Under a first block, so a move of the position or a page break would show.
    doc.paragraph('Above.');
    expectRejectedBeforeDrawing(doc, () => run(doc));
  });
});

// The width a list leaves is named after the list, not after the rich text it draws a detail with.
describe('invalid options, the text width of a list', () => {
  it.each([
    ['an item', undefined, LIST_FRAME.item, /a list item/],
    ['a sub-item', ['Two'], LIST_FRAME.subItem, /a list sub-item/],
  ])('names the list for %s', (_what, subItems, taken, message) => {
    for (const detail of [undefined, 'Detail']) {
      const doc = makeDocWithImage();
      const call = () => doc.bulletList([{ text: 'One', subItems, detail }], { indent: doc.measure - taken });
      expect(call).toThrow(message);
      expect(call).not.toThrow(/richText/);
    }
  });
});

// An invalid color has its own error: the table above expects an `InvalidOptionError`. It is checked before the page
// breaks or anything is drawn all the same, and before the content is looked at: a block with nothing to draw refuses
// it too. `null` is no color: it is refused, not taken for the default.
const NOT_COLOR = ['#zz', 'nope', null, 5];

type ColorCall = (d: PDFDocument, color: never) => unknown;

const COLOR_CALLS: [string, ColorCall][] = [
  ['checkbox', (d, color) => d.checkbox('Agreed', { color })],
  ['inlineQuestion', (d, color) => d.inlineQuestion('Agreed?', { color, answer: 'Yes' })],
  ['drawIconWithText', (d, color) => drawIconWithText(d, 'Phone', { x: 10, y: 10, icon: 'img', color })],
  ['separator', (d, color) => d.separator({ color })],
  ['closingNote', (d, color) => d.closingNote('Legal.', { color })],
  ['closingNote, empty', (d, color) => d.closingNote('', { color })],
  ['watermark', (d, color) => d.watermark('DRAFT', { color })],
  ['watermark on all pages', (d, color) => d.watermark('DRAFT', { color, allPages: true })],
  ['backCover contact', (d, color) => d.backCover({ contact: { lines: ['a@b.c'], color } })],
  ['backCover contact without a line', (d, color) => d.backCover({ contact: { lines: [], color } })],
  ...(['titleColor', 'subtitleColor', 'waveColor'] as const).map((key): [string, ColorCall] => [
    `wave cover ${key}`,
    (d, color) => d.cover('Title', { variant: 'wave', [key]: color }),
  ]),
  ['donutChart slice', (d, color) => d.donutChart([{ label: 'A', value: 1, color }])],
  ['donutChart slice left out', (d, color) => d.donutChart([{ label: 'A', value: 0, color }])],
  ['computeDonutChartHeight slice', (d, color) => computeDonutChartHeight(d, [{ label: 'A', value: 1, color }])],
  ['stackedBar slice', (d, color) => d.stackedBar([{ label: 'A', value: 1, color }])],
  ['stackedBar slice left out', (d, color) => d.stackedBar([{ label: 'A', value: Number.NaN, color }])],
  ['computeStackedBarHeight slice', (d, color) => computeStackedBarHeight(d, [{ label: 'A', value: 1, color }])],
  [
    'columnChart series',
    (d, color) => d.columnChart([{ label: 'A', values: [1] }], { series: [{ label: 'S', color }] }),
  ],
  ['columnChart series, no column', (d, color) => d.columnChart([], { series: [{ label: 'S', color }] })],
  [
    'columnChart series, no value above 0',
    (d, color) => d.columnChart([{ label: 'A', values: [0] }], { series: [{ label: 'S', color }], emptyText: 'None' }),
  ],
  [
    'computeColumnChartHeight series, no column',
    (d, color) => computeColumnChartHeight(d, [], { series: [{ label: 'S', color }] }),
  ],
  ['lineChart line', (d, color) => d.lineChart({ xs: [1, 2], lines: [{ label: 'L', values: [1, 2], color }] })],
  ['lineChart line, one point', (d, color) => d.lineChart({ xs: [1], lines: [{ label: 'L', values: [1], color }] })],
  [
    'lineChart band, one point',
    (d, color) => d.lineChart({ xs: [1], lines: [], band: { label: 'B', lower: [0], upper: [1], color } }),
  ],
  [
    'lineChart highlight, nothing above 0',
    (d, color) =>
      d.lineChart({ xs: [1, 2], lines: [{ label: 'L', values: [0, 0] }] }, { highlight: { from: 1, to: 2, color } }),
  ],
  [
    'computeLineChartHeight highlight, one point',
    (d, color) => computeLineChartHeight(d, { xs: [1], lines: [] }, { highlight: { from: 1, to: 2, color } }),
  ],
  [
    'table cellStyle color',
    (d, color) => d.table([{ a: '1' }], { columns: [{ header: 'A', key: 'a' }], cellStyle: () => ({ color }) }),
  ],
  [
    'table cellStyle fill',
    (d, color) => d.table([{ a: '1' }], { columns: [{ header: 'A', key: 'a' }], cellStyle: () => ({ fill: color }) }),
  ],
];

describe('an invalid color is refused before anything is drawn', () => {
  it.each(
    COLOR_CALLS.flatMap(([name, call]) => NOT_COLOR.map((color) => [`${name} ${show(color)}`, call, color] as const)),
  )('%s', (_name, run, color) => {
    // Little room left: the checkbox would break the page before it reads its color.
    const doc = leaveRoom(makeDocWithImage(), 1);
    const drawing = watchDrawing(doc);
    const start = doc.peekYPos();
    const warnings = [...doc.warnings];
    expect(() => run(doc, color as never)).toThrow(InvalidColorError);
    drawing.nothingDrawn();
    expect(doc.peekYPos()).toBe(start);
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(doc.warnings).toEqual(warnings);
  });
});

// A list of images is registered whole or not at all.
describe('registerImages with an invalid entry after a valid one', () => {
  it('registers none of them', () => {
    const doc = makeDocWithImage();
    expect(() => doc.registerImages({ first: PNG, second: 5 as never })).toThrow(InvalidOptionError);
    expect(() => doc.images.get('first')).toThrow();
  });
});
