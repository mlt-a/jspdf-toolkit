import type { FontSource, FontStyle } from './types';

/** Options of the `loadFontFrom*` functions. */
export interface LoadFontOptions {
  /** Family name the theme refers to, such as `theme.typography.fontFamily`. */
  family: string;
  /** Face this file provides. Defaults to `normal`. */
  style?: FontStyle;
}

// jsPDF keys its virtual file system by name: one per face keeps the faces of a family apart.
function fileNameFor(family: string, style: FontStyle): string {
  return `${family.replace(/\s+/g, '')}-${style}.ttf`;
}

/**
 * Wraps base64 TTF data into a `FontSource` for the `fonts` document option.
 *
 * @example
 * ```ts
 * import { PDFDocument, loadFontFromBase64 } from '@mlt-a/jspdf-toolkit';
 *
 * const doc = new PDFDocument({
 *   fonts: [
 *     loadFontFromBase64(base64Ttf, { family: 'Brand' }),
 *     loadFontFromBase64(base64BoldTtf, { family: 'Brand', style: 'bold' }),
 *   ],
 * });
 * ```
 */
export function loadFontFromBase64(data: string, { family, style = 'normal' }: LoadFontOptions): FontSource {
  return { type: 'base64', family, style, data, fileName: fileNameFor(family, style) };
}

/**
 * Wraps TTF bytes into a `FontSource` for the `fonts` document option.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { PDFDocument, loadFontFromBinary } from '@mlt-a/jspdf-toolkit';
 *
 * // Bytes from anywhere: a file, a `fetch` response, an upload.
 * const doc = new PDFDocument({
 *   fonts: [
 *     loadFontFromBinary(readFileSync('./Brand-Regular.ttf'), { family: 'Brand' }),
 *     loadFontFromBinary(readFileSync('./Brand-Bold.ttf'), { family: 'Brand', style: 'bold' }),
 *   ],
 * });
 * ```
 */
export function loadFontFromBinary(data: Uint8Array, { family, style = 'normal' }: LoadFontOptions): FontSource {
  return { type: 'binary', family, style, data, fileName: fileNameFor(family, style) };
}
