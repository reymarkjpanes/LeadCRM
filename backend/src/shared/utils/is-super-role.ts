/**
 * isSuperRole — returns true for roles that bypass RolePermission evaluation.
 *
 * The four super roles: Admin, Super User, Client Admin, System Admin.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL: Use for RBAC permission evaluation ONLY.             ║
 * ║  Do NOT use inside subscriptionGate / environmentGate.          ║
 * ║  Client Admin is subject to subscription state —                ║
 * ║  only System Admin bypasses the subscription/environment gate.  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
export function isSuperRole(role: string): boolean {
  const n = role.toLowerCase().replace(/[\s_\-]/g, '');
  return ['admin', 'superuser', 'clientadmin', 'systemadmin'].includes(n);
}
