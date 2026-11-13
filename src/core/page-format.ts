import type { jsPDFOptions } from 'jspdf';

import { InvalidOptionError, POSITIVE, checkedNumber, unknownOption } from './errors';

/** A page format: a standard size, or `[width, height]` in mm for a custom one. */
export type PageFormat = 'A3' | 'A4' | 'A5' | 'letter' | 'legal' | [width: number, height: number];

/** The standard sizes jsPDF knows by name. */
const NAMED_FORMATS: readonly Extract<PageFormat, string>[] = ['A3', 'A4', 'A5', 'letter', 'legal'];

const ORIENTATIONS = ['portrait', 'landscape'] as const;

type Orientation = (typeof ORIENTATIONS)[number];

/** The size of `format`, checked: a name exactly as `PageFormat` writes it, or two finite sides above 0. */
function checkedFormat(format: PageFormat): PageFormat {
  if (Array.isArray(format)) {
    // JavaScript callers may pass any array.
    const size: readonly unknown[] = format;
    const written = `[${size.map(String).join(', ')}]`;
    if (size.length !== 2) {
      throw new InvalidOptionError(`Invalid format: ${written} — expected [width, height] in mm`);
    }
    for (const side of size) checkedNumber(`side of format ${written} (mm)`, side, POSITIVE);
    return format;
  }
  if (!NAMED_FORMATS.includes(format)) throw unknownOption('format', format, NAMED_FORMATS);
  return format;
}

/**
 * What jsPDF is built with for a `format` and an `orientation`. Throws `InvalidOptionError` for a size that is not
 * a standard name or a `[width, height]` of two finite positive numbers, and for an orientation that is neither.
 * A custom size is taken as given: without an `orientation`, `[300, 200]` is a landscape page; with one, the page
 * turns to match.
 */
export function resolvePageFormat(
  format: PageFormat = 'A4',
  orientation?: Orientation,
): Required<Pick<jsPDFOptions, 'format' | 'orientation'>> {
  if (orientation !== undefined && !ORIENTATIONS.includes(orientation)) {
    throw unknownOption('orientation', orientation, ORIENTATIONS);
  }
  const size = checkedFormat(format);
  const shape = Array.isArray(size) && size[0] > size[1] ? 'landscape' : 'portrait';
  return { format: size, orientation: orientation ?? shape };
}
