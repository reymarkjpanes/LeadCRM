import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../../config/database.config', () => ({ default: {
  campaignContact: { findMany: vi.fn() }, emailDeliveryLog: { findFirst: vi.fn() },
} }));
vi.mock('../../../../shared/services/email.service', () => ({ isBrevoConfigured: () => true }));
vi.mock('../brevo-webhook', async importOriginal => ({ ...await importOriginal<object>(), processBrevoEvent: vi.fn() }));
import prisma from '../../../../config/database.config';
import { processBrevoEvent } from '../brevo-webhook';
import { reconcileBrevoStatuses } from '../brevo-status-reconciliation';

const now = new Date('2026-11-11T06:30:00Z');
const rows = Array.from({ length: 6 }, (_, i) => ({ id: `row-${i}`, tenantId: 'tenant', campaignId: 'campaign',
  email: `recipient-${i}@example.test`, messageId: `<message-${i}@example.test>`, submittedAt: new Date(+now - 600000) }));
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(prisma.emailDeliveryLog.findFirst).mockResolvedValue({ id: 'delivery-log' } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

it('rotates more than one batch without abandoning pending messages or exceeding five lookups', async () => {
  vi.mocked(prisma.campaignContact.findMany).mockResolvedValueOnce(rows.slice(0, 5) as never)
    .mockResolvedValueOnce(rows.slice(5) as never).mockResolvedValueOnce(rows.slice(0, 5) as never);
  const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ events: [] }));
  expect(await reconcileBrevoStatuses(undefined, now)).toBe('row-4');
  expect(provider).toHaveBeenCalledTimes(5);
  expect(await reconcileBrevoStatuses('row-4', now)).toBeUndefined();
  expect(vi.mocked(prisma.campaignContact.findMany).mock.calls[1][0]?.where).toMatchObject({ id: { gt: 'row-4' } });
  expect(provider).toHaveBeenCalledTimes(6);
  await reconcileBrevoStatuses(undefined, now);
  expect(provider).toHaveBeenCalledTimes(11);
  expect(console.info).toHaveBeenCalledWith('[Campaigns]', expect.objectContaining({
    event: 'brevo_reconciliation_sweep', selected: 5, checked: 5, failures: 0, hasMore: true, deferred: false,
  }));
  for (const [input, init] of provider.mock.calls) {
    expect(init?.method).toBe('GET'); expect(init?.signal).toBeDefined();
    expect(new URL(String(input)).searchParams.get('limit')).toBe('5000');
  }
});

it.each([401, 403, 429, 503])('reports HTTP %s deferral and retries the same eligible batch on the next sweep', async status => {
  vi.mocked(prisma.campaignContact.findMany).mockResolvedValue([rows[1]] as never);
  const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status }))
    .mockResolvedValueOnce(Response.json({ events: [] }));
  expect(await reconcileBrevoStatuses('row-0', now)).toBe('row-0');
  expect(console.info).toHaveBeenCalledWith('[Campaigns]', expect.objectContaining({
    event: 'brevo_reconciliation_sweep', checked: 1, failures: 1, deferred: true,
  }));
  await reconcileBrevoStatuses('row-0', now);
  expect(provider).toHaveBeenCalledTimes(2);
  expect(console.info).toHaveBeenLastCalledWith('[Campaigns]', expect.objectContaining({ failures: 0, deferred: false }));
});

it('reports truncated and unmatched history without fabricating receipts', async () => {
  vi.mocked(prisma.campaignContact.findMany).mockResolvedValue([rows[0]] as never);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ events: Array(5000).fill({
    messageId: 'another-message', email: rows[0].email, event: 'delivered', date: now.toISOString(),
  }) }));
  await reconcileBrevoStatuses(undefined, now);
  expect(console.warn).toHaveBeenCalledWith('[Campaigns]', expect.objectContaining({ event: 'brevo_history_truncated' }));
  expect(console.warn).toHaveBeenCalledWith('[Campaigns]', expect.objectContaining({ event: 'brevo_history_unmatched' }));
  expect(processBrevoEvent).not.toHaveBeenCalled();
});
