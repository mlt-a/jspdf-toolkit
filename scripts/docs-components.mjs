// The component pages (docs/components/*.md): keeps them true to the sources.
//
//   node scripts/docs-components.mjs              # writes the tables, renders the previews (needs pdftoppm)
//   node scripts/docs-components.mjs table cover  # the same, rendering the previews of these pages only
//   node scripts/docs-components.mjs --check      # verifies only: what `check:all` runs, no pdftoppm, nothing written
//
// The script writes what a page would otherwise repeat by hand, and checks it was written:
//
// - `<!-- options: TypeName -->` … `<!-- /options -->` holds the table of the properties of that exported type, read
//   from its JSDoc: name, type, default (the `Default:` sentence of the comment) and description.
// - `<!-- table: name -->` … `<!-- /table -->` holds a table computed from the built package: the text levels, the
//   spacing scale, the spacing of the headings (`GENERATED_TABLES` below).
// - `<!-- preview: name -->` above a `ts` snippet renders what it draws to `docs/images/components/<name>.png`,
//   cropped to the content; `<!-- preview: name page=2 -->` renders that whole page instead. Each image has a
//   fingerprint in `docs/images/components/fingerprints.json`: the snippet, the page, the render settings, the demo
//   document, the assets, and what the run drew (the band shown, the page count, the content of the page). `--check`
//   runs the snippets again and compares, so an image that no longer shows its snippet fails, without poppler. The
//   README previews of `docs/images` (`scripts/render-previews.mjs`) are checked the same way, from the layout
//   baselines of the examples.
//
// Every snippet runs against `dist/` (run `pnpm build` first). `scripts/check-readme.mjs` also compiles them against
// the published types and checks the names the pages cite.
//
// It also checks the pages as a set: every page is listed in the index (`README.md`), whose `children` typedoc
// publishes, under its title; titles are method names or sentence case; every preview has its image on its page, every
// image of a page comes from a preview, no image of `docs/images/components` is orphaned, and no two images of
// `docs/images` and `docs/images/components` share a name, since typedoc copies them into one folder.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  PAGES,
  PREVIEWS,
  PREVIEW_FINGERPRINTS,
  PREVIEW_SETTINGS,
  ROOT,
  assetsHash,
  checkSnippets,
  fail,
  hashOf,
  lineOf,
  pageBlocks,
  pageNames,
  readFingerprints,
  readmePreviewErrors,
  renderPagePng,
  requirePoppler,
  run,
  sourceProgram,
  writeFingerprints,
} from './_shared.mjs';

const INDEX = 'README.md';
const COMMAND = 'pnpm docs:components';

/**
 * Checks the pages, writes their tables and renders their previews, or with `--check` verifies them only. Returns the
 * problems found, and the line that sums up the run when there are none.
 */
async function main() {
  const pages = pageNames().map((name) => ({
    name,
    path: join(PAGES, name),
    file: `docs/components/${name}`,
    text: readFileSync(join(PAGES, name), 'utf8'),
  }));
  const { check, only, errors: argumentErrors } = parseArguments(process.argv.slice(2), pages);
  if (argumentErrors.length > 0) return { errors: argumentErrors };

  const source = sourceProgram();
  const checker = source.program.getTypeChecker();
  const exported = new Map(
    checker
      .getExportsOfModule(checker.getSymbolAtLocation(source.program.getSourceFile(source.sources[0])))
      .map((symbol) => [symbol.name, symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol]),
  );

  const { blocks, errors: blockErrors } = pageBlocks();
  const previews = blocks.filter((block) => block.preview).map((block) => Object.assign({ block }, block.preview));
  const errors = [
    ...blockErrors,
    ...checkIndex(pages, checker, exported),
    ...checkPreviewImages(pages, previews),
    ...checkImageNames(),
  ];

  const tables = await writeTables(pages, { check, checker, exported });
  errors.push(...tables.errors);

  // Compiled against the published types to render; `check:readme` compiles them in `check:all`, so a check only runs.
  const checked = checkSnippets(blocks, { compile: !check });
  errors.push(...checked.errors);
  const shown = previewResults(previews, checked);
  errors.push(...shown.errors);
  if (errors.length > 0) return { errors };

  if (check) {
    return {
      errors: [
        ...stalePreviews(previews, shown.fingerprints, readFingerprints(PREVIEW_FINGERPRINTS)),
        ...readmePreviewErrors(),
      ],
      summary:
        `docs/components: ${pages.length} pages, ${previews.length} previews up to date with their snippet, ` +
        `${tables.count} tables up to date.`,
    };
  }

  const rendered = renderPreviews(previews, { only, checked, shown });
  // Naming pages keeps the other images and their fingerprints as committed: the bytes of a PNG depend on the poppler
  // version. The fingerprints of previews that no longer exist go.
  const kept = readFingerprints(PREVIEW_FINGERPRINTS);
  const fingerprints = Object.fromEntries(
    previews
      .map(({ name }) => [name, rendered.includes(name) ? shown.fingerprints.get(name) : kept[name]])
      .filter(([, value]) => value !== undefined),
  );
  writeFingerprints(PREVIEW_FINGERPRINTS, fingerprints);
  return {
    errors: stalePreviews(previews, shown.fingerprints, fingerprints),
    summary:
      `docs/components: ${pages.length} pages, ${checked.snippets.length} snippets compiled and run, ` +
      `${rendered.length} of ${previews.length} previews rendered, ${tables.count} tables written.`,
  };
}

