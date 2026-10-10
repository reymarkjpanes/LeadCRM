import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  db: { account: { findFirst: vi.fn(), update: vi.fn() }, activity: { create: vi.fn() }, auditLog: { create: vi.fn() } },
  reassign: vi.fn(), validateOwner: vi.fn(), transaction: vi.fn(),
}));
vi.mock('../../../config/database.config', () => ({ default: mocks.db }));
vi.mock('../leads/lead-automation.service', () => ({ salesTransaction: mocks.transaction, validateSalesOwner: mocks.validateOwner }));
vi.mock('./merge.repository', () => ({ reassignAccountRelationships: mocks.reassign }));
import { execute, preview } from './merge.service';
const input = { tenantId: 'tenant', userId: 'actor', entityType: 'account' as const, primaryId: 'primary', secondaryId: 'secondary', fieldResolutions: { name: 'secondary' as const } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(callback => callback(mocks.db));
  mocks.db.account.findFirst.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, name: where.id, isArchived: false }));
  mocks.db.account.update.mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data }));
  mocks.reassign.mockResolvedValue({ deals: 1 });
});
it('rejects merging the same Account before any reads or writes', async () => {
  await expect(preview({ ...input, secondaryId: 'primary' })).rejects.toThrow('different Accounts');
  await expect(execute({ ...input, secondaryId: 'primary' })).rejects.toThrow('different Accounts');
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.db.account.findFirst).not.toHaveBeenCalled();
});
it('checks both active records in the write transaction and rejects unavailable sources', async () => {
  mocks.db.account.findFirst.mockResolvedValueOnce(null);
  await expect(execute(input)).rejects.toThrow('Primary account');
  expect(mocks.db.account.findFirst).toHaveBeenCalledWith({ where: { id: 'primary', tenantId: 'tenant', isArchived: false, deletedAt: null } });
  expect(mocks.reassign).not.toHaveBeenCalled(); expect(mocks.db.account.update).not.toHaveBeenCalled();
});
it('merges, archives and records the audit in the same transaction', async () => {
  const result = await execute(input);
  expect(result).toMatchObject({ mergedRecord: { id: 'primary', name: 'secondary' }, archivedRecordId: 'secondary' });
  expect(mocks.db.account.update).toHaveBeenCalledWith({ where: { id: 'secondary', tenantId: 'tenant' }, data: { isArchived: true, deletedAt: expect.any(Date), deletedBy: 'actor' } });
  expect(mocks.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'account.merged', entityId: 'primary', tenantId: 'tenant' }) });
  expect(mocks.transaction).toHaveBeenCalledOnce();
});
it('rejects an unavailable secondary owner before relationship reassignment', async () => {
  mocks.db.account.findFirst.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, assignedUserId: where.id === 'primary' ? 'current' : 'inactive' }));
  mocks.validateOwner.mockRejectedValue(new Error('Assigned Agent is inactive'));
  await expect(execute({ ...input, fieldResolutions: { assignedUserId: 'secondary' } })).rejects.toThrow('Assigned Agent is inactive');
  expect(mocks.validateOwner).toHaveBeenCalledWith(mocks.db, 'tenant', 'inactive');
  expect(mocks.reassign).not.toHaveBeenCalled(); expect(mocks.db.account.update).not.toHaveBeenCalled();
});

it('clears an optional owner selected from an unassigned secondary Account', async () => {
  mocks.db.account.findFirst.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, name: where.id, assignedUserId: where.id === 'primary' ? 'current' : null }));
  await execute({ ...input, fieldResolutions: { assignedUserId: 'secondary' } });
  expect(mocks.db.account.update).toHaveBeenCalledWith({ where: { id: 'primary', tenantId: 'tenant' }, data: { assignedUserId: null } });
  expect(mocks.validateOwner).not.toHaveBeenCalled();
});
