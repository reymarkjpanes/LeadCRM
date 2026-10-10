# Notifications implementation and verification report

Date: 2026-10-09. Scope: existing LeadCRM notification module, shared contracts, persisted event producers, permissions, preferences, delivery operations, and existing UI integrations.

**Status: implemented and verified locally; production sign-off is pending.** No production database was changed, no application was deployed, and no external email or SMS was sent by this work. Legacy delivery reconciliation and the deployment checks below are release requirements.

## 1. Audit findings

| Severity | Confirmed cause | Resolution |
|---|---|---|
| High | Deleting a Notification removed its only event identity; replay could recreate it. | Separate permanent recipient/event delivery ledger, transactional delivery claims, deletion tombstones, and a database replay guard. |
| High | History polling used timestamp overlap and mutable offset pagination, with no shared instance lease. It could miss late commits or overlap other workers. | Source writes enqueue events in the same database transaction; bounded workers claim with `FOR UPDATE SKIP LOCKED`, persistent leases, retry attempts and backoff. |
| High | Direct notification writes and history projection overlapped; Deal reassignment coverage depended on which write path ran. | Removed direct writes from legacy Lead/Deal services. Database triggers capture actual assignments across services, imports, batches, workflows and deactivation transfers. |
| High | Administrative recipients could qualify through a stale primary-role string; customer history and destinations were not consistently reauthorized. | Require an active tenant-scoped Client Admin role relationship; check source ownership, module permissions and active account state on delivery, feed presentation and click. |
| High | Reply projection used CRM identity without enforcing the Inbox's mailbox scope. A duplicate copy in a different mailbox could consume the intended recipient's event identity. | Reuse authoritative mailbox scope, require current assigned ownership and the recipient's active mailbox, deduplicate provider identity per eligible owner, and open the actual thread. |
| High | Preferences were local switches with success feedback but no saved delivery policy. | Authenticated UserPreference persistence, server-enforced optional in-app preference, confirmed saves, failed-load protection, and explicitly disabled unsupported channels. |
| High | Reminder polling ignored explicit `reminderAt` and had no durable rescheduling identity. | Persist due/reminder jobs, version relevant Task changes, distinguish overdue from due, and recheck eligibility under a database read lock during delivery. |
| High | Campaign failure keys identified the campaign for its entire lifetime. Separate failure reports could also duplicate a run before submission started. | Persistent Campaign run version changes on genuine retry/schedule/submission transitions; row and audit producers share one failure key per run. |
| Medium | Persistent mailbox failure identity did not reliably reset after recovery. | Durable incident identity and failure start time, 15-minute persistence threshold, current-incident recheck and recovery reset. |
| Medium | Independent frontend consumers downloaded feed pages for badge refresh and could apply stale requests around mutations or identity changes. | Shared scoped count polling, shared in-flight reads, scoped mutation locks, request invalidation, identity guards and snapshot/keyset pagination. |
| Medium | Mutation/query validation, bulk size and foreign-recipient handling were inconsistent. | Strict shared schemas, UUID validation, 100-row pages, 500-ID atomic deletion, consistent 404s and authenticated scope only. |
| Medium | Some links opened only module lists. | Existing Contact/Lead/Account/Deal detail routes, Task drawer, Workflow execution view, Campaign view, Form builder and Inbox thread integration. |
| Medium | Shared bootstrap treated an expected 403 from an optional staff module as a global data-load failure. | Keep permitted results and treat structured 403 responses as unavailable optional module data; genuine transport errors still surface. |

The specification's proposed Contact/Lead rename was **not supported by the current route wiring**: `crm/contacts/contacts.service.ts` backs `/crm/leads`; `/crm/contacts` uses `contacts-v2`. The implementation follows the actual persisted entity. A real authenticated Contact POST is tested to produce exactly one `contact_assigned` notification with a Contact destination.

## 2. Code changes

