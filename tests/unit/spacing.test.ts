import { describe, expect, it } from 'vitest';

import * as constants from '../../src/core/constants';
import { BADGE, CHECKBOX, HEADER_COLUMNS, LOGO, SPACING } from '../../src/core/constants';
import type { HeadingLevel, TextLevel } from '../../src/core/constants';
import type { PDFDocument } from '../../src/core/document';
import { InvalidOptionError } from '../../src/core/errors';
import { computeDeclarationsBoxHeight } from '../../src/drawing/declarations';
import { computeRichBlocksHeight, computeRichTextHeight } from '../../src/drawing/rich';
import { computeSignatureZoneHeight } from '../../src/drawing/signatures';
import { computeParagraphHeight, measureTextLevel } from '../../src/drawing/text';
import type { ThemeOverrides } from '../../src/theme/defaults';
import { DEFAULT_SPACING, createTheme, resolveSpacing } from '../../src/theme/defaults';
import { presetTheme } from '../../src/theme/presets';
import type { Theme } from '../../src/theme/types';
import { PNG, currentPage, lastEntryPage, leaveRoom, makeDoc, pageStream, recordTexts } from './helpers';

/** A document on the test theme with the spacing overrides on top. */
const spacedDoc = (spacing: ThemeOverrides['spacing']) =>
  makeDoc({ theme: createTheme({ colors: { primary: '#3572B8' }, spacing }) });

const line = (doc: PDFDocument, level: TextLevel) => measureTextLevel(doc, level).lineHeight;

