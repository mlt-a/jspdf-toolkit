// What the scripts share: the repository root, running a tool, failing with a message, reading and rendering the pages
// of a PDF, the program of the sources, and the checks of the `ts` snippets of the documentation (the README, the
// JSDoc comments, the component pages): `check-readme.mjs` verifies them all, `docs-components.mjs` runs the snippets
// of the pages to fingerprint and render their previews.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

/** The repository root. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The name of the package, as the snippets import it. */
export const PACKAGE = '@mlt-a/jspdf-toolkit';

/** Prints `message` on stderr and exits with status 1. */
export function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Runs `command` from the root. Its stderr goes to the terminal; `stdout` is `'inherit'`, `'ignore'` or `'pipe'` (the
 * output is then `result.stdout`, a string). A tool that cannot start fails the script; a tool that exits with an
 * error fails it too, unless `check` is `false`: the caller then reads `result.status`.
 */
export function run(command, args, { stdout = 'inherit', check = true, cwd = ROOT } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', stdout, 'inherit'],
  });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  if (check && result.status !== 0) fail(`${[command, ...args].join(' ')} exited with status ${result.status}`);
  return result;
}

/** Fails with an install hint when the poppler `tool` is not on PATH. */
export function requirePoppler(tool) {
  if (spawnSync(tool, ['-v'], { stdio: 'ignore' }).error) {
    fail(`${tool} not found. Install poppler (brew install poppler / apt-get install poppler-utils).`);
  }
}

/** The 1-based line of `text` that holds the character at `index`. */
export const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** A short, stable hash of a string or of a JSON value. */
export const hashOf = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
    .slice(0, 16);

// === PDF pages (poppler) ===

/** The text of `pdf` as `pdftotext -raw` reads it: in the order the PDF draws it. Throws when pdftotext fails. */
export function pdfText(pdf) {
  const result = run('pdftotext', ['-raw', pdf, '-'], { stdout: 'pipe', check: false });
  if (result.status !== 0) throw new Error(`pdftotext failed on ${pdf} (exit status ${result.status})`);
  return result.stdout;
}

/** The pages of a `pdfText`, whitespace removed: pdftotext ends every page with a form feed. */
export const pagesOf = (text) => text.split('\f').map((page) => page.replace(/\s+/g, ''));

/**
 * Renders page `page` of `pdf` to `<target>.png`, `width` pixels wide. With `band` (`{ top, bottom }`, mm from the top
 * of a page `pageWidth` mm wide), only that horizontal band is rendered; without it, the whole page.
 */
export function renderPagePng(pdf, target, { page, width, band, pageWidth }) {
  let size = ['-scale-to-x', String(width), '-scale-to-y', '-1'];
  if (band) {
    const dpi = (width / pageWidth) * 25.4;
    const pixels = (mm) => String(Math.round((mm / 25.4) * dpi));
    size = ['-r', String(dpi), '-x', '0', '-y', pixels(band.top), '-W', String(width), '-H'];
    size.push(pixels(band.bottom - band.top));
  }
  // -singlefile writes exactly <target>.png, without a page-number suffix.
  const pages = ['-f', String(page), '-l', String(page)];
  run('pdftoppm', ['-q', '-png', '-singlefile', ...pages, ...size, pdf, target], { stdout: 'ignore' });
}

// === Code blocks ===

// The README section whose first `ts` block builds the `doc` the other examples assume.
export const ASSUMES_DOC = '// assumes `doc` from Quick start';
export const BROWSER_ONLY = '// browser only';
// A block that shows a warning on purpose: `// warns: <part of the warning>`; it must leave that warning, and no other.
const WARNS = /^\/\/ warns(?::\s*(.*))?$/;
// What a block is: `ts` is compiled and run, `bash` is shown as it is.
const LANGUAGES = { ts: 'compiled and run', bash: 'shown as it is' };
// Browser globals: a block that uses one cannot run under Node.
const BROWSER_GLOBALS = new Set(['document', 'window', 'fetch', 'navigator', 'localStorage']);

/** A line of a JSDoc comment, without its ` * `. */
export const stripJsdoc = (line) => line.replace(/^\s*\* ?/, '');

