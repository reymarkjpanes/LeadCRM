# Workflow polish — 2026-10-03

This update keeps the existing Workflows list and builder. It supersedes the older reports where they describe Client Profile labels, campaign/notification actions, safe-field restrictions, or SMS as unsupported. Code was transferred to `OWN-CRM-1` after checking that the original repository was clean and on the same commit. An original-file backup remains in the Codex workspace.

## Behavior

- Contact replaces Client Profile in Workflows. Assign Agent replaces Assign Owner; the stored `assign_owner` identifier remains compatible.
- Lead Updated, Contact Updated, Deal Updated and Account Updated are available. Normal record services compare persisted before/after values, ignore bookkeeping changes and do not emit an event for an unchanged save. Conversion events are emitted after commit. Direct database writes do not invoke application workflow services.
- Workflow names are unique per workspace, including archived records. Case and repeated/surrounding whitespace do not distinguish names. The API and an expression index protect concurrent saves. Duplicate suggests an available Copy name.
- New actions are Create Task, Send Email, Send SMS, Assign Agent, Update Fields and Move Deal Stage. Send Campaign and Send Notification are retired. Existing saved steps remain readable and must be disabled or removed before activation; normal system notifications continue independently.
- Update Fields uses typed controls and the normal CRM schemas, references and permissions. System identifiers and lifecycle evidence are excluded. Governed stage changes use Move Deal Stage. Deal Value is editable only from the action's Custom Fields group; confirmed/Won sale values remain preserved.
- Empty Product Interest and Others are distinct. Empty/not-empty operators need no comparison value. Others is a catalog choice with optional details. Clearing is explicit; removing Others clears its dependent details.
- SMS resolves the record or the chosen primary relationship. It checks international phone numbers and Do not contact, personalizes from the recipient, and records provider submission. An event retry does not send again. Ambiguous account contacts fail with a clear error. Provider acceptance is not a handset-delivery guarantee; uncertain submissions are not automatically retried.

## Qualified Deal Follow-up

The recipe uses Deal Stage Changed, an actual Qualified destination stage ID, AND Has ever reached Won = No, AND Stage history verified = Yes. It runs on a real transition into Qualified, including Lost → Qualified for a verified never-Won deal. Creating directly in Qualified, editing a Qualified deal, saving the same stage, or replaying the same event does not produce another follow-up. A distinct eligible re-entry can run again.

Workflow exclusion and pipeline validation are separate. Existing pipeline rules still keep Won terminal. A customer returning after a completed sale needs a new Deal. The persistent ever-Won flag also excludes historical Won → Lost → Qualified data. Database enforcement prevents clearing positive Won evidence. Legacy negative history remains unverified unless supported by a deliberate data review; absence of evidence is not treated as proof that a deal was never Won.

The builder has immediate sequential actions, not a delay queue. Before each step, the engine refreshes the record and stops a stage follow-up if it has left its triggering stage. Due dates on tasks do not delay execution.

## Database and provider preparation

Three additive migrations are included; none were applied to the user's database during this work:

1. `20261022000000_workflow_record_lifecycle`: optional Others details, persistent Won evidence, conservative legacy backfill and monotonic history protection.
2. `20261023000000_workflow_unique_names`: normalized name function and workspace uniqueness index. Existing conflicting names deliberately stop deployment and report IDs; rename conflicts intentionally, including archived records, before retrying. The migration never silently renames or deletes workflows.
3. `20261024000000_workflow_action_retirement`: pause active workflows with enabled retired actions and incorrectly configured workflows named Qualified Deal Follow-up; preserve all configuration and history. Seed Others for existing enabled tenant catalogs without replacing existing choices. Future tenant catalogs can add Others through the normal catalog setup.

Deploy backend, frontend, shared contracts and migrations together using the repository's normal process. Review paused legacy definitions and unverified legacy deal histories before activating follow-ups. Do not blanket-mark old deals verified without reviewing authoritative history.

Workflow SMS uses Brevo transactional SMS via `BREVO_API_KEY` and `BREVO_SMS_SENDER` (documented in `backend/.env.example`). Sender registration/availability and SMS balance must be ready before activation. No live SMS or email was sent during verification.

## Verification

- Disposable PostgreSQL-compatible PGlite databases replay all migrations. `node backend/scripts/test-workflow-polish.mjs` runs the workflow polish, authenticated name and general workflow acceptance suites with mocked delivery providers and a separate database per suite.
- Backend regression checks include field validation, stage eligibility, real/no-op update events, tenant/RBAC protection, normalized name races, duplicate event claims, SMS receipts/failures, conversion rollback, and preservation of migrated definitions.
- Frontend checks cover the existing builder/list/history controls, typed field groups, explicit clears, Others, the Qualified recipe and copy names.
- TypeScript checks pass for all three workspaces. Frontend and backend production builds pass. The initial font-download failure was resolved by granting build network access; fonts and layout were not changed.
- Passing targeted coverage comprises 183 backend unit/migration cases, 42 database/API acceptance cases and 31 frontend workflow cases (256 total across the suites and final affected-test reruns). `git diff --check` passes. All external delivery providers were mocked for acceptance tests.

These are local automated checks; they do not claim a production deployment or live provider delivery test.
