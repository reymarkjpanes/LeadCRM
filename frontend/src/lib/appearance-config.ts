export const THEME_MODES = ['Classic', 'Light', 'Dark', 'System'] as const;
export type ThemeMode = typeof THEME_MODES[number];
export type ResolvedTheme = 'classic' | 'light' | 'dark';
export const DENSITIES = ['Small', 'Medium', 'Large'] as const;
export type AppearanceDensity = typeof DENSITIES[number];
export const DENSITY_FONT_SIZE = { Small: '14px', Medium: '16px', Large: '18px' } as const;
export const THEME_KEY = 'app_theme';
export const DENSITY_KEY = 'app_font_size';
export const THEME_PALETTES = {
  classic: { bg: '#F8FAFC', sidebar: '#08090B', card: '#FFFFFF' },
  light: { bg: '#F5F6F7', sidebar: '#FFFFFF', card: '#FFFFFF' },
  dark: { bg: '#0D0E11', sidebar: '#08090B', card: '#16191E' },
} as const;
export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  return mode === 'Classic' ? 'classic' : mode === 'Dark' || (mode === 'System' && systemDark) ? 'dark' : 'light';
}
export function themeClassName(theme: ResolvedTheme): string {
  return theme === 'dark' ? 'dark theme-dark' : `theme-${theme}`;
}
/** Public routes keep their own appearance even when the saved workspace mode is dark. */
export function usesWorkspaceAppearance(path: string, authenticated = false): boolean {
  return /^\/(dashboard|reporting|crm|settings|administration|operations|automation|marketing|campaigns|inbox|notifications|card-showcase)(\/|$)/.test(path)
    || (authenticated && /^\/help(\/|$)/.test(path));
}
