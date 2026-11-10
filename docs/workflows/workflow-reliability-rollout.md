# Workflow processing and finished-result history

This release keeps the existing PostgreSQL queue, event IDs, publisher permissions,
CRM transactions and execution snapshots. It adds no database migration or worker
infrastructure. Deploying the code alone does not enable unrestricted production
processing. Production deployment, definition changes and backlog retirement need
the owner's approval after review of the concrete release and inventory.

## Runtime policy

| `WORKFLOW_WORKER_ENABLED` | Workflow processing |
| --- | --- |
| `true` | All eligible workflows; independent of general background workers |
| `false` | Disabled, including the legacy scoped worker |
| Unset | Existing behavior: all when general workers are enabled; otherwise the configured `DEAL_STAGE_WORKFLOW_ID`, or disabled |

General and Campaign worker flags retain their existing meaning. Setting the new
flag does not enable Inbox, classification, Campaign submission, or unrelated jobs.
Maintenance and shutdown drain the same scheduler. Health includes non-sensitive
process-local Workflow worker diagnostics; inspect every serving/worker process.
An HTTP 200 or one healthy replica does not establish global queue readiness.

Committed CRM events still enqueue transactionally and wake the worker immediately,
with a 30-second sweep as fallback. Preparation failures use five bounded attempts
and delayed retries only for recognized transient faults. Known permanent failures
and exhausted preparation finish as Failed. Failure to prepare one batch must not
prevent later healthy rows from running. Dispatch already started is never replayed
automatically after an uncertain outcome.

Normal history requests `view=outcomes`; existing API clients default to `view=all`.
Filtering precedes pagination and totals. Stored `interrupted` evidence remains
available, but normal history categorizes it as Failed and retains its review
instruction. Completed, Failed and Skipped are the only normal run labels. A newly
saved event has no finished-history row until processing reaches an outcome.

## Reviewed definition repairs

The following are proposals based on the read-only production inspection on
2026-11-10, not applied changes. Reload current definitions, versions and actual
field types before approving a definition write. Use existing version-checked
draft/publish APIs or the existing builder; never rewrite historical snapshots.

| Saved workflow | Observed definition | Proposed repair |
| --- | --- | --- |
| Contacted to Qualified | Deal Updated; Quotation Sent nonempty; move to Qualified | Keep one intended qualification rule. Require the actual Sales Pipeline ID, current Contacted stage ID, relevant quotation-field change, and a satisfied typed quotation value. Keep Qualified as destination. |
| Deal Stage Change: Qualified | Same broad quotation condition and destination in the inspected snapshot | Compare the latest published definitions. If still redundant, pause this duplicate using the normal pause grant; preserve its definition and history. |
| Lead status to Contacted | Lead Hot status event; move a related Deal from Lead to Contacted | Requires explicit repair. Customer status is derived from related Deals; use a Deal-origin stage/field rule instead. Do not substitute Hot → Contacted or remove feedback protection. |
| Contact status to Contacted | Contact Hot status event; same related-stage action | Same explicit repair requirement; preserve valid Contact email/SMS/status automations. |
| Deal Stage Change to Lost | Deal Updated; cancellation reason nonempty; move to Cancelled | Retain its current business definition unless separately approved. This was the selected scoped worker, not proof that other Workflows were processing. |

Resolve the saved workflow and field IDs from current tenant-scoped options and
keep the resolved IDs in the private rollout inventory. A checkbox uses a true-value
comparison; a text/date/file field uses its supported meaningful-value comparison.
Do not infer the technical key or type from the label “Quotation Sent”. The changed
field condition must use the same canonical technical ID emitted by CRM events.

Legacy starter identities and numeric URLs stay readable, but conflicting customer
status/stage recipes are no longer advertised as working starters. The existing
Automatic Deal Stage Update starter provides Deal-origin routing. Backend policy
requires incompatible saved definitions to be repaired before activation; existing
pause and repair controls remain usable.

## Approved production cutover

1. Complete isolated verification and review the release diff. Verify matching
   frontend, direct API and frontend proxy commit identities after deployment.
2. With approval, deploy with `WORKFLOW_WORKER_ENABLED=false` on every backend
   replica that can process Workflows. Stop old replicas and drain in-flight work.
   Preserve uncertain provider evidence for review. Leave unrelated worker flags
   unchanged. Confirm there is no remaining Workflow processor.
3. Refresh the tenant-specific backlog inventory. Record a UTC cutoff immediately
   before enabling the repaired processor. Review run IDs, counts, definitions and
   any excluded running/claimed/suspicious rows. Resolve excluded pre-cutover work
   before enabling unrestricted processing; a matching eligible count alone is not
   approval to replay the excluded rows. Use existing interruption/receipt evidence
   to reconcile uncertain work, and never force it back to queued. The cutoff retires earlier waiting
   events without replay, as chosen by the owner; it does not undo manual CRM saves.
4. Apply only the reviewed, verified-untouched queued retirement. Never retire a
   running execution or guess a provider outcome. The helper rejects unexpected
   counts and records an audit receipt. Keep excluded rows for separate review.
5. Apply the explicitly approved definition repairs. Enable
   `WORKFLOW_WORKER_ENABLED=true`, verify all-process diagnostics and logs, then
   validate a fresh non-provider Workflow using approved disposable test records.
   Confirm both a matching Completed result and a non-matching Skipped result.
6. Verify that ordinary authorized edits still save and newer manual values remain
   intact. Check that history totals and pagination include finished outcomes only.
   Do not test real email/SMS delivery during this cutover.

The operator helper is `backend/scripts/workflow-backlog-review.sql`. It defaults
to review and rolls its transaction back. It does not load application secrets or
change configuration. Use an existing restricted PostgreSQL service definition and
password file, not a credential-containing URL in commands or chat. Substitute the
reviewed tenant, active same-tenant operator, cutoff and exact eligible count:

```powershell
$workflowTenant = '<reviewed tenant UUID>'
$workflowOperator = '<reviewed operator UUID>'
$workflowCutoff = '<recorded UTC cutoff, for example 2026-11-11T02:00:00Z>'
psql 'service=leadcrm-production' --set=tenant_id=$workflowTenant --set=cutoff=$workflowCutoff --file=backend/scripts/workflow-backlog-review.sql
```

After the inventory and production approval, run the same reviewed cutoff/count:

```powershell
$workflowRetirementCount = '<exact eligible count from the reviewed inventory>'
psql 'service=leadcrm-production' --set=tenant_id=$workflowTenant --set=cutoff=$workflowCutoff --set=actor_id=$workflowOperator --set=expected_count=$workflowRetirementCount --set=workers_stopped=true --set=apply=true --file=backend/scripts/workflow-backlog-review.sql
```

The operator identity is for the maintenance audit receipt; this is a privileged
database maintenance procedure, not an application API or a new staff permission.
Both commands require the operator's existing database access. Do not run the apply
command with live workers or without the owner's cutover approval.

## Recovery

If processing is unhealthy, set the Workflow-only flag false through the approved
deployment process, drain the scheduler, and inspect raw authorized execution
history and safe runtime logs. Manual CRM saves remain separate. Do not convert
uncertain submissions back to queued, remove receipts, or mass-replay old events.
Retired pre-cutover events remain Skipped even after rollback or resume. Re-run only
fresh, explicitly intended business events after correcting the underlying issue.
