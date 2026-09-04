'use client';

import { uuid } from '@/lib/utils';
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from 'next-auth/react';
import { User, Tenant } from './types';
import type { ResolvedPermissions, PermissionAction } from './types/roles.types';
import { MOCK_USERS, MOCK_TENANTS } from './mockData';
import { authApi } from '@/shared/services/auth.api';
import { rolesApi } from '@/shared/services/roles.api';

// When true, auth calls hit the mock localStorage data instead of the backend.
// Set NEXT_PUBLIC_USE_MOCK_AUTH=false in .env.local to use the real API.
const USE_MOCK_AUTH = process.env.NEXT_PUBLIC_USE_MOCK_AUTH !== 'false';

/**
 * Distinguishes a genuine "no session" (unauthenticated / 401) response from a
 * real transport failure (network down, 5xx). The API client throws a plain
 * Error whose message is derived from the backend AppError text, so we match on
 * the known 401 messages emitted by the auth middleware. Anything else — a
 * `TypeError: Failed to fetch`, a timeout, or a 5xx status — is treated as a
 * transport failure that should surface an auth-init error state.
 */
function isNoSessionError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return (
    message.includes('authentication required') ||
    message.includes('invalid or expired token') ||
    message.includes('unauthorized') ||
    message.includes('401')
  );
}

interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  isLoading: boolean;
  /**
   * Set when auth initialization (`/auth/me` during session restore) fails due
   * to a genuine transport error (network/5xx) rather than a missing session.
   * A 401 / "no session" clears this and leaves `user === null`. The UI reads
   * this to render an explicit recovery state instead of a silent blank screen.
   */
  authError: string | null;
  /** Re-runs auth initialization (`/auth/me`) after a transport failure. */
  retryAuthInit: () => Promise<void>;
  /**
   * Re-hydrates the cached user/tenant from the canonical `/auth/me` payload
   * without toggling the full-screen loading state. Call after a server-side
   * change to gate-relevant fields (e.g. completing onboarding, verifying
   * email) so downstream guards see the fresh `emailVerified` /
   * `onboardingCompletedAt` instead of a stale cached value.
   */
  refreshUser: () => Promise<void>;
  login: (email: string, password?: string) => Promise<boolean>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  registerTenant: (tenantData: any, adminData: any) => Promise<boolean>;
  registerGuestAccount: (guestData: any) => Promise<boolean>;
  requestPasswordReset: (email: string) => Promise<boolean>;
  confirmPasswordReset: (token: string, password: string) => Promise<boolean>;
  switchRole: (role: string) => void;
  updateProfile: (profileData: Partial<User>) => void;
  /**
   * Switch to a demo/seeded account by email.
   * - Mock mode: direct login — no password or OTP needed.
   * - Real API mode: calls login directly with credentials.
   * Returns true on success, false on failure.
   */
  switchDemoAccount: (email: string, password: string) => Promise<boolean>;
  /**
   * Resolved effective permissions for the current user.
   * Map of module key → { canView, canCreate, canEdit, canDelete }.
   * Empty object when permissions haven't loaded yet or in mock mode.
   */
  permissions: ResolvedPermissions;
  /** True once permissions have been fetched from the API (or skipped in mock mode). */
  isPermissionsLoaded: boolean;
  /**
   * Check whether the current user can perform `action` on `module`.
   * Super roles (Client Admin / Admin) always return true.
   * Falls back gracefully to false when permissions haven't loaded yet.
   */
  userCan: (module: string, action: PermissionAction) => boolean;
  /** Re-fetches the current user's permissions from the API. */
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [tenant, setTenant]   = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [permissions, setPermissions]           = useState<ResolvedPermissions>({});
  const [isPermissionsLoaded, setIsPermissionsLoaded] = useState(false);

  // ── Restore session ───────────────────────────────────────────────
  const restoreSession = async (): Promise<void> => {
    if (USE_MOCK_AUTH) {
      // Mock: restore from localStorage
      try {
        const storedUser   = localStorage.getItem('leadcrm_user');
        const storedTenant = localStorage.getItem('leadcrm_tenant');
        if (storedUser)   setUser(JSON.parse(storedUser));
        if (storedTenant) setTenant(JSON.parse(storedTenant));
      } catch {
        // Corrupted storage — clear it
        localStorage.removeItem('leadcrm_user');
        localStorage.removeItem('leadcrm_tenant');
      }
      setAuthError(null);
      setIsPermissionsLoaded(true);
      setIsLoading(false);
    } else {
      // Real API — verify the HttpOnly cookie by calling /auth/me
      try {
        const res = await authApi.me();
        if (res?.data?.user) {
          const apiUser = res.data.user as unknown as User;
          setUser(apiUser);
          if (apiUser.tenantId && apiUser.tenantId !== 'system') {
            setTenant({ id: apiUser.tenantId, name: '', status: 'active', environment: 'production' } as any);
          }
          // Fetch effective permissions non-blocking — failure doesn't break auth
          if (apiUser.id) {
            rolesApi.getUserPermissions(apiUser.id)
              .then((r) => {
                setPermissions(r?.data ?? {});
                setIsPermissionsLoaded(true);
              })
              .catch(() => {
                // Permissions unavailable — degrade gracefully
                setIsPermissionsLoaded(true);
              });
          }
        } else {
          setUser(null);
          setTenant(null);
          setPermissions({});
          setIsPermissionsLoaded(true);
        }
        setAuthError(null);
      } catch (err: unknown) {
        // Distinguish "no session" (401 → logged out, not an error) from a
        // genuine transport failure (network/5xx). A missing session clears
        // state silently; a transport failure surfaces a recovery state so the
        // user never lands on a silent blank screen.
        setUser(null);
        setTenant(null);
        setPermissions({});
        setIsPermissionsLoaded(true);
        if (isNoSessionError(err)) {
          setAuthError(null);
        } else {
          // RC-08/09 fix: distinguish network/CORS failures (TypeError: Failed to fetch)
          // from generic auth errors so users see a connectivity-specific message.
          const authErrMsg = err instanceof Error ? err.message : 'Unknown error';
          const isCorsOrNetwork = err instanceof TypeError || authErrMsg.toLowerCase().includes('fetch') || authErrMsg.toLowerCase().includes('network');
          setAuthError(
            isCorsOrNetwork
              ? 'Unable to connect to the server. Check your network connection or contact support.'
              : authErrMsg || 'Unable to verify your session',
          );
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.error('[AuthContext] auth init failed:', err instanceof Error ? err.message : err);
          }
        }
      }
      setIsLoading(false);
    }
  };

  // ── Restore session on mount ──────────────────────────────────────
  useEffect(() => {
    restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only — session restore is not NextAuth-dependent

  // ── Periodic permission refresh (every 5 minutes) ─────────────────
  // Propagates role/permission changes made by admins without requiring
  // the affected user to log out and back in.
  // Uses a ref for the user ID to avoid re-creating the interval on every
  // render — Context arrays in useEffect deps cause infinite loops.
  const userIdRef = React.useRef<string | undefined>(undefined);
  userIdRef.current = user?.id;

  useEffect(() => {
    if (USE_MOCK_AUTH) return;

    const PERMISSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    const intervalId = setInterval(async () => {
      const uid = userIdRef.current;
      if (!uid) return; // Not logged in — skip
      try {
        const r = await rolesApi.getUserPermissions(uid);
        if (r?.data) {
          setPermissions(r.data);
        }
      } catch {
        // Non-critical — keep cached permissions until next tick
      }
    }, PERMISSION_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []); // Deliberately empty — interval is stable, userIdRef.current is read live

  // ── Refresh permissions ───────────────────────────────────────────
  const refreshPermissions = useCallback(async (): Promise<void> => {
    if (USE_MOCK_AUTH || !user?.id) return;
    try {
      const r = await rolesApi.getUserPermissions(user.id);
      setPermissions(r?.data ?? {});
    } catch {
      // Non-critical — keep existing permissions
    }
  }, [user?.id]);

  // ── userCan — permission guard helper ─────────────────────────────
  // Super roles always return true. Falls back to false when not loaded.
  const SUPER_ROLE_NAMES = ['Admin', 'Super User', 'Client Admin', 'System Admin'];
  const userCan = useCallback((module: string, action: PermissionAction): boolean => {
    if (!user) return false;
    const norm = user.role?.toLowerCase().trim() ?? '';
    if (SUPER_ROLE_NAMES.some(r => r.toLowerCase() === norm)) return true;
    return permissions[module]?.[action] === true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, permissions]);

  // ── Retry auth initialization after a transport failure ───────────
  const retryAuthInit = async (): Promise<void> => {
    setIsLoading(true);
    setAuthError(null);
    await restoreSession();
  };

  // ── Refresh cached user/tenant without toggling loading ───────────
  // Re-hydrates from the canonical /auth/me payload after a server-side
  // change to gate-relevant fields (onboarding, email verification) so
  // downstream guards see fresh values instead of a stale cached user.
  const refreshUser = async (): Promise<void> => {
    if (USE_MOCK_AUTH) return;
    try {
      const res = await authApi.me();
      if (res?.data?.user) {
        const apiUser = res.data.user as unknown as User;
        setUser(apiUser);
        if (apiUser.tenantId && apiUser.tenantId !== 'system') {
          setTenant({ id: apiUser.tenantId, name: '', status: 'active', environment: 'production' } as any);
        }
        setAuthError(null);
      }
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] refreshUser failed:', err instanceof Error ? err.message : err);
      }
    }
  };

  // ── Login ─────────────────────────────────────────────────────────
  const login = async (email: string, password?: string): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      return mockLogin(email);
    }

    try {
      const res = await authApi.login({ email, password: password ?? '' });
      if (res?.data?.user) {
        // Defense-in-depth: re-hydrate from the canonical /auth/me payload so
        // the stored user always carries the gate fields (emailVerified,
        // onboardingCompletedAt, etc.) regardless of the login response shape.
        // Fall back to the (now-aligned) login payload if the me call fails.
        let apiUser = res.data.user as unknown as User;
        try {
          const meRes = await authApi.me();
          if (meRes?.data?.user) {
            apiUser = meRes.data.user as unknown as User;
          }
        } catch (meErr: unknown) {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.error('[AuthContext] post-login re-hydrate failed, using login payload:', meErr instanceof Error ? meErr.message : meErr);
          }
        }
        setUser(apiUser);
        if (apiUser.tenantId && apiUser.tenantId !== 'system') {
          setTenant({ id: apiUser.tenantId, name: '', status: 'active', environment: 'production' } as any);
        }
        setAuthError(null);
        return true;
      }
      return false;
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] login failed:', err instanceof Error ? err.message : err);
      }
      return false;
    }
  };

  // ── Mock login (localStorage, demo phase) ─────────────────────────
  const mockLogin = (email: string): boolean => {
    let allUsers   = JSON.parse(localStorage.getItem('leadcrm_users')   || JSON.stringify(MOCK_USERS));
    let allTenants = JSON.parse(localStorage.getItem('leadcrm_tenants') || JSON.stringify(MOCK_TENANTS));

    let foundUser = allUsers.find((u: User) => u.email === email);

    // Fallback: reset to mock data if demo account not found
    const DEMO_EMAILS = [
      'admin@gmail.com',
      'super@leadcrm.com',
      'admin@democorp.com',
      'bob@democorp.com',
      'guest@democorp.com',
    ];
    if (!foundUser && DEMO_EMAILS.includes(email)) {
      allUsers   = MOCK_USERS;
      allTenants = MOCK_TENANTS;
      localStorage.setItem('leadcrm_users',   JSON.stringify(MOCK_USERS));
      localStorage.setItem('leadcrm_tenants', JSON.stringify(MOCK_TENANTS));
      foundUser = allUsers.find((u: User) => u.email === email);
    }

    if (!foundUser) return false;

    setUser(foundUser);
    localStorage.setItem('leadcrm_user', JSON.stringify(foundUser));

    if (foundUser.tenantId !== 'system') {
      const foundTenant = allTenants.find((t: Tenant) => t.id === foundUser.tenantId);
      if (foundTenant) {
        setTenant(foundTenant);
        localStorage.setItem('leadcrm_tenant', JSON.stringify(foundTenant));
      }
    } else {
      setTenant(null);
      localStorage.removeItem('leadcrm_tenant');
    }
    return true;
  };

  // ── Login with Google (NextAuth OAuth flow) ──────────────────────
  /**
   * Triggers the NextAuth Google OAuth redirect flow.
   * NextAuth will:
   *   1. Redirect to Google consent screen
   *   2. On success, call our signIn callback which posts to /auth/oauth/google
   *   3. The backend sets the LeadCRM HttpOnly JWT cookie
   *   4. NextAuth redirects to callbackUrl
   *
   * After the redirect completes, the page re-mounts and restoreSession()
   * re-hydrates AuthContext from the new cookie via /auth/me.
   *
   * In mock mode, Google sign-in is not available.
   */
  const loginWithGoogle = async (): Promise<void> => {
    if (USE_MOCK_AUTH) return;
    // callbackUrl must be '/' so AuthGuard applies role-based routing
    // after the OAuth session is established.
    await nextAuthSignIn('google', { callbackUrl: '/' });
  };

  // ── Logout ────────────────────────────────────────────────────────
  const logout = async (): Promise<void> => {
    if (!USE_MOCK_AUTH) {
      // Revoke the LeadCRM backend session + clear HttpOnly JWT cookie
      try { await authApi.logout(); } catch { /* ignore — clear local state regardless */ }
      // Also clear the NextAuth JWT cookie (used by Google OAuth flow)
      try { await nextAuthSignOut({ redirect: false }); } catch { /* non-critical */ }
    }
    setUser(null);
    setTenant(null);
    setAuthError(null);
    localStorage.removeItem('leadcrm_user');
    localStorage.removeItem('leadcrm_tenant');
    // Clear onboarding flags so the next user on this browser sees the
    // full onboarding flow (keys must not leak across accounts).
    localStorage.removeItem('leadcrm_onboarding_complete');
    localStorage.removeItem('leadcrm_needs_company_setup');
    // Clear any saved post-login redirect so a new user doesn't inherit the
    // previous session's destination (e.g. System Admin → /admin/dashboard).
    sessionStorage.removeItem('leadcrm_redirect_after_login');
  };

  // ── Register tenant ────────────────────────────────────────────────
  const registerTenant = async (tenantData: any, adminData: any): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      const allTenants = JSON.parse(localStorage.getItem('leadcrm_tenants') || JSON.stringify(MOCK_TENANTS));
      const allUsers   = JSON.parse(localStorage.getItem('leadcrm_users')   || JSON.stringify(MOCK_USERS));

      const newTenantId = uuid();
      const newTenant: Tenant = {
        id:               newTenantId,
        name:             tenantData.companyName,
        industry:         tenantData.industry,
        size:             tenantData.size,
        email:            tenantData.businessEmail,
        phone:            tenantData.phone,
        address:          tenantData.address,
        status:           'pending',
        approvalStep:     'basic',
        environment:      'none',
        createdAt:        new Date().toISOString(),
        businessReqs:     tenantData.businessReqs,
        verificationDocs: tenantData.verificationDocs,
      };

      const newUser: User = {
        id:        uuid(),
        tenantId:  newTenantId,
        firstName: adminData.firstName,
        lastName:  adminData.lastName,
        email:     adminData.email,
        role:      'Admin',
        status:    'active',
      };

      localStorage.setItem('leadcrm_tenants', JSON.stringify([...allTenants, newTenant]));
      localStorage.setItem('leadcrm_users',   JSON.stringify([...allUsers, newUser]));
      return true;
    } else {
      try {
        await authApi.registerClientAdmin({
          companyName: tenantData.companyName,
          industry: tenantData.industry,
          companySize: tenantData.size,
          country: 'US', // default or from form
          firstName: adminData.firstName,
          lastName: adminData.lastName,
          email: adminData.email,
          password: adminData.password,
          acceptTerms: true,
        });
        return true;
      } catch (err: unknown) {
        // Log safely — never expose stack traces or secrets
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.error('[AuthContext] registerTenant failed:', err instanceof Error ? err.message : err);
        }
        return false;
      }
    }
  };

  const registerGuestAccount = async (guestData: any): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      return true; // Simplified mock
    } else {
      try {
        // Register the guest account
        await authApi.registerGuest({
          firstName: guestData.firstName,
          lastName: guestData.lastName,
          email: guestData.email,
          password: guestData.password,
          companyName: guestData.companyName,
          industry: guestData.industry,
          companySize: guestData.companySize,
          businessWebsite: guestData.businessWebsite,
        });

        // Send email verification OTP
        await authApi.sendRegistrationOtp(guestData.email);

        return true;
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] registerGuestAccount failed:', err instanceof Error ? err.message : err);
        // Re-throw the error so the UI can display it
        throw err;
      }
    }
  };

  // ── Password reset ─────────────────────────────────────────────────
  const requestPasswordReset = async (email: string): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      // Mock: always succeed silently
      return true;
    }
    try {
      await authApi.forgotPassword(email);
      return true;
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] requestPasswordReset failed:', err instanceof Error ? err.message : err);
      }
      return false;
    }
  };

  const confirmPasswordReset = async (token: string, password: string): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      return true;
    }
    try {
      await authApi.resetPassword(token, password);
      return true;
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] confirmPasswordReset failed:', err instanceof Error ? err.message : err);
      }
      return false;
    }
  };

  // ── Switch role (demo / development helper) ───────────────────────
  const switchRole = (role: string): void => {
    if (!user) return;
    const updated = { ...user, role };
    setUser(updated);
    localStorage.setItem('leadcrm_user', JSON.stringify(updated));
  };

  // ── Switch demo account (works both mock + real API) ───────────────
  // Mock mode  → direct mockLogin (no password needed, instant switch).
  // Real API   → calls login() directly with credentials.
  const switchDemoAccount = async (email: string, password: string): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      return mockLogin(email);
    }
    try {
      const ok = await login(email, password);
      return ok;
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] switchDemoAccount failed:', err instanceof Error ? err.message : err);
      }
      return false;
    }
  };

  // ── Update profile ────────────────────────────────────────────────
  const updateProfile = (profileData: Partial<User>): void => {
    if (!user) return;
    const updated = { ...user, ...profileData };
    setUser(updated);
    localStorage.setItem('leadcrm_user', JSON.stringify(updated));

    const allUsers = JSON.parse(localStorage.getItem('leadcrm_users') || JSON.stringify(MOCK_USERS));
    const idx = allUsers.findIndex((u: any) => u.id === user.id);
    if (idx !== -1) {
      allUsers[idx] = { ...allUsers[idx], ...profileData };
      localStorage.setItem('leadcrm_users', JSON.stringify(allUsers));
    }
  };

  return (
    <AuthContext.Provider value={{ user, tenant, isLoading, authError, retryAuthInit, refreshUser, login, loginWithGoogle, logout, registerTenant, registerGuestAccount, requestPasswordReset, confirmPasswordReset, switchRole, updateProfile, switchDemoAccount, permissions, isPermissionsLoaded, userCan, refreshPermissions }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};