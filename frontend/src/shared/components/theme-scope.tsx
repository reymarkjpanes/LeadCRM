'use client';
import React, { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { themeClassName } from '@/lib/appearance-config';
import { useTheme } from '@/shared/hooks/use-theme';
import { cn } from '@/lib/utils';

const WorkspaceThemeContext = createContext(false);
export const OverlayOwnerContext = createContext<string | undefined>(undefined);
const accentStyle = {
  '--primary': 'var(--app-primary, #2563EB)',
  '--primary-dark': 'var(--app-primary-dark, #1D4ED8)',
  '--primary-hover': 'var(--app-primary-hover, #1D4ED8)',
  '--ring': 'var(--app-primary, #2563EB)',
  '--focus-ring': 'var(--app-focus-ring, 0 0 0 3px rgb(37 99 235 / 0.2))',
  '--sidebar-active-text': 'var(--app-primary, #2563EB)',
  '--sidebar-active-bg': 'var(--app-primary-light, rgb(37 99 235 / 0.08))',
} as React.CSSProperties;
export function useWorkspaceTheme() { return useContext(WorkspaceThemeContext); }

export const ThemeScope = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { enabled?: boolean }>(
  ({ enabled = true, className, style, ...props }, ref) => {
    const { resolved } = useTheme();
    return <WorkspaceThemeContext.Provider value={enabled}>
      <div ref={ref} {...props} data-theme-container={enabled ? '' : undefined}
        className={cn(themeClassName(enabled ? resolved : 'light'), 'text-foreground', className)}
        style={{ ...accentStyle, ...style }} />
    </WorkspaceThemeContext.Provider>;
  },
);
ThemeScope.displayName = 'ThemeScope';

/** React context follows a portal; CSS inheritance needs an explicit DOM theme scope too. */
export function ThemedPortal({ children }: { children: React.ReactNode }) {
  const enabled = useWorkspaceTheme();
  const owner = useContext(OverlayOwnerContext);
  if (typeof document === 'undefined') return null;
  return createPortal(<ThemeScope enabled={enabled} className="contents" data-theme-portal="" data-overlay-owner={owner}>{children}</ThemeScope>, document.body);
}