| Area | Main files | Change |
|---|---|---|
| Contract | `shared/src/contracts/notifications.ts` | Fixed event catalog, query and preference schemas, counts, cursor/snapshot and availability contract. |
| Persistence | `backend/prisma/schema.prisma`; `backend/prisma/migrations/20261114000000_notification_delivery/migration.sql` | Additive outbox, delivery ledger, source triggers and scheduling versions. |
| Delivery | `backend/src/modules/notifications/notifications.service.ts`; `notification-events.service.ts` | Central recipient resolution, authorization/preferences, atomic delivery, leases, retries and bounded fair tenant traversal. |
| Access/preferences | `notification-access.ts`; `notification-preferences.service.ts` | Current role, ownership, mailbox and destination checks; persisted preferences. |
| API | `notifications.repository.ts`; `notifications.controller.ts`; `backend/src/api/routes/notifications.routes.ts` | Stable pagination, single-query counts, atomic scoped mutations, destinations and admin diagnostics. |
| Business integration | `backend/src/modules/crm/contacts/contacts.service.ts`; `crm/deals/deals.service.ts`; `crm/deals/deal-batch.service.ts`; `crm/leads/lead-automation.service.ts`; `operations/tasks/tasks.repository.ts` | Remove competing writes; preserve actor context in canonical sales/task transactions. |
| Context/runtime | `backend/src/api/middleware/auth.middleware.ts`; `core/tenant/tenant-models.ts`; `notification-actor.ts`; `notification-worker.ts`; `backend/src/server.ts`; `backend/start.js`; `backend/package.json` | Tenant registry, separate actor context, safe worker shutdown and dedicated compiled worker entrypoint. |
| UI state | `frontend/src/features/tenant/notifications/hooks/`; `frontend/src/shared/services/notifications.api.ts`; notification page/dropdown/topbar | Counts-only bell, recent-five dropdown, authoritative mutation feedback, scoped request lifecycle, loading/error/retry and selection limit. |
| Existing destinations | `frontend/src/features/tenant/{automation/workflows,marketing/campaigns,marketing/forms,inbox}/ui/`; `notifications/notification-destination.ts` | Open the existing permitted record view from controlled query parameters. |
| Settings/bootstrap | `frontend/src/features/tenant/settings/ui/profile-settings-page.tsx`; `frontend/src/store/DataContext.tsx` | Real preference controls and correct optional-module permission failure handling. |
| Verification | `backend/scripts/test-notifications*.mjs`; `notification-test-postgres.mjs`; `verify-notifications-browser.mjs`; `verify-notification-scale.mjs`; notification and existing regression test files | Disposable database, browser, crash recovery, scale and migration evidence. |

The page, bell, dropdown, tabs, card layout, shared confirmation dialog, typography and existing record views remain in place. Unsupported email, briefing and SMS switches remain visible, disabled and labeled unavailable. They do not claim delivery.

## 3. Database changes and preservation

The forward migration runs in a transaction, using UTC for its timestamps. It creates:

- `NotificationEvent`: unique `(tenantId,eventKey)`, source identity, event-time owner/actor, safe structured facts, occurrence/availability timestamps, attempts, lease, completion and failure category. The event catalog has a SQL check constraint.
- `NotificationDelivery`: primary key `(tenantId,userId,eventKey)`, tenant/user foreign keys and constrained outcome (`delivered`, `deleted`, `disabled`, `ineligible`, `legacy_baseline`). Delivery and visible insertion commit together. Deletion leaves its identity in this table.
- `Notification.occurredAt` and recipient/time plus recipient/read/time indexes; event indexes support scoped pending claims and operational inspection.
- `Task.notificationVersion`, `Campaign.notificationRunVersion`, and EmailAccount incident/failure timestamps.

Existing Notification IDs, text, read status, `readAt` and `createdAt` are not rewritten. Existing non-null event keys are copied into the ledger. Existing nullable event keys and legitimate history are retained. No sample feed is seeded by the migration.

Database triggers capture structured committed transitions. A rolled-back business transaction also rolls back its event. Failure of later delivery cannot undo a committed business operation. Raw SQL exceptions to the existing tenant guard are narrowly limited to parameterized lease claims, the transaction-local actor setting and the scoped Task eligibility lock.