// === Arguments ===

/** `--check`, and the pages to render, named with or without `.md`. An unknown page or option lists the valid ones. */
function parseArguments(args, pages) {
  const errors = [];
  for (const flag of args.filter((arg) => arg.startsWith('--') && arg !== '--check')) {
    errors.push(`Unknown option ${flag}. Usage: node scripts/docs-components.mjs [--check] [page…]`);
  }
  const only = args.filter((arg) => !arg.startsWith('--')).map((arg) => `${arg.replace(/\.md$/, '')}.md`);
  const known = pages.map((page) => page.name).filter((name) => name !== INDEX);
  for (const name of only.filter((each) => !known.includes(each))) {
    errors.push(
      `docs/components/${name} does not exist. The pages are: ${known.map((each) => each.replace(/\.md$/, '')).join(', ')}`,
    );
  }
  const check = args.includes('--check');
  if (check && only.length > 0) errors.push('--check verifies every page: name no page with it');
  return { check, only, errors };
}

// === The index ===

const frontMatter = (text) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';

/**
 * An error for each page the index does not publish or link under its title, and each title that is neither a list of
 * `PDFDocument` methods (`paragraph, paragraphs`) nor in sentence case (`Flow control`): the navigation of the site
 * lists the titles side by side.
 */
function checkIndex(pages, checker, exported) {
  const errors = [];
  const index = pages.find((page) => page.name === INDEX);
  if (!index) return [`docs/components/${INDEX} is missing: it is the index of the pages, and what typedoc publishes`];
  const children = [...frontMatter(index.text).matchAll(/^\s+- (\S+)$/gm)].map(([, child]) => child);
  // The tables of the index list the pages under their titles; prose may link a page in its own words.
  const links = new Map();
  for (const link of index.text.matchAll(/^\| \[([^\]]+)\]\(([\w-]+\.md)\)/gm)) links.set(link[2], link);
  const methods = new Set(
    checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(exported.get('PDFDocument'))).map((s) => s.name),
  );
  for (const page of pages) {
    const title = /^title: (.+)$/m.exec(frontMatter(page.text))?.[1];
    const heading = /^# (.+)$/m.exec(page.text);
    if (!title) {
      errors.push(`${page.file}:1: no \`title:\` in the front matter: add the title the navigation shows`);
      continue;
    }
    if (heading?.[1] !== title) {
      const at = heading ? lineOf(page.text, heading.index) : 1;
      errors.push(`${page.file}:${at}: the first heading must be "# ${title}", the title of the front matter`);
    }
    const names = title.split(', ');
    if (!names.every((name) => methods.has(name)) && !/^[A-Z][^A-Z]*$/.test(title)) {
      errors.push(
        `${page.file}:2: the title "${title}" is neither the methods the page covers (\`paragraph, paragraphs\`) ` +
          'nor in sentence case (`Flow control`): rename it, here and in the index',
      );
    }
    if (page === index) continue;
    if (!children.includes(page.name)) {
      errors.push(`docs/components/${INDEX}:2: ${page.name} is not in \`children\` of the front matter: add it`);
    }
    const link = links.get(page.name);
    if (!link) {
      errors.push(`docs/components/${INDEX}: ${page.name} is not linked from a table: add a row for it`);
    } else if (link[1] !== title) {
      errors.push(
        `docs/components/${INDEX}:${lineOf(index.text, link.index)}: the link to ${page.name} reads "${link[1]}": ` +
          `write the title of the page, "${title}"`,
      );
    }
  }
  for (const child of children.filter((each) => !pages.some((page) => page.name === each))) {
    errors.push(`docs/components/${INDEX}:2: \`children\` lists ${child}, which does not exist: remove it`);
  }
  return errors;
}

