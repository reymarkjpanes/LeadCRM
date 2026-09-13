import { Permission } from '../../shared/constants/permissions';
import { Role } from '../../shared/constants/roles';

// Maps built-in roles to their default permission sets
// Used during tenant provisioning and role seeding
export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  [Role.USER]: [
    Permission.CONTACTS_VIEW,
    Permission.CONTACTS_CREATE,
    Permission.CONTACTS_EDIT,
    Permission.DEALS_VIEW,
    Permission.DEALS_CREATE,
    Permission.DEALS_EDIT,
    Permission.CAMPAIGNS_VIEW,
    Permission.REPORTS_VIEW,
  ],
};
