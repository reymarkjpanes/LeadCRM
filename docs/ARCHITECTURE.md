# LeadCRM architecture

## System boundaries

LeadCRM is an internal CRM with tenant-scoped data and Client Admin/custom staff roles. The monorepo has three workspaces: `frontend` (Next.js App Router), `backend` (Express/Prisma), and `shared` (TypeScript contracts, Zod validation, permission metadata). There is one CRM workspace dataset; public Forms provide the guest entry point. Retired SaaS and operational modules are not part of the current architecture.

Browser → Next.js `/api/proxy` → Express `/api/v1` → domain services → Prisma/PostgreSQL.

The frontend server reads `API_URL`. Authentication uses the existing HttpOnly cookie or a persisted Bearer session. The backend rechecks the current user, role/session, workspace status, password/onboarding state, and permissions. Tenant identity comes from the authenticated context rather than request bodies. Only `ACTIVE` and compatibility `SANDBOX` workspace statuses permit CRM access; missing or unsupported statuses fail closed.

## Frontend

Routes in `frontend/app` are thin routing shells. Domain UI, hooks, and API services live under `frontend/src/features/tenant`; navigation uses Next.js routing. `AuthContext` holds current account/permission state. `DataContext` supports shared CRM state and development mocks; live domain hooks/services also use the shared API transport directly. Production mocks are disabled.

Shared UI under `frontend/src/shared` contains drawers, forms, permission guards, table/preferences helpers, and chart primitives. Reuse the existing domain detail views and hooks before creating another parallel implementation. Local invalidation events refresh the affected views while preserving drafts and matching rows during background reads; permission loss clears protected data.

## Backend

`backend/src/api/routes` defines registered HTTP routes and action-specific permission checks. Middleware handles authentication, tenant/readiness, validation, rate limiting, and errors. Domain services live in `backend/src/modules`; database access uses existing repositories and transaction helpers. Controllers translate HTTP input/output; services carry business rules and transaction boundaries.

Related relationship, audit, and record writes commit together. Tenant-scoped IDs are validated before association. Create/edit/archive/restore actions retain their module-specific authorization. Backend guards remain authoritative even when the frontend hides a control.

## Canonical data and integration points

| Domain | Canonical relationship or rule |
| --- | --- |
| Users and Groups | `TenantGroup` + `TenantGroupMember`; admin writes `groupIds`, reads return Group summaries; Profile is read-only; Workflows use the same membership pool |
| Roles | `RoleDefinition`, `UserRole`, and `RolePermission`; metadata and permission replacement save in one transaction |
| Customer records | Leads, Contacts, Accounts and their relationships share tenant validation, imports, file history, and CRM activity |
| Deals | Canonical `accountId`; ordered Lead/Contact associations; current Product price snapshots at creation; governed stage changes |
| Tasks | Ordered CRM associations, assigned user, activity/assignment history, shared Manila date conversion; unfinished work transfers during user deactivation |
| Forms | Saved definitions and submissions; publish permission is separate from editing; submission-only fields are labeled clearly |
| Reporting | Reports reuses Dashboard's authorized server aggregates, filters, real stage labels, and CSV definitions |
| Gmail | Persisted scoped mailbox history and owned account; recipient/CRM assignment checks apply to manual, scheduled, and Workflow sends |
| Campaigns | Durable submission lease and recipient attempt markers; provider webhooks record delivery; interrupted uncertain outcomes remain reviewable without automatic resend |

The Department-to-Groups migration preserves all existing memberships and creates/reuses same-tenant Groups for nonblank legacy values before dropping the old field. It does not create a second assignment mechanism. Multiple Group memberships remain supported.

## Updates and background work

Committed tenant revisions drive Dashboard SSE and the independent authorization stream. Group changes increment the existing access revision, so open User/Profile/Workflow views can refresh their current data. Pipeline metadata has its own authenticated revision stream. Mailbox uses persisted synchronization/version state and an authenticated event stream; opening Inbox does not force a provider reload.

Workflows and notification delivery use their existing background services. Notification outbox defaults and raw SQL due/lease comparisons use explicit UTC so a non-UTC database session cannot claim reminders early. Historical timestamps remain preserved. Campaign submission recovery discovers bounded expired work, finalizes known unsent recipients, and flags uncertain outcomes `INTERRUPTED` for review. The obsolete campaign scheduler is removed. Inbox scheduling remains a separate Gmail-backed service; read/cancel operations are owner-scoped, and cancellation competes atomically with the transition to sending. Confirmed delivery is never requeued because later history cleanup fails.

## Shared package

`shared/src` defines reusable contracts, permission keys, canonical schemas, date helpers, and response types consumed by both workspaces. TypeScript is the source of truth. `npm --prefix shared run build` synchronizes compatibility JavaScript companions used by plain Node consumers; do not edit those generated files independently. Tests resolve TypeScript before JavaScript to avoid stale contract copies.

## Deployment and verification

Stop old backend processes and apply forward migrations before starting the matching backend. The current polish introduces `20261116000000_user_groups`, `20261117000000_campaign_submission_recovery`, `20261118000000_group_revisions` and `20261119000000_notification_utc_timestamps`. See the [rollout steps](../README.md#forward-rollout) and [system polish plan](plans/system-polish.md). Production database changes and provider sends require their own operational verification; source/tests are not evidence of a deployed release.

## References

- [API](API.md), [structure](STRUCTURE.md), [authentication](authentication.md)
- [Dashboard definitions](dashboard-kpis.md), [normalization report](database/normalization-report.md), [entity relationships](database/normalization-erd.md)
- [Security cleanup](security-cleanup-mfa.md), [CRM workspace](crm-environments.md), [retired features](retired-features-cleanup.md)
- [Forms](forms-production-report.md), [Campaign delivery](campaign-email-delivery.md), [Workflow assignment/history](workflows/workflow-assignment-history.md)
- [Engagement and Deal creation](engagement-deal-creation.md), [Custom Fields](custom-fields.md), [CRM archive behavior](crm-archive-verification.md)
