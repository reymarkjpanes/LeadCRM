'use client';

import { normalizeMockUser } from './auth-state';
import type { AuthUser } from '@leadcrm/shared';
import React, {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, ReactNode,
} from 'react';
import { User, Tenant } from './types';
import { hasModulePermission, isApplicablePermission } from '@leadcrm/shared';
import type { ResolvedPermissions, PermissionAction } from './types/roles.types';
import { MOCK_USERS, MOCK_TENANTS } from './mockData';
import { authApi } from '@/shared/services/auth.api';
import { rolesApi } from '@/shared/services/roles.api';
import { clearPageCache }         from '@/shared/cache/page-cache';

// When true, auth calls hit the mock localStorage data instead of the backend.
// Set NEXT_PUBLIC_USE_MOCK_AUTH=false in .env.local to use the real API.
const USE_MOCK_AUTH = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_USE_MOCK_AUTH === 'true';

// ─── Super-role names ─────────────────────────────────────────────────────────
// Module-level constant — never recreated per render.
// These roles bypass RolePermission evaluation in userCan().
const SUPER_ROLE_NAMES = ['Client Admin'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Prefer the API status; retain message matching for older clients and mock errors. */
export function isNoSessionError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status === 401;
  }
  let message = '';
  try {
    message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  } catch {
    // Pathological objects whose toString/toPrimitive throws — not a session error
    return false;
  }
  return (
    message.includes('authentication required') ||
    message.includes('invalid or expired token') ||
    message.includes('unauthorized') ||
    message.includes('401')
  );
}

/**
 * Builds the Tenant object from a flattened /auth/me API response.
 *
 * Centralises the three duplicated setTenant({ ... }) call sites that
 * previously differed only in whether they were spread across multiple lines.
 * Single source of truth → zero drift between restoreSession / refreshUser / login.
 *
 * Note: tenantId and system-tenant check must be validated by the caller
 * before invoking this function.
 */
export function buildTenantFromApiUser(apiUser: Record<string, unknown>): Tenant {
  const tenantStatus = (apiUser.tenantStatus as string | null) ?? null;
  // The /auth/me response carries only the fields needed for gate checks and
  // UI display — not the full Tenant record. Required Tenant fields that aren't
  // present in the auth response default to empty strings to satisfy the type.
  return {
    id:                 apiUser.tenantId as string,
    name:               (apiUser.tenantName as string | null) ?? '',
    industry:           (apiUser.industry as string | null) ?? '',
    size:               '',
    email:              '',
    phone:              '',
    address:            '',
    status:             (tenantStatus?.toLowerCase() ?? 'active') as Tenant['status'],
    createdAt:          '',
    currency:           (apiUser.currency as string | null) ?? null,
  } as unknown as Tenant;
}

// ─── Context interface ────────────────────────────────────────────────────────

interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  isLoading: boolean;
  /** Transport failure during session restore — not a missing session. */
  authError: string | null;
  retryAuthInit: () => Promise<void>;
  refreshUser: () => Promise<void>;
  applyOrganizationSettings: (settings: import('@leadcrm/shared').OrganizationSettings) => void;
  applyAuthUser: (user: AuthUser, expectedUserId?: string) => void;
  login: (email: string, password?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<boolean>;
  confirmPasswordReset: (token: string, password: string) => Promise<boolean>;
  switchRole: (role: string) => void;
  updateProfile: (profileData: import('@leadcrm/shared').UpdateSelfProfile) => Promise<void>;
  switchDemoAccount: (email: string, password: string) => Promise<boolean>;
  permissions: ResolvedPermissions;
  isPermissionsLoaded: boolean;
  userCan: (module: string, action: PermissionAction) => boolean;
  refreshPermissions: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [tenant, setTenant]   = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [permissions, setPermissions]           = useState<ResolvedPermissions>({});
  const [isPermissionsLoaded, setIsPermissionsLoaded] = useState(false);

  const requestGeneration = useRef(0);
  const permissionGeneration = useRef(0);
  const activeUserId = useRef<string | null>(null);
  activeUserId.current = user?.id ?? null;

  const applyOrganizationSettings = useCallback((settings: import('@leadcrm/shared').OrganizationSettings) => {
    setTenant(current => current?.id === settings.id ? {
      ...current, name: settings.name, industry: settings.industry ?? '', email: settings.email ?? '',
      phone: settings.phone ?? '', domain: settings.domain ?? '', address: settings.address ?? '',
    } : current);
    setUser(current => current?.tenantId === settings.id ? { ...current, tenantName: settings.name, industry: settings.industry } : current);
  }, []);

  const applyAuthUser = useCallback((apiUser: AuthUser, expectedUserId?: string) => {
    if (expectedUserId && activeUserId.current !== expectedUserId) return;
    requestGeneration.current += 1;
    activeUserId.current = apiUser.id;
    setUser({
      ...apiUser,
      status: apiUser.status as User['status'],
      phone: apiUser.phone ?? undefined,
      jobTitle: apiUser.jobTitle ?? undefined,
      department: apiUser.department ?? undefined,
      avatarUrl: apiUser.avatarUrl ?? undefined,
    });
    setTenant(buildTenantFromApiUser({ ...apiUser }));
    setAuthError(null);
    setIsLoading(false);
  }, []);

  const restoreSession = async (): Promise<void> => {
    const generation = ++requestGeneration.current;
    if (USE_MOCK_AUTH) {
      try {
        const storedUser = localStorage.getItem('leadcrm_user');
        const storedTenant = localStorage.getItem('leadcrm_tenant');
        if (storedUser) setUser(normalizeMockUser(JSON.parse(storedUser)));
        if (storedTenant) setTenant(JSON.parse(storedTenant));
      } catch {
        localStorage.removeItem('leadcrm_user');
        localStorage.removeItem('leadcrm_tenant');
      }
      setAuthError(null);
      setIsPermissionsLoaded(true);
      setIsLoading(false);
      return;
    }
    try {
      const response = await authApi.me();
      if (generation !== requestGeneration.current) return;
      applyAuthUser(response.data.user);
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setUser(null);
      setTenant(null);
      setPermissions({});
      setIsPermissionsLoaded(true);
      setAuthError(isNoSessionError(error) ? null
        : error instanceof TypeError ? 'Unable to connect to the server. Check your network connection.'
        : error instanceof Error ? error.message : 'Unable to load your session');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void restoreSession();
    return () => { requestGeneration.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshPermissions = useCallback(async (): Promise<void> => {
    if (USE_MOCK_AUTH || isLoading || authError || !user?.id) return;
    const id = user.id;
    const generation = ++permissionGeneration.current;
    try {
      const response = await rolesApi.getUserPermissions(id);
      if (activeUserId.current === id && permissionGeneration.current === generation) {
        setPermissions(response.data ?? {});
        setIsPermissionsLoaded(true);
      }
    } catch {
      if (activeUserId.current === id && permissionGeneration.current === generation) {
        setPermissions({});
        setIsPermissionsLoaded(true);
      }
    }
  }, [user?.id, isLoading, authError]);

  useEffect(() => {
    setPermissions({});
    setIsPermissionsLoaded(USE_MOCK_AUTH || !user);
    void refreshPermissions();
    const interval = setInterval(() => { void refreshPermissions(); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.id, user?.role, refreshPermissions]);

  // ── userCan — permission guard helper ─────────────────────────────
  // Super roles bypass RolePermission evaluation.
  const userCan = useCallback((module: string, action: PermissionAction): boolean => {
    if (!user) return false;
    const norm = user.role?.toLowerCase().trim() ?? '';
    if (!isApplicablePermission(module, action)) return false;
    if (user.role === 'Client Admin') return true;
    return hasModulePermission(permissions, module, action);
  }, [user, permissions]);

  // ── Retry auth initialization after a transport failure ───────────
  const retryAuthInit = async (): Promise<void> => {
    setIsLoading(true);
    setAuthError(null);
    await restoreSession();
  };

  const refreshUser = async (): Promise<void> => {
    if (USE_MOCK_AUTH) return;
    const generation = ++requestGeneration.current;
    try {
      const response = await authApi.me();
      if (generation === requestGeneration.current) applyAuthUser(response.data.user);
    } catch (error) {
      if (generation === requestGeneration.current) {
        if (isNoSessionError(error)) {
          setUser(null);
          setTenant(null);
          setPermissions({});
        } else {
          setAuthError(error instanceof Error ? error.message : 'Unable to refresh your session');
        }
      }
      throw error;
    }
  };

  const login = async (email: string, password?: string): Promise<boolean> => {
    if (USE_MOCK_AUTH) return mockLogin(email);
    const generation = ++requestGeneration.current;
    const response = await authApi.login({ email, password: password ?? '' });
    if (generation !== requestGeneration.current) return false;
    applyAuthUser(response.data.user);
    return true;
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
      'admin@camxian.com',
      'bob@camxian.com',
    ];
    if (!foundUser && DEMO_EMAILS.includes(email)) {
      allUsers   = MOCK_USERS;
      allTenants = MOCK_TENANTS;
      localStorage.setItem('leadcrm_users',   JSON.stringify(MOCK_USERS));
      localStorage.setItem('leadcrm_tenants', JSON.stringify(MOCK_TENANTS));
      foundUser = allUsers.find((u: User) => u.email === email);
    }

    if (!foundUser || foundUser.role.trim().toLowerCase() === 'guest') return false;

    foundUser = normalizeMockUser(foundUser);
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


  // ── Logout ────────────────────────────────────────────────────────
  const logout = async (): Promise<void> => {
    requestGeneration.current += 1;
    if (!USE_MOCK_AUTH) {
      // Revoke the LeadCRM backend session + clear HttpOnly JWT cookie
      await authApi.logout();
    }
    setUser(null);
    setTenant(null);
    setAuthError(null);
    activeUserId.current = null;
    permissionGeneration.current += 1;
    setPermissions({});
    setIsPermissionsLoaded(true);
    clearPageCache(); // evict all cross-route module data — prevents stale data after re-login
    localStorage.removeItem('leadcrm_user');
    localStorage.removeItem('leadcrm_tenant');
    // Clear onboarding flags so the next user on this browser sees the
    // full onboarding flow (keys must not leak across accounts).
    localStorage.removeItem('leadcrm_onboarding_complete');
    localStorage.removeItem('leadcrm_needs_company_setup');
    // Clear any saved post-login redirect so a new user doesn't inherit the
    // previous session's destination .
    sessionStorage.removeItem('leadcrm_redirect_after_login');
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
    if (!USE_MOCK_AUTH || !user) return;
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
  const updateProfile = async (profileData: import('@leadcrm/shared').UpdateSelfProfile): Promise<void> => {
    if (!user) throw new Error('Authentication required');
    if (USE_MOCK_AUTH) throw new Error('Profile editing requires the connected backend.');
    const expectedUserId = user.id;
    const response = await authApi.updateProfile(profileData);
    applyAuthUser(response.data.user, expectedUserId);
  };

  return (
    <AuthContext.Provider value={{
      user, tenant, isLoading, authError, retryAuthInit, refreshUser, applyAuthUser, applyOrganizationSettings,
      login, logout, requestPasswordReset, confirmPasswordReset,
      switchRole, updateProfile, switchDemoAccount, permissions, isPermissionsLoaded,
      userCan, refreshPermissions, restoreSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
