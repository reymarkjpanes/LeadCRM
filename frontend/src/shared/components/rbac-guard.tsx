'use client';

import type { PermissionKey } from '@leadcrm/shared';
import { useHasPermission, useCanAny } from '@/shared/hooks/use-permissions';

interface RbacGuardProps {
  /** Single permission required */
  permission?: PermissionKey;
  /** Any of these permissions is sufficient */
  anyOf?: PermissionKey[];
  /** Rendered when access is granted */
  children: React.ReactNode;
  /** Optional fallback when access is denied (defaults to null) */
  fallback?: React.ReactNode;
}

/**
 * RbacGuard — declarative permission wrapper.
 *
 * Renders children only when the current user has the required permission.
 *
 * Usage:
 *   <RbacGuard permission="contacts.create">
 *     <Button>New Contact</Button>
 *   </RbacGuard>
 *
 *   <RbacGuard anyOf={['contacts.edit', 'contacts.archive']}>
 *     <ActionMenu />
 *   </RbacGuard>
 */
export function RbacGuard({ permission, anyOf, children, fallback = null }: RbacGuardProps) {
  const hasSingle = useHasPermission(permission ?? 'contacts.view');
  const hasAny    = useCanAny(anyOf ?? []);

  // If neither prop is provided, render children (guard not applied)
  if (!permission && (!anyOf || anyOf.length === 0)) return <>{children}</>;

  const allowed = permission ? hasSingle : hasAny;
  return allowed ? <>{children}</> : <>{fallback}</>;
}