/**
 * The code blocks of a Markdown text whose lines are `lines`, each `{ source, file, language, code, line }` where `line`
 * is the line of its first code line. `source` says where they come from: `'readme'`, `'jsdoc'` or `'page'`. `lines`
 * start at line `offset + 1` of `file`; a JSDoc comment is read without its ` * `.
 */
export function fencedBlocks(file, lines, { source = 'readme', offset = 0 } = {}) {
  const strip = source === 'jsdoc' ? stripJsdoc : (line) => line;
  const blocks = [];
  const errors = [];
  let open = null;
  lines.forEach((raw, index) => {
    const line = strip(raw);
    const at = offset + index + 1;
    if (open === null) {
      const fence = /^```(.*)$/.exec(line.trim());
      if (fence) open = { language: fence[1].trim(), line: at + 1, code: [], fenceLine: at };
      return;
    }
    if (line.trim() === '```') {
      blocks.push({
        file,
        source,
        language: open.language,
        line: open.line,
        fenceLine: open.fenceLine,
        code: open.code,
      });
      open = null;
    } else {
      open.code.push(line);
    }
  });
  if (open !== null) errors.push(`${file}:${open.fenceLine}: code block never closed: add the closing \`\`\``);
  return { blocks, errors };
}

/** An error for every block whose language the script does not know, or that has none. */
export function checkLanguages(blocks) {
  return blocks
    .filter((block) => !(block.language in LANGUAGES))
    .map(
      ({ file, fenceLine, language }) =>
        `${file}:${fenceLine}: code block ${language ? `in \`${language}\`` : 'without a language'}: ` +
        `the scripts know ${Object.entries(LANGUAGES)
          .map(([name, does]) => `\`${name}\` (${does})`)
          .join(' and ')}; use one of them, or teach scripts/_shared.mjs the new one`,
    );
}

// === The component pages ===

/** The folder of the component pages, and where their previews are rendered. */
export const PAGES = join(ROOT, 'docs', 'components');
export const PREVIEWS = join(ROOT, 'docs', 'images', 'components');

/** The file names of the component pages, the index included. */
export const pageNames = () =>
  readdirSync(PAGES)
    .filter((name) => name.endsWith('.md'))
    .toSorted();

// `<!-- preview: name -->` above a snippet renders what it draws to `docs/images/components/<name>.png`, cropped to
// the content; `<!-- preview: name page=2 -->` renders that whole page instead. `<!-- demo document -->` above a
// snippet makes the document it builds the `doc` of the snippets that use one without declaring it.
const PREVIEW_MARKER = /^<!-- preview: ([\w-]+)(?: page=(\d+))? -->$/;
export const DEMO_MARKER = '<!-- demo document -->';
const IMAGE_LINE = /^(?:!\[.*\]\(.*\)|<img .*>)$/;

/** The marker line a snippet carries: the last line above its fence that is neither blank nor an image. */
function markerAbove(lines, fenceLine) {
  for (let index = fenceLine - 2; index >= 0; index--) {
    const text = lines[index].trim();
    if (text === '' || IMAGE_LINE.test(text)) continue;
    return { text, line: index + 1 };
  }
  return undefined;
}

/**
 * The code blocks of the component pages. A `ts` block carries the `preview` it announces, if any, and `demo: true`
 * when it builds the demo document.
 */
export function pageBlocks() {
  const blocks = [];
  const errors = [];
  for (const name of pageNames()) {
    const file = `docs/components/${name}`;
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    const found = fencedBlocks(file, lines, { source: 'page' });
    errors.push(...found.errors);
    for (const block of found.blocks) {
      const marker = markerAbove(lines, block.fenceLine);
      const preview = marker && PREVIEW_MARKER.exec(marker.text);
      if (block.language === 'ts' && preview) {
        block.preview = { name: preview[1], page: preview[2] ? Number(preview[2]) : undefined, line: marker.line };
      }
      if (block.language === 'ts' && marker?.text === DEMO_MARKER) block.demo = true;
      blocks.push(block);
    }
  }
  return { blocks, errors };
}

// === Previews: what makes one, and its fingerprint ===

/**
 * How a preview is rendered. A cropped preview shows the band of its page from the top of the content to under the
 * last block, `cropPadding` mm around it, `cropWidth` pixels wide; a whole page is `pageWidth` pixels wide. A hairline
 * `hairlineInset` mm inside the edges frames the image: a white page has no edge on a white background.
 */
export const PREVIEW_SETTINGS = { cropWidth: 1000, pageWidth: 800, cropPadding: 4, hairlineInset: 0.15 };

/** Where the fingerprint of each preview is kept, next to the images; `docs/images` has its own. */
export const PREVIEW_FINGERPRINTS = join(PREVIEWS, 'fingerprints.json');
export const README_FINGERPRINTS = join(ROOT, 'docs', 'images', 'fingerprints.json');

/** The files a preview depends on besides its code: the images and fonts of `assets/`, by path and content. */
export function assetsHash() {
  const files = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? files(path) : entry.name.startsWith('.') ? [] : [path];
    });
  return hashOf(
    files(join(ROOT, 'assets'))
      .toSorted()
      .map((path) => [relative(ROOT, path), hashOf(readFileSync(path).toString('base64'))]),
  );
}

/** `{ name: fingerprint }` from `file`, or `{}` when it does not exist yet. */
export function readFingerprints(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** Writes `fingerprints` to `file`, sorted by name, as the formatter writes JSON. */
export function writeFingerprints(file, fingerprints) {
  const sorted = Object.fromEntries(Object.entries(fingerprints).toSorted(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

// === README previews: pages of the examples ===

/**
 * The README previews `scripts/render-previews.mjs` renders to `docs/images/<name>.png`, `README_PREVIEW_WIDTH` pixels
 * wide. `page` is 1-based; `shows` is a text that only that page of the example holds, compared without whitespace;
 * `whole: true` means the page holds that text and nothing else (a cover whose text the page after it repeats).
 */
export const README_PREVIEWS = [
  { example: 'invoice', page: 1, name: 'invoice', shows: 'Service details' },
  // The title and subtitle are repeated on the first page of the text: only the cover holds nothing else.
  {
    example: 'report',
    page: 1,
    name: 'report-cover',
    shows: 'Annual Report 2025 Acme Corp — Technology Division CONFIDENTIAL',
    whole: true,
  },
  { example: 'report', page: 2, name: 'report-toc', shows: 'Contents' },
  { example: 'report', page: 5, name: 'report-table', shows: 'Project Tracking (continued)' },
  { example: 'stress-test', page: 5, name: 'charts-columns', shows: 'Hires per quarter' },
  { example: 'stress-test', page: 9, name: 'charts-line', shows: 'Revenue outlook' },
  { example: 'showcase', page: 6, name: 'showcase-boxes', shows: 'Boxes & Containers' },
  { example: 'showcase', page: 3, name: 'showcase-fields', shows: 'Fields with highlight' },
];
export const README_PREVIEW_WIDTH = 800;

/**
 * The fingerprint of a README preview: its page as the layout baseline of its example describes it (every mark, with
 * its position, size and color), and the width it is rendered at. `undefined` when the baseline has no such page.
 */
export function readmePreviewFingerprint({ example, page }) {
  const baseline = join(ROOT, 'tests', 'baselines', `${example}.layout.txt`);
  if (!existsSync(baseline)) return undefined;
  const sections = readFileSync(baseline, 'utf8').split(/^(?=## page \d+ )/m);
  const section = sections.find((text) => text.startsWith(`## page ${page} `));
  return section && hashOf({ example, page, width: README_PREVIEW_WIDTH, layout: section });
}

