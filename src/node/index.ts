// The only module allowed to touch the file system. It exports functions and types only:
// re-exporting PDFDocument here would duplicate the class across entry points.
import { readFileSync } from 'node:fs';

import { AssetLoadError } from '../core/errors';
import { loadFontFromBinary } from '../fonts/loader';
import type { LoadFontOptions } from '../fonts/loader';
import type { FontSource, FontStyle } from '../fonts/types';
import { loadImageFromBinary } from '../images/loader';
import type { LoadImageOptions } from '../images/loader';
import { errorMessage } from '../utils/errors';

export type { FontSource, FontStyle, LoadFontOptions, LoadImageOptions };

function readFile(filePath: string, describe: string): Uint8Array {
  try {
    return readFileSync(filePath);
  } catch (error) {
    throw new AssetLoadError(`Failed to read ${describe}: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Reads an image file and returns a data URI usable by every image option. `mimeType` is sniffed from the file when
 * omitted. Throws `AssetLoadError` when the file cannot be read, is empty, or is of a type not recognized while
 * `mimeType` is omitted.
 *
 * @example
 * ```ts
 * import { loadImageFromPath } from '@mlt-a/jspdf-toolkit/node';
 *
 * doc.registerImage('logo', loadImageFromPath('./logo.png'));
 * ```
 */
export function loadImageFromPath(filePath: string, options: LoadImageOptions = {}): string {
  const describe = `image file "${filePath}"`;
  const data = readFile(filePath, describe);
  try {
    return loadImageFromBinary(data, options);
  } catch (error) {
    throw new AssetLoadError(`Failed to load ${describe}: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Reads a TTF file and returns a `FontSource` for the `fonts` document option. Throws `AssetLoadError` when the file
 * cannot be read.
 *
 * @example
 * ```ts
 * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
 * import { loadFontFromPath } from '@mlt-a/jspdf-toolkit/node';
 *
 * const doc = new PDFDocument({
 *   fonts: [
 *     loadFontFromPath('./Brand-Regular.ttf', { family: 'Brand' }),
 *     loadFontFromPath('./Brand-Bold.ttf', { family: 'Brand', style: 'bold' }),
 *   ],
 * });
 * ```
 */
export function loadFontFromPath(filePath: string, options: LoadFontOptions): FontSource {
  const { family, style = 'normal' } = options;
  return loadFontFromBinary(readFile(filePath, `font file "${filePath}" (${family}/${style})`), options);
}