Existing actionable Tasks receive future schedules. **Pre-cutover reminder times are recorded as consumed baseline identities**, preventing an old deleted reminder from being recreated. This does not assert that an absent legacy notification was delivered. Legacy reconciliation below is mandatory before deployment. No bulk historic CRM replay occurs.

## 4. Implemented event and recipient matrix

All recipients must be active and eligible in the same tenant. Staff must retain source ownership and module visibility. Administrative routing requires an active Client Admin role relationship. Assignment actors are excluded from ordinary self-assignment alerts.

| Source/event types | Recipients | Identity / destination |
|---|---|---|
| Lead create/reassignment: `lead_assigned` | New assigned employee; Website/Form creation also Client Admin | Creation ID or committed assignment occurrence; Lead detail, or permitted converted Contact. |
| `contact_assigned`, `account_assigned`, `deal_assigned`, `task_assigned` | Assigned employee | Creation or actual owner-change occurrence; corresponding detail or Task drawer. Ordinary assignments do not broadcast to admins. |
| Lead/Contact `customer_hot`, `customer_cold`, `customer_cancelled` | Owner; Hot/Cancelled also Client Admin | Actual structured status transition; current permitted customer record. |
| `deal_progressed`, `deal_won`, `deal_lost` | Owner; Qualified/Won/Lost also Client Admin | DealStageHistory ID and stage/owner snapshot; Deal detail. Contacted is owner-only. |
| `closing_requirements_needed` | Responsible owner | Qualified stage-history ID; Deal detail. |
| `closing_requirements_completed` | Client Admin | Confirmed Won history ID; Deal detail. |
| `task_due`, `task_overdue` | Current assigned employee | Task ID, due time, assignee and scheduling version; Task drawer. Explicit reminder time overrides the 24-hour fallback. |
| `customer_reply` | Assigned Lead/Contact owner with access to the linked message in their own active mailbox | RFC message identity or account/provider identity, plus owner; permitted Inbox thread. Initial history, outbound and excluded folders do not alert. |
| `campaign_failed` | Campaign creator/owner with visibility and Client Admin | Campaign run version shared by delivery and scheduling failures; existing Campaign view. |
| `workflow_failed` | Client Admin | Failed execution-run ID; Workflow execution view. |
| `user_created`, `user_status_changed` | Client Admin | Actual persisted creation/status transition; Team Management. Private historical feeds are not transferred on deactivation. |
| `mailbox_disconnected`, `mailbox_sync_failed` | Mailbox owner and Client Admin | Account incident ID; Inbox or permitted administration view. Recovery permits a later distinct incident. |
| `form_processing_failed` | Client Admin | Persisted failure-audit ID; related Form. |
| `record_archived`, `record_restored` | Client Admin, subject to current source availability | Existing structured audit occurrence. Archived/unavailable sources remain manageable as redacted historical notifications. |

Notification reads do not mutate email read/unread labels. Bell and Inbox counts remain independent. Generic bodies avoid sender addresses, email subjects and message text. Inaccessible historical notifications retain their read/delete controls with redacted content and no destination.

## 5. Integration and security results

- Authenticated Contact creation, assignments, bulk/canonical CRM paths, Lead conversion, Deal stage history, Task scheduling, Workflow actions and deactivation transfers are exercised with real SQL persistence.
- Foreign-tenant and same-tenant foreign-recipient reads/mutations are denied; atomic mixed-ID deletion rolls back the entire request. Query parameters cannot select another recipient. Unauthenticated access is rejected.
- Inactive users and stale/archived admin roles cannot receive unauthorized deliveries. Loss of ownership, module permission or record availability redacts historical data and invalidates its deep link.
- Repeated mailbox ingestion and duplicate provider identities do not duplicate customer replies. A copy in an administrator's mailbox does not consume the assigned employee's event identity. Mailbox/CRM authorization and historical-message exclusions are checked.
- Preferences persist across new authenticated sessions; disabling optional in-app delivery is durable. Re-enabling does not replay events already consumed while disabled. Account-integrity notifications remain enabled.
- Campaign tests cover repeated failure signals in one run and later distinct runs, including failures before `submissionStartedAt` exists. Workflow failures use actual persisted execution results.
- Source and mutation requests continue through the existing authentication, tenant, workspace-readiness and API rate-limit middleware. Source-record access never comes from caller-supplied notification destinations.

