# Workflow production implementation report

Current polish behavior and migration notes: [2026-10-03 workflow polish](workflow-polish-2026-10-03.md). This older report retains the earlier implementation history.

Date: 2026-09-25. Implementation and verification are local. No production migration, deployment or live provider delivery was performed.

## A. Workflow architecture

The existing controller/service/repository and synchronous workflow engine are retained. Thin Next.js routes at `/automation/workflows/new` and `/automation/workflows/[id]/edit` render `workflow-builder-page.tsx`. Domain components in `frontend/src/features/tenant/automation/workflows/ui/` provide the ordered WHEN → optional IF → THEN sequence, typed fields, searchable Add step, right-side configuration, draft saving, validation, activation and history. Steps use temporary form state until saved. There is no arbitrary graph, scripting, raw configuration editor or browser execution engine.

`shared/src/contracts/workflow.contracts.ts` and `workflow-catalog.ts` own the contracts, supported fields, operators, events and actions. Their tracked CommonJS counterparts are regenerated together. `workflows.api.ts` uses the existing authenticated API client; `DataContext` holds only a temporary cache of saved workflow responses.

Domain service → trigger adapter → `workflow.engine.fireWorkflowTrigger` → scoped database event claim and run → configuration/authority validation → condition evaluator → ordered action dispatcher → existing CRM/communication services → persisted step/run result. The workflow page does not need to be open.

Audit classification before this change:

| Area | Finding | Resolution |
| --- | --- | --- |
| CRUD, tenant/environment middleware, RBAC, domain services | WORKING | Reused |
| Eight domain events, immediate actions, execution history, chain guard | WORKING / PARTIALLY WORKING | Retained, hardened and tested |
| Configuration and typed controls | NEEDS REFACTORING | Dedicated builder pages and real reference selectors |
| Workflow browser storage/mock branch | UI ONLY | Removed from workflow persistence/execution/history paths |
| Campaign orchestration, draft state, real counts, event deduplication | MISSING | Added using existing campaign delivery and workflow models |
| SMS provider/scheduler send stubs | PLACEHOLDER | Not advertised as a workflow action |
| Separate CRM/provider implementations | DUPLICATION RISK | No new CRM or provider client created |

## B. Database

`Workflow` stores name, description, trigger, ordered actions and conditions as validated JSON, status, active/archive flags, tenant/environment and activating user. Separate condition/action tables are unnecessary. `WorkflowTriggerRecord`, `WorkflowExecutionRun` and `WorkflowExecutionStep` store claims, history and results. Last run and total/successful/failed counts are calculated from stored runs.

New migration: `backend/prisma/migrations/20261006000000_workflow_reliability/migration.sql`. Its ordering follows the repository's existing future-dated environment migration. It adds `Workflow.status`, `Workflow.activatedById`, `WorkflowTriggerRecord.eventId` and the unique `workflow_event_once` index on tenant/environment/workflow/event. Legacy null event IDs preserve historical records.

**The migration pauses all existing workflows for explicit authorized reactivation.** Definitions and histories remain intact. It does not silently infer an author or replay old events.

Workflow business data is API → Prisma → PostgreSQL backed. Workflow localStorage reads/writes, mock definitions and restore/reset persistence were removed. Unrelated UI preferences remain. Preserved domain services write `Lead`, `Contact`, `Deal`, `DealStageHistory`, `Task`, `Notification`, `Activity`, `AuditLog`, `EmailDeliveryLog` and campaign delivery models as applicable.

## C. API endpoints

Verified registration: `backend/src/app.ts` mounts `/api/v1`; `backend/src/api/routes/index.ts` mounts `/automation`; every endpoint below is registered in **`backend/src/api/routes/automation.routes.ts`**. Authentication, tenant context and workspace readiness apply to all. The existing authentication/environment infrastructure supplies the selected CRM environment.

Public API paths below are backend paths. Frontend paths are arguments to the existing API client, which prefixes browser requests with `/api/proxy` and forwards them to the backend. Workflow controllers/services below live in `backend/src/modules/automation/workflows/workflows.controller.ts` and `workflows.service.ts`. For every workflow row, controller and service have the same function name unless stated otherwise.

