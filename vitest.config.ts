import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Runnable demos, checked by the layout and text baselines rather than by unit tests.
        'src/examples/**',
        // Base64 modules written by `pnpm fonts:generate`.
        'src/fonts/inter/generated/**',
      ],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      // The level reached: a line, a branch or a function no test reaches fails `pnpm test:coverage`. Code no test
      // can reach is dead code to delete, or a case the types should rule out. Checked on one Node version (CI, 24).
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
