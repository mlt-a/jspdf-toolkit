// Keeps the documentation true to the published package:
//
//   1. every code block of the README, of the component pages (`docs/components`) and of the JSDoc comments under `src/`
//      has a language the script knows;
//   2. every `ts` block is compiled as its own module against the declarations of `dist/`, through the `exports` of
//      `package.json`, then run under Node up to the PDF: `toBuffer()` on every document it builds or receives. It
//      fails when it throws or leaves a warning in `doc.warnings`. A block marked `// browser only` is compiled, not run;
//      one that starts with `// warns: <part of a warning>` shows that warning on purpose: it must leave it, and no
//      other;
//   3. the README names every export of the three entry points, by its exact name in code, and lists every public
//      method and accessor of `PDFDocument` in its table of methods and every exported type in its table of types;
//   4. every API name the README, the component pages or the changelog put in code exists in the published types;
//   5. no public JSDoc cites in code a member that is `@internal`, hence absent from the published types;
//   6. every exported function and every public `PDFDocument` method or accessor has an `@example`, a member a `@group`
//      too, and every `@group` is one of `groupOrder` in `typedoc.json`.
//
//   pnpm build && node scripts/check-readme.mjs
//
// A README block is standalone, or starts with "// assumes `doc` from Quick start": its `doc` is then the document of
// the Quick start, filled, before its export. A JSDoc example gets the same `doc` and the sample values of `SAMPLES`;
// it imports every other name itself. A block of a component page that uses `doc` without declaring it gets the demo
// document of the pages, built by the snippet marked `<!-- demo document -->`. `scripts/_shared.mjs` holds the
// compile-and-run machinery and the program of the sources, which `docs-components.mjs` shares.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

import {
  BROWSER_ONLY,
  ROOT,
  checkLanguages,
  checkSnippets,
  fail,
  fencedBlocks,
  lineOf,
  pageBlocks,
  pageNames,
  sourceProgram,
  stripJsdoc,
} from './_shared.mjs';

// The README section whose first `ts` block builds the `doc` the other examples assume.
const QUICK_START = 'Quick start';

// Names the README cites in code that are not API: values of the language and of the platform, the runner of the
// examples, and the patterns that stand for a family of primitives. Each one must still be needed.
const OUTSIDE = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'TypeError',
  'jspdf',
  'tsx',
  'drawX',
  'computeXHeight',
  'measureX',
]);
const CITING = ['README.md', 'CHANGELOG.md', ...pageNames().map((name) => `docs/components/${name}`)];

/** The code blocks of the README, and the `ts` block of its Quick start section: the `doc` the examples assume. */
function readmeBlocks() {
  const lines = readFileSync(join(ROOT, 'README.md'), 'utf8').split('\n');
  const { blocks, errors } = fencedBlocks('README.md', lines);
  const range = sectionRange('README.md', QUICK_START);
  const quickStart =
    range &&
    blocks.find((block) => block.language === 'ts' && block.fenceLine <= range.to && block.fenceLine >= range.from);
  if (!quickStart) {
    errors.push(
      `README.md: ${range === null ? `no "${QUICK_START}" section` : `the "${QUICK_START}" section has no \`ts\` block`}: ` +
        'the examples assume its document, built by its first `ts` block',
    );
  }
  return { blocks, errors, quickStart };
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * The JSDoc comments of `src/`: their code blocks, their `@group` values, and an error for each `@example` without a
 * `ts` block. An `@example` runs to the next tag or the end of its comment; every block in it is read.
 */
function jsdocBlocks() {
  const blocks = [];
  const groups = [];
  const errors = [];
  for (const path of sourceFiles(join(ROOT, 'src'))) {
    const file = relative(ROOT, path);
    const lines = readFileSync(path, 'utf8').split('\n');
    for (let start = 0; start < lines.length; start++) {
      if (!/^\s*\/\*\*/.test(lines[start]) || /\*\//.test(lines[start])) continue;
      let end = start + 1;
      while (end < lines.length && !/\*\//.test(lines[end])) end++;
      const body = lines.slice(start + 1, end);
      const found = fencedBlocks(file, body, { source: 'jsdoc', offset: start + 1 });
      blocks.push(...found.blocks);
      errors.push(...found.errors);
      // Tags outside the code blocks: a line of code that starts with `@` is no tag.
      const inBlock = (line) =>
        found.blocks.some((block) => line >= block.line && line < block.line + block.code.length);
      const tags = body
        .map((line, index) => ({ text: stripJsdoc(line), line: start + 2 + index }))
        .filter(({ text, line }) => /^@\w+/.test(text) && !inBlock(line));
      tags.forEach((tag, index) => {
        const [, name, value] = /^@(\w+)\s*(.*)$/.exec(tag.text);
        if (name === 'group') groups.push({ file, line: tag.line, value: value.trim() });
        if (name !== 'example') return;
        const until = tags[index + 1]?.line ?? end + 1;
        const own = found.blocks.filter((block) => block.fenceLine > tag.line && block.fenceLine < until);
        if (!own.some((block) => block.language === 'ts')) {
          errors.push(`${file}:${tag.line}: @example without a \`\`\`ts block: add the code under the tag`);
        }
      });
      start = end;
    }
  }
  return { blocks, groups, errors };
}

