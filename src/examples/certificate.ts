import { PDFDocument, presetTheme } from '../index';
import { loadImageFromPath } from '../node';
import { exampleAsset } from './assets';
import { exampleFonts, withInter } from './fonts';

/** The certificate example: a landscape certificate of completion and its transcript. */
export function buildCertificate(): PDFDocument {
  const theme = presetTheme('violet', withInter());

  const doc = new PDFDocument({
    theme,
    fonts: exampleFonts,
    format: 'A4',
    orientation: 'landscape',
    margins: { left: 25, top: 15 },
    title: 'Certificate of Completion — Amelia Hart',
    author: 'Acme Corp',
    subject: 'Certificate of completion and transcript',
    keywords: ['certificate', 'training', 'transcript'],
  });

  doc.registerImage('logo', loadImageFromPath(exampleAsset('logos', 'logo-full-violet.png')));
  doc.registerImage('star', loadImageFromPath(exampleAsset('icons', 'star.png')));

  // === Page 1: the certificate ===

  doc
    .logo('logo', { height: 10 })
    .heading('Certificate of Completion', { rule: true })
    .paragraph('Acme Corp certifies that', { level: 'italic' })
    .heading('Amelia Hart', { level: 'h2' })
    .paragraph('has successfully completed the professional program', { level: 'italic' })
    .heading('Data Analysis for Decision Makers', { level: 'h3' })
    .paragraph('48 hours of instruction and assessment, completed with an overall score of 91 out of 100.');

  doc
    .fields([
      { label: 'Date of issue', value: 'November 13, 2026' },
      { label: 'Certificate No.', value: 'AA-2026-04817' },
      { label: 'Valid until', value: 'November 12, 2029' },
    ])
    .badge('Passed with distinction')
    .signatureZone(
      [
        { label: 'Director of Studies', sublabel: 'Dr. Helen Marsh' },
        { label: 'Chief Executive Officer', sublabel: 'Thomas Reed, Acme Corp' },
      ],
      { caption: 'Issued in London on November 13, 2026' },
    );

  // === Page 2: the transcript ===

  doc.addPage().heading('Transcript of results — Amelia Hart', { rule: true });

  doc.table(
    [
      { module: '1. Foundations of data literacy', hours: '8', grade: '88', status: 'Passed' },
      { module: '2. Collecting and cleaning data', hours: '10', grade: '90', status: 'Passed' },
      { module: '3. Descriptive statistics', hours: '10', grade: '93', status: 'Passed' },
      { module: '4. Data visualization', hours: '10', grade: '95', status: 'Passed' },
      { module: '5. Final assessment', hours: '10', grade: '91', status: 'Passed' },
    ],
    {
      columns: [
        { header: 'Module', key: 'module', width: 'auto' },
        { header: 'Hours', key: 'hours', width: 25, align: 'center' },
        { header: 'Grade', key: 'grade', width: 25, align: 'center' },
        { header: 'Status', key: 'status', width: 35, align: 'center' },
      ],
      footRow: ['TOTAL', '48', '91 avg.', 'Completed'],
    },
  );

  doc.columns([
    (column) =>
      column.heading('Hours by topic', { level: 'h4' }).donutChart(
        [
          { label: 'Foundations', value: 8 },
          { label: 'Data cleaning', value: 10 },
          { label: 'Statistics', value: 10 },
          { label: 'Visualization', value: 10 },
          { label: 'Assessment', value: 10 },
        ],
        { centerLabel: '48 h' },
      ),
    (column) =>
      column.heading('Grade by module', { level: 'h4' }).columnChart(
        [
          { label: 'M1', valueLabel: '88', values: [88] },
          { label: 'M2', valueLabel: '90', values: [90] },
          { label: 'M3', valueLabel: '93', values: [93] },
          { label: 'M4', valueLabel: '95', values: [95] },
          { label: 'M5', valueLabel: '91', values: [91] },
        ],
        { reference: { value: 70, label: 'Pass mark 70' } },
      ),
  ]);

  doc
    .heading('Skills acquired', { level: 'h3' })
    .iconList(
      [
        'Clean and prepare data from several sources',
        'Summarize a dataset with the right statistics',
        'Build clear charts for a decision meeting',
      ],
      { icon: 'star' },
    )
    .closingNote('Acme Corp — 12 Queen Street, London — Accredited by the Professional Training Council.');

  return doc.finalize();
}
