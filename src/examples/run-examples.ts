import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { EXAMPLES } from './registry';

type ExampleName = keyof typeof EXAMPLES;

const names = Object.keys(EXAMPLES) as ExampleName[];
const args = process.argv.slice(2);

// `in` would accept inherited keys such as `toString`.
const unknown = args.filter((a) => !names.includes(a as ExampleName));
if (unknown.length) {
  console.error(`Unknown example(s): ${unknown.join(', ')}. Available: ${names.join(', ')}`);
  process.exit(1);
}

const toRun = args.length ? [...new Set(args as ExampleName[])] : names;

const currentDir = dirname(fileURLToPath(import.meta.url));
const outputDir = join(currentDir, '..', '..', 'output');

mkdirSync(outputDir, { recursive: true });

console.log('Generating example PDFs...\n');

for (const name of toRun) {
  const { build, label } = EXAMPLES[name];
  const filePath = join(outputDir, `${name}.pdf`);
  writeFileSync(filePath, build().toBuffer());
  console.log(`  ${label}: ${filePath}`);
}

console.log('\nDone.');
