import type { jsPDF } from 'jspdf';

import type { FontFallbacks, FontStyle } from './types';

/** Faces declared to fall back on purpose, by lowercase family name: what `resolveFace` takes to stay silent. */
export type ExpectedFaces = ReadonlyMap<string, ReadonlySet<FontStyle>>;

/** The `fontFallbacks` document option, indexed for `resolveFace`: family names lowercased, a family listed twice merged. */
export function expectedFaces(fallbacks: FontFallbacks | undefined): ExpectedFaces {
  const expected = new Map<string, Set<FontStyle>>();
  for (const [family, styles] of Object.entries(fallbacks ?? {})) {
    const key = family.toLowerCase();
    const known = expected.get(key) ?? new Set<FontStyle>();
    for (const style of styles) known.add(style);
    expected.set(key, known);
  }
  return expected;
}

interface FontListCache {
  list: Record<string, string[]> | null;
}

const caches = new WeakMap<jsPDF, FontListCache>();

/**
 * The font list of `doc`, rebuilt only after jsPDF has published `addFont`. Every route that registers a face,
 * `registerFonts` or a direct `doc.addFont`, goes through that event, so a face added later is still seen.
 */
function fontList(doc: jsPDF): Record<string, string[]> {
  let cache = caches.get(doc);
  if (cache === undefined) {
    const created: FontListCache = { list: null };
    doc.internal.events.subscribe('addFont', () => {
      created.list = null;
    });
    caches.set(doc, created);
    cache = created;
  }
  cache.list ??= doc.getFontList();
  return cache.list;
}

function facesOf(doc: jsPDF, family: string): readonly string[] {
  const fonts = fontList(doc);
  return fonts[family] ?? fonts[family.toLowerCase()] ?? [];
}

/** Whether `family` has a registered `style` face, built-in fonts included: what `resolveFace` would not replace. */
export function hasFace(doc: jsPDF, family: string, style: FontStyle): boolean {
  return facesOf(doc, family).includes(style);
}

/**
 * The registered face of `family` closest to `style`: italic falls back to normal, bold italic to bold, bold
 * to normal. jsPDF would otherwise throw on a family without that face, such as Inter without its italic file.
 * `onWarn` receives one message per fallback taken, except for a face `expected` lists for the family (see
 * `fontFallbacks`): that step is taken in silence, and each step is judged on its own face. `italic` listed also
 * covers `bolditalic`; `bold` does not cover it, nor does `bolditalic` cover `bold`.
 */
export function resolveFace(
  doc: jsPDF,
  family: string,
  style: FontStyle,
  onWarn: (message: string) => void,
  expected?: ExpectedFaces,
): FontStyle {
  if (style === 'normal' || hasFace(doc, family, style)) return style;

  const resolved = resolveFace(doc, family, style === 'bolditalic' ? 'bold' : 'normal', onWarn, expected);
  const declared = expected?.get(family.toLowerCase());
  // A family declared without italic lacks the bold italic too: one declaration, not two.
  if (declared?.has(style) || (style === 'bolditalic' && declared?.has('italic'))) return resolved;
  onWarn(
    style === 'italic'
      ? `Font family "${family}" has no italic face: italic text is drawn upright`
      : `Font family "${family}" has no ${style} face: drawn as ${resolved}`,
  );
  return resolved;
}
