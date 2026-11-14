import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';

import { expectedFaces, hasFace, resolveFace } from '../../src/fonts/resolve';

const resolve = (
  doc: jsPDF,
  family: string,
  style: Parameters<typeof resolveFace>[2],
  fallbacks?: Parameters<typeof expectedFaces>[0],
) => {
  const warnings: string[] = [];
  const face = resolveFace(doc, family, style, (message) => warnings.push(message), expectedFaces(fallbacks));
  return { face, warnings };
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

describe('hasFace', () => {
  it('tells a registered or built-in face from a missing one, without a warning', () => {
    const doc = new jsPDF();
    doc.addFont('x.ttf', 'Plain', 'normal');
    doc.addFont('l.ttf', 'lower', 'normal');
    expect(hasFace(doc, 'Plain', 'normal')).toBe(true);
    expect(hasFace(doc, 'Lower', 'normal')).toBe(true);
    expect(hasFace(doc, 'Plain', 'italic')).toBe(false);
    expect(hasFace(doc, 'Absent', 'normal')).toBe(false);
    expect(hasFace(doc, 'helvetica', 'bolditalic')).toBe(true);
  });
});

const plain = (): jsPDF => {
  const doc = new jsPDF();
  doc.addFont('x.ttf', 'Plain', 'normal');
  doc.addFont('xb.ttf', 'Plain', 'bold');
  return doc;
};

describe('resolveFace with declared fallbacks', () => {
  it('takes the same face in silence for a declared one', () => {
    expect(resolve(plain(), 'Plain', 'italic', { Plain: ['italic'] })).toEqual({ face: 'normal', warnings: [] });
    expect(resolve(plain(), 'Plain', 'bolditalic', { Plain: ['bolditalic'] })).toEqual({ face: 'bold', warnings: [] });
  });

  it('lets italic cover bold italic, and nothing else', () => {
    expect(resolve(plain(), 'Plain', 'bolditalic', { Plain: ['italic'] })).toEqual({ face: 'bold', warnings: [] });
    expect(resolve(plain(), 'Plain', 'italic', { Plain: ['bolditalic'] }).warnings).toHaveLength(1);
    expect(resolve(plain(), 'Plain', 'bolditalic', { Plain: ['bold'] }).warnings).toHaveLength(1);
  });

  it('judges each step of a chain on its own face', () => {
    const doc = new jsPDF();
    doc.addFont('x.ttf', 'Plain', 'normal');
    expect(resolve(doc, 'Plain', 'bolditalic', { Plain: ['bold', 'bolditalic'] })).toEqual({
      face: 'normal',
      warnings: [],
    });
    expect(resolve(doc, 'Plain', 'bolditalic', { Plain: ['italic'] })).toEqual({
      face: 'normal',
      warnings: ['Font family "Plain" has no bold face: drawn as normal'],
    });
  });

  it('keeps the warning for a family or a face not declared, and finds a family by any case', () => {
    expect(resolve(plain(), 'Plain', 'italic', { Other: ['italic'] }).warnings).toHaveLength(1);
    expect(resolve(plain(), 'Absent', 'bold', { Absent: ['italic'] }).warnings).toHaveLength(1);
    expect(resolve(plain(), 'Plain', 'italic', { PLAIN: ['italic'] }).warnings).toEqual([]);
  });

  it('merges a family declared under two spellings', () => {
    expect(resolve(plain(), 'Plain', 'italic', { Plain: ['bold'], plain: ['italic'] }).warnings).toEqual([]);
  });
});
