import { PDFDocument, presetTheme, SPACING, drawHighlightedText, measureHighlightedText } from '../index';
import { exampleFonts, withInter } from './fonts';

/** The stress test example. */
export function buildStressTest(): PDFDocument {
  const theme = presetTheme('ocean', withInter());

  const doc = new PDFDocument({
    theme,
    fonts: exampleFonts,
    format: 'A4',
    title: 'Acme Technologies — Operations & Compliance Manual 2026',
    author: 'Acme Technologies SA',
    subject: 'Internal operations manual — stress test document',
    keywords: ['operations', 'compliance', 'manual', 'stress-test'],
  });

  // === Cover ===

  doc.cover('Operations & Compliance Manual', {
    variant: 'wave',
    subtitle: 'Acme Technologies SA — Fiscal Year 2026',
  });

  // ===================================================================
  // SECTION 1 — Document Header
  // ===================================================================

  doc.heading('Operations & Compliance Manual 2026').badge('INTERNAL — CONFIDENTIAL').separator();

  doc.headerColumns([
    {
      title: 'Document information',
      fields: [
        { label: 'Reference', value: 'MT-OPS-2026-001' },
        { label: 'Version', value: '3.2' },
        { label: 'Effective date', value: '1 January 2026' },
      ],
    },
    {
      title: 'Distribution',
      fields: [
        { label: 'Classification', value: 'Confidential' },
        { label: 'Audience', value: 'Board, Exec, Compliance' },
        { label: 'Retention', value: '10 years' },
      ],
    },
  ]);

  doc.paragraph(
    'This manual consolidates all operational policies, governance structures, regulatory requirements, ' +
      'and internal procedures for Acme Technologies SA for the fiscal year 2026. All employees with ' +
      'management responsibilities are expected to review and acknowledge the contents of this document.',
  );

  // ===================================================================
  // SECTION 2 — Executive Summary
  // ===================================================================

  doc
    .heading('Executive Summary', { level: 'h2' })
    .paragraph(
      'Acme Technologies enters 2026 with strong operational foundations following a year of significant ' +
        'growth across all business units. Our compliance framework has been reinforced with enhanced monitoring ' +
        'capabilities, and our IT infrastructure has achieved 99.97% uptime across all production systems.',
    );

  doc.fields([
    { label: 'Revenue growth', value: '+23.4%', highlight: true },
    { label: 'Compliance score', value: '98.2 / 100', highlight: true },
    { label: 'Employee count', value: '1,247', highlight: true },
  ]);

  doc.paragraphs([
    'Strategic initiatives for the coming year include the expansion of our APAC operations center, ' +
      'the rollout of a unified client portal, and the migration of legacy trading systems to the next-generation platform.',
    'The board has approved a capital expenditure budget of EUR 42M for infrastructure modernization, with ' +
      'an additional EUR 8.5M allocated for regulatory technology upgrades mandated by the revised MiFID III framework.',
  ]);

  doc.infoBox('The executive committee has identified the following areas as mission-critical for the fiscal year:', {
    title: 'Key strategic priorities for 2026',
    bulletPoints: [
      'Complete APAC operations center build-out by Q3 2026',
      'Achieve ISO 27001 recertification with zero non-conformities',
      'Reduce client onboarding time from 14 days to 5 business days',
    ],
  });

  doc.bulletList([
    'Regulatory compliance across all jurisdictions of operation',
    'Operational resilience and business continuity planning',
    {
      text: 'Technology modernization roadmap',
      subItems: ['Legacy system decommissioning', 'Cloud migration phases 2 and 3'],
    },
    'Talent acquisition and retention strategy',
    {
      text: 'Client experience improvement program',
      subItems: ['Portal redesign', 'API self-service capabilities'],
    },
  ]);

  // ===================================================================
  // SECTION 3 — Organization & Governance
  // ===================================================================

  doc.heading('Organization & Governance', { level: 'h2' }).heading('Executive Leadership Team', { level: 'h3' });

  doc.columns([
    (column) =>
      column
        .heading('Executive Committee', { level: 'h4' })
        .bulletList(['C. Harper — CEO', 'M. Lawson — CFO', 'A. Novak — CTO', 'S. Chen — COO']),
    (column) =>
      column
        .heading('Board of Directors', { level: 'h4' })
        .bulletList([
          'J. Whitfield — Chair',
          'R. Tanaka — Independent',
          'L. Marques — Independent',
          'P. Reinhardt — Observer',
        ]),
  ]);

  doc.heading('Governance Framework', { level: 'h3' });

  doc.numberedList([
    'Annual board review of operational risk appetite and tolerance levels',
    {
      text: 'Quarterly compliance committee meetings',
      subItems: ['Review of regulatory changes', 'Assessment of compliance incidents', 'Policy update approvals'],
    },
    'Monthly executive risk dashboard publication',
    'Bi-annual internal audit cycle with external validation',
  ]);

  doc.heading('Registered Office', { level: 'h3' });

  doc.inset({ width: doc.measure / 2 }, () =>
    doc.addressBlock(
      [
        { text: 'Acme Technologies SA', role: 'title' },
        { text: 'European Headquarters', role: 'subtitle' },
        { text: '47 Kingsway', role: 'address' },
        { text: 'London WC2B 6TP, United Kingdom', role: 'address' },
      ],
      { boxStyle: 'surfaceBorder' },
    ),
  );

  doc.separator();

  // ===================================================================
  // SECTION 4 — Compliance & Regulatory
  // ===================================================================

  doc.heading('Compliance & Regulatory Framework', { level: 'h2' }).heading('Regulatory Status', { level: 'h3' });

  doc
    .checkbox('MiFID II / MiFID III — Full compliance achieved', { variant: 'checked' })
    .checkbox('GDPR — Data Protection Officer appointed', { variant: 'checked' })
    .checkbox('DORA — Implementation in progress (deadline Q4 2026)')
    .checkbox('Basel IV — Not applicable to current license scope', { variant: 'cross' });

  doc
    .heading('Compliance Questionnaire', { level: 'h3' })
    .inlineQuestion('Has the annual compliance training been completed?', { variant: 'checked', answer: 'Yes' })
    .inlineQuestion('Are all client files up to date with KYC requirements?', {
      variant: 'cross',
      answer: 'Remediation needed',
    })
    .inlineQuestion('Has the whistleblowing policy been distributed?', { answer: 'In progress' });

  doc.paragraph(
    'Note: All compliance gaps identified above must be addressed within 90 calendar days of this report. ' +
      'The Chief Compliance Officer will track remediation progress on a bi-weekly basis.',
    { level: 'small' },
  );

  doc.table(
    [
      { regulation: 'MiFID III', authority: 'AMF / ESMA', status: 'Compliant', deadline: 'Ongoing' },
      { regulation: 'GDPR', authority: 'CNIL', status: 'Compliant', deadline: 'Ongoing' },
      { regulation: 'DORA', authority: 'ACPR', status: 'In progress', deadline: 'Q4 2026' },
      { regulation: 'EMIR Refit', authority: 'ESMA', status: 'Compliant', deadline: 'Ongoing' },
      { regulation: 'AML / CFT 6th Directive', authority: 'TRACFIN', status: 'Review', deadline: 'Q2 2026' },
      { regulation: 'CSRD Reporting', authority: 'AMF', status: 'Planned', deadline: 'Q1 2027' },
    ],
    {
      columns: [
        { header: 'Regulation', key: 'regulation', width: 'auto' },
        { header: 'Authority', key: 'authority', width: 35 },
        { header: 'Status', key: 'status', width: 25, align: 'center' },
        { header: 'Deadline', key: 'deadline', width: 25, align: 'right' },
      ],
      alternateRowFill: true,
    },
  );

  doc.declarationsBox(
    [
      {
        text:
          'The undersigned confirms that all regulatory filings required under applicable national and EU law ' +
          'have been submitted within the prescribed deadlines for the current reporting period.',
      },
      {
        text:
          'Acme Technologies SA maintains adequate capital reserves as required by its operating license ' +
          'and has no outstanding regulatory sanctions or enforcement actions.',
      },
    ],
    { boxStyle: 'background' },
  );

  // ===================================================================
  // SECTION 5 — Project Portfolio
  // ===================================================================

  doc
    .heading('Project Portfolio', { level: 'h2' })
    .heading('Active Projects Overview', { level: 'h3' })
    .paragraph(
      'The following table summarizes all active projects within the technology and operations divisions. ' +
        'Projects are tracked through the centralized PMO and reported to the executive committee monthly.',
    );

  doc.table(
    [
      { project: 'APAC Ops Center', division: 'Operations', lead: 'S. Chen', status: 'On track', budget: '12,400' },
      { project: 'Client Portal v2', division: 'Technology', lead: 'A. Novak', status: 'On track', budget: '3,200' },
      { project: 'Legacy Migration', division: 'Technology', lead: 'K. Richter', status: 'At risk', budget: '8,700' },
      { project: 'ISO 27001 Recert', division: 'Compliance', lead: 'J. Reeves', status: 'On track', budget: '420' },
      {
        project: 'DORA Implementation',
        division: 'Compliance',
        lead: 'L. Bianchi',
        status: 'Delayed',
        budget: '1,850',
      },
      { project: 'API Gateway Upgrade', division: 'Technology', lead: 'P. Santos', status: 'Complete', budget: '780' },
      { project: 'ESG Data Platform', division: 'Data', lead: 'F. Nakamura', status: 'On track', budget: '2,100' },
      { project: 'Talent Management System', division: 'HR', lead: 'V. Okafor', status: 'On track', budget: '650' },
      {
        project: 'Trading Engine v3',
        division: 'Technology',
        lead: 'M. Kowalski',
        status: 'On track',
        budget: '5,400',
      },
      {
        project: 'DR Site Build-out',
        division: 'Infrastructure',
        lead: 'D. Patel',
        status: 'Planned',
        budget: '3,900',
      },
      {
        project: 'Cloud Cost Optimization',
        division: 'Infrastructure',
        lead: 'H. Mueller',
        status: 'On track',
        budget: '180',
      },
      {
        project: 'Regulatory Reporting Automation',
        division: 'Compliance',
        lead: 'E. Dupont',
        status: 'On track',
        budget: '1,200',
      },
      { project: 'Network Segmentation', division: 'Security', lead: 'R. Ivanov', status: 'On track', budget: '920' },
      {
        project: 'Identity & Access Mgmt',
        division: 'Security',
        lead: 'T. Andersen',
        status: 'At risk',
        budget: '1,350',
      },
      { project: 'Document Management', division: 'Operations', lead: 'C. Ferreira', status: 'Planned', budget: '470' },
      { project: 'Mobile App Refresh', division: 'Technology', lead: 'Y. Kim', status: 'On track', budget: '890' },
    ],
    {
      columns: [
        { header: 'Project', key: 'project', width: 'auto' },
        { header: 'Division', key: 'division', width: 28 },
        { header: 'Lead', key: 'lead', width: 25 },
        { header: 'Status', key: 'status', width: 22, align: 'center' },
        { header: 'Budget (kEUR)', key: 'budget', width: 25, align: 'right' },
      ],
      continuationTitle: 'Active Projects Overview (continued)',
      footRow: ['16 active projects', '', '', '', '42,410'],
      showHead: 'everyPage',
      alternateRowFill: true,
    },
  );

  // Parts of a whole on one line: colors from palette tokens, the rest shaded from the primary color.
  doc.heading('Projects by status', { level: 'h4' }).stackedBar([
    { label: 'On track', value: 10, color: 'success' },
    { label: 'Complete', value: 1 },
    { label: 'Planned', value: 2 },
    { label: 'At risk', value: 2, color: 'secondary' },
    { label: 'Delayed', value: 1, color: 'error' },
  ]);

  doc.fieldRows([
    [
      { label: 'Total budget', value: 'EUR 42,410k', highlight: true },
      { label: 'On track', value: '11 projects', highlight: true },
      { label: 'At risk / Delayed', value: '3 projects', highlight: true },
    ],
    [
      {
        label: 'PMO contact',
        value: 'operations-pmo@acme-tech.example',
        complement: 'Bi-weekly status reports distributed every Monday',
      },
      { label: 'Governance', value: 'Monthly SteerCo review' },
    ],
  ]);

  doc.infoBox(
    'Any project exceeding 15% budget overrun or more than 4 weeks behind schedule must be escalated ' +
      'to the Executive Committee within 5 business days. The project lead must prepare a recovery plan.',
    { title: 'Project escalation procedure' },
  );

  // ===================================================================
  // SECTION 6 — Human Resources
  // ===================================================================

  doc.heading('Human Resources', { level: 'h2' }).heading('Headcount Summary', { level: 'h3' });

  doc.table(
    [
      { quarter: 'Q1 2025', headcount: '1,089', hires: '42', departures: '18', turnover: '1.7%' },
      { quarter: 'Q2 2025', headcount: '1,128', hires: '57', departures: '22', turnover: '2.0%' },
      { quarter: 'Q3 2025', headcount: '1,178', hires: '68', departures: '24', turnover: '2.0%' },
      { quarter: 'Q4 2025', headcount: '1,211', hires: '51', departures: '19', turnover: '1.6%' },
      { quarter: 'Q1 2026 (est.)', headcount: '1,247', hires: '48', departures: '12', turnover: '1.0%' },
    ],
    {
      columns: [
        { header: 'Quarter', key: 'quarter', width: 'auto' },
        { header: 'Headcount', key: 'headcount', width: 25, align: 'right' },
        { header: 'New hires', key: 'hires', width: 25, align: 'right' },
        { header: 'Departures', key: 'departures', width: 25, align: 'right' },
        { header: 'Turnover', key: 'turnover', width: 25, align: 'right' },
      ],
      alternateRowFill: true,
    },
  );

  // Columns on a common scale: each quarter's hires, split into two layers, against the hiring plan.
  doc.heading('Hires per quarter', { level: 'h4' }).columnChart(
    [
      { label: 'Q1 2025', valueLabel: '42 hires', values: [18, 24] },
      { label: 'Q2 2025', valueLabel: '57 hires', values: [22, 35] },
      { label: 'Q3 2025', valueLabel: '68 hires', values: [24, 44] },
      { label: 'Q4 2025', valueLabel: '51 hires', values: [19, 32] },
      { label: 'Q1 2026 (est.)', valueLabel: '48 hires', values: [12, 36] },
    ],
    {
      series: [{ label: 'Replacements' }, { label: 'Net growth' }],
      reference: { value: 55, label: 'Plan: 55 hires per quarter' },
    },
  );

  doc.heading('Compensation & Benefits', { level: 'h3' });

  doc.fields([
    { label: 'Average salary', value: 'EUR 78,400', highlight: true },
    { label: 'Median bonus', value: 'EUR 12,200', highlight: true },
    { label: 'Benefits cost ratio', value: '18.3%', highlight: true },
  ]);

  doc.fieldRows([
    [
      { label: 'HR contact', value: 'compensation-and-benefits.administration@group-headquarters.example.org' },
      { label: 'Payroll IBAN', value: 'DE89370400440532013000' },
    ],
    [
      {
        label: 'Benefits portal',
        value: 'https://benefits.example.org/employees/self-service/enrolment-and-claims_2026',
      },
    ],
  ]);

  doc.heading('Benefits Package', { level: 'h4' });

  doc.fields([
    { label: 'Health insurance', value: 'Health plan Premium — 100% employer-paid' },
    { label: 'Pension', value: 'Pension plan — 4% employer contribution' },
    { label: 'Stock options', value: 'Stock option plan — annual vesting over 4 years' },
  ]);

  doc
    .heading('Training & Development', { level: 'h3' })
    .paragraph(
      'Acme Technologies allocates a minimum of 2.5% of gross payroll to professional development. ' +
        'Each employee is entitled to at least 40 hours of training per year.',
      { level: 'bodyBold' },
    );

  doc.numberedList([
    'Mandatory compliance training (all employees, annually)',
    {
      text: 'Technical certification programs',
      subItems: ['AWS Solutions Architect', 'Certified Kubernetes Administrator', 'CISSP for security team'],
    },
    'Leadership development program for senior managers',
    {
      text: 'Language courses',
      subItems: ['English (business level)', 'Mandarin (APAC team)'],
    },
  ]);

  doc
    .heading('Training Compliance', { level: 'h4' })
    .inlineQuestion('Has the 2025 training budget been fully utilized?', {
      variant: 'checked',
      answer: 'Yes — 97% utilized',
    })
    .inlineQuestion('Are all mandatory certifications current?', { variant: 'cross', answer: '12 renewals overdue' })
    .inlineQuestion(
      'Have the individual development plans of every employee promoted during the reporting period been reviewed and signed off by the line manager?',
      { variant: 'checked', answer: 'Pending', color: 'secondary' },
    );

  doc
    .checkbox('Annual performance reviews completed for all employees', { variant: 'checked' })
    .checkbox('Succession planning documented for critical roles', { variant: 'checked' });

  doc.separator();

  doc.heading('HR Contact', { level: 'h3' });

  doc.richBlocks([
    {
      type: 'paragraph',
      runs: [
        { text: 'For HR inquiries, contact the People team at ' },
        { text: 'people@acme-tech.example', link: 'mailto:people@acme-tech.example' },
        { text: ' or visit the ' },
        { text: 'internal HR portal', link: 'https://hr.acme-tech.example' },
        { text: '.' },
      ],
    },
  ]);

  doc.inset({ width: doc.measure / 2 }, () =>
    doc.addressBlock(
      [
        { text: 'People & Culture Department', role: 'title' },
        { text: 'Acme Technologies SA', role: 'subtitle' },
        { text: '47 Kingsway, 3rd Floor', role: 'address' },
        { text: 'London WC2B 6TP, United Kingdom', role: 'address' },
      ],
      { boxStyle: 'tint' },
    ),
  );

  // ===================================================================
  // SECTION 7 — IT Infrastructure
  // ===================================================================

  doc
    .addPage()
    .heading('IT Infrastructure & Security', { level: 'h2' })
    .heading('System Inventory', { level: 'h3' })
    .paragraph(
      'The following table lists all production-grade systems maintained by the Infrastructure division. ' +
        'Each system is subject to quarterly security assessments and annual penetration testing.',
    );

  doc.table(
    [
      { system: 'Trading Platform', env: 'Production', sla: '99.99%', audit: 'Mar 2026' },
      { system: 'Client Portal', env: 'Production', sla: '99.95%', audit: 'Feb 2026' },
      { system: 'Risk Engine', env: 'Production', sla: '99.99%', audit: 'Mar 2026' },
      { system: 'Data Warehouse', env: 'Production', sla: '99.90%', audit: 'Jan 2026' },
      { system: 'Email & Collaboration', env: 'SaaS', sla: '99.95%', audit: 'Dec 2025' },
      { system: 'HR Management', env: 'SaaS', sla: '99.90%', audit: 'Nov 2025' },
      { system: 'CRM Platform', env: 'Hybrid', sla: '99.95%', audit: 'Feb 2026' },
      { system: 'Backup & DR', env: 'On-premise', sla: '99.99%', audit: 'Mar 2026' },
    ],
    {
      columns: [
        { header: 'System', key: 'system', width: 'auto' },
        { header: 'Environment', key: 'env', width: 28 },
        { header: 'SLA', key: 'sla', width: 20, align: 'center' },
        { header: 'Last audit', key: 'audit', width: 25, align: 'right' },
      ],
      alternateRowFill: true,
    },
  );

  doc.heading('Incident Response Procedure', { level: 'h3' });

  doc.keepTogether(() => {
    doc.heading('Escalation Levels', { level: 'h3' });
    doc.numberedList([
      'Level 1 — Service desk triage (response: 15 min)',
      'Level 2 — Platform engineering team (response: 30 min)',
      {
        text: 'Level 3 — Senior engineering and management',
        subItems: ['CTO notification required', 'Client communication initiated', 'Post-incident review within 48h'],
      },
      'Level 4 — Executive crisis team (CEO + Board notification)',
    ]);
  });

  doc.infoBox(
    'All suspected security incidents must be reported to the CISO within 1 hour of detection. ' +
      'The Security Operations Center operates 24/7 and can be reached at +33 1 44 55 66 77.',
    {
      title: 'Security incident reporting',
      bulletPoints: [
        'Preserve all evidence — do not modify or delete affected systems',
        'Document the timeline of events with maximum precision',
        'Notify the DPO if personal data may be affected (GDPR 72h rule)',
        'Escalation: any incident touching client data is reported to the Executive Committee within 24 hours, ' +
          'together with the list of affected systems and the first containment measures taken.',
      ],
      boldPrefixes: ['Escalation:'],
    },
  );

  doc.heading('Patch Management', { level: 'h3' });

  doc.bulletList([
    'Critical vulnerabilities: patch within 24 hours',
    'High severity: patch within 7 calendar days',
    'Medium severity: patch within 30 calendar days',
    'Low severity: include in next scheduled maintenance window',
  ]);

  doc.declarationsBox(
    [
      {
        text:
          'All production changes follow the approved change management process. Emergency changes require ' +
          'retrospective CAB approval within 48 hours.',
      },
    ],
    { boxStyle: 'border' },
  );

  // ===================================================================
  // SECTION 8 — Client Portfolio
  // ===================================================================

  doc.heading('Client Portfolio', { level: 'h2' }).heading('Client Distribution by Segment', { level: 'h3' });

  doc.table(
    [
      { segment: 'Institutional', clients: '47', aum: '12,400', revenue: '42%', nps: '72' },
      { segment: 'Corporate', clients: '183', aum: '4,800', revenue: '24%', nps: '68' },
      { segment: 'Family Office', clients: '64', aum: '3,200', revenue: '18%', nps: '81' },
      { segment: 'Wealth Management', clients: '312', aum: '2,100', revenue: '12%', nps: '74' },
      { segment: 'Fintech Partners', clients: '28', aum: '890', revenue: '4%', nps: '77' },
      { segment: 'Government', clients: '12', aum: '1,450', revenue: '—', nps: '65' },
      { segment: 'Non-profit', clients: '8', aum: '340', revenue: '—', nps: '83' },
      { segment: 'Academic', clients: '5', aum: '120', revenue: '—', nps: '90' },
      { segment: 'Startup Program', clients: '41', aum: '85', revenue: '—', nps: '71' },
      { segment: 'Other', clients: '19', aum: '210', revenue: '—', nps: '69' },
    ],
    {
      columns: [
        { header: 'Segment', key: 'segment', width: 'auto' },
        { header: 'Clients', key: 'clients', width: 20, align: 'right' },
        { header: 'AUM (EUR M)', key: 'aum', width: 25, align: 'right' },
        { header: 'Revenue share', key: 'revenue', width: 25, align: 'right' },
        { header: 'NPS', key: 'nps', width: 15, align: 'center' },
      ],
      footRow: ['Total', '719', '25,595', '100%', '75 avg'],
      alternateRowFill: true,
    },
  );

  // A ring with its legend: the value of each slice is formatted by the caller.
  doc.heading('Assets under management by segment', { level: 'h4' }).donutChart(
    [
      { label: 'Institutional', value: 12400, legendValue: 'EUR 12,400M' },
      { label: 'Corporate', value: 4800, legendValue: 'EUR 4,800M' },
      { label: 'Family Office', value: 3200, legendValue: 'EUR 3,200M' },
      { label: 'Wealth Management', value: 2100, legendValue: 'EUR 2,100M' },
      { label: 'Government', value: 1450, legendValue: 'EUR 1,450M' },
      { label: 'Other segments', value: 1645, legendValue: 'EUR 1,645M' },
    ],
    { centerLabel: 'EUR 25.6bn' },
  );

  doc.heading('Client Satisfaction', { level: 'h3' });

  doc.fieldRows([
    [
      { label: 'Overall NPS', value: '75', highlight: true },
      { label: 'Retention rate', value: '96.8%', highlight: true },
      { label: 'Avg. tenure', value: '6.2 years', highlight: true },
    ],
    [
      { label: 'Survey response rate', value: '84%', complement: 'Up from 71% in 2024' },
      { label: 'Top complaint', value: 'Onboarding speed' },
    ],
  ]);

  // Columns do not continue across pages: kept together, they move whole when they do not fit.
  doc.keepTogether(() =>
    doc.columns([
      (column) =>
        column
          .heading('Client services', { level: 'h3' })
          .bulletList(['Dedicated RM per segment', '24/5 support desk', 'Quarterly business reviews']),
      (column) =>
        column
          .heading('Digital channels', { level: 'h3' })
          .bulletList(['Client portal (web + mobile)', 'API access (REST + FIX)', 'Automated reporting']),
    ]),
  );

  doc.richBlocks([
    {
      type: 'paragraph',
      runs: [
        { text: 'Client feedback can be submitted through the ' },
        { text: 'client satisfaction portal', link: 'https://feedback.acme-tech.example' },
        { text: ' or by contacting the relationship management team.' },
      ],
    },
  ]);

  // ===================================================================
  // SECTION 9 — Financial Overview
  // ===================================================================

  doc.heading('Financial Overview', { level: 'h2' }).heading('Profit & Loss Summary', { level: 'h3' });

  doc.keepTogether(() => {
    doc.table(
      [
        { item: 'Revenue', y2024: '142,300', y2025: '175,600', y2026: '210,000', var: '+19.6%' },
        { item: 'Cost of revenue', y2024: '(48,200)', y2025: '(57,400)', y2026: '(65,000)', var: '+13.2%' },
        { item: 'Gross profit', y2024: '94,100', y2025: '118,200', y2026: '145,000', var: '+22.7%' },
        { item: 'Operating expenses', y2024: '(62,800)', y2025: '(74,100)', y2026: '(88,000)', var: '+18.8%' },
        { item: 'EBITDA', y2024: '31,300', y2025: '44,100', y2026: '57,000', var: '+29.3%' },
        { item: 'Net income', y2024: '22,100', y2025: '31,800', y2026: '41,000', var: '+28.9%' },
      ],
      {
        columns: [
          { header: 'Line item', key: 'item', width: 'auto' },
          { header: '2024 Actual', key: 'y2024', width: 28, align: 'right' },
          { header: '2025 Actual', key: 'y2025', width: 28, align: 'right' },
          { header: '2026 Budget', key: 'y2026', width: 28, align: 'right' },
          { header: 'Variance', key: 'var', width: 22, align: 'right' },
        ],
        footRow: ['All amounts in kEUR', '', '', '', ''],
      },
    );
  });

  // Lines over a common axis, the range of a forecast as a band, and a period highlighted under the main line.
  const years = [2024, 2025, 2026, 2027, 2028, 2029, 2030];
  doc.heading('Revenue outlook', { level: 'h3' }).lineChart(
    {
      xs: years,
      lines: [
        { label: 'Revenue (base case)', values: [142.3, 175.6, 210, 244, 278, 311, 342], emphasis: true },
        { label: 'Operating costs', values: [111, 131.5, 153, 174, 194, 213, 231], color: 'secondary', dash: [1, 1] },
      ],
      band: {
        label: 'Range of scenarios',
        lower: [142.3, 175.6, 198, 219, 238, 255, 270],
        upper: [142.3, 175.6, 222, 271, 322, 375, 428],
      },
    },
    {
      yTitle: 'EUR M',
      xTitle: 'Fiscal year',
      highlight: { from: 2026, to: 2028, label: 'Current plan' },
      formatX: (year) => `FY${year}`,
    },
  );

  doc.heading('Key Financial Metrics', { level: 'h3' });

  const pill = measureHighlightedText(doc, 'EBITDA margin: 27.1%');
  doc.ensureSpace(pill.height + doc.resolveSpaceAfter());
  // `y` is the top of a pill: its padding bleeds into the space above, so the pill text sits on the line.
  let lineTop = doc.getYPos();
  drawHighlightedText(doc, 'EBITDA margin: 27.1%', { x: doc.margins.left, y: lineTop - pill.padding, metrics: pill });
  drawHighlightedText(doc, 'Net margin: 19.5%', { x: doc.margins.left + 55, y: lineTop - pill.padding, strong: true });
  doc.endBlock(lineTop + pill.height);

  doc.paragraph(
    'The 2026 budget reflects continued investment in technology and operations while maintaining strong ' +
      'profitability. The EBITDA margin improvement is driven by operational leverage from the APAC expansion ' +
      'and reduced per-unit infrastructure costs following the cloud migration.',
  );

  doc.fields([
    { label: 'ROE', value: '24.3%', highlight: true },
    { label: 'Debt-to-equity', value: '0.32', highlight: true },
    { label: 'Cash reserves', value: 'EUR 67.2M', highlight: true },
  ]);

  doc.paragraph('Source: audited financial statements (independent auditor, March 2026).', { level: 'caption' });

  doc.separator();

  doc.heading('Capital Allocation', { level: 'h3' });

  doc.paragraphs([
    'The capital allocation framework prioritizes organic growth investments while maintaining a strong balance sheet. ' +
      'The board has approved a dividend payout ratio of 35% of net income for FY2025.',
    'Share buyback programs are not currently planned, as management believes reinvestment in the business ' +
      'offers superior returns relative to the cost of capital.',
  ]);

  doc.heading('Budget Highlights', { level: 'h4' });

  doc.ensureSpace(pill.height + SPACING.small);
  lineTop = doc.getYPos();
  drawHighlightedText(doc, 'CapEx: EUR 42M', { x: doc.margins.left, y: lineTop - pill.padding, strong: true });
  doc.endBlock(lineTop + pill.height, SPACING.small);

  // ===================================================================
  // SECTION 10 — Office Locations
  // ===================================================================

  doc.heading('Office Locations', { level: 'h2' }).heading('European Operations', { level: 'h3' });

  doc.headerColumns([
    {
      title: 'London (HQ)',
      fields: [
        { label: 'Employees', value: '640' },
        { label: 'Functions', value: 'All corporate functions' },
        { label: 'Capacity', value: '750 desks' },
      ],
    },
    {
      title: 'London',
      fields: [
        { label: 'Employees', value: '215' },
        { label: 'Functions', value: 'Trading, Sales' },
        { label: 'Capacity', value: '280 desks' },
      ],
    },
  ]);

  doc.inset({ width: doc.measure / 2 }, () =>
    doc.addressBlock(
      [
        { text: 'Acme Technologies UK Ltd', role: 'title' },
        { text: 'London Office', role: 'subtitle' },
        { text: '30 Finsbury Square', role: 'address' },
        { text: 'London EC2A 1AG, United Kingdom', role: 'address' },
      ],
      { boxStyle: 'surface' },
    ),
  );

  doc.heading('Asia-Pacific Operations', { level: 'h3' });

  doc.inset({ width: doc.measure / 2 }, () =>
    doc.addressBlock(
      [
        { text: 'Acme Technologies Asia Pte Ltd', role: 'title' },
        { text: 'APAC Regional Hub', role: 'subtitle' },
        { text: '8 Marina View, Asia Square Tower 1', role: 'address' },
        { text: 'Singapore 018960', role: 'address' },
      ],
      { boxStyle: 'tint' },
    ),
  );

  doc.heading('Americas Liaison', { level: 'h3' });

  doc.inset({ width: doc.measure / 2 }, () =>
    doc.addressBlock(
      [
        { text: 'Acme Technologies Inc.', role: 'title' },
        { text: 'New York Representative Office', role: 'subtitle' },
        { text: '200 Park Avenue, Suite 1700', role: 'address' },
        { text: 'New York, NY 10166, USA', role: 'address' },
      ],
      { boxStyle: 'border' },
    ),
  );

  doc.paragraph(
    'Office occupancy data as of Q1 2026. Contact facilities@acme-tech.example for space allocation requests.',
    { level: 'smallMuted' },
  );

  // ===================================================================
  // SECTION 11 — Legal Declarations
  // ===================================================================

  doc.heading('Legal Declarations & Attestations').heading('Management Declarations', { level: 'h2' });

  doc.declarationsBox(
    [
      {
        text:
          'To the best of our knowledge and belief, the information presented in this manual is accurate, ' +
          'complete, and fairly represents the operational status of Acme Technologies SA as of the date of publication.',
      },
      {
        text:
          'All material risks have been identified and are subject to appropriate monitoring and mitigation ' +
          'measures as described in the relevant sections of this document.',
      },
      {
        text:
          'The financial data included herein is consistent with the audited financial statements ' +
          'and has been reviewed by the Chief Financial Officer.',
      },
    ],
    { boxStyle: 'surfaceBorder' },
  );

  doc.heading('Director Certifications', { level: 'h3' });

  doc
    .checkbox('I certify that I have read and understood this manual in its entirety', { variant: 'checked' })
    .checkbox('I confirm that all information pertaining to my area of responsibility is accurate', {
      variant: 'checked',
    })
    .checkbox('I acknowledge responsibility for ensuring compliance within my department');

  doc.keepTogether(() => {
    doc.heading('External Auditor Confirmation', { level: 'h3' });
    doc
      .inlineQuestion('Have the financial statements been audited without qualification?', {
        variant: 'checked',
        answer: 'Unqualified opinion',
      })
      .inlineQuestion('Were any material weaknesses identified in internal controls?', {
        variant: 'cross',
        answer: 'None identified',
      })
      .inlineQuestion('Is the going concern assumption appropriate?', { variant: 'checked', answer: 'Confirmed' });
  });

  doc.paragraph(
    'This section constitutes a legally binding declaration by the signatories below. Any misrepresentation ' +
      'may result in personal liability under applicable national and European law.',
    { level: 'italic' },
  );

  // ===================================================================
  // SECTION 12 — Edge Cases (Stress)
  // ===================================================================

  doc
    .addPage()
    .heading('Appendix A — Detailed Reference Data')
    .heading('Extended Regulatory Reference', { level: 'h2' });

  doc.paragraph(
    'This appendix contains the complete regulatory reference matrix covering all jurisdictions in which ' +
      'Acme Technologies SA or any of its subsidiaries currently operates or has applied for operating licenses. ' +
      'The matrix is maintained by the Legal & Compliance department and is updated on a quarterly basis to reflect ' +
      'changes in the regulatory landscape. Each entry includes the applicable regulation, the supervising authority, ' +
      'the current compliance status, the date of the last assessment, and the name of the internal owner responsible ' +
      'for monitoring ongoing compliance. This comprehensive approach ensures that the organization maintains a ' +
      'complete and auditable record of its regulatory obligations across all markets. The annual compliance ' +
      // Locale-formatted currency inside justified text.
      `budget amounts to ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(1250000)}.`,
    { align: 'justify' },
  );

  doc.heading('Full Regulatory Matrix', { level: 'h3' });

  doc.table(
    [
      { regulation: 'MiFID III', jurisdiction: 'EU', authority: 'ESMA', status: 'Compliant', owner: 'J. Reeves' },
      { regulation: 'GDPR', jurisdiction: 'EU', authority: 'CNIL', status: 'Compliant', owner: 'L. Bianchi' },
      { regulation: 'DORA', jurisdiction: 'EU', authority: 'ACPR', status: 'In progress', owner: 'K. Richter' },
      { regulation: 'EMIR Refit', jurisdiction: 'EU', authority: 'ESMA', status: 'Compliant', owner: 'J. Reeves' },
      {
        regulation: 'AML 6th Directive',
        jurisdiction: 'EU',
        authority: 'TRACFIN',
        status: 'Review',
        owner: 'E. Dupont',
      },
      { regulation: 'CSRD', jurisdiction: 'EU', authority: 'AMF', status: 'Planned', owner: 'F. Nakamura' },
      { regulation: 'FCA Handbook', jurisdiction: 'UK', authority: 'FCA', status: 'Compliant', owner: 'T. Andersen' },
      { regulation: 'UK GDPR', jurisdiction: 'UK', authority: 'ICO', status: 'Compliant', owner: 'L. Bianchi' },
      {
        regulation: 'Senior Managers Regime',
        jurisdiction: 'UK',
        authority: 'FCA',
        status: 'Compliant',
        owner: 'T. Andersen',
      },
      { regulation: 'MAS SFA', jurisdiction: 'Singapore', authority: 'MAS', status: 'Compliant', owner: 'S. Chen' },
      { regulation: 'PDPA', jurisdiction: 'Singapore', authority: 'PDPC', status: 'Compliant', owner: 'S. Chen' },
      { regulation: 'SEC Rule 15c3-1', jurisdiction: 'USA', authority: 'SEC', status: 'N/A', owner: 'R. Ivanov' },
      { regulation: 'Dodd-Frank', jurisdiction: 'USA', authority: 'CFTC', status: 'N/A', owner: 'R. Ivanov' },
      { regulation: 'SOX Compliance', jurisdiction: 'USA', authority: 'SEC', status: 'Voluntary', owner: 'M. Lawson' },
      {
        regulation: 'Swiss FINMA',
        jurisdiction: 'Switzerland',
        authority: 'FINMA',
        status: 'Planned',
        owner: 'P. Santos',
      },
      { regulation: 'JFSA FIEA', jurisdiction: 'Japan', authority: 'JFSA', status: 'Assessment', owner: 'Y. Kim' },
      { regulation: 'HKMA SFC', jurisdiction: 'Hong Kong', authority: 'SFC', status: 'Planned', owner: 'S. Chen' },
      {
        regulation: 'ASIC AFS License',
        jurisdiction: 'Australia',
        authority: 'ASIC',
        status: 'Planned',
        owner: 'D. Patel',
      },
      {
        regulation: 'BaFin KWG',
        jurisdiction: 'Germany',
        authority: 'BaFin',
        status: 'Compliant',
        owner: 'H. Mueller',
      },
      {
        regulation: 'CONSOB TUF',
        jurisdiction: 'Italy',
        authority: 'CONSOB',
        status: 'Compliant',
        owner: 'L. Bianchi',
      },
      { regulation: 'CNMV LMV', jurisdiction: 'Spain', authority: 'CNMV', status: 'Compliant', owner: 'C. Ferreira' },
    ],
    {
      columns: [
        { header: 'Regulation', key: 'regulation', width: 'auto' },
        { header: 'Jurisdiction', key: 'jurisdiction', width: 25 },
        { header: 'Authority', key: 'authority', width: 25 },
        { header: 'Status', key: 'status', width: 24, align: 'center' },
        { header: 'Owner', key: 'owner', width: 22 },
      ],
      showHead: 'everyPage',
      continuationTitle: 'Full Regulatory Matrix (continued)',
      alternateRowFill: true,
    },
  );

  doc.paragraph(
    'Note: Jurisdictions marked "N/A" indicate that Acme Technologies does not currently hold a license in that ' +
      'market but monitors regulatory developments for potential future entry. "Planned" indicates license applications ' +
      'that are scheduled for submission within the next 12 months. "Assessment" indicates preliminary due diligence is ' +
      'underway. All status information is current as of the publication date of this manual and may change based on ' +
      'regulatory developments or strategic decisions by the Executive Committee.',
    { level: 'small' },
  );

  doc.heading('Stress Scenario Data', { level: 'h3' });

  doc.keepTogether(() => {
    doc.infoBox(
      'The scenarios below are based on the EBA 2025 stress test framework adapted to the specific ' +
        'risk profile of Acme Technologies. Results are reviewed by the Risk Committee quarterly.',
      {
        title: 'Note on stress testing methodology',
        bulletPoints: [
          'Baseline scenario: moderate economic growth with stable interest rates',
          'Adverse scenario: GDP contraction of 3.5% with 200bps rate increase',
          'Severely adverse: GDP contraction of 6.2% with market stress across asset classes',
        ],
      },
    );
  });

  doc.keepTogether(() => {
    doc.infoBox(
      'In accordance with DORA requirements, Acme Technologies has established the following ' +
        'maximum tolerable downtime thresholds for critical business services:',
      {
        title: 'Operational resilience targets',
        bulletPoints: [
          'Trading systems: 2 hours maximum (RTO), 15 minutes (RPO)',
          'Client reporting: 4 hours maximum (RTO), 1 hour (RPO)',
          'Regulatory reporting: 24 hours maximum (RTO), 4 hours (RPO)',
        ],
      },
    );
  });

  doc.bulletList([
    'Complete disaster recovery test executed bi-annually with documented results',
    'Tabletop exercises conducted quarterly involving all business-critical teams',
    {
      text: 'Third-party dependency mapping and risk assessment',
      subItems: [
        'Cloud service providers (AWS, Azure) — dual-region deployment with automated failover',
        'Market data vendors (Bloomberg, Refinitiv) — contractual SLA of 99.95% availability',
        'Payment processors — redundant routing through two independent clearing networks',
      ],
    },
    'Cyber resilience testing including red team exercises and social engineering assessments',
    'Physical security review of all office locations including access control and CCTV monitoring',
    {
      text: 'Communication plan for major incident scenarios',
      subItems: [
        'Internal communication cascade (< 15 minutes to all affected employees)',
        'Client notification procedures differentiated by incident severity',
        'Regulatory notification within prescribed timeframes (GDPR 72h, DORA as applicable)',
      ],
    },
    'Insurance coverage review — cyber liability, professional indemnity, directors & officers',
    'Annual review of business impact analysis for all critical business processes',
    'Vendor concentration risk monitoring with automatic alerting thresholds',
    'Cross-training program ensuring no single point of failure for key operational processes',
  ]);

  // ===================================================================
  // SECTION 13 — Final Signatures & Footer
  // ===================================================================

  doc.heading('Approval & Signatures', { level: 'h2' }).heading('Executive Approval', { level: 'h3' });

  doc.signatureZone([{ label: 'Chief Executive Officer' }, { label: 'Chief Financial Officer' }], {
    caption: 'Signed in London on 15 January 2026',
  });

  doc.heading('Board Endorsement', { level: 'h2' }).signatureZone([{ label: 'Chairperson of the Board' }], {
    caption: 'Endorsed at the Board meeting of 20 January 2026',
  });

  doc.addSpace(SPACING.large);

  doc.heading('Compliance Officer Certification', { level: 'h3' });

  doc.signatureZone([{ label: 'Chief Compliance Officer' }, { label: 'Data Protection Officer' }], {
    caption: 'Certified in London on 22 January 2026',
  });

  doc.keepTogether(() => {
    doc.closingNote(
      'Acme Technologies SA — Operations & Compliance Manual 2026 — Confidential — ' +
        'This document and its contents are the exclusive property of Acme Technologies SA.',
    );
  });

  return doc.finalize();
}
