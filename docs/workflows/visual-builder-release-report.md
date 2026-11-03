# Workflow visual builder implementation and verification

Date: 2026-09-27. Reference: [Brevo comparison and approved plan](brevo-visual-builder-plan.md).

## Implemented behavior

The existing Workflow feature now contains one visual editor: searchable building blocks, connected trigger/condition/action cards, valid drag targets, insert-between controls, keyboard move controls, duplication/removal with undo/redo, immediate summaries, responsive configuration sheets, zoom/fit/reset, and compact cards. Existing routes, APIs, permissions, CRM services, and the server engine remain authoritative. The installed dnd-kit handles dragging; no graph runtime or new production dependency was introduced.

Save stays in the editor and the first save replaces the new route with the existing edit route. Draft, Active, and Paused reflect saved state separately from unsaved edits. Activation validates configuration and permissions on the server. Test uses a real CRM record against the saved definition without executing actions. Activity reuses persisted execution history and explains that older runs can differ from the current definition.

Disabled actions use the optional canonical `enabled` flag. Missing means enabled, preserving existing definitions. Disabled actions do not dispatch, change projected ownership, or require delivery readiness. Supplied unsafe fields and foreign references remain invalid. The engine persists skipped steps with `Action disabled`; subsequent enabled actions continue. Activation requires at least one enabled action and re-enabling restores normal validation.

The action list is stored in the existing JSON column, so this release requires no database migration. Editor identities, zoom, and selection are never serialized into the business contract. All 62 existing migrations applied successfully to an isolated local PostgreSQL 18 test database.

## Cross-module connections

| Connection | Verified behavior |
| --- | --- |
| Leads | Creation and actual status changes emit their registered events through authenticated API routes; repeated unchanged status does not emit again. Conditions use persisted Lead values. |
| Client Profiles | Contact creation/status events operate on Contact records. Tasks link to Contact, not Lead; safe updates use notes and preserve relationship Status. |
| Deals | Creation, stage changes, closed won, and closed lost reach the existing engine. Stage actions use the governed transition service, including required fields, lost reason, history, and pipeline consistency. |
| Tasks | Actions create normal Tasks with real record links, owner assignment, priority, due date, and API visibility. |
| Notifications | Actions use the normal notification service and appear in its authenticated API. |
| Email | Connected Gmail sender/template validation, personalization, HTML sanitization, delivery acknowledgement/failure recording, and stop-after-failure behavior are covered. Provider transport is mocked in integration tests. |
| Campaigns | Actions call the existing audience/delivery service. A campaign sends to its saved audience once; repeated dispatch does not resubmit it. Provider transport is mocked. |
| Permissions and isolation | Tenant/environment boundaries, view-only access, revoked activation permissions, invalid references, and unsupported actions are covered. |

After explicit user approval, three existing CRM paths were corrected:

- Bulk Deal stage changes delegate to the governed single-record transition. Unchanged stages do not create duplicate histories or Workflow events; failed requirements leave the record unchanged.
- Lead conversion emits Lead status changed and creation events for newly created Client Profiles/Deals only after the transaction commits. Linking existing records does not emit creation events; rolled-back conversion does not run workflows.
- Deal duplication emits Deal created after associations are copied.

**Imports remain excluded by the user's final confirmed choice.** Import services were not changed and do not automatically start workflows. Accounts, Tasks, and Notifications are not advertised as trigger sources because the current catalog does not support those events.

## Verification

