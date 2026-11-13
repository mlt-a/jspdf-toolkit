// Example images: draws the Acme Corp logos, a letterhead, a cover picture and a star icon with jsPDF, then rasterizes
// them to assets/logos/*.png, assets/backgrounds/*.png and assets/icons/*.png with `pdftocairo`.
//
//   node scripts/render-assets.mjs                       # every image
//   node scripts/render-assets.mjs letterhead cover      # these images only
//   node scripts/render-assets.mjs logo-full-emerald     # one logo variant
//
// Requires `pdftocairo` (poppler) on PATH. Run it on demand: the PNGs are committed. The logos and the letterhead have
// a transparent background, so the page color of a theme shows through. The star is a plain icon in neutral ink: the
// library ships no icon, the examples bring their own.
//
// `logo-full-<preset>` is the full logo in the colors of a preset theme, for an example whose theme is not blue. Its
// colors come from the built package (run `pnpm build` first): `src/theme` stays the one place that has them.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { jsPDF } from 'jspdf';

import { ROOT, fail, requirePoppler, run } from './_shared.mjs';
const OUTPUT = join(ROOT, 'output');
const LOGOS = join(ROOT, 'assets', 'logos');
const BACKGROUNDS = join(ROOT, 'assets', 'backgrounds');
const ICONS = join(ROOT, 'assets', 'icons');

// The presets that get a `logo-full-<preset>.png`: one line per preset.
const LOGO_PRESETS = ['emerald', 'ocean', 'violet'];

// The brand's own colors, independent of any theme.
const BLUE = '#2563EB';
const LIGHT_BLUE = '#60A5FA';
const PALE_BLUE = '#DBEAFE';
const NAVY = '#0F172A';
const DEEP_BLUE = '#1E3A8A';
const INK = '#1E293B';
const MUTED = '#64748B';
const INTER_CAP_HEIGHT = 0.727; // em

// How much white a variant mixes into its primary for the crossbar, close to what LIGHT_BLUE is to BLUE.
const CROSSBAR_TINT = 0.35;

const BLUE_BRAND = { main: BLUE, light: LIGHT_BLUE };

// The mark lives in a 400x400 box: an "A" of two legs over a lighter crossbar.
const MARK = {
  size: 400,
  crossbar: [
    [161, 233],
    [239, 233],
    [257, 281],
    [143, 281],
  ],
  legs: [
    [
      [165, 50],
      [235, 50],
      [115, 350],
      [45, 350],
    ],
    [
      [235, 50],
      [165, 50],
      [285, 350],
      [355, 350],
    ],
  ],
};

/** Fills the polygon `points`, in the unit of `doc`. */
function polygon(doc, points, color) {
  const [first, ...rest] = points;
  doc.setFillColor(color);
  doc.lines(
    rest.map(([px, py], i) => [px - (i === 0 ? first[0] : rest[i - 1][0]), py - (i === 0 ? first[1] : rest[i - 1][1])]),
    first[0],
    first[1],
    [1, 1],
    'F',
    true,
  );
}

function drawMark(doc, x, y, scale, brand) {
  const place = (points) => points.map(([px, py]) => [x + px * scale, y + py * scale]);
  // The crossbar goes first and the legs overlap it: no hairline seam between them.
  polygon(doc, place(MARK.crossbar), brand.light);
  for (const leg of MARK.legs) polygon(doc, place(leg), brand.main);
}

function createDoc(width, height, unit = 'pt') {
  const doc = new jsPDF({ unit, format: [width, height], orientation: width > height ? 'l' : 'p' });
  for (const [file, style] of [
    ['Inter-Bold.ttf', 'bold'],
    ['Inter-Regular.ttf', 'normal'],
  ]) {
    doc.addFileToVFS(file, readFileSync(join(ROOT, 'assets', 'fonts', 'inter', file)).toString('binary'));
    doc.addFont(file, 'Inter', style);
  }
  return doc;
}

const LOGO_TEXT = 'Acme Corp';

/** The mark and the name side by side, spanning `width` from `x`, `height` tall, in the unit of `doc`. */
function drawFullLogo(doc, x, y, width, height, brand) {
  const markSize = height * (64 / 74);
  const gap = height * (14 / 74);
  doc.setFont('Inter', 'bold');
  doc.setFontSize(1);
  // jsPDF measures text in the unit of the document, for a size in points.
  const fontSize = (width - markSize - gap) / doc.getTextWidth(LOGO_TEXT);
  doc.setFontSize(fontSize);
  drawMark(doc, x, y + (height - markSize) / 2, markSize / MARK.size, brand);
  doc.setTextColor(INK);
  // The cap height is in points: `scaleFactor` is the number of points in a unit of the document.
  const capHeight = (INTER_CAP_HEIGHT * fontSize) / doc.internal.scaleFactor;
  doc.text(LOGO_TEXT, x + markSize + gap, y + height / 2 + capHeight / 2);
}

function fullLogo(brand) {
  const [width, height] = [400, 74];
  const doc = createDoc(width, height);
  // The content spans the full width, so the logo sits flush with the margin it is placed on.
  drawFullLogo(doc, 0, 0, width, height, brand);
  return { doc, width, height };
}

function iconLogo() {
  const doc = createDoc(MARK.size, MARK.size);
  drawMark(doc, 0, 0, 1, BLUE_BRAND);
  return { doc, width: MARK.size, height: MARK.size };
}

const STAR_SIZE = 256;
const STAR_INNER_RATIO = 0.382; // inner radius over outer radius of a regular five-pointed star

