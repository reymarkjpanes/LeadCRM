'use client';

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOverlayState } from '@/shared/lib/overlay-state';
import { ThemeScope } from '@/shared/components/theme-scope';

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string };
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<InstallChoice>;
}
export const INSTALL_DISMISSAL_KEY = 'leadcrm:pwa-install-dismissed:v1';
export const INSTALLED_APP_KEY = 'leadcrm:pwa-installed:v1';
type InstallStatus = 'unknown' | 'available' | 'prompting' | 'accepted' | 'installed';
type InstallContext = { status: InstallStatus; dismissed: boolean; install: () => Promise<void>; restorePromotion: () => void };
const PwaContext = createContext<InstallContext | null>(null);

export function usePwaInstall() {
  const value = useContext(PwaContext);
  if (!value) throw new Error('usePwaInstall requires PwaInstallProvider');
  return value;
}

export function PwaInstallProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<InstallStatus>('unknown');
  const [dismissed, setDismissed] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const deferred = useRef<InstallPromptEvent | null>(null);
  const pending = useRef(false);
  const installed = useRef(false);
  const mounted = useRef(false);
  const bannerRef = useRef<HTMLElement>(null);
  const { active: overlayActive } = useOverlayState();
  const visible = status === 'available' && !dismissed && !cancelled;

  useEffect(() => {
    mounted.current = true;
    // Dismissal now lasts only for this page load; retire the old persistent flag.
    try { localStorage.removeItem(INSTALL_DISMISSAL_KEY); } catch { /* Storage is optional. */ }
    const markInstalled = () => {
      installed.current = true;
      deferred.current = null;
      setStatus('installed');
      try { localStorage.setItem(INSTALLED_APP_KEY, 'true'); } catch { /* Memory fallback. */ }
    };
    try {
      if (localStorage.getItem(INSTALLED_APP_KEY) === 'true') markInstalled();
    } catch { /* Memory fallback. */ }
    const standalone = window.matchMedia('(display-mode: standalone)');
    const minimal = window.matchMedia('(display-mode: minimal-ui)');
    const controls = window.matchMedia('(display-mode: window-controls-overlay)');
    const launchedAsApp = () => standalone.matches || minimal.matches || controls.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const updateDisplayMode = () => {
      if (launchedAsApp()) markInstalled();
    };
    updateDisplayMode();
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      if (installed.current || launchedAsApp()) return;
      const prompt = event as InstallPromptEvent;
      if (typeof prompt.prompt !== 'function' || !prompt.userChoice) return;
      deferred.current = prompt;
      if (!pending.current) setStatus('available');
    };
    const onInstalled = () => {
      const alreadyInstalled = installed.current;
      markInstalled();
      if (!alreadyInstalled) toast.success('LeadCRM installed. Open it from your device’s app launcher.', { id: 'leadcrm-installed' });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== INSTALLED_APP_KEY || event.newValue !== 'true') return;
      try { if (event.storageArea !== localStorage) return; } catch { /* Memory fallback. */ return; }
      installed.current = true;
      deferred.current = null;
      setStatus('installed');
    };
    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('storage', onStorage);
    const modes = [standalone, minimal, controls];
    modes.forEach(mode => mode.addEventListener?.('change', updateDisplayMode));
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('storage', onStorage);
      modes.forEach(mode => mode.removeEventListener?.('change', updateDisplayMode));
    };
  }, []);

  useLayoutEffect(() => {
    const banner = bannerRef.current;
    const updateHeight = () => document.documentElement.style.setProperty('--pwa-banner-height', `${banner?.getBoundingClientRect().height ?? 0}px`);
    updateHeight();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight);
    if (banner) observer?.observe(banner);
    window.addEventListener('resize', updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateHeight);
      document.documentElement.style.setProperty('--pwa-banner-height', '0px');
    };
  }, [visible]);

  const install = useCallback(async () => {
    const prompt = deferred.current;
    if (!prompt || pending.current || installed.current) return;
    pending.current = true;
    deferred.current = null;
    setStatus('prompting');
    try {
      // Call synchronously from the user's click; a browser-issued event is single-use.
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (!mounted.current || installed.current) return;
      if (choice.outcome === 'accepted') setStatus('accepted');
      else { setCancelled(true); setStatus(deferred.current ? 'available' : 'unknown'); }
    } catch {
      if (mounted.current && !installed.current) {
        setStatus('unknown');
        toast.error('Could not open installation. Try the Install app option in your browser menu.');
      }
    } finally { pending.current = false; }
  }, []);

  const dismiss = () => {
    setDismissed(true);
  };
  const restorePromotion = () => {
    setDismissed(false);
    setCancelled(false);
  };

  return <PwaContext.Provider value={{ status, dismissed, install, restorePromotion }}>
    {visible && <ThemeScope className="contents">
      <section ref={bannerRef} data-pwa-banner role="region" aria-label="Install LeadCRM" inert={overlayActive}
        className="pwa-install-banner">
      <div className="pwa-install-banner__content">
        <p className="pwa-install-banner__message">Get the LeadCRM app!</p>
        <div className="pwa-install-banner__actions">
          <button type="button" aria-label="Install LeadCRM app" onClick={() => void install()}
            className="pwa-install-banner__install">
            <Download size={14} aria-hidden="true" />Install
          </button>
          <button type="button" aria-label="Dismiss install banner" onClick={dismiss}
            className="pwa-install-banner__dismiss">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      </section>
    </ThemeScope>}
    {children}
  </PwaContext.Provider>;
}
