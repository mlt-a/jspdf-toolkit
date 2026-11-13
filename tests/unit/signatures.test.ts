import { describe, expect, it, vi } from 'vitest';

import { BOX, SIGNATURE } from '../../src/core/constants';
import { InvalidOptionError } from '../../src/core/errors';
import { computeSignatureZoneHeight, drawSignatureZone } from '../../src/drawing/signatures';
import { measureTextLevel } from '../../src/drawing/text';
import { PNG, TALL_PNG, WIDE_PNG, makeDoc, recordTexts } from './helpers';

describe('drawSignatureZone', () => {
  it('grows the box so the image area stays at least 14 mm', () => {
    const doc = makeDoc();
    const addImage = vi.spyOn(doc.doc, 'addImage');
    const startY = doc.getYPos();
    drawSignatureZone(
      doc,
      [{ label: 'Signer', sublabel: 'A very long signer name and function '.repeat(4), image: PNG }],
      {
        height: 20,
        spaceAfter: 0,
      },
    );
    expect(addImage).toHaveBeenCalled();
    // The spy takes the last overload, `(options)`: the call is read as the positional one the code makes.
    const args: unknown[] = addImage.mock.calls[0];
    const imageHeight = args[4] as number;
    expect(imageHeight).toBeGreaterThanOrEqual(14 - 1e-6);
    expect(doc.getYPos() - startY).toBeGreaterThan(20);
  });

  it('moves the image by a negative offset, left and up', () => {
    const doc = makeDoc();
    const addImage = vi.spyOn(doc.doc, 'addImage');
    const startY = doc.getYPos();
    drawSignatureZone(doc, [{ label: 'Signer', image: PNG, imageOffsetX: -2, imageOffsetY: -3 }], { spaceAfter: 0 });
    const args: unknown[] = addImage.mock.calls[0];
    expect(args[1] as number).toBeCloseTo(doc.margins.left - 2, 6);
    expect(args[2] as number).toBeCloseTo(startY - 3, 6);
  });

  it.each([
    ['as wide as the box, a wide image', WIDE_PNG, 'width'],
    ['as tall as its area, a tall image', TALL_PNG, 'height'],
  ])('keeps the ratio of the image, %s, on the left under the text', (_name, image, side) => {
    const doc = makeDoc();
    const addImage = vi.spyOn(doc.doc, 'addImage');
    const rect = vi.spyOn(doc.doc, 'rect');
    const startY = doc.getYPos();
    drawSignatureZone(doc, [{ label: 'Signer', image }], { height: 40, spaceAfter: 0 });
    const [boxX, boxY, boxWidth, boxHeight] = rect.mock.calls[0] as number[];
    const [, x, y, width, height] = addImage.mock.calls[0] as unknown as number[];
    const top = startY + BOX.padding + measureTextLevel(doc, 'italic').lineHeight + SIGNATURE.imageGap;
    const area = { width: boxWidth - 2 * BOX.padding, height: boxY + boxHeight - BOX.padding - top };
    expect(x).toBeCloseTo(boxX + BOX.padding, 6);
    expect(y).toBeCloseTo(top, 6);
    expect(width / height).toBeCloseTo(image === WIDE_PNG ? 4 : 0.5, 6);
    expect(width).toBeLessThanOrEqual(area.width + 1e-6);
    expect(height).toBeLessThanOrEqual(area.height + 1e-6);
    expect(side === 'width' ? width : height).toBeCloseTo(area[side as 'width' | 'height'], 6);
  });

  it('warns for a signature image that cannot be read, and draws the box', () => {
    const doc = makeDoc();
    drawSignatureZone(doc, [{ label: 'Signer', image: 'missing' }]);
    expect(doc.warnings).toEqual([
      'Failed to draw signature image: "missing" is neither a registered image name nor readable image data',
    ]);
  });

  it('draws no image when its offset leaves no room in the box', () => {
    const doc = makeDoc();
    const addImage = vi.spyOn(doc.doc, 'addImage');
    drawSignatureZone(doc, [{ label: 'Signer', image: PNG, imageOffsetY: 500 }], { spaceAfter: 0 });
    expect(addImage).not.toHaveBeenCalled();
    expect(doc.warnings).toEqual([]);
  });

  it.each([
    ['without a sublabel', { boxes: [{ label: 'Signer' }, { label: 'Witness' }] }],
    [
      'with a wrapping sublabel and a caption',
      {
        boxes: [{ label: 'Signer', sublabel: 'A very long signer name and function '.repeat(4) }],
        caption: 'Signed',
      },
    ],
    [
      'with a wrapping label',
      { boxes: [{ label: 'The legal representative of the supplier company '.repeat(3), sublabel: 'John Doe' }] },
    ],
  ])('computes the height it draws %s', (_name, { boxes, ...zone }) => {
    const doc = makeDoc();
    const options = { ...zone, spaceAfter: 0 };
    const height = computeSignatureZoneHeight(doc, boxes, options);
    const startY = doc.getYPos();
    drawSignatureZone(doc, boxes, options);
    expect(doc.getYPos() - startY).toBeCloseTo(height, 6);
  });
});

