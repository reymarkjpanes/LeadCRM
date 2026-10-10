import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppearanceSettings } from '../appearance-settings';
import { AppearancePreferences } from '../appearance-preferences';
import { ThemeScope, ThemedPortal } from '../theme-scope';
import { useTheme } from '@/shared/hooks/use-theme';
import { updateAppearance } from '@/lib/appearance';
import { APPEARANCE_INIT_SCRIPT } from '@/lib/appearance-script';
import { ACCENT_COLORS } from '@/lib/accent-colors';
import { usesWorkspaceAppearance } from '@/lib/appearance-config';

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
let dark = false;
let mediaListeners: Set<() => void>;
beforeEach(() => {
  cleanup(); localStorage.clear(); dark = false; mediaListeners = new Set();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: dark,
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Probe({ name }: { name: string }) {
  const value = useTheme();
  return <output aria-label={name}>{`${value.mode}:${value.resolved}:${value.accent}:${value.density}`}</output>;
}
it('synchronizes both Appearance entry points, body portals, accent and density without losing preferences', () => {
  const view = render(<ThemeScope><AppearanceSettings /><AppearanceSettings /><AppearancePreferences /><Probe name="resolved" />
    <ThemedPortal><button>Portal action</button></ThemedPortal></ThemeScope>);
  fireEvent.click(screen.getAllByLabelText('Select Dark theme')[0]);
  expect(screen.getAllByLabelText('Select Dark theme').every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true);
  expect(screen.getByRole('button', { name: /^Dark$/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Portal action').closest('[data-theme-container]')?.classList.contains('dark')).toBe(true);
  fireEvent.click(screen.getAllByLabelText('Select Purple accent color')[1]);
  fireEvent.click(screen.getAllByText('Large', { selector: 'button' })[0]);
  expect(screen.getByLabelText('resolved').textContent).toBe('Dark:dark:purple:Large');
  expect(document.documentElement.style.getPropertyValue('--app-primary')).toBe(ACCENT_COLORS.find(color => color.id === 'purple')?.primary);
  expect(document.documentElement.style.fontSize).toBe('18px');
  view.unmount();
  render(<Probe name="reloaded" />);
  expect(screen.getByLabelText('reloaded').textContent).toBe('Dark:dark:purple:Large');
});
it('updates all mounted subscribers on OS changes while keeping System saved', () => {
  localStorage.setItem('app_theme', 'System');
  render(<><Probe name="one" /><Probe name="two" /></>);
  expect(screen.getByLabelText('one').textContent).toContain('System:light');
  act(() => { dark = true; mediaListeners.forEach(listener => listener()); });
  for (const name of ['one', 'two']) expect(screen.getByLabelText(name).textContent).toContain('System:dark');
  expect(localStorage.getItem('app_theme')).toBe('System');
  act(() => updateAppearance({ mode: 'Classic' }));
  act(() => { dark = false; mediaListeners.forEach(listener => listener()); });
  expect(screen.getByLabelText('one').textContent).toContain('Classic:classic');
});
it('handles cross-tab changes and old detail-less theme events through the same saved snapshot', () => {
  render(<Probe name="resolved" />);
  act(() => { localStorage.setItem('app_theme', 'Dark'); window.dispatchEvent(new StorageEvent('storage', { key: 'app_theme', storageArea: localStorage })); });
  expect(screen.getByLabelText('resolved').textContent).toContain('Dark:dark');
  act(() => window.dispatchEvent(new Event('themechange')));
  expect(screen.getByLabelText('resolved').textContent).toContain('Dark:dark');
  act(() => { localStorage.setItem('app_theme', 'invalid'); localStorage.setItem('app_accent_color', 'invalid'); window.dispatchEvent(new StorageEvent('storage', { key: null })); });
  expect(screen.getByLabelText('resolved').textContent).toContain('Light:light:blue');
});
it('isolates public scopes and their portals from the dark workspace', () => {
  localStorage.setItem('app_theme', 'Dark');
  render(<ThemeScope><ThemeScope enabled={false} data-testid="public"><ThemedPortal><button>Public action</button></ThemedPortal></ThemeScope></ThemeScope>);
  expect(screen.getByTestId('public').classList.contains('dark')).toBe(false);
  const portal = screen.getByText('Public action').closest('[data-theme-portal]');
  expect(portal?.classList.contains('dark')).toBe(false);
  expect(portal?.hasAttribute('data-theme-container')).toBe(false);
  expect(usesWorkspaceAppearance('/login')).toBe(false);
  expect(usesWorkspaceAppearance('/help')).toBe(false);
  expect(usesWorkspaceAppearance('/help', true)).toBe(true);
});
it.each(['Classic', 'Light', 'Dark', 'System'])('initializes %s before paint without adding a global dark class', mode => {
  dark = true; localStorage.setItem('app_theme', mode); localStorage.setItem('app_font_size', 'Small');
  new Function(APPEARANCE_INIT_SCRIPT)();
  expect(document.documentElement.dataset.appTheme).toBe(mode === 'Classic' ? 'classic' : mode === 'Light' ? 'light' : 'dark');
  expect(document.documentElement.style.fontSize).toBe('14px');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});