// === Previews: markers and images ===

// The previews a page shows, `![alt](../images/components/<name>.png)` or an `<img>` tag (a whole page, shown smaller).
const imageRefs = (text) => [
  ...[...text.matchAll(/!\[([^\]]*)\]\(\.\.\/images\/components\/([\w-]+)\.png\)/g)].map((match) => ({
    name: match[2],
    alt: match[1],
    index: match.index,
  })),
  ...[...text.matchAll(/<img [^>]*src="\.\.\/images\/components\/([\w-]+)\.png"[^>]*>/g)].map((match) => ({
    name: match[1],
    alt: /\balt="([^"]*)"/.exec(match[0])?.[1] ?? '',
    index: match.index,
  })),
];

const pngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.png')) : []);

/**
 * An error for each preview whose image the page does not show, each image no preview renders or that has no
 * alternative text, each marker above no snippet, each name used twice, and each image of the folder no page uses.
 */
function checkPreviewImages(pages, previews) {
  const errors = [];
  for (const page of pages) {
    const own = previews.filter((preview) => preview.block.file === page.file);
    const refs = imageRefs(page.text);
    for (const { name, line } of own) {
      if (!refs.some((ref) => ref.name === name)) {
        errors.push(
          `${page.file}:${line}: the preview \`${name}\` is rendered, but the page does not show it: add ` +
            `![…](../images/components/${name}.png) under the marker`,
        );
      }
    }
    for (const { name, alt, index } of refs) {
      const where = `${page.file}:${lineOf(page.text, index)}`;
      if (!own.some((preview) => preview.name === name)) {
        errors.push(
          `${where}: shows ${name}.png, which no \`<!-- preview: ${name} -->\` above a snippet of the page renders: ` +
            'add the marker, or remove the image',
        );
      }
      if (alt.trim() === '') errors.push(`${where}: the image ${name}.png has no alternative text: describe it`);
    }
    // A marker with no snippet under it draws nothing.
    for (const marker of page.text.matchAll(/^<!-- preview: ([\w-]+).*-->$/gm)) {
      if (!own.some((preview) => preview.name === marker[1])) {
        errors.push(
          `${page.file}:${lineOf(page.text, marker.index)}: the preview \`${marker[1]}\` is not above a \`ts\` ` +
            'snippet: move it there, or remove it',
        );
      }
    }
  }
  const names = previews.map((preview) => preview.name);
  for (const name of new Set(names.filter((each, at) => names.indexOf(each) !== at))) {
    const where = previews.filter((preview) => preview.name === name).map((p) => `${p.block.file}:${p.line}`);
    errors.push(`${where.join(', ')}: the preview name \`${name}\` is used more than once: rename one`);
  }
  for (const file of pngs(PREVIEWS)) {
    if (!names.includes(file.replace(/\.png$/, ''))) {
      errors.push(`docs/images/components/${file} is rendered by no page: delete it`);
    }
  }
  return errors;
}

/** An error for each image name shared by `docs/images` and `docs/images/components`: typedoc copies both flat. */
function checkImageNames() {
  const readme = new Set(pngs(join(ROOT, 'docs', 'images')));
  return pngs(PREVIEWS)
    .filter((name) => readme.has(name))
    .map(
      (name) =>
        `docs/images/components/${name} and docs/images/${name} share a name: typedoc copies the images of the ` +
        'site into one folder, where one would replace the other; rename one',
    );
}

// === Tables ===

const OPTIONS_BLOCK = /<!-- options: (\w+) -->\n([\s\S]*?)<!-- \/options -->/g;
const GENERATED_BLOCK = /<!-- table: ([\w-]+) -->\n([\s\S]*?)<!-- \/table -->/g;

/**
 * Writes the option tables and the generated tables of every page, or, with `check`, an error for each one out of
 * date. Returns the errors and the number of tables.
 */
