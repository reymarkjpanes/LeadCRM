# Uniform side-panel UI polish plan

Status: Planned active-panel UI rollout implemented locally. Audited and implemented 4 October 2026 (Asia/Manila). Sections 1–8 describe the original audit and acceptance targets; implementation results and verification limits are recorded in sections 9–10. No deployment is included.

## 1. Objective and boundaries

Use **New Lead** as the visual reference for active side panels. Standardize panel surfaces, dimensions, typography, spacing, controls, section headings, and action bars while preserving each module's purpose.

This is a frontend presentation pass. Preserve fields, validation, requiredness, permissions, tenant scoping, data fetching, submitted payloads, association rules, task lifecycle, workflow execution order, and existing save/archive behavior. No backend, database, shared API contract, new feature, or workflow redesign is needed. Accessibility defects discovered during the audit are listed separately so they do not become an unannounced expansion of cosmetic work.

### Functional parity contract — clarified after review

The first implementation is **styling and layout only**. Keep existing inputs/selectors, bindings, event handlers, state ownership, disabled/read-only conditions, validation, action visibility, and API calls. Use presentation helpers without replacing the behavior-bearing drawer, form, or selector implementations. Do not change autosave versus explicit-save behavior, dismissal rules, search/filter results, pagination, or nested draft retention.

Keep the existing field/content order and action labels in the initial pass. Section headings, readable styling, spacing, and positioning may improve without adding steps or interactions. More extensive read-only rendering, copy changes, date formatting, or action-label renaming below are optional later presentation refinements; they are not required for the first polish and must preserve meaning and behavior. Keyboard/focus repairs remain a separately scoped follow-up.

Start with Task and Workflow only. Use their completed visual and functional checks as the gate before extending the same style to other active panels. A width difference alone is not a bug: the main Task/Workflow drawers should match the Lead reference, while compact utility panels and docked editors may retain a documented size appropriate to their content.

The attachments are visual evidence: image 1 is New Lead, image 2 is Workflow runs, and image 3 is Task details. They have different crop sizes; their pixel widths are not reliable CSS specifications.

## 2. Evidence and verified findings

Read-only inspection covered the deployed application, rendered styles and accessibility state, active callers in the repository, and the repository guidance. Applied skills: design critique, design system audit, and accessibility review. No records, preferences, templates, products, users, or workflows were saved or changed.

| Surface | Evidence | Finding |
| --- | --- | --- |
| New Lead | Live + source | White panel, Poppins as rendered, 20px/700 title, subtitle, numbered sections, approximately 42px inputs, 12px field corners, fixed action area. Desktop width measured at 576 CSS px. |
| Task details and Create task | Live + source | 540px panel; page-canvas gray background; 20px/600 heading; no contextual subtitle or consistent sections; approximately 38px controls with 8px corners. Read-only fieldset uses 0.75 opacity. |
| Workflow runs, collapsed and expanded | Live + source | 480px panel; gray body, 16px header/body padding, 18px title; raw lowercase statuses and dense date/type summaries; pagination sits directly below the list. |
| Manage Columns | Live in Workflows + shared source | 448px width, different backdrop, 18px heading, tighter search field and button shapes. Existing focus handling and draft/save/reset behavior must survive any styling work. |
| CRM details | Live Lead preview + shared callers for Leads, Contacts, Accounts, Deals | Shared 480px panel with compact record header, chips, tabs, and gray activity body. Preserve these useful detail-view structures while aligning the surrounding visual treatment. |
| Create Email Template | Live + source | Header already resembles Lead. Labels and fields are larger; footer has padding inside an already padded container; field corners differ. Category control has no associated accessible label in the inspected markup. SMS shares this panel. |
| New Product | Live + source | Form appears as a small bordered card near the top of a full-height drawer; actions are inside the card. Required fields have no visible required markers. New Product currently uses the label Save Product. |
| New User | Live + source | Correct overall shell; plain “1.”/“2.” headings instead of section badges; plain Cancel and smaller primary action. |
| New Account | Live + source | Amber numbered badges and primary action; no subtitle in the active page wrapper. The page uses SideSheet, even though AccountFormSheet also exists. |
| Contact and Deal forms | Source | Both already use grouped forms. Contact section badges are teal and Deal section badges are indigo. Preserve their mature forms and make targeted consistency adjustments. |
| Administration role details | Source + route/caller | The `/administration/roles` route renders RoleDetailDrawer, with a 14px title, 20px gutters and an unnamed close icon. This is separate from the inline role editor under Settings. |
| Other panels below | Source and caller tracing | Included with explicit verification limits; not claimed as visually tested. |

