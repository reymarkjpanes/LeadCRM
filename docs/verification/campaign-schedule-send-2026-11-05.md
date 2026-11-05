# Scheduled Email and SMS sending: audit, repairs, and verification

Date: November 5, 2026 (Asia/Manila).

Local implementation and mocked-provider scheduled execution are verified. This release has **not been deployed**. No application/production database migration, real email, or real SMS was performed. The six pre-existing CRM/dropdown/responsive modifications were preserved.

## 1. Audit findings

### Existing execution path

1. `CampaignBuilder.save('schedule')` saves the draft, converts the selected Manila wall time to a UTC instant with `manilaTaskDueInstant`, and calls `campaignsApi.schedule`. `scheduleCampaign` validates the sender and audience, freezes effective content and approved audience rules, and persists `SCHEDULED`, `scheduledFor`, and `scheduledById`.
2. `backend/src/server.ts:startBackground` starts `startCampaignScheduleScheduler`, `startCampaignRecoveryScheduler`, and SMS status reconciliation. `backend/start.js` starts that full server; the notifications-only entrypoint does not run campaigns. There is no Redis/Bull queue or independent campaign worker service.
3. Every 30 seconds, and on startup, `dispatchDueCampaigns` discovers up to 25 due schedules. It rechecks current sender access and uses `prepareCampaign` to claim the exact saved schedule atomically. Cancellation, archiving, rescheduling, and competing workers cannot claim that same schedule after another operation wins.
4. Preparation evaluates all eligible recipients using the existing batched audience resolver, freezes recipient identities/personalization, creates recipient/log rows, and reserves the email allowance once. UI recipient pagination does not limit sending.
5. `deliverPrepared` uses the existing five-slot submission pool. Each recipient intent commits before provider HTTP. Email uses `email.service.ts:sendMail` and Brevo; SMS uses `sms.service.ts:sendSms` and TextBee. Campaign email is separate from Gmail Inbox sending.
6. Submission completion, Brevo events, signed TextBee events, and read-only TextBee reconciliation call `recalculateCampaignDelivery`. The list, detail, and report endpoints read the same stored campaign status. Existing polling refreshes the UI from those endpoints.

### Established defects and repairs

| Finding | Evidence and repair |
| --- | --- |
| Temporary SMS device discovery could remove a schedule | `SmsSubmissionError` inherits `AppError` through `ValidationError`. The due dispatcher previously treated even an unconfirmed provider GET failure as a permanent preflight failure and returned the campaign to Draft. Temporary discovery errors now retain the due schedule. Malformed discovery data also becomes a typed temporary error. |
| No durable, bounded submission retry | A 429 rejection previously became a failed recipient, and the attempt marker blocked all replays. An explicitly rejected 429 now creates one persisted retry; accepted/uncertain requests remain excluded. Both channels use this path. |
| Acceptance had no campaign-level status | Recipient reports supported Submitted, but the campaign enum did not. Finished accepted campaigns could remain Sending while waiting for delivery evidence. Stored `SUBMITTED` now represents acceptance, including accepted/failed mixtures with counts. |
| Partial delivery could be called complete too early | Email aggregation could return Partially Sent with unresolved recipients. Both channels now require a complete confirmed sent/failed denominator before Partially Sent. Active submission remains Sending. |
| Retry/recovery needed the actual actor for email | `submittedById` was previously written only for SMS. Both channels now persist it and recheck current access before resumed submission. |
| Toast ignored the returned scheduled time | The builder discarded the schedule response and displayed a fixed timezone sentence. It now formats the backend-confirmed instant in Asia/Manila, after success, and displays backend scheduling errors in the existing error toast. |

### Original production incident

The reported two-recipient Email campaign failure could not be identified: its name/ID and scheduled time were unavailable. Existing two-recipient scheduled dispatch passed before these changes, and the repaired path passes on native PostgreSQL. These facts do **not** establish the original production cause.

During the preceding read-only audit, frontend `/api/release` and backend `/api/v1/health` both returned `b08320d030d226e42628ce916f08930f164ed5f0`, with production maintenance inactive. Five campaign scheduler/recovery/status/startup sources at that GitHub revision matched the checkout. Public health alone cannot establish that a timer ran at the missed send time.

