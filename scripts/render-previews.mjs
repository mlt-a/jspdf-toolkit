// README preview images: renders the examples, then rasterizes selected pages to docs/images/<name>.png with
// `pdftoppm`, and records the fingerprint of each in docs/images/fingerprints.json.
//
//   node scripts/render-previews.mjs
//
// Requires `pdftotext` and `pdftoppm` (poppler) on PATH. The previews are listed in `README_PREVIEWS` of
// `scripts/_shared.mjs`. Each names its page and the title of the section it shows: the title is looked for on the
// page before it is rendered, so a page that moved fails the script, which says where the title is now. The title must
// be on that page alone, else it could not tell a moved page from another. `pnpm check:docs` compares the fingerprints
// to the layout baselines of the examples, without poppler: an image whose page changed fails it.
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  README_FINGERPRINTS,
  README_PREVIEWS,
  README_PREVIEW_WIDTH,
  ROOT,
  fail,
  pagesOf,
  pdfText,
  readmePreviewFingerprint,
  renderPagePng,
  requirePoppler,
  run,
  writeFingerprints,
} from './_shared.mjs';

const OUTPUT = join(ROOT, 'output');
const IMAGES = join(ROOT, 'docs', 'images');

requirePoppler('pdftotext');
requirePoppler('pdftoppm');

const examples = [...new Set(README_PREVIEWS.map((p) => p.example))];
run('pnpm', ['exec', 'tsx', 'src/examples/run-examples.ts', ...examples], { stdout: 'ignore' });

// Every preview whose page no longer shows its section, or whose text appears on more than one page of the example: it
// would then still match after the section moved, and the preview would show the wrong page.
function checkPages() {
  const texts = new Map(examples.map((example) => [example, pagesOf(pdfText(join(OUTPUT, `${example}.pdf`)))]));
  return README_PREVIEWS.flatMap(({ example, page, name, shows, whole }) => {
    const pages = texts.get(example);
    const wanted = shows.replace(/\s+/g, '');
    const now = pages.flatMap((text, index) => ((whole ? text === wanted : text.includes(wanted)) ? [index + 1] : []));
    if (now.length > 1) {
      return [
        `scripts/_shared.mjs: ${name} expects "${shows}" on page ${page} of ${example}.pdf, but it is on pages ` +
          `${now.join(', ')}: use a text that only that page shows, in \`shows\` of README_PREVIEWS`,
      ];
    }
    if (now[0] === page) return [];
    const where = now.length > 0 ? `it is now on page ${now[0]}` : 'no page shows it any more';
    return [
      `scripts/_shared.mjs: ${name} expects "${shows}" on page ${page} of ${example}.pdf, but ${where}: ` +
        'update its `page` (or its `shows`) in README_PREVIEWS',
    ];
  });
}

const errors = checkPages();
if (errors.length > 0) fail(errors.join('\n'));

mkdirSync(IMAGES, { recursive: true });
const fingerprints = {};
for (const preview of README_PREVIEWS) {
  const { example, page, name } = preview;
  const target = join(IMAGES, name);
  renderPagePng(join(OUTPUT, `${example}.pdf`), target, { page, width: README_PREVIEW_WIDTH });
  fingerprints[name] = readmePreviewFingerprint(preview);
  if (fingerprints[name] === undefined) {
    fail(`tests/baselines/${example}.layout.txt has no page ${page}: run \`pnpm check:pdf:update\` first`);
  }
  console.log(`${name}.png  (${example} p${page}, ${Math.round(statSync(`${target}.png`).size / 1024)} kB)`);
}
writeFingerprints(README_FINGERPRINTS, fingerprints);
