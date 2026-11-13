import type { jsPDF } from 'jspdf';

import { InvalidOptionError, checkedChoice, checkedObjects, checkedText, describe } from '../core/errors';
import { bytesToBase64 } from '../utils/base64';
import type { FontSource, FontStyle } from './types';

const FONT_TYPES = ['base64', 'binary'] as const satisfies readonly FontSource['type'][];
const FONT_STYLES = ['normal', 'bold', 'italic', 'bolditalic'] as const satisfies readonly FontStyle[];

/**
 * Throws an `InvalidOptionError` for a `fonts` option that is no array of font sources: each one an object with a
 * known `type` and `style`, a `family` and a `fileName`, and its `data` (a string, or a `Uint8Array` for `binary`).
 */
export function checkFontSources(fonts: readonly FontSource[]): void {
  checkedObjects('fonts', fonts, (font, index) => {
    const what = `fonts[${index}]`;
    const type = checkedChoice(`${what} type`, font.type, FONT_TYPES);
    checkedText(`${what} family`, font.family);
    checkedChoice(`${what} style`, font.style, FONT_STYLES);
    checkedText(`${what} fileName`, font.fileName);
    if (type === 'base64') checkedText(`${what} data`, font.data);
    else if (!(font.data instanceof Uint8Array)) {
      throw new InvalidOptionError(`Invalid ${what} data: ${describe(font.data)} — must be a Uint8Array`);
    }
  });
}

export function registerFonts(doc: jsPDF, fonts: FontSource[]): void {
  for (const font of fonts) {
    const base64 = font.type === 'binary' ? bytesToBase64(font.data) : font.data;
    doc.addFileToVFS(font.fileName, base64);
    doc.addFont(font.fileName, font.family, font.style, undefined, 'Identity-H');
  }
}
