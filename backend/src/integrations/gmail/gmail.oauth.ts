import { mailConfig } from '../../config/mail.config';
import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error';

/**
 * Gmail OAuth2 helpers.
 * Generates the authorization URL and exchanges the auth code for tokens.
 * Tokens must be stored securely — never in plain localStorage or logs.
 */

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface UserInfoResponse {
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Builds the Google OAuth2 authorization URL.
 * Uses an opaque one-time challenge and PKCE; identities stay on the backend.
 */
export function getAuthorizationUrl(state: string, verifier?: string, email?: string): string {
  const { clientId, redirectUri } = mailConfig.gmail;
  if (!clientId || !mailConfig.gmail.clientSecret || !redirectUri || !process.env.ENCRYPTION_KEY) {
    throw new AppError('Work email is not configured. Ask your administrator to configure Gmail OAuth and its exact callback URL.', 503);
  }
  const callback = new URL(redirectUri);
  if (callback.pathname !== '/api/v1/integrations/gmail/callback' || (callback.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(callback.hostname))) {
    throw new AppError('GMAIL_REDIRECT_URI must be the public backend /api/v1/integrations/gmail/callback URL registered in Google Cloud.', 503);
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  if (verifier) { params.set('code_challenge', createHash('sha256').update(verifier).digest('base64url')); params.set('code_challenge_method', 'S256'); }
  if (email) params.set('login_hint', email);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges the authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(code: string, verifier?: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = mailConfig.gmail;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      ...(verifier ? { code_verifier: verifier } : {}),
    }),
  });

  if (!response.ok) {
    throw new AppError('Gmail authorization failed. Check the registered callback URL and reconnect.', 502);
  }

  return response.json() as Promise<TokenResponse>;
}

/**
 * Refreshes an expired access token using the refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = mailConfig.gmail;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new AppError('Gmail access expired or was revoked. Reconnect your work email.', 502);
  }

  return response.json() as Promise<TokenResponse>;
}

/**
 * Fetches the authenticated user's email address from Google.
 */
export async function getUserInfo(accessToken: string): Promise<UserInfoResponse> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  return response.json() as Promise<UserInfoResponse>;
}

export { GMAIL_SCOPES };
export type { TokenResponse, UserInfoResponse };
