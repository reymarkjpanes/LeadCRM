import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: feedback }));
import { INSTALL_DISMISSAL_KEY, INSTALLED_APP_KEY, PwaInstallProvider, type InstallPromptEvent } from '@/shared/providers/pwa-install-provider';
import { updateAppearance } from '@/lib/appearance';
import { type ThemeMode } from '@/lib/appearance-config';

let systemDark = false;
let systemListeners: Set<() => void>;

function installEvent(choice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> = Promise.resolve({ outcome: 'accepted', platform: 'web' })) {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn().mockResolvedValue(undefined), userChoice: choice }) as InstallPromptEvent;
}
function app() { return render(<PwaInstallProvider><main>Workspace</main></PwaInstallProvider>); }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  systemDark = false; systemListeners = new Set();
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(query => ({
    media: query,
    get matches() { return query === '(prefers-color-scheme: dark)' && systemDark; },
    addEventListener: (_: string, listener: () => void) => { if (query === '(prefers-color-scheme: dark)') systemListeners.add(listener); },
    removeEventListener: (_: string, listener: () => void) => systemListeners.delete(listener),
  })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('stays hidden until a real prompt object is available, then invokes it once', async () => {
  app();
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  act(() => window.dispatchEvent(new Event('beforeinstallprompt')));
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  const event = installEvent();
  act(() => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(screen.getByText('Get the LeadCRM app!')).toBeTruthy();
  await act(async () => { const button = screen.getByRole('button', { name: 'Install LeadCRM app' }); fireEvent.click(button); fireEvent.click(button); });
  expect(event.prompt).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  expect(localStorage.getItem(INSTALLED_APP_KEY)).toBeNull();
});

it('keeps X dismissal through navigation but resets it on a new page load', () => {
  const first = app();
  act(() => window.dispatchEvent(installEvent()));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss install banner' }));
  first.rerender(<PwaInstallProvider><main>Another page</main></PwaInstallProvider>);
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  expect(localStorage.getItem(INSTALL_DISMISSAL_KEY)).toBeNull();
  first.unmount();
  app();
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.getByRole('region', { name: 'Install LeadCRM' })).toBeTruthy();
});

it('retires an existing permanent dismissal without suppressing installation', () => {
  localStorage.setItem(INSTALL_DISMISSAL_KEY, 'true');
  app();
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.getByRole('region', { name: 'Install LeadCRM' })).toBeTruthy();
  expect(localStorage.getItem(INSTALL_DISMISSAL_KEY)).toBeNull();
});

it('hides and reports installation through browser UI, without duplicate notifications', () => {
  app();
  act(() => window.dispatchEvent(installEvent()));
  act(() => window.dispatchEvent(new Event('appinstalled')));
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  act(() => window.dispatchEvent(new Event('appinstalled')));
  expect(feedback.success).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  expect(localStorage.getItem(INSTALLED_APP_KEY)).toBe('true');
});

it('remembers installation on a new page load without repeating the success toast', () => {
  const first = app();
  act(() => window.dispatchEvent(new Event('appinstalled')));
  first.unmount();
  app();
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  expect(feedback.success).toHaveBeenCalledTimes(1);
});

it('hides an open promotion when another tab records installation', () => {
  app();
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.getByRole('region', { name: 'Install LeadCRM' })).toBeTruthy();
  act(() => {
    localStorage.setItem(INSTALLED_APP_KEY, 'true');
    window.dispatchEvent(new StorageEvent('storage', { key: INSTALLED_APP_KEY, newValue: 'true', storageArea: localStorage }));
  });
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  expect(feedback.success).not.toHaveBeenCalled();
});

it('does not promote installation when launched as an installed app', () => {
  vi.mocked(window.matchMedia).mockImplementation(query => ({ media: query, matches: query.includes('standalone'), addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);
  app();
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  expect(localStorage.getItem(INSTALLED_APP_KEY)).toBe('true');
});

it('suppresses repeated promotion after a native cancellation', async () => {
  app();
  act(() => window.dispatchEvent(installEvent(Promise.resolve({ outcome: 'dismissed', platform: 'web' }))));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Install LeadCRM app' })));
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
  expect(feedback.error).not.toHaveBeenCalled();
});

it('reports a failed native prompt and clears its single-use event', async () => {
  app();
  const event = installEvent();
  vi.mocked(event.prompt).mockRejectedValue(new Error('Browser refused'));
  act(() => window.dispatchEvent(event));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Install LeadCRM app' })));
  expect(feedback.error).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
});

it('still dismisses safely when local storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
  app();
  act(() => window.dispatchEvent(installEvent()));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss install banner' }));
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.queryByRole('region', { name: 'Install LeadCRM' })).toBeNull();
});

it.each<[ThemeMode, boolean, string]>([
  ['Classic', false, 'theme-classic'], ['Light', false, 'theme-light'],
  ['Dark', false, 'theme-dark'], ['System', false, 'theme-light'], ['System', true, 'theme-dark'],
])('uses the %s theme with system dark=%s without theming its public page', (mode, dark, className) => {
  systemDark = dark;
  localStorage.setItem('app_theme', mode);
  app();
  act(() => window.dispatchEvent(installEvent()));
  const banner = screen.getByRole('region', { name: 'Install LeadCRM' });
  expect(banner.closest('[data-theme-container]')?.classList.contains(className)).toBe(true);
  expect(screen.getByRole('main').closest('[data-theme-container]')).toBeNull();
});

it('keeps a captured prompt usable through theme, accent, density and live OS changes', async () => {
  app();
  const event = installEvent();
  act(() => window.dispatchEvent(event));
  for (const mode of ['Classic', 'Light', 'Dark', 'System'] as const) {
    act(() => updateAppearance({ mode, accent: 'purple', density: 'Large' }));
    expect(screen.getByRole('button', { name: 'Install LeadCRM app' })).toBeTruthy();
  }
  act(() => { systemDark = true; systemListeners.forEach(listener => listener()); });
  expect(screen.getByRole('region').closest('[data-theme-container]')?.classList.contains('dark')).toBe(true);
  act(() => { systemDark = false; systemListeners.forEach(listener => listener()); });
  expect(screen.getByRole('region').closest('[data-theme-container]')?.classList.contains('theme-light')).toBe(true);
  expect(localStorage.getItem('app_theme')).toBe('System');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Install LeadCRM app' })));
  expect(event.prompt).toHaveBeenCalledTimes(1);
});

it('keeps remembered dismissal when appearance changes', () => {
  app();
  act(() => window.dispatchEvent(installEvent()));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss install banner' }));
  act(() => updateAppearance({ mode: 'Dark' }));
  act(() => window.dispatchEvent(installEvent()));
  expect(screen.queryByRole('region')).toBeNull();
  expect(localStorage.getItem(INSTALL_DISMISSAL_KEY)).toBeNull();
});
