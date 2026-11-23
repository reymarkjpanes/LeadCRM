import { beforeEach, expect, it, vi } from 'vitest';
const repo = vi.hoisted(() => ({ createCompany: vi.fn(), updateCompany: vi.fn(), findCompanyById: vi.fn() }));
vi.mock('./companies.repository', () => repo);
vi.mock('../../../config/database.config', () => ({
  default: { $transaction: vi.fn(async (work: (tx: object) => Promise<unknown>) => work({ account: { findMany: async () => [] } })) },
}));
vi.mock('../../../core/audit/audit.service', () => ({ writeAuditLog: vi.fn(), buildChangeset: vi.fn(() => ({ before: {}, after: {} })) }));
import { createCompany, updateCompany } from './companies.service';
beforeEach(() => { vi.clearAllMocks(); repo.createCompany.mockResolvedValue({ id: 'account' }); repo.findCompanyById.mockResolvedValue({ id: 'account' }); repo.updateCompany.mockResolvedValue({ id: 'account' }); });
it('creates and edits without obsolete fields, stripping legacy input before persistence', async () => {
  const legacy = { name: 'Account', country: 'Philippines', taxId: 'invalid', customerType: 'Prospect', customerSince: 'invalid' };
  await createCompany('tenant', 'user', legacy);
  expect(repo.createCompany).toHaveBeenCalledWith('tenant', { name: 'Account', address: undefined }, 'user');
  await updateCompany('account', 'tenant', 'user', legacy);
  expect(repo.updateCompany).toHaveBeenCalledWith('account', 'tenant', { name: 'Account', address: undefined }, 'user');
});

it.each(['tags', 'internalNotes'])('rejects retired native %s before persistence', async field => {
  await expect(createCompany('tenant', 'user', { name: 'Account', [field]: [] })).rejects.toThrow();
  await expect(updateCompany('account', 'tenant', 'user', { [field]: [] })).rejects.toThrow();
  expect(repo.createCompany).not.toHaveBeenCalled();
  expect(repo.updateCompany).not.toHaveBeenCalled();
});