The Groups regression had conflicting old expectations. The current Groups route and its dedicated integration suite intentionally permit tenant staff to read the directory while restricting membership writes. The regression now asserts that policy; product permissions were not broadened.

## 6. Test commands and results

Commands run from the repository root unless otherwise stated. Windows sandbox restrictions required approved local execution. All databases were disposable; scripts use explicit local test database names and do not connect to the configured production database.

| Command / suite | Evidence |
|---|---|
| `npm run lint` | All three workspaces passed TypeScript checks. |
| `$env:API_URL='https://leadcrm-build.example/api/v1'; npm run build` | Shared, backend and frontend production builds passed; final backend-only changes also rebuilt with `npm --prefix backend run build`. Placeholder API origin was used only for the local build. |
| `node node_modules/prisma/build/index.js validate --schema backend/prisma/schema.prisma` | Prisma schema valid; validation used an inert local URL. |
| `node backend/scripts/test-notifications.mjs` | Populated migration preservation passed; **21 focused tests passed, 2 files** on final source. |
| `node backend/scripts/test-notifications-postgres.mjs` | Real PostgreSQL 17, four connections, full migration chain, independently recreated databases: **312 tests passed, 15 files** in the complete run. The final Task race case and affected CRM suite passed separately, as detailed below. |
| `npm --prefix frontend run test -- src/features/tenant/notifications src/features/tenant/inbox/ui/inbox-page.test.tsx` | **27 passed, 5 files.** Includes stale-user responses, mutation locks, failed save/load, deep-link permission delay and stale destination rejection. |
| `node backend/scripts/verify-notifications-browser.mjs` with `PLAYWRIGHT_MODULE` set to the installed Playwright package | **29 checks passed** in headless Chrome against the built frontend and real local API/PostgreSQL. Zero page exceptions and transport exceptions. |
| `node backend/scripts/verify-notification-scale.mjs` | Scale, independent processes and actual process termination/recovery passed; measurements below. |
| `node backend/scripts/verify-notification-worker.mjs` | Actual compiled `dist/start.js --notifications-worker` started, delivered, restarted and preserved deleted-event identity. |
| `git diff --check` | Passed. |

Native PostgreSQL suite breakdown: notification HTTP 5; durable delivery 16; Lead polish 12; CRM completion 14; sales automation 28; Product normalization 3; Tasks 18; scoped mailbox 60; Campaigns 42; Workflows 52; Workflow polish 19; permissions 10; auth middleware 17; employee account policy 14; session revocation 3. **313 distinct tests passed across the completed runs, with no remaining failures in these suites.** After the complete 312-test run, the new Task completion race case and the affected suites passed with `node backend/scripts/test-notifications-postgres.mjs src/modules/notifications/notification-delivery.integration.test.ts src/modules/crm/leads/crm-completion.integration.test.ts` (**30 passed**: 16 delivery + 14 CRM completion). Repeated cases are not added twice to the 313 total.

Browser checks cover the 99+ badge, zero hidden-dropdown feed fetches, recent five, outside click, Escape/focus return, tab keyboard operation, SQL ordering, pagination, Contact and Task navigation, persisted reads, individual/bulk deletion, cancellation, failed deletion with retained selection, modal focus containment/restoration, mark-all across unloaded rows, unavailable records, retry, saved preference behavior and another user's isolated feed. Dropdown, page and delete dialog were checked at **1440, 1280, 768, 390 and 320 px**; screenshots were visually inspected. Reduced motion was enabled.

