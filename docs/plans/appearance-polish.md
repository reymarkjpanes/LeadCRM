# Appearance and connected UI polish

## Scope and assumptions

Implement the fourteen findings in the local appearance audit while preserving the current architecture, existing worktree changes, tenant isolation, RBAC and supported lifecycles. This is a polish pass; do not restore retired features or create speculative fields/endpoints. Existing broader domain work is documented in [system polish](system-polish.md).

Appearance remains a device-local preference, with Classic, Light, Dark and System modes. Public authentication, onboarding and legal pages remain light. Customer-authored form/email previews retain their design; administrative controls follow the application theme. No live database migration, deployment or provider send is part of local verification.

## Ordered implementation

1. Capture baseline TypeScript results and preserve the current versions of touched files. Introduce one shared appearance store/hook with validated persisted values, System media-query updates, cross-tab storage synchronization and compatibility with existing appearance events. Initialize scoped appearance before visible rendering; never darken public pages globally.
2. Give CRM layout, authenticated loading/recovery and global notifications shared theme scopes. Migrate every body/Radix portal to a theme-aware wrapper. Preserve positioning, stacking, confirmation loading/error behavior and public-page appearance.
3. Connect both Settings entry points and reusable appearance controls to the same state. Include Classic everywhere, use shared accent tokens and align previews/legacy Settings surfaces with current semantic tokens.
4. Repair mobile selected-row actions and standard modal focus entry, containment, Escape dismissal and restoration, including nested menus/portals. Preserve caller-specific busy/close rules.
5. Connect chart/campaign preview consumers to resolved appearance. Theme Form Builder editing controls without changing authored preview content. Complete route aliases, breadcrumbs and the Profile Settings return link.
6. Trace module APIs, mutation invalidation and permission guards against existing contracts. Fix reproducible integration defects; retain useful data during refresh and leave backend authorization authoritative.
7. Add focused behavior regressions, run frontend/backend/shared checks and builds, then smoke-test reachable mock UI at desktop/mobile widths. Record unsupported fixtures/provider/database scenarios explicitly.

## Module and API integration map

API paths are relative to `/api/v1`; the browser uses the existing same-origin `/api/proxy` transport.

| Area | Polish and integration points | APIs / shared dependencies | Verification |
| --- | --- | --- | --- |
| Shared appearance / shell | Mode, density, accent, prepaint scope, OS/storage subscriptions, portals, toaster, loading | Browser preferences; no new API | Four modes, invalid/missing storage, OS changes, two subscribers/tabs, public isolation |
| CRM Leads / Contacts / Accounts / Deals / Pipeline | Drawers, dialogs, row actions, confirmations, calendars, selection bars, correct module navigation | `/crm/*`, `/crm/pipelines`, cache/count/report invalidation | Create/edit/archive/restore callers, permission-denied/error states; no live destructive actions |
| Tasks | Editor, assignment/reschedule/confirmation, responsive bulk actions and focus | `/operations/tasks`, shared deadline contracts and cache | Admin/staff access, reschedule data retained, mobile actions, nested date/time portals |
| Workflows | Create/edit/log/confirmation surfaces and theme updates | `/automation/workflows`, workflow options, Groups/Products reference data | Existing activation/validation/permission regressions and scoped overlays |
| Campaigns | Audience/template/builder panels, mobile preview, route aliases | `/marketing/campaigns`, templates/audiences, sender permissions | Theme changes while open, draft preservation, existing delivery regressions; no sends |
| Forms | Editor chrome, mobile tools, publish/archive/share callers | `/marketing/forms`, shared form contracts, Products | Edit/publish permissions preserved, authored preview colors retained |
| Inbox | Compose/scheduled-mail dialogs, selectors, notifications | Existing Gmail/mailbox endpoints and revision events | Existing owner/access/cancel regressions; no OAuth connection or provider send |
| Notifications | Bell popup, page confirmations and themed semantic toasts | `/notifications`, revision/count updates | Empty/error/populated component tests and shared theme synchronization |
| Settings / Administration | Appearance, Profile return link, users/groups/roles/products/archive overlays | `/auth/profile`, `/administration/*`, permission/revision events | All modes, accent/density sync, admin/custom-role controls, existing security tests |
| Dashboard / Reporting / Help | Chart appearance, breadcrumbs and token-driven content | Existing reporting dashboard definitions and export; Help content | OS/theme update propagation, report regressions, public/authenticated Help isolation |
| Auth / onboarding / legal / public forms | Preserve public styling and authenticated-loading appearance | Existing auth/session middleware and public Form contracts | No public dark leakage; tenant/permission isolation remains unchanged |

## Verification and acceptance

- Shared tests must exercise behavior: saved preference survives reload, System changes notify every subscriber, public scopes stay light, portal contents inherit active theme/accent, nested overlays retain keyboard access, and closing restores focus.
- Integration tests must cover successful mutation invalidation and failed writes that do not invalidate state, cross-module effects and role/tenant boundaries already supported by the repository.
- Run relevant component/unit tests, then frontend/shared/backend TypeScript and production builds. Database-dependent suites must use the repository's isolated test runner; never run them against an unspecified configured database.
- Browser-check the main Settings and legacy entry, New Account, Create task, task row/calendar/confirmation, mobile selected actions, notifications and fixed navigation using mock data. State exact limits for API-dependent data and unavailable roles/provider scenarios.
- Completion means every audited fix is implemented and relevant checks pass, or a concrete remaining limitation is documented. Do not claim all roles/scenarios were manually executed without evidence.

## Progress

- [x] Plan, module/API map and assumptions recorded before source edits.
- [x] Shared appearance and portal foundation.
- [x] Settings, accents, previews and scoped loading.
- [x] Modal accessibility and mobile bulk controls.
- [x] Forms/charts/campaign theme consumers and navigation.
- [x] API/cache integration review and verified fixes.
- [x] Regression tests, checks/builds and browser evidence recorded in [verification](../verification/appearance-polish.md), including live-API, Manager-fixture and Windows Prisma generation limits.
