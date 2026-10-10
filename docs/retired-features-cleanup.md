# Obsolete admin, authentication, and document feature removal

Verified on 2026-10-03 against the repository, generated Prisma Client, disposable migrated databases, and the configured application database. The application builds were not deployed during this work.

## System Admin implementation and removal

The application used a string primary role on `User`, with tenant-scoped `RoleDefinition`, `RolePermission`, and `UserRole` records. It also contained a separate, unused `SystemAdmin` model/table. The inspected database had 18 users, including two users whose primary role was `System Admin`; the separate table was empty and there were no matching role definitions.

Removed the operator frontend under `frontend/src/features/system-admin` and `frontend/app/(system-admin)`, its dashboard and tenant-management pages, navigation, quick-login/mock identities, role badges/options, cross-tenant state, routing, and permission exceptions. Removed the backend `admin.routes.ts`, `system-admin.middleware.ts`, `modules/system-admin/tenants` controllers/DTOs/services, role constants/checks, startup seeding, `demo.seed.ts`, `run-seed.ts`, `seedAdmin`, and the obsolete operator verification script. Shared role/permission contracts and test fixtures were updated together.

The forward migration retained both users in their original tenants, changed their primary roles to `Client Admin`, created/reused tenant-local Client Admin role definitions, synchronized their `UserRole` assignments, required a password change, and revoked sessions carrying the old authority. All 18 user IDs, tenant IDs, and statuses survived. No user was deleted or moved. The existing employee-domain policy now applies uniformly; neither legacy external-email operator gains an employee-login bypass. Normal Client Admin and staff roles retain their behavior.

The migration removes old operator role junctions/permissions before deleting obsolete role definitions, and removes the retired `admin` permission module. A post-migration query found zero missing or cross-tenant user-role references. On another installation, the migration deliberately fails and rolls back if `SystemAdmin` contains unmapped standalone identities.

## Administrative Audit Trail UI and preserved history

Removed these frontend files and their imports/navigation:

- `frontend/app/(tenant)/administration/audit/page.tsx`
- `frontend/app/(system-admin)/admin/audit/page.tsx`
- `frontend/src/features/tenant/administration/audit/index.ts`
- `frontend/src/features/tenant/administration/audit/services/audit.service.ts`
- `frontend/src/features/tenant/administration/audit/ui/audit-logs-page.tsx` and its exclusive test

The removed page contained the administrative cards, charts, filters, and CSV export. Settings and the command palette no longer expose it.

The dependency trace found two distinct retained history consumers:

- Record Activity tabs use `record-timeline-tab.tsx`, `email-activity.tsx`, `use-record-activities.ts`, the CRM activity service, `/crm/activities`, and record relationship endpoints. `backend/src/modules/crm/activities` and the existing email, task, status, and workflow event producers remain.
- Team Management's `TimelineDrawer` in `team-management-users.tsx` calls the shared `auditApi.list`. Therefore `/administration/audit`, `backend/src/modules/administration/audit`, `backend/src/core/audit/audit.service.ts`, the shared frontend `audit.api.ts`, and the tenant-scoped `audit.view` permission remain. The permission label now describes User Activity.

`Activity`, `AuditLog`, `DealStageHistory`, task and workflow history, and Gmail email history are preserved. Only the operator-specific `/admin` endpoints were removed; the shared tenant audit endpoint was not deleted.

## Exact model boundaries

- **TenantDocument:** its business-document upload implementation was already retired and its Prisma model ignored. Removed the remaining model, `Tenant.documents` relation, stored table, and obsolete operator/business verification metadata. No current upload controller or DTO depended on it. `RecordFile`, record Files UI/routes/services, and record object storage remain.
- **RegistrationOtpToken:** removed the model, registration OTP generation/verification/resend and delivery helpers, email templates, DTOs, controller exports, registration-only email preflight helper, tests/mocks, and the dead `/register` route. Password login/recovery and change-password mechanisms remain.
- **OAuthAccount:** confirmed it linked identity providers to application users and was separate from Gmail. Removed the model, `User.oauthAccounts`, login OAuth controller/service, Google identity verification service and tests, dead frontend Google login method, profile-completion redirect, obsolete setup scripts, and `google-auth-library` dependency. No enabled Continue with Google button remained before this change; its dead authentication support is now removed.
- **VerificationToken:** confirmed the exact unused NextAuth-style model, separate from `EmailVerificationToken`. Removed it, the obsolete NextAuth route stub/test and dependency, and NextAuth environment/build settings. `PasswordResetToken`, `EmailVerificationToken`, their security behavior, and existing cookie/session authentication remain.

