'use client';
import { useMemo } from 'react';
import { useAuth } from '@/store/AuthContext';
import { permissionKeys, type PermissionKey } from '@leadcrm/shared';

/** Live role grants fail closed while loading; no legacy IDs or action aliases. */
export function usePermissions(): string[] {
  const { user, permissions, isPermissionsLoaded } = useAuth();
  return useMemo(() => {
    if (!user) return [];
    if (user.role === 'Client Admin') return ['*'];
    return isPermissionsLoaded ? permissionKeys(permissions) : [];
  }, [user, permissions, isPermissionsLoaded]);
}
export function useHasPermission(permission: PermissionKey): boolean {
  const permissions = usePermissions();
  return permissions.includes('*') || permissions.includes(permission);
}
export function useCanAny(permissionList: PermissionKey[]): boolean {
  const permissions = usePermissions();
  return permissions.includes('*') || permissionList.some(p => permissions.includes(p));
}
