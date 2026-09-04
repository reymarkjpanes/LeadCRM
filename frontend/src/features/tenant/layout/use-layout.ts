'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { usePermissions, PERMISSION_BRIDGE } from '@/shared/hooks/use-permissions';
import { PATHNAME_TO_PATH, PATH_TO_PATHNAME } from '@/lib/route-map';
import {
  LayoutDashboard, Briefcase, Workflow, Mail, Settings,
  Receipt, Building2, CreditCard, Activity, ListTodo,
  UserCheck, Building, Target,
} from 'lucide-react';

export const NAV_ITEMS = [
  { name: 'Dashboard',         path: 'dashboard',         icon: LayoutDashboard, permission: null,             roles: null,          group: null },
  // ── CRM ─────────────────────────────────────────────
  { name: 'Leads',             path: 'leads',             icon: Target,          permission: 'contacts.view',  roles: null,          group: 'CRM' },
  { name: 'Contacts',          path: 'contacts',          icon: UserCheck,       permission: 'contacts.view',  roles: null,          group: 'CRM' },
  { name: 'Accounts',          path: 'accounts',          icon: Building,        permission: 'accounts.view',  roles: null,          group: 'CRM' },
  { name: 'Deals',             path: 'pipeline',          icon: Briefcase,       permission: 'deals.view',     roles: null,          group: 'CRM' },
  // ── Operations ──────────────────────────────────────
  { name: 'Tasks',             path: 'tasks',             icon: ListTodo,        permission: 'contacts.view',  roles: null,          group: 'Operations' },
  // ── Marketing ───────────────────────────────────────
  { name: 'Campaigns',         path: 'campaigns',         icon: Mail,            permission: 'campaigns.view', roles: null,          group: 'Marketing' },
  // ── Automation ──────────────────────────────────────
  { name: 'Workflows',         path: 'workflows',         icon: Workflow,        permission: 'workflows.view', roles: null,          group: 'Automation' },
  // ── Settings ────────────────────────────────────────
  // Single entry point for all configuration including Billing and Roles & Permissions.
  { name: 'Settings',          path: 'settings',          icon: Settings,        permission: 'settings.view',  roles: null,          group: 'Settings' },
  // ── System Admin (separate portal) ──────────────────
  { name: 'Dashboard',         path: 'admin-dashboard',   icon: LayoutDashboard, permission: null,             roles: ['System Admin'] as const, group: null },
  { name: 'Client Management', path: 'admin-clients',     icon: Building2,       permission: null,             roles: ['System Admin'] as const, group: null },
  { name: 'Pricing',           path: 'admin-pricing',     icon: CreditCard,      permission: null,             roles: ['System Admin'] as const, group: null },
  { name: 'Billing',           path: 'admin-billing',     icon: Receipt,         permission: null,             roles: ['System Admin'] as const, group: null },
  { name: 'Audit Trail',       path: 'audit-log',         icon: Activity,        permission: null,             roles: ['System Admin'] as const, group: null },
] as const;

type NavItem = (typeof NAV_ITEMS)[number];

export function useLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { isBillingModuleEnabled } = useData();
  const userPermissions = usePermissions();

  const currentPath = PATHNAME_TO_PATH[pathname] ?? 'dashboard';

  const navigate = (path: string) => {
    const target = PATH_TO_PATHNAME[path];
    if (target) router.push(target);
  };

  const isSuper = userPermissions.includes('*');
  const isSystemAdminUser = user?.role === 'System Admin' || user?.tenantId === 'system' || user?.tenantId === 'leadcrm-system-demo';

  const featureEnabled = (flag?: 'billing') => {
    if (!flag) return true;
    if (flag === 'billing') return isBillingModuleEnabled;
    return true;
  };

  const hasAccess = (item: NavItem): boolean => {
    if (!featureEnabled((item as any).featureFlag)) return false;

    const itemPath = (item as any).path as string;
    const itemRoles = (item as any).roles as string[] | null | undefined;

    if (isSystemAdminUser) return itemRoles?.includes('System Admin') ?? false;
    if (itemRoles?.includes('System Admin')) return false;
    if (itemRoles && !itemRoles.includes('System Admin')) {
      return itemRoles.includes(user?.role ?? '');
    }

    if (isSuper) return true;
    if (!item.permission) return true;
    const legacyIds = (PERMISSION_BRIDGE as Record<string, string[]>)[item.permission] ?? [];
    return userPermissions.includes(item.permission) || legacyIds.some(id => userPermissions.includes(id));
  };

  const filteredNav = NAV_ITEMS.filter(hasAccess);

  return { currentPath, navigate, filteredNav };
}
