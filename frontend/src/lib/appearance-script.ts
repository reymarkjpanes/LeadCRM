import { ACCENT_COLORS } from './accent-colors';
import { DENSITY_FONT_SIZE } from './appearance-config';
/** Runs before paint; only scoped workspace elements consume the resolved attribute. */
export const APPEARANCE_INIT_SCRIPT = `(() => { try {
  const root = document.documentElement;
  const mode = localStorage.getItem('app_theme');
  root.dataset.appTheme = mode === 'Classic' ? 'classic' : mode === 'Dark' || (mode === 'System' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  const sizes = ${JSON.stringify(DENSITY_FONT_SIZE)};
  root.style.fontSize = sizes[localStorage.getItem('app_font_size')] || sizes.Medium;
  const colors = ${JSON.stringify(ACCENT_COLORS)};
  const color = colors.find(value => value.id === localStorage.getItem('app_accent_color')) || colors[0];
  for (const [key, value] of Object.entries({
    '--app-primary': color.primary, '--app-primary-dark': color.primaryDark,
    '--app-primary-hover': color.primaryHover, '--app-primary-light': color.primaryLight,
    '--app-focus-ring': color.focusRing
  })) root.style.setProperty(key, value);
} catch {} })();`;