Gmail code under `backend/src/integrations/gmail`, the inbox frontend/service, `EmailAccount`, `MailboxOAuthState`, `MailboxMessage`, encryption, Gmail access/refresh token persistence, sending, synchronization, and the optional Gmail system-sender seed remain. Gmail OAuth still connects staff work email; it does not sign users into LeadCRM.

## Forward migration and actual database result

Migration: [`20261025000000_remove_system_admin_and_legacy_auth_documents`](../backend/prisma/migrations/20261025000000_remove_system_admin_and_legacy_auth_documents/migration.sql).

The following command was executed successfully against the configured database:

```text
npm --prefix backend run db:deploy
```

Prisma applied the single pending cleanup migration. `_prisma_migrations.finished_at` records `2026-10-03T05:54:46.937Z`. Post-migration inspection confirmed all five tables and the retired Tenant columns are absent. No reset, DROP SCHEMA, reseed, or CASCADE was used.

| Dropped table/model | Rows before removal | Removed local indexes |
| --- | ---: | --- |
| TenantDocument | 14 | `TenantDocument_pkey`, `TenantDocument_tenantId_documentKey_key`, `TenantDocument_tenantId_status_idx` |
| RegistrationOtpToken | 6 | `RegistrationOtpToken_pkey`, `RegistrationOtpToken_email_key` |
| OAuthAccount | 7 | `OAuthAccount_pkey`, `OAuthAccount_provider_providerAccountId_key`, `OAuthAccount_userId_tenantId_idx` |
| VerificationToken | 0 | `VerificationToken_pkey`, `VerificationToken_token_key`, `VerificationToken_identifier_token_key` |
| SystemAdmin | 0 | `SystemAdmin_pkey`, `SystemAdmin_email_key` |

The two outbound foreign keys removed with their tables were `TenantDocument_tenantId_fkey` and `OAuthAccount_userId_fkey`. Inspection found no inbound foreign keys to the removed tables. Thirteen local indexes, including the five primary-key indexes, were removed. The `EmailVerificationToken_userId_fkey` remains.

Removed Tenant columns: `approvedById`, `approvedAt`, `verificationStatus`, `businessType`, and `verificationRejectionReason`. These were ignored fields belonging to the retired operator/business verification feature. CRM record fields and relations were not dropped.

Read-only before/after inventories used `node scripts/inspect-retired-features.mjs before` and `node scripts/inspect-retired-features.mjs after` from `backend`. The deployment-specific JSON inventories are git-ignored.

Whole-row fingerprints matched exactly for 16 retained tables: Activity (152 rows), AuditLog (336), MailboxMessage (1,807), MailboxOAuthState (0), RecordFile (1), DealStageHistory (35), Task (23), Lead (29), Contact (9), Account (21), Deal (18), PasswordResetToken (1), EmailVerificationToken (7), Workflow (4), WorkflowExecutionRun (20), and WorkflowExecutionStep (36).

EmailAccount retained two rows. Its aggregate fingerprint changed while the application was running. A subsequent read-only inspection showed both connections active with access and refresh tokens present; one had `lastSyncAt` of `2026-10-03T05:58:54.347Z`, after the migration, with no sync error. Repeated timestamp changes are consistent with ongoing background synchronization. The migration contains no EmailAccount modification, and the populated disposable migration test preserves its entire rows exactly. The live inventory did not capture per-field pre-migration values, so byte-for-byte live token preservation cannot be established from that comparison: **I cannot confirm this.**

## Verification performed

Successful build and ORM commands, run from the repository root:

```text
npm --prefix backend run db:generate
npm --prefix backend run build
npm --prefix frontend run build
npm run lint
```

