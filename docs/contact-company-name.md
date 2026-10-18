# Contact Company field rename

Contact now stores and exposes `companyName`, matching Lead. The display label is
**Company**. `accountId` remains the independent Account relationship.

## Breaking API change

Contact POST/PUT payloads must use `companyName`. `company` is rejected with HTTP
400, including payloads containing both properties. Contact list/detail/create/edit
responses return `companyName` only. Internal callers, import writes, exports,
conversion/merge/duplicate queries, task-created records and frontend transports
use the new property. No compatibility alias or Prisma `@map("company")` remains.

Campaign audience conditions and recipient previews also use `companyName`.
Both Lead and Contact Insert Variable entries insert `{{companyName}}` and resolve
the selected person's scalar value. `{{company}}` is unsupported. Existing
`company_name` and other unrelated legacy variables retain their previous
behavior. Account selection/copy provenance, Account View restrictions, and the
existing Account-first meaning of `company_name` are preserved.

External Contact API consumers must update request and response handling together
with this release. External audience-preview consumers must read `companyName`.
Repository-owned consumers and maintained verification fixtures are updated here;
the repository cannot enumerate external clients. CSV human labels such as
Company still map to the canonical `companyName` field using existing import logic.

## Migration

`20261217000000_contact_company_name` executes in one transaction:

```sql
ALTER TABLE "Contact" RENAME COLUMN "company" TO "companyName";
```

The column is renamed in place: no Contact records or scalar values are rewritten,
and no column is dropped or added. IDs, tenant IDs, timestamps, null/empty/Unicode
values, assignments, Account links and product/Deal links remain intact.

The same migration converts exact `{{company}}` tokens, including whitespace
variants, in saved Template/Campaign content and Workflow messages. It converts
audience/scheduled conditions, Contact Workflow selectors/actions/changed-field
conditions, and Contact field-layout overrides. Other text, custom-field tokens,
literal condition values, layout customization and identities are retained.
Conflicting destination layout overrides abort the transaction. Session-local SQL
helpers are dropped before commit; no runtime mapping system is introduced.
Completed delivery and Workflow execution evidence remains unchanged.

## Deployment sequence

1. Prepare matching frontend/backend builds and a database backup.
2. Pause new intake and drain Campaign submissions and queued/running Workflows.
3. Stop old API/worker processes. The migration rejects remaining active jobs;
   it does not cancel, delete or replay them.
4. Apply through the existing `npm --prefix backend run db:deploy` planner.
5. Start the matching release, refresh clients, then verify Contact create/edit,
   Account privacy, imports/exports and both recipient sources' Email/SMS messages.

Old backend binaries cannot run against the renamed column. A rollback requires
a coordinated reverse rename and reverse reference conversion before restoring
old binaries; do not roll back only application code. No production migration or
deployment was performed as part of local implementation/verification.

## Verification

The migration suite replays committed history into a disposable PostgreSQL-compatible
database, exercises conflict/in-flight rollback, compares Contact/relationship
snapshots, and verifies targeted saved-reference conversion and retained execution
history. Authenticated HTTP suites use fresh native PostgreSQL with real Prisma;
Email/SMS provider calls are mocked. Frontend tests cover existing forms, inline
details, transport, template editing, audience selection and the variable picker.

Verified locally against the Contact rename changes:

| Check | Result |
| --- | --- |
| Focused backend contract/catalog/layout/export tests | 59 passed |
| Migration and conversion tests | 10 passed, including rollback after a failure following the column rename |
| Populated native PostgreSQL rehearsal | 4 Contact rows across 2 tenants and 7 relationship/history snapshots unchanged |
| Deployment-planner tests | 11 passed |
| Native PostgreSQL Campaign integration | 77 passed; Email/SMS providers mocked |
| Native PostgreSQL Workflow integration | 127 passed |
| Native PostgreSQL atomic Account/Contact creation | 17 passed |
| Workspace TypeScript checks (`npm run lint`) | Passed for all 3 workspaces |
| Production builds (`npm run build`) | Passed for all 3 workspaces |
| Affected frontend forms/details/catalog/templates | Passed after updating renamed-key and Company-label expectations; 363 cases passed in the affected-suites run and the 3 remaining cases passed in the final 5-case panel rerun |
| Timeline retry isolation rerun | 16 passed |

The full frontend run initially reported 2,542 passed / 11 failed. Ten failures
were stale rename/label/sample expectations and passed in the affected-suite
reruns; the remaining timeline retry failure passed when its entire 16-case file
ran separately. A second complete frontend run was not performed.

The broader native CRM/import/merge/sales run reported 60 passed, 1 failed and
18 skipped. Its unrelated Product-catalog test submits no `category`, which
current main requires, and receives HTTP 400 instead of its expected 200. Product
behavior was not changed. Seventeen skipped Account cases were subsequently run
with their required isolated database name and passed; one existing import History
case requires separate deployed-API evidence and remains outside this local run.

