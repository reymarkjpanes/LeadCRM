# LeadCRM

LeadCRM is the internally managed CRM for Camxian Technologies. It combines customer records, a governed sales pipeline, Tasks, Workflows, Forms, Campaigns, Gmail Inbox, reporting, and team settings. Start at `/login`.

The codebase is a Turborepo monorepo with Next.js, Express, TypeScript, PostgreSQL/Prisma, and the shared `@leadcrm/shared` contracts. The workspace supports Client Admin and permission-based custom staff roles. Tenant isolation remains enforced even though the current product is an internal CRM.

## Current modules

| Module | Primary entry point | Integration |
| --- | --- | --- |
| Dashboard and Reports | `/dashboard`, `/reporting` | The same authorized server aggregates, date definitions, revision events, and CSV export |
| Leads, Contacts, Accounts | `/crm/leads`, `/crm/contacts`, `/crm/accounts` | Customer relationships, conversions, imports, files, Product Interests, and related Deals/Tasks |
| Deals and Pipeline | `/crm/deals`, `/crm/pipeline` | Product price snapshots, ordered associations, governed stage transitions, and activity |
| Tasks | `/operations/taskboard` | Immutable creator, current Assigned Agent, contextual CRM associations, completion, archive, and Manila calendar dates |
| Workflows | `/automation/workflows` | Saved triggers/conditions/actions, role and Group assignment pools, execution history |
| Forms | `/marketing/forms` | Published guest forms at `/forms/:publicId`, validated submissions, CRM capture |
| Campaigns | `/marketing/campaigns` | Single-source audiences, field personalization, Send Now/Schedule Once, Brevo email, TextBee SMS, provider status/webhooks |
| Inbox | `/inbox` | Scoped Gmail history, drafts, replies, scheduled message review/cancellation, CRM relationships |
| Settings and team administration | `/settings` | Profile, users, Groups, roles, Products, Customize Fields, Archived Data, organization settings |
| Notifications and Help | `/notifications`, `/help` | Permission-aware destinations, personal notification preferences, product guidance |

Public signup, a separate platform portal, SaaS billing, service orders, technician dispatch, asset inventory, and customer invoicing are retired. Historical documents are background; the current route registrations and shared contracts define supported functionality.

Accounts represent companies and organizations. Their assignment and product fields are retired; Account actions use tenant-scoped module grants. Products and assignment remain on supported sales records. See [Account field retirement](docs/accounts-field-retirement.md) for preservation and guarded cutover.

Lead and Contact Organization forms can atomically create linked Accounts. Account
legacy notes move into Activity before a separately guarded internal-notes column
retirement. Workflow run definitions use readable saved settings. See
[CRM polish and notes rollout](docs/crm-polish.md).

## Groups replace Department

Group membership has one source of truth: `TenantGroupMember`. User administration accepts `groupIds`; User and auth responses expose `groups: [{ id, name }]`. Client Admin manages memberships in the user form or existing Groups screen. Profile displays memberships read-only. Workflows use these same Groups for assignment; roles continue to control permissions.

The forward migration preserves existing memberships and turns each nonempty legacy Department into a Group in the same tenant, reusing an existing case-insensitive name match before dropping the retired column. Multiple memberships remain supported.

The protected default Sales Group has stable key `SALES`; renaming its display label preserves routing. Membership remains administrator-managed. New public-form Leads rotate only among its eligible members, with a transactionally persisted cursor and request-ID retries consuming one turn. Returning records retain their agent. See [Forms verification](docs/forms-production-report.md).

In Team Management, an active Client Admin can provision another Client Admin through New User or change another user's Client Admin assignment in User Details. Role changes preserve at least one active Client Admin. Delegated staff with Users Create and Roles Assign permissions can provision active custom roles.

## Local development

Use the project-pinned npm version from `package.json` and a supported Node version (20.19+, 22.13+, or later). A local PostgreSQL instance is required for API-backed development.

1. Run `npm install` from the repository root.
2. Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env.local`. Use development database/provider credentials. Set frontend `API_URL=http://localhost:4000/api/v1`; browser requests use `/api/proxy`.
3. Generate Prisma with `npm --prefix backend run db:generate`. Apply migrations to the disposable/local database with `npm --prefix backend run db:migrate`. Existing deployments use the forward rollout described below.
4. Start `npm --prefix backend run dev` and `npm --prefix frontend run dev` in separate terminals, or use `npm run dev`.
5. Provision local accounts using the documented [authentication flow](docs/authentication.md). Startup does not run seeds automatically.