// === The published names ===

const inDist = (declaration) => declaration.getSourceFile().fileName.startsWith(join(ROOT, 'dist') + '/');

// `file:line` of the declaration of `symbol`.
function declaredAt(symbol) {
  const declaration = symbol.valueDeclaration ?? symbol.declarations[0];
  const file = declaration.getSourceFile();
  return `${relative(ROOT, file.fileName)}:${file.getLineAndCharacterOfPosition(declaration.getStart()).line + 1}`;
}

const isHidden = (declaration) =>
  ts.getCombinedModifierFlags(declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected);

/**
 * What the published declarations offer: the exports of each entry point, the public members of `PDFDocument`, and
 * the types of every property of a published type, by property name.
 */
function publishedNames(program, entries) {
  const checker = program.getTypeChecker();
  const exported = new Map();
  const entryOf = new Map();
  for (const { types, specifier } of entries) {
    const module = checker.getSymbolAtLocation(program.getSourceFile(types));
    for (const symbol of checker.getExportsOfModule(module)) {
      exported.set(symbol.name, symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
      entryOf.set(symbol.name, specifier);
    }
  }
  const typeOf = (symbol) => {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    return checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(symbol, declaration));
  };
  const documentType = checker.getDeclaredTypeOfSymbol(exported.get('PDFDocument'));
  const publicMembers = checker
    .getPropertiesOfType(documentType)
    .filter((symbol) => !symbol.declarations?.some(isHidden));
  const members = publicMembers.map((symbol) => symbol.name);
  // Methods and accessors: what the table of methods must list.
  const callable = new Map(
    publicMembers
      .filter((symbol) => symbol.flags & (ts.SymbolFlags.Method | ts.SymbolFlags.Accessor))
      .map((symbol) => [symbol.name, symbol.flags & ts.SymbolFlags.Method ? 'method' : 'accessor']),
  );

  // Property or parameter name → the types it has, wherever a published type declares it; and the string values of
  // the published unions (`'stacked'`, `'bodyBold'`).
  const properties = new Map();
  const literals = new Set();
  const add = (name, type) => properties.set(name, [...(properties.get(name) ?? []), type]);
  const seen = new Set();
  const walk = (type) => {
    if (seen.has(type)) return;
    seen.add(type);
    if (type.isUnionOrIntersection()) return type.types.forEach(walk);
    if (checker.isArrayType(type) || checker.isTupleType(type)) return checker.getTypeArguments(type).forEach(walk);
    if (type.isStringLiteral()) literals.add(type.value);
    // A callback names its parameters (`draw(ctx, title)`): the README may cite them.
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      for (const parameter of signature.getParameters()) {
        const parameterType = typeOf(parameter);
        if (parameter.declarations?.some(inDist)) add(parameter.name, parameterType);
        walk(parameterType);
      }
      walk(signature.getReturnType());
    }
    for (const property of type.getProperties?.() ?? []) {
      const declarations = property.declarations ?? [];
      if (!declarations.some(inDist) || declarations.some(isHidden)) continue;
      const propertyType = typeOf(property);
      add(property.name, propertyType);
      walk(propertyType);
    }
  };
  for (const symbol of exported.values()) {
    if (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class)) {
      walk(checker.getDeclaredTypeOfSymbol(symbol));
    }
    if (symbol.flags & ts.SymbolFlags.Value) walk(typeOf(symbol));
  }
  return { checker, exported, entryOf, documentType, members, callable, properties, literals, typeOf };
}

