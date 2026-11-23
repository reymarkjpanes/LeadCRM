import { afterEach, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import { PASSWORD_CHANGE_REQUIRED_EVENT } from '@/shared/auth/auth-events';
import { SESSION_ENDED_EVENT, SESSION_METADATA_EVENT, advanceAuthEpoch } from '@/shared/auth/auth-events';
import { clearPageCache, getPageCacheSize, setPageCache } from '@/shared/cache/page-cache';

afterEach(() => vi.unstubAllGlobals());
it('exposes the structured Account duplicate review when creation needs confirmation', async () => {
  const duplicateReview = { token: 'c'.repeat(64), matches: [{ id: 'account', name: 'PLDT INC', address: 'Makati' }] };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: { code: 'POSSIBLE_DUPLICATE_ACCOUNT', message: 'Review the matches.', duplicateReview },
  }), { status: 409 })));
  await expect(apiClient.post('/crm/accounts', { name: 'pldt_INC' }))
    .rejects.toMatchObject({ status: 409, code: 'POSSIBLE_DUPLICATE_ACCOUNT', duplicateReview });
});

it('passes an optional POST cancellation signal to the credentialed transport', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetchMock);
  const request = apiClient.post('/crm/duplicate-check', { email: 'customer@example.test' }, { signal: controller.signal });
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchMock).toHaveBeenCalledWith('/api/proxy/crm/duplicate-check', expect.objectContaining({ signal: controller.signal, credentials: 'include' }));
});
it('signals password-change-required without retrying the protected request', async () => {
  const changed = vi.fn();
  window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, changed);
  try {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your password first.' } }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiClient.get('/crm/leads')).rejects.toMatchObject({ status: 403, code: 'PASSWORD_CHANGE_REQUIRED' });
    expect(changed).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally { window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, changed); }
});
it('does not signal password recovery for ordinary permission denials', async () => {
  const changed = vi.fn();
  window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, changed);
  try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":"FORBIDDEN","message":"Access denied"}}', { status: 403 })));
    await expect(apiClient.get('/crm/leads')).rejects.toMatchObject({ status: 403 });
    expect(changed).not.toHaveBeenCalled();
  } finally { window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, changed); }
});

it('preserves authoritative lockout expiry and server time without retrying credentials', async () => {
  const error = { code: 'AUTH_LOGIN_LOCKED', message: 'Cooldown', retryAt: '2030-01-01T00:05:00.000Z', serverNow: '2030-01-01T00:00:00.000Z' };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error }), { status: 429 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(apiClient.post('/auth/login', {})).rejects.toMatchObject(error);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('records activity without discarding cached CRM data', async () => {
  clearPageCache();
  setPageCache('leads', 'tenant', {}, { data: [{ id: 'lead' }] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"success":true}')));
  await apiClient.post('/auth/activity', { lastActiveAt: new Date().toISOString() });
  expect(getPageCacheSize()).toBe(1);
  clearPageCache();
});

it.each(['/crm/leads', '/crm/contacts', '/crm/accounts', '/crm/deals', '/administration/users', '/administration/users/user/permissions', '/automation/workflows'])('uses the credentialed same-origin path for %s', async path => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":[]}'));
  vi.stubGlobal('fetch', fetchMock);
  await apiClient.get(path);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(`/api/proxy${path}`, expect.objectContaining({ credentials: 'include' }));
});

it('never sends an unsigned server-side request', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', undefined);
  await expect(apiClient.get('/crm/leads')).rejects.toThrow('cannot be used during server rendering');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('preserves genuine 401 errors without retrying or concealing them', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"Authentication required"}', { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(apiClient.get('/crm/leads')).rejects.toMatchObject({ status: 401, message: 'Authentication required' });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it.each(['/auth/login', '/auth/login-lockout', '/auth/forgot-password', '/auth/reset-password', '/integrations/gmail/emails'])('does not end LeadCRM authentication for public/provider rejection at %s', async path => {
  const ended = vi.fn(); window.addEventListener(SESSION_ENDED_EVENT, ended);
  try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: path.includes('gmail') ? 'GMAIL_RECONNECT_REQUIRED' : 'AUTH_INVALID_CREDENTIALS', message: 'Denied' } }), { status: 401 })));
    await expect(apiClient.post(path, {})).rejects.toMatchObject({ status: 401 });
    expect(ended).not.toHaveBeenCalled();
  } finally { window.removeEventListener(SESSION_ENDED_EVENT, ended); }
});

it('signals a protected authentication rejection but ignores responses from an earlier login lifecycle', async () => {
  const ended = vi.fn(), metadata = vi.fn();
  window.addEventListener(SESSION_ENDED_EVENT, ended); window.addEventListener(SESSION_METADATA_EVENT, metadata);
  try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"Session revoked"}', { status: 401 })));
    await expect(apiClient.get('/crm/leads')).rejects.toMatchObject({ status: 401 });
    expect(ended).toHaveBeenCalledOnce(); ended.mockClear();
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const oldRequest = apiClient.get('/crm/leads'); advanceAuthEpoch();
    finish(new Response('{"error":{"code":"SESSION_IDLE_EXPIRED","message":"Expired"}}', { status: 401 }));
    await expect(oldRequest).rejects.toMatchObject({ status: 401 });
    expect(ended).not.toHaveBeenCalled();
    const oldMetadata = apiClient.get('/auth/me'); advanceAuthEpoch();
    finish(new Response('{"data":{"session":{"sessionId":"old"}}}'));
    await oldMetadata; expect(metadata).not.toHaveBeenCalled();
  } finally { window.removeEventListener(SESSION_ENDED_EVENT, ended); window.removeEventListener(SESSION_METADATA_EVENT, metadata); }
});

it('exposes Retry-After as an absolute cooldown after a 429 response', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"Too many requests"}', {
    status: 429, headers: { 'Retry-After': '60', 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  const before = Date.now();
  let caught: unknown;
  try { await apiClient.get('/integrations/gmail/emails'); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ status: 429 });
  const retryAt = Date.parse((caught as { retryAt: string }).retryAt);
  expect(retryAt).toBeGreaterThanOrEqual(before + 59_000);
  expect(retryAt).toBeLessThanOrEqual(Date.now() + 61_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
