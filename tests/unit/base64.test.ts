import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from '../../src/utils/base64';

function bytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
}

describe('bytesToBase64', () => {
  // Padding cases (0-4 and 255/256) plus the 0x8000 chunk boundaries.
  it.each([0, 1, 2, 3, 4, 255, 256, 0x8000 - 1, 0x8000, 0x8000 + 1, 3 * 0x8000 + 7])(
    'matches Buffer for %i bytes',
    (length) => {
      const data = bytes(length);
      expect(bytesToBase64(data)).toBe(Buffer.from(data).toString('base64'));
    },
  );
});
