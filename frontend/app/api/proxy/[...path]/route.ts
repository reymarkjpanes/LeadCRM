export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { forwardAuthCookies } from '@/lib/auth/cookies';
import { getBackendUrl } from '@/lib/server/backend-url';

async function proxyRequest(
  req: NextRequest,
  params: { path: string[] },
): Promise<NextResponse> {
  const path = '/' + params.path.join('/');
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.get('origin');
    // Next's URL can use the internal HTTP container address behind TLS ingress.
    // Host is the request authority routed by ingress; never trust a caller's
    // X-Forwarded-Host to authorize a cross-origin mutation.
    const host = (req.headers.get('host') ?? req.nextUrl.host).toLowerCase();
    const protocol = process.env.NODE_ENV === 'production' ? 'https:' : req.nextUrl.protocol;
    let invalidOrigin = false;
    if (origin) {
      try {
        const parsed = new URL(origin);
        invalidOrigin = origin !== parsed.origin || parsed.host !== host || parsed.protocol !== protocol;
      } catch {
        invalidOrigin = true;
      }
    }
    if (req.headers.get('sec-fetch-site') === 'cross-site' || invalidOrigin) {
      return NextResponse.json({ success: false, error: 'Forbidden origin.' }, { status: 403 });
    }
  }
  let backendUrl: string;
  try { backendUrl = getBackendUrl(); } catch {
    console.error('[Proxy] Invalid API_URL configuration.');
    return NextResponse.json(
      { success: false, error: { code: 'PROXY_CONFIGURATION_ERROR', message: 'Backend is not configured. Set a valid server-only API_URL.' } },
      { status: 503 },
    );
  }
  const url = backendUrl + path + req.nextUrl.search;

  const token = req.cookies.get('leadcrm_token')?.value;
  const headers: Record<string, string> = {
    'Content-Type': req.headers.get('content-type') ?? 'application/json',
    'Accept': 'application/json',
  };
  const mailboxStream = req.method === 'GET' && ['/integrations/gmail/events', '/reporting/dashboard/events', '/auth/events', '/crm/pipelines/events'].includes(path);
  if (mailboxStream) headers.Accept = 'text/event-stream';

  // Forward the HttpOnly cookie server-side — this is the whole reason the
  // proxy exists. Browsers block third-party cookies on cross-origin fetches,
  // so the browser sends the cookie to same-origin /api/proxy, and this
  // route handler forwards it to the backend via a server-to-server
  // request that is never subject to third-party cookie restrictions.
  if (token) {
    headers['Cookie'] = `leadcrm_token=${token}`;
  }

  // Forward the real client IP so the backend rate limiter sees the actual
  // user address rather than the hosting proxy IP. The backend trusts only
  // ingress addresses configured in TRUSTED_PROXIES.
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
  const abortStream = () => controller.abort();
  if (mailboxStream) req.signal.addEventListener('abort', abortStream, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const backendRes = await fetch(url, { method: req.method, headers, body, signal: controller.signal, cache: 'no-store', redirect: 'manual' });
    clearTimeout(timeoutId);
    if (mailboxStream && backendRes.ok && backendRes.body) {
      return new NextResponse(backendRes.body, { status: 200, headers: {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no',
      } });
    }
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
    const retryAfter = backendRes.headers.get('retry-after');
    if (retryAfter) response.headers.set('Retry-After', retryAfter);
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
      // The backend exceeded the 25s proxy timeout.
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
          code: 'PROXY_UPSTREAM_UNREACHABLE',
          message: 'Unable to reach the server. Please try again in a moment.',
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
