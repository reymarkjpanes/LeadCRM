# First login and development test access

> Historical implementation report for `df476b63`. The owner's later instruction explicitly requests the two accounts in live production. See [current authentication policy](authentication.md#explicitly-approved-production-accounts) for the separate production allowlist and provisioning mode. The original checks and account status below describe the earlier development-only release.

## Implemented flow

Team Management → create User and selected existing role in one transaction → generate temporary credential → store bcrypt hash → submit branded welcome email → normal password login → mandatory password change → per-user informational onboarding → Dashboard with normal permissions.

| Requirement | Implementation |
| --- | --- |
| Temporary credential | `firstname.lastnameNN`, with lowercase normalized names and two digits from Node `crypto.randomInt`; no `Math.random` or shared default password. |
| Credential storage | Only the normal bcrypt hash enters `User.passwordHash`. Plaintext is transient mail content, excluded from normal API responses, browser storage, audit records, and logs. |
| User creation | Existing User/RoleDefinition/UserRole architecture, selected active custom role, atomic User/role/audit writes, `mustChangePassword=true`, onboarding incomplete. |
| Welcome email | Existing `sendMail()` and branded layout, subject `Welcome to LeadCRM`, own recipient credentials, login link from `APP_URL`, required first password change and privacy reminder. |
| Provider results | Only `submitted:true` produces a true submission flag. False, rejection, and network failure preserve the account and return a safe warning. Provider acceptance does not establish inbox delivery. |
| Mandatory setup | Existing login endpoint and database sessions; frontend routing and backend gates enforce password change before protected module access or onboarding. |
| Password form | Reuses Profile Settings' `PasswordChangeForm`, strength meter, visibility toggles, checklist, and shared `StrongPasswordSchema`. No Cancel or Skip on mandatory setup. |
| Password reuse | Backend compares the current hash before strength validation. Exact inline message: “You cannot reuse your temporary password. Please choose a new password.” |
| Confirmation | Mismatch is blocked locally with “Passwords do not match.” below Confirm New Password. |
| Password success | Hash updated; flag cleared; timestamp updated; other sessions and reset tokens invalidated; safe audit event. Toast: “Password updated successfully.” |
| Onboarding content | Eight steps: Welcome; Leads & Contacts; Accounts & Deals; Tasks & Activities; Campaigns & Email; Workflows; Forms & Products; Notifications & Search. |
| Onboarding layout | Blue branding/icon/progress panel and light information panel; segmented progress; stacked layout on small screens. |
| Next | Advances the informational step without completing server onboarding. |
| Skip / Finish | Both call the existing completion endpoint, persist `User.onboardingCompletedAt`, audit once, and apply the canonical auth response to reach Dashboard. |
| Later login | Completed user goes to the normal Dashboard; no repeated password setup or tour. |
| Established users | Migration backfills completion only where `mustChangePassword=false`. No existing passwords or role permissions are reset. |
| Forgot Password | Existing reset-link flow remains separate, establishes a strong password, revokes sessions, and still requires unfinished onboarding. |
| Development exception | Backend-only exact allowlist plus enabled flag plus explicit development/test mode. Wildcards, other Gmail users, disabled flag, production, and unknown environment names fail closed. |
| Provisioning / reissue | CLI-only action uses existing Client Admin role in the chosen test workspace; normalized duplicate checks; existing records preserved by default. Explicit `--reissue` creates a different temporary credential and revokes old sessions. |
| RBAC / Gmail | No extra permissions are granted by password change/onboarding. Gmail still uses real OAuth, existing scopes, session/state/ownership/token checks. |

See [authentication and provisioning instructions](authentication.md) for environment variables, migration, commands, and Google OAuth test-user requirements.

## Real account and email status

The last read-only query of the configured application database returned:

| Account | Existing User records | Real welcome email submission |
| --- | --- | --- |
| `tironjulieann10@gmail.com` | 0 | Not attempted |
| `reymarkjpanes@gmail.com` | 0 | Not attempted |

