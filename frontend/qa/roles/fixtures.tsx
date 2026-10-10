import { PERMISSION_MODULES, permissionLabel } from '@leadcrm/shared';
export const useAuth = () => ({ tenant: { id: 'qa-only' }, userCan: () => true });
export const useData = () => ({
  roles: [{ id: 'qa-role', name: 'Sales Staff QA', description: 'In-memory browser fixture', isSystemRole: false, permissions: ['leads.canView','leads.canCreate','leads.canEdit'], userCount: 0 }],
  permissions: PERMISSION_MODULES.flatMap(module => module.actions.map(action => ({ id: `${module.key}.${action}`, category: module.key, name: permissionLabel(module, action), description: '' }))),
  rolesLoading: false, rolesError: '', users: [], refreshRoles: async () => {},
  addRole: async () => {}, updateRole: async () => {}, deleteRole: async () => {},
});
