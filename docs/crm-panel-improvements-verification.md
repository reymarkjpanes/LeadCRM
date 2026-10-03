# CRM panel improvements — implementation and verification

Scope: Leads, Contacts, Accounts, and Deals. Screenshots were used as visual references; the written request defined the work.

## Implemented behavior

| Area | Changes |
| --- | --- |
| Product Interest | One shared `ProductInterestSelect` uses the existing portal dropdown and `useProductInterests` database catalog. It supports checkbox multi-selection, retained checks, visible chips/count, deduplication, keyboard navigation, Escape/outside close, and an internally scrolling viewport-constrained list. Used by all four module forms and inline Details editors. No separate product list or new search component. |
| Product payloads | Lead requests retain their existing ID array in `productInterest`. Contacts and Accounts retain their existing name-snapshot payloads, with catalog IDs used as option identity. Deals support `productInterestIds`; singular `productInterestId` creation remains compatible. Names and prices are resolved server-side. |
| Email | Shared `CrmEmailSchema` validates trimmed, required, valid emails with a 254-character maximum. Applied to Lead/Contact manual create, edit, inline edit, and backend create/update validation. Partial updates can omit email but cannot clear it. Required indicators are red. Accounts/Deals email rules are unchanged. |
| Activity | Shared task and activity components use `DataLoadingSkeleton` during initial loading. Loaded content stays visible during background refresh; task rows also remain after a refresh error. |
| Tasks | Existing `RefreshButton` supplies icon, tooltip and aria-label `Refresh tasks`, disabled/spinning state, and a duplicate-request guard. Add task uses the existing primary button variant. Deal tasks now appear in Activity with the other modules. |
| Details | Editable values have a pencil on hover/keyboard focus. System/read-only values have no pencil. Deal fields use the existing inline Save/Cancel pattern and `PUT /crm/deals/:id`. The edit menu enters Details; it does not open a second drawer. Value remains read-only and stage changes retain the governed stage endpoint. |
| Deal header | Action order is three dots, inbox, stage/status, close. The inbox has tooltip/aria-label `Open messages` and uses SPA navigation to the existing `/inbox` route. No supported record-context mechanism was found in that Messages route, so no new mechanism was introduced. |
| Activity filters | One shared definition supplies All / Emails / Tasks / Status, including Deals. Notes and Calls & Emails filter buttons are removed. Existing underlying activity records remain. |
| Files | Shared file-row skeletons replace loading text. Existing upload/error behavior is retained. Deal history uses the existing file service with a real Deal relationship and persisted metadata. |
| Deals refresh | Explicit refresh shows the existing Kanban skeleton only in the content area. Header, toolbar, filters and pipeline controls remain. Duplicate refresh actions are blocked. |
| Pipeline settings | Gear immediately left of New Deal opens the existing Dialog pattern for the Sales Pipeline. The modal loads, renames, reorders, adds and removes stages through existing services. Removal requires confirmation and rejects starting/won/lost stages, current or archived Deal references, and historical references. Reorder validates exact pipeline membership. Tenant/environment/RBAC checks are preserved. |
| Responsive safeguards | Dropdown portal collision positioning, internal scroll, wrapping chips, narrow-header truncation, responsive panel rows, and scrollable/wrapping modal controls reuse existing patterns. Visual verification remains outstanding as described below. |

## API endpoints used

Paths are relative to `/api/v1`.

- Catalog: `GET /administration/product-interests` (the same source used by Custom Fields).
- Records: existing `GET /crm/{module}/:id`, `POST /crm/{module}` and `PUT /crm/{module}/:id`, where module is `leads`, `contacts`, `accounts`, or `deals`.
- Deal data/stage: `GET /crm/deals`, `PATCH /crm/deals/:id/stage`.
- Pipeline: `GET /crm/pipelines`, `GET /crm/pipelines/:id`, `POST /crm/stages`, `PUT /crm/stages/:id`, `DELETE /crm/stages/:id`, `PATCH /crm/pipelines/:id/stages/reorder`.
- Task loading: `GET /operations/tasks` and `GET /operations/tasks/summary`; existing task mutations remain unchanged.
- Activity: existing `GET /crm/activities` with record filters; Contact activity comes from `GET /crm/contacts/:id/relationships?limit=50`.
- Files: existing generic `GET`/`POST /crm/{module}/:id/files` and `GET /crm/{module}/:id/files/:fileId/download`, extended to Deals.
- Messages navigation: frontend route `/inbox`.

No duplicate product, messaging, or pipeline API was introduced. No localStorage source of truth was added.

## Database changes

Migration: `backend/prisma/migrations/20261015000000_crm_panel_products_files/migration.sql`.

- Adds `Deal.productInterestIds`, backfilled from the existing singular ID; preserves existing singular IDs, names and price snapshots.
- Adds `RecordFile.dealId`, a tenant/environment-aware foreign key and index; updates the existing one-record check constraint to include Deals.
- No new pipeline model or multi-pipeline feature.
- Changed product selections derive their combined price from catalog configuration. Unchanged selections preserve stored names/value/currency. Manual product-linked value/currency overrides are blocked or ignored when the same selection is submitted.

