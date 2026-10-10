# Authentication and Account cleanup verification

Implemented September 30, 2026. Changes are local; no production migration or deployment was performed.

## Scope and preserved behavior

Removed the entire Two-Factor Authentication card, status, setup/QR/code/recovery controls, login challenge screen, API calls, proxy challenge-cookie handling, shared contracts and validators. Removed fake MFA entries from mock audit data and the legacy user timeline. Remaining settings keep their existing layout and password dialog.

Password authentication, bcrypt cost, persisted session validation, password change/reset, employee eligibility, email verification/registration OTP code, tenant isolation and RBAC remain. `User.passwordChangedAt` is preserved and exposed by the normal allowlisted auth response so the existing last-changed display survives removal of the separate status endpoint. Historical audit records are not deleted.

## Actual removed backend routes and code

All paths below were verified in the original auth router and have been removed:

| Method | Removed path |
| --- | --- |
| GET | `/api/v1/auth/mfa/status` |
| POST | `/api/v1/auth/mfa/setup` |
| POST | `/api/v1/auth/mfa/enable` |
| POST | `/api/v1/auth/mfa/verify` |
| POST | `/api/v1/auth/mfa/disable` |
| POST | `/api/v1/auth/mfa/recovery-codes/regenerate` |

Deleted `mfa.controller.ts`, `mfa.service.ts`, and `mfa-crypto.ts`. Removed the dedicated authenticated MFA limiter while keeping general, login, password-reset and email-verification rate limits. Password login still rechecks password hash, user status and tenant eligibility transactionally before creating its normal session.

## Exact database operations

New migration: [20261016000000_remove_two_factor_and_obsolete_account_fields](../backend/prisma/migrations/20261016000000_remove_two_factor_and_obsolete_account_fields/migration.sql). Its ordering follows the existing migration chain. No historical migration was edited.

Within `BEGIN` / `COMMIT`:

- `DROP TABLE "MfaChallenge"`: removes only its id, userId, tokenHash, expiresAt and attempts data; also its `MfaChallenge_pkey`, `MfaChallenge_tokenHash_key`, `MfaChallenge_userId_idx` and `MfaChallenge_userId_fkey`.
- `DROP TABLE "MfaRecoveryCode"`: removes only its id, userId and codeHash data; also its `MfaRecoveryCode_pkey`, `MfaRecoveryCode_userId_codeHash_key` and `MfaRecoveryCode_userId_fkey`.
- `ALTER TABLE "User" DROP COLUMN` for `mfaEnabled`, `mfaEnabledAt`, `mfaLastCounter`, `mfaPendingExpiresAt`, `mfaPendingSecretEncrypted`, `mfaSecretEncrypted`.
- `ALTER TABLE "Account" DROP COLUMN` for **taxId**, **customerType**, **customerSince**. All three were removed from the Account Prisma model and active dependencies.

No `CASCADE` drop is used. The dedicated tables own their foreign keys/indexes; no unrelated table references them. The obsolete Account columns have no dedicated relations/indexes in the schema. Prisma's before/after datamodel diff independently confirmed exactly these two tables, six User columns, and three Account columns as the schema delta.

Sessions, email-verification tokens, password-reset tokens, registration OTP tokens, password hashes, password-change dates, audit history and permission rows remain. Contact customerType/customerSince and unrelated Lead/Deal classification behavior remain unchanged.

## Account dependencies

Account create/update schemas already excluded these keys and strip unsupported input before persistence; this behavior remains. Obsolete fields no longer appear in Prisma Account reads or API responses. Removed Account writes in won-deal conversion, Account seeds, and legacy backfill/inventory scripts, plus obsolete tax-ID projections/types and merge labels. Product activation, relationships, other Account values, and Contact lifecycle updates remain.

Final source searches found no active 2FA code and no active dependency on these Account columns. Remaining terms occur in historical SQL, pre-migration fixtures, removal assertions/documentation, archived design material, and unrelated Contact/Lead/Deal fields. The pre-migration SQL fixture intentionally retains old columns so the drop is actually exercised.

## Packages and configuration

Removed backend `otpauth`, `qrcode`, and `@types/qrcode`; npm updated the lockfile and removed their unused transitive packages. Other package metadata was preserved.

Removed `MFA_ENCRYPTION_KEY` from the backend environment example and disposable preview configuration. It can be removed from Render/Vercel if configured there. Whether it exists in either remote environment: **I cannot confirm this.** No secret values were inspected or disclosed.

## Checks actually executed

