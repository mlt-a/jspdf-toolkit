import { describe, expect, it } from 'vitest';

import { EXAMPLES } from '../../src/examples/registry';
import { describeLayout } from './layout';

// The text baseline (`pnpm check:pdf`) reads what the PDFs say; this one reads where and how: the position, size
// and color of every string, the box and color of every shape, the clips, images and links (see `describeLayout`).
// A diff is one line per element. `pnpm check:pdf:update` rewrites it.
describe.each(Object.entries(EXAMPLES))('layout of the %s example', (name, { build }) => {
  it('matches its baseline', async () => {
    await expect(describeLayout(build())).toMatchFileSnapshot(`../baselines/${name}.layout.txt`);
  });
});
