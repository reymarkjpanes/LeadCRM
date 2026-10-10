# Workflow assignment and run history

This refinement keeps the existing immediate, sequential Workflow engine and domain services. Tasks and CRM records continue to store exactly one `assignedUserId`.

## Assignment contract

Create Task and Assign Agent accept `config.assignmentTarget`:

```ts
type WorkflowAssignmentTarget =
  | { type: 'record_owner' }
  | { type: 'user'; id: string }
  | { type: 'role' | 'group'; id: string; strategy: WorkflowAssignmentStrategy;
      availability?: WorkflowAvailability; capacity?: WorkflowCapacity;
      sticky?: { fallback: 'round_robin' | 'least_workload' | 'random'; preferCurrentOwner: boolean } };
```

`record_owner` is available only for Create Task. Omitted task assignments retain that behavior. Legacy `create_task.config.assignedUserId` and `assign_owner.config.userId` remain readable and executable. Explicit edits save the canonical shape; migration does not rewrite Workflow JSON. If both shapes are present, the explicit `assignmentTarget` takes precedence.

All users and membership lookups are tenant-scoped. CRM owners use the existing sales-agent policy. Task assignees need active membership and Tasks view permission through an unarchived role, or explicit Client Admin identity. Automatic Role/Group pools exclude Client Admin; explicit task user/current-owner selections can still select that administrator. Guest users are excluded. Groups grant no permissions.

Role/Group membership and eligibility are resolved for each execution. Unavailable, archived or empty targets fail with an actionable error and subsequent actions are skipped. Previous Tasks and runs are never reassigned when membership changes. Pausing uses the existing independent path even if a reference is invalid.

Pool rotation uses `TenantPreference`, module `workflow-assignment`, key `workflowId:actionIndex:targetType:targetId`. Eligible IDs are ordered; selection continues after the last selected ID, wrapping as needed even if that member was removed. Serializable transactions retry serialization or initial cursor-creation conflicts, with a bounded retry count. A turn is reserved before the domain service runs; if that later action fails, its reserved turn remains consumed and its resolved-assignee output is retained. This is not an automatic action replay mechanism.

Dry-runs preview the next candidate without changing records or cursor state. They project Assign Agent into later in-memory task steps. Previews can differ from a future execution if membership, permissions or the cursor changes in between.

## Assignment methods and settings

In Create Task or Assign Agent, choose Role/Group, then **Assignment method**. Settings belong to that action, save with its definition, increment the workflow version, and appear in historical snapshots. Existing round-robin definitions remain valid.

| Method | Selection and configuration |
| --- | --- |
| Round-robin | Next eligible member in stable rotation. |
| Least workload | Fewest active tasks for Create Task, or active records of the triggering CRM type for Assign Agent. Equal workloads rotate. |
| Random | Cryptographically unbiased selection from the eligible pool. Dry tests show a sample; live execution draws again. |
| Availability-based | Weekly default shift, IANA timezone and optional per-member shift/unavailable overrides. Available members rotate. |
| Capacity-based | Required default maximum workload, optional per-member limits. Select the least-loaded member below their limit; ties rotate. |
| Previous assignee / Sticky assignment | Reuse the previous successful assignment for the same tenant, workflow, action, pool and record. Optionally begin with the current record agent. Choose round-robin, least workload or random as fallback. |

Availability and capacity filters can also be enabled for other methods, including sticky assignment. Limits are positive whole numbers up to 10,000. All schedules use the selected timezone and its daylight-saving rules. Overnight shifts belong to the starting weekday; shift end is exclusive. Members marked unavailable are skipped. New pool members inherit defaults; saved overrides for former members are retained and can be removed in the editor. Override references must belong to the current tenant.

Task workload includes pending, in-progress and blocked tasks, excluding completed/cancelled/archived work. CRM workload counts unconverted, unarchived Leads, unarchived Contacts/Accounts, or Deals in non-Won/non-Lost stages. The record being reassigned is excluded so retaining its current owner does not consume a second slot. Workload is measured across the tenant, not just tasks created by this workflow. Manual assignment remains governed by the normal CRM/Task rules; action-level limits control automatic workflow assignments.

Least-workload and capacity decisions reserve five-minute leases in `TenantPreference` (`workflow-assignment-pending`) in serializable transactions. Concurrent workflow/pool decisions include active reservations for that user and workload type. Existing domain services perform the actual write; success or failure releases the lease, while expired leases are ignored after interrupted processes. In-flight sticky selections use a separate short lease so concurrent initial selections agree; only successful assignments enter durable sticky history. These leases are internal, inaccessible through preference APIs and omitted from execution output. They do not provide a global limit on manual writes or a transaction spanning all workflow actions.

If nobody satisfies eligibility, availability or capacity, the action fails with an actionable message and remaining actions are skipped. There is no silent overflow or fallback outside the selected pool. A failed action releases workload reservations; the rotation turn remains consumed. Dry runs write no leases or sticky history and project earlier task workload into later steps. Run details record method, selection reason, prior workload and the applicable capacity limit.

These settings reuse Workflow JSON and TenantPreference; no additional database migration is needed beyond the assignment/history migration below.

## API and permissions

`GET /api/v1/automation/workflow-options` adds `taskAssignees`, `roles`, and `groups`. Pool options include `memberCount` and `eligibleMemberCounts: { crm_owner, task_assignee }`, since those policies differ. `users` remains the CRM-owner list.