- `npm --prefix backend run db:generate`: passed.
- Prisma `validate --schema prisma/schema.prisma`: passed.
- Prisma `migrate diff --from-schema-datamodel <original> --to-schema-datamodel backend/prisma/schema.prisma --script`: passed; scope matched the new migration.
- `npm run lint`: passed all three workspaces (TypeScript checks).
- `npm --prefix frontend run build`: passed again after final legacy Account projection/label cleanup.
- `npm run build`: passed both backend and frontend after retrying a Windows Prisma DLL lock and sandbox filesystem restriction. Next.js reported existing workspace-root and localhost API configuration warnings.
- Backend selected regression suite: **12 files, 117 tests passed**. Covers login, logout, password change/reset, sessions, verification, employee eligibility, middleware, Account validation, migration preservation, formerly enrolled login, and six removed routes returning 404. Initial canonical-auth-response failures were corrected to include the preserved password-change date; the final full selected run passed.
- Disposable sales database suite: **30 tests passed**, including won-deal conversion and Account persistence.
- Frontend auth/settings/Accounts/proxy regression selection: **10 files, 56 tests passed**.
- Additional help/settings/record-panel selection: **44 passed, 1 failed**. Failure: the unrelated Lead case in `panel-migrations.test.tsx` could not find its expected Deals button. Lead behavior was not changed to satisfy that test. A focused Account panel/full-page rerun passed (**1 passed, 20 intentionally filtered out**).
- `git diff --check`: passed.
- Browser: signed in with a disposable employee account through the real frontend proxy; dashboard loaded normally, Profile Settings displayed a single Password row with no blank card or separator, and the existing password dialog opened/closed. Inspected browser error/warning logs were empty. [Screenshot](security-settings-after.jpg).
- Browser Accounts: created `Cleanup Verification Account` with only its name, updated it to `Updated Verification Account` in the side panel, then opened its full-page details. All succeeded against the disposable migrated backend; the browser console remained free of errors/warnings. [Account screenshot](account-cleanup-after.jpg).

The migrated database test starts with populated old security data and compares all unrelated columns/rows in User, Account, Session, EmailVerificationToken, PasswordResetToken, RegistrationOtpToken, AuditLog and RolePermission immediately before/after the new migration. It also verifies Account create/update/list/detail without the removed properties, tenant rejection, and permission rejection.

## Limits and deployment

A full empty-database `prisma migrate deploy` replay initially stopped at an existing empty, untracked local folder `20260929000000_sales_automation` with no migration.sql. A retry using a temporary copy of the 69 actual SQL files encountered a local PGlite connection failure (P1001). No historical migrations were rewritten and the empty local directory was left untouched. Full migration-chain replay: **I cannot confirm this.** The new migration and subsequent auth/Account flows did pass on the populated disposable baseline.

Production schema, deployment, live email delivery, remote environment variables and production smoke behavior: **I cannot confirm this.** No configured development or production database was migrated. Deploy frontend/backend together with the forward migration through `npm --prefix backend run db:deploy` after reviewing the existing migration directory issue in the deployment checkout; old code must not serve requests against removed columns/tables.

## Files changed

