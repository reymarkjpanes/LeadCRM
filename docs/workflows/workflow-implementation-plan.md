# Workflow implementation and deployment plan

Status: in progress — NOT approved for deployment.

## Selected approach

Extend the existing backend engine and services. Keep the current database models and environment scoping. Use one shared Workflow contract, server metadata, one guided WHEN/IF/THEN builder and API-backed Runs. Implement six immediate actions only. Remove unsupported SMS, delays, fake tests/metrics and browser execution. Retain mock fixture editing without pretending it performs server automation. See [audit](workflow-automation-audit.md).

## Ordered work and exit gates

1. **Audit and dependency map** — trace frontend, engine, emitters, domain services, delivery, permissions and environment. Capture all P0/P1 issues before implementation. Gate: coherent findings and architecture decision. Done for the principal runtime paths; further discoveries remain in scope.
2. **Regression tests** — first reproduce flattened-context failures, protected status writes and false email success. Gate: tests fail for the actual defect before the fix.
3. **Canonical contracts and validation** — shared draft/condition/action/run/metadata types; strict activation; scoped users/templates/stages; archived activation blocked; no activation permission bypass through CRUD. Gate: invalid inputs and cross-tenant references rejected with actionable errors.
4. **Backend correctness** — consistent flattened events, correct Lead/Contact identity, real actions through services, status allowlist, governed stages, recursion guard, truthful run/step/activity records, safe error text. Gate: all supported actions have passing tests and no fake-success path.
5. **Frontend integration** — one builder and canonical recipes, cached server metadata, existing shared list owner, real toggle/archive/duplicate/test/runs, named permissions, accessible dialogs, explicit loading/errors. Gate: no old production shape or browser engine remains; successful mutation feedback follows server success.
6. **Data compatibility** — inspect old stored definitions without destructive reseeding; preserve history; report invalid legacy workflows and require correction before activation. Update fixtures and seed source only. Gate: existing data preserved and unsupported definitions cannot execute.
7. **Automated validation** — targeted regression/security/service tests, disposable-dataset integration tests, repository lint and build, then full relevant suites. Gate: failures introduced by the change fixed; existing failures recorded precisely.
8. **Manual acceptance** — real stack Lead→Task; conditional Deal→Notification match/nonmatch; governed stage transition; provider-stub failure without customer email; role access; tenant/environment isolation; every visible workflow control; mobile/desktop/dark/keyboard. Gate: evidence recorded, no console errors during tested flows.
9. **Release review** — review final diff, verify migration requirements, provider configuration, production mock flags, staging smoke results and rollback. Gate: all applicable definition-of-done items verified. Unavailable infrastructure is a blocker, never a passing result.

## Deployment and rollback

Prepare and validate locally first; no automatic production deployment is part of readiness verification. Build frontend and backend from the same revision because the workflow API shape is shared. Do not reset, truncate or reseed an existing database. Take the deployment platform's normal backup before any explicitly required additive migration. Start in staging with external sends disabled; use safe provider stubs and disposable tenant fixtures for acceptance.

Pause workflows if duplicate actions, cross-environment access, incorrect Status mutations or false successful deliveries occur. Roll back the coordinated application release to the previous artifact; preserve all execution history for diagnosis. Do not replay failed runs automatically because external side effects may already have occurred. Deployment readiness remains false until the evidence below is complete.

## Validation evidence

Evidence recorded through 2026-09-23. The application checks below passed before the final dependency-security updates; post-update validation is in progress.

- All 54 migrations replayed on a fresh disposable PostgreSQL database. Prisma schema comparison returned **No difference detected**. Historical migrations were not edited. The new prerequisite migration is transactional and blocks the historical transition when legacy relationships would be lost.
- Repository TypeScript checks passed. A full production build passed (45 frontend routes); final changes are being rechecked.
- Final backend suite passed **372 tests**, including 12 database/HTTP acceptance scenarios. The eight separately gated environment tests were then run against a second disposable database and **all eight passed**.
- Final frontend suite passed **586 tests across 62 files**, including five builder tests for typed numeric payload, focus preservation, honest save errors, paused drafts, incompatible-action removal, read-only keyboard exit and legacy definition repair.
- An existing frontend seed test incorrectly required an upsert after the seeder became non-destructive. It now inspects the actual account-create AST and verifies email verification without identity updates; its targeted suite passed.
- Browser acceptance used a separate localhost frontend/API and disposable database with a test-only employee account. Template creation and activation persisted successfully. Creating a lead exposed a TypeScript development-runtime import failure; normal domain-service imports replaced dynamic `.js` imports. The repeated Lead creation completed owner assignment and task creation; both database records and expanded Runs UI confirmed success. The dry-run UI returned a matching record/conditions and two valid actions without execution.
- Mobile run dialog inspected at 390 × 844: content and failure details fit, with scrolling and readable controls. Desktop dialog also inspected.
- Browser error-log inspection returned no captured errors for the acceptance session.

