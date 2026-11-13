import { PDFDocument, presetTheme } from '../index';
import { loadImageFromPath } from '../node';
import { exampleAsset } from './assets';
import { exampleFonts, withInter } from './fonts';

const EVENT = 'Acme Summit 2026';
const FORM = 'Registration form';

/** The registration form example. */
export function buildRegistrationForm(): PDFDocument {
  const theme = presetTheme('emerald', withInter());

  const doc = new PDFDocument({
    theme,
    fonts: exampleFonts,
    format: 'A4',
    title: `${FORM} — ${EVENT}`,
    author: 'Acme Corp',
    subject: 'Conference registration',
    keywords: ['registration', 'conference', 'form'],
  });

  doc.registerImages({
    logo: loadImageFromPath(exampleAsset('logos', 'logo-full-emerald.png')),
  });

  doc.pageFooter({ left: `${EVENT} — ${FORM}`, right: 'Page {page} of {pages}' });

  // === Header ===

  doc
    .logo('logo', { height: 10 })
    .heading(EVENT)
    .badge(FORM)
    .paragraph(
      'Complete this form and return it to registrations@acme.example before September 30, 2026. ' +
        'Fields already filled in come from your Acme account: check them and correct them if needed.',
    )
    .separator();

  // === Attendee ===

  doc.heading('1. Attendee', { level: 'h2' });

  doc
    .fieldRows([
      [
        { label: 'First name', value: 'Jane' },
        { label: 'Last name', value: 'Smith' },
      ],
      [
        { label: 'Job title', value: '' },
        { label: 'Company', value: 'TechStart Inc.' },
      ],
      [
        { label: 'Email', value: 'jane.smith@techstart.example' },
        { label: 'Phone', value: '' },
      ],
    ])
    .addressBlock([
      { text: 'TechStart Inc.', role: 'title' },
      { text: 'Accounts payable', role: 'subtitle' },
      { text: '45 Innovation Drive', role: 'address' },
      { text: 'San Francisco, CA 94105', role: 'address' },
    ]);

  // === Pass ===

  doc.heading('2. Choose your pass', { level: 'h2' });

  doc
    .checkbox('Standard pass: two days, all talks and workshops', { variant: 'checked' })
    .checkbox('Student pass: two days, proof of enrolment required')
    .checkbox('Workshop pass: Day 2 only, one workshop of your choice')
    .checkbox('Online pass: live stream and recordings');

  doc
    .inlineQuestion('Will you attend the gala dinner on October 14?', { variant: 'checked', answer: 'Yes' })
    .inlineQuestion('Do you have dietary requirements?')
    .inlineQuestion('Do you need step-free access?', { variant: 'cross', answer: 'No' });

  // === Fees ===

  doc.keepTogether(() => {
    doc.heading('3. Fees', { level: 'h2' }).table(
      [
        { item: 'Standard pass', until: '€390.00', after: '€490.00' },
        { item: 'Student pass', until: '€120.00', after: '€150.00' },
        { item: 'Workshop pass', until: '€220.00', after: '€280.00' },
        { item: 'Online pass', until: '€90.00', after: '€90.00' },
        { item: 'Gala dinner', until: '€75.00', after: '€75.00' },
      ],
      {
        columns: [
          { header: 'Item', key: 'item', width: 'auto' },
          { header: 'Until Aug. 31', key: 'until', width: 35, align: 'right' },
          { header: 'From Sept. 1', key: 'after', width: 35, align: 'right' },
        ],
        footRow: ['Prices exclude VAT', '', ''],
      },
    );
  });

  doc.fields(
    [
      { label: 'Selected pass', value: 'Standard pass' },
      { label: 'Gala dinner', value: '€75.00' },
      { label: 'Total (excl. VAT)', value: '€465.00', highlight: true },
    ],
    { layout: 'leader' },
  );

  // === Instructions ===

  doc.heading('4. Before you send it', { level: 'h2' });

  doc.infoBox('Registrations are confirmed once the payment has been received.', {
    title: 'Good to know',
    bulletPoints: [
      'Payment: bank transfer within 14 days of the confirmation email',
      'Cancellation: free until September 15, refunded at 50% after that date',
      'Substitution: a colleague may take your place at no cost',
    ],
    boldPrefixes: ['Payment:', 'Cancellation:', 'Substitution:'],
  });

  // === Consent and signature ===

  doc.heading('5. Consent', { level: 'h2' });

  doc.declarationsBox(
    [
      {
        text: 'I confirm that the information given above is accurate and complete.',
        highlights: [{ text: 'accurate', strong: true }],
      },
      {
        text: 'I accept the general terms of sale and the code of conduct of the event.',
        highlights: [{ text: 'accept', strong: true }],
      },
      { text: 'I agree that Acme Corp may send me news about future events (optional).' },
    ],
    { intro: 'By signing this form, the attendee declares that:', bullet: true },
  );

  doc
    .heading('Signature', { level: 'h2' })
    .signatureZone([{ label: 'Attendee signature', sublabel: 'Jane Smith' }, { label: 'Acme Corp stamp' }], {
      caption: 'Signed in ____________________ on ____ / ____ / ________',
    });

  return doc.finalize();
}