/**
 * An error for each README preview whose image is missing or no longer shows its page of the example, and each image
 * of `docs/images` that is no README preview.
 */
export function readmePreviewErrors() {
  const recorded = readFingerprints(README_FINGERPRINTS);
  const images = join(ROOT, 'docs', 'images');
  const errors = [];
  for (const preview of README_PREVIEWS) {
    const image = `docs/images/${preview.name}.png`;
    const fingerprint = readmePreviewFingerprint(preview);
    if (fingerprint === undefined) {
      errors.push(
        `scripts/_shared.mjs: README_PREVIEWS shows page ${preview.page} of ${preview.example}, which ` +
          `tests/baselines/${preview.example}.layout.txt does not hold: fix the page`,
      );
    } else if (!existsSync(join(ROOT, image)) || recorded[preview.name] !== fingerprint) {
      errors.push(
        `${image} ${existsSync(join(ROOT, image)) ? `no longer shows page ${preview.page} of ${preview.example}` : 'is missing'}: ` +
          'run `pnpm docs:previews`, read the image, and commit it with docs/images/fingerprints.json',
      );
    }
  }
  for (const file of readdirSync(images).filter((name) => name.endsWith('.png'))) {
    if (!README_PREVIEWS.some((preview) => `${preview.name}.png` === file)) {
      errors.push(`docs/images/${file} is no README preview of scripts/_shared.mjs (README_PREVIEWS): delete it`);
    }
  }
  return errors;
}