/** The inline code spans of a Markdown file, outside its code blocks, each `{ text, line }`. */
function codeSpans(file) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const { blocks } = fencedBlocks(file, text.split('\n'));
  const lines = text.split('\n');
  for (const block of blocks) {
    for (let line = block.fenceLine - 1; line < block.line + block.code.length; line++) lines[line] = '';
  }
  // The option tables of the component pages are written from the JSDoc: its words are not the page's to check.
  const prose = lines
    .join('\n')
    .replace(/<!-- options: [\s\S]*?<!-- \/options -->/g, (table) => table.replace(/[^\n]/g, ''));
  return [...prose.matchAll(/`([^`]+)`/g)].map((match) => ({ text: match[1], line: lineOf(prose, match.index) }));
}

/**
 * The line range `{ from, to }` of the body of the section of `file` titled `title`, up to the next heading of its level
 * or above; `null` when there is none. A `#` line in a code block is no heading.
 */
function sectionRange(file, title) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  let level = 0;
  let from = 0;
  let inBlock = false;
  for (const [index, text] of lines.entries()) {
    if (text.trim().startsWith('```')) inBlock = !inBlock;
    const heading = inBlock ? null : /^(#{1,6})\s+(.*?)\s*$/.exec(text);
    if (!heading) continue;
    if (level === 0) {
      if (heading[2] === title) {
        level = heading[1].length;
        from = index + 2;
      }
    } else if (heading[1].length <= level) {
      return { from, to: index };
    }
  }
  return level === 0 ? null : { from, to: lines.length };
}

// The sections of the README where each kind of name is listed.
const METHODS_SECTION = 'Every method at a glance';
const TYPES_SECTION = 'Exported types';

// The section of the README that a published value belongs to, for the error that asks for it.
function sectionFor(name, specifier) {
  if (name.endsWith('Error')) return 'Finalize, export, warnings and errors';
  if (specifier.endsWith('/node')) return 'Node and browser';
  if (specifier.endsWith('/fonts/inter')) return 'Fonts';
  if (/^(draw|compute|measure|layout)/.test(name)) return 'Low-level primitives and custom components';
  if (/^load(Font|ImageFrom(Base64|Binary))/.test(name)) return name.includes('Font') ? 'Fonts' : 'Node and browser';
  if (/theme|palette|color|contrast|readable|tint|hex|rgb/i.test(name)) return 'Theming and presets';
  return 'the section of the feature it serves';
}

/**
 * An error for each published name the README does not cite as it must: a public method or accessor of `PDFDocument` in
 * the table of methods, an exported type in the table of types, an exported function or constant by its exact name,
 * either as a call (`name(`) or as a code passage that holds only that name. A word that merely looks like it, in a
 * passage about something else, does not count.
 */
function checkNamed({ exported, entryOf, callable }, code) {
  const errors = [];
  const spans = codeSpans('README.md');
  const spansIn = (title) => {
    const range = sectionRange('README.md', title);
    if (range === null) {
      errors.push(`README.md: no "${title}" section: the check reads the names it must hold from it`);
      return [];
    }
    return spans.filter(({ line }) => line >= range.from && line <= range.to).map(({ text }) => text.trim());
  };

  // A method is cited as `name(…)`, an accessor as `name`, in the table: its first name is the member.
  const listed = new Set(spansIn(METHODS_SECTION).map((text) => /^(?:doc\.)?([A-Za-z_$][\w$]*)/.exec(text)?.[1]));
  for (const [name, kind] of callable) {
    if (listed.has(name)) continue;
    errors.push(
      `README.md: PDFDocument.${name} is a public ${kind} missing from the table "${METHODS_SECTION}": add a row for ` +
        `it, with \`${name}${kind === 'method' ? '(…)' : ''}\` in code`,
    );
  }

  const typed = new Set(spansIn(TYPES_SECTION));
  for (const [name, symbol] of exported) {
    if (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias) && !typed.has(name)) {
      errors.push(
        `README.md: type \`${name}\` is exported but missing from "${TYPES_SECTION}": add it to the row of its area`,
      );
    }
    if (!(symbol.flags & ts.SymbolFlags.Value)) continue;
    const exact = new RegExp(`^(?:new\\s+)?${name.replace(/\$/g, '\\$')}(\\(.*)?$`, 's');
    const called = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\(`);
    if (spans.some(({ text }) => exact.test(text.trim())) || called.test(code)) continue;
    errors.push(
      `README.md: \`${name}\` is published but never cited by its exact name: write \`${name}(…)\` or \`${name}\` in ` +
        `code, in ${sectionFor(name, entryOf.get(name))}`,
    );
  }
  return errors;
}

/**
 * An error for each name a file cites in code that the published types lack. `doc.x` must be a public member of
 * `PDFDocument`; any other path is read from a published name, property by property.
 */