async function writeTables(pages, { check, checker, exported }) {
  const errors = [];
  const generated = await generatedTables(checker, exported);
  errors.push(...generated.errors);
  const rewritten = [];
  let count = 0;
  for (const page of pages) {
    const update = (kind, name, current, at, build) => {
      count++;
      const where = `${page.file}:${lineOf(page.text, at)}`;
      const { table, problems } = build();
      errors.push(...problems.map((problem) => `${where}: ${problem}`));
      if (table === undefined || sameTable(current, table)) return undefined;
      if (check) {
        errors.push(
          `${where}: the ${kind} table \`${name}\` is out of date:\n${tableDiff(current, table)}\n` +
            `  run \`${COMMAND}\` and commit the page`,
        );
        return undefined;
      }
      return table;
    };
    const text = page.text
      .replace(OPTIONS_BLOCK, (whole, typeName, current, at) => {
        const table = update('options', typeName, current, at, () => optionsTable(checker, exported, typeName));
        return table === undefined ? whole : `<!-- options: ${typeName} -->\n\n${table}\n\n<!-- /options -->`;
      })
      .replace(GENERATED_BLOCK, (whole, name, current, at) => {
        const table = update('generated', name, current, at, () =>
          name in generated.tables
            ? { table: generated.tables[name], problems: [] }
            : {
                problems: [
                  `\`<!-- table: ${name} -->\` names no generated table: use one of ` +
                    `${Object.keys(GENERATED_TABLES).join(', ')}, or add it to GENERATED_TABLES in scripts/docs-components.mjs`,
                ],
              },
        );
        return table === undefined ? whole : `<!-- table: ${name} -->\n\n${table}\n\n<!-- /table -->`;
      });
    if (text !== page.text) {
      writeFileSync(page.path, text);
      rewritten.push(page.path);
      console.log(`${page.file}: tables written`);
    }
  }
  // The tables are written unaligned: left so, the pages would fail `pnpm fmt:check`.
  if (rewritten.length > 0) run('pnpm', ['exec', 'oxfmt', '--write', ...rewritten], { stdout: 'ignore' });
  return { errors, count };
}

const cell = (text) => text.replaceAll('|', '\\|');
const oneLine = (text) => text.replace(/\s+/g, ' ').trim();
const markdownTable = (header, rows) =>
  [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');

// The formatter aligns the columns: compare the cells, not the padding.
const tableRows = (table) =>
  table
    .trim()
    .split('\n')
    .map((row) =>
      row
        .split(/(?<!\\)\|/)
        .map((part) => part.trim().replace(/^:?-+:?$/, '---'))
        .join('|'),
    );
const sameTable = (a, b) => tableRows(a).join('\n') === tableRows(b).join('\n');

/** The rows that differ between the table of the page and the one wanted, as a diff. */
function tableDiff(current, wanted) {
  const have = tableRows(current);
  const want = tableRows(wanted);
  const lines = [
    ...have.filter((row) => !want.includes(row)).map((row) => `  - ${row}`),
    ...want.filter((row) => !have.includes(row)).map((row) => `  + ${row}`),
  ];
  return lines.length > 0 ? lines.join('\n') : '  the rows are the same, in another order';
}

// --- Option tables ---

const declarationOf = (property) => property.valueDeclaration ?? property.declarations?.[0];

/** `file:line` of the declaration of a property. */
function declaredAt(property) {
  const declaration = declarationOf(property);
  if (!declaration) return 'its declaration';
  const file = declaration.getSourceFile();
  return `${relative(ROOT, file.fileName)}:${file.getLineAndCharacterOfPosition(declaration.getStart()).line + 1}`;
}

/** The sentence `Default: …` of a description, taken out: `{ value, rest }`; `value` is `undefined` without one. */
function splitDefault(description) {
  const match = /(?:^|(?<=\s))Default: (.+?)(?<=\S)\.(?=\s|$)/.exec(description);
  if (!match) return { rest: description };
  const rest = oneLine(description.slice(0, match.index) + ' ' + description.slice(match.index + match[0].length));
  return { value: match[1], rest };
}

/**
 * The properties of an object type in the order a reader meets them: its own first, then each inherited type, as the
 * checker lists them; within one declaration, in source order, since the checker orders the properties of a mapped type
 * (`Omit<…>`) by what it happened to check first. What is `@internal` is left out.
 */
function propertiesOf(checker, type) {
  const properties = checker
    .getPropertiesOfType(type)
    .filter((property) => !property.getJsDocTags(checker).some((tag) => tag.name === 'internal'));
  const parents = [...new Set(properties.map((property) => declarationOf(property)?.parent))];
  const rank = (property) => parents.indexOf(declarationOf(property)?.parent);
  return properties.toSorted(
    (a, b) => rank(a) - rank(b) || (declarationOf(a)?.pos ?? 0) - (declarationOf(b)?.pos ?? 0),
  );
}

/** The type of a property as written in its declaration, on one line, without the comments of an inline object. */
function typeText(checker, property) {
  return oneLine(
    (
      declarationOf(property)?.type?.getText() ??
      checker.typeToString(checker.getTypeOfSymbol(property), undefined, ts.TypeFormatFlags.NoTruncation)
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/;\s*}/g, ' }'),
  );
}