// === The program of the sources ===

/**
 * The TypeScript program of the sources behind the entry points of `package.json`, with the compiler options of
 * `tsconfig.json`: what the published declarations no longer carry (`@internal` members, JSDoc tags) is read from it.
 * `sources` lists the entry files, `.` first.
 */
export function sourceProgram() {
  const { exports } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const sources = Object.entries(exports)
    .filter(([, target]) => typeof target === 'object' && target.types)
    .map(([path]) => join(ROOT, path === '.' ? 'src/index.ts' : `src/${path.slice(2)}/index.ts`));
  const missing = sources.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    fail(
      `${missing.map((path) => relative(ROOT, path)).join(', ')} missing: the scripts read the sources of each entry ` +
        'point of package.json at src/<entry>/index.ts; fix the path in scripts/_shared.mjs (sourceProgram)',
    );
  }
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile).config,
    ts.sys,
    ROOT,
  );
  return { program: ts.createProgram(sources, config.options), sources };
}

// === Snippets: what each one is given ===

// Values a JSDoc example may use without building them, read from `assets/`: the caller's own images and fonts.
const SAMPLES = {
  base64Png: () => readAsset('assets/logos/logo-icon.png').toString('base64'),
  base64Ttf: () => readAsset('assets/fonts/inter/Inter-Regular.ttf').toString('base64'),
  base64BoldTtf: () => readAsset('assets/fonts/inter/Inter-Bold.ttf').toString('base64'),
  phoneDataUri: () => pngDataUri('assets/icons/star.png'),
  logoDataUri: () => pngDataUri('assets/logos/logo-full.png'),
  starDataUri: () => pngDataUri('assets/icons/star.png'),
  letterheadDataUri: () => pngDataUri('assets/backgrounds/letterhead.png'),
  longText: () =>
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore ' +
    'magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.',
};
/** The names of the sample values a JSDoc example is given. */
export const SAMPLE_NAMES = Object.keys(SAMPLES);
// The files the examples read by path, copied from `assets/` into the directory they run in.
const FILES = {
  'logo.png': 'assets/logos/logo-full.png',
  'logo-icon.png': 'assets/logos/logo-icon.png',
  'star.png': 'assets/icons/star.png',
  'signature.png': 'assets/logos/logo-icon.png',
  'cover.png': 'assets/backgrounds/cover.png',
  'letterhead.png': 'assets/backgrounds/letterhead.png',
  'Brand-Regular.ttf': 'assets/fonts/inter/Inter-Regular.ttf',
  'Brand-Bold.ttf': 'assets/fonts/inter/Inter-Bold.ttf',
};

function readAsset(path) {
  return readFileSync(join(ROOT, path));
}

function pngDataUri(path) {
  return `data:image/png;base64,${readAsset(path).toString('base64')}`;
}

const DECLARATIONS = [
  ts.isVariableDeclaration,
  ts.isFunctionDeclaration,
  ts.isClassDeclaration,
  ts.isParameter,
  ts.isBindingElement,
  ts.isImportSpecifier,
  ts.isInterfaceDeclaration,
  ts.isTypeAliasDeclaration,
];

// `x` in `a.x`, `{ x: 1 }`, `A.x`, `{ x: y } = …`, `import { x as y }`: the name of a member, neither declared nor read.
function isMemberName(node) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) return parent.name === node;
  if (ts.isQualifiedName(parent)) return parent.right === node;
  if (ts.isBindingElement(parent) || ts.isImportSpecifier(parent)) return parent.propertyName === node;
  return false;
}

/** The names `source` declares, at any depth, and the names it reads. */
function namesOf(source) {
  const declared = new Set();
  const used = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      if (DECLARATIONS.some((is) => is(node.parent)) && node.parent.name === node) declared.add(node.text);
      else if (!isMemberName(node)) used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { declared, used };
}

