import { beforeEach, expect, it, vi } from 'vitest';
const repo = vi.hoisted(() => ({ createCompany: vi.fn(), updateCompany: vi.fn(), findCompanyById: vi.fn() }));
vi.mock('./companies.repository', () => repo);
vi.mock('../../../core/audit/audit.service', () => ({ writeAuditLog: vi.fn(), buildChangeset: vi.fn(() => ({ before: {}, after: {} })) }));
import { createCompany, updateCompany } from './companies.service';
beforeEach(() => { vi.clearAllMocks(); repo.createCompany.mockResolvedValue({ id: 'account' }); repo.findCompanyById.mockResolvedValue({ id: 'account' }); repo.updateCompany.mockResolvedValue({ id: 'account' }); });
it('creates and edits without obsolete fields, stripping legacy input before persistence', async () => {
  const legacy = { name: 'Account', tags: [], country: 'Philippines', taxId: 'invalid', customerType: 'Prospect', customerSince: 'invalid' };
  await createCompany('tenant', 'user', legacy);
  expect(repo.createCompany).toHaveBeenCalledWith('tenant', { name: 'Account', tags: [], country: 'Philippines' });
  await updateCompany('account', 'tenant', 'user', legacy);
  expect(repo.updateCompany).toHaveBeenCalledWith('account', 'tenant', { name: 'Account', tags: [], country: 'Philippines' });
});
