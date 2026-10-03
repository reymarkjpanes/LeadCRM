import { AppError } from '../../shared/errors/app-error';
import { EmployeeEmailSchema } from '@leadcrm/shared';

/** Applied at sign-in and on every session read, including existing sessions. */
export function requireEmployeeAccount(user: { role: string; email: string }) {
  // Historical accounts remain in storage, but can never establish or reuse a session.
  if (user.role.trim().toLowerCase() === 'guest') {
    throw new AppError('This account role has been retired. Contact your administrator.', 403, 'ROLE_RETIRED');
  }
  if (!EmployeeEmailSchema.safeParse(user.email).success) {
    throw new AppError('Use your Camxian employee account to access LeadCRM.', 403, 'EMPLOYEE_ACCOUNT_REQUIRED');
  }
}
