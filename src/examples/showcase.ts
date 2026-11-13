import {
  PDFDocument,
  presetTheme,
  SPACING,
  drawHighlightedText,
  measureHighlightedText,
  parseRichText,
} from '../index';
import { loadImageFromPath } from '../node';
import { exampleAsset } from './assets';
import { exampleFonts, withInter } from './fonts';

/** The component catalog example. */
export function buildShowcase(): PDFDocument {
  const theme = presetTheme('emerald', withInter());

  const doc = new PDFDocument({
    theme,
    fonts: exampleFonts,
    format: 'A4',
    title: 'Component Catalog — jspdf-toolkit',
    author: 'jspdf-toolkit',
    subject: 'Showcase of all available components',
    keywords: ['showcase', 'components', 'catalog'],
  });

  // Registered once, then named by every `icon` option.
  doc.registerImage('star', loadImageFromPath(exampleAsset('icons', 'star.png')));

  // ===================================================================
  // SECTION 1 : Typography
  // ===================================================================

  doc
    .heading('Typography', { level: 'h2' })
    .heading('Headings', { level: 'h3' })
    .heading('Main heading (h1)')
    .heading('Section heading (h2)', { level: 'h2' })
    .heading('Zone heading (h3)', { level: 'h3' })
    .heading('Field heading (h4)', { level: 'h4' });

  doc
    .heading('Paragraph', { level: 'h3' })
    .paragraph(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ' +
        'ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco ' +
        'laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in ' +
        'voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
    );

  doc
    .heading('Multiple paragraphs', { level: 'h3' })
    .paragraphs([
      'Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo ' +
        'pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris.',
      'Praesent dapibus, neque id cursus faucibus, tortor neque egestas augue, eu vulputate magna eros ' +
        'eu erat. Aliquam erat volutpat. Nam dui mi, tincidunt quis, accumsan porttitor, facilisis luctus, metus.',
    ]);

  doc.heading('Text with links', { level: 'h3' }).richBlocks([
    {
      type: 'paragraph',
      runs: [
        { text: 'This toolkit is available on ' },
        { text: 'GitHub', link: 'https://github.com' },
        { text: ' and documented on the ' },
        { text: 'official website', link: 'https://example.com' },
        { text: ' of the project.' },
      ],
    },
  ]);

  doc
    .heading('Rich text', { level: 'h3' })
    .richText(
      'Markup adds **bold** and *italic* inside a paragraph, nested as in **bold with *italic* inside**. ' +
        'A star stays literal when escaped: 4 \\* 5 = 20.\n\n' +
        'A blank line starts a new paragraph, still wrapped to the reading column.',
    )
    .richBlocks([
      {
        type: 'paragraph',
        runs: [
          { text: 'Blocks built as data mix ' },
          { text: 'emphasis', bold: true },
          { text: ' and ' },
          { text: 'links', link: 'https://example.com' },
          { text: ' in one flow.' },
        ],
      },
      {
        type: 'bulletList',
        items: [
          [{ text: 'Rich list item with ' }, { text: 'bold', bold: true }, { text: ' text' }],
          [{ text: 'Another item in ' }, { text: 'italic', italic: true }],
        ],
      },
    ])
    .bulletList([
      {
        text: 'List item with a detail',
        detail: parseRichText('The detail sits under the item, in a *secondary* style.'),
      },
      { text: 'Second item', detail: parseRichText('Details accept **markup** too.') },
    ]);

  // ===================================================================
  // SECTION 2 : Sections & Structure
  // ===================================================================

  doc
    .heading('Sections & Structure', { level: 'h2' })
    .paragraph(
      'The h2 and h3 heading levels are visible throughout this document. ' +
        'They organize the content into sections and subsections.',
    );

  doc.heading('Separator', { level: 'h3' });

  doc.separator();

  doc.heading('Badge', { level: 'h3' });

  doc.badge('Decorative component — badge');

  // ===================================================================
  // SECTION 3 : Lists
  // ===================================================================

  doc
    .heading('Lists', { level: 'h2' })
    .heading('Bullet list', { level: 'h3' })
    .bulletList([
      'First item in the list',
      'Second item with longer content to observe wrapping behavior',
      {
        text: 'Third item with sub-items',
        subItems: ['Sub-item A', 'Sub-item B'],
      },
      'Fourth simple item',
    ]);

  doc.heading('Numbered list', { level: 'h3' }).numberedList([
    'First step of the process',
    'Second step with additional details',
    {
      text: 'Third step with sub-steps',
      subItems: ['Data validation', 'Report generation'],
    },
    'Fourth and final step',
  ]);

  doc
    .heading('Icon list', { level: 'h3' })
    .iconList(['Themed from a single color', 'Paginated automatically', 'Typed end to end'], { icon: 'star' });

  // ===================================================================
  // SECTION 4 : Fields & Data
  // ===================================================================

  doc.heading('Fields & Data', { level: 'h2' }).heading('Simple fields', { level: 'h3' });

  doc.fieldRows([
    [
      { label: 'Project name', value: 'jspdf-toolkit' },
      { label: 'Version', value: '1.0.0' },
      { label: 'License', value: 'MIT' },
    ],
    [
      { label: 'Author', value: 'Acme Corp' },
      { label: 'Language', value: 'TypeScript' },
      { label: 'Description', value: 'PDF generation with themes and complex layouts' },
    ],
  ]);

  doc.heading('Fields with highlight', { level: 'h3' }).fields([
    { label: 'Status', value: 'Active', highlight: true },
    { label: 'Components', value: '24 modules', highlight: true },
    { label: 'Coverage', value: '98%', highlight: true },
  ]);

  doc.heading('Field with complement', { level: 'h3' }).fields([
    {
      label: 'Main repository',
      value: 'github.com/toolkit',
      complement: 'Mirror available on GitLab',
    },
  ]);

  doc.heading('Long values and labels wrap', { level: 'h3' }).fieldRows([
    [
      { label: 'Primary contact email', value: 'maximilian.vandenberghe-lindqvist@international-holdings.example.com' },
      { label: 'IBAN', value: 'FR76-3000-6000-0112-3456-7890-189' },
    ],
    [
      { label: 'Registered office address, as filed with the commercial register', value: 'Paris, France' },
      { label: 'Status', value: 'Active under the extended compliance regime for regulated entities', highlight: true },
    ],
  ]);

  doc.heading('Inline layout', { level: 'h3' }).fields(
    [
      { label: 'Project', value: 'jspdf-toolkit' },
      {
        label: 'Maintainer',
        value:
          'Acme Corp, a small team building themed PDF generation for business documents, with a focus on ' +
          'layouts that stay readable when the content is longer than expected',
      },
      { label: 'Status', value: 'Active', highlight: true },
      { label: 'Repository', value: 'github.com/toolkit', complement: 'Mirror available on GitLab' },
    ],
    { layout: 'inline' },
  );

  doc.heading('Leader layout', { level: 'h3' }).fields(
    [
      { label: 'Registered capital', value: '€250,000' },
      { label: 'Number of employees', value: '42' },
      { label: 'Registered office address as filed with the commercial register', value: 'Paris' },
      {
        label: 'Main activity',
        value: 'Design and publication of software components for document generation',
      },
    ],
    { layout: 'leader' },
  );

  // ===================================================================
  // SECTION 5 : Tables
  // ===================================================================

  doc.heading('Tables', { level: 'h2' });

  doc.table(
    [
      { component: 'heading', category: 'Typography', status: 'Stable', version: '1.0' },
      { component: 'paragraph', category: 'Typography', status: 'Stable', version: '1.0' },
      { component: 'bulletList', category: 'Lists', status: 'Stable', version: '1.0' },
      { component: 'table', category: 'Data', status: 'Stable', version: '1.0' },
      { component: 'signatureZone', category: 'Forms', status: 'Stable', version: '1.0' },
    ],
    {
      columns: [
        { header: 'Component', key: 'component', width: 'auto' },
        { header: 'Category', key: 'category', width: 35 },
        { header: 'Status', key: 'status', width: 25, align: 'center' },
        { header: 'Version', key: 'version', width: 20, align: 'right' },
      ],
      footRow: ['5 components', '', '', ''],
    },
  );

  // ===================================================================
  // SECTION 6 : Charts
  // ===================================================================

  doc
    .heading('Charts', { level: 'h2' })
    .heading('Stacked bar', { level: 'h3' })
    .stackedBar([
      { label: 'Delivered', value: 14, color: 'success' },
      { label: 'In progress', value: 5 },
      { label: 'Blocked', value: 2, color: 'error' },
    ]);

  doc.heading('Donut', { level: 'h3' }).donutChart(
    [
      { label: 'Licences', value: 60 },
      { label: 'Services', value: 30 },
      { label: 'Support', value: 10, color: 'secondary' },
    ],
    { centerLabel: '$1.2M' },
  );

  doc.heading('Columns', { level: 'h3' }).columnChart(
    [
      { label: 'Q1', valueLabel: '$120k', values: [80, 40] },
      { label: 'Q2', valueLabel: '$150k', values: [95, 55] },
      { label: 'Q3', valueLabel: '$135k', values: [85, 50] },
      { label: 'Q4', valueLabel: '$170k', values: [100, 70] },
    ],
    { series: [{ label: 'Licences' }, { label: 'Services' }], reference: { value: 180, label: 'Target $180k' } },
  );

  doc.heading('Lines', { level: 'h3' }).lineChart(
    {
      xs: [2026, 2027, 2028, 2029, 2030],
      lines: [{ label: 'Forecast', values: [100, 110, 121, 133, 146], emphasis: true }],
      band: { label: 'Range', lower: [100, 104, 108, 112, 116], upper: [100, 116, 134, 154, 176] },
    },
    { yTitle: 'Revenue ($k)', xTitle: 'Year', highlight: { from: 2027, to: 2029, label: 'Plan period' } },
  );

  doc.heading('Charts in columns', { level: 'h3' }).columns([
    (column) =>
      column.heading('Budget split', { level: 'h4' }).donutChart([
        { label: 'People', value: 55 },
        { label: 'Tools', value: 25 },
        { label: 'Travel', value: 20 },
      ]),
    (column) =>
      column
        .heading('Delivery', { level: 'h4' })
        .stackedBar([
          { label: 'Done', value: 14, color: 'success' },
          { label: 'Open', value: 7 },
        ])
        .columnChart([
          { label: 'Mon', values: [4] },
          { label: 'Tue', values: [7] },
          { label: 'Wed', values: [5] },
        ]),
  ]);

  // ===================================================================
  // SECTION 7 : Forms
  // ===================================================================

  doc
    .heading('Forms', { level: 'h2' })
    .heading('Checkboxes', { level: 'h3' })
    .checkbox('Option enabled by default', { variant: 'checked' })
    .checkbox('Option also checked', { variant: 'checked' })
    .checkbox('Unchecked option')
    .checkbox('Rejected option', { variant: 'cross' });

  doc
    .heading('Inline questions', { level: 'h3' })
    .inlineQuestion('Is the component stable?', { variant: 'checked', answer: 'Yes' })
    .inlineQuestion('Are changes planned?', { variant: 'cross', answer: 'Not planned' });

  // ===================================================================
  // SECTION 8 : Boxes & Containers
  // ===================================================================

  doc
    .heading('Boxes & Containers', { level: 'h2' })
    .heading('Info box', { level: 'h3' })
    .infoBox(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum ante ipsum primis ' +
        'in faucibus orci luctus et ultrices posuere cubilia curae.',
      {
        title: 'Important information',
        bulletPoints: [
          'Key point number one with details',
          'Key point number two for illustration',
          'Third point to complete the demonstration',
        ],
      },
    );

  doc
    .heading('Callout', { level: 'h3' })
    .infoBox(
      'A callout has a tinted background, an accent bar and no border. The eyebrow, the title, the content and ' +
        'the bullets are all optional.',
      {
        variant: 'callout',
        eyebrow: 'Good to know',
        title: 'A box set apart from the text',
        bulletPoints: ['Everything wraps to the box width', 'Bullets hang under their text'],
      },
    );

  doc.heading('Declarations block', { level: 'h3' }).declarationsBox([
    {
      text: 'I, the undersigned, declare that I have read and accept the general terms and conditions without reservation.',
    },
    {
      text: 'I attest that the information provided in this document is accurate and complete to the best of my knowledge.',
    },
  ]);

  doc.heading('Declarations with header, bullets and highlights', { level: 'h3' }).declarationsBox(
    [
      {
        text: 'I accept the general terms and conditions, which form a binding commitment for the whole contract duration and are renewed by tacit agreement.',
        highlights: [{ text: 'binding commitment', strong: true }],
      },
    ],
    { intro: 'The signatory declares the following:', bullet: true },
  );

  doc
    .heading('Declarations with an icon', { level: 'h3' })
    .declarationsBox(
      [
        { text: 'I confirm that I have read the privacy policy.' },
        { text: 'I agree to receive my invoices by email.' },
      ],
      { icon: 'star', boxStyle: 'tint' },
    );

  doc.heading('Address block', { level: 'h3' }).inset({ width: doc.measure / 2 }, () =>
    doc.addressBlock([
      { text: 'Acme Corporation', role: 'title' },
      { text: 'Research & Development Division', role: 'subtitle' },
      { text: '123 Market Street', role: 'address' },
      { text: 'London E1 6AN, United Kingdom', role: 'address' },
    ]),
  );

  // ===================================================================
  // SECTION 9 : Layout
  // ===================================================================

  doc.heading('Layout', { level: 'h2' }).heading('Columns', { level: 'h3' });

  doc.columns([
    (column) =>
      column
        .heading('Left column', { level: 'h4' })
        .paragraph('Any block works inside a column: it wraps to the column width.')
        .bulletList(['Item alpha', 'Item beta', 'Item gamma']),
    (column) =>
      column
        .heading('Right column', { level: 'h4' })
        .fields([{ label: 'Status', value: 'Active', highlight: true }])
        .bulletList(['Item delta', 'Item epsilon', 'Item zeta']),
  ]);

  doc.heading('Two-column header', { level: 'h3' });

  doc.headerColumns([
    {
      title: 'Project information',
      fields: [
        { label: 'Name', value: 'jspdf-toolkit' },
        { label: 'Type', value: 'Open-source library' },
        { label: 'Language', value: 'TypeScript' },
      ],
    },
    {
      title: 'Team information',
      fields: [
        { label: 'Lead', value: 'A. Carter' },
        { label: 'Contributors', value: '12' },
        { label: 'Latest release', value: 'May 2026' },
      ],
    },
  ]);

  // ===================================================================
  // SECTION 10: Visual elements
  // ===================================================================

  doc.heading('Visual elements', { level: 'h2' }).heading('Highlighted text', { level: 'h3' });

  const pill = measureHighlightedText(doc, 'Highlighted text');
  // `y` is the top of a pill: its padding bleeds into the space above, so the pill text sits on the line.
  const lineTop = doc.getYPos();
  drawHighlightedText(doc, 'Highlighted text', { x: doc.margins.left, y: lineTop - pill.padding, metrics: pill });
  drawHighlightedText(doc, 'Strong text', { x: doc.margins.left + 50, y: lineTop - pill.padding, strong: true });
  doc.endBlock(lineTop + pill.height);

  // ===================================================================
  // SECTION 11: Custom code — native jsPDF
  // ===================================================================

  // The heading, the text and the drawing stay on one page.
  doc.keepTogether(() => {
    doc
      .heading('Custom code — native jsPDF', { level: 'h2' })
      .paragraph(
        'The toolkit does not lock you in: access the jsPDF instance via doc.doc to draw ' +
          'whatever you need. Shapes, illustrations, custom charts — anything is possible.',
      );

    // Custom drawing: mini skyline
    {
      const d = doc.doc;
      const t = doc.theme;
      const x0 = doc.margins.left;
      const w = doc.contentWidth;
      const h = 48;

      doc.ensureSpace(h + SPACING.large);
      const drawY = doc.getYPos();

      // Background (night sky)
      d.setFillColor('#1a1a2e');
      d.roundedRect(x0, drawY, w, h, 2, 2, 'F');

      // Stars
      d.setFillColor('#ffffff');
      const stars = [
        [18, 8],
        [42, 5],
        [65, 12],
        [90, 7],
        [110, 14],
        [130, 6],
        [148, 10],
        [162, 4],
        [35, 16],
        [78, 9],
        [155, 15],
        [50, 3],
        [120, 11],
      ];
      stars.forEach(([sx, sy]) => {
        d.circle(x0 + sx, drawY + sy, 0.4, 'F');
      });

      // Moon
      d.setFillColor(t.colors.tint);
      d.circle(x0 + w - 22, drawY + 12, 5, 'F');
      // Crescent: dark circle to mask
      d.setFillColor('#1a1a2e');
      d.circle(x0 + w - 19, drawY + 11, 5, 'F');

      // Buildings. Lit windows come from a seeded generator, so every run draws the same PDF.
      const nextRandom = seededRandom(7);
      const groundY = drawY + h;
      const buildings = [
        { x: 4, w: 16, h: 26 },
        { x: 22, w: 12, h: 35 },
        { x: 36, w: 18, h: 20 },
        { x: 56, w: 14, h: 30 },
        { x: 72, w: 10, h: 40 },
        { x: 84, w: 16, h: 24 },
        { x: 102, w: 12, h: 32 },
        { x: 116, w: 18, h: 18 },
        { x: 136, w: 14, h: 28 },
        { x: 152, w: 16, h: 22 },
        { x: 170, w: 14, h: 34 },
      ];

      buildings.forEach((b) => {
        const bx = x0 + b.x;
        const by = groundY - b.h;
        d.setFillColor(t.colors.primary);
        d.rect(bx, by, b.w, b.h, 'F');

        // Windows
        const winW = 1.8;
        const winH = 2;
        const gapX = 3.5;
        const gapY = 4;
        const padX = (b.w - Math.floor((b.w - 3) / gapX) * gapX) / 2;

        for (let wy = by + 3; wy + winH < groundY - 2; wy += gapY) {
          for (let wx = bx + padX; wx + winW < bx + b.w - 1; wx += gapX) {
            const lit = nextRandom() > 0.35;
            d.setFillColor(lit ? t.colors.tint : '#0a0a1a');
            d.rect(wx, wy, winW, winH, 'F');
          }
        }
      });

      doc.endBlock(drawY + h, SPACING.large);
    }
  });

  doc.keepTogether(() => {
    doc
      .heading('Signature zone', { level: 'h3' })
      .signatureZone(
        [
          { label: 'Manager signature', sublabel: 'Eleanor Whitfield-Marchetti, Chief Operating Officer, EMEA region' },
          { label: 'Director signature', sublabel: 'Jonathan Ramirez, Director' },
        ],
        { caption: 'Signed in London on May 22, 2026' },
      )
      .closingNote('jspdf-toolkit — Component Catalog — Demonstration document');
  });

  return doc.finalize();
}

/** Mulberry32: a small deterministic generator of numbers in [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