describe('a long label', () => {
  const LABEL = 'The legal representative of the supplier company, duly empowered to sign';

  it('wraps to the width of its box, under the box top, and pushes the sublabel down', () => {
    const doc = makeDoc();
    const drawn = recordTexts(doc);
    const rect = vi.spyOn(doc.doc, 'rect');
    drawSignatureZone(doc, [{ label: LABEL, sublabel: 'John Doe' }], { spaceAfter: 0 });

    const [boxX, boxY, boxWidth] = rect.mock.calls[0] as number[];
    const label = drawn.find((call) => call.lines.join(' ') === LABEL)!;
    expect(label.lines.length).toBeGreaterThan(1);
    expect(label.x).toBeCloseTo(boxX + BOX.padding, 6);
    for (const width of label.widths) expect(width).toBeLessThanOrEqual(boxWidth - 2 * BOX.padding + 1e-6);

    const { lineHeight, ascent } = measureTextLevel(doc, 'italic');
    expect(label.y).toBeCloseTo(boxY + BOX.padding + ascent, 6);
    const sublabel = drawn.find((call) => call.lines[0] === 'John Doe')!;
    expect(sublabel.y).toBeCloseTo(label.y + label.lines.length * lineHeight, 6);
  });

  it('grows the box by the lines it adds, and keeps the image under the text', () => {
    const short = makeDoc();
    const long = makeDoc();
    const addImage = vi.spyOn(long.doc, 'addImage');
    const options = { height: 10, spaceAfter: 0 };
    drawSignatureZone(short, [{ label: 'Signer', image: PNG }], options);
    drawSignatureZone(long, [{ label: LABEL, image: PNG }], options);
    expect(long.getYPos() - long.firstPageTop).toBeGreaterThan(short.getYPos() - short.firstPageTop);

    const [, , y] = addImage.mock.calls[0] as unknown as number[];
    const { lineHeight } = measureTextLevel(long, 'italic');
    expect(y).toBeGreaterThan(long.firstPageTop + BOX.padding + 2 * lineHeight);
  });
});

describe('signature anchors', () => {
  it('calls renderAnchor only on the boxes that declare an anchorKey, with that key', () => {
    const doc = makeDoc();
    const renderAnchor = vi.fn();
    drawSignatureZone(doc, [{ label: 'Signer', anchorKey: 'signer-1' }, { label: 'Witness' }], { renderAnchor });
    expect(renderAnchor).toHaveBeenCalledTimes(1);
    const [, box, key] = renderAnchor.mock.calls[0];
    expect(key).toBe('signer-1');
    expect(box.x).toBe(doc.margins.left);
  });

  it('does not call renderAnchor on a box that already carries an image', () => {
    const doc = makeDoc();
    const renderAnchor = vi.fn();
    drawSignatureZone(
      doc,
      [
        { label: 'Signed', anchorKey: 'signed', image: PNG },
        { label: 'To sign', anchorKey: 'to-sign' },
      ],
      { renderAnchor },
    );
    expect(renderAnchor).toHaveBeenCalledTimes(1);
    expect(renderAnchor.mock.calls[0][2]).toBe('to-sign');
  });
});

describe('signatureZone', () => {
  it('throws on more than two boxes', () => {
    const doc = makeDoc();
    const boxes = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];
    expect(() => doc.signatureZone(boxes)).toThrow(InvalidOptionError);
    expect(() => computeSignatureZoneHeight(doc, boxes)).toThrow(InvalidOptionError);
    expect(doc.getYPos()).toBe(doc.firstPageTop);
  });
});

// The options it refuses are in `option-validation.test.ts`.
describe('signature zone options', () => {
  it('names the text width a gap leaves the boxes without', () => {
    const doc = makeDoc();
    expect(() => doc.signatureZone([{ label: 'A' }, { label: 'B' }], { gap: doc.measure })).toThrow(/text width/);
  });

  it('accepts a zero gap and zero image offsets', () => {
    const doc = makeDoc();
    doc.registerImage('mark', PNG);
    expect(() =>
      doc.signatureZone([{ label: 'A', image: 'mark', imageOffsetX: 0, imageOffsetY: 0 }, { label: 'B' }], { gap: 0 }),
    ).not.toThrow();
  });
});