- [docs/account-cleanup-after.jpg](account-cleanup-after.jpg)
- [backend/.env.example](../backend/.env.example)
- [backend/package.json](../backend/package.json)
- [backend/prisma/migrations/20261016000000_remove_two_factor_and_obsolete_account_fields/migration.sql](../backend/prisma/migrations/20261016000000_remove_two_factor_and_obsolete_account_fields/migration.sql)
- [backend/prisma/schema.prisma](../backend/prisma/schema.prisma)
- [backend/src/api/middleware/rate-limit.middleware.ts](../backend/src/api/middleware/rate-limit.middleware.ts)
- [backend/src/api/routes/auth.routes.ts](../backend/src/api/routes/auth.routes.ts)
- [backend/src/core/auth/__tests__/auth-test-db.ts](../backend/src/core/auth/__tests__/auth-test-db.ts)
- [backend/src/core/auth/__tests__/build-auth-user-response.unit.test.ts](../backend/src/core/auth/__tests__/build-auth-user-response.unit.test.ts)
- [backend/src/core/auth/__tests__/security-validation.test.ts](../backend/src/core/auth/__tests__/security-validation.test.ts)
- [backend/src/core/auth/__tests__/security.integration.test.ts](../backend/src/core/auth/__tests__/security.integration.test.ts)
- [backend/src/core/auth/auth-user.ts](../backend/src/core/auth/auth-user.ts)
- [backend/src/core/auth/auth.controller.ts](../backend/src/core/auth/auth.controller.ts)
- [backend/src/core/auth/auth.service.ts](../backend/src/core/auth/auth.service.ts)
- [backend/src/core/auth/change-password.service.ts](../backend/src/core/auth/change-password.service.ts)
- [backend/src/core/auth/mfa-crypto.ts](../backend/src/core/auth/mfa-crypto.ts)
- [backend/src/core/auth/mfa.controller.ts](../backend/src/core/auth/mfa.controller.ts)
- [backend/src/core/auth/mfa.service.ts](../backend/src/core/auth/mfa.service.ts)
- [backend/src/core/auth/password-reset.service.ts](../backend/src/core/auth/password-reset.service.ts)
- [backend/src/database/seeders/demo-full.seed.ts](../backend/src/database/seeders/demo-full.seed.ts)
- [backend/src/database/seeders/demo-rich.seed.ts](../backend/src/database/seeders/demo-rich.seed.ts)
- [backend/src/database/seeders/reymark.seed.ts](../backend/src/database/seeders/reymark.seed.ts)
- [backend/src/modules/administration/organization-settings/organization-settings.integration.test.ts](../backend/src/modules/administration/organization-settings/organization-settings.integration.test.ts)
- [backend/src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts](../backend/src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts)
- [backend/src/modules/crm/deals/won-conversion.service.ts](../backend/src/modules/crm/deals/won-conversion.service.ts)
- [backend/src/modules/crm/leads/sales-automation.integration.test.ts](../backend/src/modules/crm/leads/sales-automation.integration.test.ts)
- [backend/src/modules/operations/tasks/__tests__/tasks.integration.test.ts](../backend/src/modules/operations/tasks/__tests__/tasks.integration.test.ts)
- [backend/src/scripts/backfill-contact-account.ts](../backend/src/scripts/backfill-contact-account.ts)
- [backend/src/scripts/inventory-account-organization.ts](../backend/src/scripts/inventory-account-organization.ts)
- [backend/src/tests/security-preview.mjs](../backend/src/tests/security-preview.mjs)
- [docs/API.md](../docs/API.md)
- [docs/auth-account-cleanup-verification.md](../docs/auth-account-cleanup-verification.md)
- [docs/authentication.md](../docs/authentication.md)
- [docs/crm-record-detail-ui.md](../docs/crm-record-detail-ui.md)
- [docs/product-interest-account-cleanup-verification.md](../docs/product-interest-account-cleanup-verification.md)
- [docs/security-cleanup-mfa.md](../docs/security-cleanup-mfa.md)
- [docs/security-settings-after.jpg](../docs/security-settings-after.jpg)
- [docs/security/audit-log-strategy.md](../docs/security/audit-log-strategy.md)
- [docs/tasks-audit-and-plan.md](../docs/tasks-audit-and-plan.md)
- [frontend/app/api/proxy/[...path]/__tests__/proxy-cookie-forwarding.test.ts](../frontend/app/api/proxy/[...path]/__tests__/proxy-cookie-forwarding.test.ts)
- [frontend/app/api/proxy/[...path]/route.ts](../frontend/app/api/proxy/[...path]/route.ts)
- [frontend/src/features/tenant/administration/users/ui/users-page.tsx](../frontend/src/features/tenant/administration/users/ui/users-page.tsx)
- [frontend/src/features/tenant/auth/__tests__/mfa-login.test.tsx](../frontend/src/features/tenant/auth/__tests__/mfa-login.test.tsx)
- [frontend/src/features/tenant/auth/ui/mfa-login.tsx](../frontend/src/features/tenant/auth/ui/mfa-login.tsx)
- [frontend/src/features/tenant/crm/leads/ui/lead-detail-view.tsx](../frontend/src/features/tenant/crm/leads/ui/lead-detail-view.tsx)
- [frontend/src/features/tenant/help/content/index.ts](../frontend/src/features/tenant/help/content/index.ts)
- [frontend/src/features/tenant/help/content/settings.ts](../frontend/src/features/tenant/help/content/settings.ts)
- [frontend/src/features/tenant/pages/modern-login-page.tsx](../frontend/src/features/tenant/pages/modern-login-page.tsx)
- [frontend/src/features/tenant/settings/ui/__tests__/security-settings.test.tsx](../frontend/src/features/tenant/settings/ui/__tests__/security-settings.test.tsx)
- [frontend/src/features/tenant/settings/ui/security-settings.tsx](../frontend/src/features/tenant/settings/ui/security-settings.tsx)
- [frontend/src/lib/auth/cookies.ts](../frontend/src/lib/auth/cookies.ts)
- [frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx](../frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx)
- [frontend/src/shared/components/crm/merge-records-dialog.tsx](../frontend/src/shared/components/crm/merge-records-dialog.tsx)
- [frontend/src/shared/services/auth.api.ts](../frontend/src/shared/services/auth.api.ts)
- [frontend/src/store/AuthContext.tsx](../frontend/src/store/AuthContext.tsx)
- [frontend/src/store/DataContext.tsx](../frontend/src/store/DataContext.tsx)
- [frontend/src/store/types/contact.types.ts](../frontend/src/store/types/contact.types.ts)
- [frontend/src/store/types/lead.types.ts](../frontend/src/store/types/lead.types.ts)
- [frontend/src/store/types/user.types.ts](../frontend/src/store/types/user.types.ts)
- [package-lock.json](../package-lock.json)
- [shared/src/contracts/auth.contract.ts](../shared/src/contracts/auth.contract.ts)
- [shared/src/validation/account.schema.js](../shared/src/validation/account.schema.js)
- [shared/src/validation/account.schema.ts](../shared/src/validation/account.schema.ts)
- [shared/src/validation/index.js](../shared/src/validation/index.js)
- [shared/src/validation/index.ts](../shared/src/validation/index.ts)
- [shared/src/validation/security.schema.js](../shared/src/validation/security.schema.js)
- [shared/src/validation/security.schema.ts](../shared/src/validation/security.schema.ts)
