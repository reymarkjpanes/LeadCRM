import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../roles.repository', () => ({ findRoleById: vi.fn(), findRoleByName: vi.fn(), createRole: vi.fn(), updateRoleMeta: vi.fn() }));
vi.mock('../../../../core/audit/audit.service', () => ({ writeAuditLog: vi.fn() }));
vi.mock('../../../../config/database.config', () => ({ default: {} }));
import * as repo from '../roles.repository';
import { createRole, updateRole } from '../roles.service';
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.findRoleById).mockResolvedValue({ id: 'r', name: 'Sales', isSystemRole: false } as never);
});
it.each(['Guest', 'GUEST', 'guest', 'Client Admin', 'client-admin'])('blocks creation and rename to reserved identity %s', async name => {
  await expect(createRole('t', 'u', { name, permissions: [] })).rejects.toThrow();
  await expect(updateRole('r', 't', 'u', { name })).rejects.toThrow();
  expect(repo.createRole).not.toHaveBeenCalled();
  expect(repo.updateRoleMeta).not.toHaveBeenCalled();
});
