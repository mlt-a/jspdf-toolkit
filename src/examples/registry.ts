import type { PDFDocument } from '../index';
import { buildCertificate } from './certificate';
import { buildContract } from './contract';
import { buildInvoice } from './invoice';
import { buildLetter } from './letter';
import { buildRegistrationForm } from './registration-form';
import { buildReport } from './report';
import { buildShowcase } from './showcase';
import { buildStressTest } from './stress-test';

/**
 * Every example by name: the runner writes `output/<name>.pdf` from it and the layout test reads the same documents.
 * Each `build` returns its document finalized.
 */
export const EXAMPLES = {
  invoice: { label: 'Invoice', build: buildInvoice },
  report: { label: 'Report', build: buildReport },
  showcase: { label: 'Showcase', build: buildShowcase },
  'stress-test': { label: 'Stress Test', build: buildStressTest },
  'registration-form': { label: 'Registration Form', build: buildRegistrationForm },
  contract: { label: 'Contract', build: buildContract },
  letter: { label: 'Letter', build: buildLetter },
  certificate: { label: 'Certificate', build: buildCertificate },
} satisfies Record<string, { label: string; build: () => PDFDocument }>;
