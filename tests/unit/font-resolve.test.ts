import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';

import { resolveFace } from '../../src/fonts/resolve';

const resolve = (doc: jsPDF, family: string, style: Parameters<typeof resolveFace>[2]) => {
  const warnings: string[] = [];
  return { face: resolveFace(doc, family, style, (message) => warnings.push(message)), warnings };
};

describe('resolveFace', () => {
  it('keeps the normal face and a face the family has, silently', () => {
    const doc = new jsPDF();
    expect(resolve(doc, 'whatever', 'normal')).toEqual({ face: 'normal', warnings: [] });
    expect(resolve(doc, 'helvetica', 'bolditalic')).toEqual({ face: 'bolditalic', warnings: [] });
  });

  it('finds a family under its lowercase name', () => {
    const doc = new jsPDF();
    doc.addFont('plain-bold.ttf', 'plain', 'bold');
    expect(resolve(doc, 'Plain', 'bold')).toEqual({ face: 'bold', warnings: [] });
  });

  it('draws italic upright for a family without an italic face, with a warning', () => {
    const doc = new jsPDF();
    doc.addFont('x.ttf', 'Plain', 'normal');
    expect(resolve(doc, 'Plain', 'italic')).toEqual({
      face: 'normal',
      warnings: ['Font family "Plain" has no italic face: italic text is drawn upright'],
    });
  });

  it('falls back from bold italic to bold, then to normal, one warning per step', () => {
    const doc = new jsPDF();
    doc.addFont('x.ttf', 'Plain', 'normal');
    doc.addFont('xb.ttf', 'Plain', 'bold');
    expect(resolve(doc, 'Plain', 'bolditalic')).toEqual({
      face: 'bold',
      warnings: ['Font family "Plain" has no bolditalic face: drawn as bold'],
    });
    expect(resolve(doc, 'Absent', 'bold')).toEqual({
      face: 'normal',
      warnings: ['Font family "Absent" has no bold face: drawn as normal'],
    });
    expect(resolve(doc, 'Absent', 'bolditalic').warnings).toEqual([
      'Font family "Absent" has no bold face: drawn as normal',
      'Font family "Absent" has no bolditalic face: drawn as normal',
    ]);
  });

  it('sees a face added after the first lookup', () => {
    const doc = new jsPDF();
    expect(resolve(doc, 'Late', 'bold').warnings).toHaveLength(1);
    doc.addFont('late.ttf', 'Late', 'bold');
    expect(resolve(doc, 'Late', 'bold')).toEqual({ face: 'bold', warnings: [] });
  });
});
