/**
 * Canonical ordered list of CRM modules and which permission actions apply to each.
 * Used by the permission matrix UI and the backend seeding logic.
 * Spec 5 Phase B.
 */
import type { PermissionModuleDefinition } from '../types/roles';

export const PERMISSION_MODULES: PermissionModuleDefinition[] = [
  { key: 'dashboard',     label: 'Dashboard',           actions: ['canView'] },
  { key: 'contacts',      label: 'Contacts',            actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'accounts',      label: 'Accounts',            actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'deals',         label: 'Deals & Pipeline',    actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'tasks',         label: 'Tasks',               actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'campaigns',     label: 'Campaigns',           actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'workflows',     label: 'Workflows',           actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'settings',      label: 'Settings',            actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'users',         label: 'Users',               actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'roles',         label: 'Roles & Permissions', actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'reports',       label: 'Reports',             actions: ['canView'] },
  { key: 'billing',       label: 'Billing',             actions: ['canView', 'canCreate', 'canEdit', 'canDelete'] },
  { key: 'audit',         label: 'Audit Log',           actions: ['canView'] },
];
