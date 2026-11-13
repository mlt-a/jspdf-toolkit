import { PDFDocument, createTheme, SPACING, drawHighlightedText, measureHighlightedText } from '../index';
import { loadImageFromPath } from '../node';
import { exampleAsset } from './assets';
import { exampleFonts, withInter } from './fonts';

/** The report example. */
export function buildReport(): PDFDocument {
  const theme = createTheme(
    withInter({
      name: 'report',
      colors: { primary: '#00416A' },
    }),
  );

  const doc = new PDFDocument({
    theme,
    fonts: exampleFonts,
    format: 'A4',
    title: 'Annual Report 2025',
    author: 'Acme Corp',
    subject: 'Activity report and annual review',
    keywords: ['report', 'annual', '2025', 'review'],
  });

  // Logos, registered once and used by name
  doc.registerImages({
    logo: loadImageFromPath(exampleAsset('logos', 'logo-full.png')),
    mark: loadImageFromPath(exampleAsset('logos', 'logo-icon.png')),
  });

  // Running footer: replaces the default page numbers; the cover and back cover are skipped.
  doc.pageFooter({ logo: 'mark', right: '{page}/{pages}' });

  // Declared before the content: every page, the cover included, gets it under what is drawn on it.
  doc.watermark('CONFIDENTIAL', { allPages: true });

  // ===================================================================
  // COVER PAGE
  // ===================================================================

  doc.cover('Annual Report 2025', {
    variant: 'wave',
    subtitle: 'Acme Corp — Technology Division',
    logo: { image: 'logo', height: 10 },
  });

  // ===================================================================
  // TABLE OF CONTENTS : filled at finalize() with the real page numbers
  // ===================================================================

  doc.tableOfContents({
    intro: 'Sections and subsections of this report, with the page they start on.',
    depth: 3,
  });

  // ===================================================================
  // PAGE 1 : Title + Introduction
  // ===================================================================

  doc
    .logo('logo', { height: 10 })
    .heading('Annual Report 2025', { toc: false })
    .badge('Acme Corp — Technology Division')
    .separator();

  doc.paragraph(
    'This report presents the 2025 year-end review, key results, ' +
      'completed projects, and outlook for 2026. It covers all ' +
      'activities of the technology division, including product development, ' +
      'infrastructure, and applied research.',
  );

  doc.paragraphs([
    'The year 2025 was marked by significant growth of our engineering team ' +
      'and the launch of three major products. Our approach centered on code quality ' +
      'and developer experience has paid off.',
    'R&D investments represented 42% of the total budget, up 15 points ' +
      'compared to 2024. This strategy has proven successful with a customer retention rate ' +
      'reaching 96%.',
  ]);

  // ===================================================================
  // SECTION : Key Figures
  // ===================================================================

  doc.heading('Key Figures', { level: 'h2', number: '1', rule: true });

  doc.fieldRows([
    [
      { label: 'Revenue', value: '€4.2M', highlight: true },
      { label: 'Growth', value: '+38%', highlight: true },
      { label: 'Headcount', value: '47 employees' },
    ],
    [
      { label: 'Projects delivered', value: '23' },
      { label: 'Customer satisfaction', value: '4.8/5' },
    ],
    [
      {
        label: 'Headquarters',
        value: 'London, United Kingdom',
        complement: 'Branch offices in Manchester and Edinburgh',
      },
    ],
  ]);

  // ===================================================================
  // SECTION : Flagship Projects
  // ===================================================================

  doc
    .heading('Flagship Projects', { level: 'h2', number: '2', rule: true })
    .heading('Document Management Platform', { level: 'h3', number: '2.1' })
    .paragraph(
      'Complete overhaul of our document management platform with migration to ' +
        'a microservices architecture. The project involved a team of 8 developers ' +
        'over a 6-month period.',
    )
    .infoBox('The new platform reduced processing times by 65% and improved system reliability with 99.97% uptime.', {
      title: 'Measured impact',
      bulletPoints: [
        'Migration of 2.3 million documents with zero data loss',
        '40% reduction in infrastructure costs',
        'REST API v3 with full OpenAPI documentation',
      ],
    });

  doc.heading('PDF Generation Tool', { level: 'h3', number: '2.2' });

  doc.paragraph(
    'Development of an open-source PDF generation library with theme management, ' +
      'font handling, tables, and complex layouts. Used in production by ' +
      '12 clients to generate over 50,000 documents per month.',
  );

  // ===================================================================
  // SECTION : Organization
  // ===================================================================

  doc.heading('Organization', { level: 'h2', number: '3', rule: true });

  doc.columns([
    (column) =>
      column
        .heading('Product Team', { level: 'h3', toc: false })
        .bulletList(['12 full-stack developers', '3 UX/UI designers', '2 product managers', '1 tech lead']),
    (column) =>
      column
        .heading('Infrastructure Team', { level: 'h3', toc: false })
        .bulletList(['5 DevOps engineers', '3 SREs', '2 cloud architects', '1 security lead']),
  ]);

  // === Address block ===

  doc.heading('Contact Information', { level: 'h3', number: '3.1' }).inset({ width: doc.measure / 2 }, () =>
    doc.addressBlock([
      { text: 'Acme Corp', role: 'title' },
      { text: 'Technology Division', role: 'subtitle' },
      { text: '42 Innovation Avenue', role: 'address' },
      { text: 'London WC2B 6TP, United Kingdom', role: 'address' },
      { text: 'contact@acme.example', role: 'address' },
    ]),
  );

  // ===================================================================
  // SECTION : 2026 Objectives
  // ===================================================================

  doc.heading('2026 Objectives', { level: 'h2', number: '4', rule: true }).numberedList([
    {
      text: 'Launch v2 of the document management platform',
      subItems: ['AI integration for automatic classification', 'Multi-language support (EN, FR, DE, ES)'],
    },
    'Reach €5M in annual revenue',
    'Hire 15 additional team members',
    {
      text: 'Expand the SaaS offering',
      subItems: ['Subscription and billing module', 'Self-service client portal'],
    },
  ]);

  // === Highlighted text demo ===

  doc.heading('Key Highlights', { level: 'h3', number: '4.1' });

  // Reserved before the position is read, so the heading goes to the next page with the pills.
  const pill = measureHighlightedText(doc, 'Growth +38%');
  doc.ensureSpace(pill.height + doc.resolveSpaceAfter());
  // `y` is the top of a pill: its padding bleeds into the space above, so the pill text sits on the line.
  const lineTop = doc.getYPos();
  drawHighlightedText(doc, 'Growth +38%', { x: doc.margins.left, y: lineTop - pill.padding, metrics: pill });
  drawHighlightedText(doc, 'Target achieved', { x: doc.margins.left + 50, y: lineTop - pill.padding, strong: true });
  doc.endBlock(lineTop + pill.height);

  // ===================================================================
  // SECTION : Project Tracking (multi-page)
  // ===================================================================

  doc.heading('Project Tracking', { level: 'h2', number: '5', rule: true });

  doc.table(
    [
      { project: 'Document platform v2', lead: 'A. Carter', status: 'In progress', budget: '€450k' },
      { project: 'Public API overhaul', lead: 'S. Brooks', status: 'Completed', budget: '€120k' },
      { project: 'Cloud migration AWS → GCP', lead: 'L. Hayes', status: 'In progress', budget: '€280k' },
      {
        project: 'ISO 27001 security audit',
        lead: 'M. Bennett',
        status: 'Planned',
        budget: '€85k',
      },
      { project: 'SaaS billing module', lead: 'C. Mitchell', status: 'In progress', budget: '€200k' },
      { project: 'Internal LLM integration', lead: 'P. Walker', status: 'R&D', budget: '€150k' },
      { project: 'Mobile app v3', lead: 'J. Turner', status: 'In progress', budget: '€320k' },
      { project: 'Partner portal', lead: 'N. Collins', status: 'Planned', budget: '€175k' },
      { project: 'Data pipeline refactoring', lead: 'R. Garcia', status: 'Completed', budget: '€95k' },
      { project: 'Analytics dashboard v2', lead: 'E. Parker', status: 'In progress', budget: '€110k' },
      { project: 'Customer support chatbot', lead: 'V. Hughes', status: 'R&D', budget: '€130k' },
      { project: 'Onboarding revamp', lead: 'D. Foster', status: 'Completed', budget: '€60k' },
    ],
    {
      columns: [
        { header: 'Project', key: 'project', width: 'auto' },
        { header: 'Lead', key: 'lead', width: 35 },
        { header: 'Status', key: 'status', width: 25, align: 'center' },
        { header: 'Budget', key: 'budget', width: 25, align: 'right' },
      ],
      continuationTitle: 'Project Tracking (continued)',
      footRow: ['12 projects', '', '', '€2,175k'],
    },
  );

  // ===================================================================
  // SECTION : Compliance
  // ===================================================================

  doc
    .heading('Compliance & Commitments', { level: 'h2', number: '6', rule: true })
    .inlineQuestion('GDPR policy up to date?', { variant: 'checked', answer: 'Yes' })
    .inlineQuestion('Annual security audit completed?', { variant: 'checked', answer: 'Yes' })
    .inlineQuestion('ISO 27001 certification obtained?', { variant: 'cross', answer: 'In progress' })
    .checkbox('GDPR compliance', { variant: 'checked' })
    .checkbox('Business continuity plan', { variant: 'checked' })
    .checkbox('Cyber risk insurance', { variant: 'checked' })
    .checkbox('ISO 27001 certification', { variant: 'cross' })
    .declarationsBox([
      {
        text: 'I, the undersigned, certify that the information contained in this report is accurate and complete to the best of my knowledge.',
      },
      {
        text: 'I attest that the financial data has been validated by the accounting department and complies with applicable standards.',
      },
      {
        text: 'I commit to implementing the corrective actions identified within the specified deadlines.',
      },
    ]);

  // ===================================================================
  // SECTION : Signatures
  // ===================================================================

  doc.keepTogether(() => {
    doc
      .heading('Signatures', { level: 'h2', number: '7', rule: true, spaceBefore: SPACING.large })
      .signatureZone([{ label: 'Chief Technology Officer' }, { label: 'Chief Executive Officer' }], {
        caption: 'Signed in London on April 9, 2026',
      })
      .closingNote('Acme Corp — Confidential document — Reproduction prohibited');
  });

  return doc.finalize();
}
