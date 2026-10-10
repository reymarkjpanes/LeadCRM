# Lead, Contact and Account record views

Implemented on September 28, 2026 using the supplied screenshots as layout references and LeadCRM's existing components and CSS tokens.

## Scope and behavior

The existing LeadPanel, ContactPanel and AccountPanel entry points now render one shared record view inside the existing Sheet. Their full-page routes render the same view without a Sheet. Table layouts, the Deal panel, backend services, database schema and permission middleware were not redesigned.

The shared view includes an initials/company avatar, record-type and available source badges, status control, close control, open-full-page link, wrapping information chips and the existing viewport-aware portal dropdown. Empty email, phone, location and representative chips are omitted. Accounts omit retired classification fields; Lead-only fields are not fabricated for Accounts.

Activity, Details and Files use the existing segmented Tabs primitives. Arrow keys, Home and End navigate the tabs. Detail sections have keyboard-accessible collapse controls with `aria-expanded` and `aria-controls`. Icon-only controls have labels and native title tooltips.

| Module | Details sections |
| --- | --- |
| Leads | About, Tasks, Deals, Converted contact, Company / Organization |
| Contacts | About, Tasks, Deals, Account / Company, source lead when returned by the existing relationship API |
| Accounts | About, Contacts, Deals, Tasks |

About uses label/value rows and chips for product interests. Custom fields are rendered only if actual values are supplied; there are no persisted custom fields in the current models, so the old hardcoded sample field and unsaved field editors were removed from these panels.

Edit, status changes, archive confirmation, Lead conversion and deal creation use existing forms and endpoints. Contact edits map the reused form's fields to the Contact model (`company`, `source`, `productInterests`) and its enum statuses. Task rows, overdue indicators, editing, creation, refresh and pagination remain in RelatedTasks/TaskEditor. Its saved summary supplies the Tasks heading count.

Full pages display CRM > Leads/Contacts/Accounts > record name. Existing route resolution already maps nested record URLs to the correct sidebar module; its regression tests were run without changing navigation code.

## Shared components

- Created `CrmRecordView`, `CrmRecordPanel`, `RecordSection`, `RecordQuickInfo`, `RecordRows` and `RelatedRecords` in `frontend/src/shared/components/crm/crm-record-view.tsx`.
- Reused Sheet/SheetContent, Tabs, Button, DropdownMenu, RecordTimelineTab, RelatedTasks, TaskEditor, InlineDealForm, the three record edit forms, ConvertLeadDialog and ConfirmActionDialog.
- Reused the tenant/user/environment-scoped `useCachedPage` cache, `useRecordActivities`, `apiClient`, permission hooks and Sonner feedback.
- Added optional compact timeline presentation, optional task-count reporting and optional deal-form error handling. Existing consumers retain their default behavior.

## Existing APIs reused

All paths below are relative to the existing API proxy/base URL.

- `GET /crm/{leads|contacts|accounts}/:id` for canonical record data.
- `GET /crm/{leads|contacts|accounts}/:id/relationships?limit=50` for related records. Lead and Account relationships load after first opening Details; Contact history reuses this response without another relationships request.
- `GET /crm/activities` through the existing contextual reader for Lead and Account history.
- `POST /crm/activities` through the existing Account activity composer.
- Existing task list, summary and mutation APIs through RelatedTasks/TaskEditor.
- `PUT /crm/{leads|contacts|accounts}/:id`, existing archive PATCH endpoints, `POST /crm/leads/:id/convert`, and `POST /crm/deals` for authorized actions.

No endpoints, storage provider, database migrations or shared API contracts were added. Production data does not come from localStorage. The existing explicit mock-data mode is retained for record display; live-only archive/conversion/deal actions are not exposed for mock records.

Record identity includes the user and active CRM environment. Changing the selected record remounts its UI state, while the cache keys isolate fetched data. Switching tabs preserves mounted activity/details content after loading. Record and relationship failures have visible retry states; failed requests are not displayed as zero-result relationships.

## Verification

- `npm --prefix frontend run lint`: passed (`tsc --noEmit`).
- `npm --prefix frontend run test -- src/shared/components/crm src/lib/route-map.test.ts`: passed, 64 tests in 8 files.
- `git diff --check`: passed.
- `npm --prefix frontend run build`: passed, including type validation and generation of 189 static pages. The first sandboxed attempt failed with Windows `EPERM` while resolving the inferred workspace root; the approved retry outside the sandbox completed successfully. Next.js still reports the pre-existing multiple-lockfile workspace warning and missing backend configuration warning.
- Browser checks used the actual shared components, existing CSS and temporary isolated test fixtures. All three drawer and full-page layouts were checked at 320, 375, 768 and 1366 pixels. Long names, email and address values wrapped with no measured horizontal overflow. Dropdown bounds stayed inside the viewport; a 375 × 480 short-screen check also passed. Details, Files, task summaries and section controls were inspected. The temporary fixture preview and its server were removed afterward.
- Regression coverage includes shared content on both surfaces, relationship request reuse, tab switching, denied permissions, record/relationship errors, stale-record prevention, Contact save payloads and keyboard tab navigation. Existing Deal panel tests also passed.

## Current limits

- The local app's auth request could not reach a configured backend. Live database reads, successful mutations and authenticated end-to-end navigation were not browser-verified; fixtures do not establish backend integration success.
- The current schema and routes have no record attachment storage or upload API for these three models. Files displays “No files attached.” without a fake upload control or browser-local file store.
- Persisted custom-field definitions/values are unavailable for these models. No sample custom fields or unsaved mutation controls are shown.
- The existing production activity composer supports Account links but does not support Lead/Contact logging. Those records show actual history without a logging action.
- Existing relationship responses are capped at 50 records and lack total counts/pagination. Capped collection badges are omitted rather than presented as totals. Activity filters search the recent history returned by the existing reader (50 for Contacts, up to 100 for Leads/Accounts). No new history or relationship pagination engine was introduced.

## Files changed

- `frontend/src/shared/components/crm/crm-record-view.tsx`
- `frontend/src/shared/components/crm/RecordPanelWrappers.tsx`
- `frontend/src/shared/components/crm/record-timeline-tab.tsx`
- `frontend/src/shared/components/crm/inline-deal-form.tsx`
- `frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx`
- `frontend/src/features/tenant/crm/leads/ui/lead-detail-page.tsx`
- `frontend/src/features/tenant/crm/contacts/ui/contact-detail-page.tsx`
- `frontend/src/features/tenant/crm/contacts/ui/contact-form.tsx`
- `frontend/src/features/tenant/crm/accounts/ui/account-detail-page.tsx`
- `frontend/src/features/tenant/operations/tasks/ui/related-tasks.tsx`
- `docs/crm-record-detail-ui.md`
