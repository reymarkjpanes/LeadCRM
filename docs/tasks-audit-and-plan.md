# Tasks audit and implementation plan

Audit: 2026-09-27. Updated: 2026-09-28. Status: **Approved implementation complete; final verification recorded below.**

## Approved follow-up: multiple associations and related creation

Final production build: `npm run build` passed both build tasks, including frontend type checking and all 189 generated pages. The local API proxy warning remains an environment configuration reminder, not deployment verification.

This section supersedes the initial single-association/no-migration scope recorded below. The owner approved Extra High scope for typed association tables, a preserving migration, Task APIs/consumers, and Task-only Merge repair. See [ADR-002](decisions/002-task-multiple-associations.md) for contracts, rollout and rollback constraints. The migration is prepared and tested, not applied to production.

The Task editor now uses Contact wording, persistent multiple checkbox selections, explicit Lead-dependent options, and a floating bottom bulk-action bar. Empty Contact, Deal and Account menus offer Create actions for permitted users. The owner approved explicit Lead linking and confirmation for conversion or Account replacement:

- Deals are created with all selected Leads plus additional Leads chosen in the existing form.
- For a Contact, choose one selected unconverted Lead, choose/create an Account, and explicitly confirm conversion. Existing Lead details become the Contact. Already converted/linked Leads cannot be converted again through this flow.
- For an Account, choose one selected Lead, complete the existing Account form, review the existing Account link and confirm replacement. Failed linking can retry the same created Account without duplicating it.
- Changes save immediately in CRM and preserve the Task draft. Account selections are reviewed after a Lead relationship changes to avoid submitting stale unrelated IDs. Permission checks use existing definitions; no RBAC or conversion-service architecture changes.

Follow-up validation: 27 frontend Task tests and 40 isolated database/HTTP and Workflow tests passed. Workspace TypeScript checks passed in all three workspaces. Tests verify empty-menu Create actions, explicit confirmations, permission guards, conversion failures, Account-link retry, newly created records in scoped options, and successful Task persistence. CRM creation is intentionally unavailable in the existing mock preview; these persistence checks use the disposable database rather than production.

Additional recommendation, not implemented: add an atomic CRM operation for creating an Account and linking one Lead. The Task flow safely retries linking a successfully returned Account, but the existing two-request API can leave an unlinked Account if the user cancels after a linking error. A CRM-level transaction/idempotency design would need separately approved scope.

This report applies the supplied Tasks brief to the existing repository. Screenshots are references, not specifications. No application source, schema, role definitions, or live records were changed during this audit. Local Prisma Client generation is tooling only, not a migration.

## Decision

Keep `/operations/taskboard`, its Kanban/List/Workload views, `tasksApi`, the existing controller/service/repository, and the existing Prisma `Task` table. Repair correctness and integration before adding optional features. The initial audit recommended Extra High because shared Task contracts and tenant-sensitive validation require coordinated changes. The user retains control of effort changes; no switch was made or claimed. The user approved the scoped integration repairs and subsequently requested persisted column customization. No new Task store, WorkflowTask model, Supabase browser client, or database migration is proposed for the first increment.

## Evidence and limits

