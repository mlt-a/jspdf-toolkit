import { describe, expect, it } from 'vitest';

import { decodeImageData } from '../../src/utils/image-data';

const BYTES = [65, 66, 67, 68];
const BASE64 = 'QUJDRA==';

describe('decodeImageData', () => {
  it.each([
    ['raw base64', BASE64],
    ['a data URL', `data:image/png;base64,${BASE64}`],
    ['a data URL with a parameter', `data:image/svg+xml;charset=utf-8;base64,${BASE64}`],
  ])('decodes %s', (_name, image) => {
    expect([...decodeImageData(image)!]).toEqual(BYTES);
  });

  it.each([
    ['an icon name', 'arrow-right'],
    ['a path', '/images/logo.png'],
    ['an empty string', ''],
    ['an empty data URL', 'data:image/png;base64,'],
  ])('gives nothing for %s, which jsPDF would read as a path', (_name, image) => {
    expect(decodeImageData(image)).toBeUndefined();
  });
});
