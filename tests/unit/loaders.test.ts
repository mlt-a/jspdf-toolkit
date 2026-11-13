import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AssetLoadError } from '../../src/core/errors';
import { loadFontFromBase64, loadFontFromBinary } from '../../src/fonts/loader';
import { loadImageFromBase64, loadImageFromBinary } from '../../src/images/loader';
import { loadFontFromPath, loadImageFromPath } from '../../src/node';
import { bytesToBase64 } from '../../src/utils/base64';
import { LOGO_PATH } from './helpers';

const FONT = 'assets/fonts/inter/Inter-Regular.ttf';
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

describe('image loaders', () => {
  const bytes = new Uint8Array(readFileSync(LOGO_PATH));

  it('give the same data URI from base64, binary and a path', () => {
    const fromBinary = loadImageFromBinary(bytes);
    expect(fromBinary).toMatch(/^data:image\/png;base64,/);
    expect(loadImageFromBase64(bytesToBase64(bytes))).toBe(fromBinary);
    expect(loadImageFromPath(LOGO_PATH)).toBe(fromBinary);
  });

  it.each([
    ['JPEG', [...JPEG_HEAD], 'image/jpeg'],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0], 'image/png'],
    ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0], 'image/gif'],
    ['BMP', [0x42, 0x4d, 0x3a, 0, 0, 0, 0, 0, 0, 0, 0x36, 0], 'image/bmp'],
    ['WebP', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 'image/webp'],
  ])('sniff %s when no mimeType is given', (_name, head, type) => {
    const data = new Uint8Array(head);
    expect(loadImageFromBinary(data)).toMatch(new RegExp(`^data:${type};base64,`));
    expect(loadImageFromBase64(bytesToBase64(data))).toMatch(new RegExp(`^data:${type};base64,`));
  });

  it.each([
    ['a RIFF file that is not WebP', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]],
    ['data too short to carry a signature', [0xff]],
    ['bytes of no image format', [1, 2, 3]],
  ])('throw for %s without a mimeType, and say to pass one', (_name, head) => {
    const data = new Uint8Array(head);
    expect(() => loadImageFromBinary(data)).toThrow(AssetLoadError);
    expect(() => loadImageFromBinary(data)).toThrow('pass `mimeType`');
    expect(() => loadImageFromBase64(bytesToBase64(data))).toThrow('pass `mimeType`');
    expect(loadImageFromBinary(data, { mimeType: 'image/png' })).toBe(`data:image/png;base64,${bytesToBase64(data)}`);
  });

  it('throw for empty data, whatever the mimeType', () => {
    expect(() => loadImageFromBinary(new Uint8Array(), { mimeType: 'image/png' })).toThrow(AssetLoadError);
    expect(() => loadImageFromBinary(new Uint8Array(), { mimeType: 'image/png' })).toThrow('Image data is empty');
    expect(() => loadImageFromBase64('', { mimeType: 'image/png' })).toThrow('not base64');
  });

  it.each([
    ['characters outside the alphabet', 'not base64 at all!'],
    ['padding alone', '=='],
    ['padding in the middle', 'AA==AAAA'],
    ['a length one past a whole group', 'AAAAA'],
    ['padding on an incomplete group', 'AAA=A='],
  ])('throw for base64 that does not decode: %s', (_name, data) => {
    expect(() => loadImageFromBase64(data, { mimeType: 'image/png' })).toThrow(AssetLoadError);
    expect(() => loadImageFromBase64(data, { mimeType: 'image/png' })).toThrow('pass the base64 text of an image');
  });

  it('accept base64 without its padding, and drop the line breaks of wrapped base64', () => {
    const base64 = bytesToBase64(JPEG_HEAD.slice(0, 4));
    expect(loadImageFromBase64(base64.replace(/=+$/, ''))).toBe(`data:image/jpeg;base64,${base64.replace(/=+$/, '')}`);
    const wrapped = bytesToBase64(bytes).replace(/.{76}/g, '$&\n');
    expect(loadImageFromBase64(wrapped)).toBe(loadImageFromBinary(bytes));
  });

  it('take an explicit mimeType over the sniffed one', () => {
    expect(loadImageFromBinary(bytes, { mimeType: 'image/webp' })).toMatch(/^data:image\/webp;/);
    expect(loadImageFromBase64(bytesToBase64(bytes), { mimeType: 'image/gif' })).toMatch(/^data:image\/gif;/);
    expect(loadImageFromPath(LOGO_PATH, { mimeType: 'image/jpeg' })).toMatch(/^data:image\/jpeg;/);
  });

  it('return a base64 data URI as is, its type kept', () => {
    expect(loadImageFromBase64('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
  });

  it('keep the parameters of a base64 data URI', () => {
    const uri = 'data:image/png;charset=utf-8;base64,AAAA';
    expect(loadImageFromBase64(uri)).toBe(uri);
  });

  it.each([
    ['a data URI that is not base64', 'data:image/svg+xml,<svg/>', 'data:<media type>;base64'],
    ['a data URI without a media type', 'data:;base64,AAAA', 'data:<media type>;base64'],
    ['a base64 data URI whose data does not decode', 'data:image/png;base64,@@@@', 'not base64'],
  ])('throw for %s', (_name, data, message) => {
    expect(() => loadImageFromBase64(data)).toThrow(AssetLoadError);
    expect(() => loadImageFromBase64(data)).toThrow(message);
  });

  it('throw AssetLoadError for an unreadable path', () => {
    expect(() => loadImageFromPath('assets/missing.png')).toThrow(AssetLoadError);
  });
});