Coolify runtime logs, the failed campaign rows, container configuration/restarts, live provider credentials, and provider submission history remain unverified. Computer Use stopped because it could not confidently determine the browser URL. The local configured database is a different remote endpoint and was not used as a substitute for current production. No provider is blamed for the incident without that evidence.

## 2. Files modified

Paths below are repository-relative. These are the changes for this task; the pre-existing six files are excluded.

| File | Change |
| --- | --- |
| `backend/prisma/schema.prisma` | Stored Submitted status, recipient attempt count/deadline, and retry index. |
| `backend/prisma/migrations/20261231000000_campaign_submission_retries/migration.sql` | Additive enum/fields/index migration; records one existing attempt when its timestamp proves it, without enrolling historical failures in retries. |
| `backend/scripts/deploy-crm-imports.cjs` | Allow the reviewed additive migration through the existing guarded rollout. |
| `backend/scripts/verify-canonical-rollout.test.cjs` | Verify the new final rollout boundary. |
| `backend/scripts/test-campaign-groups.mjs` | Optional native PostgreSQL acceptance, four campaign connections, isolated environment, external network guard, and quiet test output. |
| `backend/src/modules/marketing/campaigns/campaigns.service.ts` | Typed claim conflicts, temporary preflight handling, persisted retry/resume work, per-recipient eligibility checks, completion, Retrying report projection, and scheduler diagnostics. |
| `backend/src/modules/marketing/campaigns/campaign-submission-recovery.ts` | Recover untouched safe work while preserving accepted and uncertain outcomes; distinguish deferred retry leases and finish already-persisted receipts without a false interruption. |
| `backend/src/modules/marketing/campaigns/campaign-delivery-status.ts` | Shared evidence-based Sending/Submitted/Sent/Delivered/Partial/Failed/Interrupted aggregation. |
| `backend/src/modules/notifications/notifications.repository.ts` | Keep the existing SMS notification watcher active for Submitted campaigns. |
| `backend/src/shared/services/provider-retry.ts` | Sanitize Retry-After metadata without retaining provider response bodies. |
| `backend/src/shared/services/email.service.ts` | Preserve retry metadata; classify timeout/5xx responses as unconfirmed; retain the existing transport and payload. |
| `backend/src/shared/services/sms.service.ts` | Preserve retry metadata and distinguish temporary gateway discovery from permanent request/configuration errors. |
| `shared/src/types/campaign.types.ts` | Add Submitted to the canonical status contract. |
| `shared/src/types/campaign.types.js` | Shared-build generated companion. |
| `frontend/src/store/types/campaign.types.ts` | Frontend Submitted status type. |
| `frontend/src/features/tenant/marketing/campaigns/hooks/use-campaigns-data.ts` | Fast polling for Scheduled/Sending rows, existing slower cadence otherwise, and online revalidation. |
| `frontend/src/features/tenant/marketing/campaigns/ui/campaign-builder.tsx` | Backend-confirmed Manila success toast for scheduling/rescheduling and backend error toasts; retain drafts and Send Now messages. |
| `frontend/src/features/tenant/marketing/campaigns/ui/campaign-report-view.tsx` | Include Submitted in the existing SMS fast-polling window and keep active processing polling fast. |
| `frontend/src/features/tenant/marketing/campaigns/ui/campaign-status-badge.tsx` | Submitted badge using existing styling. |
| `backend/src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts` | Scheduled single/multiple recipients, mixed outcomes, retry timing/exhaustion/concurrency, opt-out, crash boundaries, actor/tenant checks, and startup retry execution. |
| `backend/src/modules/marketing/campaigns/__tests__/campaign-delivery-status.test.ts` | Submission/delivery phase and mixed-result aggregation. |
| `backend/src/modules/marketing/campaigns/__tests__/campaign-submission-retries-migration.test.ts` | Additive migration and historical recipient preservation. |
| `backend/src/modules/marketing/campaigns/__tests__/sms-tracking.integration.test.ts` | Updated acceptance semantics and Submitted notification-polling coverage. |
| `backend/src/modules/marketing/campaigns/__tests__/sms-links.integration.test.ts` | Preserve unknown SMS outcomes under Interrupted semantics. |
| `backend/src/shared/services/__tests__/email.service.test.ts` | Rate-limit deadline and ambiguous server-error classification. |
| `backend/src/shared/services/__tests__/sms.service.test.ts` | Rate-limit deadline and malformed device-discovery handling. |
| `frontend/src/features/tenant/marketing/campaigns/hooks/__tests__/campaign-server-pagination.test.tsx` | Automatic Scheduled/Sending/Submitted/Delivered updates and revalidation after returning from a report. |
| `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx` | Both channels' confirmed schedule times/error toasts, pending requests, retained drafts, and existing Send Now behavior. |
| `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-report-view.test.tsx` | Submitted SMS acceptance and subsequent automatic delivery updates. |
| `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx` | Submitted status filtering while retaining existing table behavior. |
| `docs/verification/campaign-schedule-send-2026-11-05.md` | This audit, validation, and deployment report. |