/** A filled five-pointed star in neutral ink, point up, centered on its bounding box. */
function star() {
  const outer = STAR_SIZE / 2;
  const inner = outer * STAR_INNER_RATIO;
  // The star is (1 + cos 36 deg) outer radii tall: center that box, not the circle.
  const centerY = outer + (outer * (1 - Math.cos(Math.PI / 5))) / 2;
  const points = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / 5;
    return [outer + radius * Math.sin(angle), centerY - radius * Math.cos(angle)];
  });
  const doc = createDoc(STAR_SIZE, STAR_SIZE);
  polygon(doc, points, INK);
  return { doc, width: STAR_SIZE, height: STAR_SIZE };
}

// A4 in millimeters: the backgrounds span the page width.
const A4 = [210, 297];

/**
 * Company stationery: the logo and the address at the top, above the 20 mm top margin of a document; a rule, the
 * legal line and a band at the bottom, inside its 15 mm footer zone. The rest is transparent.
 */
function letterhead() {
  const [width, height] = A4;
  const doc = createDoc(width, height, 'mm');
  doc.setFillColor(BLUE);
  doc.rect(0, 0, width, 2, 'F');
  drawFullLogo(doc, 12, 7, 38, 7, BLUE_BRAND);
  doc.setFont('Inter', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED);
  doc.text('12 Harbour Road, Bristol BS1 4RW', width - 12, 9.5, { align: 'right' });
  doc.text('hello@acme.example  ·  +44 117 496 0000', width - 12, 13.5, { align: 'right' });
  doc.setDrawColor(PALE_BLUE);
  doc.setLineWidth(0.3);
  doc.line(12, 284, width - 12, 284);
  doc.setFontSize(6.5);
  doc.text('Acme Corp Ltd  ·  Registered in England and Wales, No. 01234567  ·  VAT GB 123 4567 89', width / 2, 289.5, {
    align: 'center',
  });
  polygon(
    doc,
    [
      [0, 293],
      [width * 0.62, 293],
      [width * 0.6, height],
      [0, height],
    ],
    BLUE,
  );
  polygon(
    doc,
    [
      [width * 0.62, 293],
      [width, 293],
      [width, height],
      [width * 0.6, height],
    ],
    LIGHT_BLUE,
  );
  return { doc, width, height, pixels: 1240, transparent: true };
}

/** A dark picture for an image cover: the upper half left plain for a light title, shapes of the brand below. */
function cover() {
  const [width, height] = A4;
  const doc = createDoc(width, height, 'mm');
  doc.setFillColor(NAVY);
  doc.rect(0, 0, width, height, 'F');
  polygon(
    doc,
    [
      [0, 190],
      [width, 150],
      [width, height],
      [0, height],
    ],
    DEEP_BLUE,
  );
  polygon(
    doc,
    [
      [70, height],
      [width, 175],
      [width, height],
    ],
    BLUE,
  );
  polygon(
    doc,
    [
      [140, height],
      [width, 230],
      [width, height],
    ],
    LIGHT_BLUE,
  );
  doc.setFillColor(LIGHT_BLUE);
  doc.rect(20, 132, 24, 1.2, 'F');
  return { doc, width, height, pixels: 1240, transparent: false };
}

// Loaded once, on the first variant: the other images need no build, and a missing `dist/` fails once.
let themeColors;
function loadThemeColors() {
  const entry = join(ROOT, 'dist', 'index.js');
  if (!existsSync(entry))
    fail('dist/index.js missing: a logo variant reads its colors from it; run `pnpm build` first');
  themeColors ??= import(pathToFileURL(entry).href);
  return themeColors;
}

/** The brand of a preset: its primary for the legs, a tint of it for the crossbar. */
async function presetBrand(preset) {
  const { presetTheme, tint } = await loadThemeColors();
  const main = presetTheme(preset).colors.primary;
  return { main, light: tint(main, CROSSBAR_TINT) };
}

const TO_RENDER = [
  { name: 'logo-full', folder: LOGOS, build: () => fullLogo(BLUE_BRAND) },
  ...LOGO_PRESETS.map((preset) => ({
    name: `logo-full-${preset}`,
    folder: LOGOS,
    build: async () => fullLogo(await presetBrand(preset)),
  })),
  { name: 'logo-icon', folder: LOGOS, build: iconLogo },
  { name: 'letterhead', folder: BACKGROUNDS, build: letterhead },
  { name: 'cover', folder: BACKGROUNDS, build: cover },
  { name: 'star', folder: ICONS, build: star },
];

const names = process.argv.slice(2);
const unknown = names.filter((name) => !TO_RENDER.some((image) => image.name === name));
if (unknown.length > 0) {
  fail(`Unknown image ${unknown.join(', ')}. The images are: ${TO_RENDER.map((image) => image.name).join(', ')}`);
}

requirePoppler('pdftocairo');

const selected = TO_RENDER.filter((image) => names.length === 0 || names.includes(image.name));

mkdirSync(OUTPUT, { recursive: true });
mkdirSync(BACKGROUNDS, { recursive: true });
mkdirSync(ICONS, { recursive: true });
const built = await Promise.all(
  selected.map(async ({ name, folder, build }) => ({ name, folder, image: await build() })),
);
for (const { name, folder, image } of built) {
  const { doc, width, height, pixels = width, transparent = true } = image;
  const pdf = join(OUTPUT, `${name}.pdf`);
  const target = join(folder, name);
  doc.save(pdf);
  const size = ['-scale-to-x', String(pixels), '-scale-to-y', String(Math.round((pixels * height) / width))];
  // -singlefile writes exactly <target>.png; -scale-to pins the pixel size.
  run('pdftocairo', ['-png', ...(transparent ? ['-transp'] : []), '-singlefile', ...size, pdf, target], {
    stdout: 'ignore',
  });
  console.log(`${name}.png  (${size[1]}x${size[3]}, ${Math.round(statSync(`${target}.png`).size / 1024)} kB)`);
}