/** How a member of a union is named in a description: by its `variant` (`variant: 'callout'`), else by its type. */
function variantName(checker, member) {
  const variant = checker.getPropertyOfType(member, 'variant');
  const literal = variant && checker.getNonNullableType(checker.getTypeOfSymbol(variant));
  if (literal?.isStringLiteral()) return `\`variant: '${literal.value}'\``;
  return `\`${checker.typeToString(member)}\``;
}

/**
 * The rows of an exported object type, and the problems that keep a row from being written. A union lists the
 * properties of its object members together: a property is required when every member requires it, and one that only
 * some members take says which. Every property has a description, the same in every member that takes it.
 */
function propertyRows(checker, type, typeName) {
  const members = (type.isUnion() ? type.types : [type]).filter(
    (member) => member.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection),
  );
  const rows = new Map();
  for (const member of members) {
    for (const property of propertiesOf(checker, member)) {
      const text = typeText(checker, property);
      // `eyebrow?: never` only forbids the option of another variant.
      if (text === 'never') continue;
      const row = rows.get(property.name) ?? {
        name: property.name,
        types: [],
        required: 0,
        members: [],
        texts: [],
        said: new Map(),
      };
      if (!row.types.includes(text)) row.types.push(text);
      if (!(property.flags & ts.SymbolFlags.Optional)) row.required++;
      row.members.push(member);
      const description = oneLine(ts.displayPartsToString(property.getDocumentationComment(checker)));
      row.said.set(description, [...(row.said.get(description) ?? []), declaredAt(property)]);
      row.texts.push(description);
      rows.set(property.name, row);
    }
  }
  const problems = [];
  const result = [...rows.values()].map((row) => {
    // The `variant` that tells the members apart says what each one is: its row lists them.
    const discriminant = row.name === 'variant' && row.members.length === members.length && members.length > 1;
    const description = discriminant
      ? row.members
          .map((member, index) => `${variantName(checker, member)}: ${splitDefault(row.texts[index]).rest}`)
          .join(' ')
      : [...row.said.keys()][0];
    if (row.said.size > 1 && !discriminant) {
      problems.push(
        `\`${typeName}.${row.name}\` is described differently by the members of the union:\n` +
          [...row.said].map(([text, at]) => `    ${at.join(', ')}: "${text}"`).join('\n') +
          '\n  give them one description',
      );
    }
    const { rest } = splitDefault(description);
    // A discriminant takes the default one of its members gives, `variant: 'surface'` when it is left out.
    const value = (discriminant ? row.texts : [description]).map((text) => splitDefault(text).value).find(Boolean);
    if (rest === '') {
      problems.push(
        `\`${typeName}.${row.name}\` has no description: say what it does in its JSDoc (${[...row.said.values()][0][0]})`,
      );
    }
    if (/\bDefault\b/.test(rest)) {
      problems.push(
        `\`${typeName}.${row.name}\`: its JSDoc gives a default the table cannot read: write it as one sentence ` +
          `\`Default: <value>.\` (${[...row.said.values()][0][0]})`,
      );
    }
    const partial = row.members.length < members.length;
    const only = partial ? ` Only with ${row.members.map((member) => variantName(checker, member)).join(' or ')}.` : '';
    const required = !partial && row.required === members.length;
    return { name: row.name, types: row.types, default: value ?? (required ? 'required' : ''), text: rest + only };
  });
  return { rows: result, problems };
}

