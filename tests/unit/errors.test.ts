import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PDFDocument } from '../../src/core/document';
import {
  InvalidColorError,
  InvalidOptionError,
  POSITIVE,
  PdfToolkitError,
  checkedArray,
  checkedChoice,
  checkedFunction,
  checkedLeftOut,
  checkedNumber,
  checkedObject,
  checkedObjects,
  checkedText,
  checkedTexts,
  optionalText,
  unknownOption,
} from '../../src/core/errors';
import { drawImage } from '../../src/drawing/image-helpers';
import { createTheme } from '../../src/theme/defaults';
import { errorMessage } from '../../src/utils/errors';
import { makeDoc } from './helpers';

describe('error hierarchy', () => {
  it('names the subclass', () => {
    const error = new InvalidOptionError('x');
    expect(error).toBeInstanceOf(PdfToolkitError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidOptionError');
  });

  it('throws InvalidColorError, with the token, for a bad theme color', () => {
    let caught: unknown;
    try {
      createTheme({ colors: { primary: '#3572B8', text: 'red' } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidColorError);
    expect(caught).toBeInstanceOf(PdfToolkitError);
    expect((caught as InvalidColorError).token).toBe('text');
  });

  it('throws InvalidOptionError for invalid document options', () => {
    expect(() => new PDFDocument({ margins: { bottom: -1 } })).toThrow(InvalidOptionError);
    expect(() => new PDFDocument({ measure: 500 })).toThrow(InvalidOptionError);
  });

  it('throws InvalidOptionError for a font family that is not registered', () => {
    const theme = createTheme({ typography: { fontFamily: 'Nope' } });
    expect(() => new PDFDocument({ theme })).toThrow(InvalidOptionError);
  });

  it('throws InvalidOptionError for an unknown cover layout', () => {
    const doc = new PDFDocument();
    expect(() => doc.cover('Title', { variant: 'image', layout: 'missing' })).toThrow(InvalidOptionError);
  });

  it('throws on a drawImage without size, but only warns on an unreadable image', () => {
    const doc = new PDFDocument();
    // @ts-expect-error neither width nor height: not allowed by the type
    expect(() => drawImage(doc, 'nope', { x: 0, y: 0 })).toThrow(InvalidOptionError);

    drawImage(doc, 'nope', { x: 0, y: 0, width: 10 });
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toMatch(/^Failed to draw image: /);
  });
});

describe('unknownOption', () => {
  it.each([
    ['lists what is available', 'format', 'tabloid', ['A4', 'A5'], `Unknown format "tabloid" (available: 'A4', 'A5')`],
    ['says none when nothing is available', 'layout', 'x', [], 'Unknown layout "x" (available: none)'],
  ])('names the option and %s', (_, what, value, available, message) => {
    const error = unknownOption(what, value, available);
    expect(error).toBeInstanceOf(InvalidOptionError);
    expect(error.message).toBe(message);
  });
});

describe('checkedNumber', () => {
  it.each([
    ['any finite number', 0, {}, -12.5],
    ['a positive one', 0.001, POSITIVE, 3],
    ['a bounded one', 0, { min: 0, exclusiveMax: 1 }, 0.99],
    ['a whole one', 2, { integer: true, min: 2 }, 7],
    ['one at most a maximum', 150, { max: 150 }, -3],
  ])('returns %s that keeps to its bounds', (_, low, bounds, other) => {
    expect(checkedNumber('x', low, bounds)).toBe(low);
    expect(checkedNumber('x', other, bounds)).toBe(other);
  });

  it.each([
    ['NaN', Number.NaN, {}, 'Invalid size: NaN — must be a finite number'],
    ['an infinity', Number.POSITIVE_INFINITY, {}, 'Invalid size: Infinity — must be a finite number'],
    ['a text', '3', POSITIVE, 'Invalid size: 3 — must be a finite number, greater than 0'],
    ['nothing', undefined, POSITIVE, 'Invalid size: undefined — must be a finite number, greater than 0'],
    ['0 above 0', 0, POSITIVE, 'Invalid size: 0 — must be a finite number, greater than 0'],
    ['a value under the minimum', -1, { min: 0 }, 'Invalid size: -1 — must be a finite number, at least 0'],
    [
      'the excluded maximum',
      1,
      { min: 0, exclusiveMax: 1 },
      'Invalid size: 1 — must be a finite number, at least 0 and less than 1',
    ],
    ['a value over the maximum', 9, { max: 8 }, 'Invalid size: 9 — must be a finite number, at most 8'],
    [
      'a fraction for a whole number',
      2.5,
      { integer: true, min: 1 },
      'Invalid size: 2.5 — must be a whole number, at least 1',
    ],
    [
      'a value that has an alternative',
      -2,
      { ...POSITIVE, or: "'auto'" },
      "Invalid size: -2 — must be a finite number, greater than 0 or 'auto'",
    ],
  ])('throws an InvalidOptionError for %s, saying what is expected', (_, value, bounds, message) => {
    expect(() => checkedNumber('size', value, bounds)).toThrow(InvalidOptionError);
    expect(() => checkedNumber('size', value, bounds)).toThrow(message);
  });

  it.each([
    ['a page format', () => makeDoc({ format: [100, -5] }), 'Invalid side of format [100, -5] (mm): -5'],
    [
      'a theme size',
      () => makeDoc({ theme: { ...makeDoc().theme, spacing: { ...makeDoc().theme.spacing, block: -1 } } }),
      'Invalid theme.spacing.block (mm): -1',
    ],
    [
      'a margin',
      () => makeDoc({ margins: { left: Number.NaN } }),
      'Invalid margins.left (mm): NaN — must be a finite number, at least 0',
    ],
    [
      'a measure',
      () => makeDoc({ format: 'A5', measure: 160 }),
      /Invalid measure \(mm\): 160 — must be a finite number, greater than 0 and at most/,
    ],
    [
      'a column width',
      () => makeDoc().table([{ a: 1 }], { columns: [{ key: 'a', header: 'A', width: 0 }] }),
      /Invalid width for table column "a": 0 — .* or 'auto'/,
    ],
  ])('checks %s in the same words', (_, run, message) => {
    expect(run).toThrow(InvalidOptionError);
    expect(run).toThrow(message);
  });
});

describe('checkedText, optionalText and checkedArray', () => {
  it('return what they are given when it is of the right kind', () => {
    expect(checkedText('label', 'A')).toBe('A');
    expect(optionalText('label', undefined)).toBeUndefined();
    expect(optionalText('label', '')).toBe('');
    const values = [1, 2];
    expect(checkedArray('values', values)).toBe(values);
  });

  it.each([
    ['checkedText', () => checkedText('label', 4), 'Invalid label: 4 — must be a string'],
    ['optionalText', () => optionalText('label', null), 'Invalid label: null — must be a string'],
    ['checkedArray', () => checkedArray('values', 'abc' as never), 'Invalid values: abc — must be an array'],
  ])('%s throws an InvalidOptionError that names the option', (_, run, message) => {
    expect(run).toThrow(InvalidOptionError);
    expect(run).toThrow(message);
  });
});

describe('the validators of content structures', () => {
  const noPrototype = Object.create(null) as object;

  it('return what they are given when it is of the right kind', () => {
    const object = { a: 1 };
    const items = [object, { b: 2 }];
    expect(checkedObject('item', object)).toBe(object);
    expect(checkedObject('item', object, 'a string')).toBe(object);
    expect(checkedObject('item', noPrototype)).toBe(noPrototype);
    expect(checkedObjects('items', items)).toBe(items);
    const texts = ['a', ''];
    expect(checkedTexts('texts', texts)).toBe(texts);
    expect(checkedChoice('role', 'title', ['title', 'subtitle'])).toBe('title');
    expect(checkedFunction('draw', Math.max)).toBe(Math.max);
    expect(() => checkedLeftOut('box', { a: undefined }, ['a', 'b'])).not.toThrow();
  });

  it('checkedObjects lets `each` read every item, with its index', () => {
    const seen: [string, number][] = [];
    checkedObjects('items', [{ a: 'x' }, { a: 'y' }], (item, index) => seen.push([item.a, index]));
    expect(seen).toEqual([
      ['x', 0],
      ['y', 1],
    ]);
  });

  it.each([
    ['null', () => checkedObject('item', null as never), 'Invalid item: null — must be an object'],
    ['an array', () => checkedObject('item', [] as never), 'Invalid item: an array — must be an object'],
    [
      'a number',
      () => checkedObject('item', 5 as never, 'a string'),
      'Invalid item: 5 — must be an object or a string',
    ],
    ['an array of numbers', () => checkedObjects('items', [{}, 5] as never), 'Invalid items[1]: 5 — must be an object'],
    ['no array', () => checkedObjects('items', {} as never), 'Invalid items: an object — must be an array'],
    [
      'an item that `each` refuses',
      () =>
        checkedObjects('items', [{ a: 1 }], (item, index) => checkedText(() => `items[${index}] a`, item.a as never)),
      'Invalid items[0] a: 1 — must be a string',
    ],
    ['texts', () => checkedTexts('texts', ['a', 5] as never), 'Invalid texts[1]: 5 — must be a string'],
    ['no texts', () => checkedTexts('texts', 'a' as never), 'Invalid texts: a — must be an array'],
    [
      'an unknown choice',
      () => checkedChoice('role', 'footer', ['title', 'subtitle']),
      "Unknown role \"footer\" (available: 'title', 'subtitle')",
    ],
    ['a function that is none', () => checkedFunction('draw', 5 as never), 'Invalid draw: 5 — must be a function'],
    [
      'an option left in',
      () => checkedLeftOut('box', { a: 1, b: () => 1 }, ['c', 'b']),
      'Invalid box b: a function — must be left out, it is not an option of this variant',
    ],
    [
      'a value that cannot print',
      () => checkedText('label', noPrototype),
      'Invalid label: an object — must be a string',
    ],
  ])('throw an InvalidOptionError for %s', (_, run, message) => {
    expect(run).toThrow(InvalidOptionError);
    expect(run).toThrow(message);
  });
});

describe('errorMessage', () => {
  it('gives the message of an error, and the text of anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ code: 7 })).toBe('[object Object]');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});

describe('the messages of the library', () => {
  /** The source files of the library, examples left out: they print messages of their own. */
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return path.endsWith('examples') ? [] : sources(path);
      return path.endsWith('.ts') ? [path] : [];
    });

  it('never end with a period: a message is one line, read in a list of warnings or after an error name', () => {
    const offenders = sources('src').flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => ({ line: line.trim(), at: `${path}:${index + 1}` }))
        // Comments end their sentences; code does not.
        .filter(({ line }) => !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'))
        .filter(({ line }) => /[\p{L}\p{N})\]>]\.['"`]/u.test(line))
        .map(({ at, line }) => `${at}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it('end without a period, the color error included', () => {
    expect(new InvalidColorError('#zz').message).toBe(
      'Invalid color "#zz": expected a palette token or a #RGB/#RRGGBB hex color',
    );
  });
});
