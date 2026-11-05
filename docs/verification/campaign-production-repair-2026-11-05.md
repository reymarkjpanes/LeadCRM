# Campaign production sending and delivery tracking repair

Date: November 5, 2026, Asia/Manila. Base: upstream `97b9a95d` (merged PR #229).

## Established production causes

The in-app browser provided authenticated Coolify access. Diagnostics used bounded production reads, provider GET requests, and deliberately unauthenticated empty webhook requests. No diagnostic submitted Email/SMS or changed campaign/recipient records.

1. **Brevo IP authorization blocked Email.** The two-recipient schedule persisted `2026-11-05T13:55:00Z` (9:55 PM Manila), was claimed on the next scheduler sweep, and processed both recipients. Both HTTP submissions were rejected with 401 and the campaign completed Failed with zero submitted and two failed. Send Now at approximately 9:56 PM followed the same path and received two 401 rejections. A read-only `/v3/account` request from the backend identified its IP as unrecognized; this matched `179.197.251.249` in Brevo's blocked list. This incident was not caused by a missed schedule, timezone conversion, or an omitted second recipient.
2. **TextBee batch responses did not match the parser.** The affected two-recipient SMS campaign finished submission earlier that day. Production recipients remained Submitted and the parent Sending, while read-only TextBee batch history reported both messages Delivered. Applying the existing response schema reproduced `data.messages[0].device: expected object, received string`. Batch and recipient identities matched; the old parser rejected the unpopulated device reference before reconciliation could save the result.
3. **HTTPS callback recognition was broken behind the current ingress.** The active TextBee subscription uses the correct API domain, outbound event subscriptions, and matching signing secret. Its recent Sent/Delivered callbacks were retrying after HTTP 400 `HTTPS is required.` Both public provider webhook routes reproduced that result for empty unsigned requests. The backend's active socket peer was `172.19.0.2`; existing `TRUSTED_PROXIES` covered loopback and older ingress ranges, but omitted this peer. Public health responses alone had not exposed this problem.

Production ran the full backend entrypoint (`server.ts:startBackground`) with `startCampaignScheduleScheduler` startup and regular 30-second `dispatchDueCampaigns` sweeps. `prepareCampaign` claimed the stored schedule, and `deliverPrepared` recorded each rejection before finalizing. There is no separate campaign queue service to start.

## Changes

| File | Behavior |
| --- | --- |
| `backend/src/shared/services/sms.service.ts` | `getSmsBatch`: accept valid 24-character TextBee device IDs as references or populated objects; normalize to the existing object contract and strip unrelated provider content. |
| `backend/src/modules/marketing/campaigns/sms-status-reconciliation.ts` | `reconcileSmsStatuses`: preserve all identity checks, including an already-known SMS identity; update delivery through `applyTextBeeEvidence`; recalculate legacy completed Sending parents for matching pending/dispatched responses with `recalculateCampaignDelivery`; report sanitized transport/validation/identity/persistence categories. |
| `backend/src/shared/services/email.service.ts` | `sendMail` / `EmailSubmissionError`: inspect at most 4 KiB of authentication-rejection data; return only fixed explanations/codes for IP blocking, authentication/access, rate limiting, generic rejection, or uncertainty. |
| `backend/src/modules/marketing/campaigns/campaigns.service.ts` | `deliverPrepared` / `getCampaignReport`: persist Email diagnostics in existing recipient/log fields, expose existing report `failureDetail` for Email, and clear obsolete diagnostics after a successful retry. |
| `backend/src/shared/services/__tests__/sms.service.test.ts` | Reference/populated response fixtures and invalid device identities. |
| `backend/src/shared/services/__tests__/email.service.test.ts` | IP/access explanations, bounded/unreadable response handling, and secret-free diagnostics. |
| `backend/src/modules/marketing/campaigns/__tests__/sms-tracking.integration.test.ts` | Real mocked-HTTP parser-to-database recovery, legacy Submitted repair, identity rejection, categorized failures, list/report consistency, and no resends. |
| `backend/src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts` | Persisted Email diagnostics and partial-result preservation under the existing immediate/scheduled send regressions. |
| `backend/src/api/middleware/__tests__/proxy-trust.test.ts` | Real HTTP tests for scoped proxy trust, both production webhook guards/authentication, and untrusted forwarding-header rejection. |
| `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-report-view.test.tsx` | Email failure explanations alongside retained successful recipients using the existing report UI. |
| `docs/setup/coolify-production.md` | HTTPS ingress verification and link to this incident/runbook. |
| `docs/verification/campaign-production-repair-2026-11-05.md` | Findings, operational action, release requirements, and validation results. |

No new endpoint, status, schema field, migration, dependency, provider, or worker is introduced. Existing `providerErrorCode`, `providerErrorMessage`, `EmailDeliveryLog.errorMessage`, and report `failureDetail` are reused. `failureReason` retains its existing machine-readable values, including the 429 retry predicate. Gmail, message bodies, selected recipients, templates, sender configuration, leases, quota reservations, and cancellation claims remain unchanged.

The audit covers campaign/audience/template CRUD and validation, source/tenant/role boundaries, personalization and suppression, previews, immediate and scheduled sending, cancellation/rescheduling, duplication/archive rules, provider events, reports/list counts, polling/toasts, notifications, and quotation/Gmail handoffs through their existing regression suites. Additional changes are limited to the reproduced defects above.

## Operational action performed

After explicit action-time confirmation, only `179.197.251.249` was authorized in Brevo. The authorized list increased from four to five entries and the blocked list decreased from four to three. API/SMTP IP blocking and existing entries remained enabled/preserved; no API key or sender was replaced.

After the authorization completed, a fresh production-backend `GET https://api.brevo.com/v3/account` returned **200**, confirming restored provider authentication. No live Email/SMS was sent; this result does not establish delivery or repair callback processing.

## Coordinated release requirements

- No database migration is required for this PR. The previous PR's submission-retry migration is already part of the production baseline.
- Reverify the actual ingress peer before release. The observed change is to append `172.19.0.2/32` to the current backend `TRUSTED_PROXIES`, preserving its existing loopback and older ingress entries. The observed existing value was `loopback,10.1.0.0/24,fda6:ff05:7da3::/64`.
- Apply this runtime configuration with the matching coordinated release. It has **not** been saved or applied in Coolify during this repair. Do not use blanket proxy trust or remove either provider router's HTTPS/authentication checks.
- Keep the existing migration-before-start/full-backend workflow. No separate campaign worker or cron is required. Preserve signed callback URLs and secrets.
- Confirm both serving revisions, full scheduler startup/sweeps, and reconciliation logs after rollout. Empty unsigned POSTs through the public HTTPS routes should reach authentication (401 with configured secrets), not fail HTTPS recognition. Valid provider callbacks must then succeed and record evidence once.
- Let existing read-only reconciliation recover the affected SMS batches at their due check time. Validate recipient Delivered timestamps and parent/list/report convergence without issuing any new send request. Pending/dispatched evidence must remain Submitted, never Sent/Delivered.
- Never automatically retry historical Failed or uncertain submissions. Use the existing safe retry policy only for proven 429 non-acceptance on eligible persisted work.

## Actual local verification

Automated provider responses are mocked and disposable database harnesses prevent production access. Native tests use PostgreSQL 17.6 with fsync, synchronous_commit, and full_page_writes enabled; campaign concurrency uses four database connections.

| Check | Result |
| --- | --- |
| Native campaign sending/scheduling integration | **96 passed**. |
| Native SMS tracking/reconciliation/notification integration | **39 passed**. |
| Native audience deletion integration | **14 passed**. |
| Native SMS link/content integration | **5 passed**. |
| Native campaign role visibility | **46 passed**. |
| Native quotation API/PDF/Gmail handoff | **24 passed**, using the required quotation database prefix. |
| Native scoped Gmail integration | **190 passed**. |
| Native password recovery integration | **12 passed**. |
| Native workflow and notification recipient-policy integration | Passed in the completed four-suite native runner; neither suite was skipped. |
| Focused provider/proxy unit tests | **60 passed**. |
| Campaign report UI | **29 passed**. |
| Full backend unit suite | **1,507 passed, zero failed, one Windows symlink-privilege skip**, across 179 files. The strict wrapper reports BLOCKED for the unchanged mandatory POSIX storage-boundary assertion; Linux CI must run it. |
| Full frontend unit/component suite | **3,441 passed across 251 files**, zero failed/skipped. |
| Exact CI TypeScript commands | Shared, backend, and frontend `tsc --noEmit --project <workspace>/tsconfig.json` all passed; Next route generation and Prisma generation passed. |
| Workspace lint | All three workspaces passed, including the existing backend test typecheck. |
| Production builds | Shared, backend, and frontend passed. No local environment files or frontend build assets were modified to obtain a pass. |
| Guarded rollout checks | **11 passed**. |
| Development watcher CI check | **1 passed**; its owned fixture process was cleaned up. |
| Documentation references and file inventory | Final documentation links and the 12-file repair inventory rechecked; no unrelated source/manifest changes. |
| `git diff --check` | Passed. |

The frontend QA wrapper detected only the documentation edits made during its run and requested documentation/reference/inventory revalidation. Its executable source hash remained unchanged and matches the backend suite (`581daf82147d97b3ef9e387da3e3a982fc1fa7265336ecc85930e52c50b39dc7`). The component assertions passed on the final executable content; documentation checks were performed separately rather than rerunning those unchanged tests. Original QA receipts remain intact under ignored `data/outputs/system-audit`.

Initial sandbox runs could not rename a Vite cache, connect to disposable loopback services, or create a generated Next.js directory; approved runs outside the sandbox exercised the assertions/builds. Prisma engine replacement initially encountered a Windows engine-file lock while database suites were active; generation and the backend build passed after those suites completed. Initial test-fixture issues (a short mock webhook token and a missing test import) were corrected and their suites rerun successfully. The first quotation invocation used the campaign database prefix and skipped; it is not counted as quotation acceptance, which subsequently passed all 24 assertions on native PostgreSQL.

## Remaining production acceptance and delivery boundary

The deliverable is a tested PR, then stop without merge or deployment. Production sign-off is withheld until the coordinated proxy configuration/code rollout and authenticated callback/SMS recovery checks pass. Controlled Email and SMS Send Now/Schedule Send canaries require explicitly designated test recipients after rollout; none were sent in this task. A 200 account-read check is provider-authentication evidence, not proof of email submission/delivery.

References: [Brevo IP controls](https://developers.brevo.com/docs/ip-security), [TextBee API reference](https://textbee.dev/docs/api-reference), [existing deployment configuration](../setup/coolify-production.md), and [previous scheduling verification](campaign-schedule-send-2026-11-05.md).
