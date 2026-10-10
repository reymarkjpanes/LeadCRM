# Responsive app shell and PWA verification

## Navigation behavior

| Viewport | Default | Expansion |
| --- | --- | --- |
| Below 768px | Hidden | Modal drawer, bounded to the viewport |
| 768–1024px | 56px rail | Modal drawer over the content |
| 1025px and above | 220px sidebar | User can collapse to a 56px rail |

Desktop preferences are scoped to tenant and user. Temporary overrides do not replace the saved preference. Route changes, crossing navigation breakpoints, opening a blocking overlay, and entering app focus mode close the navigation drawer. Ordinary desktop dialogs leave the docked sidebar in place; their background is inert. Visible docked panels temporarily collapse desktop navigation only when they would leave less than 720px of usable workspace after margins.

Mobile and tablet navigation support Escape, outside dismissal, left swipe, focus trapping, and background scroll locking. Vertical movement is excluded from swipe dismissal. App focus mode and the native Fullscreen API hide navigation and restore the normal preference on exit. Mobile and tablet breakpoint changes apply their rail width immediately; desktop user collapse retains its animation. This prevents a desktop sidebar from temporarily consuming a narrow mobile viewport while resizing.

## Shared layout changes

- The top install banner occupies normal layout space. Its measured height is deducted from the app viewport; navigation starts below it.
- Shared page headers keep create actions aligned with the title at every width, with the subtitle below. Shared primary create actions show only the + icon below 640px, retaining their accessible label and tooltip; larger screens show the full label. The Deals header keeps its stage-management gear immediately before New Deal. Team Management places New User or New Group beside its title, above the tabs. Create dropdowns open inward from the right edge at every width. Table settings submenus expand within the menu on mobile and support tap and keyboard activation.
- Shared dialogs have viewport gutters, bounded height, and internal scrolling. Sheets and record drawers use dynamic viewport height. Nested overlays retain scroll and inert locks until the final overlay closes.
- Legacy role, task, deal, handoff, scratchpad, inbox, and template preview surfaces use the shared dialog behavior. The existing form payloads and API permission checks are retained.
- Manage Columns, owner profiles and record-level lost-deal confirmation also use shared overlay handling. Columns retain save/retry/reset and unsaved-change confirmation; dismissal is blocked during a pending save. Owner profile content scrolls inside the viewport.
- Settings, filter rails, and form builder tools dock only when there is enough space. Smaller layouts use a section selector or modal drawer.
- Public and authentication pages account for banner height; mobile inputs retain a readable 16px minimum.

## PWA behavior

The banner displays only after a usable browser-issued `beforeinstallprompt` event. It is suppressed in installed display modes, after `appinstalled`, after dismissal, and after cancellation for the current page load. Prompt events are consumed once, and duplicate clicks are guarded. X dismissal lives in provider memory, survives SPA navigation, and resets on a new page load, including reopening or refreshing. The old `leadcrm:pwa-install-dismissed:v1` storage entry is removed on mount. Installation observed through `appinstalled` or an installed display mode is recorded separately as `leadcrm:pwa-installed:v1`, persists across page loads and suppresses promotion in other open tabs. Accepting the prompt alone does not persist this flag. Storage failures fall back to memory; clearing storage or using another browser profile removes this remembered installation state.

Successful installation shows one confirmation toast. Prompt failures show an actionable error toast. Resizing and ordinary dismissal are silent. Help includes browser-specific installation instructions when a native prompt is unavailable.

The banner has its own `ThemeScope`, so Classic, Light, Dark and System use the existing appearance store without changing the styling policy of public pages. Dedicated banner variables use the requested palette independently of the app accent, including violet. System follows live operating-system appearance changes. Appearance changes do not remount the install provider or discard a captured prompt.

| Element | Light / Classic | Dark |
| --- | --- | --- |
| Background | `#EBF2FE` | `#161D2A` |
| Bottom border | `#BDD3F3` | `#303E55` |
| Message | `#18202B` | `#F0F2F4` |
| Install button | `#1E64EF` | `#4384FF` |
| Install text and download icon | `#FAFBFD` | `#FFFFFF` |
| Dismiss icon | `#62748E` | `#9099A7` |

At every width the banner is a single row: “Get the LeadCRM app!” on the left, Install and X on the right. The message is 13px below 640px and 14px above; Install text remains 13px. Vertical padding is 4px and the controls retain 44px minimum heights, making the banner approximately 53px tall before any device safe-area inset. Install keeps its 14px download icon and content-sized width. The measured banner height continues to update through `ResizeObserver`.

The manifest uses correctly sized 192px and 512px icons, a separately padded maskable icon, and a stable app ID. The service worker refreshes the public asset cache while preserving its existing exclusion of API, private, and dynamic CRM responses.

