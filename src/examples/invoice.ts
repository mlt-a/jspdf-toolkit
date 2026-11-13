import { PDFDocument, presetTheme } from '../index';
import { exampleFonts, withInter } from './fonts';

/** The invoice example. */
export function buildInvoice(): PDFDocument {
  const theme = presetTheme('coral', withInter());

  const doc = new PDFDocument({
    theme,
    fonts: exampleFonts,
    format: 'A4',
    title: 'Invoice INV-2026-042',
    author: 'Acme Corp',
    subject: 'Client invoice',
    keywords: ['invoice', 'billing'],
  });

  // === Header ===

  doc.heading('ACME CORPORATION').separator();

  doc.headerColumns([
    {
      title: 'Invoice',
      fields: [
        { label: 'Invoice No.', value: 'INV-2026-042' },
        { label: 'Date', value: 'April 9, 2026' },
        { label: 'Due date', value: 'May 9, 2026' },
        { label: 'Payment method', value: 'Wire transfer' },
      ],
    },
    {
      title: 'Client',
      fields: [
        { label: 'Company', value: 'TechStart Inc.' },
        { label: 'Contact', value: 'Jane Smith' },
        { label: 'Address', value: '45 Innovation Drive' },
        { label: 'City', value: 'San Francisco, CA 94105' },
      ],
    },
  ]);

  // === Line items ===

  doc.heading('Service details', { level: 'h2' });

  doc.table(
    [
      {
        description: 'Web application development — Sprint 1',
        qty: '10',
        unit: '€650.00',
        total: '€6,500.00',
      },
      {
        description: 'Web application development — Sprint 2',
        qty: '12',
        unit: '€650.00',
        total: '€7,800.00',
      },
      { description: 'UX/UI Design — Mockups', qty: '5', unit: '€550.00', total: '€2,750.00' },
      { description: 'Security audit', qty: '3', unit: '€800.00', total: '€2,400.00' },
      { description: 'Team training', qty: '2', unit: '€1,200.00', total: '€2,400.00' },
    ],
    {
      columns: [
        { header: 'Description', key: 'description', width: 'auto' },
        { header: 'Qty', key: 'qty', width: 15, align: 'center' },
        { header: 'Unit Price', key: 'unit', width: 25, align: 'right' },
        { header: 'Total', key: 'total', width: 25, align: 'right' },
      ],
      footRow: ['', '', 'SUBTOTAL', '€21,850.00'],
    },
  );

  // === Totals ===

  doc.fields([
    { label: 'Subtotal', value: '€21,850.00' },
    { label: 'VAT (20%)', value: '€4,370.00' },
    { label: 'Total', value: '€26,220.00', highlight: true },
  ]);

  // === Payment conditions ===

  doc
    .heading('Payment terms', { level: 'h2' })
    .bulletList([
      'Payment by wire transfer within 30 days',
      'IBAN: FR76 1234 5678 9012 3456 7890 123 — BIC: ACMEFRP0',
      'Late payment: annual rate of 10% on the total amount, plus a fixed recovery fee of €40.00',
    ]);

  // === Signature ===

  doc.keepTogether(() => {
    doc
      .heading('Approval', { level: 'h2' })
      .signatureZone([{ label: 'Service provider signature' }, { label: 'Client signature (approved)' }], {
        caption: 'Signed in London on April 9, 2026',
      })
      .closingNote('Acme Corporation Ltd — Company No. 12345678 — VAT GB123456789 — Share capital €50,000');
  });

  return doc.finalize();
}