## 3. Resulting behavior

- Each new eligible recipient has at most two provider submission attempts: the initial attempt and one retry after an explicit 429 rejection. The retry occurs no earlier than 30 seconds or a later valid Retry-After deadline. The scheduler's normal 30-second cadence also applies.
- Intent and attempt count commit before HTTP. Retry state commits before the worker releases its lease. A restarted/competing worker uses conditional campaign and recipient claims, original content/personalization, current actor access, and current recipient suppression. It neither reconstructs the selected audience nor reserves quota again.
- Successful submissions, ambiguous network/timeout/5xx outcomes, and receipt-persistence failures cannot enter the retry predicate. A stale worker cannot overwrite recovered results. Historical Failed/Interrupted/uncertain campaigns are not automatically retried by the migration.
- Provider rejections are recorded per recipient and do not stop other valid recipients. A persistence or authorization failure stops new work safely and preserves already-recorded results.
- Sending represents active or deferred safe submission work. Submitted represents completed provider acceptance awaiting sending/delivery evidence, including mixed accepted/failed counts. Sent, Delivered, Partially Sent, and Failed require corresponding recipient evidence. Unknown completed submissions require review as Interrupted.
- The table and report use the same stored parent status and existing badge component. Submitted is never translated into Sent or Delivered. SMS callbacks/reconciliation continue to update verified facts, including late or conflicting evidence.
- The visible table polls every 2.5 seconds when its page has Scheduled/Sending rows and otherwise every 7.5 seconds. Report polling retains its fast/slow behavior with Submitted included. Hidden tabs pause; visibility, focus, and reconnect revalidation remain. Returning from a report revalidates the list.
- Success uses the actual response `scheduledFor`, formatted as, for example, “Campaign scheduled successfully for November 6, 2026 at 10:30 AM.” Both Email and SMS, including rescheduling, use it. Backend scheduling errors use the existing error toast and retain the draft and selected time. Unrelated Send Now success strings remain unchanged.

## 4. Database and deployment requirements

Migration: `20261231000000_campaign_submission_retries`. It adds `SUBMITTED`, `CampaignContact.submissionAttemptCount`, nullable `nextSubmissionAttemptAt`, and their status/deadline index. No tables are dropped, recipient results reset, or messages scheduled retroactively.

Deploy matching shared/backend/frontend builds together. Stop old backend campaign writers, use the existing `npm --prefix backend run db:deploy`, and start the full backend with `npm --prefix backend start` / `node backend/dist/start.js` as appropriate for its working directory. Preserve the existing migration-before-start Docker/Coolify command. A notifications-only process is insufficient. No extra cron, queue service, dependency, timezone environment change, or provider switch is required.

Observe `scheduler_started`, `scheduler_sweep`, `schedule_claimed`, `schedule_preflight_deferred`, `schedule_preflight_failed`, `submission_retry_scheduled`, and `submission_resumed` events. Verify an overdue persisted schedule is discovered after restart and that SMS status reconciliation remains running. Existing provider configuration and signed webhook URLs must remain intact.

