// Administration module — public API
// Note: UsersPage route (/administration/users) now redirects to /settings?tab=users.
//       UsersPage is kept for reference but should not be used as a navigation target.
export { default as AuditLogsPage } from './audit/ui/audit-logs-page';
export { default as UsersPage } from './users/ui/users-page';
