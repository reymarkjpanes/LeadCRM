export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { forwardAuthCookies } from '@/lib/auth/cookies';

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

async function proxyRequest(
  req: NextRequest,
  params: { path: string[] },
): Promise<NextResponse> {
  const path = '/' + params.path.join('/');
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.get('origin');
    if (req.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== req.nextUrl.origin)) {
      return NextResponse.json({ success: false, error: 'Forbidden origin.' }, { status: 403 });
    }
  }
  const url = BACKEND_URL + path + req.nextUrl.search;

  const token = req.cookies.get('leadcrm_token')?.value;
  const headers: Record<string, string> = {
    'Content-Type': req.headers.get('content-type') ?? 'application/json',
    'Accept': 'application/json',
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

  let body: string | ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.startsWith('multipart/form-data') || ct.startsWith('image/') || ct.startsWith('application/octet-stream')) {
      body = await req.arrayBuffer();
    } else {
      body = await req.text();
    }
  }

  // Allow cold starts and transactional workspace provisioning.
  // Longer cold starts return an explicit retryable error.
  // When the signal fires, fetch throws AbortError, caught below and returned as 503.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const backendRes = await fetch(url, { method: req.method, headers, body, signal: controller.signal, cache: 'no-store', redirect: 'manual' });
    clearTimeout(timeoutId);
    const data = await backendRes.arrayBuffer();

    const response = new NextResponse(data, {
      status: backendRes.status,
      headers: {
        'Content-Type':
          backendRes.headers.get('content-type') ?? 'application/json',
      },
    });

    const disposition = backendRes.headers.get('content-disposition');
    if (disposition) response.headers.set('Content-Disposition', disposition);
    response.headers.set('X-Content-Type-Options', 'nosniff');

    // Forward and rewrite Set-Cookie headers from the backend to the browser.
    // Critical for auth — the login endpoint sets the HttpOnly leadcrm_token
    // cookie via Set-Cookie. We rewrite each cookie to strip the backend's
    // Domain attribute and ensure SameSite/Secure are correct for the frontend
    // origin so the browser accepts and stores the cookie.
    forwardAuthCookies(backendRes.headers, response.headers);
    response.headers.set('Cache-Control', 'no-store');

    return response;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const message = err instanceof Error ? err.message : 'Unknown proxy error';
    console.error('[Proxy] Backend fetch failed for %s %s: %s', req.method, path, message);

    if (isTimeout) {
      // Render Free tier cold start exceeded the 25s proxy timeout.
      // Return 503 so the frontend can show a "server waking up" message.
      return NextResponse.json(
        { success: false, error: { message: 'The server is warming up. Please wait a moment and try again.' } },
        { status: 503 },
      );
    }

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
