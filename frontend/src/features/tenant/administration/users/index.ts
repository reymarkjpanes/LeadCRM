// Users module — barrel export
// Note: /administration/users now redirects to /settings?tab=users.
//       UsersPage is retained as a source file but is no longer a live route.
export { default as UsersPage } from './ui/users-page';

// Services — still active, used by DataContext
export { usersService } from './services/users.service';
