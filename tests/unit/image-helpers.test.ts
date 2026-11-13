import { describe, expect, it, vi } from 'vitest';

import { InvalidOptionError } from '../../src/core/errors';
import { drawBackgroundImage, drawImage, scaledSize } from '../../src/drawing/image-helpers';
import { PNG, makeDoc } from './helpers';

describe('drawImage', () => {
  it('draws at x and y and returns the Y under the image', () => {
    const doc = makeDoc();
    const addImage = vi.spyOn(doc.doc, 'addImage');
    expect(drawImage(doc, PNG, { x: 15, y: 30, width: 20, height: 8 })).toBe(38);
    expect(addImage.mock.calls[0].slice(1, 5)).toEqual([15, 30, 20, 8]);
  });

  it('derives a missing side from the image ratio', () => {
    const doc = makeDoc();
    const addImage = vi.spyOn(doc.doc, 'addImage');
    // The image is square.
    expect(drawImage(doc, PNG, { x: 15, y: 30, height: 12 })).toBe(42);
    expect(addImage.mock.calls[0].slice(3, 5)).toEqual([12, 12]);
  });

  it('records a warning for an unreadable image and draws nothing', () => {
    const doc = makeDoc();
    const addImage = vi.spyOn(doc.doc, 'addImage');
    expect(drawImage(doc, 'missing', { x: 15, y: 30, width: 10, height: 5 })).toBe(35);
    expect(addImage).not.toHaveBeenCalled();
    expect(doc.warnings.some((warning) => warning.startsWith('Failed to draw image: '))).toBe(true);
  });
});

describe('scaledSize', () => {
  const image = { alias: 'a', data: new Uint8Array(), width: 200, height: 100 };

  it('follows the ratio from a width or from a height', () => {
    expect(scaledSize(image, { width: 50 })).toEqual({ width: 50, height: 25 });
    expect(scaledSize(image, { height: 50 })).toEqual({ width: 100, height: 50 });
  });

  it('keeps both sides when both are given', () => {
    expect(scaledSize(image, { width: 50, height: 50 })).toEqual({ width: 50, height: 50 });
  });

  it('throws when it has neither side', () => {
    expect(() => scaledSize(image, {})).toThrow(InvalidOptionError);
    expect(() => scaledSize(image, {})).toThrow('An image size needs a width or a height');
  });
});

describe('drawBackgroundImage', () => {
  it('draws the image across the page, on its bottom edge, and returns it', () => {
    const doc = makeDoc();
    const addImage = vi.spyOn(doc.doc, 'addImage');
    const embedded = drawBackgroundImage(doc, PNG);
    expect(embedded).toMatchObject({ width: 1, height: 1 });
    const [, x, y, width, height] = addImage.mock.calls[0] as unknown as number[];
    expect([x, width]).toEqual([0, doc.pageWidth]);
    expect(y + height).toBeCloseTo(doc.pageHeight, 6);
    expect(drawBackgroundImage(doc, embedded!)).toBe(embedded);
    expect(doc.warnings).toEqual([]);
  });

  it('warns and returns nothing for an image that cannot be drawn', () => {
    const doc = makeDoc();
    const addImage = vi.spyOn(doc.doc, 'addImage');
    expect(drawBackgroundImage(doc, 'missing')).toBeUndefined();
    expect(addImage).not.toHaveBeenCalled();
    expect(doc.warnings).toEqual([
      'Failed to draw background image: "missing" is neither a registered image name nor readable image data',
    ]);
  });

  it('does not keep an unreadable image for the pages to come', () => {
    const doc = makeDoc();
    doc.background('missing', { allPages: true });
    const addImage = vi.spyOn(doc.doc, 'addImage');
    doc.addPage();
    expect(addImage).not.toHaveBeenCalled();
    expect(doc.warnings).toHaveLength(1);
  });
});
