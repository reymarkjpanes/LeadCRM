# ADR-002: Multiple Task associations with explicit Lead relationships

## Status

Accepted by the project owner; production migration remains unapplied.

## Date

2026-09-28

## Context

Tasks need persistent multiple Lead, Contact, Deal and Account selections. Existing consumers and Workflow actions use scalar association IDs. The owner approved a preserving migration, coordinated Task integrations, Task-only Merge repairs, explicit Lead relationships for dropdowns, and confirmed Lead conversion/Account-link changes from Task creation.

## Decision

- Use typed TaskLead, TaskContact, TaskDeal and TaskAccount tables. Composite foreign keys include tenant and environment on both ends. Store selection order and prevent duplicate task/record pairs.
- Keep scalar IDs as primary-link compatibility fields. Plural requests are authoritative, including empty arrays; reject conflicting scalar and plural input for the same kind. Bound each list to 50 IDs. Apply Task and association mutations together in the existing transaction.
- With selected Leads, Contact choices come from Lead.contactId, Account choices from Lead.accountId, and Deal choices from explicit Deal/Lead links. Use the union for multiple Leads. Validate the same relationships on plural writes. Without Leads, expose all permitted records. Never infer relationships from names.
- Preserve existing Workflow scalar-input behavior. Approved CRM Task reads and Merge handling include every association and deduplicate links when records merge.
- Keep Create actions in dropdown footers, including empty results, subject to existing permissions. Deal creation links selected Leads. Contact/Account creation requires choosing one selected Lead and Lead edit permission. Contact creation uses existing conversion with explicit conversion/Account confirmation; Account creation confirms replacement of the Lead's Account link. The Task draft remains open.
- Account creation and Lead linking use two existing API operations. After a link failure, retain the created Account ID and retry linking without creating another Account. Explain that cancelling leaves the Account. Contact conversion uses the existing transactional conversion operation.

## Alternatives considered

- Scalar IDs cannot persist checkbox multiselection.
- JSON ID arrays lose foreign-key integrity and complicate scope enforcement and Merge.
- Creating unrelated records with a filtering exception violates the owner's explicit-relationship rule.
- Silently converting every selected Lead changes CRM lifecycle without clear user choice; require one chosen Lead and explicit confirmation instead.

## Consequences

All linked records can retrieve the Task. Old releases only understand the primary link and cannot safely manage every new association. CRM creation saves independently of the Task: cancelling a Task does not undo it. The existing mock model lacks canonical Contacts and conversion; CRM creation stays disabled in mock mode. API-backed acceptance tests use a disposable database.

## Migration / rollout

The prepared migration is `backend/prisma/migrations/20261011000000_task_multiple_associations/migration.sql`. It aborts on dangling/cross-scope legacy links, creates typed tables and composite constraints, and backfills links without deleting scalar fields. Tests cover preservation and rollback for invalid legacy data.

Before release, back up the target database, inspect migration history and invalid-link preflight results, and test against a staging copy. Apply the migration before deploying the new backend, then deploy the matching frontend. No production migration was applied. An old-code rollback is not lossless: it hides secondary links and restores old Merge/write behavior. Keep the new tables and investigate forward fixes; a data rollback requires an explicit recovery plan.

## Related

- [Task audit and plan](../tasks-audit-and-plan.md)
- [Canonical company model](ADR-001-canonical-company-model.md)
