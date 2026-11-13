// Examples render in Inter so the pdftotext baselines stay stable across the Helvetica default.
import { INTER_FAMILY } from '../fonts/inter';
import type { ThemeOverrides } from '../theme';

export { interFonts as exampleFonts } from '../fonts/inter';

export function withInter(overrides: ThemeOverrides = {}): ThemeOverrides {
  const typography = { ...overrides.typography, fontFamily: INTER_FAMILY };
  if (typography.titleFontFamily !== undefined) {
    typography.titleFontFamily = INTER_FAMILY;
  }
  if (typography.labelFontFamily !== undefined) {
    typography.labelFontFamily = INTER_FAMILY;
  }
  return { ...overrides, typography };
}
