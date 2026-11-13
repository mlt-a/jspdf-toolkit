import { AssetLoadError } from '../core/errors';
import { bytesToBase64 } from '../utils/base64';

/** Options of the `loadImageFrom*` functions. */
export interface LoadImageOptions {
  /**
   * Media type of the data URI. Sniffed from the first bytes (PNG, JPEG, GIF, WebP, BMP) when omitted: other data then
   * throws `AssetLoadError`.
   */
  mimeType?: string;
}

function sniffMimeType(head: ArrayLike<number>): string | undefined {
  const at = (i: number) => head[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8) return 'image/jpeg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'image/gif';
  if (at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45) return 'image/webp';
  // jsPDF draws BMP too: "BM", then the two reserved fields, always zero.
  if (at(0) === 0x42 && at(1) === 0x4d && [6, 7, 8, 9].every((i) => at(i) === 0)) return 'image/bmp';
  return undefined;
}

/** The media type given, else the one the first bytes name, else an error that says what to pass. */
function mimeTypeOf(options: LoadImageOptions, head: () => ArrayLike<number>): string {
  if (options.mimeType !== undefined) return options.mimeType;
  const sniffed = sniffMimeType(head());
  if (sniffed === undefined) {
    throw new AssetLoadError(
      'Image type not recognized (PNG, JPEG, GIF, WebP or BMP): pass `mimeType`, e.g. image/png',
    );
  }
  return sniffed;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** `data` without whitespace, when it is base64 that decodes: its alphabet, padding only at the end, whole groups. */
function checkedBase64(data: string): string {
  const compact = data.replace(/\s+/g, '');
  const unpadded = compact.replace(/=+$/, '');
  const whole = compact.endsWith('=') ? compact.length % 4 === 0 : compact.length % 4 !== 1;
  if (unpadded === '' || !BASE64.test(compact) || !whole) {
    throw new AssetLoadError(
      'Image data is not base64: pass the base64 text of an image file, or a data URI (data:image/png;base64,…)',
    );
  }
  return compact;
}

// The media type, and the parameters that may follow it (`;charset=utf-8`), before `;base64,`.
const DATA_URI = /^data:([^;,]+(?:;[^;,]+)*?);base64,(.*)$/s;

/**
 * Wraps base64 image data into a data URI usable by every image option. A base64 data URI is checked and returned.
 * Throws `AssetLoadError` when the data is not base64, or when its type is not recognized and `mimeType` is omitted.
 *
 * @example
 * ```ts
 * import { loadImageFromBase64 } from '@mlt-a/jspdf-toolkit';
 *
 * doc.registerImage('logo', loadImageFromBase64(base64Png)); // type sniffed from the data
 * ```
 */
export function loadImageFromBase64(data: string, options: LoadImageOptions = {}): string {
  if (data.startsWith('data:')) {
    const match = DATA_URI.exec(data);
    if (match === null) {
      throw new AssetLoadError('Image data URI is not base64: expected data:<media type>;base64,<data>');
    }
    return `data:${match[1]};base64,${checkedBase64(match[2])}`;
  }
  const base64 = checkedBase64(data);
  // 16 base64 characters are 12 bytes: enough for every signature sniffed.
  const type = mimeTypeOf(options, () => [...atob(base64.slice(0, 16))].map((c) => c.charCodeAt(0)));
  return `data:${type};base64,${base64}`;
}

/**
 * Encodes image bytes as a data URI usable by every image option. Throws `AssetLoadError` for empty data, or when the
 * type is not recognized and `mimeType` is omitted.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { loadImageFromBinary } from '@mlt-a/jspdf-toolkit';
 *
 * // Bytes from anywhere: a file, a `fetch` response, an upload.
 * const logo = loadImageFromBinary(readFileSync('./logo.png'));
 * doc.logo(logo, { height: 12 });
 * ```
 */
export function loadImageFromBinary(data: Uint8Array, options: LoadImageOptions = {}): string {
  if (data.length === 0) throw new AssetLoadError('Image data is empty: pass the bytes of an image file');
  return `data:${mimeTypeOf(options, () => data)};base64,${bytesToBase64(data)}`;
}
