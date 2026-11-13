import { PDFDocument, presetTheme, parseAddressLines } from '../index';
import { loadImageFromPath } from '../node';
import { exampleAsset } from './assets';
import { exampleFonts, withInter } from './fonts';

/** The business letter example. */
export function buildLetter(): PDFDocument {
  const theme = presetTheme('ocean', withInter());

  const doc = new PDFDocument({
    theme,
    fonts: exampleFonts,
    format: 'letter',
    title: 'Order confirmation — Ref. AC-2026-0417',
    author: 'Acme Corp',
    subject: 'Order confirmation letter',
    keywords: ['letter', 'order confirmation'],
  });

  doc.registerImage('logo', loadImageFromPath(exampleAsset('logos', 'logo-full-ocean.png')));

  doc.pageFooter({
    left: 'Acme Corp · Registered in England and Wales No. 01234567',
    right: 'Page {page} of {pages}',
  });

  // === Letterhead ===

  doc.columns([
    (column) => column.logo('logo', { height: 11 }),
    (column) =>
      column.paragraph('12 Harbour Road, Bristol BS1 4RW\n+44 117 496 0123\nsales@acme.example\nwww.acme.example', {
        level: 'small',
      }),
  ]);
  doc.separator({ color: 'primary' });

  // === Recipient, date and subject ===

  doc.inset({ width: 80 }, () => {
    doc.addressBlock(parseAddressLines('Ms. Jane Smith\nTechStart Inc.\n45 Innovation Drive\nSan Francisco, CA 94105'));
  });

  doc.fields(
    [
      { label: 'Date', value: 'November 13, 2026' },
      { label: 'Our reference', value: 'AC-2026-0417' },
      { label: 'Your order', value: 'PO-88213' },
    ],
    { layout: 'inline' },
  );

  doc.heading('Subject: confirmation of your order and delivery schedule', { level: 'h3' });

  // === Body ===

  doc.paragraph('Dear Ms. Smith,');

  doc.richText(
    'Thank you for choosing Acme Corp. We are pleased to confirm that your order **PO-88213** has been accepted and ' +
      'that production will start on **November 23, 2026**. This letter sets out what you can expect from us over the ' +
      'coming weeks.',
  );

  doc.richText(
    'Your team asked for a *phased* roll-out across three sites. We have planned it so that each site is live before the ' +
      'next one begins, which keeps the disruption to your daily operations to a minimum. The summary below shows the ' +
      'order as we understood it.',
  );

  doc.fields([
    { label: 'Equipment', value: '24 workstations' },
    { label: 'Sites', value: '3 offices' },
    { label: 'Order total', value: '$48,600.00', highlight: true },
  ]);

  doc.table(
    [
      { phase: 'Phase 1', site: 'San Francisco', delivery: 'December 7, 2026', units: '10' },
      { phase: 'Phase 2', site: 'Austin', delivery: 'January 18, 2027', units: '8' },
      { phase: 'Phase 3', site: 'Seattle', delivery: 'February 22, 2027', units: '6' },
    ],
    {
      columns: [
        { header: 'Phase', key: 'phase', width: 'auto' },
        { header: 'Site', key: 'site', width: 'auto' },
        { header: 'Delivery', key: 'delivery', width: 'auto' },
        { header: 'Units', key: 'units', width: 20, align: 'right' },
      ],
    },
  );

  doc.paragraph('Before each delivery, our installation team will need the following from you:');

  doc.bulletList([
    'a named contact on site, available on the delivery day',
    'access to the server room during the installation window',
    'the network details for the new workstations, sent at least ten days ahead',
  ]);

  doc.infoBox(
    'Delivery dates are firm once the network details have been received. A delay on your side moves the following phases by the same number of days.',
    {
      variant: 'callout',
    },
  );

  doc.richBlocks([
    {
      type: 'paragraph',
      runs: [
        { text: 'You can follow every shipment from your customer account at ' },
        { text: 'acme.example/orders', link: 'https://acme.example/orders' },
        { text: ', and our support team answers any question on the same day.' },
      ],
    },
  ]);

  doc.richText(
    'Our standard warranty covers **three years** of parts and labour on every workstation. For your order we have ' +
      'added on-site support during the first *ninety days*, so that your teams are never left waiting for a ' +
      'replacement.',
  );

  doc.keepTogether(() => {
    doc.inset({ left: 12, right: 12 }, () => {
      doc.richText(
        '*“Acme Corp will repair or replace any defective unit within two working days of the report, at no charge ' +
          'to the customer.”*  Terms and conditions of sale, section 7.2',
      );
    });
  });

  doc.richText(
    'Invoices are issued at the end of each phase and are payable within **30 days**. Should your accounts team ' +
      'need a purchase order number or a different billing address, please let us know before the first shipment.',
  );

  doc.paragraph(
    'We value this first project with TechStart and look forward to a long collaboration. Please sign and return the ' +
      'enclosed order form so that we can release the first shipment.',
  );

  // === Close ===

  doc.keepTogether(() => {
    doc
      .paragraph('Yours sincerely,')
      .signatureZone([{ label: 'Daniel Moore', sublabel: 'Head of Sales, Acme Corp' }])
      .paragraph('Enclosures: order form (2 pages), delivery schedule, terms and conditions of sale', {
        level: 'small',
      });
  });

  return doc.finalize();
}