## Verification scope

Earlier browser verification used an isolated local mock session and temporary iframe harness. The current follow-up uses the production provider, theme scope, appearance store, PageHeader and CreateButton in an isolated component preview with an explicit browser viewport override. It does not recreate the full CRM page. Measurements use the browser's reported dimensions, which can round slightly at the current desktop zoom.

Native installation is simulated through `beforeinstallprompt`, `userChoice`, and `appinstalled`; no operating-system app is installed by these checks. The current simulation verifies eligibility gating, colors, one prompt invocation, dismissal reset after reload, and installed-state suppression after reload.

The mock UI session has no live backend authentication. A disposable loopback fixture supplies populated dashboard/reporting data, a draft form and a connected but empty email inbox. It never forwards requests or sends mail. Other API-dependent modules use available empty, loading and recoverable error states. Automated feature tests cover populated data and existing business operations. Live backend CRUD, real device keyboards, and native Chrome/Edge/iOS installation remain release checks.

## Current compact banner checks

- All twelve palette colors matched the browser's computed colors in Light and Dark; the blue Install button remained unchanged with a violet app accent.
- Widths 320, 480, 639, 640, 768, 1024 and 1440px passed without horizontal overflow or banner text overlapping Install. Create labels were hidden through 639px and visible from 640px. The gear stayed immediately before New Deal and vertically centered with the title at every width.
- At 320px the banner measured approximately 52.8px in both Medium and Large appearance density, with the message fitting on one line.
- X hid the banner; reloading and supplying a fresh prompt showed it again. Clicking Install invoked the retained simulated prompt once. Recording installation, reloading and supplying another prompt kept the banner hidden.
- Frontend TypeScript checking and four focused test files passed: 33 tests covering PWA lifecycle, appearance, compiled CSS and pipeline-stage management. The temporary preview files and server were removed and the browser viewport override was reset.

## Current module create-header checks

- The shared `PageHeader` now defaults to the same title/action row used by Deals. This covers Leads, Contacts, Accounts, Tasks, Campaigns, Forms, Workflows, Products, Custom Fields and both Roles & Permissions pages. Team Management's existing child-supplied action now renders beside its content title rather than its tabs. Module labels, handlers and permission conditions are retained.
- An isolated preview used production `ModuleWorkspace` instances for Leads, Contacts, Accounts and Tasks, production `TeamManagement` with fixture services, and shared production `PageHeader` / create controls for the remaining modules. It did not recreate every full module page.
- Eleven header configurations passed at 320, 480, 639, 640, 768, 1024 and 1440px: 77 cases with title/button vertical alignment, actions at the right edge, subtitles below, no header or document overflow, and labels hidden below 640px / visible from 640px. A read-only header remained without a create action.
- At 320px the Leads create menu stayed inside the viewport and its Create New item invoked the fixture action. Switching Team Management to Groups retained title alignment; New Group opened the existing dialog.
- Frontend TypeScript checking passed. All three existing Team Management test files passed: 25 tests. A pagination test exceeded the unchanged five-second timeout in the sandbox, then the full focused run passed outside the sandbox without timeout or test changes. The temporary preview server and files were removed.

The historical audits below predate the current palette, single-row mobile layout, icon-only Create buttons, aligned module headers and dismissal behavior. Their screenshots and banner contrast measurements describe the earlier implementation.

## Earlier recorded browser checks

Before the theme refinement, the integrated mock CRM shell was measured from 320px to 2560px. Its sidebar occupied 0px on mobile, approximately 56px on tablet, and 220px on desktop. Tablet expansion and Escape dismissal, mobile navigation below the banner, route-change dismissal, create-record drawer bounds, profile menu bounds, and scroll locking were exercised. At 320px, Leads, Contacts, Accounts, Deals, Pipeline, Tasks, Campaigns, Workflows and Settings fitted their page containers. API-dependent modules used available empty/error states. This does not establish complete coverage of every module and operation.

The earlier banner theme refinement was verified using the actual production provider, theme scope, appearance store and compiled app stylesheet in a temporary component preview. Native prompt events and OS appearance changes were simulated; that preview did not recreate CRM modules. Its measurements and screenshots predate the smaller button.

| Check | Result |
| --- | --- |
| Classic, Light, Dark, System/light and System/dark at 15 widths each | 75 cases; no horizontal overflow |
| Widths | 320, 360, 375, 390, 414, 480, 639, 640, 767, 768, 1024, 1025, 1440, 1920, 2560px |
| System/dark in a 320px-high landscape viewport | Banner fitted at all 15 widths |
| Small, Medium, Large density at 6 widths | 18 cases; no overflow, text at least 13px, controls at least 44px |
| All 7 accents in Classic, Light and Dark | 21 combinations; message contrast at least 11.65:1 and Install text contrast at least 5.01:1 |
| Keyboard focus | Tab from Install reached X; visible solid focus outline |
| Keyboard installation | Enter called the retained prompt exactly once after appearance changes |
| Installation completed | Banner hidden, reserved height reset to 0px, one success toast |
| X, reload, new installable event | Banner remained dismissed |

