'use client';

import { invalidateApiPageCache } from '@/shared/cache/invalidate-api-page-cache';
import type { ApiError } from '@leadcrm/shared';

export type ApiRequestError = Error & Partial<Pick<ApiError['error'], 'code' | 'retryAt'>> & { status?: number; fieldErrors?: Record<string, string[]> };

// LeadCRM API Client
// Sends HttpOnly cookies (leadcrm_token) on every request via credentials: 'include'.
// The backend auth middleware reads the cookie directly — no Bearer token needed.

// Only the Next.js proxy resolves API_URL and forwards the HttpOnly session.
const API_URL = '/api/proxy';

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  // Server fetch does not inherit browser cookies, even with credentials: include.
  if (typeof window === 'undefined') {
    throw new Error('The browser API client cannot be used during server rendering.');
  }
  const headers: Record<string, string> = {
    'Content-Type': body instanceof Blob ? body.type : 'application/json',
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

  const pending = fetch(`${API_URL}${finalPath}`, {
    method,
    headers,
    credentials: 'include', // sends HttpOnly leadcrm_token cookie automatically
    signal,
    ...(body !== undefined ? { body: body instanceof Blob ? body : JSON.stringify(body) } : {}),
  });
  const res = await pending;

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: res.statusText }));
    // Backend can return error as a string (AppError path) or as an object
    // with { code, message } (validation error path). Extract message from both.
    const rawError = errorData.error;

    const errorMessage =
      (typeof rawError === 'string' && rawError)
        ? rawError
        : (typeof rawError === 'object' && rawError !== null && typeof (rawError as Record<string, unknown>).message === 'string')
          ? (rawError as Record<string, unknown>).message as string
          : (typeof errorData.message === 'string' && errorData.message)
            ? errorData.message
            : res.statusText || 'API request failed';
    const error = new Error(errorMessage) as ApiRequestError;
    if (typeof rawError === 'object' && rawError !== null && typeof (rawError as Record<string, unknown>).code === 'string') {
      error.code = (rawError as Record<string, unknown>).code as string;
      if (typeof rawError.retryAt === 'string' && Number.isFinite(Date.parse(rawError.retryAt))) error.retryAt = rawError.retryAt;
    }
    error.status = res.status;
    // Preserve HTTP rate-limit guidance as an absolute time for callers.
    // Retry-After is emitted by the API limiter as seconds or an HTTP date.
    if (res.status === 429 && !error.retryAt) {
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const until = Number.isFinite(seconds) && seconds >= 0
          ? Date.now() + Math.ceil(seconds * 1000)
          : Date.parse(retryAfter);
        if (Number.isFinite(until) && until > Date.now()) error.retryAt = new Date(until).toISOString();
      }
    }
    error.fieldErrors = errorData.fieldErrors;
    throw error;
  }

  if (method !== 'GET') invalidateApiPageCache(path);
  const data = await res.json() as T;
  return data;
}

export const apiClient = {
  upload: <T>(path: string, body: Blob) => request<T>('POST', path, body),
  get:    <T>(path: string, config?: { params?: Record<string, unknown>; signal?: AbortSignal }) => request<T>('GET', path, undefined, config?.params, config?.signal),
  post:   <T>(path: string, body: unknown)   => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown)   => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body?: unknown)  => request<T>('PATCH',  path, body),
  delete: <T>(path: string)                  => request<T>('DELETE', path),
  /** Low-level method for DELETE requests that need a JSON body. */
  deleteWithBody: <T>(path: string, body: unknown) => request<T>('DELETE', path, body),
};
