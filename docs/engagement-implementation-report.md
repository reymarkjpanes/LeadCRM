# LeadCRM implementation report

Implemented in the existing mailbox, customer-status, Workflow, Deal and shared
contract modules. No deployment database was reset or migrated during this work.

## Delivered

- One timestamp evaluator for Leads and Contacts, with exact 8/30-day boundaries,
  outbound-only baselines, terminal-status preservation, technical automated-mail
  exclusions, verified history replay and stale-coverage recovery.
- Existing reply columns mapped as `lastCustomerReplyAt`; atomic status/Activity
  updates and stable post-commit status events. Mailbox processing no longer moves
  or cancels Deals or produces a ready-to-close hint.
- Retired Deal Stage Automation UI, service, routes and shared contract removed.
  A forward migration deletes only its default TenantPreference entries.
- Related-Deal Workflow targeting for Lead/Contact events, canonical Product and
  stage filters, default single-match ambiguity protection, explicit all-matching
  mode, Deal permission enforcement, authorized transition validation and read-only
  previews. Execution logs retain affected Deal IDs.
- Individual Custom Field cards and Edit Field menus, saved-ID PATCH editing,
  blank New forms, immutable edit types and server-defaulted Closed Won purpose.
- New Deal checkboxes, separate Product prices and Deal count, fixed Lead stage,
  shared Industry choices, and Industry/Address preservation through the adapter.
- Tenant-scoped batch receipts, serializable creation, full rollback, stable
  creation events/notifications, historical price snapshots, Product title suffixes,
  duplicate-safe API/mock client state and retained keys/payloads on uncertain errors.

See [behavior and API details](engagement-deal-creation.md) and [API.md](API.md).

## Database changes

Migration: `backend/prisma/migrations/20261103000000_reply_engagement_deal_batches`.
It adds `DealCreationReceipt` with tenant/request-key uniqueness and reuses the
existing reply timestamp columns through Prisma mapping. It does not delete
mailbox messages, field definitions, Deal evidence or historical closing snapshots.

The isolated migration harness replayed the historical migrations and verified
preserved closing-field IDs/versions, preserved unrelated preferences and removed
automation preferences. Production deployment still requires the existing
`npm --prefix backend run db:deploy` process and rule-version replay through the
mailbox scheduler. Production deployment and real-mailbox backfill: **I cannot
confirm this.** They were not run.

## Verification results

Logs and browser evidence are in `data/outputs/engagement-implementation/`.

| Check | Actual result |
| --- | --- |
| Prisma validate | Passed against the final schema |
| Prisma generate | Passed as part of production build |
| Workspace typechecks | All 3 workspaces passed |
| Mailbox/engagement/batch suite | 57 passed: 25 rule/parser checks and 32 database/HTTP integration tests |
| Workflow polish and execution suites | 10 + 52 passed in isolated databases |
| Workflow names suite | 3 passed, 1 failed: concurrent equivalent-name submissions returned expected 201/400, then the PGlite connection closed during the count assertion; reproduced on retry |
| CRM completion | 14 passed, plus migration-preservation assertions |
| Frontend suite | 119 files, 991 tests passed |
| Final Custom Fields checks | 16 tests passed across 2 files, including the additional permission and immutable-type assertions |
| Backend/frontend production builds | Both final builds passed; frontend generated 180 pages |
| `git diff --check` | Passed |

Engagement coverage includes today, 7/8/29/30/60 days, adjacent millisecond
boundaries, generic/cancellation wording, automated metadata, first outbound
10/30 days, no history, outbound follow-ups, actual campaign delivery/open/click
events, duplicate and concurrent ingestion, delayed messages across mailboxes,
Contact aging, converted-Lead history, stale coverage and catch-up. No configured
Workflow means no Deal movement. Configured status workflows run after the status
commit, deduplicate repeated messages and respect Product filtering.

Deal creation coverage includes one, two and three Products, title shortening,
independent PHP snapshots, common fields and existing relationships, concurrent
retries, conflicting keys, unavailable/foreign Product IDs, permission denial and full
rollback after a failure on the second Deal insert. Catalog price changes do not
reprice existing Deals or receipts.

Workflow coverage includes one match, ambiguity, explicit all matches, zero-match
no-op, Contact junctions, tenant scoping, preview permissions, preview immutability,
existing Deal triggers, required fields and Closed Won/lifecycle safeguards.

## Browser verification

A disposable local tenant used the production build. The New Deal drawer was
opened from Qualified and still showed the fixed Lead starting stage. Selecting
CCTV Surveillance System and Access Control displayed two separate prices and
created `Security upgrade — CCTV Surveillance System` (PHP 25,000) and
`Security upgrade — Access Control` (PHP 15,000), both in Lead.

Custom Fields showed individual saved cards and their Edit Field menus. Editing
Confirmation Type loaded the correct dropdown options and requiredness, disabled
Field Type, and saved its description. New Field subsequently opened with blank
name/description, Text type and Required off; Applies To was absent.

The following widths were exercised: **1440, 768, 390, 375 and 320 pixels**.
Cards, Edit Field menus, New/Edit drawers, Product checkbox popups and the Industry
select were checked. Document scroll width equaled viewport width at each size;
menus and form controls remained within the viewport. Drawers scrolled vertically
with reachable footer actions. Measurements are saved in `layout-checks.json`;
screenshots use the `custom-fields-*`, `field-menu-*`, `new-field-*`, `edit-field-*`,
`deal-drawer-*`, `product-popup-*` and `industry-*` filenames.

## Limits

- A completely green Workflow names integration suite: **I cannot confirm this.**
  Its remaining failure is the disposable database connection error described above.
- Real Gmail/provider behavior and deployment PostgreSQL migration/backfill:
  **I cannot confirm this.** Provider input was simulated in integration tests.
- Mock-mode browser batch submission and a real browser network interruption during
  submission: **I cannot confirm this.** API retries/concurrency were tested; the
  mock and pending-request branches were implemented but not separately exercised
  through browser fault injection.

Earlier failed checks were retained in logs. They included obsolete automation-card
and cancellation expectations, an incomplete frontend auth/mock fixture, a stale
checked-in JavaScript action catalog, and a composite-key fixture error. These were
corrected. Windows sandbox file access and a Prisma DLL lock required rerunning
commands with access to their temporary files and without concurrent Prisma generation.