/** The warning a block announces with `// warns: …` on its first line: `{ text }`, or `undefined` without a marker. */
function announcedWarning(block, errors) {
  const marker = WARNS.exec(block.code[0]?.trim() ?? '');
  if (!marker) return undefined;
  const text = marker[1]?.trim() ?? '';
  if (text === '') {
    errors.push(
      `${block.file}:${block.line}: \`// warns\` without the warning it shows: write \`// warns: <part of the ` +
        'warning>`, so the check knows which one the block must leave',
    );
  }
  return { text };
}

/**
 * The snippets: every `ts` block, with what it is given. `ambient` lists the names declared for it (`doc`, samples),
 * `docFrom` where its `doc` comes from: `'quickStart'` (the README document, filled), or `'demo'` (the demo document
 * of the component pages). `runs` says whether it runs under Node; `warns` holds the warning it announces.
 */
function prepareSnippets(blocks) {
  const errors = [];
  const snippets = blocks
    .filter((block) => block.language === 'ts')
    .map((block, index) => {
      const code = block.code.join('\n') + '\n';
      const id = `snippet-${String(index + 1).padStart(3, '0')}`;
      const source = ts.createSourceFile(`${id}.ts`, code, ts.ScriptTarget.ES2022, true);
      const { declared, used } = namesOf(source);
      const free = (name) => used.has(name) && !declared.has(name);
      const browserOnly = block.code[0]?.trim() === BROWSER_ONLY;
      const browserUses = [...BROWSER_GLOBALS].filter(free);
      const where = `${block.file}:${block.line}`;
      if (browserUses.length > 0 && !browserOnly) {
        errors.push(
          `${where}: the block uses ${browserUses.map((name) => `\`${name}\``).join(', ')}, which Node lacks: ` +
            `start it with \`${BROWSER_ONLY}\` (compiled, not run)`,
        );
      }
      if (browserOnly && browserUses.length === 0) {
        errors.push(
          `${where}: \`${BROWSER_ONLY}\` on a block that uses no browser global: remove it, so the block runs`,
        );
      }
      const warns = announcedWarning(block, errors);
      const ambient = [];
      let docFrom = null;
      if (block.source === 'readme' && block.code[0]?.trim() === ASSUMES_DOC) docFrom = 'quickStart';
      if (block.source === 'jsdoc' && free('doc')) docFrom = 'quickStart';
      if (block.source === 'page' && free('doc')) docFrom = 'demo';
      if (docFrom) ambient.push('doc');
      if (block.source === 'jsdoc') ambient.push(...SAMPLE_NAMES.filter(free));
      return Object.assign(block, { id, code, ambient, docFrom, warns, runs: !browserOnly, where });
    });
  const demos = snippets.filter((snippet) => snippet.demo);
  if (snippets.some((snippet) => snippet.docFrom === 'demo') && demos.length !== 1) {
    errors.push(
      demos.length === 0
        ? `docs/components: snippets use \`doc\` without declaring it, but no snippet builds the demo document: put ` +
            `\`${DEMO_MARKER}\` above the snippet of docs/components/README.md that builds it`
        : `${demos.map((demo) => demo.where).join(', ')}: \`${DEMO_MARKER}\` marks more than one snippet: keep one`,
    );
  }
  return { snippets, errors };
}

function preludeOf(snippet) {
  return (
    snippet.ambient
      .map((name) =>
        name === 'doc' ? `declare const doc: import('${PACKAGE}').PDFDocument;` : `declare const ${name}: string;`,
      )
      .join(' ') + '\n'
  );
}

// The line of the README or source file that a line of a generated snippet file stands for.
const sourceLine = (snippet, line) => snippet.line + line - 2;

// === The published types ===

/** The declaration file of each entry point, from the `exports` of `package.json`. Fails when one is missing. */
export function publishedEntries() {
  const { exports } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const entries = Object.entries(exports)
    .filter(([, target]) => typeof target === 'object' && target.types)
    .map(([path, target]) => ({
      specifier: path === '.' ? PACKAGE : `${PACKAGE}/${path.slice(2)}`,
      types: target.types,
    }));
  const missing = entries.filter(({ types }) => !existsSync(join(ROOT, types)));
  if (missing.length > 0) {
    fail(
      `${missing.map(({ types }) => types).join(', ')} missing: the snippets run against the published package; run ` +
        '`pnpm build` first',
    );
  }
  for (const entry of entries) entry.types = join(ROOT, entry.types);
  return entries;
}

