// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, PATCH, GET } from '../route';
import { rewriteSetCookie } from '@/lib/auth/cookies';

afterEach(() => vi.unstubAllGlobals());
it('rejects cross-origin security mutations before forwarding', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const req = new NextRequest('https://app.example.com/api/proxy/auth/change-password', { method: 'POST', headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' }, body: '{}' });
  expect((await POST(req, { params: Promise.resolve({ path: ['auth', 'change-password'] }) })).status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('preserves a deletion cookie instead of giving it another seven days', () => {
  const cookie = rewriteSetCookie('leadcrm_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly');
  expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  expect(cookie).not.toContain('Max-Age=604800');
});
it('strips Domain while preserving an explicit expiry/Max-Age', () => {
  const cookie = rewriteSetCookie('leadcrm_token=token; Domain=api.example.com; Max-Age=0; Secure');
  expect(cookie).not.toContain('Domain=');
  expect(cookie).toContain('Max-Age=0');
  expect(cookie).toContain('Path=/');
});
it('the actual logout proxy forwards credentials and the expired Set-Cookie', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"success":true}', {
    headers: { 'Content-Type': 'application/json',
      'Set-Cookie': 'leadcrm_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  const req = new NextRequest('https://app.example.com/api/proxy/auth/logout', {
    method: 'POST', headers: { Cookie: 'leadcrm_token=current-token' }, body: '{}',
  });
  const response = await POST(req, { params: Promise.resolve({ path: ['auth', 'logout'] }) });
  expect(response.headers.get('set-cookie')).toContain('1970');
  expect(response.headers.get('set-cookie')).not.toContain('604800');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    cache: 'no-store', redirect: 'manual', headers: { Cookie: 'leadcrm_token=current-token' },
  });
});

it('preserves uploaded and downloaded image bytes through the proxy', async () => {
  const bytes = new Uint8Array([0, 255, 128, 42]);
  const mock = vi.fn().mockImplementation(() => Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'image/webp' } })));
  vi.stubGlobal('fetch', mock);
  const req = new NextRequest('https://app.example.com/api/proxy/auth/profile/avatar', { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: bytes });
  const res = await POST(req, { params: Promise.resolve({ path: ['auth', 'profile', 'avatar'] }) });
  expect(new Uint8Array(mock.mock.calls[0][1].body)).toEqual(bytes);
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  expect(res.headers.get('cache-control')).toBe('no-store');
});

it('forwards CRM attachment bytes and download metadata through the proxy', async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 255]);
  const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''agreement.pdf" } }));
  vi.stubGlobal('fetch', fetchMock);
  const request = new NextRequest('https://app.example.com/api/proxy/crm/leads/lead-id/files?name=agreement.pdf&type=application%2Fpdf', {
    method: 'POST', headers: { Cookie: 'leadcrm_token=session-token', 'Content-Type': 'application/octet-stream' }, body: bytes,
  });
  const response = await POST(request, { params: Promise.resolve({ path: ['crm', 'leads', 'lead-id', 'files'] }) });
  expect(new Uint8Array(fetchMock.mock.calls[0][1].body)).toEqual(bytes);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get('content-disposition')).toContain('agreement.pdf');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});


it.each(['crm/leads', 'crm/contacts', 'crm/accounts', 'crm/deals', 'administration/users', 'administration/users/user/permissions', 'automation/workflows'])('forwards the same session for %s', async path => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":[]}'));
  vi.stubGlobal('fetch', fetchMock);
  const req = new NextRequest(`https://app.example.com/api/proxy/${path}`, { headers: { Cookie: 'leadcrm_token=test-session' } });
  expect((await GET(req, { params: Promise.resolve({ path: path.split('/') }) })).status).toBe(200);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:4000/api/v1/${path}`);
  expect(fetchMock.mock.calls[0][1].headers.Cookie).toBe('leadcrm_token=test-session');
});

it('preserves the backend 401 when the incoming request has no session', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"Authentication required"}', { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  const req = new NextRequest('https://app.example.com/api/proxy/crm/leads');
  const response = await GET(req, { params: Promise.resolve({ path: ['crm', 'leads'] }) });
  expect(response.status).toBe(401);
  expect(fetchMock.mock.calls[0][1].headers.Cookie).toBeUndefined();
});