describe('font loaders', () => {
  const bytes = new Uint8Array(readFileSync(FONT));

  it('build the same face from base64, binary and a path', () => {
    const options = { family: 'Inter Display', style: 'bold' } as const;
    const fromBinary = loadFontFromBinary(bytes, options);
    expect(fromBinary).toMatchObject({ type: 'binary', family: 'Inter Display', style: 'bold' });
    expect(fromBinary.fileName).toBe('InterDisplay-bold.ttf');

    const fromBase64 = loadFontFromBase64(bytesToBase64(bytes), options);
    expect(fromBase64).toMatchObject({ type: 'base64', family: 'Inter Display', style: 'bold' });
    expect(fromBase64.fileName).toBe(fromBinary.fileName);

    const fromPath = loadFontFromPath(FONT, options);
    expect(fromPath.type).toBe('binary');
    expect(fromPath.fileName).toBe(fromBinary.fileName);
    expect(Buffer.compare(Buffer.from(fromPath.data as Uint8Array), Buffer.from(bytes))).toBe(0);
  });

  it('default to the normal face', () => {
    expect(loadFontFromBinary(bytes, { family: 'Inter' }).style).toBe('normal');
    expect(loadFontFromPath(FONT, { family: 'Inter' }).style).toBe('normal');
  });

  it('throw AssetLoadError for an unreadable path', () => {
    expect(() => loadFontFromPath('assets/missing.ttf', { family: 'Inter' })).toThrow(AssetLoadError);
  });
});

describe('loaders from a path', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'jspdf-toolkit-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('read an absolute path as they read a relative one', () => {
    const copy = join(dir, 'logo.png');
    copyFileSync(LOGO_PATH, copy);
    expect(loadImageFromPath(copy)).toBe(loadImageFromPath(LOGO_PATH));
    const font = join(dir, 'Inter.ttf');
    copyFileSync(FONT, font);
    expect(loadFontFromPath(font, { family: 'Inter' }).data).toEqual(loadFontFromPath(FONT, { family: 'Inter' }).data);
  });

  it('throw for an empty image file or one of a type not recognized, naming it; give an empty font as empty data', () => {
    const empty = join(dir, 'empty.png');
    writeFileSync(empty, '');
    const error = catchError(() => loadImageFromPath(empty, { mimeType: 'image/png' }));
    expect(error).toBeInstanceOf(AssetLoadError);
    expect(error.message).toBe(
      `Failed to load image file "${empty}": Image data is empty: pass the bytes of an image file`,
    );
    expect(error.cause).toBeInstanceOf(AssetLoadError);
    const text = join(dir, 'notes.png');
    writeFileSync(text, 'plain text');
    expect(() => loadImageFromPath(text)).toThrow(`image file "${text}": Image type not recognized`);
    expect(loadImageFromPath(text, { mimeType: 'image/png' })).toMatch(/^data:image\/png;base64,/);
    expect(loadFontFromPath(empty, { family: 'Empty' }).data).toHaveLength(0);
  });

  it('name the file and keep the cause for a missing image', () => {
    const missing = join(dir, 'missing.png');
    const error = catchError(() => loadImageFromPath(missing));
    expect(error).toBeInstanceOf(AssetLoadError);
    expect(error.message).toContain(`image file "${missing}"`);
    expect(error.message).toContain('ENOENT');
    expect((error.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('name the family and the face for a missing font', () => {
    const missing = join(dir, 'missing.ttf');
    const error = catchError(() => loadFontFromPath(missing, { family: 'Brand', style: 'bold' }));
    expect(error).toBeInstanceOf(AssetLoadError);
    expect(error.message).toContain(`font file "${missing}" (Brand/bold)`);
  });

  it('throw for a directory', () => {
    const folder = join(dir, 'folder');
    mkdirSync(folder);
    expect((catchError(() => loadImageFromPath(folder)).cause as NodeJS.ErrnoException).code).toBe('EISDIR');
    expect(() => loadFontFromPath(folder, { family: 'Brand' })).toThrow(AssetLoadError);
  });
});

function catchError(call: () => unknown): Error {
  try {
    call();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the call to throw');
}