| Operation / method | Exact public API path | Exact frontend client path | Controller → service | Required permission | Database reads/writes |
| --- | --- | --- | --- | --- | --- |
| List GET | `/api/v1/automation/workflows` | `/automation/workflows` | `getWorkflows` | `workflows.view` | Read Workflow, WorkflowExecutionRun |
| Get GET | `/api/v1/automation/workflows/:id` | `/automation/workflows/:id` | `getWorkflowById` | `workflows.view` | Read Workflow |
| Create POST | `/api/v1/automation/workflows` | `/automation/workflows` | `createWorkflow` | `workflows.create`; additionally `workflows.activate` and action authority for active creation | Write Workflow, AuditLog; read references below |
| Update PUT | `/api/v1/automation/workflows/:id` | `/automation/workflows/:id` | `updateWorkflow` | `workflows.edit`; additionally `workflows.activate` when isActive supplied; active definitions require action authority | Read/write Workflow; write AuditLog; read references |
| Set active/paused PATCH | `/api/v1/automation/workflows/:id/toggle` | `/automation/workflows/:id/toggle` | `toggleWorkflow` → `toggleWorkflow` → `updateWorkflow` | `workflows.activate`; action authority on activation | Read/write Workflow; write AuditLog; read references on activation |
| Archive PATCH | `/api/v1/automation/workflows/:id/archive` | `/automation/workflows/:id/archive` | `archiveWorkflow` | `workflows.delete` | Read/write Workflow; write AuditLog |
| History GET | `/api/v1/automation/workflows/:id/executions` | `/automation/workflows/:id/executions?page=:page` | `getWorkflowExecutions` | `workflows.view` | Read Workflow, WorkflowExecutionRun, WorkflowExecutionStep, WorkflowTriggerRecord |
| Execution detail GET | `/api/v1/automation/workflows/:id/executions/:executionId` | `/automation/workflows/:id/executions/:executionId` | `getExecution` | `workflows.view` | Read Workflow, WorkflowExecutionRun, WorkflowExecutionStep, WorkflowTriggerRecord |
| Validate POST | `/api/v1/automation/workflows/validate` | `/automation/workflows/validate` | `validateDraft` | `workflows.view`, `workflows.activate` and action authority | Read references and RBAC; no writes or sends |
| Saved sample check POST | `/api/v1/automation/workflows/:id/test` | `/automation/workflows/:id/test` | `testWorkflow` | `workflows.view` | Read Workflow, scoped Lead/Contact/Deal and references; no writes or sends |
| Builder options GET | `/api/v1/automation/workflow-options` | `/automation/workflow-options` | `getOptions` | `workflows.view`; campaigns/templates require marketing view | Read User, Pipeline, Stage, Template, Campaign and RBAC |
| Actions GET | `/api/v1/automation/actions` | `/automation/actions` | `actions/actions.controller.getActions` → `actions/actions.service.getAvailableActions` | `workflows.view` | Shared catalog; no business model writes |
| Triggers GET | `/api/v1/automation/triggers` | `/automation/triggers` | `triggers/triggers.controller.getTriggers` → shared `WORKFLOW_TRIGGERS` (no service call) | `workflows.view` | Shared catalog; no business model writes |

List supports `page`, `limit`, `search`, `isActive`, `archived`. Builder reference reads include active `User`, `Pipeline`, `Stage`, `Template`, `EmailAccount`, `Campaign`, `TargetAudience` and saved audience source models as required. Authorization reads active `UserRole`, `RoleDefinition` and `RolePermission`. Create returns 201; other successful routes return 200.

Duplicate is the existing create endpoint with an inactive copy, not a second endpoint. Delete means archive; no workflow DELETE route is advertised. Toggle now requires the explicit body `{ "isActive": true|false }`; repeating the same state request cannot invert it. An empty pause request is invalid. Pausing remains possible when an action reference is no longer valid.

## D. Triggers

| Supported trigger | Actual emitter |
| --- | --- |
| `lead.created` | `crm/contacts/contacts.service.createContact` → `fireLeadCreated` |
| `lead.status_changed` | `crm/contacts/contacts.service.updateContact` → `fireLeadStatusChanged` |
| `contact.created` | `crm/contacts-v2/contacts-v2.service.createContact` → `fireContactCreated` |
| `contact.status_changed` | `crm/contacts-v2/contacts-v2.service.updateContact` → `fireContactStatusChanged` |
| `deal.created` | `crm/deals/deals.service.createDeal` → `fireDealCreated` |
| `deal.stage_changed` | `crm/deals/deals.service.moveDealStage` → `fireDealStageChanged` |
| `deal.closed_won` | The same transition when the destination stage is won |
| `deal.closed_lost` | The same transition when the destination stage is lost |

Created events use stable record-based IDs, status changes include the persisted update timestamp, and deal transitions use persisted stage-history IDs plus event type. Unwired update, assignment, task overdue/completed and campaign engagement events are not exposed.

## E. Conditions

All/Any (AND/OR), up to 30 flat rules. Lead: status, source, email, first name, companyName, assignedUserId. Contact/Client Profile: status, source, email, firstName, company, assignedUserId. Deal: title, value, stageId, pipelineId, priority, expectedCloseDate, assignedUserId. Names shown in the UI are readable labels.