Neither account had a LeadCRM password in that database. The new flow does not assign `password123`.

The requested welcome URL is `https://lead-crm-frontend-pi.vercel.app/login`. The local backend configuration says development, but points at hosted storage, while `render.yaml` configures the hosted backend as production. The frontend URL does not identify a separate development database. The development backend/database still needs confirmation before provisioning these two real users, assigning their development Client Admin roles, applying a hosted migration, or sending real credentials.

Actual Brevo submission for either recipient, hosted first-login completion, real Google authorization for either mailbox, and live mailbox synchronization: **I cannot confirm this.** No real emails or Google tokens were created by the automated acceptance tests.

## Executed checks

- Backend auth, password, onboarding, exact-domain exception and OAuth-boundary suites: **176 passed**, 6 profile tests skipped in that run because they require the dedicated disposable account runner.
- Dedicated account runner (profile, organization, Team Management, reset email/recovery, roles, tenant isolation): **16 passed**, including those 6 profile tests.
- Frontend password, route guards and onboarding: **24 passed**.
- Mailbox synchronization and customer-engagement regression runner: **57 passed**.
- Workflow integration runner: **52 passed**.
- All-workspace TypeScript checks (`npm run lint`): **passed**.

The auth integration suite runs actual HTTP requests, Prisma, migrated disposable PostgreSQL, bcrypt, session persistence/revocation, audit records, and normal permission checks. It exercises both requested Gmail identities as disposable fixtures through temporary login, reuse rejection, strong password establishment, persisted onboarding, later login, disabled-flag rejection and production rejection. Only the mail-provider boundary is mocked; these fixture successes are not real Brevo delivery or hosted account provisioning.

Mailbox/workflow regressions exercise synchronization, reply engagement and configured Deal-stage actions with disposable data/provider fixtures. They verify that email engagement does not directly move Deal stages. They do not prove live Gmail synchronization for the two recipients.

Existing profile/organization integration fixtures were updated to supply valid Philippine phone numbers and bare domains under the repository's current validation rules. Invalid URL-style domains remain explicitly tested as rejected.

## Build and browser evidence

The final complete build (`npm run build`) passed: both backend and frontend build tasks succeeded. An earlier attempt encountered a Windows Prisma DLL lock from the running preview; stopping the preview resolved it. Earlier sandbox file/socket errors were resolved by rerunning the same checks outside the sandbox.

Login, mandatory Change Password, and onboarding were captured at 1366, 768, 390, 375 and 320 pixels. Their DOM widths did not exceed their viewport widths. Onboarding controls stayed usable at 320 pixels; all eight topics and segmented progress advanced with Next. Finish reached Dashboard, and reloading retained Dashboard access through the persisted server state. This browser run used a disposable real database and a synthetic account whose password had already been established. Password-change acceptance was executed in the backend/frontend test suites, not submitted through browser automation.

Manual `/dashboard` navigation from mandatory setup returned to `/change-password`. The backend and frontend suites separately verify that route manipulation cannot bypass password or onboarding gates, and that both Skip and Finish persist completion.

Screenshots are in [first-login-verification artifacts](../artifacts/first-login-verification/).

## Changed files

The implementation changes the existing backend account restriction, User schema/migration, canonical auth response, auth middleware/routes, password-change/reset and onboarding services, user creation and email service, Gmail readiness checks, frontend auth routing, reused password form, user creation feedback, and onboarding page/shell/content. New helpers cover temporary password generation, welcome submission and deliberate test-user provisioning. The shared auth contract documents the per-user completion state. Focused unit/integration fixtures and documentation are included. The exact file inventory is recorded with the commit.

## Remaining operational steps