/** The table of an exported object type, and the problems that keep it from being written. */
function optionsTable(checker, exported, typeName) {
  const symbol = exported.get(typeName);
  if (!symbol) return { problems: [`\`${typeName}\` is not exported from src/index.ts: name an exported type`] };
  const { rows, problems } = propertyRows(checker, checker.getDeclaredTypeOfSymbol(symbol), typeName);
  if (rows.length === 0) return { problems: [...problems, `\`${typeName}\` has no property to list`] };
  if (problems.length > 0) return { problems };
  const table = markdownTable(
    ['Option', 'Type', 'Default', 'Description'],
    rows.map((row) => [
      `\`${row.name}\``,
      `\`${cell(row.types.join(' | '))}\``,
      cell(row.default),
      cell(oneLine(row.text)),
    ]),
  );
  return { table, problems: [] };
}

// --- Generated tables ---

/** The red, green and blue channels (0 to 255) of a `#rrggbb` color. */
const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** A number for a table cell: finite, printed with two decimals at most. */
function formatNumber(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} is ${JSON.stringify(value)}: a generated table only prints finite numbers`);
  }
  return String(Math.round(value * 100) / 100);
}

/** The string literals of the exported union type `name`, in source order (`TextLevel`). */
function literalsOf(exported, name) {
  const declaration = exported.get(name)?.declarations?.find(ts.isTypeAliasDeclaration);
  if (!declaration || !ts.isUnionTypeNode(declaration.type)) {
    throw new Error(`\`${name}\` is no exported union of string literals in src/index.ts`);
  }
  return declaration.type.types.map((node) => {
    if (!ts.isLiteralTypeNode(node) || !ts.isStringLiteral(node.literal)) {
      throw new Error(`\`${name}\` has a member that is no string literal: ${node.getText()}`);
    }
    return node.literal.text;
  });
}

/**
 * The tables computed from the built package, each a function of the package (`dist/index.js`) and of the exported
 * names of the sources. They read what the code does, so they cannot drift from it.
 */
const GENERATED_TABLES = {
  // Each level set by `setTextStyle` in a theme where every size and every font role is told apart, then read back.
  'text-levels': (api, exported) => {
    const keys = Object.keys(api.DEFAULT_TYPOGRAPHY.sizes);
    const marked = Object.fromEntries(keys.map((key, index) => [key, 100 + index]));
    const roles = { helvetica: 'body', times: 'title', courier: 'label' };
    const theme = api.createTheme({
      typography: { fontFamily: 'helvetica', titleFontFamily: 'times', labelFontFamily: 'courier', sizes: marked },
    });
    const doc = new api.PDFDocument({ theme });
    // jsPDF reads a color back from the page in steps of 1/255 of its own rounding: a channel may be one step off.
    const tokenOf = (hex) => {
      const close = (value) => channels(value).every((channel, index) => Math.abs(channel - channels(hex)[index]) <= 1);
      const tokens = Object.entries(doc.theme.colors).filter(([, value]) => close(value));
      if (tokens.length !== 1) throw new Error(`the text color ${hex} matches ${tokens.length} palette tokens`);
      return tokens[0][0];
    };
    const rows = literalsOf(exported, 'TextLevel').map((level) => {
      api.setTextStyle(doc, level);
      const size = keys.find((key) => marked[key] === doc.doc.getFontSize());
      const { fontName, fontStyle } = doc.doc.getFont();
      const defaultSize = formatNumber(api.DEFAULT_TYPOGRAPHY.sizes[size], `typography.sizes.${size}`);
      return [
        `\`${level}\``,
        `\`${size}\`, ${defaultSize} pt`,
        fontStyle.includes('bold') ? 'bold' : 'regular',
        fontStyle.includes('italic') ? 'italic' : 'upright',
        `\`${tokenOf(doc.doc.getTextColor())}\``,
        `\`${roles[fontName]}\``,
      ];
    });
    return markdownTable(['Level', 'Size (`typography.sizes`)', 'Weight', 'Slant', 'Color', 'Family'], rows);
  },
  'spacing-scale': (api) =>
    markdownTable(
      ['Step', 'mm'],
      Object.entries(api.SPACING).map(([step, mm]) => [`\`SPACING.${step}\``, formatNumber(mm, `SPACING.${step}`)]),
    ),
  'heading-spacing': (api) =>
    markdownTable(
      ['Level', '`before` (mm)', '`after` (mm)'],
      Object.entries(api.DEFAULT_SPACING.heading).map(([level, { before, after }]) => [
        `\`${level}\``,
        formatNumber(before, `DEFAULT_SPACING.heading.${level}.before`),
        formatNumber(after, `DEFAULT_SPACING.heading.${level}.after`),
      ]),
    ),
};