The browser harness redirects `/api/proxy` transport to the local API because the production frontend requires a public HTTPS API origin. It uses genuine authentication sessions and SQL data, not mock notification responses, except deliberately injected 503 failures. This does not verify production proxy configuration or real sign-in/OAuth UI.

Failures encountered and resolved: invalid old fixture permissions, outdated Groups expectation, custom-checkbox pointer targeting (verified with its supported keyboard interaction), Windows Prisma DLL lock while tests held the engine, sandbox localhost/worker restrictions, and a PGlite socket rollback limitation. Native PostgreSQL supplies the concurrency evidence. No failed run is counted as a pass. Existing Next multiple-lockfile and Vite config-loader warnings remain non-fatal.

Ignored local evidence: `data/outputs/notification-verification/postgres-regressions.log`, `final-reminder-checks.log`, `browser/results.json`, browser PNGs and `scale.json`. These artifacts are not Git inputs.

## 7. Measured performance and worker behavior

Local PostgreSQL 17 dataset: **20 tenants, 200 active employees, 119,500 historical notifications**; the measured user's history contained 20,000 unread rows before the assignment burst. Twenty measured warmed requests per endpoint:

| Measurement | Observed |
|---|---:|
| Counts median / p95 / maximum | 14 / 21 / 22 ms |
| 20-row feed median / p95 / maximum | 42 / 65 / 76 ms |
| 20 concurrent authenticated count requests, including session issuance | 161 ms total |
| 240 persisted assignments, killed-worker recovery and two delivery processes | 4,621 ms total |
| Idle traversal of 20 tenants | 33 ms |
| Duplicate deliveries after recovery | 0 |

The feed query used the recipient/time index with an index-only scan and incremental sort, rather than scanning the whole notification history. The final count implementation computes total and unread in one grouped SQL snapshot, preventing inconsistent pairs during concurrent mutations. These are local measurements, not production SLAs. Large mailbox-scope histories and sustained provider event bursts need deployment-specific load testing.

Workers run every five seconds, traverse at most 50 tenants per cycle, and normally claim 25 events per tenant (hard limit 100 for explicit calls). Tenant traversal is a fair bounded ID window; a failed tenant cannot advance another tenant's event state. A restarted traversal may revisit tenants, but outbox/ledger state remains authoritative. At large tenant counts, budget for approximately one traversal every `ceil(tenantCount/50) * 5 seconds` plus work time.

Claims expire after 120 seconds. Failure attempts persist with a safe category and exponential retry delay from two seconds to one hour. A delivery claim and notification insert roll back together. A failed recipient can be retried without duplicating recipients already completed. The crash test actually killed a child process during delivery, then expedited the stored lease expiry instead of waiting 120 seconds; two independent child processes recovered the work without duplicates.

Shutdown stops new claims and awaits current work; an externally terminated job is recovered through its lease. No single web instance is required: the dedicated worker uses the same durable queue and can run under a process supervisor.

## 8. Deployment, recovery and rollback runbook

### Required cutover preparation

1. Back up the production database and establish the serving frontend/backend revisions, migration ledger and drift state. Validate earlier guarded CRM retirement migrations through the existing deployment procedure; do not bypass them to apply this migration.
2. Pause business writes, provider ingestion and old notification workers for a controlled cutover. Reconcile the old `TenantPreference` notification delivery cursor and committed source history through the pause boundary. The old implementation did not retain deletion identities; missing historical rows are ambiguous. **Do not reset its cursor to replay all history.** Review genuinely pending legacy events and historical deletions before deciding any recovery. No automatic migration can infer that missing evidence reliably.
3. Apply `20261114000000_notification_delivery` with the normal migration deployment path after previous required migrations. Verify retained Notification row IDs/read timestamps, new indexes/triggers, delivery-ledger backfill and future Task schedules. Confirm the database/session timezone is UTC; display and existing task configuration continue to use the application's Manila policy.
4. Deploy the matching backend/shared/frontend build before resuming writes. Remove the old history scheduler and direct-delivery instances from service; a mixed old/new rolling interval is not the recommended cutover. The compatibility identity triggers preserve tombstones but cannot make different legacy producer keys equivalent.
5. Start the new supervised worker. Resume writes and verify new Contact assignment, Task reminder, employee isolation, preference persistence, mailbox visibility, counts and deep links with authenticated sessions in the deployed environment. Check actual live mailbox/provider evidence separately. Review existing disconnected/failing mailboxes: a legacy incident first observed after cutover can be treated as a new incident, and must be reconciled if that would repeat an old alert.

