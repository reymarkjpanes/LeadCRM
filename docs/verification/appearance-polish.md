# Appearance polish verification

## Scope

This implements the appearance audit and connected UI defects according to the [implementation plan](../plans/appearance-polish.md). Existing domain work in [system polish](../plans/system-polish.md) was preserved. Appearance remains a device preference; existing API contracts, production authentication, tenant checks and RBAC remain authoritative.

Assumptions: local mock data is appropriate for visual verification; public login/onboarding/legal pages retain their public design; customer-authored form and email previews retain their own colors. Real provider sends, OAuth, deployment and database migration are outside this local polish pass.

## Implemented fixes

| Area / component | Change | Verification scenario |
| --- | --- | --- |
| Settings / Appearance; Profile Settings / Appearance; reusable AppearancePreferences | One shared store for Classic, Light, Dark, System, accent and density; validated persisted values and storage-event synchronization | Component tests select Dark/Purple/Large across all three controls, unmount/remount, handle invalid saved values and legacy events |
| System mode / charts / Campaign Builder preview | One OS subscription updates every mounted consumer; charts use resolved state rather than a DOM query | Change mocked OS light to dark with two consumers mounted; Chart.js axes/tooltips update; Classic remains Classic |
| CRM shell / authenticated loading and recovery | Scoped prepaint appearance and shared loading surfaces | All four prepaint modes are tested; public scopes omit workspace dark styling |
| Account/task panels; Dialog, Sheet, SideSheet, RecordDrawer | Explicit inherited theme scope for body portals | Shared overlay tests switch appearance while an editor is open, preserving its draft |
| ConfirmActionDialog | Themed portal without making its own wrapper inert; existing async/error/session guards preserved | Confirmation regressions; open confirmation over editor, cancel and restore parent action focus |
| RowActionsMenu, DropdownMenu, date/time pickers, Tooltip, SelectedRowsBar | Shared portal wrapper; owned floating controls remain reachable inside modal focus containment | Calendar receives keyboard focus; first Escape dismisses calendar and returns focus without dismissing editor |
| Dialog, Sheet, SideSheet, RecordDrawer | Default focus containment, Escape, opener restoration and shared scroll locking | Tests cover all three actively used modal primitives, Tab containment, retained drafts and restored body overflow |
| Form Builder / mobile tools; Task Editor; Security and Workflow dialogs | Remove overlapping local focus/scroll handlers now owned by shared primitives | Form tools regression reproduced body overflow stuck at `hidden` after Escape; regression now checks scrolling, opener focus and retained edits |
| Tasks / mobile selected-row actions | Wrapping action dock constrained to viewport and safe-area bottom | Browser verification recorded below |
| Notifications / bell popup / Sonner | Theme scopes for popup and global toaster | Browser check of dark bell popup; existing notification selection/confirmation tests |
| CRM / Inbox / Settings / Administration / shared controls | Primary actions, selection/focus affordances and enabled switches consume the selected accent | Compiled CSS regression proves semantic utilities resolve locally; browser checks Purple primary action |
| Settings / Organization / Profile / Form Builder | Semantic surfaces replace old Settings palette; editor chrome follows theme | Existing profile, organization and form editor regressions; authored form design preserved |
| Profile Settings / Back; Campaigns, Forms, Companies route aliases; breadcrumbs | Absolute Settings return link and correct route mappings | Route-map tests cover aliases; browser navigation verification below |
| Archived Data / restored Task | Restore invalidates task/activity, report and archive caches after success | API invalidation tests; unsuccessful writes do not invalidate cached data |
| Mock authentication / custom roles | Mock permissions resolve declared canonical grants within the user's tenant; unknown/archived roles fail closed | Sales/custom-manager grant tests, invalid grant tests and cross-tenant checks; production authorization is unchanged |
| Account menu / demo switcher | Show demo accounts only in mock-auth sessions; label Bob's actual role as Sales | Tests prove connected sessions retain Logout and omit demo account actions; local Sales switching remains available |

Status colors, record identities and chart categories may retain explicit colors where they communicate meaning. This pass does not claim that every color literal is eliminated.

## Automated verification

