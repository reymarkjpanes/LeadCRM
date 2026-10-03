'use client';

import { useRouter, usePathname } from 'next/navigation';
import { usePermissions } from '@/shared/hooks/use-permissions';
import { resolveModulePath, PATH_TO_PATHNAME } from '@/lib/route-map';
import {
  LayoutDashboard, Briefcase, Workflow, Mail, Settings,
  ListTodo,
  UserCheck, Building, Target,
} from 'lucide-react';

export const NAV_ITEMS = [
  { name: 'Dashboard',         path: 'dashboard',         icon: LayoutDashboard, permission: 'dashboard.view',             roles: null,          group: null },
  // ── CRM ─────────────────────────────────────────────
  { name: 'Leads',             path: 'leads',             icon: Target,          permission: 'leads.view',  roles: null,          group: 'CRM' },
  { name: 'Contacts',          path: 'contacts',          icon: UserCheck,       permission: 'contacts.view',  roles: null,          group: 'CRM' },
  { name: 'Accounts',          path: 'accounts',          icon: Building,        permission: 'accounts.view',  roles: null,          group: 'CRM' },
  { name: 'Deals',             path: 'pipeline',          icon: Briefcase,       permission: 'deals.view',     roles: null,          group: 'CRM' },
  // ── Operations ──────────────────────────────────────
  { name: 'Tasks',             path: 'tasks',             icon: ListTodo,        permission: 'tasks.view',  roles: null,          group: 'Operations' },
  // ── Marketing ───────────────────────────────────────
  { name: 'Campaigns',         path: 'campaigns',         icon: Mail,            permission: 'campaigns.view', roles: null,          group: 'Marketing' },
  // ── Automation ──────────────────────────────────────
  { name: 'Workflows',         path: 'workflows',         icon: Workflow,        permission: 'workflows.view', roles: null,          group: 'Automation' },
  // ── Settings ────────────────────────────────────────
  // Single entry point for all configuration including Roles & Permissions.
  { name: 'Settings',          path: 'settings',          icon: Settings,        permission: null,  roles: null,          group: 'Settings' },
] as const;

type NavItem = (typeof NAV_ITEMS)[number];

export function useLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const userPermissions = usePermissions();

  const currentPath = resolveModulePath(pathname);

  const navigate = (path: string) => {
    const target = PATH_TO_PATHNAME[path];
    if (target) router.push(target);
  };

  const isSuper = userPermissions.includes('*');

  const hasAccess = (item: NavItem): boolean => {

    if (isSuper) return true;
    if (!item.permission) return true;
    return userPermissions.includes(item.permission);
  };

  const filteredNav = NAV_ITEMS.filter(hasAccess);

  return { currentPath, navigate, filteredNav };
}
