# Workflow implementation and release report

Superseded for current behavior by the [2026-09-25 production report](workflow-production-report.md), including dedicated builder pages, campaign actions, reference validation, database metrics, deduplication and deployment instructions. This document retains the earlier audit history.

Date: 2026-09-23. Release state: local validation in progress; production deployment has not been performed. The [implementation plan](workflow-implementation-plan.md) records release gates and rollback. The [audit](workflow-automation-audit.md) records the initial findings and selected architecture.

## Findings resolved

The previous UI and backend used different workflow shapes; dotted event fields did not match the evaluator; browser-side execution could duplicate backend effects; email could report success without sending; stage actions bypassed domain validation; and Lead/Client Profile identity, protected fields and activation permissions were inconsistent. Unsupported timers/SMS, simulated history and invented productivity metrics made the UI promise behavior the backend did not provide.

The implementation uses one contract, server metadata and backend execution. Actions call existing domain services, validate scoped references, preserve relationship Status, and record actual results. Unsupported operations are absent from the catalog. Invalid legacy definitions fail closed and can be opened for explicit repair without deleting run history.

## Architecture before and after

| Layer | Before | After |
| --- | --- | --- |
| Frontend | Competing editors, local engine and history | One WHEN/IF/THEN builder; shared list owner; API-backed operations, dry-run and Runs |
| API | Incompatible DTOs; active writes could bypass activation checks | Shared DTOs; named permissions; validated activation through CRUD and toggle |
| Engine | Context mismatch and partial domain effects | Flattened context, ordered steps, refreshed records, scope checks, recursion guard |
| Triggers | Lead/Contact aliases and advertised unwired events | Eight canonical events emitted by the appropriate domain services |
| Actions | Direct writes and simulated delivery | Six real immediate actions through existing services |
| Scheduler | UI suggested persistent delay | No workflow scheduling or delay advertised; existing campaign scheduler is separate |
| Integrations | Email queue-shaped success without delivery | Gmail transport and delivery receipts; failed sends are failed steps; Sandbox blocks external sends |
| Logging | Browser history diverged from persisted runs | TriggerRecord, Run, Step, workflow Activity and administration audit records |

## Exact supported catalog

Triggers: `lead.created`, `lead.status_changed`, `contact.created`, `contact.status_changed`, `deal.created`, `deal.stage_changed`, `deal.closed_won`, `deal.closed_lost`.

| Action | Execution | Scope |
| --- | --- | --- |
| `create_task` | Immediate | Linked Lead, Client Profile or Deal task; scoped owner; defaults for blank optional priority/deadline |
| `send_email` | Immediate | Lead/Client Profile template through connected Gmail; no external sending in Sandbox |
| `create_notification` | Immediate | Notification for an active workspace user |
| `assign_owner` | Immediate | Scoped active user, through CRM services |
| `update_field` | Immediate | Client Profile notes or Lead description only; Deal is not a supported target |
| `move_deal_stage` | Immediate | Deal service validates required fields and lost reason and preserves stage side effects |

None is schedulable in this release. SMS and delay are unsupported and removed from workflow controls.

## Cross-module evidence

| Integration | Verification |
| --- | --- |
| Leads / Client Profiles | Authenticated Lead creation runs ordered actions; Client Profile actions use correct links and preserve Status |
| Deals / Pipeline | Real stage transitions preserve history and closed timestamps; required fields/lost reason validated; recursion bounded |
| Tasks | Real linked records, assignee and actor checked in PostgreSQL; browser-created Lead completed task creation |
| Campaign/Templates | Existing template source reused; template and placeholders validated; campaign sending itself is outside this audit |
| Email | Provider transport stubbed in integration tests; real delivery-log success/failure paths checked. Live Gmail delivery remains a staging gate |
| SMS | No workflow implementation claimed; absent from catalog |
| Notifications | Real user-scoped notification record verified |
| Audit / Activities | Domain actor and entity links retained; workflow Activity verified; audit writes retained in service mutations |
| Users / RBAC | Scoped active references and authenticated view-only mutation rejection checked |
| Environments / tenancy | Workflow suite checks foreign tenant/environment and missing-scope rejection; all 8 dedicated environment tests passed against a separately gated disposable database |

