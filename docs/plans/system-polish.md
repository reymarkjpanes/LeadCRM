# System polish implementation

## Scope and assumptions

Repair the existing internal CRM, keeping tenant isolation, current roles, existing module boundaries and governed sales transitions. Client Admin and custom staff roles remain supported; public forms remain the guest entry point. Do not restore retired SaaS or operational modules.

Groups replace Department. Preserve multiple memberships and migrate each nonempty legacy department to a same-tenant Group, reusing a case-insensitive name match. Group memberships remain administrator-managed and use the existing TenantGroupMember relationship consumed by workflow assignment. Self-profile can display groups but cannot grant membership.

## Implementation order and integration points

1. Access: shared workspace-status policy → password login/session middleware → Gmail access/sync → status regression tests.
2. Administration: deactivation impact includes unfinished Tasks → transactional reassignment → user dialog; role metadata/permissions save atomically; archive types and restore links agree; archive date sorting/page hydration move to the database.
3. Groups: forward data-preserving migration → canonical auth/user membership responses → admin create/update groupIds → existing group RBAC → User/Profile forms, table filters and help → membership/cache invalidation → workflow options.
4. CRM: final Lead fields → canonical Deal account filter → fixed initial Deal stage → valid Contact merge archive metadata; Contacts query page/filter/sort on server; database ordering replaces full collection sorting where supported.
5. Tasks: shared Manila deadline conversion → bulk reschedule; preserve matching rows while background refresh runs.
6. Reporting: reuse authorized Dashboard report definitions, period controls, real stage names, eligible staff and export; retire stale parallel report formulas and update tests.
7. Engagement: Forms edit/publish separation; honest submission-only website capture; OAuth permission consistency; workflow email checks use actual sender/recipient access; interrupted campaigns finalize safely without blind resend; retire obsolete campaign scheduler; finish scheduled-mail review/cancel with atomic claim protection.
8. Cleanup: remove verified unused private implementations/API clients; update architecture/API/help documentation to current routes and supported lifecycle.

## Verification and rollout

- Add focused regressions for security boundaries, relationship writes, failure rollback, permission combinations, timezone consistency and crash/claim recovery.
- Run existing relevant unit/component/property tests. Use disposable local PostgreSQL-compatible test data for migrations and HTTP integration. Never send real provider messages during verification.
- Run shared/backend/frontend TypeScript checks and production builds after targeted checks.
- Validate tenant A cannot attach tenant B groups, edit-only staff cannot publish, users cannot change their own group membership, task-only departures require reassignment, reports include more than 100 deals, and interrupted sends never invite duplicates.
- Record observed test results and any environment limitations. A browser smoke check does not stand in for a completed role journey.
- Deploy requires applying forward migrations before starting the updated backend, then verify authentication, Group memberships, reporting, campaign recovery and normal create/edit/archive/restore flows.

## Acceptance

Each audit item is closed only when its UI/API/contracts agree and relevant regression checks pass. Production migrations and deployment are separate operator actions; implementation must not silently run against the configured live database.

## Implementation and module connections