At 320px with Medium density, the banner was approximately 108px tall. At 640px and wider it was approximately 61px tall. Browser measurements round slightly at the desktop's existing zoom; a 44px CSS target measured approximately 43.99px.

Earlier screenshots: [Dark mobile](assets/responsive-pwa/banner-dark-mobile.jpg), [Light mobile](assets/responsive-pwa/banner-light-mobile.jpg), [Classic tablet](assets/responsive-pwa/banner-classic-tablet.jpg). Raw measurements and behavior results are saved alongside these images.

## Earlier integrated refinement checks

- The smaller Install button passed 60 integrated browser cases: Classic, Light, Dark and System at all 15 widths listed above. No banner or app-page overflow was measured; Install remained approximately 84px wide with a 44px height. These cases and their contrast measurements predate the current palette and dismissal changes.
- All nine Settings sections were checked at 320px. The populated Forms builder fitted, its tools sheet bounded itself to the viewport, keyboard focus stayed inside the sheet, tap-to-add worked and Escape restored focus to the tools trigger.
- The email composer and emoji picker fitted at 320px portrait and 740×320 landscape. Emoji controls now reflow rather than requiring horizontal scrolling; category tabs retain a bounded horizontal scroller. Escape dismissed the picker before the composer. Composer input survived desktop resizing and fullscreen toggling; navigation changed from 220px to 0px in focus mode and returned to 220px on exit.
- Dashboard captions wrap in narrow cards. Shared chart containers and canvases remain bounded to their parents while Chart.js redraws after resizing. SMS phone previews scale to their available container width.
- The final module matrix contains 182 passing layout cases across 26 routes at requested widths 320, 480, 768, 1024, 1025, 1440 and 2560px. It covers Dashboard, CRM tables and Pipeline, Tasks, Campaigns, Workflows and its builder, Inbox, Reporting, Notifications, all Settings sections, the Leads import wizard, Help, privacy, terms and support. Reporting was rechecked after the chart fix; the import wizard was retried after its first development compilation exceeded the harness wait. No page overflow remained in the recorded final cases. Shared component tests cover additional drawers, confirmations and form operations; the matrix is not a record of every possible populated screen or business operation.
- Keyboard Enter invoked the retained native prompt exactly once after actual app appearance changes and SPA navigation. Accepted installation plus `appinstalled` hid the banner, reset its reserved height to 0px and showed one success toast. X dismissal remained honored after reload and another installable event.

Earlier screenshots: [smaller button in Light](assets/responsive-pwa/compact-banner-light-mobile.jpg), [smaller button in Dark](assets/responsive-pwa/compact-banner-dark-mobile.jpg). Earlier evidence: [module measurements](assets/responsive-pwa/module-measurements.json), [theme and size measurements](assets/responsive-pwa/compact-banner-measurements.json), [install/dismissal behavior](assets/responsive-pwa/compact-banner-behavior.json). Requested and measured widths can differ by a pixel because of the desktop's existing zoom; exact navigation boundaries also pass unit tests. The theme matrix verifies rendered theme classes, not only the requested preference labels.

## Earlier automated results

| Check | Result |
| --- | --- |
| Full frontend regression suite | 151 files / 1,272 tests passed |
| Final affected PWA, composer, Inbox, Forms, dashboard, CSS and navigation run | 8 files / 86 tests passed |
| Final charts, CSS compilation and navigation run | 3 files / 20 tests passed |
| Native fullscreen additions | Both new mobile/desktop cases passed; navigation file has 14 passing tests |
| Workspace lint/type checks | All 3 workspaces passed |
| Final Next.js production build | Passed; all 180 routes generated |

The broad run includes the shared overlay migrations, column save/discard guards, profile drawer and lost-deal confirmation. The focused runs validate the subsequent small layout refinements and native-fullscreen additions. CSS verification still compiles real Tailwind/PostCSS utilities and checks semantic variables; unrelated source scanning is disabled, with no increased timeout or removed business assertion.

The production build uses a build-only HTTPS backend placeholder, without altering saved environment configuration. Real installation and authenticated backend CRUD are outside the mock browser checks. No live records, permissions, campaigns or email deliveries were changed by the audit.

Preview preferences were restored, the temporary tab and fixture servers were closed, and the isolated frontend copy and audit harness were removed. Only the implementation, regression tests and saved verification evidence remain.