### Corrections and flags

1. **Task details has no Save button by design.** The table's open/view action passes `readOnly: true`; its edit action uses the same TaskEditor without that flag. Do not add editing to the view action or infer a permission failure from image 3.
2. **The faded Task view is confirmed presentation debt.** Saved values look disabled, while required asterisks, selection instructions, empty dropdown prompts, and the Notes character counter imply editing. Present a clear read-only variant using the same fields and information.
3. **Paused workflow + completed run is valid.** The first describes the workflow now; the second describes a past run. Separate these statuses visually. Expanded history also uses run status `completed` and step status `success`; make human-readable labels while retaining their distinct meanings and raw values.
4. **Date presentation differs.** Task's native datetime input showed day/month/year while Workflow uses `toLocaleString()` and showed month/day/year. This is a formatting inconsistency, not evidence of a wrong stored date. Use an unambiguous display format in read-only content and show the actual display timezone; preserve datetime editing and conversion logic.
5. **Image 2 contains a “View runs” tooltip over the panel.** It was not persistently reproduced in the live inspection. Treat this as a tooltip dismissal/layering verification item, not a confirmed permanent overlay defect.
6. **The Lead reference is not a perfect component specification.** Its product selector and account combobox differ in surface/height from its native inputs. Align their outer presentation while preserving multiselect/search behavior.
7. **Reference accessibility defect:** New Lead's rendered container has no dialog role or `aria-modal`; opening it left focus outside. The shared SlidingDrawer source has no focus trap/restore. Do not copy those omissions into other panels.
8. **Workflow accessibility defect:** opening runs left focus on the underlying View runs trigger. Sheet supplies dialog semantics but no generic focus management; TaskEditor adds its own. Preserve TaskEditor's focus behavior and track a shared keyboard fix separately.
9. **Other source flags:** SideSheet lacks dialog semantics and Escape/focus management; the Team activity and Administration role-detail drawer close icons lack accessible names. Global input focus CSS uses `!important` and a reddish `--focus-ring`, potentially overriding blue component rings. Confirm actual rendered focus styles before changing scoped styles; avoid a site-wide CSS rewrite.

## 3. The visual standard

Use one presentation contract with form, detail, and activity/list variants. Numbered sections belong to grouped forms; execution histories, record tabs, utility lists, and short configuration screens do not need artificial numbered steps.

| Element | Planned standard |
| --- | --- |
| Width | Main form/detail/history drawers follow Lead: viewport width capped at 512px below the 768px breakpoint, and 576px at/above it. At 320–430px they fill the viewport. Compact utilities may retain their existing width after visual review. Match at the same viewport and zoom; do not widen every panel indiscriminately. |
| Height | Full visible viewport; fixed header and optional fixed footer; one primary scroll area with sufficient space for the last field. Account for mobile browser chrome and safe areas. |
| Surface | White in light mode; existing slate surface in dark mode. Pale neutral header, subtle dividing borders, consistent shadow and blurred backdrop. Secondary cards may be lightly tinted. |
| Gutters | 24px horizontal desktop gutters; 16px on narrow screens; 20px header/body vertical padding; 16px footer vertical padding. Header, fields, and footer actions align. |
| Typography | Inherit the existing app font, currently Poppins. Titles 20px/700; subtitles and values 14px; field labels 12px/600; section headings 14px/700; helpers 12px. Avoid global font changes. |
| Spacing | 24px between sections; 16px field/grid gaps; 6px between label and control; 12px between footer actions. |
| Section headings | For grouped forms, 24px blue circle, small white number, dark heading, thin trailing rule. Reuse Lead's appearance rather than maintaining module-specific colors. |
| Controls | Approximately 42px minimum single-line control height, 12px corners, consistent border, padding, chevron and icon alignment. Multiselects can grow; textareas retain suitable multiline height. |
| State styling | Consistent focus/error/loading/disabled treatment. Read-only values remain legible at full content opacity. Keep actual disabled actions visibly distinct. Do not communicate status or errors only through color. |
| Primary action | Match Lead's blue and rounded shape through a panel-specific presentation token/variant. Do not globally change every Button or brand token. Preserve success/warning/destructive semantic colors. |
| Action bar | Right-aligned Cancel + existing primary action for forms; Close for read-only details. Keep existing destructive actions separate. Utility panels retain their meaningful actions such as Reset to Default + Save. |
| Close control | One consistent top-right position/icon/focus treatment with an accessible name. Aim for a 44px touch hit area without enlarging the icon; this is a usability target, not a claim that every smaller target fails WCAG 2.1 AA. |
| Copy | Consistent title/button capitalization and state-appropriate instructions. Required markers appear only where the underlying field is actually required. |

