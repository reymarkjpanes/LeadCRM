import { isOnboardingComplete } from '@leadcrm/shared';
import type { User } from '@/store/types';
const ENTRY_ROUTES = ['/', '/login'];
const SETUP_ROUTES = ['/change-password', '/onboarding', '/company-setup', '/verify-email', '/email-verification'];
export function getAccountDestination(user: User | null): string {
  if (!user) return '/login';
  if (user.mustChangePassword) return '/change-password';
  if (!isOnboardingComplete(user)) return '/onboarding';
  return '/dashboard';
}
export function resolveAuthRoute(user: User | null, pathname: string): string | null {
  if (!user) return pathname === '/login' ? null : '/login';
  const destination = getAccountDestination(user);
  if (ENTRY_ROUTES.includes(pathname) || SETUP_ROUTES.includes(pathname)) {
    return pathname === destination ? null : destination;
  }
  if (destination !== '/dashboard') return destination;
  return null;
}
export function getPostLoginDestination(user: User, _saved: string | null): string {
  return getAccountDestination(user);
}
export function getSetupIssue(_user: User): string | null { return null; }
