import { describe, expect, it } from 'vitest';

import { PRESET_THEME_NAMES, presetTheme } from '../../src/theme';
import { contrastRatio } from '../../src/theme/colors';

describe('onPrimary on presets', () => {
  it('uses dark text on amber', () => {
    expect(presetTheme('amber').colors.onPrimary).toBe('#1E293B');
  });

  it('is white when it reaches 3:1, else the better of white and dark text, on every preset', () => {
    for (const name of PRESET_THEME_NAMES) {
      const { primary, onPrimary } = presetTheme(name).colors;
      const overWhite = contrastRatio(primary, '#FFFFFF');
      const overDark = contrastRatio(primary, '#1e293b');
      expect(onPrimary.toUpperCase() === '#FFFFFF', name).toBe(overWhite >= 3 || overWhite >= overDark);
    }
  });
});

describe('presetTheme', () => {
  it('is named after the preset and takes overrides over its primary', () => {
    expect(presetTheme('ocean').name).toBe('ocean');
    const custom = presetTheme('ocean', { name: 'brand', colors: { primary: '#AA0000' } });
    expect(custom.name).toBe('brand');
    expect(custom.colors.primary).toBe('#AA0000');
  });

  it('keeps the preset primary when overrides set other colors', () => {
    expect(presetTheme('ocean', { colors: { text: '#111111' } }).colors.primary).toBe('#3572B8');
  });
});
