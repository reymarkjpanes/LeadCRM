export interface AccentColorConfig {
  id: string;
  name: string;
  primary: string;
  primaryDark: string;
  primaryHover: string;
  primaryLight: string;
  primaryBorder: string;
  focusRing: string;
  previewClass: string;
}

export const ACCENT_COLORS: AccentColorConfig[] = [
  {
    id: 'blue',
    name: 'Blue',
    primary: '#2563EB',
    primaryDark: '#1D4ED8',
    primaryHover: '#1D4ED8',
    primaryLight: 'rgba(37, 99, 235, 0.08)',
    primaryBorder: 'rgba(37, 99, 235, 0.25)',
    focusRing: '0 0 0 3px rgba(37, 99, 235, 0.2)',
    previewClass: 'bg-[#2563EB]',
  },
  {
    id: 'teal',
    name: 'Teal',
    primary: '#0D9488',
    primaryDark: '#0F766E',
    primaryHover: '#0F766E',
    primaryLight: 'rgba(13, 148, 136, 0.08)',
    primaryBorder: 'rgba(13, 148, 136, 0.25)',
    focusRing: '0 0 0 3px rgba(13, 148, 136, 0.2)',
    previewClass: 'bg-[#0D9488]',
  },
  {
    id: 'green',
    name: 'Green',
    primary: '#16A34A',
    primaryDark: '#15803D',
    primaryHover: '#15803D',
    primaryLight: 'rgba(22, 163, 74, 0.08)',
    primaryBorder: 'rgba(22, 163, 74, 0.25)',
    focusRing: '0 0 0 3px rgba(22, 163, 74, 0.2)',
    previewClass: 'bg-[#16A34A]',
  },
  {
    id: 'orange',
    name: 'Orange',
    primary: '#EA580C',
    primaryDark: '#C2410C',
    primaryHover: '#C2410C',
    primaryLight: 'rgba(234, 88, 12, 0.08)',
    primaryBorder: 'rgba(234, 88, 12, 0.25)',
    focusRing: '0 0 0 3px rgba(234, 88, 12, 0.2)',
    previewClass: 'bg-[#EA580C]',
  },
  {
    id: 'red',
    name: 'Red',
    primary: '#DC2626',
    primaryDark: '#B91C1C',
    primaryHover: '#B91C1C',
    primaryLight: 'rgba(220, 38, 38, 0.08)',
    primaryBorder: 'rgba(220, 38, 38, 0.25)',
    focusRing: '0 0 0 3px rgba(220, 38, 38, 0.2)',
    previewClass: 'bg-[#DC2626]',
  },
  {
    id: 'purple',
    name: 'Purple',
    primary: '#9333EA',
    primaryDark: '#7E22CE',
    primaryHover: '#7E22CE',
    primaryLight: 'rgba(147, 51, 234, 0.08)',
    primaryBorder: 'rgba(147, 51, 234, 0.25)',
    focusRing: '0 0 0 3px rgba(147, 51, 234, 0.2)',
    previewClass: 'bg-[#9333EA]',
  },
  {
    id: 'indigo',
    name: 'Indigo',
    primary: '#4F46E5',
    primaryDark: '#4338CA',
    primaryHover: '#4338CA',
    primaryLight: 'rgba(79, 70, 229, 0.08)',
    primaryBorder: 'rgba(79, 70, 229, 0.25)',
    focusRing: '0 0 0 3px rgba(79, 70, 229, 0.2)',
    previewClass: 'bg-[#4F46E5]',
  },
];

export const ACCENT_KEY = 'app_accent_color';

/**
 * Updates root and container CSS variables dynamically for instant whole-app accent styling
 */
export function applyAccentTokens(accentId: string): void {
  const config = ACCENT_COLORS.find((c) => c.id === accentId) || ACCENT_COLORS[0];
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const targets = [root];

  targets.forEach((el) => {
    el.style.setProperty('--app-primary', config.primary);
    el.style.setProperty('--app-primary-dark', config.primaryDark);
    el.style.setProperty('--app-primary-hover', config.primaryHover);
    el.style.setProperty('--app-primary-light', config.primaryLight);
    el.style.setProperty('--app-focus-ring', config.focusRing);
    el.style.setProperty('--ring', config.primary);
    el.style.setProperty('--color-primary', config.primary);
    el.style.setProperty('--color-brand', config.primary);
    el.style.setProperty('--primary', config.primary);
    el.style.setProperty('--primary-dark', config.primaryDark);
    el.style.setProperty('--primary-hover', config.primaryHover);
    el.style.setProperty('--color-brand-hover', config.primaryHover);
    el.style.setProperty('--color-brand-light', config.primaryLight);
    el.style.setProperty('--color-brand-border', config.primaryBorder);
    el.style.setProperty('--sidebar-active-text', config.primary);
    el.style.setProperty('--sidebar-active-bg', config.primaryLight);
    el.style.setProperty('--focus-ring', config.focusRing);
  });

}

/** Compatibility entry point for existing accent selectors. */
export function applyAccentColor(accentId: string): void {
  if (typeof document === 'undefined') return;
  const config = ACCENT_COLORS.find(color => color.id === accentId) || ACCENT_COLORS[0];
  applyAccentTokens(config.id);
  try {
    localStorage.setItem(ACCENT_KEY, config.id);
  } catch {
    // noop
  }

  window.dispatchEvent(
    new CustomEvent('accentcolorchange', { detail: { accent: config } }),
  );
}