The migration ran against the disposable integration-test database. It has **not** been applied to the configured development or production database. Deployment must apply it before running this version of the application.

## Checks actually executed

- `npm run lint`: passed across frontend, backend and shared packages (these scripts run TypeScript checks).
- `npm run build`: passed after retrying outside the sandbox for a Windows `EPERM` workspace-path error. Prisma generation and the Next.js production build completed. Existing build warnings concern inferred workspace root/multiple lockfiles and local backend configuration.
- `npm --prefix backend run db:generate`: passed.
- `node scripts/test-sales-db.mjs src/modules/crm/leads/sales-automation.integration.test.ts`: **29 passed** using disposable PGlite. Covers required email, catalog pricing/ID persistence, unchanged snapshots, permissions, stage references and real Deal-file metadata persistence with a local storage test double.
- Frontend Vitest selection: **45 passed across 7 files**, run with `--no-file-parallelism`. Covers shared selector behavior, record panels, inline Deal Save/Cancel, email validation, header/messages/filter behavior, files, timelines, form errors, stage modal API calls/confirmation, and task refresh/skeleton behavior.
- `git diff --check`: passed.

Frontend test files:

```text
src/shared/components/crm/__tests__/panel-migrations.test.tsx
src/shared/components/crm/__tests__/product-interest-select.test.tsx
src/shared/components/crm/record-files-tab.test.tsx
src/shared/components/crm/record-timeline-tab.test.tsx
src/shared/components/crm/__tests__/form-errors.test.tsx
src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.test.tsx
src/features/tenant/operations/tasks/ui/related-tasks.test.tsx
```

An earlier concurrent build/test run had timing failures and one incorrect test assumption about primary-button styling. The assertion was corrected to check the existing primary CSS variable, and the serial rerun passed. These are component/API tests, not completed visual end-to-end tests.

## Unverified items

- Visual layout, touch interaction and absence of clipping/overflow at 320px, 375px, 390px, tablet and desktop: **I cannot confirm this.** Browser control repeatedly timed out while attaching to the local preview.
- Persistence against the configured live database and real remote file storage: **I cannot confirm this.** Tests used an isolated database and a local storage test double; live services were not mutated.
- No deployment was performed. No claim is made that the full repository test suite passed; only the checks listed above were run.

## Files changed

- `backend/prisma/migrations/20261015000000_crm_panel_products_files/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/src/modules/crm/contacts-v2/contacts-v2.dto.ts`
- `backend/src/modules/crm/contacts/contacts.dto.ts`
- `backend/src/modules/crm/deals/deals.dto.ts`
- `backend/src/modules/crm/deals/deals.repository.ts`
- `backend/src/modules/crm/leads/lead-automation.service.ts`
- `backend/src/modules/crm/leads/sales-automation.integration.test.ts`
- `backend/src/modules/crm/pipeline/pipeline.dto.ts`
- `backend/src/modules/crm/pipeline/pipeline.repository.ts`
- `backend/src/modules/crm/record-files/record-files.routes.ts`
- `backend/src/modules/crm/record-files/record-files.service.ts`
- `docs/API.md`
- `docs/crm-panel-improvements-verification.md`
- `frontend/src/features/tenant/crm/accounts/ui/account-form.tsx`
- `frontend/src/features/tenant/crm/contacts/schemas/contact-form.schema.ts`
- `frontend/src/features/tenant/crm/contacts/ui/contact-form.tsx`
- `frontend/src/features/tenant/crm/deals/ui/deal-edit-form.tsx`
- `frontend/src/features/tenant/crm/deals/ui/deal-form.tsx`
- `frontend/src/features/tenant/crm/leads/ui/lead-form.tsx`
- `frontend/src/features/tenant/crm/pipeline/ui/pipeline-page.tsx`
- `frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.test.tsx`
- `frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.tsx`
- `frontend/src/features/tenant/operations/tasks/ui/related-tasks.test.tsx`
- `frontend/src/features/tenant/operations/tasks/ui/related-tasks.tsx`
- `frontend/src/features/tenant/operations/tasks/use-tasks.ts`
- `frontend/src/lib/api/adapters/deal.adapter.ts`
- `frontend/src/shared/components/crm/__tests__/form-errors.test.tsx`
- `frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx`
- `frontend/src/shared/components/crm/__tests__/product-interest-select.test.tsx`
- `frontend/src/shared/components/crm/crm-record-view.tsx`
- `frontend/src/shared/components/crm/inline-deal-form.tsx`
- `frontend/src/shared/components/crm/product-interest-select.tsx`
- `frontend/src/shared/components/crm/record-files-tab.tsx`
- `frontend/src/shared/components/crm/record-timeline-tab.tsx`
- `scripts/test-sales-db.mjs`
- `shared/src/index.ts`
- `shared/src/types/deal.types.ts`
- `shared/src/validation/contact.schema.ts`
- `shared/src/validation/crm-email.ts`
