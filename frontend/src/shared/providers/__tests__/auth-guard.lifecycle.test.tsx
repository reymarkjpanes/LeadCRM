import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { User } from '@/store/types';
const replace = vi.fn();
let pathname = '/dashboard';
let auth: any;
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }), usePathname: () => pathname }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => auth }));
import { AuthGuard } from '../auth-guard';
import { getAccountDestination } from '@/shared/auth/auth-routing';
const user = { id: 'u', role: 'Client Admin', email: 'employee@camxian.com', status: 'ACTIVE', mustChangePassword: false, onboardingStep: 0, onboardingCompletedAt: null } as User;
beforeEach(() => { cleanup(); vi.clearAllMocks(); pathname = '/dashboard'; auth = { user: { ...user }, isLoading: false }; });
it.each(['/dashboard', '/settings', '/crm/leads', '/inbox'])('blocks manual navigation to %s before password change', path => {
  pathname = path; auth.user.mustChangePassword = true;
  render(<AuthGuard>Protected content</AuthGuard>);
  expect(replace).toHaveBeenCalledWith('/change-password');
  expect(screen.queryByText('Protected content')).toBeNull();
});
it('uses persisted onboarding despite a localStorage completion flag', () => {
  localStorage.setItem('leadcrm_onboarding_complete', 'true');
  render(<AuthGuard>Protected content</AuthGuard>);
  expect(replace).toHaveBeenCalledWith('/onboarding');
});
it('sends returning admins to the dashboard', () => {
  expect(getAccountDestination({ ...user, onboardingStep: 3, onboardingCompletedAt: '2026-01-01' })).toBe('/dashboard');
});
it('preserves normal and custom role access without Client Admin onboarding', () => {
  expect(getAccountDestination({ ...user, role: 'Sales' })).toBe('/dashboard');
});
it('requires authentication', () => {
  auth.user = null; render(<AuthGuard>Protected content</AuthGuard>);
  expect(replace).toHaveBeenCalledWith('/login');
  expect(screen.queryByText('Protected content')).toBeNull();
});