The Workflow builder's docked inspector and library remain docked, with their current canvas allocation. Its overlay variants adopt the modal panel standard. Full-page editors, navigation rails, mobile filter rails, and centered confirmations are outside this side-panel migration.

## 4. Task module: first implementation slice

Target the active [TaskEditor](../../frontend/src/features/tenant/operations/tasks/ui/task-editor.tsx), [TaskSelector](../../frontend/src/features/tenant/operations/tasks/ui/task-selector.tsx), and [TaskRecordCreator](../../frontend/src/features/tenant/operations/tasks/ui/task-record-creator.tsx). The similarly named legacy CRM TaskDetailsDrawer is not the screenshot's implementation.

1. Apply the standard shell, white content surface, title weight, subtitle spacing, control dimensions, and footer alignment.
2. Keep the existing entry modes and title text for the initial pass; align title styling. Mode-specific New Task / Edit Task / Task Details wording and concise subtitles are optional later copy polish, with no new mode or permission path.
3. Group the existing fields as: **Task Information** (title/status/priority), **Schedule & Assignment** (due date/time, timezone, agent), **Notes**, and **Associated Records**. Keep creation/assignment metadata as a quiet final group. Use the same ordering across modes; numbers may be omitted in the read-only view.
4. In create/edit, style required asterisks like Lead, align status and priority, and collapse paired fields to one column at narrow widths. Keep the Notes counter directly below its field and readable. Keep existing max lengths and validation.
5. In read-only mode, first improve text contrast, field surfaces, spacing, and visual hierarchy while retaining the current controls, content and disabled/read-only conditions. Do not enable controls to make them look clearer. A separate static-value/badge presentation, with edit-only instructions omitted, is an optional later refinement rather than part of the initial polish. Do not introduce an Edit button or new edit permission path.
6. Normalize association selector/chip styling and long-label wrapping. Preserve multiple selection, lead-dependent filtering, historical links, permission gates, and association notices.
7. Keep every existing footer action, label, handler and visibility condition; style and align them consistently. Renaming editable-mode Close to Cancel or changing capitalization is optional later copy polish. Preserve archive confirmation and busy-state behavior.
8. Verify both the Task module and CRM RelatedTasks callers. Nested record creation must still retain the Task draft and return to it on cancel; the child must not acquire a duplicate panel header/footer.

## 5. Workflow module: second implementation slice

Primary target: [workflow-execution-log-modal.tsx](../../frontend/src/features/tenant/automation/workflows/ui/workflow-execution-log-modal.tsx).