API paths below are relative to `/api/v1`. UI routes are listed in the [current module map](../../README.md#current-modules).

| Module / area | Implemented polish | API and integration points | Verified scenario |
| --- | --- | --- | --- |
| Authentication / workspace access | One shared ACTIVE/SANDBOX allowlist; unknown and suspended states fail closed. Group membership is returned consistently by login, current-user and administration responses. | `/auth/login`, `/auth/me`, session middleware, Gmail authorization/sync | Staff login and existing sessions are denied when workspace access is unavailable; another tenant's membership is never included. |
| Users / Groups / Profile | Removed Department from the model and forms; preserving migration reuses same-tenant Groups. User forms support multiple `groupIds`; Profile is read-only. Existing Department column preferences retain their visibility/order as Groups. Membership writes validate the active user, tenant and administrator permissions in one transaction. | `/administration/users`, `/administration/users/:id`, `/administration/groups`, `/auth/profile`, `/automation/workflow-options` | Client Admin creates/updates multiple memberships; explicit `[]` clears them; cross-tenant IDs roll back; self-profile membership changes and retired Department writes fail. |
| Team Management / live access | Tabs follow Users and Groups permissions. Account switches and revoked access clear old panels. Group events refresh current profile, lists and workflow reference data; membership-only revisions preserve unsaved permitted drafts. In-flight Group invalidations queue another read. | Existing `/auth/events` revision stream and Group API mutation events | A Users-only staff role stays in its accessible tab; another login cannot see the previous user's Group draft; a Group change updates assignment options without losing the workflow draft. |
| User deactivation / ownership | Impact and reassignment include unfinished Tasks as well as CRM records. Completed/cancelled/archived history remains attributed to its original user. Replacement eligibility is checked and reassignment/deactivation commit together; sessions are revoked. Dedicated flow is Client Admin-only. | `/administration/users/:id/deactivation-impact`, `/administration/users/:id/deactivate`, Tasks and CRM owners | Admin deactivates a user with open Tasks, selects an eligible replacement and sees no orphaned assignments; invalid replacement rolls back. |
| Roles / Archived Data | Role metadata, permissions and stored user role labels update atomically. Archived Role type/restore routes agree. Default archive date sorting now happens in the database across authorized record types, with stable paging and actual archive audit dates. | `/administration/roles/:id`, `/administration/archived-data`, `/administration/archived-data/:type/:id/restore` | An interrupted role update leaves its original permissions intact; a permitted user pages mixed archived entities, including Roles, without foreign-tenant records. |
| Leads / Deals / Pipeline | Removed retired Lead Website/Notes editors. Deal account aliases normalize to one relationship; conflicting aliases are rejected. Quick Deal creation uses the configured Lead starting stage and trimmed required title. Existing governed sales transitions remain intact. | `/crm/leads`, `/crm/deals`, `/crm/pipelines`, shared Deal contracts | Staff creates a related Deal at Lead; account filters agree with the canonical link; invalid/conflicting relationships fail. |
| Contacts / Accounts / merges | Contact page/filter/sort/facets are requested from the API. Contact forms map display aliases to canonical API fields, allow explicit unlinking and retain failed-save drafts. Assignee validation rejects invalid users. Merge validates active same-tenant records, handles selected null relationships, archives the secondary record and reassigns mailbox links with owner mailbox revision updates. | `/crm/contacts`, `/crm/accounts`, `/crm/merge`, CRM relationships and Gmail history | Staff edits and unlinks a Contact's Account, receives a save failure without losing input, then merges records while Deals and Inbox associations remain connected. |
| Products / Custom Fields / imports / files | Retained the existing normalized Product relationships, Custom Field contracts, import history and record-file APIs. Shared generation now includes their complete dependencies. Existing form/detail reuse remains intact after removal of unused private configurations. | `/administration/product-interests`, `/crm/:module/custom-fields`, `/crm/:module/imports`, `/crm/:module/:id/files` | Product-backed Deals and CRM import history pass disposable API checks; Custom Field validation and file controls are covered by existing unit/component tests. Remaining gated acceptance suites are listed below. |
| CRM / Users / archive performance | Date sorts request only page IDs from the database; default archive date view uses a bounded SQL page. Existing rows stay visible during background Contact/Task/Group refresh. | Paginated CRM/User reads, archive list, shared sorted-page helper | Equal dates have stable ID tie-breaking; page two does not hydrate every record; background updates keep matching rows visible. |
| Tasks / dates | Shared Manila day/week and deadline conversion is used by the board and bulk reschedule; explicit ISO timestamps remain unchanged. Access denial clears stale Tasks. | `/operations/tasks`, `/operations/tasks/bulk`, shared deadline contracts | Staff bulk-reschedules the same calendar deadline used by individual editing; Today/Week includes the correct Manila boundary. |
| Dashboard / Reports | Reports reuse the authorized server definitions, period controls, current stage names, staff selection, exports and revision updates. Removed the unused summary client and parallel frontend formulas. | `/reporting/dashboard`, `/reporting/dashboard/export`, `/reporting/dashboard/events` | Reports include more than 100 Deals, enforce module permissions and tenant scope, and use the same totals and date period as Dashboard. |
| Forms / guest intake | Editing and publishing controls require their separate permissions. Company Website is honestly identified as submission-only capture. Existing guest intake remains validated by the backend. | `/marketing/forms`, existing publish action and public form submission route | Edit-only staff saves content but cannot publish; guest submits a published form and its supported CRM fields are mapped correctly. |
| Workflows / assignment / email | Assignment consumes canonical Groups, with live reference-data refresh. Email checks apply to the actual sender and recipient CRM access. | `/automation/workflows`, `/automation/workflow-options`, action validation, scoped Gmail permissions | Staff saves a workflow using a Group; an unauthorized sender/recipient is denied instead of sending as a more privileged account. |
| Campaigns / delivery recovery | Persisted leases and attempt markers recover interrupted submission safely. Definitely-unsent recipients fail explicitly; unknown provider outcomes remain available for review without automatic replay. UI/report filters recognize INTERRUPTED. Removed the obsolete scheduler and simulated progress; saved-audience updates replace matching IDs. | Existing Campaign send/report APIs, provider receipts, submission recovery worker, `Campaign` / `CampaignContact` contracts | Provider acceptance followed by interruption never triggers a blind duplicate send; late verified receipts can establish the correct delivery status; historical rows remain preserved. |
| Inbox / scheduled mail | Added review and cancel through the existing scheduled mailbox model. Reads are owner/tenant/CRM scoped; cancel atomically competes with sending and preserves the Gmail draft. UI reports stale claims and offers current status. OAuth access agrees with Lead-or-Contact permissions. | `GET /integrations/gmail/scheduled/:id`, `POST /integrations/gmail/scheduled/:id/cancel`, existing mailbox events and worker | Owner reviews/cancels a pending schedule; another user is denied; cancellation loses to a started send with 409; uncertain outcomes are checked instead of resent. |
| Notifications / worker time | Raw SQL due/lease comparisons use explicit UTC instants. A preserving migration sets UTC defaults for new notification/outbox records and trigger enqueue timestamps. | Existing notification worker/outbox and `/notifications` APIs | Under an Asia/Manila database session, a reminder is not consumed before its due time and an unexpired lease cannot be claimed early. |
| Cleanup / Help / runtime | Removed unused legacy Users page/API clients, four private record-detail configurations, their unused types, obsolete Campaign progress/scheduler and nonexistent reporting summary client. Updated Help and architecture/API docs. Generated CommonJS shared dependencies now stay synchronized; native Node migration tests are separated from Vitest. | Shared build script, workspace builds, migration deployment plan and documentation | Production bundles and TypeScript checks resolve current imports; Help paths point to actual implementation; reviewed forward migrations are selected without bypassing existing retirement guards. |

## Verification evidence

Tests use mocked provider boundaries and disposable in-memory PostgreSQL-compatible databases. No configured application database migration, real email/SMS send or deployment was performed.

- Backend unit/property/migration selection: **795 distinct tests in 94 files pass**, zero skipped. Stale migration boundaries, workspace-state auth fixtures and custom-field key generators were corrected; focused reruns passed.
- Backend full discovery run with separate worker processes: **883 pass, 2 assertion failures and 459 skipped** across 129 files. The failures were retired expectations that archived Roles are unsupported; one additional suite could not initialize because its historical seed used today's generated User columns. Both fixtures were corrected. Their final focused rerun passed **38/38 across both files**, including populated historical data preservation and current APIs. No known assertion or initialization failure remains; the full discovery suite was not rerun after those fixture-only corrections.
- A prior Windows worker-thread run exited with native process code `-1073741819` before a summary. The `--maxWorkers=1 --pool=forks --testTimeout=20000` run completed and produced the discovery results above. Database-gated skips are not counted as passes; many are covered by the separate disposable suites below.
- Engagement HTTP integration: **177 tests pass** across Campaigns (48), scoped Gmail/scheduling (76) and Workflow acceptance (53). Campaign submission recovery migration adds one passing preserving-history check.
- CRM/access final regressions: **58 tests pass** across Dashboard (18), Deal normalization/relationship integration (8), merge units (11), Profile (6), Roles (7), Groups (4) and User imports (4). Groups/Archive additional disposable integration and role/tenant checks are recorded with the final verification results.
- Additional disposable coverage: **164 tests pass** across sales automation (28), Lead acceptance (12), Products (3), Forms (19), Notifications HTTP (5), Imports (12), Tasks (18), Organization settings (8), first-login (12), Permissions (10), Security (19), notification delivery under an Asia/Manila SQL session (17), and preserving notification UTC migration (1). One deployment-only import rollout scenario was intentionally skipped; it requires evidence from a deployed application.
- User/Group synchronization HTTP checks and archive SQL paging/permission checks also passed on fresh disposable databases. New Group column-preference normalization is covered by the shared sorting/preferences regressions.
- Native migration scripts: **3 tests pass**. Guarded rollout selection: **9 tests pass**, including all four new migrations and preserved retirement/checksum gates.
- Frontend full suite: **1,213 pass out of 1,214** across 143 files. Its only failure used an unsupported test matcher loaded before correction; the corrected file then passed **16/16**, covering that assertion with the final source. The complete suite was not rerun a third time; this is full-suite plus focused-correction evidence.
- Production builds: **shared, backend and frontend pass**, including Prisma client generation and 180 generated frontend pages. `npm run lint` **passes for all three workspaces**. The frontend build used an inert explicit HTTPS API URL and did not connect to a deployment. Overlapping focused checks are not added together as a misleading total.

## Manual acceptance and rollout still required

Automated component interaction and HTTP/database integration are completed evidence. Manual browser role journeys were not completed because browser control was unavailable. Real Gmail/Brevo/TextBee delivery needs a separately configured provider sandbox. This report does not claim every possible user scenario has been exercised.

Database-gated acceptance suites outside the explicit selections above were not all run against a supplied PostgreSQL installation. In particular, the separate Custom Fields and CRM-completion integration suites remain gated; existing unit/component coverage is not a substitute for those broader acceptance checks. The configured application database was not changed, and its backend development process remains stopped pending the forward migration/restart sequence.

1. Use a disposable workspace and Client Admin, Groups-only staff, Users-only staff, CRM staff, Forms edit-only staff and guest sessions. Repeat the scenarios in the table through the browser, including denial/error states and two open tabs receiving changes.
2. Stop old backend processes before the preserving Groups migration removes Department. Apply `20261116000000_user_groups`, `20261117000000_campaign_submission_recovery`, `20261118000000_group_revisions` and `20261119000000_notification_utc_timestamps` through the documented guarded rollout.
3. Generate Prisma and build/start the updated application. Check login, existing and migrated memberships, custom-role navigation, workflow Group options, Task reassignment, report exports and interrupted delivery review.
4. Use provider sandbox credentials for scheduled mail, Campaign receipt and interruption tests. Verify provider history before taking action on an uncertain delivery.

Remaining performance scope: natural text sorts still read lightweight matching IDs to preserve existing numeric/case-insensitive ordering; this change bounds date sorts and page hydration. The nondefault archive text/name/detail sorts retain their existing identity merge. No claim of fully constant-cost sorting is made.

The notification UTC migration preserves existing timestamps. It does not guess which historical rows were written under a different database session timezone; those require separately attributable evidence before correction.

## Summary checklist

- [x] Canonical Groups replace Department in contracts, model, admin UI and read-only Profile.
- [x] Existing memberships/legacy Department values are preserved by a forward migration.
- [x] Group permissions, tenant isolation, Workflow options and revision refresh agree.
- [x] User deactivation transfers unfinished Tasks and CRM ownership transactionally.
- [x] Role updates are atomic; archived Roles are connected and default archive paging is bounded.
- [x] CRM writes, Deal links/starting stage and Contact/Account merges are consistent.
- [x] Contact server paging and background refresh preserve usable lists and failed drafts.
- [x] Task deadlines/bulk updates use the same Manila definitions.
- [x] Dashboard and Reports share authorized aggregates, periods and exports.
- [x] Form edit/publish and Workflow email permissions are enforced.
- [x] Campaign interruption recovery and scheduled Inbox review/cancellation are implemented.
- [x] Notification worker timing uses explicit UTC for non-UTC database sessions.
- [x] Verified dead code/API clients and misleading progress were removed.
- [x] Documentation, Help, generated shared dependencies and migration test runners were aligned.
- [x] Final frontend test/build/TypeScript results recorded, including the focused correction.
- [x] Final backend build/TypeScript and expanded integration results recorded.
- [ ] Apply forward migrations and run the updated app against the intended database.
- [ ] Complete manual multi-role browser and real-provider sandbox acceptance.