/** Every generated table, computed from `dist/index.js`, and an error for each one that cannot be. */
async function generatedTables(checker, exported) {
  const entry = join(ROOT, 'dist', 'index.js');
  if (!existsSync(entry))
    return { tables: {}, errors: ['dist/index.js missing: the tables read the built package; run `pnpm build` first'] };
  const api = await import(pathToFileURL(entry).href);
  const tables = {};
  const errors = [];
  for (const [name, build] of Object.entries(GENERATED_TABLES)) {
    try {
      tables[name] = build(api, exported, checker);
    } catch (error) {
      errors.push(
        `scripts/docs-components.mjs: the table \`${name}\` cannot be generated: ${error.message}: fix its function ` +
          'in GENERATED_TABLES, or the code it reads',
      );
    }
  }
  return { tables, errors };
}

// === Previews: fingerprints and rendering ===

/**
 * The fingerprint of each preview, from its snippet and what the run drew, and an error for each preview that cannot
 * be rendered: a crop that spans several pages, a page past the end.
 */
function previewResults(previews, checked) {
  const resultOf = new Map(checked.results.map((result) => [result.id, result]));
  const demo = checked.snippets.find((snippet) => snippet.demo);
  const assets = assetsHash();
  const fingerprints = new Map();
  const results = new Map();
  const errors = [];
  for (const { name, page, line, block } of previews) {
    const shown = resultOf.get(block.id)?.preview;
    // The snippet threw: its error is already reported.
    if (!shown) continue;
    const where = `${block.file}:${line}: the preview \`${name}\``;
    if (page === undefined && shown.pageCount > 1) {
      errors.push(`${where} spans ${shown.pageCount} pages: render whole pages with \`page=N\` in the marker`);
    }
    if (page !== undefined && page > shown.pageCount) {
      errors.push(`${where} asks for page ${page} of ${shown.pageCount}: fix \`page=\` in the marker`);
    }
    results.set(name, shown);
    fingerprints.set(
      name,
      hashOf({
        code: block.code,
        page: page ?? null,
        settings: PREVIEW_SETTINGS,
        demo: block.docFrom === 'demo' ? demo.code : null,
        assets,
        shown,
      }),
    );
  }
  return { fingerprints, results, errors };
}

/** An error for each preview whose image is missing or was rendered from another snippet or another run. */
function stalePreviews(previews, fingerprints, recorded) {
  const stale = previews.filter(
    ({ name }) => !existsSync(join(PREVIEWS, `${name}.png`)) || recorded[name] !== fingerprints.get(name),
  );
  if (stale.length === 0) return [];
  const pagesOf = [...new Set(stale.map(({ block }) => block.file.replace(/^docs\/components\/|\.md$/g, '')))];
  const errors = stale.map(({ name, line, block }) => {
    const missing = !existsSync(join(PREVIEWS, `${name}.png`));
    return `${block.file}:${line}: docs/images/components/${name}.png ${missing ? 'is missing' : 'no longer shows what its snippet draws'}`;
  });
  errors[errors.length - 1] +=
    `\n  render them: \`${COMMAND} ${pagesOf.join(' ')}\`, read each new image, and commit them with fingerprints.json`;
  return errors;
}

/** Renders the previews of the pages named, or of every page. Returns the names rendered. */
function renderPreviews(previews, { only, checked, shown }) {
  requirePoppler('pdftoppm');
  mkdirSync(PREVIEWS, { recursive: true });
  const rendered = [];
  for (const { name, page, block } of previews) {
    if (only.length > 0 && !only.includes(block.file.split('/').pop())) continue;
    const result = shown.results.get(name);
    const target = join(PREVIEWS, name);
    renderPagePng(join(checked.dir, `${block.id}.pdf`), target, {
      page: page ?? 1,
      width: page === undefined ? PREVIEW_SETTINGS.cropWidth : PREVIEW_SETTINGS.pageWidth,
      band: result.band,
      pageWidth: result.pageWidth,
    });
    console.log(`${relative(ROOT, target)}.png  (${Math.round(statSync(`${target}.png`).size / 1024)} kB)`);
    rendered.push(name);
  }
  return rendered;
}

// Last: `main` reads the constants above, which a module initializes in order.
const { errors, summary } = await main();
if (errors.length > 0) fail(`${errors.join('\n')}\n\ndocs/components: ${errors.length} problem(s).`);
console.log(summary);
