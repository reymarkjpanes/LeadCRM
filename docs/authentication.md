# Authentication and onboarding

LeadCRM is an internally managed CRM for Camxian Technologies. PostgreSQL is the source of truth for account status, roles, password-change requirements, and onboarding. Existing bcrypt hashing, HttpOnly cookies, JWT verification, database sessions, tenant scoping, and RBAC remain in use.

See [security cleanup](security-cleanup-mfa.md) for password behavior and migration history.

## Supported flows

- Client Admin: sign in with employee email/password → change temporary password when required → informational LeadCRM onboarding when the workspace has not acknowledged it → dashboard.
- Returning Client Admin: sign in → dashboard.
- Users/custom roles: employee sign in → password change when required → CRM with their existing role permissions.

All tenant portal accounts use an exact, case-insensitive @camxian.com domain. Subdomains and suffix lookalikes are rejected. The backend checks the domain at password login and on every authenticated request, including existing sessions. Inactive accounts and suspended/rejected workspaces are denied access.

## Internal provisioning and passwords

Client Admin manages staff accounts through Team Management. There is no separate operator provisioning endpoint.

Tenant user management also marks provisioned passwords as temporary. When no password is supplied it generates a cryptographically random value; the employee must use password recovery to choose a password. No shared default password is embedded in frontend code.

User.mustChangePassword is persisted. Until cleared, authenticated tenant users can read /auth/me, change their password, or log out. Other protected APIs, including onboarding completion and preference endpoints, reject requests with PASSWORD_CHANGE_REQUIRED.

POST /auth/change-password accepts `{ password }` from the authenticated session. It enforces the existing shared strong-password policy, rejects password reuse, writes the new hash, clears the flag, revokes other sessions and account-bound reset tokens, and records an audit event in one serializable transaction. The current database session stays valid and the frontend applies the returned canonical user. Password recovery uses the same strength policy, clears the flag, and revokes sessions.

User update and bulk-update payloads have an explicit allowlist. They cannot inject mustChangePassword, passwordHash, or tenantId. Primary-role changes synchronize User.role and UserRole in the same transaction; custom permission definitions remain unchanged.

## Informational onboarding

The existing Tenant.onboardingCompletedAt and onboardingStep fields are reused. A Client Admin explicitly selects Continue to dashboard after reading about leads, customers/accounts, pipelines, tasks, and workflows. The backend stores the acknowledgment timestamp and completed step (3), without company setup, payments, documents, or role promotion.

Completion is workspace-wide, matching the existing data model. Additional Client Admins in an already acknowledged workspace do not repeat it. Existing completion timestamps are preserved; unfinished legacy steps all display the information page. Custom-role users are not required to perform Client Admin onboarding.

## Recovery and account provisioning

Tenant user accounts are provisioned by administrators through Team Management. The tenant-invitation flow and its token-based acceptance endpoint have been retired. Provisioned passwords are temporary when required, and users can establish their password through authenticated password change or password recovery.

Public signup, Google account sign-in, OTP, email-verification sessions, company setup, and old onboarding progress endpoints are disabled. Retired authentication bridge routes are unavailable. Gmail OAuth remains a separate CRM email integration.

## Deployment

Apply forward migrations with `npm --prefix backend run db:deploy`. See [retirement migration and validation](retired-features-cleanup.md). Existing passwordless accounts use password recovery or administrator provisioning.

The final role migration disables historical Guest accounts, revokes their sessions and any legacy pending invitations, and archives their role definitions without deleting identities, CRM data, assignments, or permissions. Only Client Admin is seeded as a predefined tenant role. There is no automatic User role: an administrator must select an existing custom role. Existing User definitions become editable custom roles with unchanged permissions. See [migration and verification](plans/final-role-model.md).

See [implementation and retirement inventory](plans/internal-camxian-crm.md) for affected files, preserved dependencies, and verification.
