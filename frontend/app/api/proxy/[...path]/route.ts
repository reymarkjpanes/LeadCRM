export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

// Prefer the server-only API_URL env var (set in Vercel dashboard, never
// exposed to the browser bundle). Fall back to NEXT_PUBLIC_API_URL for
// environments that only configure the public var. Final fallback to
// localhost for local dev only.
const BACKEND_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000/api/v1';

// Warn at cold-start when the proxy would route to localhost — that address
// is unreachable from Vercel serverless and every request returns 502.
// The message surfaces in Vercel function logs so the misconfiguration is
// immediately visible instead of silently producing "incorrect credentials".
if (BACKEND_URL.includes('localhost')) {
  console.warn(
    '[Proxy] WARNING: BACKEND_URL resolved to localhost (%s). ' +
    'Set API_URL (or NEXT_PUBLIC_API_URL) in your Vercel environment variables ' +
    'to point at the production backend (e.g. https://your-app.onrender.com/api/v1). ' +
    'All proxied requests will fail until this is corrected.',
    BACKEND_URL,
  );
}

/**
 * Rewrites a raw Set-Cookie string from the Render backend so it is valid
 * for the Vercel frontend domain.
 *
 * Problem: the backend sets cookies with no Domain attribute, which causes
 * the browser to scope the cookie to the backend's domain (onrender.com).
 * When the proxy forwards this raw header to the browser, the browser sees
 * the cookie as coming from vercel.app but with attributes set by a
 * different origin — some browsers silently drop it.
 *
 * Fix: parse the raw Set-Cookie string and rebuild it with:
 *   - No Domain attribute (browser defaults to the current origin = vercel.app)
 *   - Secure flag preserved for production
 *   - SameSite=Lax preserved (required for top-level navigation cookie delivery)
 *   - Path=/ so the cookie is available across the entire frontend
 *   - Original name, value, and Max-Age preserved exactly
 */
function rewriteSetCookie(raw: string): string {
  const parts = raw.split(/;\s*/);
  const [nameValue, ...attributes] = parts;

  // Rebuild attribute map from the backend's cookie, normalising keys to lowercase
  const attrMap = new Map<string, string | null>();
  for (const attr of attributes) {
    const eqIdx = attr.indexOf('=');
    if (eqIdx === -1) {
      attrMap.set(attr.toLowerCase(), null);
    } else {
      attrMap.set(attr.slice(0, eqIdx).toLowerCase(), attr.slice(eqIdx + 1));
    }
  }

  // Build the new Set-Cookie string. Omit Domain entirely so the browser
  // scopes the cookie to the vercel.app origin (the page's origin).
  const rebuilt: string[] = [nameValue];

  // Path — always / so the cookie is sent on every frontend route
  rebuilt.push('Path=/');

  // Max-Age — preserve from backend, default to 7 days if missing
  const maxAge = attrMap.get('max-age') ?? String(7 * 24 * 60 * 60);
  rebuilt.push(`Max-Age=${maxAge}`);

  // HttpOnly — always set for the auth token cookie
  rebuilt.push('HttpOnly');

  // Secure — set when the frontend is served over HTTPS
  // Check VERCEL env var as a reliable production signal
  const isSecure =
    process.env.VERCEL === '1' ||
    process.env.NODE_ENV === 'production' ||
    attrMap.has('secure');
  if (isSecure) rebuilt.push('Secure');

  // SameSite — Lax allows the cookie to be sent on top-level navigation
  // (required so the cookie survives AuthGuard redirects post-login).
  rebuilt.push('SameSite=Lax');

  return rebuilt.join('; ');
}

async function proxyRequest(
  req: NextRequest,
  params: { path: string[] },
): Promise<NextResponse> {
  const path = '/' + params.path.join('/');
  const url = BACKEND_URL + path + req.nextUrl.search;

  const token = req.cookies.get('leadcrm_token')?.value;
  const headers: Record<string, string> = {
    'Content-Type': req.headers.get('content-type') ?? 'application/json',
  };

  // Forward the HttpOnly cookie server-side — this is the whole reason the
  // proxy exists. Browsers block third-party cookies on cross-origin fetches,
  // so the browser sends the cookie to same-origin /api/proxy, and this
  // serverless function forwards it to the Render backend via a server-to-server
  // request that is never subject to third-party cookie restrictions.
  if (token) {
    headers['Cookie'] = `leadcrm_token=${token}`;
  }

  // Forward the real client IP so the backend rate limiter sees the actual
  // user address rather than the Vercel edge node IP.
  const clientIp =
    req.headers.get('x-forwarded-for') ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1';
  headers['X-Forwarded-For'] = clientIp;

  const body =
    req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.text()
      : undefined;

  try {
    const backendRes = await fetch(url, { method: req.method, headers, body });
    const data = await backendRes.text();

    const response = new NextResponse(data, {
      status: backendRes.status,
      headers: {
        'Content-Type':
          backendRes.headers.get('content-type') ?? 'application/json',
      },
    });

    // Forward and rewrite Set-Cookie headers from the backend to the browser.
    // Critical for auth — the login endpoint sets the HttpOnly leadcrm_token
    // cookie via Set-Cookie. We rewrite each cookie to strip the backend's
    // Domain attribute and ensure SameSite/Secure are correct for the frontend
    // origin so the browser accepts and stores the cookie.
    const setCookies = backendRes.headers.getSetCookie();
    for (const cookie of setCookies) {
      response.headers.append('Set-Cookie', rewriteSetCookie(cookie));
    }

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown proxy error';
    console.error('[Proxy] Backend fetch failed for %s %s: %s', req.method, path, message);

    // Return a structured error envelope that matches the backend AppError shape
    // so apiClient.ts can extract a useful message. Without this, the client
    // receives an unstructured 502 body and falls back to res.statusText,
    // producing a confusing "Bad Gateway" message instead of an actionable one.
    return NextResponse.json(
      {
        success: false,
        error: {
          message: BACKEND_URL.includes('localhost')
            ? 'Backend is not configured. Set API_URL in your Vercel environment variables.'
            : 'Unable to reach the server. Please try again in a moment.',
        },
      },
      { status: 502 },
    );
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const params = await context.params;
  return proxyRequest(req, params);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const params = await context.params;
  return proxyRequest(req, params);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const params = await context.params;
  return proxyRequest(req, params);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const params = await context.params;
  return proxyRequest(req, params);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const params = await context.params;
  return proxyRequest(req, params);
}
