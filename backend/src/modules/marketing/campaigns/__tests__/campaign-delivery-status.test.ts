import { describe, expect, it } from 'vitest';
import { deriveCampaignDeliveryStatus } from '../campaign-delivery-status';

const recipient = (status: string) => ({ status, failureReason: null,
  sentAt: ['sent', 'delivered'].includes(status) ? new Date() : null,
  deliveredAt: status === 'delivered' ? new Date() : null,
});
describe('authoritative campaign delivery snapshot', () => {
  it.each([
    ['SENDING', ['sent', 'sent', 'sent', 'delivered', 'delivered'], 'SENT'],
    ['SENT', ['sent', 'delivered', 'delivered', 'delivered', 'failed'], 'PARTIALLY_SENT'],
    ['SENT', Array(5).fill('delivered'), 'DELIVERED'],
    ['SENDING', Array(5).fill('failed'), 'FAILED'],
    ['SENDING', Array(5).fill('submitted'), 'SENDING'],
    ['SENDING', ['delivered', 'sent', 'submitted', 'unknown', 'pending'], 'SENDING'],
    ['SENDING', ['failed', 'failed', 'submitted', 'pending', 'pending'], 'SENDING'],
  ] as const)('%s with %j becomes %s', (status, rows, expected) => {
    expect(deriveCampaignDeliveryStatus({ status, recipientCount: 5 }, rows.map(recipient))).toBe(expected);
  });
  it('keeps an unstarted saved campaign Draft', () => {
    expect(deriveCampaignDeliveryStatus({ status: 'DRAFT', recipientCount: 0 }, [])).toBe('DRAFT');
  });
  it('ignores excluded rows and requires the complete frozen denominator', () => {
    const campaign = { status: 'SENT' as const, recipientCount: 5 };
    expect(deriveCampaignDeliveryStatus(campaign, [...Array(5).fill(recipient('delivered')), recipient('excluded')])).toBe('DELIVERED');
    expect(deriveCampaignDeliveryStatus(campaign, Array(4).fill(recipient('delivered')))).toBe('SENT');
  });
  it('does not infer delivery or sending from engagement, and preserves unproven history', () => {
    expect(deriveCampaignDeliveryStatus({ status: 'SENDING', recipientCount: 2 }, [recipient('opened'), recipient('clicked')])).toBe('SENDING');
    expect(deriveCampaignDeliveryStatus({ status: 'SENDING', recipientCount: 2 }, [recipient('opened')])).toBe('SENDING');
  });
  it('counts terminal failures even after sending or an unsubscribe overwrites the status', () => {
    const failed = { ...recipient('delivered'), status: 'unsubscribed', failureReason: 'HARD_BOUNCE' };
    expect(deriveCampaignDeliveryStatus({ status: 'SENT', recipientCount: 2 }, [recipient('sent'), failed])).toBe('PARTIALLY_SENT');
    expect(deriveCampaignDeliveryStatus({ status: 'SENT', recipientCount: 1 }, [failed])).toBe('FAILED');
  });
});
