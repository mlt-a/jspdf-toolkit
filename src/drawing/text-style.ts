import type { jsPDF } from 'jspdf';

import { FONT_ROLES } from '../core/constants';
import type { FontRole } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { POSITIVE, checkedBoolean, checkedChoice, checkedNumber } from '../core/errors';
import { resolveFace } from '../fonts/resolve';
import type { FontStyle } from '../fonts/types';
import type { Typography } from '../theme/types';

export type { FontRole };

const ROLE_FAMILY = { body: 'fontFamily', title: 'titleFontFamily', label: 'labelFontFamily' } as const;

export function fontFamilyFor(ctx: DrawingContext, role: FontRole): string {
  return ctx.theme.typography[ROLE_FAMILY[role]];
}

const WEIGHTS = ['regular', 'bold'] as const satisfies readonly (keyof Typography['weights'])[];

/**
 * Sets the font of a role at a weight and size (pt), for custom drawing code: the face is matched to the registered
 * ones through `typography.weights`, and a missing face falls back to the closest one with a warning. Throws an
 * `InvalidOptionError` for an unknown role or weight, a size that is not a finite number above 0, or an `italic` that
 * is no boolean.
 *
 * @example
 * ```ts
 * import { setFont } from '@mlt-a/jspdf-toolkit';
 *
 * setFont(doc, 'title', 'bold', 18);
 * doc.doc.text('Drawn with the title family', doc.margins.left, doc.getYPos() + 8);
 * ```
 */
export function setFont(
  ctx: DrawingContext,
  role: FontRole,
  weight: keyof Typography['weights'],
  sizePt: number,
  italic = false,
): void {
  const family = fontFamilyFor(ctx, checkedChoice('setFont role', role, FONT_ROLES));
  const bold = checkedChoice('setFont weight', weight, WEIGHTS) === 'bold';
  const size = checkedNumber('setFont size (pt)', sizePt, POSITIVE);
  const face = fontFace(ctx.theme.typography, bold, checkedBoolean('setFont italic', italic));
  ctx.doc.setFont(family, resolveFontStyle(ctx, family, face));
  ctx.doc.setFontSize(size);
}

/** The registered face closest to `style` (see `resolveFace`); fallback warnings go to the document. */
export function resolveFontStyle(ctx: DrawingContext, family: string, style: FontStyle): FontStyle {
  return resolveFace(ctx.doc, family, style, (message) => ctx.addWarning(message));
}

/** A fully resolved text style: family, jsPDF face, size (pt), color and letter spacing. */
export interface TextStyle {
  family: string;
  fontStyle: FontStyle;
  size: number;
  color: string;
  /** Extra space (mm) between letters. Measured by `trackedWidth`: pass it to `wrap` and `text` too. */
  charSpace?: number;
}

export function applyFont(doc: jsPDF, style: TextStyle): void {
  doc.setFont(style.family, style.fontStyle);
  doc.setFontSize(style.size);
}

/** Font and text color of `style`. */
export function applyTextStyle(doc: jsPDF, style: TextStyle): void {
  applyFont(doc, style);
  doc.setTextColor(style.color);
}

export function sameFont(a: TextStyle, b: TextStyle): boolean {
  return a.family === b.family && a.fontStyle === b.fontStyle && a.size === b.size;
}

export function sameTextStyle(a: TextStyle, b: TextStyle): boolean {
  return sameFont(a, b) && a.color === b.color && (a.charSpace ?? 0) === (b.charSpace ?? 0);
}

/** jsPDF face of a weight (through `typography.weights`) and an italic style on top of it. */
export function fontFace(typography: Typography, bold: boolean, italic: boolean): FontStyle {
  const weight = bold ? typography.weights.bold : typography.weights.regular;
  if (!italic) return weight;
  return weight === 'bold' ? 'bolditalic' : 'italic';
}