/** Writes the snippets and their compiler options in `dir`, where the package resolves to this repository. */
function writeSnippets(dir, snippets) {
  mkdirSync(join(dir, 'node_modules', '@mlt-a'), { recursive: true });
  symlinkSync(ROOT, join(dir, 'node_modules', PACKAGE), 'dir');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const snippet of snippets) {
    // `export {}` makes every snippet a module: their top-level names do not collide.
    writeFileSync(join(dir, `${snippet.id}.ts`), `${preludeOf(snippet)}${snippet.code}export {};\n`);
  }
}

function compilerOptions(dir) {
  return ts.parseJsonConfigFileContent(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'DOM'],
        types: ['node'],
        typeRoots: [join(ROOT, 'node_modules', '@types')],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
    },
    ts.sys,
    dir,
  ).options;
}

/** One error per compiler diagnostic, at the line of the README or source file it comes from. */
function checkCompile(program, dir, snippets) {
  const byFile = new Map(snippets.map((snippet) => [join(dir, `${snippet.id}.ts`), snippet]));
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    if (!diagnostic.file) return `tsc: ${message}`;
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const snippet = byFile.get(diagnostic.file.fileName);
    if (!snippet) return `${relative(ROOT, diagnostic.file.fileName)}:${line + 1}: ${message}`;
    const hint =
      // Cannot find name (2304), with a suggestion (2552).
      [2304, 2552].includes(diagnostic.code) && snippet.source === 'jsdoc'
        ? `: import it; an example is given only \`doc\` and the sample values (${SAMPLE_NAMES.join(', ')})`
        : ': fix the snippet, or the API it shows';
    return `${snippet.file}:${sourceLine(snippet, line + 1)}: does not compile against dist/: ${message}${hint}`;
  });
}

// === Running the snippets ===

// Wraps every `new PDFDocument(…)` of a snippet in `globalThis.checkReadme.track`, so the runner renders the documents
// it builds.
function trackDocuments(context) {
  const { factory } = context;
  const visit = (node) => {
    const visited = ts.visitEachChild(node, visit, context);
    if (!ts.isNewExpression(visited) || !ts.isIdentifier(visited.expression)) return visited;
    if (visited.expression.text !== 'PDFDocument') return visited;
    const track = factory.createPropertyAccessExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier('globalThis'), 'checkReadme'),
      'track',
    );
    return factory.createCallExpression(track, undefined, [visited]);
  };
  return (file) => ts.visitNode(file, visit);
}

/** The warnings of `list`, one per line, quoted. */
const listed = (list) => list.map((warning) => `\n    "${warning}"`).join('');

/** An error for each warning a snippet left that it did not announce, or for the announced one it did not leave. */
function warningErrors(snippet, warnings) {
  const announced = snippet.warns?.text;
  if (announced === undefined) {
    return warnings.length === 0
      ? []
      : [
          `${snippet.where}: leaves ${warnings.length} warning(s) in doc.warnings:${listed(warnings)}\n  fix the ` +
            'snippet so it draws cleanly, or announce the warning with `// warns: <part of it>` on its first line',
        ];
  }
  if (announced === '') return [];
  const expected = warnings.filter((warning) => warning.includes(announced));
  const others = warnings.filter((warning) => !warning.includes(announced));
  const errors = [];
  if (expected.length === 0) {
    errors.push(
      `${snippet.where}: announces \`// warns: ${announced}\`, but no warning holds "${announced}"; it left ` +
        `${warnings.length === 0 ? 'none' : listed(warnings)}\n  fix the marker or the snippet`,
    );
  }
  if (expected.length > 0 && others.length > 0) {
    errors.push(
      `${snippet.where}: leaves warnings it does not announce:${listed(others)}\n  fix the snippet, so it shows ` +
        'only the warning of its marker',
    );
  }
  return errors;
}

/**
 * Runs the snippets under Node from `dir` and returns the result of each, `{ id, warnings, error?, preview? }`, and an
 * error for each that throws, leaves a warning it does not announce, or misses the one it announces. A snippet that
 * announces a preview also has its PDF written to `<dir>/<id>.pdf`, framed by a hairline; `preview` holds what the
 * renderer and the fingerprint need.
 */
