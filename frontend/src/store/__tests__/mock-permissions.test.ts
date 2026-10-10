import { expect, it } from 'vitest';
import { hasModulePermission } from '@leadcrm/shared';
import { MOCK_ROLES, MOCK_USERS } from '../mockData';
import { resolveMockPermissions } from '../mock-permissions';

it('gives mock Sales users their declared view permissions without admin actions', () => {
  const permissions = resolveMockPermissions(MOCK_USERS[1], MOCK_ROLES);
  expect(hasModulePermission(permissions, 'leads', 'canView')).toBe(true);
  expect(hasModulePermission(permissions, 'tasks', 'canView')).toBe(true);
  expect(hasModulePermission(permissions, 'leads', 'canDelete')).toBe(false);
  expect(hasModulePermission(permissions, 'users', 'canView')).toBe(false);
});
it('fails closed for another tenant, an unknown role or an archived role', () => {
  expect(resolveMockPermissions({ role: 'Sales', tenantId: 'other' }, MOCK_ROLES)).toEqual({});
  expect(resolveMockPermissions({ role: 'unknown', tenantId: 'tenant_demo' }, MOCK_ROLES)).toEqual({});
  expect(resolveMockPermissions(MOCK_USERS[1], MOCK_ROLES.map(role => ({ ...role, isArchived: true })))).toEqual({});
});
it('supports a custom manager fixture without accepting unknown permission names', () => {
  const permissions = resolveMockPermissions({ role: 'Manager', tenantId: 'tenant_demo' }, [{ ...MOCK_ROLES[1], name: 'Manager', permissions: ['leads.canView', 'leads.canEdit', 'users.canDelete', 'unknown.canView'] }]);
  expect(hasModulePermission(permissions, 'leads', 'canEdit')).toBe(true);
  expect(hasModulePermission(permissions, 'users', 'canDelete')).toBe(false);
  expect(permissions.unknown).toBeUndefined();
});