Build settings were process-only: `API_URL=https://api.lead-crm.tech/api/v1` and
mock auth/data flags false. No environment file changed. Initial sandbox tests hit
Windows cache-renaming restrictions; isolated retries ran outside the sandbox.
Prisma generation was rerun after tests released its engine DLL. The native QA
wrapper's direct invocation required npm context, so the atomic Account suite used
its existing native PostgreSQL helper directly with the required disposable name.

Independent Quotation work appeared in the shared checkout during verification.
Those edits were preserved and are excluded from this task's scope and file list;
shared files listed below may contain additional concurrent hunks. Reported checks
cover the Contact rename, not acceptance of that ongoing Quotation implementation.

## Changed files

- `backend/prisma/migrations/20261217000000_contact_company_name/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/scripts/deploy-crm-imports.cjs`
- `backend/scripts/verify-campaign-variables-browser.mjs`
- `backend/scripts/verify-canonical-rollout.test.cjs`
- `backend/scripts/verify-crm-polish-browser.mjs`
- `backend/scripts/verify-lead-polish-browser.mjs`
- `backend/scripts/verify-product-share-browser.mjs`
- `backend/scripts/verify-table-controls.mjs`
- `backend/scripts/verify-ui-fixes-browser.mjs`
- `backend/src/modules/automation/actions/action-message.ts`
- `backend/src/modules/automation/actions/action-sms.ts`
- `backend/src/modules/automation/workflows/__tests__/workflow-polish.integration.test.ts`
- `backend/src/modules/automation/workflows/__tests__/workflow.integration.test.ts`
- `backend/src/modules/crm/closing-requirements/field-layout.test.ts`
- `backend/src/modules/crm/companies/organization-polish.integration.test.ts`
- `backend/src/modules/crm/contacts-v2/__tests__/company-name.test.ts`
- `backend/src/modules/crm/contacts-v2/__tests__/contact-account-privacy.integration.test.ts`
- `backend/src/modules/crm/contacts-v2/__tests__/contact-list.test.ts`
- `backend/src/modules/crm/contacts-v2/contact-account-access.ts`
- `backend/src/modules/crm/contacts-v2/contact-creation.ts`
- `backend/src/modules/crm/contacts-v2/contacts-v2.dto.ts`
- `backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts`
- `backend/src/modules/crm/contacts-v2/contacts-v2.service.ts`
- `backend/src/modules/crm/contacts/__tests__/convert-contact-mapping.test.ts`
- `backend/src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts`
- `backend/src/modules/crm/contacts/__tests__/lead-conversion-bug-condition.property.test.ts`
- `backend/src/modules/crm/deals/won-conversion.service.ts`
- `backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts`
- `backend/src/modules/crm/exports/crm-export.controller.ts`
- `backend/src/modules/crm/imports/import-rows.service.ts`
- `backend/src/modules/crm/leads/lead-conversion.service.ts`
- `backend/src/modules/crm/leads/sales-automation.integration.test.ts`
- `backend/src/modules/crm/merge/contact-merge.test.ts`
- `backend/src/modules/crm/merge/merge.service.ts`
- `backend/src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts`
- `backend/src/modules/marketing/campaigns/audiences.service.ts`
- `backend/src/tests/migrations/contact-company-name.test.ts`
- `docs/contact-company-name.md`
- `frontend/src/features/tenant/automation/workflows/services/workflow-recipes.ts`
- `frontend/src/features/tenant/crm/contacts/ui/contact-form.tsx`
- `frontend/src/features/tenant/crm/contacts/ui/contact-save.test.tsx`
- `frontend/src/features/tenant/crm/contacts/ui/contacts-page.tsx`
- `frontend/src/features/tenant/crm/shared/import/configs/contact-import.config.ts`
- `frontend/src/features/tenant/help/content/campaigns.ts`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/audience-panel.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-variable-picker.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/audience-panel.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaign-builder.tsx`
- `frontend/src/features/tenant/operations/tasks/ui/task-record-creator.tsx`
- `frontend/src/features/tenant/settings/ui/__tests__/closing-fields-settings.test.tsx`
- `frontend/src/lib/api/adapters/contact.adapter.ts`
- `frontend/src/shared/components/crm/RecordPanel.tsx`
- `frontend/src/shared/components/crm/__tests__/crm-form-drafts.test.tsx`
- `frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx`
- `frontend/src/shared/components/crm/crm-record-view.tsx`
- `frontend/src/shared/components/data-grid/cell-renderers.tsx`
- `frontend/src/shared/hooks/use-field-layout.ts`
- `frontend/src/shared/services/contacts-v2.api.test.ts`
- `frontend/src/shared/services/contacts-v2.api.ts`
- `scripts/verify-campaign-sms.cjs`
- `scripts/verify-scoped-cleanup.cjs`
- `shared/src/contracts/campaign-email.js`
- `shared/src/contracts/campaign-email.ts`
- `shared/src/contracts/campaign-fields.js`
- `shared/src/contracts/campaign-fields.ts`
- `shared/src/contracts/field-catalog.js`
- `shared/src/contracts/field-catalog.ts`
- `shared/src/contracts/workflow-catalog.js`
- `shared/src/contracts/workflow-catalog.ts`
- `shared/src/validation/contact.schema.js`
- `shared/src/validation/contact.schema.ts`
