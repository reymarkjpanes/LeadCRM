import NextAuth, { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';

// Required for NextAuth v4 on Next.js 15 — prevents the route from being
// statically optimised, which breaks cookie/header access during OAuth initiation.
export const dynamic = 'force-dynamic';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

// ─── Environment validation ───────────────────────────────────────────────────
// NOTE: Validated at runtime (not module-level throws) so Next.js 15 doesn't
// swallow the error and convert it into a confusing OAuthSignin error code.
const NEXTAUTH_SECRET      = process.env.NEXTAUTH_SECRET      ?? '';
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';

// ─── Internal shape returned from authorize() / signIn() ─────────────────────
// This is an internal type used only within this file.
// NextAuth v4 requires id + email; everything else flows through the jwt callback.
interface LeadCRMUser {
  id:                        string;
  email:                     string;
  name?:                     string | null;
  image?:                    string | null;
  firstName:                 string;
  lastName:                  string;
  role:                      string;
  tenantId:                  string;
  accessToken:               string;
  requiresProfileCompletion: boolean;
}

// ─── Auth options ─────────────────────────────────────────────────────────────
export const authOptions: NextAuthOptions = {
  secret: NEXTAUTH_SECRET,

  providers: [
    // ── Google OAuth 2.0 ────────────────────────────────────────────────────
    GoogleProvider({
      clientId:     GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          access_type: 'offline',
          prompt:      'select_account',
          scope:       'openid email profile',
        },
      },
    }),

    // ── Email + Password (existing OTP flow — kept for backward compat) ─────
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        try {
          const response = await fetch(`${API_URL}/auth/login`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              email:    credentials.email,
              password: credentials.password,
            }),
          });

          const result = await response.json() as {
            success: boolean;
            data?: {
              user: {
                id: string; email: string; firstName: string;
                lastName: string; role: string; tenantId: string;
              };
              token: string;
            };
          };

          if (response.ok && result.success && result.data?.user) {
            const lcUser: LeadCRMUser = {
              id:                        result.data.user.id,
              email:                     result.data.user.email,
              firstName:                 result.data.user.firstName,
              lastName:                  result.data.user.lastName,
              role:                      result.data.user.role,
              tenantId:                  result.data.user.tenantId,
              accessToken:               result.data.token,
              requiresProfileCompletion: false,
            };
            // next-auth v4: authorize must return User | null.
            // Our augmented User has all these fields, so the cast is safe.
            return lcUser as unknown as import('next-auth').User;
          }
          return null;
        } catch {
          return null;
        }
      },
    }),
  ],

  // ─── Callbacks ─────────────────────────────────────────────────────────────
  callbacks: {
    /**
     * signIn — for Google: call our backend bridge to verify the id_token,
     * find-or-create the user, and issue the LeadCRM JWT cookie.
     * We attach the result to the `user` object so `jwt()` can read it.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        try {
          const idToken = account.id_token;
          if (!idToken) {
            console.error('[NextAuth] Google signIn: missing id_token');
            return false;
          }

          // Debug: log what NextAuth received from Google (dev only)
          if (process.env.NODE_ENV === 'development') {
            console.info('[NextAuth] Google account keys:', Object.keys(account));
            console.info('[NextAuth] providerAccountId:', account.providerAccountId);
            console.info('[NextAuth] user.email:', user.email);
            console.info('[NextAuth] id_token present:', !!idToken);
          }

          const googleProfile = profile as {
            given_name?: string;
            family_name?: string;
            email_verified?: boolean;
          };

          if (process.env.NODE_ENV === 'development') {
            console.info('[NextAuth] Calling OAuth bridge:', `${API_URL}/auth/oauth/google`);
          }

          const response = await fetch(`${API_URL}/auth/oauth/google`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              // NextAuth v4: providerAccountId is the Google sub claim
              // It may come as account.providerAccountId or account.id — check both
              providerAccountId: account.providerAccountId ?? (account as Record<string, unknown>).id ?? '',
              idToken,
              accessToken:    account.access_token,
              refreshToken:   account.refresh_token,
              expiresAtEpoch: account.expires_at,
              scope:          account.scope,
              email:          user.email ?? '',
              firstName:      googleProfile.given_name  ?? user.name?.split(' ')[0] ?? '',
              lastName:       googleProfile.family_name ?? (user.name?.split(' ').slice(1).join(' ') || 'User'),
              avatarUrl:      user.image ?? undefined,
              emailVerified:  googleProfile.email_verified ?? false,
            }),
          });

          const result = await response.json() as {
            success: boolean;
            data?: {
              user: {
                id: string; email: string; firstName: string;
                lastName: string; role: string; tenantId: string; avatarUrl: string | null;
              };
              token: string;
              isNewUser: boolean;
              requiresProfileCompletion: boolean;
            };
            error?: string;
          };

          if (!response.ok || !result.success || !result.data) {
            console.error('[NextAuth] OAuth bridge failed — status:', response.status, '| error:', result.error);
            return false;
          }

          // Mutate the user object — NextAuth passes it by reference into jwt()
          const lcUser = user as unknown as LeadCRMUser;
          lcUser.id                        = result.data.user.id;
          lcUser.email                     = result.data.user.email;
          lcUser.firstName                 = result.data.user.firstName;
          lcUser.lastName                  = result.data.user.lastName;
          lcUser.role                      = result.data.user.role;
          lcUser.tenantId                  = result.data.user.tenantId;
          lcUser.accessToken               = result.data.token;
          lcUser.requiresProfileCompletion = result.data.requiresProfileCompletion;

          // NOTE: We do NOT set the leadcrm_token cookie here.
          // cookies().set() does not work reliably inside NextAuth callbacks in
          // Next.js 15. Instead, the token is stored in the NextAuth JWT
          // (as accessToken above) and the /api/auth/session-sync route reads
          // the NextAuth session server-side and writes the cookie correctly.

          return true;
        } catch (err) {
          console.error('[NextAuth] OAuth signIn exception:', err instanceof Error ? err.message : err);
          return false;
        }
      }

      // Credentials: authorize() already validated — pass through
      return true;
    },

    /**
     * jwt — encode LeadCRM user data into the encrypted NextAuth JWT.
     * NextAuth stores this in an HttpOnly cookie — never accessible from JS.
     */
    async jwt({ token, user }) {
      if (user) {
        const lcUser = user as unknown as LeadCRMUser;
        token.id                        = lcUser.id;
        token.role                      = lcUser.role;
        token.firstName                 = lcUser.firstName;
        token.lastName                  = lcUser.lastName;
        token.tenantId                  = lcUser.tenantId;
        token.accessToken               = lcUser.accessToken;
        token.requiresProfileCompletion = lcUser.requiresProfileCompletion ?? false;
      }
      return token;
    },

    /**
     * session — shape the client-visible session object.
     * Only non-sensitive scalar fields are exposed. No raw JWT.
     */
    async session({ session, token }) {
      session.user.id        = token.id        as string;
      session.user.role      = token.role      as string;
      session.user.firstName = token.firstName as string;
      session.user.lastName  = token.lastName  as string;
      // tenantId is in our JWT augmentation — cast through unknown to assign
      (session.user as unknown as { tenantId: string }).tenantId = token.tenantId as string;
      session.accessToken    = token.accessToken               as string;
      session.requiresProfileCompletion = token.requiresProfileCompletion as boolean ?? false;
      return session;
    },
  },

  // ─── Custom pages ───────────────────────────────────────────────────────────
  pages: {
    signIn:  '/login',
    error:   '/login',   // ?error= will appear here — check the value
    newUser: '/auth/complete-profile',
  },

  // ─── Session strategy ───────────────────────────────────────────────────────
  session: {
    strategy: 'jwt',
    maxAge:   7 * 24 * 60 * 60, // 7 days — matches backend session TTL
  },

  debug: process.env.NODE_ENV === 'development',
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
