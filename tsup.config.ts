import { defineConfig } from 'tsup';

// One config object: separate configs with `clean` would wipe each other's output.
export default defineConfig({
  entry: { index: 'src/index.ts', node: 'src/node/index.ts', 'fonts/inter': 'src/fonts/inter/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  // Shims would inject `url` helpers into the browser-safe core.
  shims: false,
  external: ['jspdf'],
});
