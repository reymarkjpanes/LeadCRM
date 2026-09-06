/**
 * isSuperRole — returns true for roles that bypass RolePermission evaluation.
 *
 * The four super roles are: Admin, Super User, Client Admin, System Admin.
 * Admin and Super User were already treated as super roles before this helper existed.
 * This helper consolidates the pattern — it does NOT expand privileges.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL: Use this function for RBAC permission evaluation ONLY ║
 * ║  Do NOT use this inside environmentGate or any subscription /    ║
 * ║  access middleware.                                              ║
 * ║  environmentGate checks Role.SYSTEM_ADMIN exclusively —         ║
 * ║  Client Admin is subject to subscription state.                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
export function isSuperRole(role: string): boolean {
  const n = role.toLowerCase().replace(/[\s_\-]/g, '');
  return ['admin', 'superuser', 'clientadmin', 'systemadmin'].includes(n);
}
