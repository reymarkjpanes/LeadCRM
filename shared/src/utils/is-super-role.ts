/**
 * isSuperRole — returns true for roles that bypass RolePermission evaluation.
 *
 * The two super roles are: Client Admin, System Admin.
 * Client Admin is assigned after successful subscription payment.
 * System Admin is the platform operator, independent of subscriptions.
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
  return ['clientadmin', 'systemadmin'].includes(n);
}
