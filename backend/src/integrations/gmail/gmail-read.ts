import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error';

type ReadState = { active: number; waiting: (() => void)[]; pending: Map<string, Promise<unknown>>; retryUntil: number; throttles: number; touchedAt: number };
const mailboxes = new Map<string, ReadState>();

function rateLimitError(state: ReadState) {
  return new AppError('Gmail is pausing mailbox updates. Updates will resume automatically.', 429, 'GMAIL_RATE_LIMITED', new Date(state.retryUntil).toISOString());
}

function retryDelay(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now()) || 0;
}

/** Share the read budget across the inbox, badge, threads and background sync.
 * Store token hashes only. Coalesce concurrent reads; never cache authorization or retry sends.
 */
export function readGmailJson<T>(accessToken: string, path: string): Promise<T> {
  const now = Date.now();
  for (const [key, value] of mailboxes) {
    if (!value.active && !value.pending.size && value.retryUntil <= now && now - value.touchedAt > 3600000) mailboxes.delete(key);
  }
  const key = createHash('sha256').update(accessToken).digest('hex');
  let state = mailboxes.get(key);
  if (!state) { state = { active: 0, waiting: [], pending: new Map(), retryUntil: 0, throttles: 0, touchedAt: now }; mailboxes.set(key, state); }
  state.touchedAt = now;
  const existing = state.pending.get(path);
  if (existing) return existing as Promise<T>;
  const mailbox = state;
  const request = (async () => {
    if (mailbox.retryUntil > Date.now()) throw rateLimitError(mailbox);
    // Reserve the slot before yielding so separate API handlers cannot exceed this limit.
    if (mailbox.active >= 2) await new Promise<void>(resolve => mailbox.waiting.push(resolve));
    else mailbox.active++;
    try {
      if (mailbox.retryUntil > Date.now()) throw rateLimitError(mailbox);
      return await performRead<T>(accessToken, path, mailbox);
    } finally {
      const next = mailbox.waiting.shift();
      if (next) next(); else mailbox.active--;
    }
  })().finally(() => { mailbox.pending.delete(path); mailbox.touchedAt = Date.now(); });
  mailbox.pending.set(path, request);
  return request;
}

async function performRead<T>(accessToken: string, path: string, state: ReadState): Promise<T> {
  const signal = AbortSignal.timeout(15000);
  try {
    for (let attempt = 0; ; attempt++) {
      if (state.retryUntil > Date.now()) throw rateLimitError(state);
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` }, signal,
      });
      if (response.ok) {
        if (state.retryUntil <= Date.now()) state.throttles = 0;
        return await response.json() as T;
      }
      const payload = await response.json().catch(() => ({})) as {
        error?: { errors?: { reason?: string }[]; details?: { reason?: string }[] };
      };
      const reasons = [...(payload.error?.errors ?? []), ...(payload.error?.details ?? [])].map(error => error.reason);
      const throttled = response.status === 429 || response.status === 403 && reasons.some(reason =>
        ['rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED'].includes(reason ?? ''));
      const temporary = throttled || [500, 502, 503, 504].includes(response.status);
      const retryAfter = retryDelay(response.headers.get('retry-after'));
      if (throttled) {
        // One provider limit pauses ALL queued reads instead of each read retrying independently.
        const cooldown = Math.max(retryAfter, Math.min(15 * 60000, 60000 * 2 ** state.throttles));
        state.throttles = Math.min(state.throttles + 1, 4);
        state.retryUntil = Math.max(state.retryUntil, Date.now() + cooldown);
        throw rateLimitError(state);
      }
      if (temporary && attempt < 2) {
        // Long provider cooldowns are returned to the caller instead of outliving the API proxy.
        if (!Number.isFinite(retryAfter) || retryAfter <= 5000) {
          await delay(Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, 1000 * 2 ** attempt + Math.random() * 250), undefined, { signal });
          continue;
        }
      }
      if (response.status === 400) throw new AppError('Gmail could not apply this search or page. Clear the search filters and reload the inbox.', 400, 'GMAIL_INVALID_REQUEST');
      if (response.status === 401) throw new AppError('Gmail access expired or was revoked. Reconnect your email in Messages.', 401, 'GMAIL_RECONNECT_REQUIRED');
      if (response.status === 403) {
        if (reasons.some(reason => ['accessNotConfigured', 'SERVICE_DISABLED'].includes(reason ?? ''))) {
          throw new AppError('Gmail API is unavailable for this OAuth project. Ask your administrator to check its API configuration.', 503, 'GMAIL_API_UNAVAILABLE');
        }
        if (reasons.includes('domainPolicy')) throw new AppError('Your Google Workspace policy blocks this Gmail request. Contact your Workspace administrator.', 403, 'GMAIL_ADMIN_RESTRICTED');
        throw new AppError('Google denied this Gmail request. Check the granted Gmail permissions and reconnect if needed.', 403, 'GMAIL_PERMISSION_DENIED');
      }
      if (response.status === 404) throw new AppError('This Gmail message or history page is no longer available.', 404, 'GMAIL_NOT_FOUND');
      throw new AppError('Gmail is temporarily unavailable. Try again shortly.', 502, 'GMAIL_UNAVAILABLE');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Gmail did not respond in time. Try again shortly.', 503, 'GMAIL_READ_FAILED');
  }
}
