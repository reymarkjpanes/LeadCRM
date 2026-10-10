import { describe, expect, it } from 'vitest';
import { recordChanges } from '../record-updates';

describe('actual record changes', () => {
  it('ignores save metadata, relation projections, date serialization and reordered selections', () => {
    const before = { id: 'lead', status: 'Warm', updatedAt: new Date(0), updatedById: 'a',
      expectedCloseDate: new Date('2026-10-01'), tags: ['A', 'B'], assignedUser: { id: 'a', email: 'a@example.test' } };
    expect(recordChanges(before, { ...before, updatedAt: new Date(), updatedById: 'b',
      expectedCloseDate: '2026-10-01T00:00:00.000Z', tags: ['B', 'A', 'A'], assignedUser: { id: 'a' } }).changedFields).toEqual([]);
  });
  it('reports one change set for multiple editable values, including explicit clearing', () => {
    expect(recordChanges({ phone: '123', status: 'Warm', closingValues: { value: 0 } },
      { phone: '', status: 'Hot', closingValues: { value: 1200 } })).toEqual({
      changedFields: ['phone', 'status', 'closingValues'],
      before: { phone: '123', status: 'Warm', closingValues: { value: 0 } },
      after: { phone: '', status: 'Hot', closingValues: { value: 1200 } },
    });
  });
  it('compares associated record IDs rather than loaded junction details', () => {
    const before = { leadDeals: [{ leadId: '1', lead: { firstName: 'A' } }], contactDeals: [] };
    expect(recordChanges(before, { leadDeals: [{ leadId: '1' }], contactDeals: [] }).changedFields).toEqual([]);
    expect(recordChanges(before, { leadDeals: [{ leadId: '2' }], contactDeals: [] }).changedFields).toEqual(['leadIds']);
  });
});
