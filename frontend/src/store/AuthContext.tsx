'use client';

import { uuid } from '@/lib/utils';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from 'next-auth/react';
import { User, Tenant } from './types';
import { MOCK_USERS, MOCK_TENANTS } from './mockData';
import { authApi } from '@/shared/services/auth.api';

// When true, auth calls hit the mock localStorage data instead of the backend.
// Set NEXT_PUBLIC_USE_MOCK_AUTH=false in .env.local to use the real API.
const USE_MOCK_AUTH = process.env.NEXT_PUBLIC_USE_MOCK_AUTH !== 'false';

interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  isLoading: boolean;
  login: (email: string, password?: string) => Promise<boolean>;
  loginWithGoogle: () => Promise<void>;
  verifyOtp: (email: string, code: string) => Promise<boolean>;
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
   * - Real API mode: sends OTP with the account password, then auto-verifies with '000000' (DEMO_MODE bypass).
   * Returns true on success, false on failure.
   */
  switchDemoAccount: (email: string, password: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [tenant, setTenant]   = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Restore session on mount ──────────────────────────────────────
  useEffect(() => {
    const restoreSession = async () => {
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
        setIsLoading(false);
      } else {
        // Real API — verify the HttpOnly cookie by calling /auth/me
        try {
          const res = await authApi.me();
          if (res?.data?.user) {
            const apiUser = res.data.user as unknown as User;
            setUser(apiUser);
            if (apiUser.tenantId && apiUser.tenantId !== 'system') {
              // Populate tenant with status from /auth/me so sandbox vs production
              // routing works correctly throughout the app.
              const tenantStatus       = (res.data.user as any).tenantStatus       ?? 'ACTIVE';
              const subscriptionStatus = (res.data.user as any).subscriptionStatus ?? 'ACTIVE';
              setTenant({
                id:          apiUser.tenantId,
                name:        '',
                status:      tenantStatus.toLowerCase(),        // 'sandbox' | 'active' | …
                environment: tenantStatus === 'SANDBOX' ? 'sandbox' : 'production',
                subscriptionStatus,
              } as any);
            }
          } else {
            setUser(null);
            setTenant(null);
          }
        } catch {
          // No valid session cookie — user needs to log in
          setUser(null);
          setTenant(null);
        }
        setIsLoading(false);
      }
    };

    restoreSession();
  }, []); // Run once on mount only — session restore is not NextAuth-dependent

  // ── Login ─────────────────────────────────────────────────────────
  const login = async (email: string, password?: string): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      return mockLogin(email);
    }

    try {
      // Step 1: verify credentials + send OTP
      await authApi.sendOtp(email, password ?? '');
      return true; // signals OTP was sent — UI should show OTP step
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] login failed:', err instanceof Error ? err.message : err);
      }
      return false;
    }
  };

  // ── Verify OTP + complete login ────────────────────────────────────
  const verifyOtp = async (email: string, code: string): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      return mockLogin(email);
    }
    try {
      const res = await authApi.verifyOtp(email, code);
      if (res?.data?.user) {
        const apiUser = res.data.user as unknown as User;
        setUser(apiUser);
        if (apiUser.tenantId && apiUser.tenantId !== 'system') {
          const tenantStatus       = (res.data.user as any).tenantStatus       ?? 'ACTIVE';
          const subscriptionStatus = (res.data.user as any).subscriptionStatus ?? 'ACTIVE';
          setTenant({
            id:          apiUser.tenantId,
            name:        '',
            status:      tenantStatus.toLowerCase(),
            environment: tenantStatus === 'SANDBOX' ? 'sandbox' : 'production',
            subscriptionStatus,
          } as any);
        }
        return true;
      }
      return false;
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] verifyOtp failed:', err instanceof Error ? err.message : err);
      }
      throw err; // re-throw so UI can show the specific error message
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
   *   4. NextAuth redirects to callbackUrl → /auth/oauth-callback
   *
   * The middleware intercepts /auth/oauth-callback and routes:
   *   - New users (requiresProfileCompletion=true) → /auth/complete-profile
   *   - Existing users                             → /dashboard
   *
   * After the redirect completes, the page re-mounts and restoreSession()
   * re-hydrates AuthContext from the new cookie via /auth/me.
   *
   * In mock mode, Google sign-in is not available.
   */
  const loginWithGoogle = async (): Promise<void> => {
    if (USE_MOCK_AUTH) return;
    await nextAuthSignIn('google', { callbackUrl: '/auth/oauth-callback' });
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
    localStorage.removeItem('leadcrm_user');
    localStorage.removeItem('leadcrm_tenant');
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
        role:      'Client Admin',
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
        await authApi.registerGuest({
          firstName: guestData.firstName,
          lastName: guestData.lastName,
          email: guestData.email,
          password: guestData.password,
        });
        return true;
      } catch (err: unknown) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.error('[AuthContext] registerGuestAccount failed:', err instanceof Error ? err.message : err);
        }
        return false;
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
  // Mock mode  → direct mockLogin (no OTP, instant switch).
  // Real API   → sendOtp with password, then auto-verify with '000000'
  //              (requires DEMO_MODE=true + DEV_SEED_EMAILS on the server).
  const switchDemoAccount = async (email: string, password: string): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      return mockLogin(email);
    }
    try {
      // Step 1: request OTP
      await authApi.sendOtp(email, password);
      // Step 2: auto-verify with fixed bypass code
      const ok = await verifyOtp(email, '000000');
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
    <AuthContext.Provider value={{ user, tenant, isLoading, login, loginWithGoogle, verifyOtp, logout, registerTenant, registerGuestAccount, requestPasswordReset, confirmPasswordReset, switchRole, updateProfile, switchDemoAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