- Full frontend suite: **147 files, 1,237 tests passed**, zero failures (486 seconds, two workers, 20-second per-test timeout). JSON evidence is saved outside the checkout in the task artifact directory.
- Final refinements: Appearance, Profile, Security, sidebar and connected/mock account-menu tests passed. The new nested row-menu Escape regression initially exposed an unconditional ResizeObserver dependency in the test environment; the guarded fallback was added and **20 modal/row-menu tests passed** on rerun.
- Final modal caller cleanup: **66 tests across 8 files passed**, including the reproduced-and-fixed Form tools scroll-lock bug, task drafts/selectors, password busy guards and workflow activation/configuration behavior.
- Final `npm run lint`: **all three workspaces passed** (shared/backend cached; frontend checked after the final edits).
- Final frontend production build: **passed**, including type validation and **180 generated static pages**. Shared build and backend TypeScript compile passed earlier in this pass.
- Final patch whitespace check: **passed**. Temporary QA server, snapshot and migration helpers were removed; saved audit, baseline and verification evidence were retained outside the checkout.
- Earlier isolated backend permission suite: **10 tests passed**, including independent grants and role/tenant boundaries. Backend TypeScript compiled. Prisma client generation succeeded in an isolated output directory; generation into the normal directory was blocked by a Windows DLL lock held by an existing process.

The full frontend regression run covers existing create/edit/archive, role controls, related-record navigation, failed saves, background refresh and cross-module integrations using fixtures. Existing React `act` and jsdom `scrollTo` warnings remain in some suites; they did not cause a failing test.

## Browser verification

Desktop testing uses a separate local mock app snapshot on port 3102. The normal checkout and existing backend process are preserved. Visual checks do not submit provider sends or live database writes.

Already observed: Classic and Light have white cards; Dark and System (OS dark) have dark cards. Purple selection updates the Appearance primary button. Saved Dark survives reload with dark authenticated loading. New Account receives a dark theme scope and modal focus. Notifications receive a dark portal scope.

Final checks used the current implementation in the isolated mock snapshot:

| Session / viewport | Scenario | Observed result |
| --- | --- | --- |
| Client Admin / desktop 1440 × 900 | Accounts → Add Account → Create New | New Account dialog background `rgb(22, 25, 30)`, foreground `rgb(241, 245, 249)`; Create Account uses Purple `rgb(147, 51, 234)`; focus enters the dialog |
| Client Admin / desktop | Tasks → Create Task → type an unsaved title → Due date and time → Next month → Escape | Calendar keeps the dark surface; first Escape closes only the calendar, returns focus to the date trigger and preserves the task draft; second Escape closes the editor without saving |
| Client Admin / mobile 391 × 844 | Select task_4 and task_3 | Selection dock spans x=6 to x=385.2; Clear selection, Mark as done, Assign, Reschedule and Archive all remain within the 391 px viewport |
| Client Admin / mobile | Selected tasks → Archive → Cancel | Archive tasks? confirmation has dark background, focus inside, bounds x=16 to x=375.2; no archive submitted |
| Client Admin / desktop | `/settings/profile` → Appearance | Classic is present; saved Dark and Purple are selected; Apply Changes uses Purple with white text |
| Client Admin / desktop | Profile Settings → Back to Settings | Navigates to `/settings`, without the previous invalid relative route |
| Public / desktop | Log out while Dark is saved | Login retains its public light design; the root has no `dark` class |
| Sales / desktop | Sign in using existing Bob Sales fixture → Tasks | Saved Dark remains active; Sales sees task rows but no Create Task or bulk-selection controls; Accounts, Campaigns and Workflows are absent from primary navigation |
| Sales / desktop | Account menu → Appearance → Classic → Light → Dark → System | Shared shell updates to the corresponding scope immediately; System resolves to actual OS dark; Purple is retained. Settings shows personal Profile and Appearance entries. Dark was restored after testing |

The local screenshot evidence includes the complete mobile selection dock in Dark mode. The task table itself retains horizontal scrolling inside its grid container. These earlier screenshots are retained outside the checkout.

The saved frontend test JSON and original appearance audit are retained outside the checkout. The audit describes the pre-implementation defects; current results are recorded here. Subsequent integrated checks and portable screenshot evidence are recorded in [responsive and PWA verification](responsive-pwa.md).

No mock record was created, edited or archived during these visual checks. Confirmation was cancelled and selection cleared. Browser viewport testing does not establish physical-device Safari/Chrome coverage.

## Practical limits

- Some modules intentionally require API responses even in mock mode. Mock authentication does not create a real HttpOnly backend session, so those screens can show an API authorization error. Component/API tests cover these flows; this is not a successful live-backend browser test.
- Existing mock roles do not include a Manager account. Custom-manager permission resolution is automated coverage, not a manually executed Manager session.
- System OS transitions are exercised with controlled media-query tests. The browser's actual OS preference was dark during manual testing.
- Shared and backend checks are recorded separately from frontend coverage; passing mocks does not establish real provider delivery or migration success.