Text supports equality/inequality, contains/not contains, starts/ends with and empty/not empty. Numbers support equality and ordered comparisons. Enums and references support equality/inequality. Dates support equals/before/after by calendar date. Controls follow the type, and empty checks omit the value input. Lead choices cover the actual Lead form's title-case values and established legacy/import values; Contact choices match its Prisma enum.

Backend checks fields/operators against shared metadata, finite numbers, bounded text without controls, whitelisted enum values, real calendar dates and canonical UUID references. Supplied references are checked even in drafts. Scope comes from authenticated server context. Dotted field names are literal flat keys, never object traversal or Prisma queries.

## F. Actions

| Action | Existing service reused |
| --- | --- |
| Assign owner | Lead `contacts.service.updateContact`, Contact `contacts-v2.service.updateContact`, Deal `deals.service.updateDeal` |
| Create task | `operations/tasks/tasks.service.createTask`; linked entity, selected/current owner, priority and days until due |
| Move deal stage | `crm/deals/deals.service.moveDealStage` and `validateDealStageMove`; required fields/lost reason and transition side effects retained |
| Send email | `integrations/gmail/gmail.service.sendEmail`; selected active Gmail sender, saved template or inline subject/body, actual EmailDeliveryLog receipt |
| Send notification | `notifications/notifications.service.createNotification`; selected/current owner |
| Update safe field | Existing CRM update services; Contact notes or Lead description only; relationship status remains protected. Deal description updates have since been retired. |
| Send campaign | `marketing/campaigns/campaigns.service.sendCampaign` → existing audience, quota, atomic campaign claim, recipient logs and centralized Brevo `sendMail` |

Campaign means sending the selected existing draft to its **saved audience once**. It does not silently replace the audience with the triggering record or repeatedly resend a consumed campaign. Partial/failed submission produces a failed workflow action. Provider acceptance does not mean inbox delivery. See [campaign email delivery](../campaign-email-delivery.md).

SMS has no working centralized provider in the audited implementation, so no SMS workflow action is offered. No placeholder success is returned. External workflow Gmail and campaign sending retain existing Sandbox safeguards. Variables are limited to first_name, last_name, email and company.

## G. Input security

Strict shared Zod objects reject unexpected workflow/condition/action wrapper properties. Action metadata rejects unrecognized config keys. Workflow names are trimmed, required, limited to 255 and reject control characters while preserving Unicode. Descriptions are bounded, trimmed and cleaned. Titles are required, trimmed, bounded and reject controls. Subjects use existing `EmailSubjectSchema` before sending, including CR/LF protection. Email HTML uses existing `sanitizeCampaignHtml` when saved and after personalization; script tags, event handlers and unsafe URLs are stripped. Rendered variables are escaped for HTML.

Only documented message variables, reference types, enums and safe editable fields are accepted. Missing or foreign references fail safely. No raw SQL, eval, arbitrary expressions, protected identity updates or caller-supplied tenant/environment assignment is introduced.

## H. Security and reliability

The existing RBAC check is shared by HTTP middleware and the engine through `core/permissions/permission.service.ts`. Active role assignments remain authoritative. Activation stores the author; each action rechecks that author's current permissions, so an unrelated triggering user cannot confer authority and revocation blocks subsequent effects. Tasks reuse the actual `deals.create` route permission; CRM updates require contacts/deals edit; campaigns require campaigns.view/send; email requires campaigns.view and contacts.edit.

Tenant IDs come from authentication. Reference, history and entity lookups are tenant-scoped. Existing environment Prisma scoping plus explicit service context checks separate Sandbox and Production. API transport rejects stale environment responses; workflow cache mutations additionally check workspace identity. The existing global request limiter applies (production default 500/minute/IP, configurable with existing RATE_LIMIT_MAX). Campaign sending retains provider quotas and once-only state claims.

The database unique event claim and run are created in one transaction. Five concurrent copies of the same event produce one action/run. Same-chain recursion tracks visited workflow IDs and limits depth to ten. Each action checks whether the workflow was paused, archived or edited before continuing. External network work occurs outside database transactions. State setters are repeat-safe; independent create/duplicate POSTs intentionally create separate definitions.

Operational limit: this retains the existing immediate in-process execution architecture, not a durable event queue. A process crash can interrupt delivery or leave a run/step marked running; an event emitted after a domain commit can be lost if the process terminates before claiming it. There is no automatic retry or claim expiry, avoiding blind duplicate sends. Review CRM records, campaign receipts and Gmail before any manual recovery. The event claim prevents duplicate processing of a known event; it is not an exactly-once external delivery guarantee.