### Configuration and commands

The worker uses the existing backend environment and its validation. Keep database/session timezone UTC and use the same tenant/auth configuration as the web backend. The standalone production validator also requires the application's normal provider/origin variables, although the notification worker sends no email or SMS.

```powershell
# After building the backend, run under the deployment platform's process supervisor:
npm --prefix backend run start:notifications
# Equivalent from backend/: node dist/start.js --notifications-worker
```

Set `NOTIFICATION_WORKER_ENABLED=false` on web instances if the dedicated worker is used. Multiple enabled web/worker instances are safe; monitor queue age and database connections. Set restart policy and termination grace to allow current work to finish; hard termination falls back to the 120-second lease.

### Monitoring and replay

`GET /api/v1/notifications/operations` requires an authenticated current Client Admin. It reports only that tenant's pending count, retries, active leases, oldest due occurrence and at most 50 failed event summaries. It never returns payloads, customer message text, credentials or another tenant's jobs. Server logs include safe tenant/event/type/attempt/category metadata.

Monitor growing due age, repeated failure categories, expired leases, worker availability and queue growth. Resolve configuration/database failures before replay. For a reviewed **post-cutover** event, requeue only its exact tenant/event row by clearing `processedAt`, `leaseToken` and `leaseUntil` and setting `availableAt` to now. Keep attempts/failure evidence for investigation. **Never delete the delivery ledger** to replay: its existing delivered/deleted/disabled/ineligible identities make retries safe. Do not replay migration baseline jobs or fabricate new keys for old deleted notifications.

There is deliberately no automatic history/ledger purge. Retain delivery identities at least as long as source events could be replayed. Define and approve a tenant retention policy before adding cleanup; it must not allow a retained event to recreate a deleted notification.

### Rollback

Stop notification consumers first; leave additive tables, columns, triggers and ledger intact so business writes continue to record events. Roll back application code only to a version compatible with those additions, with its old notification scheduler disabled. Do not drop the outbox, ledger, indexes or trigger functions to roll back the UI. Repair forward and resume durable processing. Verify the deployment has not silently resumed the legacy overlapping scheduler.

## 9. Remaining limitations and release requirements

- Production migration, backup restore, deployment identity, process-supervisor behavior, live authenticated browser sessions and live Gmail/provider delivery were not verified. **I cannot confirm this.**
- Legacy events committed before transactional capture may have been missed by the old overlap dispatcher. Deleted pre-migration rows have no durable deletion evidence. The implementation preserves remaining history and avoids indiscriminate replay; legacy reconciliation is an outstanding deployment gate, not a claimed recovery.
- Existing pre-cutover mailbox incidents require the cutover review described above. New incidents have durable recovery/reset semantics.
- Optional email, daily briefing and SMS channels remain unavailable and disabled. Only persisted in-app delivery is implemented. The existing legacy Campaign scheduler is not made into a working provider sender by this module; only actual persisted failure signals are projected.
- Browser verification covers Contact and Task destinations end to end. Inbox destination authorization is tested through real API/SQL, and Campaign/Workflow/Form links reuse their existing fetched record views; a full browser/provider matrix for those destinations is not claimed.
- Local load evidence covers assignment bursts, counts and feed history. It does not establish sustained production throughput for very large mailbox scopes or simultaneous provider/Workflow bursts.

## 10. Readiness decision

The notification implementation has local persistence, security, concurrency, preference, migration and UI evidence. The finalized interface is preserved. **Production sign-off remains blocked until the legacy cutover reconciliation and deployed-environment checks are completed.** A successful build alone is not sign-off. No commit, push or deployment was performed.
