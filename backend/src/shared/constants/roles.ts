// RBAC Roles — defined once, imported by both frontend and backend
// Adding a new role: add it here only. Code elsewhere stays the same.
export const Role = {
  USER:         'User',
  GUEST:        'Guest',        // Sandbox/pre-subscription role assigned at registration
  CLIENT_ADMIN: 'Client Admin', // Assigned after successful subscription payment — super role
  SYSTEM_ADMIN: 'System Admin', // Platform operator — independent of subscriptions — super role
} as const;

export type RoleKey = (typeof Role)[keyof typeof Role];