1. Identify the approved development/test backend and database behind the welcome link.
2. Apply the forward migration there and provision each recipient using the documented CLI. Record each real provider submission result.
3. Each recipient changes their own temporary password and connects Gmail through Google.
4. For an External Google OAuth app in Testing, add both Gmail addresses as Google OAuth test users. Internal-only Google apps cannot authorize personal Gmail accounts.
5. Verify real mailbox sync/replies in the confirmed test environment. Disable `LEADCRM_TEST_AUTH_ENABLED` when official accounts are ready.

Production continues to require `@camxian.com`, regardless of the test flag.

## Exact source and documentation inventory

- `.env.example`
- `backend/package.json`
- `backend/prisma/migrations/20261104000000_user_first_login_onboarding/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/src/api/middleware/__tests__/auth-state.test.ts`
- `backend/src/api/middleware/auth.middleware.ts`
- `backend/src/api/routes/auth.routes.ts`
- `backend/src/core/auth/__tests__/account-access.test.ts`
- `backend/src/core/auth/__tests__/auth-test-db.ts`
- `backend/src/core/auth/__tests__/build-auth-user-response.unit.test.ts`
- `backend/src/core/auth/__tests__/change-password.service.test.ts`
- `backend/src/core/auth/__tests__/first-login.integration.test.ts`
- `backend/src/core/auth/__tests__/login.service.test.ts`
- `backend/src/core/auth/__tests__/onboarding.service.test.ts`
- `backend/src/core/auth/__tests__/profile.integration.test.ts`
- `backend/src/core/auth/__tests__/security.integration.test.ts`
- `backend/src/core/auth/__tests__/welcome-credentials.test.ts`
- `backend/src/core/auth/account-access.ts`
- `backend/src/core/auth/auth-user.ts`
- `backend/src/core/auth/change-password.service.ts`
- `backend/src/core/auth/onboarding.service.ts`
- `backend/src/core/auth/password-reset.service.ts`
- `backend/src/core/auth/provision-test-user.service.ts`
- `backend/src/core/auth/temporary-password.ts`
- `backend/src/core/auth/welcome-credentials.service.ts`
- `backend/src/database/scripts/provision-test-user.ts`
- `backend/src/integrations/gmail/mailbox-auth.service.ts`
- `backend/src/integrations/gmail/mailbox-ownership.test.ts`
- `backend/src/integrations/gmail/mailbox-sync.service.ts`
- `backend/src/integrations/gmail/mailbox.integration.test.ts`
- `backend/src/modules/administration/organization-settings/organization-settings.integration.test.ts`
- `backend/src/modules/administration/users/users-import.integration.test.ts`
- `backend/src/modules/administration/users/users.service.ts`
- `backend/src/modules/automation/workflows/__tests__/workflow.integration.test.ts`
- `backend/src/shared/services/email.service.ts`
- `backend/src/tests/security-preview.mjs`
- `docs/API.md`
- `docs/authentication.md`
- `docs/first-login-verification.md`
- `frontend/src/features/tenant/administration/users/services/users.service.ts`
- `frontend/src/features/tenant/auth/__tests__/change-password.test.tsx`
- `frontend/src/features/tenant/auth/ui/change-password-page.tsx`
- `frontend/src/features/tenant/onboarding/__tests__/onboarding-flow.test.tsx`
- `frontend/src/features/tenant/onboarding/ui/onboarding-content.ts`
- `frontend/src/features/tenant/onboarding/ui/onboarding-page.tsx`
- `frontend/src/features/tenant/onboarding/ui/onboarding-shell.tsx`
- `frontend/src/features/tenant/pages/modern-login-page.tsx`
- `frontend/src/features/tenant/settings/ui/password-change-form.tsx`
- `frontend/src/features/tenant/settings/ui/user-panel.tsx`
- `frontend/src/shared/auth/auth-routing.ts`
- `frontend/src/shared/providers/__tests__/auth-guard.lifecycle.test.tsx`
- `shared/src/contracts/auth.contract.ts`

The 17 JPEGs in `artifacts/first-login-verification/` record the responsive screens, final tour step, and completed Dashboard.
