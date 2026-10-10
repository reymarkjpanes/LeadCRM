# Coolify production recovery — 2026-10-09

## Confirmed incident

The serving backend is `d826e91c05ca08d507ed9915c730fc259935632c`.
The first failed revision is `90457ccb6a2ffeea7745cda514d6aec8f75c8678`.
Its new `20261106000000_scoped_mailbox_delivery` migration was omitted from
the phased deployment runner's reviewed independent-migration list.
The database has not retired relationship compatibility columns, so every newer
startup reaches this exact guard before Prisma applies any migration:

```text
[crm-import-rollout] REVIEW_MIGRATIONS_AFTER_DEFERRED_RELATIONSHIP_RETIREMENT Rollout stopped; legacy data has not been discarded by the verifier.
```

The same error occurs in `90457cc`, `59c84e4`, `efc3110`, `7fa6766`, and
`878f350`. Each completed dependency installation, Prisma Client generation,
TypeScript compilation and image creation. The replacement container failed
during `db:deploy`, failed its health check, and was removed by rolling-update
rollback. Notifications initialization was never reached in the newest attempt.
Its longer build spent additional time on uncached Nix setup and image export.

The production frontend at `878f35047341cda63dab82c0f79af090da6d09a3` requires
Gmail events and notification-count routes missing from the serving backend.
An authenticated browser request reproduced `Cannot GET
/api/v1/integrations/gmail/events`. An anonymous 401 is insufficient proof of
route registration: authentication runs before route matching.

The six observed Inbox HTTP 429 responses were classified in runtime logs as
`GMAIL_RATE_LIMITED`, including five email-list reads and one explicit sync.
Old list reads contact Gmail; the reviewed newer implementation reads scoped
persisted mail. Keep provider cooldowns and application rate limiting enabled.

## Repair and safeguards

The runner recognizes the reviewed additive mailbox, ownership, preservation
and Notifications migrations. Normal startup continues deferring:

- `20261102000000_retire_relationship_compatibility`
- `20261110000000_retire_unused_crm_columns`
- `20261112000000_retire_lead_nonform_columns`

In particular, the CRM-column retirement remains deferred even when every
candidate value is null: old Prisma clients still select those columns during a
rolling update or rollback. Do not alter existing migration SQL/checksums.
Unknown later migrations and unresolved failed migrations still stop startup.
Applied migration source checksums must also match before deployment proceeds.

Run the read-only release plan against the intended production connection:

```sh
node backend/scripts/deploy-crm-imports.cjs --plan
```

The expected pending additive migrations for this incident are:

- `20261106000000_scoped_mailbox_delivery`
- `20261110000000_preserve_retired_lead_fields`
- `20261111000000_crm_ownership_safety`
- `20261113000000_mailbox_message_headers`
- `20261114000000_notification_delivery`

The Inbox safeguards incorporate the intent of PR #118: preserve saved mail,
coalesce refreshes, honor API Retry-After and close failed EventSource instances.
A bounded retry restores streaming after transient errors or normal server
expiry; hidden tabs and API cooldowns suppress fallback requests. Gmail provider
throttling pauses provider synchronization without blocking persisted reads.

## Release gates

Use the existing [production configuration](coolify-production.md). Both
services build from the repository root with the pinned npm install command.
Keep the migration-before-start command and preserve all secrets.

1. Record the exact active container/image IDs and migration ledger. Verify
   applied SQL checksums, pending migration plan and production data inventory.
2. Create a protected database backup and verify restoration in an isolated
   database. Keep the production database and existing image intact.
3. Complete the [Notifications cutover preparation and rollback
   requirements](../notifications-production-hardening.md#8-deployment-recovery-and-rollback-runbook).
   Pause business writes, provider ingestion and legacy notification consumers
   at a recorded boundary; reconcile the legacy cursor and pending history.
   Do not reset the cursor or replay ambiguous deleted notifications.
4. Prevent competing webhook deployments during the controlled backend-first
   release. Deploy the reviewed exact SHA only after the preceding checks pass.
   Do not restart the reverse proxy merely because it shows pending changes.
5. Verify migrations, worker initialization, health, exact SHA, authenticated
   event streaming, notification counts and tenant-scoped CRM reads. Then deploy
   and verify the matching frontend SHA, session restoration and mobile Inbox.

Do not treat the migration allowlist repair as Notifications cutover approval.
The old notification dispatcher cannot safely overlap the new producer keys.
After the additive Notifications migration, a code rollback requires its legacy
notification scheduler to remain disabled; an unmodified restart of the old
image is not a complete safe rollback plan. Retain the new tables and delivery
ledger, and repair forward. Restore a database backup only through a separately
approved recovery procedure because that would discard writes since backup.

## Pre-deployment checks

```sh
npm --prefix backend run test:rollout
node backend/scripts/verify-production-recovery.mjs
npm --prefix backend run build
npm --prefix frontend run lint
npm --prefix frontend test -- src/features/tenant/inbox/ui/inbox-page.test.tsx src/lib/api/client-auth.test.ts
node backend/scripts/test-notifications-postgres.mjs src/modules/notifications/notification-delivery.integration.test.ts src/integrations/gmail/scoped-mailbox.integration.test.ts
npm --prefix frontend run build
```

The migration replay uses an in-memory database and includes populated legacy
Lead fields, encrypted-token placeholders and retained Notification rows.
It verifies exact preservation and the absence of baseline notification replay.
The PostgreSQL integration command uses a disposable local cluster. Neither
command connects to production.

## Additional observed issues

- Saved backend pending change: `GMAIL_SYNC_INTERVAL_SECONDS=60`. The active
  image lacks the variable and defaults to 60; this did not cause startup failure.
- Backend and frontend builds use Node 22.19.0. The installed jsdom dev dependency
  requests a newer Node patch; the warning also appears in successful builds.
- The legacy Campaign scheduler repeatedly queries the removed `SCHEDULED`
  enum and raises `PrismaClientValidationError`. This predates this repair and is
  independent of the startup guard; its stub sender is not production delivery.
- Coolify management is reachable over HTTP on a public IP. HTTPS management
  and restricted administrative ingress need a separately verified cutover that
  preserves administrator access. Do not change application ingress blindly.
- Coolify application storage has no backup schedule. This does not establish
  whether the external database provider has its own backups.

These are incident findings and release gates, not a claim of completed
production deployment. The final audit must report actual post-deployment
evidence and any unresolved checks.