- Frontend: **19 tests passed** across editor operations, configuration, save failure recovery, read-only state, disabled actions, navigation guards, Test, and Activity.
- Backend Automation: **58 tests passed**, including live disposable-database and authenticated HTTP tests for all eight triggers, all seven actions, disabled steps, conversion, duplication, bulk stage changes, rollback, and side-effect-free testing.
- Affected CRM regression suites: **107 tests passed** across 17 files covering conversion preservation and Deal behavior. Bulk tenant isolation now verifies delegation to the governed transition service rather than direct Prisma writes.
- `npm run lint`: passed in all three workspaces.
- Production builds: frontend build passed after the final UI fixes. Backend TypeScript emission and the build's entry-file copy passed using the existing generated Prisma client. The final `npm run build` stopped at Prisma generation with Windows `EPERM` replacing `query_engine-windows.dll.node` while an existing development backend was running. That server was left running. The generated schema differs only in formatting and attribute order; this change requires no schema regeneration. A clean standard build should be rerun after stopping the development backend.
- `git diff --check`: passed.

Browser acceptance used the real local API with disposable records. Exercised pointer drag, click insertion at a middle connection, keyboard action movement, live condition/task summaries, disabled email persistence, first save, reload, saved-record dry run, activation, pause, Activity empty state, sidebar unsaved-change confirmation, search, mobile sheets, and Escape dismissal. Desktop (~1440px), tablet (768px), and narrow mobile (~375px) layouts were checked. Dark-mode inspection caught and fixed theme-token resolution; navigation inspection caught and fixed router navigation occurring before a history event. A scroll-effect cleanup error found in the browser has a regression mock using a Promise-returning scroll implementation.

Production-preview acceptance also verified populated Activity: a completed Warm Lead run shows Task and Notification success followed by the disabled Email being skipped. Those real tasks appear on the ordinary Dashboard, and the Deal example appears in Proposal after its governed transition. Both examples were paused after execution. A 20-action draft was checked with Fit, Compact, and last-action configuration; insertion and duplication are disabled at the limit. Deal conditions and stage configuration display actual pipeline/stage names.

The browser viewport tool clamped the attempted 320px check to approximately 358px. Exact 320px, physical touch devices, full screen-reader testing, and every browser engine are not claimed verified. Temporary viewport and dark-theme changes were restored. The in-app browser screenshot scale clips part of the right toolbar, so the evidence captures the visible canvas and run details rather than claiming complete pixel coverage.

Screenshots: visual builder (historical local evidence; artifact retired), persisted Activity (historical local evidence; artifact retired).

Reproducible commands:

```powershell
npm run lint
npm run build
npm --prefix frontend run test -- src/features/tenant/automation/workflows --pool=threads --maxWorkers=1
# Set DATABASE_URL and DIRECT_URL to the same disposable localhost database first.
# Integration tests require a database named leadcrm_workflow_test_<digits>.
npm --prefix backend run test -- src/modules/automation --pool=threads --maxWorkers=1
npm --prefix backend run test -- src/modules/crm/contacts/__tests__/convert-contact-mapping.test.ts src/modules/crm/contacts/__tests__/lead-conversion-preservation.property.test.ts src/modules/crm/contacts/__tests__/lead-conversion-bug-condition.property.test.ts src/modules/crm/deals/__tests__ --pool=threads --maxWorkers=1
```

The broad CRM test invocation also reached an unrelated archive fixture teardown error in PGlite. The affected conversion/Deal suites were then run separately and passed. The PGlite socket adapter intermittently failed during concurrent-event testing; final acceptance therefore used native PostgreSQL 18 in a separate password-protected localhost instance. All 58 Automation tests passed there, with no skipped tests, including concurrent-event deduplication and the added association-copy assertions. No production data was used for acceptance testing.

## Deliberate limits

One trigger, one flat ALL/ANY condition gate, and ordered actions match the existing runtime. No frontend-only branching, delays, SMS, arbitrary scripts, extra APIs, or second engine were added. Closing the editor does not stop execution. The current server engine remains immediate in-process execution; durable crash recovery and scheduled waits require a future runtime change. Pause cannot recall a side effect already dispatched.

No live external messages were sent to verify providers, and no production deployment was performed.

The review preview runs at `http://localhost:3001` against the isolated acceptance API and database. Use `localhost`: the existing proxy's origin check rejects the equivalent numeric loopback host because Next normalizes its request URL. Authentication/proxy code was not changed as part of this Workflow release.
