'use client';
import { useTheme } from '@/shared/hooks/use-theme';
/** Initializes shared device preferences; CSS appearance is applied only by ThemeScope. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useTheme();
  return <>{children}</>;
}
