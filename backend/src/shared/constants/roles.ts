// RBAC Role definitions — keep in sync with shared/src/constants/roles.ts
export const Role = {
  ADMIN:           'Admin',
  SUPER_USER:      'Super User',
  USER:            'User',
  RESTRICTED_USER: 'Restricted User',
  // Lifecycle roles
  CLIENT_ADMIN:    'Client Admin',  // Assigned after successful Stripe payment
  SYSTEM_ADMIN:    'System Admin',  // Platform operator — no subscription required
} as const;

export type RoleKey = typeof Role[keyof typeof Role];
