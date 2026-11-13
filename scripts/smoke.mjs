// Smoke test of the built package: imports it by its own name, so the `exports` table of `package.json` is
// checked, and renders a PDF in memory.
// CI runs it on Node 20, the lowest supported version; dev tooling needs Node 22+.
//
//   pnpm build && node scripts/smoke.mjs
import { join } from 'node:path';

import { PDFDocument } from '@mlt-a/jspdf-toolkit';
import { interFonts } from '@mlt-a/jspdf-toolkit/fonts/inter';
import { loadImageFromPath } from '@mlt-a/jspdf-toolkit/node';

import { ROOT, fail } from './_shared.mjs';

const doc = new PDFDocument({ fonts: interFonts });
doc.registerImage('logo', loadImageFromPath(join(ROOT, 'assets', 'logos', 'logo-icon.png')));
doc
  .cover('Smoke test', { variant: 'wave', logo: { image: 'logo' } })
  .logo('logo', { height: 12 })
  .heading('Smoke test')
  .paragraph('Rendered from dist on a supported Node version.')
  .table([{ name: 'a', value: '1' }], {
    columns: [
      { header: 'Name', key: 'name' },
      { header: 'Value', key: 'value' },
    ],
  });

const bytes = doc.toBuffer();
if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') fail('The output is not a PDF');
console.log(`OK on Node ${process.versions.node}: ${bytes.length} bytes`);
