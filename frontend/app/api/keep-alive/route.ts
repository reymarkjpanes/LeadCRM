import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/keep-alive
 *
 * Cron job endpoint (vercel.json: every 14 minutes).
 * Pings the Render backend health check to prevent the Free tier service
 * from spinning down due to inactivity (Render spins down after 15 minutes).
 *
 * Without this, the first user request after a period of inactivity hits a
 * cold start (30-60s), which exceeds the Vercel 10s function timeout and
 * returns a 502/503 to the user.
 */
export async function GET(): Promise<NextResponse> {
  const backendUrl =
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:4000/api/v1';

  // Derive the health endpoint from the API base URL
  // e.g. https://leadcrm-backend-os8d.onrender.com/api/v1 -> /health
  const healthUrl = backendUrl.replace(/\/api\/v1$/, '') + '/health';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'LeadCRM-KeepAlive/1.0' },
    });
    clearTimeout(timeoutId);

    const status = res.ok ? 'ok' : 'degraded';
    console.info('[KeepAlive] Render ping %s ? HTTP %d', status, res.status);

    return NextResponse.json({ status, httpStatus: res.status, ts: new Date().toISOString() });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KeepAlive] Render ping failed:', message);
    return NextResponse.json(
      { status: isTimeout ? 'timeout' : 'error', message },
      { status: 200 }, // always 200 so Vercel cron doesn't retry aggressively
    );
  }
}
