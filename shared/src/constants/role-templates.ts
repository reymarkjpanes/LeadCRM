import { PERMISSION_MODULES, EMPTY_PERMISSION_FLAGS } from './permission-modules';
import type { PermissionFlags } from '../types/roles';
export interface RoleTemplate { key: string; name: string; description: string; permissions: Record<string, PermissionFlags>; }
const permissions = (modules: string[], edit = false): Record<string, PermissionFlags> => Object.fromEntries(
  PERMISSION_MODULES.filter(m => modules.includes(m.key)).map(m => [m.key, { ...EMPTY_PERMISSION_FLAGS, canView: true, canCreate: edit && m.actions.includes('canCreate'), canEdit: edit && m.actions.includes('canEdit') }]),
);
export const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: 'sales-manager', name: 'Sales Manager', description: 'CRM editing. Pipeline configuration and other privileged actions require explicit grants.', permissions: permissions(['dashboard','leads','contacts','accounts','deals','tasks'], true) },
  { key: 'sales-representative', name: 'Sales Representative', description: 'CRM read and write access.', permissions: permissions(['dashboard','leads','contacts','accounts','deals','tasks'], true) },
  { key: 'viewer', name: 'Viewer', description: 'Read-only CRM access.', permissions: permissions(['dashboard','leads','contacts','accounts','deals','tasks']) },
];