For a connected UI preview, use `npm run dev:local`. It builds the current backend/shared code, starts the existing API-only launcher on loopback port 4000, and starts the frontend on port 3000 with its proxy explicitly pointing to that local API. It uses the database configured in `backend/.env`, keeps normal authentication/RBAC, and starts no seeders or scheduled jobs. Existing local previews must be stopped first. This avoids testing new frontend contracts against an older hosted API, which can expose legacy UUID keys and reject drag-and-drop layout commands. See [Custom Fields](docs/custom-fields.md#metadata-rollout).

For a persistent, isolated local app, run `npm run dev:isolated`. PostgreSQL tools (`pg_config`, `initdb`, `pg_ctl`, and `psql`) must be installed; set `POSTGRES_BIN` to their directory if it is absent from PATH. The launcher creates its own password-protected database on loopback port 55434, applies migrations, builds the backend, and starts the full API with background workers on port 4000 and the frontend on port 3000. It provisions a local admin and sample records once. Sign in at `http://localhost:3000/login` with the credentials in `.env.local-development/LOGIN.txt`.

The ignored `.env.local-development` folder holds the database, private uploads, and credentials. Records survive restarts. The launcher supplies its own backend configuration; it does not use the database or provider secrets in `backend/.env`. Email/SMS delivery and Gmail connection require separate local provider setup. Stop with Ctrl+C, or run `npm run dev:isolated -- --stop` from another terminal. After a clean stop, use the same start command to resume; add `-- --skip-build` only when the current backend is already built. Ports 3000 and 4000 must be free.

Mock auth and data are separate development-only switches, `NEXT_PUBLIC_USE_MOCK_AUTH` and `NEXT_PUBLIC_USE_MOCK_DATA`. They are disabled in production. Mocks support UI work; they do not verify database, permission, or provider behavior.

## Checks

- `npm run lint`: shared/backend/frontend TypeScript checks.
- `npm run build`: workspace production builds and generated shared JavaScript synchronization.
- `npm run qa:local -- --native`: counted isolated acceptance, builds and browser fixtures with a fresh native PostgreSQL cluster; see [QA prerequisites and gates](docs/verification/system-qa.md).
- `npm run test:integration`: discover backend integration suites, replay migrations into fresh PGlite fixtures and reject missing/skipped required results. Native concurrency remains a separate required gate.
- `npm --prefix backend run test`: backend Vitest suite.
- `npm --prefix frontend run test`: frontend Vitest suite.
- `npm --prefix backend run test:rollout`: guarded migration deployment planning checks.
- `npm --prefix backend run test:migration-scripts`: historical migration checks under the native Node test runner with disposable PGlite data.
- `node backend/scripts/test-polish-isolated.mjs`: disposable PostgreSQL-compatible migration/HTTP tests for the Groups changes. It does not use the configured application database.

## Forward rollout

Stop old backend processes, then apply the existing migration history and these new migrations before starting the updated backend:

1. `20261116000000_user_groups`: preserving Department-to-Groups conversion.
2. `20261117000000_campaign_submission_recovery`: durable submission leases/attempt markers and `INTERRUPTED` status.
3. `20261118000000_group_revisions`: Group changes join the existing authenticated access-revision stream.
4. `20261119000000_notification_utc_timestamps`: consistent UTC defaults for new notification/outbox records; historical timestamps remain preserved.
5. `20261120000000_password_recovery_security`: protected password-recovery token storage.
6. `20261121000000_mailbox_reply_header`: nullable provider reply metadata.
7. `20261121000000_task_creator_sales_group`: immutable nullable Task creator, reliable audit backfill and protected Sales Group provisioning. Resolve ambiguous case-insensitive legacy Sales names before rollout; this migration refuses to silently merge them.
8. `20261123000000_campaign_schedule`: Scheduled status, approved schedule configuration/actor, and audience match mode (AND by default).
9. `20261124000000_crm_content_revisions`: committed CRM-content revision counter/triggers and stable Activity cursor index.

The Task/Workflow integrity release also requires
`20261204000000_workflow_stage_entry_identity` after the complete existing
migration history. It adds the exact current Deal stage-history identity,
backfills only uniquely proven entries, and preserves historical rows. Stop old
writers before this migration and deploy matching backend/frontend builds.
See [verification and rollout](docs/workflows/task-workflow-integrity-report.md).

Follow `npm --prefix backend run db:deploy` and the existing [normalization rollout](docs/csv-import-normalization.md) and [relationship retirement](docs/database/normalization-report.md) prerequisites. Regenerate Prisma/build, then start the updated backend and verify authentication, membership visibility, assignment options, reporting, and recovery. Do not run old backend binaries after the Department column is removed.

An interrupted Campaign preserves uncertain provider outcomes for review and does not automatically resend them. Scheduled Inbox cancellation competes atomically with the worker; delivery already in progress cannot be cancelled as though it were unsent.

Campaign Schedule Once uses Asia/Manila input and UTC storage. Due dispatch resumes from persisted schedules after restart, rechecks current eligibility/authorization, and reuses the existing sender. Unclaimed cancellation/rescheduling competes atomically with dispatch. No exact-second execution is promised while the backend is offline.

## Documentation

- [Architecture](docs/ARCHITECTURE.md), [project structure](docs/STRUCTURE.md), [API reference](docs/API.md)
- [System polish plan](docs/plans/system-polish.md)
- [Appearance verification](docs/verification/appearance-polish.md), [responsive navigation and PWA verification](docs/verification/responsive-pwa.md)
- [Authentication and onboarding](docs/authentication.md), [security cleanup](docs/security-cleanup-mfa.md)
- [Dashboard definitions](docs/dashboard-kpis.md), [database normalization](docs/database/normalization-report.md)
- [CRM imports](docs/csv-import-normalization.md), [Product normalization](docs/product-normalization-report.md), [Custom Fields](docs/custom-fields.md)
- [Shared CRM record views, history and synchronization](docs/crm-record-detail-ui.md)
- [Forms verification](docs/forms-production-report.md), [Campaign email delivery](docs/campaign-email-delivery.md)
- [Engagement and Deal creation](docs/engagement-deal-creation.md), [Workflow assignment/history](docs/workflows/workflow-assignment-history.md)
