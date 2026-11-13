/*! Inter, SIL OFL 1.1, see assets/fonts/inter/OFL.txt */
import { loadFontFromBase64 } from '../loader';
import type { FontSource } from '../types';
import bold from './generated/bold';
import italic from './generated/italic';
import regular from './generated/regular';

/** Family name the Inter faces are registered under. */
export const INTER_FAMILY = 'Inter';

/**
 * Inter regular, bold and italic, ready for the `fonts` document option.
 *
 * @example
 * ```ts
 * import { PDFDocument } from '@mlt-a/jspdf-toolkit';
 * import { interFonts } from '@mlt-a/jspdf-toolkit/fonts/inter';
 *
 * const doc = new PDFDocument({ fonts: interFonts }); // Inter becomes the default family
 * ```
 */
export const interFonts: FontSource[] = [
  loadFontFromBase64(regular, { family: INTER_FAMILY }),
  loadFontFromBase64(bold, { family: INTER_FAMILY, style: 'bold' }),
  loadFontFromBase64(italic, { family: INTER_FAMILY, style: 'italic' }),
];