1. Match the standard width, white body, title size, header padding, and close control. Use **Workflow Runs** as the panel purpose, the workflow name underneath with wrapping, and a separate current-workflow status badge.
2. Keep the execution-history explanation; style it as secondary copy. Align the existing Refresh activity action with the content toolbar.
3. Restyle the existing expandable run rows: human-readable status badge, clear timestamp, entity label, and consistent disclosure icon. Wrap rather than truncate necessary information. Use the already available record name in the summary when helpful; do not introduce an extra API dependency.
4. Expanded rows retain Record, Trigger, Finished, error messages, and ordered step outcomes. Give labels/values a clear hierarchy, and style each step's status independently of the run/workflow status. Preserve keyboard-operable expansion.
5. Place the existing page navigation in a consistent footer for the overlay variant. Keep Refresh available during error/empty states according to the existing loading rules. No fabricated total-page count, replay action, or new Save action.
6. Style loading, no runs, error, disabled pagination, long names, and long error text. Preserve the existing 25-run pagination rule and historical action order.
7. `WorkflowRuns` is also embedded in the builder's Activity view. Keep its embedded layout and pagination working; do not put a viewport-fixed footer into the reusable list itself.
8. In the subsequent Workflow pass, align overlay Add a workflow step and Step configuration panels in [workflow-dialog.tsx](../../frontend/src/features/tenant/automation/workflows/ui/workflow-dialog.tsx). Keep the docked builder variants and all configuration logic intact.

## 6. Remaining active scope, in priority order

| Priority | Module / surface | Planned polish and verification boundary |
| --- | --- | --- |
| P1 | Accounts create/edit | Change decorative amber section markers/action styling to Lead blue; add the missing contextual subtitle in the active SideSheet wrapper; align controls/footer. Live creation verified. |
| P1 | Contacts create/edit | Normalize teal section markers and shared form details. Source verified; capture live baseline before implementation. |
| P1 | Deals create/edit | Normalize indigo section markers to reference blue; retain existing form hierarchy and primary action behavior. Source verified. |
| P1 | Leads, Contacts, Accounts, Deals detail panels | Update shared CrmRecordPanel presentation and gutters; keep avatars, metadata chips, tabs, record actions, relationships, and activity structure. Lead live verified; other callers source verified. Scope styling so full-page CrmRecordView remains appropriate. |
| P1 | Manage Columns across CRM, Tasks, Workflows, Campaigns, and Settings callers | Match header/backdrop/search/footer styling once in the shared component; retain compact width unless comparison shows a benefit to widening. Preserve drag-and-drop, locked columns, keyboard reorder, unsaved-change confirmation, reset, and persistence. |
| P2 | Campaigns: Email/SMS templates and target audience | Match labels, control dimensions, responsive condition rows, footer gutters, and section rhythm. Email template live verified; SMS shared source and audience caller verified. Preserve variable insertion and audience conditions/preview. |
| P2 | Settings: Team Management users | Replace plain numbered text with Lead-style form sections; standardize Cancel/primary buttons and footer spacing. Preserve email-domain policy, roles, user status, and password-reset behavior. New User live verified. |
| P2 | Settings: user activity history | Normalize header, close control, search, filters, empty/error states and timeline spacing; preserve history filters/content. Active TimelineDrawer caller verified in source. |
| P2 | Administration: role detail drawer | Align title/subtitle scale, gutters, close control and permission/user-list card styling in `role-detail-drawer.tsx`. Preserve its read-only permission matrix and system-role rules. Route and caller source verified; not live inspected. Do not turn Settings' separate inline role editor into a drawer. |
| P2 | Settings: Products | Use the whole drawer form layout and pinned existing actions instead of the small nested card. Preserve price rules and the existing read-only customer/deal list. Required-marker and Create Product / Save Changes wording are optional later copy polish. Live creation verified. |
| P2 | Settings: Closed Won Requirements, New/Edit Field, Deal Stage Automation | Reuse shell, field, section, and action styling. Preserve fixed field-type restrictions and the automation switch's immediate-save behavior; do not add a Save workflow to it. Source verified. |
| P2 | Workflow builder overlay library/configuration | Match modal styling, with separate checks at the breakpoint that changes docked panels into overlays. Source verified. |
| P3 | Lead conversion and CRM merge | Verify existing section/progress/card/footer spacing and long comparisons against the standard. Preserve conversion steps, selection rules, warnings and merge behavior. Source verified; use fixtures for review without performing a real conversion/merge. |
| P3 | Forms builder: docked Form tools | Align field/label/spacing tokens only, preserving the 256px docked desktop tool area and mobile bottom-sheet behavior. This is a specialized editor surface, not a modal right-drawer conversion. Source verified. |
| P3 | Lead create/edit | Regression/reference pass and shared helper adoption only where necessary. Keep existing field order, fields, validations, and actions. |

