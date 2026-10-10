import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  leads: { findContactById: vi.fn(), updateContact: vi.fn() },
  contacts: { findContactById: vi.fn(), updateContact: vi.fn() },
  accounts: { findCompanyById: vi.fn(), updateCompany: vi.fn() },
  deals: { findDealById: vi.fn(), updateDeal: vi.fn() },
  triggers: { fireLeadUpdated: vi.fn(), fireContactUpdated: vi.fn(), fireDealUpdated: vi.fn(), fireAccountUpdated: vi.fn(),
    fireLeadCreated: vi.fn(), fireLeadStatusChanged: vi.fn(), fireContactCreated: vi.fn(), fireContactStatusChanged: vi.fn(), fireDealCreated: vi.fn(), fireDealStageChanged: vi.fn() },
}));
vi.mock('../contacts/contacts.repository', () => mocks.leads);
vi.mock('../contacts-v2/contacts-v2.repository', () => mocks.contacts);
vi.mock('../companies/companies.repository', () => mocks.accounts);
vi.mock('../deals/deals.repository', () => mocks.deals);
vi.mock('../../automation/triggers/triggers.service', () => mocks.triggers);
vi.mock('../../../config/database.config', () => ({ default: {} }));
vi.mock('../../../core/audit/audit.service', () => ({ writeAuditLog: vi.fn(), buildChangeset: vi.fn(() => ({ before: {}, after: {} })) }));

import { recordChanges } from '../record-updates';
import { updateContact as updateLead } from '../contacts/contacts.service';
import { updateContact } from '../contacts-v2/contacts-v2.service';
import { updateCompany } from '../companies/companies.service';
import { updateDeal } from '../deals/deals.service';

const before = { id: 'record', tenantId: 'tenant', status: 'Warm', title: 'Deal', firstName: 'First', lastName: 'Last',
  email: 'old@example.test', phone: '123', name: 'Account', updatedAt: new Date('2026-10-01'), tags: [], country: 'Philippines' };
beforeEach(() => {
  vi.clearAllMocks();
  for (const repo of [mocks.leads, mocks.contacts]) repo.findContactById.mockResolvedValue(before);
  mocks.accounts.findCompanyById.mockResolvedValue(before); mocks.deals.findDealById.mockResolvedValue(before);
});
const paths = [
  { label: 'Lead', save: () => updateLead('record', 'tenant', 'actor', { phone: '+639123456789', email: 'new@example.test' }), update: mocks.leads.updateContact, emit: mocks.triggers.fireLeadUpdated },
  { label: 'Contact', save: () => updateContact('record', 'tenant', { phone: '+639123456789', email: 'new@example.test' }, 'actor'), update: mocks.contacts.updateContact, emit: mocks.triggers.fireContactUpdated },
  { label: 'Account', save: () => updateCompany('record', 'tenant', 'actor', { name: 'Updated account' }), update: mocks.accounts.updateCompany, emit: mocks.triggers.fireAccountUpdated },
  { label: 'Deal', save: () => updateDeal('record', 'tenant', 'actor', { title: 'Updated deal' }), update: mocks.deals.updateDeal, emit: mocks.triggers.fireDealUpdated },
];

describe.each(paths)('$label Updated events', ({ save, update, emit }) => {
  it('emits one event only after a real successful save, even when several fields change', async () => {
    const after = { ...before, phone: '+639123456789', email: 'new@example.test', updatedAt: new Date() };
    if (update === mocks.leads.updateContact) update.mockImplementation(async (...args) => { await args[5](before, after, recordChanges(before, after)); return after; });
    else update.mockResolvedValue(after);
    await save();
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant', actorId: 'actor', record: after,
      changedFields: ['email', 'phone'], changes: expect.objectContaining({ before: { email: before.email, phone: before.phone }, after: { email: after.email, phone: after.phone } }) }));
  });
  it('does not emit for a timestamp-only unchanged save', async () => {
    const after = { ...before, updatedAt: new Date() };
    if (update === mocks.leads.updateContact) update.mockImplementation(async (...args) => { await args[5](before, after, recordChanges(before, after)); return after; });
    else update.mockResolvedValue(after);
    await save();
    expect(emit).not.toHaveBeenCalled();
  });
  it('does not emit for a failed save', async () => {
    update.mockRejectedValue(new Error('Save failed'));
    await expect(save()).rejects.toThrow('Save failed');
    expect(emit).not.toHaveBeenCalled();
  });
});