Commands used for the final automated run (local test database URLs supplied only to the child processes):

| Command | Result |
| --- | --- |
| `npm --prefix backend test -- --pool=threads --maxWorkers=1` | 372 passed; 8 gated tests skipped in this run |
| `npm --prefix backend test -- src/core/environment/__tests__/environment.integration.test.ts --pool=threads --maxWorkers=1` | 8 passed on `leadcrm_environment_test_2026092301` |
| `npm --prefix frontend test -- --pool=threads --maxWorkers=1` | 586 passed |
| `npm run lint` | All 3 workspace TypeScript checks passed |
| `npm run build` | Passed: both builds, including 45 frontend routes; dependency-update rerun pending |
| `prisma migrate deploy` / `prisma migrate diff --from-url <local-test-db> --to-schema-datamodel backend/prisma/schema.prisma --exit-code` | 54 migrations applied; no schema difference |
| `git diff --check` | Passed; line-ending notices only |

Earlier high-concurrency runs hit worker startup/test timeouts; these are superseded by the completed single-worker runs above. An obsolete seed assertion and a finite-number property generator admitting NaN were corrected, with their full suites included in the passing results. No test was skipped to hide an assertion failure.

## Dependency security review

The online npm audit found nine production dependency advisories, including a critical Next.js issue. A constrained `npm audit fix` updated Next.js to 15.5.26, Express to 4.22.3 and other compatible dependencies. No force-upgrade to Next.js 16 was used. Remaining fixes use root overrides: all PostCSS consumers use patched 8.5.28; the Google HTTP client's UUID dependency moves to patched 11.1 (the client uses its unchanged `v4` function). These overrides should be removed once upstream packages declare safe compatible ranges. The updated dependency tree reports zero known vulnerabilities; clean installation and post-update application checks follow.

Faker is used only by the explicit demo tenant generator. It moves to development dependencies at 10.6.0 and is dynamically imported after the production guard. Demo seeding is not run during validation. The supported Node minimum is recorded in the root manifest and README.

Sources: [Next.js Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [Faker advisory](https://github.com/faker-js/faker/security/advisories/GHSA-qxc2-j82w-r537), [Faker migration guidance](https://fakerjs.dev/guide/upgrading.html). Installation, repeat audit and application validation remain in progress until results below are finalized.

Use the pinned package manager for reproducible installs: `npx --yes npm@11.19.1 ci`. npm 11.13.0 silently dropped these overrides across workspace links; the [upstream fix](https://github.com/npm/cli/pull/9671) was backported to npm 11. CI install commands and the root `packageManager` now select the patched release. Global npm was not changed.

## Deployment prerequisites still to verify

- Configure frontend `API_URL` to the deployed backend and `NEXT_PUBLIC_USE_MOCK_DATA=false`; the local build intentionally points at localhost.
- Configure backend database URLs, JWT secret, actual hosting ingress IP/CIDR values in `TRUSTED_PROXIES`, allowed frontend origins and the existing required email/OAuth secrets. Confirm the real proxy chain forwards the client IP correctly. Express guidance: https://expressjs.com/en/guide/behind-proxies/ .
- Validate migration history and a backup on the actual target or its restored staging copy. Local fresh replay cannot prove an existing remote database has no drift or legacy data.
- Connect a workspace Gmail sender and perform an explicitly approved staging delivery to a controlled recipient. Automated tests mock only the provider transport, so no customer messages are sent and live Gmail delivery is not certified.
- Complete the browser acceptance rerun, final tests/build and release review. No production deployment has been performed.

## Operational limits

CRM changes enqueue matching Workflow trigger events in the same PostgreSQL transaction. The worker claims the saved definitions after commit, using a lease and a stable event ID per workflow. An immediate wakeup starts eligible processing, and a recovery sweep finds remaining work. The worker can run in all, scoped, or disabled mode. See [Workflow processing and finished history](workflow-reliability-rollout.md) for the environment settings.

Known transient preparation failures can retry before dispatch. An expired or uncertain dispatch is recorded as Interrupted and requires review of the saved steps and provider receipts. Normal history shows Completed, Failed, and Skipped results, with Interrupted presented as Failed and marked for review. Queued and running states remain available to authorized callers through the existing API.

Live provider delivery, target deployment settings, existing remote migration history and hosted smoke tests remain external release gates. Local passing tests do not certify those gates. The browser checks above cover the stated flows; they do not claim exhaustive manual coverage of every workflow control, role or theme.
