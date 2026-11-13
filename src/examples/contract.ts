import { PDFDocument, presetTheme } from '../index';
import { exampleFonts, withInter } from './fonts';

const REFERENCE = 'SA-2026-017';
const TITLE = `Service Agreement ${REFERENCE}`;
const JUSTIFIED = { align: 'justify' } as const;

/** The service agreement example. */
export function buildContract(): PDFDocument {
  const theme = presetTheme('slate', withInter());

  const doc = new PDFDocument({
    theme,
    fonts: exampleFonts,
    format: 'A4',
    title: TITLE,
    author: 'Acme Corp',
    subject: 'Professional services agreement',
    keywords: ['contract', 'services', 'agreement'],
  });

  // Declared before the content: every page gets them.
  doc.pageHeader({ title: TITLE, folio: true });
  doc.pageFooter({ left: 'Acme Corp — Confidential', right: 'Page {page} of {pages}' });
  doc.watermark('DRAFT', { allPages: true });

  // === Title and parties ===

  doc.heading('Service Agreement').separator();

  doc.fields(
    [
      { label: 'Reference', value: REFERENCE },
      { label: 'Date', value: 'November 13, 2026' },
      { label: 'Effective date', value: 'December 1, 2026' },
    ],
    { layout: 'inline' },
  );

  doc.headerColumns([
    {
      title: 'The Provider',
      fields: [
        { label: 'Company', value: 'Acme Corp Ltd' },
        { label: 'Represented by', value: 'Daniel Reyes, Managing Director' },
        { label: 'Address', value: '42 Innovation Avenue, London WC2B 6TP' },
        { label: 'Company No.', value: '12345678' },
      ],
    },
    {
      title: 'The Client',
      fields: [
        { label: 'Company', value: 'Northwind Logistics Inc.' },
        { label: 'Represented by', value: 'Maria Lindqvist, Chief Operating Officer' },
        { label: 'Address', value: '45 Harbour Street, Rotterdam 3011' },
        { label: 'Company No.', value: 'NL 8765 4321' },
      ],
    },
  ]);

  doc.heading('Preamble', { level: 'h2' });

  doc.paragraphs(
    [
      'This Service Agreement (the "Agreement") is made between Acme Corp Ltd (the "Provider") and Northwind ' +
        'Logistics Inc. (the "Client"), together the "Parties" and each a "Party". The Provider designs, builds ' +
        'and operates software for logistics companies. The Client wishes to modernise its shipment tracking ' +
        'platform and to entrust that work to the Provider.',
      'The Parties have met several times between September and November 2026 to define the scope of the ' +
        'work, its schedule and its price. They now wish to record the terms on which the Provider will ' +
        'perform the services described below, and agree as follows.',
    ],
    JUSTIFIED,
  );

  // === 1. Definitions ===

  doc.heading('Definitions', { level: 'h2', number: '1', rule: true });

  doc.richText(
    'In this Agreement, **"Services"** means the work described in Article 2 and in any Statement of Work ' +
      'signed by both Parties. **"Deliverables"** means everything the Provider hands over to the Client as ' +
      'a result of the Services, including source code, designs and documentation. **"Confidential ' +
      'Information"** means any information disclosed by one Party to the other that is marked as ' +
      'confidential or that a reasonable person would regard as such.',
    JUSTIFIED,
  );

  // === 2. Subject matter ===

  doc.heading('Subject matter', { level: 'h2', number: '2', rule: true });

  doc.richText(
    'The Provider undertakes to carry out the **redesign and migration** of the Client shipment tracking ' +
      'platform, in accordance with the specifications annexed to this Agreement. The Services are performed ' +
      'with the care and skill expected of a *professional software provider*, and in line with the ' +
      'practices of the trade.',
    JUSTIFIED,
  );

  doc.numberedList([
    {
      text: 'Discovery and design',
      subItems: ['Workshops with the Client operations team', 'Target architecture and migration plan'],
    },
    {
      text: 'Development of the new platform',
      subItems: [
        'Tracking API and customer portal',
        'Integration with the carriers the Client already uses',
        'Automated tests and continuous delivery pipeline',
      ],
    },
    'Migration of the existing data and switch-over',
    {
      text: 'Handover and training',
      detail: 'Two training sessions of half a day each, for up to twelve people.',
    },
  ]);

  // === 3. Term ===

  doc.heading('Term', { level: 'h2', number: '3', rule: true });

  doc.paragraphs(
    [
      'This Agreement takes effect on the effective date stated on the first page and remains in force for ' +
        'twelve (12) months, unless terminated earlier in accordance with Article 12. The Services are ' +
        'expected to be completed within nine (9) months of the effective date.',
      'The Parties may extend the term by a written amendment signed by both of them, at the latest thirty ' +
        '(30) days before it ends. Without such an amendment, the Agreement ends on its last day and no ' +
        'tacit renewal applies.',
    ],
    JUSTIFIED,
  );

  // === 4. Fees ===

  doc.heading('Fees and schedule', { level: 'h2', number: '4', rule: true });

  doc.richText(
    'In return for the Services, the Client pays the Provider a fixed fee of **€148,500**, excluding VAT, ' +
      'split into the instalments below. The first instalment falls due on signature, each of the others when ' +
      'the milestone it is tied to is accepted by the Client under Article 5.',
    JUSTIFIED,
  );

  doc.table(
    [
      { milestone: 'Signature of the Agreement', due: 'December 1, 2026', share: '20%', amount: '€29,700.00' },
      { milestone: 'Approval of the target architecture', due: 'January 29, 2027', share: '15%', amount: '€22,275.00' },
      { milestone: 'Delivery of the tracking API', due: 'March 31, 2027', share: '25%', amount: '€37,125.00' },
      { milestone: 'Delivery of the customer portal', due: 'May 28, 2027', share: '20%', amount: '€29,700.00' },
      { milestone: 'Data migration and switch-over', due: 'July 30, 2027', share: '15%', amount: '€22,275.00' },
      { milestone: 'Final acceptance and handover', due: 'August 31, 2027', share: '5%', amount: '€7,425.00' },
    ],
    {
      columns: [
        { header: 'Milestone', key: 'milestone', width: 'auto' },
        { header: 'Planned date', key: 'due', width: 35 },
        { header: 'Share', key: 'share', width: 18, align: 'right' },
        { header: 'Amount', key: 'amount', width: 28, align: 'right' },
      ],
      footRow: ['Total excluding VAT', '', '100%', '€148,500.00'],
    },
  );

  doc.paragraph(
    'Work requested by the Client outside the scope of this Agreement is charged at the day rates below, ' +
      'after the Client has approved a written estimate.',
    JUSTIFIED,
  );

  doc.bulletList([
    'Senior engineer: €720 per day',
    'Engineer: €580 per day',
    'Designer: €540 per day',
    {
      text: 'Expenses',
      subItems: ['Travel and accommodation at cost, with receipts', 'No mark-up on third-party licences'],
    },
  ]);

  // === 5. Acceptance ===

  doc.heading('Acceptance', { level: 'h2', number: '5', rule: true });

  doc.paragraphs(
    [
      'When the Provider delivers a milestone, the Client has ten (10) business days to test it against the ' +
        'specifications and to notify the Provider, in writing, of any defect. The notice describes each ' +
        'defect precisely enough for the Provider to reproduce it.',
      'The Provider corrects the defects reported in good time within a reasonable period, and the Client ' +
        'then tests the correction for five (5) business days. A milestone is deemed accepted if the Client ' +
        'does not reply within the period, or if it uses the Deliverable in production.',
    ],
    JUSTIFIED,
  );

  // === 6. Payment ===

  doc.heading('Invoicing and payment', { level: 'h2', number: '6', rule: true });

  doc.richBlocks(
    [
      {
        type: 'paragraph',
        runs: [
          { text: 'The Provider invoices each instalment on acceptance of its milestone. Invoices are payable ' },
          { text: 'within thirty (30) days', bold: true },
          { text: ' of the date they are issued, by wire transfer to the account stated on the invoice.' },
        ],
      },
      {
        type: 'numberedList',
        items: [
          [
            { text: 'Amounts are stated ' },
            { text: 'excluding VAT', italic: true },
            { text: ', which the Client adds at the rate in force.' },
          ],
          [{ text: 'Late payment bears interest at the rate of ' }, { text: '8% per year', bold: true }, { text: '.' }],
          [{ text: 'The Client pays a fixed recovery fee of €40 for each invoice paid late.' }],
        ],
      },
    ],
    JUSTIFIED,
  );

  doc.infoBox(
    'If an invoice is not paid within sixty (60) days, the Provider may suspend the Services until the ' +
      'amount due is received, after giving the Client eight (8) days written notice. The deadlines of the ' +
      'Provider are extended by the length of the suspension.',
    {
      variant: 'callout',
      eyebrow: 'Important',
      title: 'Suspension for non-payment',
    },
  );

  // === 7. Confidentiality ===

  doc.heading('Confidentiality', { level: 'h2', number: '7', rule: true });

  doc.richText(
    'Each Party keeps the Confidential Information of the other **strictly confidential**, uses it only to ' +
      'perform this Agreement and does not disclose it to anyone but its employees, advisers and ' +
      'subcontractors who need to know it and who are bound by a duty of confidentiality at least as strict ' +
      'as this one. These duties apply for the term of the Agreement and for five (5) years after it ends.',
    JUSTIFIED,
  );

  doc.paragraph('The duties above do not apply to information that:');

  doc.bulletList([
    'is or becomes public without a breach of this Agreement;',
    'was already known to the receiving Party, as shown by its records;',
    'is received lawfully from a third party who is free to share it;',
    {
      text: 'must be disclosed by law or by a court order',
      subItems: ['the receiving Party warns the other Party first, where the law allows it'],
    },
  ]);

  // === 8. Intellectual property ===

  doc.heading('Intellectual property', { level: 'h2', number: '8', rule: true });

  doc.paragraphs(
    [
      'On payment in full of the fees due, the Provider assigns to the Client the intellectual property ' +
        'rights in the Deliverables made specifically for the Client, for the whole world and for the full ' +
        'legal term of those rights. Until then, the Client holds a non-exclusive licence to use them.',
      'The Provider keeps the rights in its pre-existing tools, libraries and methods (the "Background ' +
        'Materials"). It grants the Client a perpetual, worldwide, non-exclusive licence to use them as part ' +
        'of the Deliverables. The Provider may reuse its general knowledge and skills in other projects.',
    ],
    JUSTIFIED,
  );

  // === 9. Warranties ===

  doc.heading('Warranties', { level: 'h2', number: '9', rule: true });

  doc.richText(
    'The Provider warrants that the Services will be performed with **reasonable care and skill** and that ' +
      'the Deliverables will conform to the specifications for ninety (90) days after final acceptance. During ' +
      'that period, the Provider corrects any non-conformity at no charge, provided that the Client reports it ' +
      'in writing and that the Deliverable has not been modified by anyone else. Except as stated in this ' +
      'Article, all warranties implied by law are excluded to the extent the law allows it.',
    JUSTIFIED,
  );

  // The lead-in stays with its list.
  doc.keepTogether(() => {
    doc.paragraph('The Client warrants in turn that:');

    doc.numberedList([
      'it has the authority to enter into this Agreement and to give the instructions the Provider needs;',
      {
        text: 'the materials it supplies do not infringe the rights of any third party',
        subItems: ['texts, images and data of its customers', 'access to its systems and to the carriers interfaces'],
      },
      'it provides the information and the people the Provider asks for in good time.',
    ]);
  });

  // === 10. Data protection ===

  doc.heading('Data protection', { level: 'h2', number: '10', rule: true });

  doc.paragraphs(
    [
      'Where the Services involve personal data, the Client is the controller and the Provider the processor. ' +
        'The Provider processes that data only on the documented instructions of the Client, keeps it secure ' +
        'with appropriate technical and organisational measures and does not transfer it outside the United ' +
        'Kingdom and the European Economic Area without the prior consent of the Client.',
      'The Provider informs the Client without undue delay, and within forty-eight (48) hours at the latest, ' +
        'after becoming aware of a personal data breach. When the Agreement ends, the Provider deletes or ' +
        'returns the personal data at the choice of the Client.',
    ],
    JUSTIFIED,
  );

  // === 11. Liability ===

  doc.heading('Liability', { level: 'h2', number: '11', rule: true });

  doc.richText(
    'Neither Party excludes or limits its liability for death or personal injury caused by its negligence, ' +
      'for fraud, or for anything the law does not allow it to limit. Subject to that, the total liability ' +
      'of the Provider under this Agreement is **limited to the fees paid** in the twelve (12) months before ' +
      'the event, and the Provider is not liable for loss of profit, loss of revenue or indirect loss.',
    JUSTIFIED,
  );

  doc.heading('Termination', { level: 'h2', number: '12', rule: true });

  doc.paragraph(
    'Either Party may terminate this Agreement with immediate effect, by written notice, if the other Party:',
  );

  doc.bulletList([
    'commits a material breach and does not remedy it within thirty (30) days of a notice asking it to;',
    'becomes insolvent, enters into liquidation or stops carrying on its business;',
    {
      text: 'is prevented from performing by an event beyond its control for more than sixty (60) days',
      subItems: ['strikes, fire, floods and failures of public networks are such events'],
    },
  ]);

  doc.paragraph(
    'On termination, the Client pays for the Services performed up to the date of termination, and the ' +
      'Provider hands over the Deliverables completed so far. Articles 7, 8, 10 and 11 survive the end of this Agreement.',
    JUSTIFIED,
  );

  // === 13. General provisions ===

  doc.heading('General provisions', { level: 'h2', number: '13', rule: true });

  doc.bulletList([
    {
      text: 'Entire agreement',
      detail: 'This Agreement replaces every earlier discussion, proposal and understanding between the Parties.',
    },
    {
      text: 'Amendments',
      detail: 'Any change must be in writing and signed by both Parties.',
    },
    {
      text: 'Notices',
      detail: 'Notices are sent to the address on the first page, by registered post or by e-mail with receipt.',
    },
    {
      text: 'Assignment',
      detail: 'Neither Party may assign this Agreement without the written consent of the other.',
    },
  ]);

  // === 14. Governing law ===

  doc.heading('Governing law and disputes', { level: 'h2', number: '14', rule: true });

  doc.paragraph(
    'This Agreement is governed by the laws of England and Wales. The Parties first try to settle any ' +
      'dispute amicably, through a meeting of their senior managers within fifteen (15) days of a written ' +
      'request. Failing that, the courts of London have exclusive jurisdiction.',
    JUSTIFIED,
  );

  // === Signatures ===

  doc.keepTogether(() => {
    doc
      .heading('Signatures', { level: 'h2', rule: true })
      .paragraph('To be signed in two originals, one for each Party.')
      .signatureZone(
        [
          { label: 'For the Provider', sublabel: 'Daniel Reyes, Managing Director' },
          { label: 'For the Client', sublabel: 'Maria Lindqvist, Chief Operating Officer' },
        ],
        { caption: 'Signed in ____________________ on ____ / ____ / ________' },
      );
  });

  return doc.finalize();
}
