'use client';
import { ThemeScope } from '@/shared/components/theme-scope';

/**
 * AuthLoadingScreen — shared full-screen loading state for auth-resolution surfaces.
 *
 * Renders the identical visible spinner used by `AuthGuard` while auth resolves or
 * during a brief redirect. Extracted so the root page (`/`), `/onboarding`,
 * `/company-setup`, and `AuthGuard` all render one consistent, accessible spinner
 * instead of a silent blank (`null`) screen.
 */
export function AuthLoadingScreen({ workspace = false }: { workspace?: boolean }) {
  return (
    <ThemeScope enabled={workspace} className="min-h-[var(--app-viewport-height)] bg-background flex items-center justify-center">
      <div
        className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin"
        aria-label="Loading"
        role="status"
      />
    </ThemeScope>
  );
}
