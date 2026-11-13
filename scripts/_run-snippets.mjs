// Runs the snippets `scripts/_shared.mjs` compiled, one after the other, from the directory they were written to.
//
//   node scripts/_run-snippets.mjs <manifest.json>
//
// Each snippet gets its ambient names as globals: `doc`, the sample values. The `doc` of the README and of the JSDoc
// examples is a fresh document of the Quick start, filled and not yet exported; the one of a component page is a fresh
// demo document, built by the snippet the pages mark `<!-- demo document -->`. Every document a snippet builds or
// receives is then exported with `toBuffer()`. The result of each snippet, its error or the warnings its documents
// carry, goes to the `results` file of the manifest.
//
// A snippet that announces a preview also gets its document finalized, framed by a hairline and written to
// `<dir>/<id>.pdf`: the document it receives as `doc`, else the only one it builds.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

process.setSourceMapsEnabled(true);

const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { cropPadding, hairlineInset } = manifest.settings;

// `trackDocuments` wraps every `new PDFDocument(…)` of a snippet in `track`.
const built = [];
let holdExport = false;
globalThis.checkReadme = {
  track(doc) {
    // The Quick start exports its document last: held, the document stays open for the snippet that receives it.
    if (holdExport) doc.toBuffer = () => new Uint8Array();
    built.push(doc);
    return doc;
  },
};

// The snippets print; the check does not.
for (const method of ['log', 'info', 'warn', 'error']) console[method] = () => {};

/** Where an error comes from: the innermost frame of a snippet, mapped back to its `.ts` file. */
function origin(error) {
  const frame = /(snippet-\d+)\.ts:(\d+):\d+/.exec(String(error?.stack ?? ''));
  return frame ? { id: frame[1], line: Number(frame[2]) } : undefined;
}

/** A fresh copy of the document the snippet at `url` builds, left open: the Quick start, or the demo document. */
async function documentOf(url, run) {
  built.length = 0;
  holdExport = true;
  try {
    // A query string makes a fresh module, so a fresh document, on every import.
    await import(`${url}?for=${run}`);
  } finally {
    holdExport = false;
  }
  if (built.length !== 1) throw new Error(`the snippet that builds \`doc\` builds ${built.length} documents: one`);
  const [doc] = built;
  delete doc.toBuffer;
  return doc;
}

const round = (mm) => Math.round(mm * 100) / 100;

/**
 * Finalizes `doc`, frames what its preview shows and writes its PDF. Returns what the renderer and the fingerprint
 * need: the band of page 1 a cropped preview shows (from the top of the content to under the last block), the page
 * count, the page width, and a hash of the content stream of the page shown.
 */
function writePreview(doc, id, { page }) {
  const crop = page === undefined;
  const band = { top: round(doc.firstPageTop - cropPadding), bottom: round(doc.getYPos() + cropPadding) };
  band.top = Math.max(band.top, 0);
  band.bottom = Math.min(band.bottom, round(doc.pageHeight));
  doc.finalize();
  const pageCount = doc.doc.getNumberOfPages();
  for (let each = 1; each <= pageCount; each++) {
    // jsPDF writes a color into the page that is current when it is set: set it on each page.
    doc.doc.setPage(each);
    doc.doc.setDrawColor(doc.theme.colors.border).setLineWidth(hairlineInset * 2);
    const [top, bottom] = crop && each === 1 ? [band.top, band.bottom] : [0, doc.pageHeight];
    doc.doc.rect(
      hairlineInset,
      top + hairlineInset,
      doc.pageWidth - hairlineInset * 2,
      bottom - top - hairlineInset * 2,
    );
  }
  const shown = doc.doc.internal.pages[page ?? 1];
  writeFileSync(join(manifest.dir, `${id}.pdf`), doc.toBuffer());
  return {
    band: crop ? band : undefined,
    pageCount,
    pageWidth: round(doc.pageWidth),
    content: shown ? createHash('sha256').update(shown.join('\n')).digest('hex') : null,
  };
}

async function runSnippet({ id, url, ambient, docFrom, preview }) {
  const result = { id, warnings: [] };
  try {
    let given;
    if (docFrom === 'quickStart') given = await documentOf(manifest.quickStart, id);
    if (docFrom === 'demo') given = await documentOf(manifest.demo, id);
    for (const name of ambient) globalThis[name] = name === 'doc' ? given : manifest.samples[name];
    built.length = 0;
    await import(url);
    // A snippet that does not await its async work builds its documents a few ticks later: let the microtasks, the
    // zero-delay timers and the immediates it queued finish first. Longer waits are the snippet's to await.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setImmediate(resolve));
    let shown;
    if (preview) {
      shown = given ?? built[0];
      if (!given && built.length !== 1)
        throw new Error(`a preview shows one document: the snippet builds ${built.length}`);
    }
    for (const doc of [...(given ? [given] : []), ...built]) {
      if (doc === shown) result.preview = writePreview(doc, id, preview);
      else doc.toBuffer();
      result.warnings.push(...doc.warnings);
    }
  } catch (error) {
    result.error = { message: String(error?.message ?? error), at: origin(error) };
  } finally {
    for (const name of ambient) delete globalThis[name];
  }
  return result;
}

const results = [];
for (const snippet of manifest.snippets) {
  // oxlint-disable-next-line no-await-in-loop -- the snippets share the globals they are given: one at a time.
  results.push(await runSnippet(snippet));
}

writeFileSync(manifest.results, JSON.stringify(results));