No Coolify configuration or production database change was applied in this task.

## 5. Actual verification results

| Check | Final result |
| --- | --- |
| Native PostgreSQL campaign integration, four connections | **96 passed**; scheduled Email 1/2/6 recipients, SMS 1/3, concurrency, cancellation, UTC/Manila, partial outcomes, bounded retries, local/E164 phone revalidation, recovery, and startup retries for both channels. |
| Native SMS tracking/reconciliation/notification integration | **25 passed**. |
| Native SMS URL/content preservation integration | **5 passed**. |
| Native authenticated role visibility integration | **46 passed**. |
| Native notification recipient policy integration | Passed; enclosing runner completed successfully. |
| Native workflow integration | **101 passed**. |
| Backend affected unit/provider/migration/Gmail-scheduler/password-reset suites | **69 passed across 8 files**. |
| Campaign UI/table/report/polling and Gmail compose scheduling | **243 passed across 5 files**. |
| Guarded migration rollout checks | **11 passed**. |
| `npm run lint` | All 3 workspaces passed, including backend test typechecks. |
| Shared and backend production builds | Passed. |
| Frontend production build | Passed; all 180 static pages generated. |
| `git diff --check` | Passed. |

Native acceptance used PostgreSQL 17.6 with `fsync`, `synchronous_commit`, and `full_page_writes` all on. Fixtures created and removed only their own disposable databases/clusters. Provider calls were mocked; QA networking additionally blocks external destinations. No skipped native campaign acceptance was counted as a pass.

The ordinary frontend build first rejected the intentionally local HTTP `API_URL`; verification supplied the HTTPS production API origin only to the build process. A Windows sandbox generated-directory error required an approved rerun outside the sandbox. The final real Next.js production build passed without changing local environment files, substituting fonts, or changing product configuration. Earlier assertion failures were corrected for the newly intended Submitted/Interrupted semantics and rerun successfully.

Representative repeatable commands:

```powershell
$env:POSTGRES_TEST_BIN = 'C:\Program Files\PostgreSQL\17\bin'
node backend/scripts/test-campaign-groups.mjs --native src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts
node backend/scripts/test-campaign-groups.mjs --native src/modules/marketing/campaigns/__tests__/sms-tracking.integration.test.ts src/modules/marketing/campaigns/__tests__/sms-links.integration.test.ts src/modules/marketing/campaigns/__tests__/role-visibility.integration.test.ts
node backend/scripts/test-notifications-postgres.mjs src/modules/notifications/notification-policy.integration.test.ts src/modules/automation/workflows/__tests__/workflow.integration.test.ts
npm --prefix frontend test -- src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx src/features/tenant/marketing/campaigns/ui/__tests__/campaign-report-view.test.tsx src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx src/features/tenant/marketing/campaigns/hooks/__tests__/campaign-server-pagination.test.tsx src/features/tenant/inbox/ui/compose-schedule.test.tsx
npm run lint
npm --prefix shared run build
npm --prefix backend run build
npm --prefix backend run test:rollout
$env:API_URL = 'https://api.lead-crm.tech/api/v1'
npm --prefix frontend run build
git diff --check
```

## 6. Remaining production verification

Production sign-off is withheld pending authenticated access. Identify the original campaign in the correct tenant; inspect its stored schedule, schedule failure reason, audit entries, recipient attempt/submission/delivery evidence, and provider history. Correlate those with the container revision, start command, restart timeline, scheduler sweeps, recovery activity, clock, and provider authentication/timeout responses. Health endpoints alone are insufficient.

After coordinated rollout, verify the migration exists, both serving revisions agree, the full backend scheduler logs are present, due schedules execute, both views converge automatically, and TextBee delivery updates reach the stored recipient/campaign state. Any live canary send requires intentionally selected test recipients and is separate from the automated mocked-provider verification performed here.

An uncertain provider submission remains deliberately non-retryable until authoritative evidence resolves it. This prevents duplicate messages; the implementation does not promise exactly-once delivery through a provider that cannot confirm an ambiguous request. While the backend is offline, schedules remain persisted and execute after service recovery rather than at the original exact second.