## File responsibility map

Paths below are repository-relative. Generated shared JavaScript accompanies its TypeScript source because this repository tracks both.

| Files | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json`, `backend/package.json`, `frontend/package.json`, `README.md` | Patched dependency versions, PostCSS/UUID overrides, development-only Faker and compatible Node minimum |
| `.github/workflows/ci.yml` | Use the patched pinned npm release for reproducible workspace installations |
| `backend/src/database/seeders/tenant-generator.ts` | Load patched Faker only for explicit non-production demo generation |
| `shared/src/contracts/workflow.contracts.ts`, `.js` | Canonical draft, conditions, action, metadata, run and dry-run schemas/types |
| `shared/src/contracts/workflow-catalog.ts`, `.js` | Supported trigger fields and six action configurations |
| `shared/src/contracts/index.ts`, `.js` | Export shared catalog and contracts |
| `backend/src/api/routes/automation.routes.ts` | DTO validation, RBAC, activation protection, dry-run route |
| `backend/src/modules/automation/workflows/workflows.dto.ts` | Shared request schemas |
| `backend/src/modules/automation/workflows/workflows.controller.ts` | HTTP adapters and execution pagination |
| `backend/src/modules/automation/workflows/workflows.service.ts` | CRUD, toggle, archive, audit and mutation-free dry-run |
| `backend/src/modules/automation/workflows/workflows.repository.ts` | Scoped persistence, current entity context, batched last-run data and run Activity |
| `backend/src/modules/automation/workflows/workflow.engine.ts` | Scoped ordered execution and truthful persisted outcomes |
| `backend/src/modules/automation/workflows/workflow-conditions.ts` | Strict flattened-field condition evaluation |
| `backend/src/modules/automation/workflows/workflow-validation.ts` | Activation/condition checks and safe configuration errors |
| `backend/src/modules/automation/actions/action-validation.ts` | Entity compatibility, scoped references, safe fields, email and stage validation |
| `backend/src/modules/automation/actions/action-dispatcher.ts` | Real service calls, delivery receipts, safe failures and Sandbox delivery protection |
| `backend/src/modules/automation/actions/actions.repository.ts` | Scoped action dependency lookups and delivery persistence |
| `backend/src/modules/automation/actions/actions.service.ts` | Canonical action metadata |
| `backend/src/modules/automation/triggers/trigger-catalog.ts` | Backend access to shared trigger metadata |
| `backend/src/modules/automation/triggers/triggers.controller.ts` | Metadata response |
| `backend/src/modules/automation/triggers/triggers.service.ts` | Correct domain event emission and awaited engine dispatch |
| `backend/src/modules/crm/contacts/contacts.service.ts` | Lead-only trigger identity |
| `backend/src/modules/crm/contacts-v2/contacts-v2.controller.ts` | Pass authenticated actor for Client Profile mutation |
| `backend/src/modules/crm/contacts-v2/contacts-v2.service.ts` | Client Profile triggers, ownership and actor handling |
| `backend/src/modules/crm/deals/deals.service.ts` | Reusable governed stage validation and domain events |
| `backend/src/modules/crm/deals/deals.repository.ts` | Remove automatic Lead relationship Status mutation on won deal |
| `backend/src/modules/crm/activities/activities.dto.ts` | Correct Lead/Client Profile activity links |
| `backend/src/modules/operations/tasks/tasks.dto.ts` | Client Profile task link |
| `backend/src/database/seeders/demo-full.seed.ts` | Canonical paused workflow seed definitions; seeder not executed |
| `backend/prisma/migrations/20260912135215_tenant_document_key_prerequisite/migration.sql` | Additive prerequisite and guards before the historical legacy transition |
| `backend/src/app.ts`, `backend/.env.example` | Explicit trusted proxy configuration and deployment guidance |
| `frontend/src/shared/services/workflows.api.ts` | Canonical HTTP client, full list pagination and scoped metadata cache |
| `frontend/src/store/DataContext.tsx` | One list owner, real API mutations, honest loading/errors; remove browser engine |
| `frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx` | List/filter/pagination, permissions, create/edit/duplicate/toggle/archive/runs/test controls |
| `frontend/src/features/tenant/automation/workflows/ui/visual-workflow-builder.tsx` | One guided editor, typed conditions, action ordering, drafts, validation and legacy repair |
| `frontend/src/features/tenant/automation/workflows/ui/workflow-dialog.tsx` | Dialog focus retention, keyboard loop and focus restoration |
| `frontend/src/features/tenant/automation/workflows/ui/workflow-execution-log-modal.tsx` | Actual runs/steps and server dry-run UI |
| `frontend/src/features/tenant/automation/workflows/services/workflow-recipes.ts` | Three canonical paused templates |
| `frontend/src/features/tenant/automation/workflows/index.ts` | Feature exports after consolidation |
| `frontend/src/features/tenant/crm/pipeline/ui/deal-details-modal.tsx` | Remove simulated automation history/counts; link real history |
| `frontend/src/features/tenant/marketing/campaigns/hooks/use-campaigns-data.ts` | Reuse template loading with optional disabled/polling controls |
| `frontend/src/store/types.ts`, `types/index.ts`, `types/workflow.types.ts` | Remove legacy workflow shape and re-export canonical types |
| `frontend/src/store/mockData.ts`, `mockData/index.ts`, `mockData/workflows.mock.ts` | Canonical configuration-only mock data |
| `backend/src/modules/automation/workflows/__tests__/workflow-conditions.test.ts` | Operator, type and missing-field regressions |
| `backend/src/modules/automation/workflows/__tests__/workflow.integration.test.ts` | Disposable PostgreSQL/authenticated HTTP acceptance, actions, permissions, scope and dry-run |
| `backend/src/modules/automation/workflows/__tests__/workflow-validation.test.ts` | Configuration error context and unexpected-error privacy |
| `backend/src/api/middleware/__tests__/proxy-trust.test.ts` | Actual Express app proxy trust boundary |
| `backend/src/modules/reporting/reports/__tests__/reports.service.test.ts` | Exclude NaN from finite preservation property and assert exact values |
| `frontend/src/features/tenant/automation/workflows/ui/workflow-builder.test.tsx` | Typed payload, focus, errors, permission state, legacy repair and draft behavior |
| `frontend/src/store/__tests__/auth-phase2-exploration.test.tsx` | Verify non-destructive seed account creation using the actual AST |
| `docs/workflows/workflow-automation-audit.md`, `workflow-implementation-plan.md`, `workflow-release-report.md` | Findings, decisions, ordered exit gates, evidence, responsibilities and limitations |

## Duplicate code removed

Removed `frontend/src/features/tenant/automation/workflows/hooks/use-workflows.ts`, `services/workflows.service.ts`, `services/workflow-condition-evaluator.ts`, and `ui/workflow-recipes-modal.tsx`. Their duplicate list client, evaluator and competing configuration paths are replaced by the existing DataContext, shared API client, backend evaluator and one builder. Removed browser execution/timers/history from DataContext and simulated Deal automation history. Shared contract exports replace legacy workflow type definitions.

## Validation and remaining release gates

The [implementation plan](workflow-implementation-plan.md#validation-evidence) contains commands, final results, tested browser flows and explicit unverified items. Historical migration files were not rewritten, production data was not reseeded, and external customer messages were not sent.

Immediate request-bound execution has no durable retries, queue or crash recovery. Pausing workflows and reviewing persisted steps/provider receipts precedes any manual replay. The final production configuration, target-database migration rehearsal, live controlled-recipient delivery, CI and hosted smoke checks must pass before production release.