## I. History

Trigger claim + run are atomic; steps are persisted as running before their action and then success/failed/skipped. Runs store start/end, status and safe error messages. Trigger payload retains the record display name. The UI shows record, trigger, timestamps and ordered outcomes without raw IDs/JSON. Metrics use persisted run aggregates and remain visible during state changes.

Workflow create/update/activate/pause/archive operations use the existing audit service. Domain services retain their own audit behavior. Logs contain workflow/execution/event/status/duration and safe identifiers, not provider credentials or message bodies. Unknown exceptions become generic actionable errors; Gmail receipt-write failure explicitly requires checking delivery before resending.

## J. Responsiveness and persistence

The dedicated builder uses a single sequence on mobile, wrapping header actions and full-width configuration at 320px; larger screens use a right drawer. Existing LeadCRM buttons, tokens, focus handling and dark-mode classes are retained. Browser measurements at 320, 375, 768 and 1440 pixels found document width equal to viewport width. The 320px drawer occupied exactly 320 pixels and its fields/save controls were visually checked.

A synthetic local account created and saved a workflow, refreshed and reopened it with its saved task, and activated it through the browser. After logout and login, the workflow remained active; a second tab loaded the same saved definition. Validate returned success without executing actions. Independent authenticated API sessions also returned the same saved data. A separate browser profile was not available, so cross-profile browser verification is not claimed. The builder's sidebar and breadcrumb correctly identify Workflows. No real customer records or live messages were used for this verification.

## K. Testing

Commands executed locally (database commands targeted a disposable PostgreSQL instance):

| Command/check | Result |
| --- | --- |
| `npm --prefix backend test -- --pool=threads --maxWorkers=1` | 450 passed, 61 skipped; 49 files passed, 7 skipped. Skipped suites require their separate database fixtures. |
| `npm --prefix frontend test -- --pool=threads --maxWorkers=1` | Final rerun: 660 passed across 79 files, including the blank-name regression. |
| `npm --prefix backend test -- src/modules/automation --pool=threads --maxWorkers=1` | 47 passed across 4 files after draft reference and consumed-campaign pause fixes. |
| `npm --prefix frontend test -- src/features/tenant/automation --pool=threads --maxWorkers=1` | 8 passed, including the added blank-name regression. |
| `npm run lint` | All 3 workspaces passed their TypeScript `tsc --noEmit` checks. |
| `npm run build` | Final rerun passed both configured production build tasks (frontend/backend); frontend generated 188 pages including new/edit workflow routes. |
| `npm --prefix backend run db:generate` | Passed. |
| Prisma `validate --schema backend/prisma/schema.prisma` | Passed. |
| Prisma `migrate deploy --schema backend/prisma/schema.prisma` on a fresh database | All 59 migrations applied. |
| Prisma `migrate diff --from-url <disposable database> --to-schema-datamodel backend/prisma/schema.prisma --exit-code` | No difference detected. |

Workflow coverage includes registered HTTP CRUD/activation/pause/archive/history/detail, second authenticated session, Lead/Contact/Deal service effects, typed conditions, foreign IDs, protected fields, RBAC revocation, Sandbox isolation, recursion, five-way concurrent duplicate events, email header/HTML injection, Gmail failures and existing campaign audience/delivery with transport stubs. Automated provider calls are mocked; live Gmail/Brevo delivery is not claimed. Initial failures from migration ordering/index length, a reused test receipt ID and pre-existing split-label assertions were corrected before passing reruns.

## L. Deployment

Run prisma migrate deploy against the production database before deploying the new backend.

Use the existing `npm --prefix backend run db:deploy` deployment command with the production database configuration. Coordinate migration/backend/frontend deployment because the new code expects the added columns and explicit toggle body. Back up the database and pause processing during rollout. Existing workflows will remain paused until an authorized user reviews and reactivates them.

There are **no new required environment variables**. Existing database, authentication, Gmail and Brevo configuration remains applicable; use the established [campaign delivery configuration](../campaign-email-delivery.md). Production must use real authentication/backend data, not mock auth. The API proxy must target the deployed `/api/v1` backend using existing `API_URL` or `NEXT_PUBLIC_API_URL`; the local build warns that its current fallback is localhost. The build also reports an existing workspace-root warning caused by multiple lockfiles. Neither warning prevented compilation.

For rollback, stop workflow execution, retain the additive columns/index and histories, and revert application versions together; do not automatically reactivate definitions. Before production release, verify the real provider connections in the intended environment and account for the immediate-execution/recovery limits in section H. No deployment was performed by this task.
