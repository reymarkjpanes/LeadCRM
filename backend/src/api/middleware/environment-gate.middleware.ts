/**
 * environmentGate — enforces subscription-based production access.
 *
 * This is a named re-export of subscriptionGate with explicit documentation
 * of the Guest lifecycle security model.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL: isSuperRole() and environmentGate are SEPARATE        ║
 * ║  concerns — do NOT merge them.                                   ║
 * ║                                                                  ║
 * ║  isSuperRole()     → RBAC permission evaluation bypass           ║
 * ║                      (Admin, Super User, Client Admin,           ║
 * ║                       System Admin all bypass RolePermission)    ║
 * ║                                                                  ║
 * ║  environmentGate   → subscription/production entitlement         ║
 * ║                      System Admin bypasses.                      ║
 * ║                      Client Admin, Admin, Super User are ALL     ║
 * ║                      subject to subscription state.              ║
 * ║                      A newly registered Client Admin (founding   ║
 * ║                      user) starts on a SANDBOX/NONE tenant.     ║
 * ║                      They must subscribe before accessing        ║
 * ║                      production CRM data.                        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Access policy (delegated to subscriptionGate):
 *   System Admin           → bypass (platform operator)
 *   ACTIVE subscription    → full access
 *   NONE (sandbox/guest)   → GET passes, mutations → 403 SUBSCRIPTION_REQUIRED
 *   PAST_DUE               → GET passes, mutations → 402 PAYMENT_REQUIRED
 *   CANCELLED / EXPIRED    → GET passes, mutations → 402 PAYMENT_REQUIRED
 *
 * Usage (same as subscriptionGate):
 *   router.use(authMiddleware, tenantMiddleware, environmentGate, authorize(...), controller);
 */
export { subscriptionGate as environmentGate } from './subscription-gate.middleware';