Prisma Client 5.22.0 regenerated successfully. Its generated schema and DMMF no longer expose the five removed models. No generated Prisma files were edited manually. The backend production build passed. The frontend production build passed and generated 180 pages; its route manifest excludes the removed operator, audit, registration, and NextAuth routes. All three workspace TypeScript checks passed. The frontend build still reports its pre-existing local multiple-lockfile and localhost proxy-configuration warnings.

Migration replay, run from `backend`:

```text
node src/tests/security-migration-replay.mjs
```

Actual Prisma `migrate deploy` successfully applied all 78 committed migrations to a fresh disposable PGlite database. The populated retirement integration test separately exercised safe rollback for unmapped standalone operators, role conversion/session revocation, preserved records/tokens/history/files, and Client Admin authenticated access.

Final backend suite, run from the root:

```text
npm --prefix backend test -- src/tests/retired-features.integration.test.ts src/core/auth/__tests__/security.integration.test.ts src/core/auth/__tests__/verification.service.test.ts src/core/auth/__tests__/login.service.test.ts src/api/middleware/__tests__/auth-state.test.ts src/api/middleware/__tests__/role-authorization.test.ts src/api/routes/__tests__/internal-portal.routes.test.ts src/modules/administration/roles/__tests__ src/shared/services/__tests__/account-email-regression.test.ts src/shared/services/__tests__/email.service.test.ts --maxWorkers=2
```

Result: **90 passed; 6 skipped**, 11 passed files and one skipped file. The six pre-existing `roles.integration.test.ts` cases require their separate disposable database URL and were skipped by their safety guard; the retirement tests independently exercised Client Admin `/auth/me`, roles API access, primary/secondary role migration, and preserved normal grants. The security suite now replays actual migrations instead of the unused, stale SQL baseline, which was removed.

For Leads, Contacts, Accounts, and Deals, retirement tests load email/task/status/workflow/note history through the real tenant APIs, hydrate stored email content, test type filters, create new record-linked events, retrieve them, and exercise record relationships. The retained Team Management audit and record Files APIs also return preserved data.

Final frontend suite, run from the root:

```text
npm --prefix frontend test -- src/store/__tests__ src/shared/providers/__tests__ src/features/tenant/auth/__tests__ src/features/tenant/settings/ui/__tests__ src/shared/components/__tests__/command-palette.test.tsx src/shared/components/crm/record-timeline-tab.test.tsx src/shared/components/crm/record-files-tab.test.tsx src/shared/components/crm/__tests__/email-activity.test.tsx src/shared/hooks/use-record-activities.test.ts src/lib/route-map.test.ts app/__tests__ src/features/tenant/help/__tests__
```

Result: **199 passed in 32 files**. This includes all four record timeline All/Emails/Tasks/Status filters, note creation, email rendering, activity fetching, record files, Team Management history mapping, authentication restoration/guards, password change, settings, help links, and route shells.

Gmail suite, run from `backend`:

```text
node scripts/test-mailbox-db.mjs
```

Result: **79 passed** against disposable migrated PostgreSQL-compatible storage, real application services/API, and mocked Google HTTP. Coverage includes session-bound OAuth/PKCE, status/ownership and permissions, inbox/thread reads, send/reply, inbound message ingestion, sync pagination/cursor recovery, email activity, and record file evidence. Added an explicit expired-token refresh/rotation test that decrypts and checks the persisted access/refresh tokens, verifies connection status and expiry, and confirms a valid token does not refresh again.

Repository searches and `git diff --check` passed. Active application code, contracts, dependencies, and generated ORM types have no removed-feature references. Model names intentionally remain in immutable migration history, the new removal/migration regression test, the read-only inventory tool, this report, and explicitly historical design/audit documents. The pre-existing untracked `docs/database-table-audit.md` was left untouched.

## Remaining verification limits

No frontend/backend hosting deployment was performed. Browser checks against a deployed copy of these new builds, and actual Google-provider send/receive using those builds, were not performed: **I cannot confirm this.** No external email was sent as part of testing. The recorded live connection state/sync metadata and the mocked-provider integration results are the available evidence.

Client Admin, staff, Team Management, Roles & Permissions, CRM records, tasks, campaigns, workflows, forms, products, archived data, notifications, record timelines, record Files, password/account security, and work email remain in the application. The change removes the specified administrative/document/login features without redesigning other UI.