Do not spend this pass polishing unconfirmed or inactive surfaces. Searches found no active JSX consumers for legacy TaskDetailsDrawer, generic RecordDrawer, NotesSidePanel, InboxPanel, or CreateCampaignPanel. Older lead/account import drawers are explicitly replaced by full-page import routes. Legacy record/detail/profile files also need a confirmed active route before inclusion. Do not delete these files as part of polishing. Do not infer current product scope from older README/architecture file listings alone.

## 7. Implementation strategy and sequence

1. **Capture the baseline:** same viewport, browser zoom, theme, and mode for Lead, Task and Workflow. Record form/detail/list differences and required exceptions. Use mock mode/fixtures for UI-only work; use existing read-only deployed screens only where needed to verify real structure.
2. **Define small shared presentation helpers:** panel sizing/surface classes, header, section heading, field wrapper, and footer styles under `frontend/src/shared`. Keep domain content/state under feature folders. Extend existing primitives rather than introduce a new UI library or replace every drawer at once.
3. **Polish Task first:** review create/edit/view and a nested creator against Lead before spreading the pattern.
4. **Polish Workflow runs:** review collapsed/expanded/error/empty/loading and the embedded builder usage.
5. **Roll out P1, then P2/P3:** migrate one shared caller group at a time. Keep existing behavior-heavy wrappers until their visual and interaction parity is established.
6. **Handle accessibility findings separately:** keep keyboard/semantic behavior repairs outside this first UI-only pass and report them for follow-up. Never regress existing Sheet dialog semantics or Task/Manage Columns focus behavior by blindly replacing them with SlidingDrawer.

No lint/build/source changes were needed for this planning audit. Future implementation should run frontend lint and build plus relevant existing Task editor/interaction, Workflow history/page, CRM panel, and Manage Columns suites. The Workflow history test currently asserts a 480px width; revise that presentation expectation if the width changes, while retaining its execution-order, refresh, pagination and close assertions. Add behavior tests only for actual interaction repairs, not tests that merely repeat CSS class strings.

## 8. Acceptance and regression checklist

- Compare all three core panels at 1440×900 and 1280×720, then 768px, 390px and 320px widths; include a short viewport and 200% zoom. No horizontal overflow, clipped labels, action overlap, or unreachable final fields.
- Header stays visible, one intended body scrollbar is used, and the correct action bar remains reachable. Long names, many association chips, long Notes, and expanded workflow errors wrap safely.
- Control sizes, font hierarchy, border/radius, blue accents, section spacing, and footer alignment visibly match the approved Lead baseline. Check light/dark, hover, focus, error, loading, read-only, and disabled states.
- Measure actual text/focus/border contrast in both themes before claiming accessibility conformance. Do not treat readable saved values as disabled controls merely to obtain a disabled-state contrast exception.
- Preserve Task create/edit/view permissions, assignment/completion/archive gates, date conversion, all associations and draft retention. Opening or closing a panel must not save data.
- Compare functional outcomes before/after using the same fixtures: same action and inputs produce the same payload, validation result, disabled state and visible actions. Exercise saves and destructive-action confirmations only in local/mock or controlled test fixtures, not production audit records. Do not declare functional parity based only on screenshots or a successful build.
- Preserve Workflow statuses, historical step ordering, refresh, pagination, error details, and embedded Activity rendering. A paused workflow's completed history remains visible and correctly labeled.
- Preserve column draft/reset/save semantics, campaign variable insertion/audience preview, CRM conversion/merge warnings, and Settings-specific permissions and save modes.
- For any approved accessibility repair: verify initial focus, Tab/Shift+Tab containment, focus visibility, Escape, close/trigger focus restoration, accessible labels, nested popover/dialog behavior, and no click/keyboard access to obscured controls. Verify the screenshot's tooltip does not remain above an open panel.
- Check nested panel layering and scroll locking: dismissing a child must not dismiss or unlock the parent unexpectedly. Preserve each existing busy/unsaved-change policy; changing those policies is outside cosmetic scope.
- Recheck the Lead reference after shared changes. Finish with a diff audit showing no API, schema, validation, permission or backend changes.

### Audit limits

