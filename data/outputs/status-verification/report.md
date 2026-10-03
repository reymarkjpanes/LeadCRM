# Lead and Contact status fix — verification report

## Result and root cause

Manual New Lead creation succeeds locally for Hot, Warm, Cold, Closed, and Cancelled.

The exact source of WARM was `toBackendStatus()` in `frontend/src/lib/api/adapters/contact.adapter.ts`. The manual path is `LeadsPage` → `LeadFormSheet` / `AddLeadForm` → `DataContext.addContact` → `toBackendCreateContact` → `contactsService.create` → POST `/crm/leads` (through the browser's `/api/proxy`). The form's options, React Hook Form defaults, schema, and submitted status already used Warm. The adapter then called `status.toUpperCase()`. The live Lead route validates the title-case shared LeadStatusSchema and rejected that transformed value.

The adapter now validates and preserves canonical values instead of uppercasing them or silently substituting invalid statuses. Updates use the same corrected adapter. Legacy values read into forms are normalized without converting write payloads to uppercase.

Contacts had an additional actual inconsistency: the contacts-v2 DTO accepted uppercase database values. Its public create/update/query contract and list/detail responses now use the same title-case status schema. Only the repository translates validated values to the existing Prisma ContactStatus enum. No database migration or broadening of Lead validation was introduced. Tenant scoping, RBAC, links, workflow trigger inputs, and assignment logic remain intact.

## Shared contract and presentation

Canonical source: `shared/src/contracts/record-experience.ts`:

- CRM_STATUSES / CrmStatusSchema / CrmStatus: Hot, Warm, Cold, Closed, Cancelled.
- LEAD_STATUSES and LeadStatusSchema remain compatibility aliases to that same source.
- ContactStatus aliases CrmStatus; Contact form validation and older shared validation reuse it.
- The emitted JavaScript companion is included because existing shared validation exports load CommonJS source companions.

Both tables use CrmStatusIndicator. The extracted Lead table colors are unchanged: Hot #ef4444; Warm #f59e0b; Cold #3b82f6; Closed #8b5cf6; Cancelled #6b7280. Contacts no longer renders the uppercase gray badge.

Lead and Contact panels/full pages use the existing shared CrmRecordView and getCRMStatusStyles. Their corresponding surfaces retain the existing Lead styling (including the existing green Closed header style; the table Closed dot remains purple). Older detail configurations and module defaults share definitions too. Contact status filters use all five canonical labels/values. System-generated Contact timeline status messages use title case, including presentation of historical uppercase messages.

## Executed browser verification

Used a local frontend on port 3002 and the repository's isolated PGlite preview API on port 4101. All browser records were created in that disposable local database, not the deployed service.

- Opened Create Lead → Create New → New Lead side panel.
- Verified Warm default and precisely the five canonical options.
- Created one Lead for each status through the real form. Each appeared in the table with the selected title-case status and successful creation feedback.
- Selected Smart Lock and Biometrics for all five Leads. Each retained both selections. The Deal count rose from 3 to 13; the pipeline showed two correctly named Deals per Lead using configured product values.
- Reopened the Warm Lead's Edit form: both products remained checked. Changed status to Hot and saved; the table confirmed Hot.
- Created a Contact through the real form for each of the five statuses; confirmed each table row.
- Inspected rendered Contact dot colors and shared markup for all five values.
- Applied each Contact status filter and verified only the matching row remained.
- Changed a Contact through all five values using the side-panel header dropdown; each persisted and used the existing shared header style.
- Opened the Contact full page and changed status through all five values using inline editing; every save succeeded and the header and details reflected it.
- Captured browser warning/error logs after create and edit checks: empty.

Browser verification established successful real form submissions and persisted outcomes. Payload assertions were executed in the automated form/adapter and HTTP tests described below; a browser DevTools network trace was not exported.

## Executed automated checks

- `npm run lint`: all three workspaces passed (TypeScript no-emit checks).
- Frontend focused regression run: 54 tests passed across five files: crm-status-forms, panel-migrations, RecordPanel, task-related-record-creator, and validate-module-config.
- `node scripts/test-sales-db.mjs src/modules/crm/leads/sales-automation.integration.test.ts`: 22 tests passed using an isolated real database and Express HTTP server.
- `git diff --check`: passed.

The form tests select each status and click submit, inspect the Lead adapter payload and Contact service arguments, verify Warm defaults, ensure uppercase writes are rejected, check update payloads, preserve both Product Interest IDs, and check each dot color. Panel tests exercise title-case header and inline update requests for both modules. HTTP tests exercise create/update/detail/filter behavior for all statuses, default Warm, strict rejection of uppercase writes, product persistence, two automatic Deals with configured values, title-case timeline messages, and the existing automation/tenant/permission regressions.

Initial test-fixture ordering and asynchronous UI timing failures were corrected; the final runs above passed. A source CommonJS dependency discovered during consolidation was fixed with its emitted companion and rerun successfully.

No production deployment or production data mutation was performed. Frontend and backend should be released together because the Contact API write contract now matches Leads. A full production build was not run.

## Changed files

- [backend/src/modules/crm/contacts-v2/contacts-v2.dto.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/contacts-v2/contacts-v2.dto.ts>)
- [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts>)
- [backend/src/modules/crm/contacts-v2/contacts-v2.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/contacts-v2/contacts-v2.service.ts>)
- [backend/src/modules/crm/leads/sales-automation.integration.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/leads/sales-automation.integration.test.ts>)
- [backend/src/modules/crm/relationships/relationships.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/relationships/relationships.service.ts>)
- [frontend/src/features/tenant/crm/contacts/config/record-detail.config.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/config/record-detail.config.tsx>)
- [frontend/src/features/tenant/crm/contacts/contacts.config.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/contacts.config.ts>)
- [frontend/src/features/tenant/crm/contacts/schemas/contact-form.schema.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/schemas/contact-form.schema.ts>)
- [frontend/src/features/tenant/crm/contacts/ui/contact-form.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/ui/contact-form.tsx>)
- [frontend/src/features/tenant/crm/contacts/ui/contacts-data-grid.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/ui/contacts-data-grid.tsx>)
- [frontend/src/features/tenant/crm/contacts/ui/contacts-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/ui/contacts-page.tsx>)
- [frontend/src/features/tenant/crm/leads/config/record-detail.config.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/leads/config/record-detail.config.tsx>)
- [frontend/src/features/tenant/crm/leads/ui/lead-form.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/leads/ui/lead-form.tsx>)
- [frontend/src/features/tenant/crm/leads/ui/leads-data-grid.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/leads/ui/leads-data-grid.tsx>)
- [frontend/src/lib/api/adapters/contact.adapter.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/lib/api/adapters/contact.adapter.ts>)
- [frontend/src/lib/constants.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/lib/constants.ts>)
- [frontend/src/shared/components/crm/RecordPanel.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/RecordPanel.test.tsx>)
- [frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx>)
- [frontend/src/shared/components/crm/crm-record-view.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/crm-record-view.tsx>)
- [frontend/src/shared/components/crm/moduleConfig.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/moduleConfig.ts>)
- [frontend/src/shared/components/data-grid/cell-renderers.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/data-grid/cell-renderers.tsx>)
- [shared/src/contracts/record-experience.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/contracts/record-experience.ts>)
- [shared/src/types/contact.types.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/types/contact.types.ts>)
- [shared/src/validation/contact.schema.js](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/validation/contact.schema.js>)
- [shared/src/validation/contact.schema.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/validation/contact.schema.ts>)
- [frontend/src/shared/components/crm/crm-status.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/crm-status.tsx>)
- [frontend/src/shared/components/crm/__tests__/crm-status-forms.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/__tests__/crm-status-forms.test.tsx>)
- [shared/src/contracts/record-experience.js](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/contracts/record-experience.js>)

## Screenshots

- [Contact table — all five matching status dots](contacts-statuses.png)
- [Product-generated Deals](product-deals.png)
- [Contact full-page inline edit](contact-inline-edit.png)
