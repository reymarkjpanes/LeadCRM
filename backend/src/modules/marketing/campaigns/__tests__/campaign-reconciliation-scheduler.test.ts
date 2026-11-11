import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../../config/database.config', () => ({ default: { campaignContact: { findMany: vi.fn(async () => []) } } }));
vi.mock('../../../../shared/services/sms.service', () => ({ isSmsConfigured: () => false }));
vi.mock('../textbee-webhook', () => ({ applyTextBeeEvidence: vi.fn() }));
vi.mock('../campaign-delivery-status', () => ({ recalculateCampaignDelivery: vi.fn() }));
vi.mock('../sms-campaign-outcomes', () => ({ smsSent: vi.fn() }));
vi.mock('../brevo-status-reconciliation', () => ({ reconcileBrevoStatuses: vi.fn() }));
import { reconcileBrevoStatuses } from '../brevo-status-reconciliation';
import { startCampaignDeliveryReconciliation } from '../sms-status-reconciliation';

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); vi.restoreAllMocks(); });

it('resumes recovery after restart, rotates bounded batches and stops cleanly', async () => {
  vi.useFakeTimers();
  vi.mocked(reconcileBrevoStatuses).mockResolvedValueOnce('cursor').mockResolvedValue(undefined);
  const stop = startCampaignDeliveryReconciliation();
  await vi.advanceTimersByTimeAsync(60000);
  expect(reconcileBrevoStatuses).toHaveBeenNthCalledWith(1, undefined);
  await vi.advanceTimersByTimeAsync(60000);
  expect(reconcileBrevoStatuses).toHaveBeenNthCalledWith(2, 'cursor');
  await stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(reconcileBrevoStatuses).toHaveBeenCalledTimes(2);
  const stopRestarted = startCampaignDeliveryReconciliation();
  await vi.advanceTimersByTimeAsync(60000);
  expect(reconcileBrevoStatuses).toHaveBeenNthCalledWith(3, undefined);
  await stopRestarted();
});

it('does not overlap sweeps, drains in-flight work and retries failures on the next tick', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let finish!: () => void;
  vi.mocked(reconcileBrevoStatuses).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(undefined); }))
    .mockRejectedValueOnce(new Error('private provider failure')).mockResolvedValue(undefined);
  const stop = startCampaignDeliveryReconciliation();
  await vi.advanceTimersByTimeAsync(180000);
  expect(reconcileBrevoStatuses).toHaveBeenCalledTimes(1);
  finish(); await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60000);
  expect(console.warn).toHaveBeenCalledWith('[Campaigns]', { event: 'brevo_reconciliation_failed', category: 'persistence' });
  await vi.advanceTimersByTimeAsync(60000);
  expect(reconcileBrevoStatuses).toHaveBeenCalledTimes(3);
  await stop();
});

it('waits for its in-flight lookup during shutdown without starting more work', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  vi.mocked(reconcileBrevoStatuses).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(undefined); }));
  const stop = startCampaignDeliveryReconciliation();
  await vi.advanceTimersByTimeAsync(60000);
  let drained = false;
  const stopped = stop().then(() => { drained = true; });
  await vi.advanceTimersByTimeAsync(120000);
  expect(drained).toBe(false);
  expect(reconcileBrevoStatuses).toHaveBeenCalledTimes(1);
  finish(); await stopped;
  expect(drained).toBe(true);
});