describe('spacing scale', () => {
  it('only grows, from none to xxxlarge', () => {
    const steps = Object.values(SPACING);
    expect(steps[0]).toBe(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    expect(SPACING.xxlarge).toBe(12);
    expect(SPACING.xxxlarge).toBe(16);
  });

  it('builds the default rhythm from its steps', () => {
    const steps = new Set<number>(Object.values(SPACING));
    const { block, heading } = DEFAULT_SPACING;
    const used = [block, ...Object.values(heading).flatMap(({ before, after }) => [before, after])];
    for (const value of used) expect(steps.has(value)).toBe(true);
  });

  it('holds every gap of the component geometry', () => {
    const steps = new Set<number>(Object.values(SPACING));
    const found = spacingValues(constants);
    // The walk reaches the nested objects (`CHROME.header`, `CHART.donut`, `FIELD.rowGap`, `TABLE.cellPadding`).
    expect(found.length).toBeGreaterThan(50);
    for (const { path, value } of found) expect(steps.has(value), `${path} = ${value}`).toBe(true);
  });
});

/** A key that names a space: its number, or every number under it, must be a step of `SPACING`. */
const SPACING_KEY = /gap|spaceafter|spacebefore|spacing|padding|indent/i;

/**
 * Every number under a key that names a space, in the component constants of `module`, with its path. `SPACING` is
 * the scale itself; the arrays (dash patterns, the steps of a chart scale) hold no space.
 */
function spacingValues(module: Record<string, unknown>): { path: string; value: number }[] {
  const found: { path: string; value: number }[] = [];
  const walk = (value: unknown, path: string, spacing: boolean): void => {
    if (typeof value === 'number') {
      if (spacing) found.push({ path, value });
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`, spacing || SPACING_KEY.test(key));
    }
  };
  for (const [name, value] of Object.entries(module)) if (name !== 'SPACING') walk(value, name, false);
  return found;
}

describe('theme.spacing', () => {
  it('defaults to DEFAULT_SPACING', () => {
    expect(createTheme().spacing).toEqual(DEFAULT_SPACING);
  });

  it('rejects a negative or non-finite space', () => {
    expect(() => createTheme({ spacing: { block: -1 } })).toThrow(InvalidOptionError);
    expect(() => createTheme({ spacing: { block: Number.NaN } })).toThrow(InvalidOptionError);
    expect(() => createTheme({ spacing: { heading: { h2: { after: -4 } } } })).toThrow('heading.h2.after');
  });

  it('merges overrides level by level and side by side', () => {
    const spacing = resolveSpacing({ block: 2, heading: { h2: { before: 20 } } });
    expect(createTheme({ spacing: { block: 2, heading: { h2: { before: 20 } } } }).spacing).toEqual(spacing);
    expect(spacing.block).toBe(2);
    expect(spacing.heading.h2).toEqual({ before: 20, after: DEFAULT_SPACING.heading.h2.after });
    expect(spacing.heading.h1).toEqual(DEFAULT_SPACING.heading.h1);
    // The defaults are not written to.
    expect(DEFAULT_SPACING.heading.h2.before).toBe(SPACING.xxlarge);
  });

  it('keeps the default for a value given as undefined', () => {
    const spacing = resolveSpacing({ block: undefined, heading: { h2: { before: undefined, after: 3 } } });
    expect(spacing.block).toBe(DEFAULT_SPACING.block);
    expect(spacing.heading.h2).toEqual({ before: DEFAULT_SPACING.heading.h2.before, after: 3 });
  });

  it('goes through presetTheme', () => {
    expect(presetTheme('ocean', { spacing: { block: 5 } }).spacing.block).toBe(5);
  });

  it('is complete on every theme the library builds: no optional chaining to read it', () => {
    // A type-check test as much as a runtime one: `spacing` is required, not optional.
    expect(createTheme().spacing.block).toBe(DEFAULT_SPACING.block);
    expect(presetTheme('ocean').spacing.block).toBe(DEFAULT_SPACING.block);
    expect(createTheme().spacing.heading.h2.before).toBe(DEFAULT_SPACING.heading.h2.before);
    expect(presetTheme('ocean').spacing.heading.h2.after).toBe(DEFAULT_SPACING.heading.h2.after);
  });

  // The types require a complete `spacing`: these casts stand for a caller without types, who hand-builds a theme.
  describe('of a theme built without types', () => {
    const { spacing: _complete, ...rest } = createTheme({ colors: { primary: '#3572B8' } });
    const bare = rest as unknown as Theme;
    const withSpacing = (spacing: unknown) => ({ ...bare, spacing }) as Theme;

    it('is completed from DEFAULT_SPACING when left out', () => {
      const doc = makeDoc({ theme: bare });
      expect(doc.theme.spacing).toEqual(DEFAULT_SPACING);
      // Drawing reads it: a paragraph and a heading no longer throw.
      doc.paragraph('Intro').heading('Section', { level: 'h3' }).paragraph('Body');
      expect(doc.getYPos()).toBeGreaterThan(doc.margins.top);
    });

    it('is completed level by level and side by side when partial', () => {
      const doc = makeDoc({ theme: withSpacing({ heading: { h2: { before: 20 } } }) });
      expect(doc.theme.spacing).toEqual(resolveSpacing({ heading: { h2: { before: 20 } } }));
      expect(doc.theme.spacing.heading.h2.after).toBe(DEFAULT_SPACING.heading.h2.after);
    });

    it('is checked', () => {
      expect(() => makeDoc({ theme: withSpacing({ block: -1 }) })).toThrow(InvalidOptionError);
      expect(() => makeDoc({ theme: withSpacing({ heading: { h1: { before: Infinity } } }) })).toThrow(
        'heading.h1.before',
      );
    });
  });

  it('sets the space under a block', () => {
    const doc = spacedDoc({ block: 7 });
    const start = doc.getYPos();
    doc.paragraph('One line.');
    expect(doc.getYPos() - start).toBeCloseTo(line(doc, 'body') + 7, 6);
  });

  it('sets the space around a heading', () => {
    const doc = spacedDoc({ heading: { h2: { before: 20, after: 9 } } });
    doc.paragraph('Intro', { spaceAfter: 0 });
    const start = doc.getYPos();
    doc.heading('Section', { level: 'h2' });
    expect(doc.getYPos() - start).toBeCloseTo(20 + line(doc, 'h2') + 9, 6);
  });

  it('gives way to the options of a block', () => {
    const doc = spacedDoc({ block: 7, heading: { h2: { before: 20, after: 9 } } });
    doc.paragraph('Intro', { spaceAfter: 1 });
    const start = doc.getYPos();
    doc.heading('Section', { level: 'h2', spaceBefore: 5, spaceAfter: 2 });
    expect(doc.getYPos() - start).toBeCloseTo(5 - 1 + line(doc, 'h2') + 2, 6);
  });
});

describe('collapsing spaces', () => {
  it('separates a block and a heading by the larger of their spaces, not the sum', () => {
    const doc = makeDoc();
    const { block, heading } = doc.theme.spacing;
    doc.paragraph('Intro');
    const afterParagraph = doc.getYPos();
    doc.heading('Section', { level: 'h2' });
    const gap = heading.h2.before - block;
    expect(doc.getYPos() - afterParagraph).toBeCloseTo(gap + line(doc, 'h2') + heading.h2.after, 6);
  });

  it('keeps the space of the block above when it is the larger one', () => {
    const doc = makeDoc();
    doc.paragraph('Intro', { spaceAfter: 30 });
    const afterParagraph = doc.getYPos();
    doc.heading('Section', { level: 'h2' });
    expect(doc.getYPos() - afterParagraph).toBeCloseTo(line(doc, 'h2') + doc.theme.spacing.heading.h2.after, 6);
  });

  it('collapses a heading into the heading above it', () => {
    const doc = makeDoc();
    const { h1, h2 } = doc.theme.spacing.heading;
    doc.paragraph('Intro', { spaceAfter: 0 });
    doc.heading('Title');
    const afterTitle = doc.getYPos();
    doc.heading('Section', { level: 'h2' });
    const gap = Math.max(0, h2.before - h1.after);
    expect(doc.getYPos() - afterTitle).toBeCloseTo(gap + line(doc, 'h2') + h2.after, 6);
  });

  it('adds no space before a heading at the top of a page', () => {
    const doc = makeDoc();
    const top = doc.getYPos();
    doc.heading('Title');
    expect(doc.getYPos() - top).toBeCloseTo(line(doc, 'h1') + doc.theme.spacing.heading.h1.after, 6);
  });

  it('adds the space before a heading drawn at once, keepWithNext off', () => {
    const doc = makeDoc();
    const { block, heading } = doc.theme.spacing;
    doc.paragraph('Intro');
    const afterParagraph = doc.getYPos();
    doc.heading('Section', { level: 'h3', keepWithNext: false });
    expect(doc.getYPos() - afterParagraph).toBeCloseTo(
      heading.h3.before - block + line(doc, 'h3') + heading.h3.after,
      6,
    );
  });

  it('collapses the space before a separator', () => {
    const doc = makeDoc();
    doc.paragraph('Intro', { spaceAfter: SPACING.xxlarge });
    const afterParagraph = doc.getYPos();
    doc.separator();
    // The paragraph already left more than the separator asks for above it.
    expect(doc.getYPos() - afterParagraph).toBeCloseTo(SPACING.large, 6);
  });

  it('keeps the rendered space above a separator under a block: the larger one, 6 mm', () => {
    const doc = makeDoc();
    doc.paragraph('Intro');
    const bottom = doc.contentBottom();
    doc.separator();
    expect(doc.contentBottom() - bottom).toBeCloseTo(SPACING.large, 6);
  });

  it('adds an explicit addSpace on top, without collapsing it', () => {
    const doc = makeDoc();
    const { h2 } = doc.theme.spacing.heading;
    doc.paragraph('Intro');
    doc.addSpace(10);
    const afterSpace = doc.getYPos();
    doc.heading('Section', { level: 'h2' });
    expect(doc.getYPos() - afterSpace).toBeCloseTo(h2.before + line(doc, 'h2') + h2.after, 6);
  });

  it('starts after setYPos without collapsing', () => {
    const doc = makeDoc();
    const { h2 } = doc.theme.spacing.heading;
    doc.paragraph('Intro');
    doc.setYPos(100);
    doc.heading('Section', { level: 'h2' });
    expect(doc.getYPos() - 100).toBeCloseTo(h2.before + line(doc, 'h2') + h2.after, 6);
  });
});

describe('beginBlock and endBlock', () => {
  it('endBlock moves under the block and leaves its space', () => {
    const doc = makeDoc();
    expect(doc.endBlock(50, 4)).toBe(54);
    expect(doc.getYPos()).toBe(54);
    expect(doc.contentBottom()).toBe(50);
  });

  it('endBlock without a space leaves theme.spacing.block, and none with 0', () => {
    const doc = spacedDoc({ block: 7 });
    expect(doc.endBlock(50)).toBe(57);
    expect(doc.contentBottom()).toBe(50);
    expect(doc.endBlock(60, 0)).toBe(60);
    expect(doc.contentBottom()).toBe(60);
    expect(doc.beginBlock(6)).toBe(66);
  });

  it('resolveSpaceAfter gives the space endBlock leaves', () => {
    const doc = spacedDoc({ block: 7 });
    expect(doc.resolveSpaceAfter()).toBe(7);
    expect(doc.resolveSpaceAfter(0)).toBe(0);
    expect(doc.resolveSpaceAfter(3)).toBe(3);
  });

  it('beginBlock adds what the space above does not cover', () => {
    const doc = makeDoc();
    doc.endBlock(50, 4);
    expect(doc.beginBlock(10)).toBe(60);
    // Already covered: nothing more.
    expect(doc.beginBlock(6)).toBe(60);
    expect(doc.contentBottom()).toBe(50);
  });

  it('beginBlock adds nothing at the top of a page', () => {
    const doc = makeDoc();
    const top = doc.getYPos();
    expect(doc.beginBlock(10)).toBe(top);
  });

  it('spaceAbove measures from a given space under the block above, wherever the position is', () => {
    const doc = makeDoc();
    expect(doc.spaceAbove(10)).toBe(0);
    expect(doc.spaceAbove(10, 4)).toBe(6);
    expect(doc.spaceAbove(10, 12)).toBe(0);
    // A negative space under a block covers nothing.
    expect(doc.spaceAbove(10, -3)).toBe(10);
  });

  it('places a waiting heading before it opens or closes a block', () => {
    const doc = makeDoc();
    doc.heading('Title', { toc: true });
    const end = doc.beginBlock(0);
    expect(doc.pageRefs.tocEntries).toHaveLength(1);
    expect(end).toBeCloseTo(doc.margins.top + line(doc, 'h1') + doc.theme.spacing.heading.h1.after, 6);
  });
});

describe('attachTo', () => {
  it('moves to the gap under a block of its kind and returns the space that block left', () => {
    const doc = makeDoc();
    doc.endBlock(50, undefined, { kind: 'heading', fallback: 8 });
    expect(doc.attachTo('heading', 2, 0)).toBe(8);
    expect(doc.peekYPos()).toBe(52);
    expect(doc.contentBottom()).toBe(50);
  });

  it('never moves down: a block that left less than the gap keeps its space', () => {
    const doc = makeDoc();
    doc.endBlock(50, undefined, { kind: 'heading', fallback: 1 });
    expect(doc.attachTo('heading', 2, 0)).toBe(1);
    expect(doc.peekYPos()).toBe(51);
    expect(doc.contentBottom()).toBe(50);
  });

  it('attaches to nothing under a block closed without a kind, opened since, or attached to already', () => {
    const doc = makeDoc();
    doc.endBlock(50, 8);
    expect(doc.attachTo('heading', 2, 0)).toBeUndefined();
    expect(doc.peekYPos()).toBe(58);
    doc.endBlock(70, undefined, { kind: 'heading', fallback: 8 });
    doc.beginBlock(10);
    expect(doc.attachTo('heading', 2, 0)).toBeUndefined();
    expect(doc.peekYPos()).toBe(80);
    doc.endBlock(90, undefined, { kind: 'heading', fallback: 8 });
    doc.attachTo('heading', 2, 0);
    expect(doc.attachTo('heading', 2, 0)).toBeUndefined();
    expect(doc.peekYPos()).toBe(92);
  });

  it('attaches to nothing under a block that left a space its caller chose', () => {
    const doc = makeDoc();
    doc.endBlock(50, 8, { kind: 'heading' });
    expect(doc.attachTo('heading', 2, 0)).toBeUndefined();
    expect(doc.peekYPos()).toBe(58);
  });
});

/** Height (mm) of a badge of one line at its default level. */
const badgeHeight = (doc: PDFDocument) => line(doc, 'bodyBold') + 2 * BADGE.paddingY;

/**
 * After a badge, as the last block: the space between it and the last heading, a `level` without a rule, and the
 * space it leaves under it.
 */
function badgeSpaces(doc: PDFDocument, level: HeadingLevel = 'h1') {
  const { y } = doc.pageRefs.tocEntries.at(-1)!;
  const top = doc.contentBottom() - badgeHeight(doc);
  return { gap: top - (y + line(doc, level)), after: doc.peekYPos() - doc.contentBottom() };
}

describe('a badge under a heading', () => {
  it.each(['h1', 'h2'] as const)('attaches to an %s: 2 mm under it, then the space the heading leaves', (level) => {
    const doc = makeDoc();
    doc.paragraph('Intro');
    doc.heading('Title', { level }).badge('Badge');
    expect(badgeSpaces(doc, level)).toEqual({
      gap: expect.closeTo(BADGE.headingGap, 6),
      after: expect.closeTo(doc.theme.spacing.heading[level].after, 6),
    });
  });

  it('keeps away from a heading given a spaceAfter, and leaves the block space', () => {
    const doc = makeDoc();
    doc.heading('Title', { spaceAfter: 10 }).badge('Badge');
    expect(badgeSpaces(doc)).toEqual({ gap: expect.closeTo(10, 6), after: expect.closeTo(doc.theme.spacing.block, 6) });
  });

  it('attaches with a spaceAfter of its own, and leaves it', () => {
    const doc = makeDoc();
    doc.heading('Title').badge('Badge', { spaceAfter: 9 });
    expect(badgeSpaces(doc)).toEqual({ gap: expect.closeTo(BADGE.headingGap, 6), after: expect.closeTo(9, 6) });
  });

  it('attaches to a heading drawn at once, keepWithNext off', () => {
    const doc = makeDoc();
    doc.heading('Title', { level: 'h2', keepWithNext: false }).badge('Badge');
    expect(badgeSpaces(doc, 'h2')).toEqual({
      gap: expect.closeTo(BADGE.headingGap, 6),
      after: expect.closeTo(doc.theme.spacing.heading.h2.after, 6),
    });
  });

  it('attaches to the last of two headings', () => {
    const doc = makeDoc();
    doc.heading('Title').heading('Section', { level: 'h2' }).badge('Badge');
    expect(badgeSpaces(doc, 'h2')).toEqual({
      gap: expect.closeTo(BADGE.headingGap, 6),
      after: expect.closeTo(doc.theme.spacing.heading.h2.after, 6),
    });
  });

  it('does not attach across addSpace', () => {
    const doc = makeDoc();
    const { block, heading } = doc.theme.spacing;
    doc.heading('Title').addSpace(3).badge('Badge');
    expect(badgeSpaces(doc)).toEqual({ gap: expect.closeTo(heading.h1.after + 3, 6), after: expect.closeTo(block, 6) });
  });

  it('does not attach across another block', () => {
    const doc = makeDoc();
    const { block } = doc.theme.spacing;
    doc.heading('Title').paragraph('Text.');
    const bottom = doc.contentBottom();
    doc.badge('Badge');
    expect(doc.contentBottom() - badgeHeight(doc) - bottom).toBeCloseTo(block, 6);
    expect(doc.peekYPos() - doc.contentBottom()).toBeCloseTo(block, 6);
  });

  it('does not attach to a heading outside its inset', () => {
    const doc = makeDoc();
    const { block, heading } = doc.theme.spacing;
    doc.heading('Title');
    doc.inset({ left: 10 }, () => doc.badge('Badge'));
    expect(badgeSpaces(doc)).toEqual({ gap: expect.closeTo(heading.h1.after, 6), after: expect.closeTo(block, 6) });
  });

  it('does not attach to a heading that ends an inset', () => {
    const doc = makeDoc();
    const { block, heading } = doc.theme.spacing;
    doc.inset({ left: 10 }, () => doc.heading('Title', { keepWithNext: false }));
    doc.badge('Badge');
    expect(badgeSpaces(doc)).toEqual({ gap: expect.closeTo(heading.h1.after, 6), after: expect.closeTo(block, 6) });
  });

  it('does not attach in a column to a heading above the columns', () => {
    const doc = makeDoc();
    const { block, heading } = doc.theme.spacing;
    doc.heading('Title').columns([(column) => column.badge('Badge'), (column) => column.paragraph('Beside.')]);
    expect(badgeSpaces(doc)).toEqual({ gap: expect.closeTo(heading.h1.after, 6), after: expect.closeTo(block, 6) });
  });

  it('attaches on the next page when the heading moves there with it', () => {
    const doc = leaveRoom(makeDoc(), 10);
    doc.heading('Title').badge('Badge');
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(doc.pageRefs.tocEntries[0]).toMatchObject({ page: 2, y: doc.layout.topFor(2) });
    expect(badgeSpaces(doc).gap).toBeCloseTo(BADGE.headingGap, 6);
  });

  it.each([
    ['waiting', {}],
    ['drawn at once', { keepWithNext: false }],
  ] as const)('stays on the page of a heading %s when it fits only once attached', (_name, options) => {
    const doc = makeDoc();
    const { block, heading } = doc.theme.spacing;
    // 1 mm short of the heading, its space, the badge and the block space: the move up makes the room.
    leaveRoom(doc, heading.h1.before + line(doc, 'h1') + heading.h1.after + badgeHeight(doc) + block - 1);
    doc.heading('Title', options).badge('Badge');
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(badgeSpaces(doc).gap).toBeCloseTo(BADGE.headingGap, 6);
  });

  it('does not attach at the top of a page, under a heading left on the page before', () => {
    const doc = makeDoc();
    const { block, heading } = doc.theme.spacing;
    // Room for the heading and the space around it, not for the badge. After `setYPos`, the space above is whole.
    leaveRoom(doc, heading.h1.before + line(doc, 'h1') + heading.h1.after + 0.5);
    doc.heading('Title', { keepWithNext: false }).badge('Badge');
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(lastEntryPage(doc)).toBe(1);
    expect(doc.contentBottom() - badgeHeight(doc)).toBeCloseTo(doc.layout.topFor(2), 6);
    expect(doc.peekYPos() - doc.contentBottom()).toBeCloseTo(block, 6);
  });

  it('lands in keepTogether where it lands without, and the measuring passes leave nothing to attach to', () => {
    const plain = makeDoc();
    const kept = makeDoc();
    for (const doc of [plain, kept]) doc.paragraph('Intro');
    plain.heading('Title').badge('Badge');
    kept.keepTogether(() => kept.heading('Title').badge('Badge'));
    expect(state(kept)).toEqual(state(plain));
    // The pass leaves the badge as the last block: a second badge does not attach to the heading.
    kept.badge('Again');
    expect(kept.contentBottom() - badgeHeight(kept)).toBeCloseTo(state(plain).y, 6);
  });

  it('moves with the heading to the next page in keepTogether, and attaches there', () => {
    const doc = leaveRoom(makeDoc(), 10);
    doc.keepTogether(() => doc.heading('Title').badge('Badge'));
    expect(doc.doc.getNumberOfPages()).toBe(2);
    expect(badgeSpaces(doc)).toEqual({
      gap: expect.closeTo(BADGE.headingGap, 6),
      after: expect.closeTo(doc.theme.spacing.heading.h1.after, 6),
    });
  });

  it('stays where it stood when no heading is above it', () => {
    const doc = makeDoc();
    const top = doc.getYPos();
    doc.badge('Badge');
    expect(doc.contentBottom() - badgeHeight(doc)).toBeCloseTo(top, 6);
    expect(doc.peekYPos() - doc.contentBottom()).toBeCloseTo(doc.theme.spacing.block, 6);
  });
});

/** Gaps (mm) between the boxes the document drew, and the space under the last, for `draw` run on `doc`. */
function checkboxGaps(doc: PDFDocument, draw: () => void) {
  const texts = recordTexts(doc);
  draw();
  const { ascent, lineHeight } = measureTextLevel(doc, 'body');
  const tops = texts.map(({ y }) => y - ascent);
  return { tops, gaps: tops.slice(1).map((top, i) => top - tops[i] - lineHeight) };
}

describe('checkboxes in a group', () => {
  const small = CHECKBOX.groupGap;

  it('keeps on its page a box that fits only once attached', () => {
    const doc = makeDoc();
    const { block } = doc.theme.spacing;
    // 1 mm short of two boxes with the block space under each: the second one moves up by more than that.
    leaveRoom(doc, 2 * (line(doc, 'body') + block) - 1);
    doc.checkbox('A').checkbox('B');
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(doc.peekYPos() - doc.contentBottom()).toBeCloseTo(block, 6);
  });

  it('sit 2 mm apart, with the block space under the last', () => {
    const doc = makeDoc();
    const { gaps } = checkboxGaps(doc, () => doc.checkbox('A').checkbox('B').checkbox('C').paragraph('After.'));
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toBeCloseTo(small, 6);
    expect(gaps[1]).toBeCloseTo(small, 6);
    expect(gaps[2]).toBeCloseTo(doc.theme.spacing.block, 6);
  });

  it('leave the block space under a checkbox alone, between two paragraphs', () => {
    const doc = makeDoc();
    const { block } = doc.theme.spacing;
    const { gaps } = checkboxGaps(doc, () => doc.paragraph('Before.').checkbox('A').paragraph('After.'));
    expect(gaps).toEqual([expect.closeTo(block, 6), expect.closeTo(block, 6)]);
  });

  it('do not attach to a checkbox given a spaceAfter, and keep it under the last', () => {
    const doc = makeDoc();
    const { gaps } = checkboxGaps(doc, () =>
      doc.checkbox('A', { spaceAfter: 7 }).checkbox('B', { spaceAfter: 9 }).paragraph('After.'),
    );
    expect(gaps).toEqual([expect.closeTo(7, 6), expect.closeTo(9, 6)]);
  });

  it('attach to the checkbox above while keeping their own space under them', () => {
    const doc = makeDoc();
    const { gaps } = checkboxGaps(doc, () => doc.checkbox('A').checkbox('B', { spaceAfter: 9 }).paragraph('After.'));
    expect(gaps).toEqual([expect.closeTo(small, 6), expect.closeTo(9, 6)]);
  });

  it('do not attach across an inlineQuestion', () => {
    const doc = makeDoc();
    const { block } = doc.theme.spacing;
    const texts = recordTexts(doc);
    doc.checkbox('A').inlineQuestion('Question?').checkbox('B');
    const { ascent, lineHeight } = measureTextLevel(doc, 'body');
    const [a, question, b] = texts.map(({ y }) => y - ascent);
    expect(question - a - lineHeight).toBeCloseTo(block, 6);
    expect(b - question - lineHeight).toBeCloseTo(block, 6);
  });

  it('do not attach at the top of a page', () => {
    const doc = makeDoc();
    doc.paragraph('Intro');
    // Room for the first box and the space under it, not for the second.
    doc.setYPos(doc.pageHeight - doc.margins.bottom - line(doc, 'body') - doc.theme.spacing.block - 1);
    const texts = recordTexts(doc);
    doc.checkbox('A').checkbox('B');
    expect(texts.map(({ page }) => page)).toEqual([1, 2]);
    expect(texts[1].y).toBeCloseTo(doc.layout.topFor(2) + measureTextLevel(doc, 'body').ascent, 6);
  });

  it('land in keepTogether where they land without', () => {
    const plain = makeDoc();
    const kept = makeDoc();
    for (const doc of [plain, kept]) doc.paragraph('Intro');
    plain.checkbox('A').checkbox('B').paragraph('After.');
    kept.keepTogether(() => kept.checkbox('A').checkbox('B')).paragraph('After.');
    expect(state(kept)).toEqual(state(plain));
  });

  it('attach to each other in a column', () => {
    const doc = makeDoc();
    const texts = recordTexts(doc);
    doc.columns([(column) => column.checkbox('A').checkbox('B'), (column) => column.paragraph('Beside.')]);
    const [a, b] = texts.filter(({ lines }) => lines[0] === 'A' || lines[0] === 'B');
    expect(b.y - a.y - line(doc, 'body')).toBeCloseTo(small, 6);
  });
});

/** A flow block by name, drawn with the given `spaceAfter` when it takes one. */
type BlockCase = [name: string, draw: (doc: PDFDocument, spaceAfter?: number) => unknown];

const blockCase = (name: string, draw: (doc: PDFDocument, options: { spaceAfter?: number }) => unknown): BlockCase => [
  name,
  (doc, spaceAfter) => draw(doc, { spaceAfter }),
];

/** Every flow block. */
const BLOCKS: BlockCase[] = [
  blockCase('heading', (doc, options) => doc.heading('Heading', options).getYPos()),
  blockCase('paragraph', (doc, options) => doc.paragraph('Text.', options)),
  blockCase('paragraphs', (doc, options) => doc.paragraphs(['One.', 'Two.'], options)),
  blockCase('richText', (doc, options) => doc.richText('**Rich** text.\n\nSecond.', options)),
  blockCase('richBlocks', (doc, options) => doc.richBlocks([{ type: 'paragraph', runs: [{ text: 'Run' }] }], options)),
  blockCase('bulletList', (doc, options) => doc.bulletList(['One', { text: 'Two', detail: 'Detail' }], options)),
  blockCase('numberedList', (doc, options) => doc.numberedList(['One', 'Two'], options)),
  blockCase('iconList', (doc, options) => doc.iconList(['One', 'Two'], { icon: PNG, ...options })),
  blockCase('checkbox', (doc, options) => doc.checkbox('Agreed', options)),
  blockCase('badge', (doc, options) => doc.badge('Badge', options)),
  blockCase('inlineQuestion', (doc, options) => doc.inlineQuestion('Agreed?', { answer: 'Yes', ...options })),
  blockCase('fields', (doc, options) => doc.fields([{ label: 'A', value: '1' }], options)),
  blockCase('fieldRows', (doc, options) =>
    doc.fieldRows([[{ label: 'A', value: '1' }], [{ label: 'B', value: '2' }]], options),
  ),
  blockCase('fieldRows leader', (doc, options) =>
    doc.fieldRows([[{ label: 'A', value: '1' }]], { layout: 'leader', ...options }),
  ),
  blockCase('infoBox', (doc, options) => doc.infoBox('Content', { title: 'Title', ...options })),
  blockCase('callout', (doc, options) => doc.infoBox('Content', { variant: 'callout', title: 'Title', ...options })),
  blockCase('declarationsBox', (doc, options) => doc.declarationsBox([{ text: 'I agree.' }], options)),
  blockCase('addressBlock', (doc, options) => doc.addressBlock([{ text: 'Acme', role: 'title' }], options)),
  blockCase('signatureZone', (doc, options) =>
    doc.signatureZone([{ label: 'Client' }], { caption: 'Signed', ...options }),
  ),
  blockCase('columns', (doc, options) =>
    doc.columns([(ctx) => ctx.paragraph('Left'), (ctx) => ctx.paragraph('Right')], options),
  ),
  blockCase('donutChart', (doc, options) => doc.donutChart([{ label: 'A', value: 1 }], options)),
  blockCase('stackedBar', (doc, options) => doc.stackedBar([{ label: 'A', value: 1 }], options)),
  blockCase('columnChart', (doc, options) => doc.columnChart([{ label: 'A', values: [1] }], options)),
  blockCase('lineChart', (doc, options) =>
    doc.lineChart({ xs: [1, 2], lines: [{ label: 'A', values: [1, 2] }] }, options),
  ),
  blockCase('donutChart with an empty text', (doc, options) =>
    doc.donutChart([], { emptyText: 'No data', ...options }),
  ),

  blockCase('table', (doc, options) => doc.table([{ a: '1' }], { columns: [{ header: 'A', key: 'a' }], ...options })),
];

/** Blocks whose `spaceAfter` is not `theme.spacing.block` by default. */
const OWN_DEFAULT: BlockCase[] = [
  blockCase('separator', (doc, options) => doc.separator(options)),
  blockCase('logo', (doc, options) => doc.logo(PNG, options)),
  blockCase('headerColumns', (doc, options) =>
    doc.headerColumns([{ title: 'T', fields: [{ label: 'L', value: 'V' }] }], options),
  ),
];

describe('every flow block closes with endBlock', () => {
  it.each([...BLOCKS, ...OWN_DEFAULT])('%s leaves its spaceAfter as collapsible space', (_name, draw) => {
    const doc = makeDoc();
    doc.paragraph('Intro');
    draw(doc, 5);
    expect(doc.getYPos() - doc.contentBottom()).toBeCloseTo(5, 6);
    // The next heading collapses into that space.
    const before = doc.getYPos();
    doc.heading('Next', { level: 'h2' }).getYPos();
    const { h2 } = doc.theme.spacing.heading;
    expect(doc.getYPos() - before).toBeCloseTo(h2.before - 5 + line(doc, 'h2') + h2.after, 6);
  });

  it.each(BLOCKS.filter(([name]) => name !== 'heading'))('%s leaves theme.spacing.block by default', (_name, draw) => {
    const doc = spacedDoc({ block: 7 });
    doc.paragraph('Intro');
    draw(doc);
    expect(doc.getYPos() - doc.contentBottom()).toBeCloseTo(7, 6);
  });
});

describe('block defaults', () => {
  it.each([
    ['separator', SPACING.large],
    ['logo', LOGO.spaceAfter],
    ['headerColumns', HEADER_COLUMNS.spaceAfter],
  ] as const)('%s leaves its own default space, whatever theme.spacing.block', (name, space) => {
    const doc = spacedDoc({ block: 7 });
    doc.paragraph('Intro');
    OWN_DEFAULT.find(([own]) => own === name)![1](doc);
    expect(doc.getYPos() - doc.contentBottom()).toBeCloseTo(space, 6);
  });

  it('leaves the block space between and under several paragraphs', () => {
    const doc = makeDoc();
    const { block } = doc.theme.spacing;
    const start = doc.getYPos();
    doc.paragraphs(['One.', 'Two.']);
    expect(doc.getYPos() - start).toBeCloseTo(2 * line(doc, 'body') + 2 * block, 6);
  });

  it('ends paragraphs with spaceAfter when the last text is empty', () => {
    const doc = makeDoc();
    const start = doc.getYPos();
    doc.paragraphs(['One.', ''], { spaceAfter: 20, itemSpacing: 4 });
    expect(doc.getYPos() - start).toBeCloseTo(line(doc, 'body') + 20, 6);
  });

  it('separates rich paragraphs by the block space', () => {
    const doc = makeDoc();
    const { block } = doc.theme.spacing;
    const start = doc.getYPos();
    doc.richText('One.\n\nTwo.', { spaceAfter: 0 });
    expect(doc.getYPos() - start).toBeCloseTo(2 * line(doc, 'body') + block, 6);
  });

  it('gives every text level the block space', () => {
    const doc = makeDoc();
    const start = doc.getYPos();
    doc.paragraph('Caption.', { level: 'caption' });
    expect(doc.getYPos() - start).toBeCloseTo(line(doc, 'caption') + doc.theme.spacing.block, 6);
  });
});

describe('keepTogether', () => {
  it('keeps a block that fits where it stands, whatever the space under it', () => {
    const doc = makeDoc();
    doc.paragraph('Intro');
    // Two lines fit with 1 mm to spare; the block space under them does not.
    doc.setYPos(doc.pageHeight - doc.margins.bottom - 2 * line(doc, 'body') - 1);
    doc.keepTogether(() => doc.paragraph('One.\nTwo.'));
    expect(doc.doc.getNumberOfPages()).toBe(1);
  });

  it('measures from the space the block above left, as the real pass draws', () => {
    const doc = makeDoc();
    const { h2 } = doc.theme.spacing.heading;
    const limit = doc.pageHeight - doc.margins.bottom;
    // A block whose space under it covers the heading's space above: the heading fits only because they collapse.
    doc.endBlock(limit - line(doc, 'h2') - h2.after - 1 - h2.before, h2.before);
    doc.keepTogether(() => doc.heading('Section', { level: 'h2', keepWithNext: false }));
    expect(doc.doc.getNumberOfPages()).toBe(1);
    expect(lastEntryPage(doc)).toBe(1);
  });
});

/** What a block may change: the position, the space left above it, the pages and their content. */
const state = (doc: PDFDocument) => ({
  y: doc.peekYPos(),
  bottom: doc.contentBottom(),
  pages: doc.doc.getNumberOfPages(),
  stream: pageStream(doc, currentPage(doc)),
});

describe('a block with nothing to draw', () => {
  const EMPTY: BlockCase[] = [
    ['paragraph', (doc) => doc.paragraph('')],
    ['paragraphs', (doc) => doc.paragraphs([])],
    ['paragraphs of empty texts', (doc) => doc.paragraphs(['', ''])],
    ['richText', (doc) => doc.richText('')],
    ['richBlocks', (doc) => doc.richBlocks([])],
    ['bulletList', (doc) => doc.bulletList([])],
    ['numberedList', (doc) => doc.numberedList([])],
    ['iconList', (doc) => doc.iconList([], { icon: PNG })],
    ['fields', (doc) => doc.fields([])],
    ['fieldRows', (doc) => doc.fieldRows([])],
    ['fieldRows of empty rows', (doc) => doc.fieldRows([[], []])],
    ['declarationsBox', (doc) => doc.declarationsBox([])],
    ['addressBlock', (doc) => doc.addressBlock([])],
    ['signatureZone', (doc) => doc.signatureZone([])],
    ['signatureZone with a caption', (doc) => doc.signatureZone([], { caption: 'Paris, 1 March' })],
    ['donutChart', (doc) => doc.donutChart([])],
    [
      'donutChart without a drawable slice',
      (doc) =>
        doc.donutChart([
          { label: 'A', value: 0 },
          { label: 'B', value: Number.NaN },
        ]),
    ],
    ['donutChart with a blank empty text', (doc) => doc.donutChart([], { emptyText: ' ' })],
    ['stackedBar', (doc) => doc.stackedBar([])],
    ['stackedBar without a drawable slice', (doc) => doc.stackedBar([{ label: 'A', value: -1 }])],
    ['columnChart', (doc) => doc.columnChart([])],
    ['lineChart without two points', (doc) => doc.lineChart({ xs: [1], lines: [{ label: 'A', values: [1] }] })],
    [
      'lineChart without a value above zero',
      (doc) => doc.lineChart({ xs: [1, 2], lines: [{ label: 'A', values: [0, 0] }] }),
    ],
    ['columns', (doc) => doc.columns([])],
    ['headerColumns', (doc) => doc.headerColumns([])],
    ['columns whose callbacks draw nothing', (doc) => doc.columns([() => {}, () => {}])],
    ['closingNote', (doc) => doc.closingNote('')],
    // A table without rows still draws its head or its foot.
    [
      'table without rows, head nor foot',
      (doc) => doc.table([], { columns: [{ header: 'A', key: 'a' }], showHead: 'never' }),
    ],
  ];

  it.each(EMPTY)('%s leaves the position and the space under the block above alone', (_, draw) => {
    const doc = makeDoc();
    doc.paragraph('Intro', { spaceAfter: 3 });
    const before = state(doc);
    draw(doc);
    expect(state(doc)).toEqual(before);
    // The next block still sees the space the paragraph left: the larger one wins, they do not add up.
    doc.separator({ spaceBefore: 5 });
    expect(doc.contentBottom() - before.bottom).toBeCloseTo(5, 6);
  });

  it.each(EMPTY)('%s adds nothing at the top of a page', (_, draw) => {
    const doc = makeDoc();
    const before = state(doc);
    draw(doc);
    expect(state(doc)).toEqual(before);
    expect(doc.atPageTop()).toBe(true);
  });

  // Callbacks may draw anything: the columns place the waiting heading before they run them.
  it.each(EMPTY.filter(([name]) => name !== 'columns whose callbacks draw nothing'))(
    '%s leaves a waiting heading waiting',
    (_, draw) => {
      const doc = makeDoc();
      doc.paragraph('Intro');
      const y = doc.peekYPos();
      doc.heading('Section', { level: 'h2' });
      draw(doc);
      expect(doc.peekYPos()).toBe(y);
      expect(doc.pageRefs.tocEntries).toHaveLength(0);
    },
  );

  it('measures 0', () => {
    const doc = makeDoc();
    expect(computeParagraphHeight(doc, '')).toBe(0);
    expect(computeRichTextHeight(doc, '')).toBe(0);
    expect(computeRichBlocksHeight(doc, [])).toBe(0);
    expect(computeDeclarationsBoxHeight(doc, [])).toBe(0);
    // An intro alone is something to draw.
    expect(computeDeclarationsBoxHeight(doc, [], { intro: 'Only an intro.' })).toBeGreaterThan(0);
    expect(computeSignatureZoneHeight(doc, [])).toBe(0);
    expect(computeSignatureZoneHeight(doc, [], { caption: 'Paris, 1 March' })).toBe(0);
  });
});