Live inspection validated the specific light-theme views listed above. It did not execute saves, edit/archive/convert/merge flows, screen-reader testing, automated contrast scans, dark-mode verification, or a controlled mobile/zoom matrix. Source-confirmed surfaces and those states require the acceptance checks above during implementation. This document is a reviewed plan, not a claim that the future polish or accessibility fixes have already been implemented or passed QA.

## 9. First implementation slice and validation

TaskEditor and Workflow runs now share Lead-style surface, width, typography, gutters, close-target styling, and footer/control treatment through `side-panel-styles.tsx`. Task uses four numbered visual groups in the existing field order. Read-only fields retain their disabled conditions with clearer values. Its selectors opt into the panel appearance; other callers keep their existing default appearance. Workflow runs retain native details/summary expansion, historical statuses and step order, refresh and pagination. Only the drawer pins pagination to the bottom; the builder's embedded Activity view remains in normal document flow.

The existing Sheet remains in use. Its only shared API addition is an optional close-button class. API clients, shared contracts, validation, permission checks, state, Task save/archive routines, date conversion, and Workflow loading/paging logic were not changed. An AST-based diff check confirmed all 76 event/control attributes across TaskEditor, TaskSelector, Workflow runs and Sheet are unchanged. The new header/control styles also apply to the Task shell while its existing nested record forms are open; those forms' bodies and handlers were retained.

Validation performed using the real production components and CSS with local, in-memory data and the app's Poppins font:

- Task create, edit and read-only layouts; disabled fields; searchable assignee popup; popup Escape restores its trigger; existing Task Tab/Shift+Tab containment; blue focus styling; native dark calendar controls.
- Workflow collapsed and expanded runs, keyboard expansion, failed runs with long messages, long titles, loading, error and empty states, page 2, and the embedded Activity layout.
- Both drawers measured at 1440×900, 1280×720, 768×720, 640×360, 390×844 and 320×640: no horizontal overflow; desktop width 576px, intermediate width 512px, phone width fills viewport, footer actions remain within the viewport. Light and dark themes visually inspected. The 640×360 check is a short CSS viewport check, not a claim of testing actual browser zoom.
- Frontend type check passed after stale generated route types were backed up and regenerated. Production build passed. Local build reports the existing localhost backend URL configuration warning; no deployment environment was changed.
- Task and Workflow module suites: 102 tests across 12 files. The parallel run passed 101 tests; one existing Workflow template-opening test hit its five-second timeout. Its complete six-test file passed on an isolated rerun with no timeout or test-logic changes. The original 23 targeted checks also passed after correcting an accessible-label whitespace regression caught by the tests.
- `git diff --check` passed. No production CRM records were changed. No commit or deployment was performed.

At the end of this first slice, the other modules remained pending. Their subsequent implementation is recorded below. True browser-zoom and screen-reader checks, live nested record creation, and the previously documented shared dialog/focus defects remain separate. The local fixture preview is kept under ignored build output and is not a shipped route or API change.

## 10. Remaining rollout implementation and validation

The approved remaining active-panel scope is implemented. Shared presentation classes now cover SlidingDrawer and SideSheet, without replacing their event handling, scroll-locking or dismissal behavior. An optional close-button class lets Workflow overlays and mobile Form tools use the same close target while retaining Dialog's existing behavior. Explicit custom widths still take precedence.