function checkCited(file, published, used) {
  const { checker, exported, documentType, properties, literals, typeOf } = published;
  const propertyOf = (type, name) =>
    (type.isUnion() ? type.types : [type]).flatMap((member) => {
      const property = checker.getPropertyOfType(checker.getApparentType(member), name);
      return property && !property.declarations?.some(isHidden) ? [typeOf(property)] : [];
    });
  const errors = [];
  for (const { text, line } of codeSpans(file)) {
    // A call or a dotted path: `heading(text, o?)`, `theme.spacing.block`; quoted values and expressions are skipped.
    const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(\(.*\))?$/s.exec(text.trim());
    if (!match) continue;
    const [head, ...rest] = match[1].split('.');
    // A value of a published union, such as a text level: `bodyBold`.
    if (rest.length === 0 && match[2] === undefined && literals.has(head)) continue;
    if (OUTSIDE.has(head)) {
      used.add(head);
      continue;
    }
    const symbol = exported.get(head);
    let types =
      head === 'doc'
        ? [documentType]
        : symbol
          ? [symbol.flags & ts.SymbolFlags.Value ? typeOf(symbol) : checker.getDeclaredTypeOfSymbol(symbol)]
          : (properties.get(head) ?? []);
    if (types.length === 0) {
      errors.push(
        `${file}:${line}: \`${text}\` cites \`${head}\`, which is no export, no PDFDocument member and no ` +
          'property of a published type: fix the name, or add it to OUTSIDE in scripts/check-readme.mjs if it is no API',
      );
      continue;
    }
    for (const [index, name] of rest.entries()) {
      types = types.flatMap((type) => propertyOf(type, name));
      if (types.length > 0) continue;
      const owner = [head, ...rest.slice(0, index)].join('.');
      errors.push(
        `${file}:${line}: \`${text}\`: \`${owner}\` has no public \`${name}\` in the published types: fix the name`,
      );
      break;
    }
  }
  return errors;
}

/** An error for each name of `OUTSIDE` that no file cites any more. */
function checkOutside(used) {
  const lines = readFileSync(join(ROOT, 'scripts', 'check-readme.mjs'), 'utf8').split('\n');
  return [...OUTSIDE]
    .filter((name) => !used.has(name))
    .map((name) => {
      const line = lines.findIndex((text) => text.trim() === `'${name}',`) + 1;
      return `scripts/check-readme.mjs:${line}: OUTSIDE lists \`${name}\`, which no file cites any more: remove it`;
    });
}

// === JSDoc tags ===

/** An error for each exported function without an `@example`, and each public member without `@example` or `@group`. */
function checkTags({ program, sources }) {
  const checker = program.getTypeChecker();
  const hasTag = (symbol, tag) => symbol.getJsDocTags(checker).some((entry) => entry.name === tag);
  const errors = [];
  for (const path of sources) {
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(path)))) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (symbol.flags & ts.SymbolFlags.Function && !hasTag(symbol, 'example')) {
        errors.push(`${declaredAt(symbol)}: ${symbol.name} has no @example: add one, with a \`\`\`ts block`);
      }
      if (symbol.name !== 'PDFDocument' || !(symbol.flags & ts.SymbolFlags.Class)) continue;
      for (const member of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))) {
        const declaration = member.valueDeclaration;
        if (!declaration || isHidden(declaration)) continue;
        if (ts.getJSDocTags(declaration).some((tag) => tag.tagName.text === 'internal')) continue;
        if (!(member.flags & (ts.SymbolFlags.Method | ts.SymbolFlags.Accessor))) continue;
        for (const tag of ['example', 'group']) {
          if (!hasTag(member, tag))
            errors.push(`${declaredAt(member)}: PDFDocument.${member.name} has no @${tag}: add one`);
        }
      }
    }
  }
  return errors;
}

/** The names marked `@internal` in `src/`, which `stripInternal` removes from the published declarations. */
function internalNames(program) {
  const names = new Set();
  const visit = (node) => {
    const internal = ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'internal');
    if (internal && node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  for (const file of program.getSourceFiles()) {
    if (file.fileName.startsWith(join(ROOT, 'src') + '/')) visit(file);
  }
  return names;
}

/** The names `src/` declares at the top of a module (functions, classes, types, constants), exported or not. */
function moduleNames(program) {
  const names = new Set();
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(join(ROOT, 'src') + '/')) continue;
    for (const statement of file.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      } else if (statement.name && ts.isIdentifier(statement.name)) {
        names.add(statement.name.text);
      }
    }
  }
  return names;
}

const declarationFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return declarationFiles(path);
    return entry.name.endsWith('.d.ts') ? [path] : [];
  });

/**
 * An error for each public JSDoc that cites in code a name the reader cannot look up: a member `@internal`, or a
 * constant, function or type of `src/` the package does not export (`CHART.line.height`). The comments are read in the
 * published declarations, where only public ones remain; a name that is also published elsewhere (a property of an
 * options type) is left alone.
 */
function checkInternalCited(program, { exported, members, properties }) {
  const internal = internalNames(program);
  const hidden = new Set(
    [...internal, ...moduleNames(program)].filter(
      (name) => !exported.has(name) && !members.includes(name) && !properties.has(name),
    ),
  );
  const errors = [];
  for (const path of declarationFiles(join(ROOT, 'dist'))) {
    const text = readFileSync(path, 'utf8');
    for (const comment of text.matchAll(/\/\*\*[\s\S]*?\*\/(\s*(?:private|protected)\b)?/g)) {
      // A private member keeps its comment in the declarations, but no reader of the API sees it.
      if (comment[1]) continue;
      const lines = comment[0].slice(3, -2).split('\n').map(stripJsdoc);
      const prose = lines.join(' ').replace(/```.*?```/gs, ' ');
      for (const [, span] of prose.matchAll(/`([^`]+)`/g)) {
        const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(\(.*\))?$/s.exec(span.trim());
        const name = match?.[1].split('.').find((part) => hidden.has(part));
        if (!name) continue;
        const summary = lines.map((line) => line.trim()).find((line) => line !== '' && !line.startsWith('@'));
        const why = internal.has(name) ? 'is @internal and absent from the published types' : 'is not exported';
        errors.push(
          `${relative(ROOT, path)}:${lineOf(text, comment.index)}: the JSDoc "${summary?.slice(0, 50)}…" cites ` +
            `\`${span.trim()}\`, but \`${name}\` ${why}: reword it without naming it, or write its value`,
        );
      }
    }
  }
  return errors;
}

/** An error for each `@group` that `groupOrder` of `typedoc.json` does not list: it would sort last, unnoticed. */
function checkGroups(groups) {
  const { groupOrder } = JSON.parse(readFileSync(join(ROOT, 'typedoc.json'), 'utf8'));
  return groups
    .filter(({ value }) => !groupOrder.includes(value))
    .map(
      ({ file, line, value }) =>
        `${file}:${line}: @group "${value}" is not in groupOrder of typedoc.json: fix the name, or add it there`,
    );
}

// === Verdict ===

const readme = readmeBlocks();
const jsdoc = jsdocBlocks();
const pages = pageBlocks();
// Before `checkSnippets` turns the lines of each block into one text.
const readmeCode = readme.blocks.map((block) => block.code.join('\n')).join('\n');
const blocks = [...readme.blocks, ...pages.blocks, ...jsdoc.blocks];
const errors = [...readme.errors, ...pages.errors, ...jsdoc.errors, ...checkLanguages(blocks)];

const checked = checkSnippets(blocks, { quickStart: readme.quickStart });
const { snippets, program, entries } = checked;
errors.push(...checked.errors);
const published = publishedNames(program, entries);
const source = sourceProgram();

const used = new Set();
errors.push(
  ...checkNamed(published, readmeCode),
  ...CITING.flatMap((file) => checkCited(file, published, used)),
  ...checkOutside(used),
  ...checkTags(source),
  ...checkInternalCited(source.program, published),
  ...checkGroups(jsdoc.groups),
);

if (errors.length > 0) fail(`${errors.join('\n')}\n\nThe documentation does not match the published package.`);

const from = (name) => snippets.filter((snippet) => snippet.source === name).length;
const notRun = snippets.filter((snippet) => !snippet.runs);
const warns = snippets.filter((snippet) => snippet.warns);
console.log(
  `README: ${from('readme')} snippets, ${from('page')} snippets of the component pages and ${from('jsdoc')} JSDoc examples ` +
    `compile against dist/; ${snippets.length - notRun.length} run to the PDF without a warning, ${warns.length} with ` +
    `the warning they show. ${blocks.length - snippets.length} other blocks shown as they are.`,
);
if (notRun.length > 0) {
  console.log(`Compiled, not run (${BROWSER_ONLY}): ${notRun.map((snippet) => snippet.where).join(', ')}`);
}
console.log(
  `${published.exported.size} exports and ${published.members.length} PDFDocument members named; ` +
    `the names cited in README.md, CHANGELOG.md and the ${CITING.length - 2} component pages exist.`,
);
