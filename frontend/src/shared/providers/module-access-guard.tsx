'use client';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/store/AuthContext';
import type { PermissionAction } from '@leadcrm/shared';

export function requiredRoutePermission(path: string): [string, PermissionAction] | null {
  if (path.startsWith('/settings') || path.startsWith('/help') || path === '/inbox' || path === '/notifications') return null;
  const mappings = [
    ['/dashboard','dashboard'], ['/reporting','dashboard'], ['/crm/leads','leads'], ['/crm/contacts','contacts'],
    ['/crm/accounts','accounts'], ['/crm/companies','accounts'], ['/crm/deals','deals'], ['/crm/pipeline','deals'],
    ['/operations/taskboard','tasks'], ['/marketing/campaigns','campaigns'], ['/campaigns','campaigns'],
    ['/automation/workflows','workflows'], ['/marketing/forms','forms'],
    ['/administration/users','users'], ['/administration/roles','roles'],
  ];
  const match = mappings.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
  if (!match) return null;
  const module = match[1];
  if (/\/imports?(\/|$)/.test(path)) return [module, module === 'deals' ? 'canCreate' : 'canImport'];
  if (path.endsWith('/new') || path.endsWith('/create')) return [module, 'canCreate'];
  return [module, 'canView'];
}
export function ModuleAccessGuard({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { userCan, isPermissionsLoaded, user } = useAuth();
  const required = requiredRoutePermission(path);
  if (required && !isPermissionsLoaded && user?.role !== 'Client Admin') return <p role="status">Loading permissions…</p>;
  if (required && !userCan(...required)) return <p role="alert" className="p-4">You do not have permission to access this module.</p>;
  return <>{children}</>;
}