| Surface | Implemented presentation changes |
| --- | --- |
| Accounts, Contacts, Deals create/edit | Blue numbered section headings, consistent controls, responsive grids, aligned body gutters, fixed existing actions and matching 42px button heights. Active Account wrapper now has the contextual subtitle. |
| CRM Lead, Contact, Account and Deal details | Reference width/surface, title hierarchy, body/header gutter alignment, and room for the larger close target. Full-page record layout retains its prior sizing and gutters. Tabs, actions, inline edits, relationships and activity behavior remain unchanged. |
| Manage Columns | Consistent header, search, close target, backdrop and footer. Retains the compact 448px desktop width, drag-and-drop and keyboard reorder, draft confirmation, reset and save behavior. |
| Campaign Email/SMS templates and Audience | Consistent fields/labels, corrected footer nesting, pinned existing actions and responsive condition rows. Category label is now associated with its existing select. Variable insertion and audience logic are unchanged. |
| Users and user activity | Numbered form sections, body scrolling, fixed existing actions, timeline header/search/filter spacing and named close control. Read-only actions wrap on narrow screens. |
| Administration role details | Standard shell/header, named close control, wrapping names and descriptions, and a contained horizontal scroll area for the existing wide permission matrix. |
| Products | Full-height form with a body and fixed action bar instead of a small nested card. Detail-view gutters and shared shell align with the reference. Price validation, labels and requiredness are unchanged. |
| Closing Fields and Deal Stage Automation | Standard form sections, fields, spacing, list gutters and action bar. The automation switch still saves immediately; field-type restrictions are unchanged. |
| Workflow builder overlays | Standard overlay width, header, close target and scrolling content. Docked library/configuration allocation remains unchanged. |
| Lead conversion and CRM merge | Standard gutters and existing action bars. Narrow conversion label/value rows have a clear gap; merge record names and comparisons wrap. All steps, choices, warnings and final actions are retained. |
| Forms builder tools | Aligned surface and design-control styling. Desktop tools remain 256px wide; the mobile tools remain a bottom sheet. |
| Lead reference | Shared shell regression checked; its existing domain form and functionality are retained. |

### Verification evidence

- Existing targeted regression suites passed: **220 tests across 24 files**, covering CRM forms/details, columns, users, products, closing fields, campaigns, forms and Workflow. The initial sandbox run could not start tests because Windows blocked temporary-file renames; the same command passed outside the sandbox.
- Final CRM/Task rechecks passed **88 tests across 6 files**: 39 passed in the initial run, while two workers timed out before starting during the concurrent build. Those two files passed all 49 tests on an isolated one-worker rerun. No test logic or timeout limits were changed. The final production build also passed after the last CRM spacing correction.
- Frontend lint/type check and production build passed. The build retains the existing local environment warning that the backend URL resolves to localhost; no environment or deployment configuration was changed.
- A source AST comparison confirmed that **all 610 event/control attributes across the 24 changed source files** match the baseline, including handlers, values, checked/disabled/required/read-only states and input types. This supplements the existing behavioral tests; it is not a substitute for them. Diff review found no backend, shared API contract, validation, payload or permission changes.
- Browser review used actual production components, CSS and the app font with isolated fixture data. Reviewed Account/Contact/Deal/Lead forms; Product create; User create/edit/view; Role details; user activity; CRM Lead/Account/Deal details; Manage Columns; Audience conditions; Email/SMS templates; New Field and dropdown options; conversion review/navigation; merge comparisons; Workflow overlay shell; desktop and mobile Form tools.
- Exercised CRM Activity/Details switching, column search, template variable insertion, audience condition insertion, custom-field type/option controls, and conversion navigation without saving production data.
- Representative layouts were checked at **1440×900, 1280×720, 640×360, 390×720/844 and 320×640**. Main desktop drawers measured 576px; the short 640px viewport used 512px. Phone drawers filled the viewport. Checked fixed actions, body scrolling, long labels and light/dark examples. These are representative checks, not every panel/state at every size or actual browser zoom.
- Browser review caught and corrected mismatched primary/secondary button heights, crowded conversion values, truncated merge names, CRM body/header gutter differences and insufficient spacing beside the enlarged CRM close target.

### Remaining flags and verification limits

- Existing shared focus/dialog-semantic defects from section 2 remain outside this styling pass. Added names to two close controls and linked the template Category label; no focus-management rewrite or accessibility-conformance claim is included.
- Existing SMS template name placeholder still says “Welcome Series - Email 1.” Product required markers and mode-specific action/title wording remain optional copy refinements from the plan; underlying validation is unchanged.
- Product read-only relationships, Contact detail-specific content, Closing Fields list/edit and all live nested-panel combinations were covered by source review and applicable existing tests, not an exhaustive browser scenario matrix in this rollout. No real conversion, merge, password reset, automation change, template send, record save or permission change was performed.
- Inactive legacy panels, centered confirmations and full-page editors remain outside scope. No commit or deployment was performed.
- Final `git diff --check` passed. The temporary browser viewport was restored and the isolated preview server was stopped.
