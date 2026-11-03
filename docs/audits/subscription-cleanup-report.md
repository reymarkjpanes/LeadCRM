# Subscription cleanup and environment audit

## Confirmed production cause

On 2026-09-23 the frontend served build `9c_ELb9LuIwXbnyuqbboC`. GitHub's latest successful Production deployment was `5bedaa03aa48f13c6054b1736cc4e920d0bd8f9e`, matching local and remote main. Its public dashboard chunks contain the current environment switcher, disabled mock flags, and no retired banner.

The actual backend reached through `/api/proxy/health` reports **`0090e7504cca5ea5f02e541e19c66f461934434c`**. This predates the environment route introduced in `26412a1`. The user's authenticated PATCH returned HTML HTTP 404 with `x-matched-path: /api/proxy/[...path]`, `no-store`, and cache MISS. The proxy works; the upstream revision lacks the route. Deploy the matching backend and verify its health commit. Do not change the working environment service to compensate for an old deployment.

The exact old message originated in `frontend/src/shared/components/sandbox-billing-banner.tsx`, deleted in `19f1d95`. Its condition was tenantStatus SANDBOX plus absent/NONE subscriptionStatus. Current source and inspected public chunks do not contain it. Stale loaded browser code is a plausible explanation for the reported banner, but the affected browser's old cache was not inspected, so PWA causation is not proven. The current public worker was v3 and did not cache API/RSC responses.

## Changes in this cleanup

- Removed the AuthContext mapping from Tenant.status to tenant.environment. User.activeEnvironment remains the sole dataset selector. Optional tenant environment metadata remains only for existing platform resource-monitoring mock data.
- Removed PricingCard, its props, pricing showcase consumers, and associated card documentation/examples.
- Removed unused billingMutationRateLimiter, the shared Tenant.plan property, and an obsolete plan assignment in the Gmail test script.
- Removed stale backend/package-lock.json, which still declared Stripe. The monorepo root lockfile is authoritative and already has no Stripe dependency. No active package dependency, route, service, hook, plan cache, or monetization configuration remained to remove in this pass; those were removed by earlier commits.
- Replaced obsolete AuthContext environment-derivation tests; extended regression tests for Client Admin with legacy SANDBOX account status and no plan, isolated CRUD, module access, and actual password login/logout persistence.
- Updated service-worker registration to bypass HTTP caching, check on tab visibility, clean up listeners, and offer refresh after saving work. v4 removes older LeadCRM caches; sw.js receives explicit no-store headers. No forced refresh or customer-data deletion.
- Added scripts/verify-deployment.cjs, a read-only proxy health/commit comparison, and deployment instructions.
- Corrected Kiro scalability/CRM skills and architecture, product, security, persistence, routing, and stack guidance. Updated active README, workflow, security, portal, architecture, deployment, and card documentation. Marked old requirements/ERDs/audits as historical instead of deleting academic records.

No new environment service, duplicate switching logic, compatibility gate, schema migration, or account permission bypass was introduced.

## Kept intentionally and final search

See [the per-match classification](subscription-reference-classification.tsv) for tracked text matches across runtime, documentation, instructions, schema, and migrations. The report itself is retirement documentation, not a runtime feature.

1. **ACTIVE AND REQUIRED:** negative regression assertions against retired routes/paywalls; documentation explaining their removal and deployment recovery. These prevent reintroduction.
2. **HISTORICAL / DATABASE RETENTION:** ignored Prisma fields/models and previously applied migrations; explicitly marked capstone/design records. Dropping structures would destroy historical data and is unnecessary for runtime cleanup. During that audit, `LeadCRM-Frontend.zip` was retained as a historical source archive. It was later removed at the owner's request on 2026-11-04 and was not an application build input.
3. **UNRELATED BUSINESS TERMINOLOGY:** operational invoice `plan` descriptions, customer contract renewals, campaign subscriptions, equipment upgrades, quotations, provider quotas, event subscriptions, Git checkout, HTTP Upgrade, and generic design-skill reference datasets. Customer invoices, payment transactions/PayMongo processing, deal financial data, tenant isolation, readiness, and RBAC remain intact.
4. **OBSOLETE — REMOVE IT:** no identified retired SaaS runtime implementation remains after this cleanup. Removed entries are described above and in the Git diff.

## Verification

| Check | Result |
|---|---|
| npm run lint | All 3 workspace TypeScript checks passed |
| Frontend Vitest, maxWorkers=2 | 63 files, 588 tests passed |
| Backend Vitest | 41 files passed, 360 tests passed; 2 suites/21 tests skipped in ordinary run |
| Disposable PostgreSQL environment suite | 10 tests passed; migration preservation and schema drift check passed |
| npm run build | Backend and frontend production builds passed |
| Deployment verifier | Correctly rejects current production backend/main mismatch |

The first frontend test run exhausted worker startup resources; the complete rerun with two workers passed. Initial build failed fetching fonts under network restrictions; the permitted network-enabled build passed. Database integration tests ran only on newly created local leadcrm_environment_test_* databases and left them available for inspection.

Verified locally: authentication, ready Client Admin without a plan, both dataset switches, lead CRUD and isolation, permitted module reads (leads, contacts, accounts, deals, workflows, tasks, campaigns, invoices), refresh/session persistence, logout/login, staff RBAC, System Admin exclusion, cross-tenant isolation, and stale request rejection. This does not claim manual CRUD testing of every module.

Production switch failure was reproduced, but successful production end-to-end verification remains pending backend deployment. No production customer records were created, copied, merged, or deleted. Render dashboard access timed out during the deployment attempt; no deployment was triggered. Repository edits are local and are not yet deployed.

## Local connected verification

At the user's request, the local app is connected to the existing Supabase configuration. `scripts/start-connected-api.cjs` starts the compiled API on loopback port 4000 without invoking server startup seeders, campaign scheduling, or session purge jobs. All request middleware remains active. Start the frontend with server-only `API_URL=http://127.0.0.1:4000/api/v1` and both mock flags false.

Read-only migration status confirmed that the CRM environment migration is applied. The older `20260912135215_tenant_document_key_prerequisite` is pending; it concerns historical document data and was not applied as part of verification. No reset, migration, or data rewrite was performed. Authenticated local verification is pending the user's localhost login.