- Read the repository guidance, README, architecture, structure, API docs, Task frontend/backend, Prisma model, environment middleware, Workflow dispatch/actor path, CRM Task consumers, permissions, audit, notification, and preference implementations.
- Inspected the authenticated Brevo Tasks list, existing task edit drawer, task-type choices, and bulk-selection toolbar. Used a separate temporary tab so the user's open creation draft was preserved. Did not save, complete, delete, reassign, or send anything. Cleared temporary selection.
- The reference shows compact date tabs, searchable tasks, association chips, contextual editing and bulk controls. Official documentation confirms [task creation and reminders](https://help.brevo.com/hc/en-us/articles/360019727819-Create-a-task) and [date views, sequential navigation and bulk management](https://help.brevo.com/hc/en-us/articles/9444082470546-View-and-manage-your-tasks). Reminder delivery and automation execution were not tested in Brevo. Mobile and keyboard accessibility were not exhaustively verified there.
- `backend/.env` resolves to Supabase PostgreSQL; `frontend/.env.local` selects live API mode. Credentials were not printed. After the sandbox network attempt failed, an approved read-only aggregate query succeeded against the configured database: **1 Task, pending, PRODUCTION; 0 stored reminders; 0 completed rows missing completion metadata**. This is a snapshot of this configured database, not evidence about every deployment.
- The database snapshot contains no `in-progress` rows. Legacy seeders and frontend types do contain that spelling. Do not run a speculative production migration or infer that old deployments have no legacy rows.
- Live database **reads** were verified during the audit. The implementation section below records subsequent isolated HTTP/database and Workflow tests; live production writes and deployment acceptance remain unverified.

## Findings before implementation

| Priority | Finding | Evidence / implication |
|---|---|---|
| High | Manual Task writes do not validate related records or active assignees within the tenant/environment | `backend/src/modules/operations/tasks/tasks.service.ts` immediately calls the repository; `tasks.repository.ts` writes scalar foreign keys. Foreign keys establish existence, not tenant membership. Environment middleware scopes the Task but does not validate these scalar relation IDs. |
| High | Canonical status mismatch | `tasks.dto.ts` accepts `in_progress`; `frontend/src/store/types/shared.types.ts`, board, Workload, Dashboard and several seeders use `in-progress`. DataContext uses a TypeScript cast, which does not translate the runtime value. |
| High | Mutation callers cannot reliably distinguish failure | Task methods in `frontend/src/store/DataContext.tsx` catch errors without rethrowing. Board closes forms immediately; CRM consumers show success after a resolved, failed mutation. Archive is labeled irreversible Delete although the API soft-archives. |
| High | Completion/reopening metadata is inconsistent | Only the dedicated complete endpoint writes `completedAt`/`completedById`. UI uses generic update. Generic transitions into completed omit metadata; reopening does not clear it. |
| High | Related-record panels can display unrelated tasks | `RecordPanelWrappers.tsx` matches Lead/Contact names in titles. `lead-profile-tabs.tsx` creates without `leadId`; `company-profile-tabs.tsx` matches organization names. Similar names can produce false associations. |
| High | Partial task data is treated as complete | DataContext loads `tasksApi.list({limit:100})` once. Board search, pagination, Workload, record panels, user summaries and Dashboard operate over that prefix. Existing server pagination is not exposed to these consumers. |
| High | Inconsistent permission boundary across Task read surfaces | `/operations/tasks` deliberately requires `deals.*`. Lead/Contact relationship endpoints use `contacts.view` and include task summaries directly. Existing policy needs to be applied consistently; adding a new permission vocabulary is unnecessary. |
| Medium | Drag/drop is incomplete and error-prone | Board has only PointerSensor, no registered column `useDroppable`, and writes during drag-over. Empty column targets are not registered. Drag cancel and multiple asynchronous writes have no explicit settlement strategy. |
| Medium | Reassignment metadata is only rich in mock mode | Live update does not change `assignedById` or record before/after assignee details. Frontend `assignedBy?: string` conflicts with API's relation object. Mock-only `assignmentHistory` is not persisted. |
| Medium | Task response omits useful association details | List/detail includes Lead and Deal but not Contact; create/update return different relation shapes. Frontend Task type omits Lead/Contact IDs, environment, completion fields and archive state. |
| Medium | Filtering can contradict user intent | Repository overdue filter overwrites an explicit status filter. No validated query contract, configurable sort, today/week range, or aggregate view counts. Workload ignores the board's selected filters. |
| Medium | Due dates lose time and local meaning | Board edits only a date and truncates existing timestamps. DataContext turns date-only input into midnight UTC. Colored due badges do not exclude completed/cancelled tasks consistently. |
| Medium | Reminder timestamp has no runtime | `reminderAt` exists in schema and DTO only. No Task reminder worker or delivery tracking was found. Campaign scheduler is not a Task scheduler. Do not expose a working reminder toggle. |
| Medium | Accessibility and permissions are incomplete in Task UI | Board lacks permission guards, dialog semantics/focus handling, accessible labels on some controls, keyboard drag support, and button semantics for clickable titles. Existing status editing provides a basis for a non-drag alternative. |
| Medium | API failures are flattened to not-found | Repository mutation methods catch every Prisma exception and return null; outages and invalid references become misleading 404s. |
| Limitation | Audit is best effort | Task create/update/complete/archive call the existing audit service. It catches write errors globally. Task audits contain little before-state. Do not claim transactional/durable audit guarantees without a separately approved audit change. |

### Sound foundations to retain

- Authenticated tenant is read from `req.user`, not the body. Task root queries include tenant IDs.
- `Task` participates in existing environment scoping; HTTP middleware and Workflow environment context already establish the dataset.
- `Task.contactId` refers to Prisma `Contact`, the Client Profile resource; a second Client Profile model is unnecessary.
- Workflow `dispatchAction(create_task)` already calls `tasks.service.createTask`. It resolves an explicit assignee or triggering record owner, validates active workspace users, passes the correct Lead/Contact/Deal link, and returns `taskId`.
- Workflow engine validates the event actor, rechecks the activating user's permissions, and passes `activatedById` as Task creator/assigner. Preserve this truthful attribution rather than creating a fake System User.
- Existing CRM relationship endpoints query the same Task table by foreign key. They return a bounded recent summary (default 10), not a complete task list.
- Backend overdue predicate excludes completed/cancelled. Existing report and Deal helpers largely use the same definition.
- Audit, notifications, record selectors, data-grid components, drawers, filter components, pagination, and column preference infrastructure exist for reuse where applicable.

## Brevo comparison before implementation

| Brevo capability | LeadCRM current state | Adopt? | Reason | Implementation |
|---|---|---|---|---|
| Contextual create/edit | Board modal and separate details drawer exist | ENHANCE | Keep users in context | Reuse Task drawer/form in existing route, with sticky actions and accessible focus management. |
| Compact task list | List, Kanban, Workload already exist | REUSE / FIX | Preserve useful views | Keep all three; use one query owner and honest totals. Default can remain Kanban. |
| Today / week / overdue | Server overdue only; several client formulas | ENHANCE | Makes daily work easier | Shared predicate; half-open local date ranges converted to ISO instants; server filters/counts. |
| Search, sort, pagination | Server search/page; UI filters first 100 | FIX | Correctness at scale | Validated Task query, stable tie-break sort, server pages and scoped aggregates. |
| Due date and time | Database supports both; editor discards time | FIX | Avoid accidental rescheduling | Local date/time inputs; preserve and submit UTC timestamp. |
| Assignee | Existing users and required assignee field | FIX | Preserve ownership/security | Search active same-tenant users; distinguish assigned-to/from; validate on service entry. |
| CRM associations | Lead/Contact/Deal FKs present | FIX / ENHANCE | One record everywhere | Actual selectors, explicit FKs, chips/links, no title-based joins. |
| Multiple links of the same kind | One optional FK per entity kind | DO NOT ADD | Would need junction schema and broader semantics | Retain existing cardinality. |
| Task type | No stored type; inline Call changes title only | DO NOT ADD in first increment | Avoid migration unrelated to reliability | Keep call wording as a title shortcut, not a stored type/filter. Future optional additive `type` field needs separate scope. |
| Rich notes | Plain description exists | REUSE | Sufficient for first increment | Bounded plain text; no rich-text dependency. |
| Completion / reopen | Endpoint exists; callers bypass metadata | FIX | Accurate lifecycle | One service transition path shared by update and complete. |
| Reminder | Timestamp only | DO NOT ADD in first increment | Requires delivery/runtime work | Preserve stored data, disclose unavailable delivery, omit enable toggle. |
| Bulk complete / assign / reschedule / archive | Missing | IMPLEMENT after core fixes | Useful for daily work | Bounded operation within existing Task API, per-item authorization/validation, honest result counts; no generic framework. |
| Permanent delete | Existing API archives | DO NOT ADD | Retain current lifecycle | Label Archive accurately; no hard-delete endpoint. |
| Column customization | Generic preferences exist but no Tasks registration | ENHANCE, optional gated extension | Useful for association columns | Register Tasks in existing frontend/backend preference registries and permission maps; no separate preference store. |
| Start Tasks navigator | Missing | DO NOT ADD in first increment | Not needed for correctness or the acceptance scenarios | Revisit after stable Task detail/mutation flows. |
| Automation-created tasks | Existing Workflow calls same service/table | REUSE / VERIFY | Correct architectural boundary | Strengthen Task service validation; regression-test existing dispatcher without redesigning Workflow. |

## Dependency map and consumers

```text
/operations/taskboard (thin route)
  -> TaskBoard / List / Workload / Task drawer
  -> existing DataContext Task facade (one query/cache owner)
  -> tasksApi -> /api/v1/operations/tasks
  -> operations routes: auth + tenant + workspace + deals.* + validation
  -> Task controller -> Task service -> Task repository
  -> existing scoped Prisma client -> Supabase PostgreSQL.Task

CRM event -> Workflow engine (tenant/environment, activation permissions)
  -> action-dispatcher.create_task
  -> same Task service -> repository -> same Prisma Task
  -> execution output.taskId
```

Current Task consumers found in source (some legacy views remain reachable/exported; no claim all are active in today's UI):

- Operations: `frontend/app/(tenant)/operations/taskboard/page.tsx`, `features/tenant/operations/tasks/ui/task-board.tsx`, `workload-view.tsx`.
- Shared Task transport/state/types: `shared/services/tasks.api.ts`, `store/DataContext.tsx`, `store/types/shared.types.ts`, `store/mockData/workflows.mock.ts`.
- Reusable Task UI: `features/tenant/crm/tasks/ui/task-details-drawer.tsx` (exported, no importing consumer found), `shared/components/crm/inline-task-form.tsx`, Task portions of `RecordPanelWrappers.tsx`.
- Lead/Client Profile/Deal panels: `RecordPanelWrappers.tsx`; `features/tenant/crm/{leads,contacts,deals}/config/record-detail.config.tsx`; `shared/hooks/use-record-detail.ts` and related/timeline components.
- Legacy Lead/Account displays: `leads/ui/{lead-profile-tabs,company-profile-tabs,customer-journey-timeline,lead-detail-view,leads-table}.tsx`.
- Deal entry points: `deals/ui/{deals-page,deal-detail-page}.tsx`, `pipeline/ui/{pipeline-page,deal-details-modal}.tsx`.
- Dashboard: `dashboard/ui/dashboard.tsx`, `dashboard/hooks/use-dashboard.ts`; shared `user-profile-drawer.tsx` computes assigned/open Task totals.
- Backend: Operations Task routes/service/repository; Workflow action dispatcher; CRM `relationships/relationships.service.ts`; CRM merge repository moves existing Task FKs; reports `getTaskCompletion` aggregates the same table.
- Seeders: `demo-rich.seed.ts`, `demo-full.seed.ts`, `reymark.seed.ts` use legacy status; `tenant-generator.ts` already uses canonical spelling. Baseline SQL/migrations define the model and must not be rewritten.

## Ordered implementation plan

Every step includes focused tests alongside its changes. No dependency installation is currently justified.

| Step | Exact goal and likely files | Dependency / risk | Verification and completion criterion |
|---|---|---|---|
| 1. Define canonical contracts | Add Task contracts/validation/helpers under `shared/src`; export in `shared/src/index.ts`; use from `tasks.dto.ts`, `tasks.api.ts`, `store/types/shared.types.ts`. Canonical `in_progress`; explicit nullable associations and response relations; separate request vs response types. | Approval for shared consumer changes. Legacy inputs need explicit compatibility, never a type assertion. | Round-trip schema tests; reject blank titles/invalid dates/query bounds; accept intentional alias only at compatibility boundary and emit canonical values. |
| 2. Repair Task service authority | `backend/src/modules/operations/tasks/tasks.{service,repository,controller,dto}.ts`. Validate current active tenant user and scoped Lead/Contact/Deal before writes, including service calls from Workflow. Preserve correct errors. Centralize completion/reopen and assignment metadata. Include Contact relations. | Existing environment middleware, audit service. Avoid changing RBAC definitions or inventing actor attribution. Handle partial updates/cleared relations deliberately. | Authenticated HTTP + isolated DB tests for create/edit/archive/reassign/complete/reopen, foreign tenant/env/invalid references, audit before/after, repeated completion and outages. |
| 3. Make reads complete and bounded | Existing Task routes/repository: validated search/filter/sort/pages, due-date bounds, exact counts and Workload aggregates. Use existing namespace for optional options/summary endpoints. | Stable pagination; do not turn page counts into global totals or fetch every Task into browser. Preserve combined status/overdue predicates. | >100 fixtures; deterministic tie sorting; completed+overdue returns none; all filters and counts agree within tenant/environment. |
| 4. Repair existing data owner | Task slice of `frontend/src/store/DataContext.tsx`, Task API and Task-domain hook/helper files. Keep one owner keyed by tenant/environment/query, deduplicate queries, share mutations, reject failures, ignore stale responses after environment change, invalidate related queries. | Shared state consumers must migrate together. Existing `tasks` prefix cannot keep masquerading as complete data. | Frontend tests for server pagination, query deduplication, mutation rejection, record cache refresh, tenant/environment switch during in-flight mutation, Workflow-created data on refresh. |
| 5. Upgrade existing Task UI | `task-board.tsx`, `workload-view.tsx`, existing Task details drawer; extract Task-only form/filter/list helpers as needed. Date tabs, searchable associations/assignee, date+time, readable metadata, actual archive state and error/loading/empty states. | Steps 1–4; reuse design system. No new route. | Responsive desktop/mobile and dark-mode checks; form errors keep input; keyboard/focus/labels; same Task ID after edits; permissions guard actions. |
| 6. Fix Kanban persistence | Task board and Task-only column/card helpers. Real droppable columns; local preview only during hover; one awaited mutation on valid drop; keyboard/non-drag alternatives. | Step 4 errors must propagate. Avoid overlapping write races. | Empty-column move, cancelled drag, rejected update rollback, one request per move, real DB state matches successful move. |
| 7. Integrate existing consumers | Task sections of CRM wrappers, inline form, Lead/Account/Deal views, Dashboard helpers/UI and user summary. Replace name matching with IDs; await saves; use query/summary owner and shared status/overdue rules. Protect relationship task summaries with existing Task read permission. | Explicit cross-module approval required. Do not infer missing legacy FKs from names. | Each linked-record acceptance scenario, same IDs after edit from either surface, >100 tasks, no false name matches, no success toast on rejection, no Task summary for users lacking Task read permission. |
| 8. Add bounded bulk actions | Task DTO/controller/service/repository and list selection toolbar under existing Tasks module. Limit selected IDs (proposed maximum 100); dedupe and validate; report successful/failed IDs without foreign-record disclosure. | Core single-item operations must work first. No generic bulk framework. | Mixed valid/invalid IDs, cross-tenant/env IDs, selection reset on filter/env change, zero/oversize request, precise counts and audit records. |
| 9. Optional column preferences | Existing `backend/src/modules/preferences/column-registry.ts`, both preference controller permission maps, `frontend/src/shared/constants/column-registries.ts`, Task table UI. | Separate explicit Preferences approval. Alternative is fixed responsive columns. | User-specific persistence, required columns protected, keyboard reorder, visible columns/headers aligned. |
| 10. Verify and document | New Task backend/frontend suites; existing Workflow integration suite; relevant CRM/environment/security suites; update Task docs and API references. Normalize only Task seed/mock status values. | Disposable DB for mutation tests; named Sandbox fixtures for live path only once scoped. Never run fixture suites against Supabase Production. | All six supplied scenarios, targeted tests, type checks, lint and production build pass. Record exact output, and distinguish isolated DB proof from live Supabase write proof. |

### Time and compatibility decisions

- Overdue: non-archived, due instant before now, status outside completed/cancelled. One shared pure helper; backend SQL predicate follows it.
- Today/week: browser local timezone, Monday-start calendar week, half-open ranges sent as ISO timestamps. Show the timezone beside due-time editing. Preserve time on unrelated edits. Test midnight and daylight-saving transitions even though Manila has no DST.
- Keep all existing five statuses. Cancelled tasks remain reachable in list/filter; do not silently lose them from overall totals.
- Accept legacy `in-progress` at explicit boundaries during compatibility rollout and always write/return `in_progress`; update Task fixtures. A future deployment with legacy persisted values gets a scoped reviewed migration after an aggregate preflight, not global string replacement.
- Use `contactId` for Client Profiles. Do not add a duplicate profile column. `accountId` exists as an unvalidated scalar and lacks a Prisma Account relation: direct Account task support is a separately described consumer repair, not permission to invent a new company model.
- Continue current `deals.*` Task permission mapping. Source explicitly calls this deliberate and Workflow uses it too. Repair UI/read-surface consistency with those existing permissions; do not seed `tasks.*` or change role grants in this increment.
- Existing best-effort audit remains best effort. Improve Task payloads through the public service. Transactional audit guarantees would require a separate Core Audit design/approval.

## Cross-module approval record

The supplied brief explicitly says: **“If correct Task implementation requires modifying another module's schema, API, business logic, UI, or architecture, STOP before changing it.”** It separately requires approval before RBAC definition changes or scheduler/notification changes. The following are concrete changes to approve; read-only inspection and calling an existing public service do not need approval.

| Module | Problem and why Tasks depend on it | Smallest proposed change | What could be affected | Alternative |
|---|---|---|---|---|
| Shared contracts / DataContext | Wrong status/response types, swallowed failures, 100-row prefix, stale mutation identity | Update only Task contracts, Task state/query/mutation facade and exports; migrate Task callers | Existing Task consumers and environment switching | A board-only adapter leaves shared data and CRM views incorrect; not sufficient for the stated goal. |
| CRM Leads, Client Profiles, Deals; legacy Account Task UI | Name-based association, missing FK in legacy create, premature success, incomplete task subsets | Update only Task sections/forms and their callback types; use explicit FKs, shared query owner and awaited mutations. For existing Account Task UI, validate/use existing `accountId` scalar without schema change, or remove unsupported creation after agreement. | Related Task displays, task counts, legacy title-only tasks will no longer appear falsely linked | Keep existing UI defects and limit delivery to Operations, which fails full integration acceptance. Never auto-link by name. |
| CRM Relationships / existing permission enforcement | Lead/Contact relationship reads include Task summaries under contacts permission alone | Filter/omit Task payload unless existing `deals.view` passes; reuse Task query service for permitted summaries | Contacts-only users may cease seeing Task details they cannot read via Tasks API | Leaving the mismatch preserves a permission inconsistency. No new permissions or role-definition changes are proposed. |
| Dashboard / user Task summaries | Prefix-based totals and legacy status comparisons | Consume Task summaries and shared status/overdue helper; adjust Task-only UI bindings | Task KPI values become complete; no unrelated charts/metrics changes | Limit claims and knowingly retain inconsistent totals. |
| Preferences (optional) | Task column registry and permission-map entry absent | Add Tasks registry entries using existing `deals.view`; reuse current drawer/hooks | Task column persistence and registry tests | Fixed responsive columns, no Preferences changes. Recommended to defer if minimizing scope. |

**Approved scope:** required rows 1–4, Task-only seed/mock normalization, and associated regression tests. The later request to implement customizable columns also covers the small Task registry and existing-permission map additions in Preferences. Do not change Workflow runtime/contracts, Notifications/scheduler, Core Audit behavior, CRM schema, or RBAC definitions as part of this approval. Tests may cover these existing services without modifying their business logic.

**Delivered scope:** required integration repairs, column preferences, and bounded bulk actions. Task types, reminders and sequential task navigation remain deferred. No database migration was needed.

## Baseline verification

These are pre-implementation baselines, not proof that Task defects are fixed.

- Backend Workflow validation/input-security/conditions: **3 files, 30 tests passed**.
- Supabase aggregate read: **passed**, snapshot above. No write tests against production.
- Initial `npm run lint`: failed because generated Prisma Client lacked current Forms fields/model. `npm --prefix backend run db:generate`: **passed**, Prisma 5.22.0; no schema/migration change.
- Repeated `npm run lint` after generation: **passed, 3/3 workspaces** (the repository's lint commands are TypeScript `--noEmit` checks).
- `npm run build`: Turbo reported **2/2 build tasks successful**, including backend Prisma generation/TypeScript and Next.js production compilation, type checking, 189 generated pages and build traces. Local build warns that the API proxy resolves to localhost; this local configuration is not deployment verification.
- Targeted frontend baseline: **4 files, 38 tests passed** with `--pool=threads --maxWorkers=1`. The initial default fork-worker attempt timed out before running tests; no test/source changes were made to obtain the retry result.
- Task-specific regression suite: absent before this work; must be implemented after approval.
- Workflow PostgreSQL integration test file guards itself to a disposable localhost database. It was inspected, not run against production.

Commands for the passing targeted baselines:

```powershell
npm --prefix backend run test -- src/modules/automation/workflows/__tests__/workflow-validation.test.ts src/modules/automation/workflows/__tests__/workflow-input-security.test.ts src/modules/automation/workflows/__tests__/workflow-conditions.test.ts
npm --prefix frontend run test -- src/shared/components/crm/__tests__/panel-migrations.test.tsx src/shared/components/crm/__tests__/deal-panel.test.tsx src/features/tenant/dashboard/ui/__tests__/dashboard-lead-count.test.ts src/store/__tests__/environment-switch.test.tsx --pool=threads --maxWorkers=1
npm --prefix backend run db:generate
npm run lint
npm run build
```

## Implemented result

- Shared Task schemas normalize the legacy status spelling, reject unsupported write fields and malformed queries, and define the same date/status/column rules across frontend and backend. Existing database tables are reused.
- Task services enforce tenant/environment scope, active workspace actors/assignees, explicit related-record IDs, completion/reopening attribution, and archive behavior. Serializable transactions protect concurrent state transitions; repeated completion/archive do not duplicate audit actions. Existing best-effort auditing remains unchanged architecturally.
- The table is the default view, with date tabs, search, filters, selection, sorting, pagination, association labels, completion/reopening and contextual bulk actions. Kanban retains every status and performs writes only on drop. Workload totals and counts come from full filtered database aggregates rather than a 100-row prefix.
- The Task editor preserves failed drafts and unchanged due instants. Association menus place search inside the dropdown with checkbox choices. They allow one Lead, Contact, Account and Deal per task, matching the existing scalar foreign keys. Lead/Contact choices include email where available to distinguish duplicate names.
- Create Lead/Account/Deal reuses the existing forms and public APIs. Contact uses a focused Task-owned quick form because the existing Contact form sends Lead-oriented fields to an incompatible endpoint. Creation selects only the returned record ID after success and preserves the Task draft. The Account handoff converts its date-only customer-since field to the existing API datetime format.
- Customise columns provides searchable attributes, Default/Already added labels, removal, drag and keyboard ordering, Save/Cancel drafts, retryable errors, and per-user persistence using the existing Preferences infrastructure. Action and Task title remain required; Action stays first.
- Approved CRM Task sections, Lead quick-add, Task history, Dashboard summaries and user summaries use the shared Task query owner. Associations use IDs; relationship endpoints suppress Tasks when the existing Task read permission is absent. Environment changes isolate caches and dismiss stale editors.
- No production writes, deployments, schema migrations, Workflow contract/runtime changes, RBAC definition changes, or reminder infrastructure were performed. No project dependency was added. Formatting used a temporary npm tool cache.

## Verification after implementation

- Workspace TypeScript checks: `npm run lint` **passed, 3/3 workspaces**. An overlapping check initially encountered generated `.next/types` files being replaced by the build; stopping the preview and running checks after the build resolved it without source/configuration workarounds.
- Production build: `npm run build` **passed, 2/2 build tasks**, including frontend/backend compilation, type checking and 189 Next.js pages. The local proxy configuration warns that it points at localhost; this does not verify deployment environment variables.
- Frontend regression: **52 tests passed in 7 files** covering Task contracts/query isolation/editor failures/dropdown selection/column drafts and table behavior, CRM panels, Dashboard and environment switching. A final focused rerun also passed all **14 Task tests in 3 files** (a subset of the 52, not additional tests).
- Backend unit regression: **42 tests passed in 4 files**, including Task lifecycle/reference checks and existing Workflow validation/security/conditions.
- Isolated database/HTTP acceptance: **36 tests passed in 2 files**, including all four associated-record create APIs, Task lifecycle, associations, audit metadata, pagination beyond 100 records, composed filters, bulk partial failures, tenant/environment/RBAC checks, column persistence isolation and existing Workflow execution. The final run also passed email-option and Account datetime assertions.
- Database tests run through `node backend/scripts/test-tasks-isolated.mjs`, which creates a disposable in-memory PostgreSQL-compatible database on localhost from the existing Prisma schema, overrides configured database URLs, and closes the database afterward. It never migrates or writes the configured Supabase database.
- Local mock browser: verified table/columns, attribute search and saved column visibility, checkbox/search association menus, Task creation, completion and reopening with count updates. Confirmed archive removed the disposable demonstration task from the active list and restored the original counts. Browser screenshots occasionally had clipped rendering in the host; DOM geometry confirmed horizontal scrolling is confined to the table, with no document-width overflow at the default viewport.
- Responsive check: at an observed 390 CSS-pixel viewport, document width remained 390 pixels and the Task drawer occupied the viewport without horizontal page overflow. Reset the temporary viewport override and left the mock Tasks preview open. This was a focused layout check, not a full accessibility certification.
- The live production application was not deployed or write-tested. This is a verified local implementation, not a claim of live production acceptance.

## Recommendations for other modules — not implemented

1. **Contacts form and API alignment (highest priority):** the legacy Contact form emits `companyName`, `leadSource`, `productInterest` and free-form statuses, while the Contact entity uses `company`, `source`, `productInterests` and a fixed status enum. The Contacts V2 create/update paths also spread request bodies into Prisma without a dedicated validation contract. Review strict payload schemas, field mapping, related-record tenant/environment validation and consistent allowed statuses as a separate approved repair. The Task quick form sends only known safe scalar fields to avoid relying on that mismatch.
2. **Account form date handling:** resolved by removing the obsolete Account date field from forms, contracts, and storage.
3. **Legacy customer journey deal associations:** Task history now uses explicit `leadId`; the separate Deal timeline still falls back to company-name matching and can mix companies sharing a name. Replace that fallback with explicit Deal/Lead links in a separately scoped CRM repair.
4. **Reminders, task types, multiple records of one association kind, and sequential task navigation:** treat these as separate design decisions. Multiple associations require schema/contracts; reminder delivery needs scheduler, retry, idempotency, notification and time-zone decisions. Obtain explicit scope and Extra High approval before that work. Existing reminder fields do not prove delivery exists.
5. **Core Audit durability:** current Task events use the existing best-effort audit service. Durable transactional audit/outbox guarantees require a separately approved Core Audit change.
6. **Deployment environment:** verify the deployed API proxy target and run authenticated staging acceptance before release. Local build success does not validate a deployment's backend URL.