User choices require `users.view`; role choices require `roles.view`; group choices require `groups.view`. Role/Group references also require their corresponding view permission on save and activation. Workflow activation retains `workflows.activate`, trigger-record view permission and existing action grants, including `tasks.create` and `tasks.assign`. Execution rechecks the activation author's authority. All ownership changes continue through the existing CRM/Task services.

## Definition history

Workflows start at `version = 1`. Changes to trigger, conditions or actions increment the version atomically. Name/description changes and activation/pause/archive transitions do not increment it. Legacy-to-canonical assignment normalization alone is not a new execution definition.

New runs store `workflowVersion` and `definitionSnapshot` from the loaded definition. Step output retains target type/ID/name, resolved user ID/name, strategy and candidate count, plus the created Task or affected record. The builder and detail panel show the current version; run history shows the executed version and definition independently of later edits.

## Migration

`20261115000000_workflow_assignment_history` follows the repository's existing migration order. It adds version/snapshot columns, a unique `(executionId, stepIndex)` index, and a same-tenant activation-author foreign key. Historical runs retain null version/snapshot values because their original definitions cannot be reliably reconstructed.

The migration checks duplicate step positions and invalid activation authors first and rolls back with an error if either exists. It never deletes runs, repairs authors silently, resets a database, or changes prior migrations. Review conflicts before deploying:

```sql
SELECT "executionId", "stepIndex", count(*)
FROM "WorkflowExecutionStep"
GROUP BY "executionId", "stepIndex" HAVING count(*) > 1;

SELECT w.id, w."tenantId", w."activatedById"
FROM "Workflow" w LEFT JOIN "User" u
  ON u.id = w."activatedById" AND u."tenantId" = w."tenantId"
WHERE w."activatedById" IS NOT NULL AND u.id IS NULL;
```

Apply the additive migration before running the updated backend. Verification here uses disposable databases; the configured CRM database is not migrated by tests.

## Verification plan and coverage

| Area | Test type | Required behavior |
| --- | --- | --- |
| Contracts and selection | Unit | Legacy normalization, required settings, timezone/overnight shifts, workload/capacity, sticky completion, serialized conflict retries, dry-run immutability |
| Assignment execution | Integration with full migration replay | User/Role/Group, one owner, current-owner projection, task-only staff, dynamic membership, admin exclusion, tenant isolation, RBAC denial, duplicate event suppression |
| Definition history | Integration | Execution changes increment versions, lifecycle changes do not, old snapshots remain stable, archived workflows cannot reactivate |
| Migration | Disposable PostgreSQL via PGlite | Preserve legacy JSON/null history; reject duplicate steps and foreign authors; rollback without loss |
| Builder and runs | Component | Canonical saves, task-specific choices, unavailable references, purpose-specific counts, summaries and historical versions |
| Browser | Built app with disposable API/database | Each method saves, reloads, previews and executes; keyboard group selection, historical snapshots, real auth stream; 320/375/390/768/1024/1440 px overflow checks |

Useful commands from the repository root:

```sh
npm run lint
npm run build
npm --prefix frontend run test -- src/features/tenant/automation/workflows --maxWorkers=2
npm --prefix backend run test -- src/tests/migrations/workflow-assignment-history.test.ts src/modules/automation/workflows/__tests__/workflow-assignment.test.ts
node backend/scripts/test-workflow-polish.mjs src/modules/automation/workflows/__tests__/workflow-assignment.integration.test.ts
node backend/scripts/test-workflow-polish.mjs src/modules/automation/workflows/__tests__/workflow-strategies.integration.test.ts
node backend/scripts/verify-workflow-browser.mjs <installed-playwright-package>
```

Production builds require an HTTPS `API_URL` ending in `/api/v1`; local validation can use a non-routable build placeholder. Browser verification redirects transport to its disposable local API. PGlite integration tests exercise concurrent calls with a serialized database connection; conflict retries are separately tested with explicit transaction conflicts. Multi-connection PostgreSQL load testing and migration rehearsal on a production copy remain deployment checks. Gmail/SMS provider delivery is outside this assignment refinement and is not exercised against live recipients.

## Verified results — 2026-10-09

- 269 distinct Workflow tests passed: 113 frontend component/service tests, 97 backend integration tests, and 59 backend unit/migration tests. Coverage includes all assignment methods, availability, capacity, concurrent reservations, sticky completion/failure, tenant isolation, RBAC and immutable previews.
- Another 106 cache/auth/dashboard/task regression tests and nine deployment rollout checks passed. Auth event refreshes now notify mounted cached pages to discard old data and restart requests; signed-out and revoked scopes remain protected. Deal history assertions distinguish the initial stage entry introduced by the latest main branch from actual transitions.
- All three workspaces passed `npm run lint` and production builds. The frontend also passed a fresh production build after the auth/cache integration fix.
- All 71 built-app browser checks passed against a disposable API/database. Coverage includes all five new methods saving, reloading, previewing and executing through real domain services, keyboard group selection, immutable history, real auth event streaming and layouts at 320, 375, 390, 768, 1024 and 1440 pixels. No page or transport errors were recorded.
- Availability at 320px and capacity at 1440px were visually reviewed; the controls fit their panels. The earlier assignment/history screenshots were also reviewed.
- `git diff --check` passed. The configured CRM database was not changed; apply the additive migration before starting the updated backend.

The browser script writes its local evidence to `data/outputs/workflow-browser/results.json` and screenshots in the same ignored output directory.