function runSnippets(dir, snippets, quickStart) {
  const runnable = snippets.filter((snippet) => snippet.runs);
  for (const snippet of runnable) {
    const { outputText } = ts.transpileModule(readFileSync(join(dir, `${snippet.id}.ts`), 'utf8'), {
      fileName: `${snippet.id}.ts`,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, inlineSourceMap: true },
      transformers: { before: [trackDocuments] },
    });
    writeFileSync(join(dir, `${snippet.id}.mjs`), outputText);
  }
  for (const [name, path] of Object.entries(FILES)) writeFileSync(join(dir, name), readAsset(path));
  const url = (snippet) => snippet && pathToFileURL(join(dir, `${snippet.id}.mjs`)).href;
  const manifest = {
    dir,
    settings: PREVIEW_SETTINGS,
    demo: url(snippets.find((snippet) => snippet.demo)),
    quickStart: url(quickStart),
    samples: Object.fromEntries(Object.entries(SAMPLES).map(([name, value]) => [name, value()])),
    snippets: runnable.map((snippet) => ({
      id: snippet.id,
      url: url(snippet),
      ambient: snippet.ambient,
      docFrom: snippet.docFrom,
      preview: snippet.preview && { page: snippet.preview.page },
    })),
    results: join(dir, 'results.json'),
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  const runner = join(ROOT, 'scripts', '_run-snippets.mjs');
  const { status } = run(process.execPath, [runner, join(dir, 'manifest.json')], {
    stdout: 'ignore',
    cwd: dir,
    check: false,
  });
  if (status !== 0) {
    return { results: [], errors: [`scripts/_run-snippets.mjs exited with status ${status}: see its error above`] };
  }

  const byId = new Map(snippets.map((snippet) => [snippet.id, snippet]));
  const results = JSON.parse(readFileSync(manifest.results, 'utf8'));
  const errors = results.flatMap(({ id, error, warnings }) => {
    const snippet = byId.get(id);
    if (error) {
      const at = error.at && byId.get(error.at.id);
      const where = at ? `${at.file}:${sourceLine(at, error.at.line)}` : snippet.where;
      const via = at && at !== snippet ? ` (running ${at.where}, which builds the \`doc\` of ${snippet.where})` : '';
      return [`${where}: throws when run${via}: ${error.message}: fix the snippet, or the library`];
    }
    return warningErrors(snippet, warnings);
  });
  return { results, errors };
}

/**
 * Runs every `ts` block of `blocks` against the published package: compiled as its own module against the declarations
 * of `dist/` when `compile` is set (a block that does not compile is then not run), else only transpiled. Returns the
 * snippets, the errors, the TypeScript program when there is one (the published names are read from it) and the
 * `results` of the run, with the directory `dir` the snippets and their PDFs were written to; it is removed when the
 * script exits. `quickStart` is the block whose `doc` the blocks that assume it are given.
 */
export function checkSnippets(blocks, { quickStart, compile = true }) {
  const entries = publishedEntries();
  const { snippets, errors } = prepareSnippets(blocks);
  const dir = mkdtempSync(join(tmpdir(), 'jspdf-toolkit-snippets-'));
  // `fail` calls `process.exit`, which skips a `finally`: the exit event removes the directory, and the symlink to the
  // repository in it, on every way out.
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  writeSnippets(dir, snippets);
  let program;
  let compileErrors = [];
  if (compile) {
    program = ts.createProgram(
      [...entries.map(({ types }) => types), ...snippets.map((snippet) => join(dir, `${snippet.id}.ts`))],
      compilerOptions(dir),
    );
    compileErrors = checkCompile(program, dir, snippets);
    errors.push(...compileErrors);
  }
  let results = [];
  // A snippet that does not compile is not run: its errors would only repeat. Without a Quick start there is no `doc`
  // to give the snippets that assume it, and without one demo document none for the snippets of the pages.
  const needs = (from) => snippets.some((snippet) => snippet.docFrom === from);
  const demos = snippets.filter((snippet) => snippet.demo).length;
  if (compileErrors.length === 0 && (quickStart || !needs('quickStart')) && (demos === 1 || !needs('demo'))) {
    const ran = runSnippets(dir, snippets, quickStart);
    results = ran.results;
    errors.push(...ran.errors);
  }
  return { snippets, errors, program, entries, results, dir };
}
