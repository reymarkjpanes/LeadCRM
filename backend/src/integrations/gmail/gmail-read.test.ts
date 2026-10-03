import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readGmailJson } from './gmail-read';
import { fetchEmails, fetchUnreadCount } from './gmail.service';
import { errorMiddleware } from '../../api/middleware/error.middleware';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({ delay: vi.fn().mockResolvedValue(undefined), token: '' }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));
vi.mock('../../config/database.config', () => ({ default: { emailAccount: { findUnique: vi.fn(async () => ({
  isActive: true, email: 'staff@camxian.com', accessToken: 'encrypted', tokenExpiresAt: new Date(Date.now() + 3600000),
})) } } }));
vi.mock('../../core/auth/auth-user', () => ({ readAuthUser: vi.fn(async () => ({ email: 'staff@camxian.com' })) }));
vi.mock('../../core/encryption/crypto.service', () => ({ decryptToken: () => mocks.token, encryptToken: () => 'encrypted' }));

let token = '';
beforeEach(() => { vi.clearAllMocks(); token = mocks.token = crypto.randomUUID(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const failure = (status: number, reason: string, headers?: HeadersInit) => Response.json({ error: { message: 'private provider payload', errors: [{ reason }] } }, { status, headers });

describe('Gmail read error handling', () => {
  it.each([500, 503])('retries a transient %i before returning data', async status => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(status, 'userRateLimitExceeded')).mockResolvedValueOnce(Response.json({ messages: [] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await readGmailJson(token, 'messages')).toEqual({ messages: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.delay).toHaveBeenCalledTimes(1);
  });
  it.each([403, 429])('pauses after a %i rate limit instead of retrying each mailbox read', async status => {
    const fetchMock = vi.fn(async () => failure(status, 'rateLimitExceeded'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readGmailJson(token, 'messages')).rejects.toMatchObject({ statusCode: 429, code: 'GMAIL_RATE_LIMITED', retryAt: expect.any(String) });
    await expect(readGmailJson(token, 'profile')).rejects.toMatchObject({ code: 'GMAIL_RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    [400, 'badRequest', 'GMAIL_INVALID_REQUEST', 400],
    [401, 'authError', 'GMAIL_RECONNECT_REQUIRED', 401],
    [403, 'insufficientPermissions', 'GMAIL_PERMISSION_DENIED', 403],
    [403, 'domainPolicy', 'GMAIL_ADMIN_RESTRICTED', 403],
    [403, 'accessNotConfigured', 'GMAIL_API_UNAVAILABLE', 503],
    [404, 'notFound', 'GMAIL_NOT_FOUND', 404],
  ])('does not retry permanent %i %s failures', async (status, reason, code, expectedStatus) => {
    const fetchMock = vi.fn(async () => failure(status as number, reason as string));
    vi.stubGlobal('fetch', fetchMock);
    const error = await readGmailJson(token, 'messages').catch(error => error);
    expect(error).toMatchObject({ statusCode: expectedStatus, code });
    expect(error.message).not.toContain('private provider payload');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('returns a long provider cooldown without retrying early', async () => {
    const fetchMock = vi.fn(async () => failure(429, 'rateLimitExceeded', { 'Retry-After': '120' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readGmailJson(token, 'profile')).rejects.toMatchObject({ statusCode: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(mocks.delay).not.toHaveBeenCalled();
  });
  it('sanitizes network errors, including any sensitive transport details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret transport information')));
    const error = await readGmailJson(token, 'profile').catch(error => error);
    expect(error).toMatchObject({ statusCode: 503, code: 'GMAIL_READ_FAILED' });
    expect(error.message).not.toContain('secret');
  });
  it('caps simultaneous message reads at two and tolerates a message removed since listing', async () => {
    let inFlight = 0, peak = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('messages?')) return Response.json({ messages: Array.from({ length: 12 }, (_, i) => ({ id: String(i) })), nextPageToken: 'next-page' });
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      inFlight--;
      if (url.includes('/messages/3?')) return failure(404, 'notFound');
      return Response.json({ id: new URL(url).pathname.split('/').pop(), threadId: 'thread', labelIds: ['INBOX'], snippet: '', internalDate: '1790812800000', payload: { headers: [], mimeType: 'text/plain', body: {} } });
    }));
    const result = await fetchEmails('tenant', 'staff', { maxResults: 12 });
    expect(peak).toBe(2); expect(result.emails).toHaveLength(11); expect(result.nextPageToken).toBe('next-page');
  });
  it('preserves draft IDs when loading draft message details', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('drafts?')
      ? Response.json({ drafts: [{ id: 'draft-1', message: { id: 'message-1' } }] })
      : Response.json({ id: 'message-1', threadId: 'thread', labelIds: ['DRAFT'], internalDate: '1790812800000', payload: { headers: [] } })));
    expect((await fetchEmails('tenant', 'staff', { query: 'in:drafts' })).emails[0].draftId).toBe('draft-1');
  });
  it('uses the message endpoint when All conversations excludes drafts', async () => {
    const fetchMock = vi.fn(async () => Response.json({ messages: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchEmails('tenant', 'staff', { query: '-in:spam -in:trash -in:drafts' });
    expect(fetchMock.mock.calls[0][0]).toContain('/messages?');
  });
  it('shares the concurrency budget across different inbox and sync callers', async () => {
    let active = 0, peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return Response.json({ ok: true });
    }));
    await Promise.all(Array.from({ length: 12 }, (_, i) => readGmailJson(token, `messages/${i}`)));
    expect(peak).toBe(2);
  });
  it('coalesces identical in-flight reads but does not serve stale data on refresh', async () => {
    const fetchMock = vi.fn(async () => Response.json({ messages: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([readGmailJson(token, 'messages'), readGmailJson(token, 'messages')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await readGmailJson(token, 'messages');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('stops queued requests after a limit and keeps other accounts independent', async () => {
    const fetchMock = vi.fn(async () => failure(429, 'userRateLimitExceeded'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => readGmailJson(token, `messages/${i}`)));
    expect(result.every(item => item.status === 'rejected')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(async () => Response.json({ ok: true }));
    expect(await readGmailJson('other-' + token, 'messages')).toEqual({ ok: true });
  });
  it.each(['seconds', 'date'])('honors Retry-After in %s format, then resumes', async format => {
    let now = Date.parse('2026-10-01T14:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const until = now + 120000;
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(429, 'rateLimitExceeded', { 'Retry-After': format === 'seconds' ? '120' : new Date(until).toUTCString() })).mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readGmailJson(token, 'profile')).rejects.toMatchObject({ retryAt: new Date(until).toISOString() });
    now = until - 1;
    await expect(readGmailJson(token, 'messages')).rejects.toMatchObject({ statusCode: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now = until + 1;
    expect(await readGmailJson(token, 'messages')).toEqual({ ok: true });
  });
  it('increases the cooldown if Gmail remains limited', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.stubGlobal('fetch', vi.fn(async () => failure(429, 'rateLimitExceeded')));
    await expect(readGmailJson(token, 'profile')).rejects.toMatchObject({ retryAt: new Date(now + 60000).toISOString() });
    now += 60001;
    await expect(readGmailJson(token, 'profile')).rejects.toMatchObject({ retryAt: new Date(now + 120000).toISOString() });
  });
  it('returns the exact unread count without fetching message bodies', async () => {
    const fetchMock = vi.fn(async () => Response.json({ messagesUnread: 137 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchUnreadCount('tenant', 'staff')).toEqual({ unreadCount: 137 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/labels/INBOX?fields=messagesUnread');
  });
  it('exposes a safe retry time through the API error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failure(429, 'rateLimitExceeded', { 'Retry-After': '120' })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = await readGmailJson(token, 'profile').catch(error => error);
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    errorMiddleware(error, { path: '/gmail/emails', method: 'GET' } as Request, res as unknown as Response, vi.fn());
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'GMAIL_RATE_LIMITED', message: error.message, retryAt: error.retryAt } });
  });
});
