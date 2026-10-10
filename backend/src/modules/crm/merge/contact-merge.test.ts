import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  db: { contact: { findFirst: vi.fn(), update: vi.fn() }, activity: { create: vi.fn() }, auditLog: { create: vi.fn() } },
  reassign: vi.fn(), validateOwner: vi.fn(),
}));
vi.mock('../../../config/database.config', () => ({ default: mocks.db }));
vi.mock('../leads/lead-automation.service', () => ({ salesTransaction: async (callback: (tx: typeof mocks.db) => Promise<unknown>) => callback(mocks.db), validateSalesOwner: mocks.validateOwner }));
vi.mock('./merge.repository', () => ({ reassignContactRelationships: mocks.reassign }));
import { execute, preview } from './merge.service';
beforeEach(() => {
  vi.clearAllMocks(); mocks.db.contact.findFirst.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, firstName: where.id, lastName: 'Contact', status: 'WARM', company: where.id + ' company' }));
  mocks.validateOwner.mockResolvedValue({ id: 'valid-owner' });
  mocks.db.contact.update.mockImplementation(({ where, data }: any) => Promise.resolve({ ...data, id: where.id }));
  mocks.reassign.mockResolvedValue({ deals: 2 });
});

it('validates a selected secondary owner before moving relationships or writing records', async () => {
  mocks.db.contact.findFirst.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, assignedUserId: where.id === 'primary' ? 'current-owner' : 'unavailable-owner' }));
  mocks.validateOwner.mockRejectedValue(new Error('Assigned Agent is inactive'));
  await expect(execute({ tenantId: 'tenant', userId: 'actor', entityType: 'contact', primaryId: 'primary', secondaryId: 'secondary', fieldResolutions: { assignedUserId: 'secondary' } })).rejects.toThrow('Assigned Agent is inactive');
  expect(mocks.validateOwner).toHaveBeenCalledWith(mocks.db, 'tenant', 'unavailable-owner');
  expect(mocks.reassign).not.toHaveBeenCalled(); expect(mocks.db.contact.update).not.toHaveBeenCalled();
});

it('clears optional Account and Assigned Agent links when the empty secondary values are selected', async () => {
  mocks.db.contact.findFirst.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, accountId: where.id === 'primary' ? 'current-account' : null, assignedUserId: where.id === 'primary' ? 'current-owner' : null }));
  await execute({ tenantId: 'tenant', userId: 'actor', entityType: 'contact', primaryId: 'primary', secondaryId: 'secondary', fieldResolutions: { accountId: 'secondary', assignedUserId: 'secondary' } });
  expect(mocks.db.contact.update).toHaveBeenCalledWith({ where: { id: 'primary', tenantId: 'tenant' }, data: { accountId: null, assignedUserId: null } });
  expect(mocks.validateOwner).not.toHaveBeenCalled();
});

it('does not copy absent required identity fields from a legacy source', async () => {
  mocks.db.contact.findFirst.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, firstName: where.id === 'primary' ? 'Existing' : null, email: where.id === 'primary' ? 'existing@example.com' : null }));
  await execute({ tenantId: 'tenant', userId: 'actor', entityType: 'contact', primaryId: 'primary', secondaryId: 'secondary', fieldResolutions: { firstName: 'secondary', email: 'secondary' } });
  expect(mocks.db.contact.update).toHaveBeenCalledWith({ where: { id: 'primary', tenantId: 'tenant' }, data: {} });
});
it('merges canonical fields and archives the secondary without changing its customer status', async () => {
  const result = await execute({ tenantId: 'tenant', userId: 'actor', entityType: 'contact', primaryId: 'primary', secondaryId: 'secondary', fieldResolutions: { company: 'secondary' } });
  expect(result.archivedRecordId).toBe('secondary');
  expect(mocks.db.contact.findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant', id: 'primary', isArchived: false, deletedAt: null } });
  expect(mocks.db.contact.update).toHaveBeenCalledWith({ where: { id: 'primary', tenantId: 'tenant' }, data: { company: 'secondary company' } });
  expect(mocks.db.contact.update).toHaveBeenCalledWith({ where: { id: 'secondary', tenantId: 'tenant' }, data: { isArchived: true, deletedAt: expect.any(Date), deletedBy: 'actor' } });
  expect(mocks.db.auditLog.create).toHaveBeenCalledOnce();
});
it('rejects the same Contact and unavailable records before reassigning relationships', async () => {
  const input = { tenantId: 'tenant', userId: 'actor', entityType: 'contact' as const, primaryId: 'same', secondaryId: 'same', fieldResolutions: {} };
  await expect(execute(input)).rejects.toThrow(/different Contacts/);
  await expect(preview(input)).rejects.toThrow(/different Contacts/);
  mocks.db.contact.findFirst.mockResolvedValueOnce(null);
  await expect(execute({ ...input, secondaryId: 'secondary' })).rejects.toThrow(/Primary contact/);
  expect(mocks.reassign).not.toHaveBeenCalled(); expect(mocks.db.contact.update).not.toHaveBeenCalled();
});
