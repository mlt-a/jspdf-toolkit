import type { jsPDF } from 'jspdf';

import type { FontStyle } from './types';

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

/**
 * The registered face of `family` closest to `style`: italic falls back to normal, bold italic to bold, bold
 * to normal. jsPDF would otherwise throw on a family without that face, such as Inter without its italic file.
 * `onWarn` receives one message per fallback taken.
 */
export function resolveFace(
  doc: jsPDF,
  family: string,
  style: FontStyle,
  onWarn: (message: string) => void,
): FontStyle {
  if (style === 'normal') return style;
  const fonts = fontList(doc);
  const faces = fonts[family] ?? fonts[family.toLowerCase()] ?? [];
  if (faces.includes(style)) return style;

  const resolved = resolveFace(doc, family, style === 'bolditalic' ? 'bold' : 'normal', onWarn);
  onWarn(
    style === 'italic'
      ? `Font family "${family}" has no italic face: italic text is drawn upright`
      : `Font family "${family}" has no ${style} face: drawn as ${resolved}`,
  );
  return resolved;
}
