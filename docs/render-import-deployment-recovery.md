# Render import migration deployment recovery — 2026-10-04

The recovery below was followed by successful [production retirement](crm-import-production-retirement.md)
at 15:35:37 Asia/Manila. The eight legacy tables are now removed; references below
to deferred retirement describe the state immediately after deployment recovery.

## Cause

Render's saved Root Directory was `backend`; its Build Command was
`npm install --include=dev && npx prisma migrate deploy && npm run build`.
It did not use the repository Blueprint commands or the two-phase import runner.
The deployment applied `20261027000000_crm_import_integrity` successfully, then
attempted `20261028000000_retire_legacy_crm_imports` before the normalized backend
was deployed. The retirement verification gate rejected that order. Prisma's
follow-up statement reported an aborted transaction, masking the initial gate
error in Render's visible log. Prisma retained a failed migration attempt.

## Fix

- `backend/package.json` routes `db:deploy` through the phased runner. Normal
  deploys apply expansion and let the new server start; retirement stays a
  separate authenticated verification step. After retirement, normal migrations
  continue. Failed migrations remain errors; later releases cannot silently skip
  unapplied migrations beyond the retirement boundary.
- `db:imports:recover` checks the exact migration content, source tables, write
  guards and complete historical copy before using Prisma's supported
  `migrate resolve --rolled-back` on the failed retirement attempt. Checksums
  accept only Git LF/CRLF changes, not edited SQL. Recovery does not execute a
  destructive migration or mark an unapplied migration as applied.
- Render's saved settings must match `render.yaml`: repository-root build,
  compilation during build, phased migration deployment during start, and
  `/health`. The infrastructure migration shell script also uses `db:deploy`.
- Applied migration SQL was not edited. Historical tables stay present until
  the existing API verification and guarded retirement succeed.

## Production recovery executed

Read-only inspection confirmed expansion applied, retirement failed and all eight
source tables still present. The new shared tables contain 2 Lead jobs and 8 row
results; Contact/Account/Deal histories each contain zero jobs/results. The
database preservation function compared every historical payload successfully.

`npm run db:imports:recover` from `backend` completed successfully against the
configured production database. It marked only the failed retirement attempt
rolled back. No CRM records or historical import rows were removed or modified.
The first recovery preflight correctly stopped at a LF/CRLF checksum mismatch;
after verifying identical SQL content and adding cross-platform checksum tests,
the guarded retry succeeded.

## Verification executed

- `node scripts/test-import-deploy.mjs`: passed using native PostgreSQL 17 and
  the actual Prisma migration engine. It applied the complete preceding history,
  migrated 2 fixture jobs/8 results, reproduced the retirement failure, rejected
  recovery on changed history, recovered, repeated normal deploys, and finally
  verified retirement on the disposable fixture without losing any payloads.
  It also checks future-migration blocking and LF/CRLF checksum equivalence.
- `npm --prefix backend run build`: passed, including Prisma Client generation
  and TypeScript compilation.
- Both modified JavaScript entry points passed `node --check`.

The initial local native PostgreSQL launch was blocked by the Windows sandbox;
the approved retry outside the sandbox passed. Test clusters use local disposable
credentials, are stopped afterward, and their generated files are ignored.

## Render redeployment verified

The fix was committed as `1005caeb77ff1a3036c9cc74e3542e2e730b9bde` and pushed
to both `origin/main` and `upstream/main`. Render's saved Root Directory was
cleared and its commands updated together:

```text
Build: npx --yes npm@11.19.1 ci --include=dev && npm --prefix backend run build
Start: npm --prefix backend run db:deploy && npm --prefix backend start
```

Updating those fields triggered [deployment dep-db0vh82d0e5s73ddav70](https://dashboard.render.com/web/srv-d9q1v1lbedkc73audjsg/deploys/dep-db0vh82d0e5s73ddav70).
Render showed **Deploy succeeded | Live** for `1005cae`, with a duration of
1 minute 43 seconds. The dashboard timestamp was October 4, 2026, 2:56:32 PM
GMT+8. The service's saved health-check setting was not changed in this repair.

Post-deployment checks actually executed:

- Backend `/health`: HTTP 200, `status: ok`.
- Frontend `/api/proxy/health`: HTTP 200, production environment and commit
  `1005caeb77ff1a3036c9cc74e3542e2e730b9bde`.
- Anonymous GET requests to all four `/api/v1/crm/{module}/imports` history
  routes: HTTP 401, `Authentication required`.
- Read-only production inventory at `2026-10-04T07:00:01.529Z`: legacy Lead
  jobs/results remain 2/8; shared jobs/results remain 2/8; the other three
  legacy histories remain 0/0; uploads/chunks remain empty. Expansion remains
  applied and the failed retirement attempt is marked rolled back.

This verifies deployment recovery, health, authentication rejection and retained
history. Authenticated creation/history/retry checks for all four modules were
not run against this deployed release; I cannot confirm this. Production table
retirement remains deferred until those checks pass. No production test CRM
records were created, and no legacy tables were dropped during this repair.

## References

Recovery follows the supported [Prisma migrate resolve workflow](https://docs.prisma.io/docs/cli/migrate/resolve).
Render uses the service's saved [build/start commands](https://render.com/docs/deploys);
committing a Blueprint alone does not change a manually configured service.
