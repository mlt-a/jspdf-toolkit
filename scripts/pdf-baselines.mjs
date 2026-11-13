// PDF regression check: renders the examples, extracts their text with `pdftotext -raw`
// and compares it to tests/baselines/<name>.txt, page by page.
//
// `-raw` reads the text in the order the PDF draws it, which does not depend on the poppler
// version; the comparison ignores whitespace, which does (line breaks, spaces around rotated
// text). A diff therefore means the content, its order or its pagination changed. Positions,
// sizes and colors are not covered here: the vitest baseline tests/baselines/<name>.layout.txt
// holds them (tests/unit/examples-layout.test.ts). `--update` rewrites both, for the same examples.
//
//   node scripts/pdf-baselines.mjs            check (exit 1 on any diff)
//   node scripts/pdf-baselines.mjs --update   rewrite the text baselines, normalized as the check reads them, then
//                                             the layout baselines
//   node scripts/pdf-baselines.mjs invoice    restrict to one example
//
// Requires `pdftotext` (poppler) on PATH.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, fail, pagesOf, pdfText, requirePoppler, run } from './_shared.mjs';

const BASELINES = join(ROOT, 'tests', 'baselines');
const OUTPUT = join(ROOT, 'output');
const RUNNER = ['exec', 'tsx', 'src/examples/run-examples.ts'];

const args = process.argv.slice(2);
const update = args.includes('--update');
const flags = args.filter((a) => a.startsWith('--'));
const names = [...new Set(args.filter((a) => !a.startsWith('--')))];

// A mistyped flag would otherwise silently run a check instead of an update.
const badFlag = flags.find((f) => f !== '--update');
if (badFlag) fail(`Unknown option: ${badFlag}. Usage: pdf-baselines.mjs [--update] [example...]`);

// Fail early with a clear message rather than a cryptic spawn error per example.
requirePoppler('pdftotext');

// The runner owns the example list and validates names: one process renders them all and prints the path of each
// PDF, which names the examples it rendered.
const runner = run('pnpm', [...RUNNER, ...names], { stdout: 'pipe' });
const selected = [...runner.stdout.matchAll(/([^/\\]+)\.pdf$/gm)].map((match) => match[1]);
if (selected.length === 0) fail('The example runner printed no PDF path.');

// What the check reads, one line per page: a new poppler that only moves whitespace leaves the file as it is.
const normalized = (text) => pagesOf(text).join('\f\n');

// Where two texts first differ: the page, and what each side reads from there.
function firstDiff(expected, actual) {
  const e = pagesOf(expected);
  const a = pagesOf(actual);
  if (e.length !== a.length) return `  ${e.length - 1} page(s) expected, ${a.length - 1} rendered`;
  const page = e.findIndex((text, index) => text !== a[index]);
  if (page === -1) return undefined;
  let at = 0;
  while (e[page][at] === a[page][at]) at++;
  const from = Math.max(0, at - 30);
  return `  page ${page + 1}, after ${show(e[page].slice(from, at))}:\n    - ${show(e[page].slice(at, at + 60))}\n    + ${show(a[page].slice(at, at + 60))}`;
}

const show = (text) => JSON.stringify(text);

function check(name) {
  const file = join(BASELINES, `${name}.txt`);
  const actual = pdfText(join(OUTPUT, `${name}.pdf`));
  if (update) {
    mkdirSync(BASELINES, { recursive: true });
    writeFileSync(file, normalized(actual));
    return { ok: true, status: 'UPDATED' };
  }
  let expected;
  try {
    expected = readFileSync(file, 'utf8');
  } catch {
    return { ok: false, status: 'MISSING baseline (run with --update)' };
  }
  const diff = firstDiff(expected, actual);
  return diff === undefined ? { ok: true, status: 'OK' } : { ok: false, status: `DIFF\n${diff}` };
}

let failures = 0;
for (const name of selected) {
  let result;
  try {
    result = check(name);
  } catch (err) {
    result = { ok: false, status: `ERROR ${err.message}` };
  }
  console.log(`${name}: ${result.status}`);
  if (!result.ok) failures++;
}

if (failures) fail(`\n${failures} of ${selected.length} example(s) failed.`);

if (update) {
  const only = names.length ? ['-t', `^layout of the (${selected.join('|')}) example`] : [];
  run('pnpm', ['exec', 'vitest', 'run', 'tests/unit/examples-layout.test.ts', '--update', ...only]);
}
