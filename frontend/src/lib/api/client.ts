'use client';

// LeadCRM API Client
// Sends HttpOnly cookies (leadcrm_token) on every request via credentials: 'include'.
// The backend auth middleware reads the cookie directly — no Bearer token needed.

// In production cross-domain deployments, route through the Next.js API proxy
// to avoid third-party cookie blocking. The proxy forwards the leadcrm_token cookie server-side.
const IS_BROWSER = typeof window !== 'undefined';
const DIRECT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const USE_PROXY = IS_BROWSER && DIRECT_API_URL.startsWith('https://') && !DIRECT_API_URL.includes('localhost');
const API_URL = USE_PROXY ? '/api/proxy' : DIRECT_API_URL;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let finalPath = path;
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const qs = searchParams.toString();
    if (qs) {
      finalPath += `?${qs}`;
    }
  }

  const res = await fetch(`${API_URL}${finalPath}`, {
    method,
    headers,
    credentials: 'include', // sends HttpOnly leadcrm_token cookie automatically
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: res.statusText }));
    // Backend can return error as a string (AppError path) or as an object
    // with { code, message } (validation error path). Extract message from both.
    const rawError = errorData.error;

    // ─── Billing Interceptors ───────────────────────────────────────────
    // Dispatch custom events for plan gating and payment failures so the UI
    // can show contextual upgrade/payment modals without each component needing
    // to handle these cases individually.
    // Only fire for user-initiated MUTATIONS — passive background GET reads
    // (e.g. DataContext list calls) must NOT trigger a global upgrade/payment
    // modal. The error is still thrown below so callers can handle it.
    if (method !== 'GET' && typeof window !== 'undefined' && typeof rawError === 'object' && rawError !== null) {
      const errorCode = (rawError as Record<string, unknown>).code;
      if (res.status === 403 && errorCode === 'PLAN_UPGRADE_REQUIRED') {
        const { dispatchPlanUpgradeRequired } = await import('@/shared/hooks/use-billing-interceptor');
        dispatchPlanUpgradeRequired({
          feature: (rawError as Record<string, unknown>).feature as string ?? 'unknown',
          currentPlan: (rawError as Record<string, unknown>).currentPlan as string ?? 'STARTER',
          requiredPlan: (rawError as Record<string, unknown>).requiredPlan as string ?? 'PRO',
        });
      }
      if (res.status === 402 && errorCode === 'PAYMENT_REQUIRED') {
        const { dispatchPaymentRequired } = await import('@/shared/hooks/use-billing-interceptor');
        dispatchPaymentRequired();
      }
    }

    const errorMessage =
      (typeof rawError === 'string' && rawError)
        ? rawError
        : (typeof rawError === 'object' && rawError !== null && typeof (rawError as Record<string, unknown>).message === 'string')
          ? (rawError as Record<string, unknown>).message as string
          : (typeof errorData.message === 'string' && errorData.message)
            ? errorData.message
            : res.statusText || 'API request failed';
    const error = new Error(errorMessage) as Error & { code?: string; status?: number };
    if (typeof rawError === 'object' && rawError !== null && typeof (rawError as Record<string, unknown>).code === 'string') {
      error.code = (rawError as Record<string, unknown>).code as string;
    }
    error.status = res.status;
    throw error;
  }

  return res.json() as Promise<T>;
}

export const apiClient = {
  get:    <T>(path: string, config?: { params?: Record<string, unknown> }) => request<T>('GET',    path, undefined, config?.params),
  post:   <T>(path: string, body: unknown)   => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown)   => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body?: unknown)  => request<T>('PATCH',  path, body),
  delete: <T>(path: string)                  => request<T>('DELETE', path),
  /** Low-level method for DELETE requests that need a JSON body. */
  deleteWithBody: <T>(path: string, body: unknown) => request<T>('DELETE', path, body),
};
