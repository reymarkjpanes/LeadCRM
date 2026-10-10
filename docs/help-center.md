# LeadCRM Help Center

Implemented 2026-09-24; public access added 2026-10-09. This is source-controlled product documentation, not an editable CMS. No database, API contract, tenant scope, or CRM module permission behavior was changed.

## Routes and entry point

- `/help`: searchable home, eight popular articles, and 14 categories.
- `/help/category/[slug]`: category article list.
- `/help/articles/[slug]`: 126 individual articles, each with summary, sections, relevant notes, breadcrumbs, contents navigation, and related articles.
- Unknown article/category slugs use the Help Center not-found view.
- The existing profile dropdown uses a Next.js Link to `/help` in the same tab and closes on selection. The placeholder toast and external-link icon were removed.
- All Help Center routes are public. Signed-out visitors see only the help content, without the CRM sidebar or top bar. A restored signed-in user receives the existing `CrmLayout`, including its navigation, responsive controls, theme, and module permission checks. Other tenant routes retain `AuthGuard`. Help adds no new permissions or CRM record access; articles contain no privileged action buttons.

## Source and maintenance

`frontend/src/features/tenant/help/content/` owns typed content. `types.ts` defines article metadata and text-only sections. Domain modules own the actual articles. `index.ts` assembles the catalog, categories, source references, popular article IDs, and relationship lookup functions.

Each category has implementation source paths for future audits. Read those implementations and their active UI/service paths before updating articles; older repository documentation is not authoritative. Content-integrity tests check those paths, unique IDs/slugs, populated categories, popular links, and related links.

`search.ts` builds a static client-side index over titles, categories, keywords, summaries, sections, and notes. Every query term must match. Titles and keywords rank above body text; common word forms such as “creating” and “create” normalize together. Search supports a category filter and a clear/no-results state. Native Next.js history integration preserves query URLs without a server navigation on every keystroke. No CRM record data enters the help index.

Related links use article IDs/slugs resolved against the catalog. They are explicit editorial relationships, not external links or inferred recommendations.

## Categories

| Category | Articles |
| --- | ---: |
| Getting Started | 8 |
| Leads | 12 |
| Contacts | 9 |
| Accounts | 9 |
| Deals & Pipeline | 11 |
| Tasks | 7 |
| Campaigns | 12 |
| Workflows & Automation | 9 |
| Dashboard | 13 |
| Team Management | 9 |
| Roles & Permissions | 7 |
| Settings | 9 |
| Security & Audit | 2 |
| Troubleshooting | 9 |
| **Total** | **126** |

## Scope and intentionally excluded claims

These existing product limitations are documented, not changed by this work:

- **Campaign delivery:** the active backend send action changes status/timestamp without delivering messages. Scheduler email/SMS transports are stubs. No operational Android SMS gateway or complete multi-channel delivery is advertised.
- **Audiences:** the builder's audience creation uses screen state; selected audiences are not connected as a complete saved targeting/delivery flow. No advanced segmentation or recipient delivery guarantees are documented.
- **Templates:** document the actual subject/text-area editor and its five offered placeholders; no advanced visual template editor or unseen editing workflow is advertised.
- **Forms:** definitions can be edited/published, but generated external links do not establish a public renderer, submission intake, file upload service, or CRM mapping. Form updates are sent while editing and some failures are swallowed; users are told to reopen and verify.
- **Custom Fields:** Settings explicitly says configuration is coming soon. Do not provide field-definition CRUD instructions.
- **Archived Data:** current Settings restore handlers update local state; do not promise persistent live recovery. Roles cannot be restored, and Leads has no dedicated recovery filter. Module-specific archive/delete labels are distinguished.
- **Full detail pages:** lead/contact/account Edit controls and lead Convert controls contain placeholders. Documentation uses side-panel editing and the working Leads table-row Convert action. Full-page related task lists are distinguished from side-panel task creation.
- **Dashboard:** Sync Metrics only emits a toast. Articles explain the limitation. Win rate includes all non-archived deals in its denominator; forecast weights open deals by stage probability; some personal lead indicators are incomplete in live mode.
- **Global search:** Leads, Contacts, Accounts, and loaded Deals only. Three-character minimum and four-result cap per module. Tasks/Campaigns are not indexed, and `#` is not a universal tag search.
- **Environment:** Production is labelled Live. Operational records are scoped; workspace users/roles/settings are not duplicated as separate Sandbox administration. Workflow external email is blocked in Sandbox.
- **Validation/settings:** lead/contact PH input expects a ten-digit mobile part beginning with 9; Account Tax ID expects exactly nine digits when provided. No profile/general timezone or general currency selector is documented. Profile email and account country are read-only; image uploads require configured storage.
- No new claims for AI assistants, marketplaces, call recording, WhatsApp, product catalogs, billing/subscriptions, quotation generation, support ticketing, project management, social publishing, or external calendar sync.

Revisit these articles when the corresponding product behavior changes. A success toast alone is not evidence of completed persistence or delivery.

## Responsive and accessible presentation

`ui/help.module.css` uses existing background, surface, border, text, and primary CSS variables. Signed-in pages inherit the scoped CRM theme and accent settings; public pages use the root theme variables. No separate theme provider is introduced.

Category cards move from three columns to two, then one. Popular articles stack at small widths. Article pages use a desktop contents rail and a native collapsible contents control below 1000px. Breadcrumbs wrap; all content columns use `minmax(0, 1fr)` and long text can wrap. Forms have labels, headings are semantic, links and controls have focus outlines, search count updates are announced, and motion respects reduced-motion preferences.

## Files changed

- Public route shells, conditional layout and not-found UI: `frontend/app/help/`.
- Signed-in/public shell selection: `frontend/src/features/tenant/help/ui/help-layout.tsx`.
- New content, search, presentation, styles, and tests: `frontend/src/features/tenant/help/`.
- Menu entry: `frontend/src/features/tenant/layout/user-profile-dropdown.tsx`.
- Help route recognition: `frontend/src/features/tenant/layout/use-layout.ts`, `frontend/src/lib/route-map.ts`.
- Top-bar title: `frontend/src/features/tenant/layout/topbar.tsx`.
- This maintenance report: `docs/help-center.md`.

## Verification

The original implementation checks below are historical. The October 9, 2026 public-access follow-up moves the same content outside the protected route group. Current verification is recorded in `docs/legal-auth-email-integration.md` and its `public-help-evidence.json` artifact.

- `npm --prefix frontend run lint`: passed (TypeScript, `tsc --noEmit`).
- `npm --prefix frontend run test -- src/features/tenant/help/__tests__ src/features/tenant/layout/__tests__ src/shared/providers/__tests__/auth-guard.lifecycle.test.tsx`: 39 tests passed across six files.
- `npm --prefix frontend run build`: passed, including 126 article paths and 14 category paths. Initial sandboxed build hit a Windows `readlink` EPERM; the same build succeeded with filesystem access.
- Build warnings: existing multiple-lockfile workspace-root warning and localhost backend URL warning. No deployment or backend configuration was changed.
- Browser verification uses a local mock-auth/mock-data development server. The existing shell still attempts some backend requests (roles, permissions, Gmail) and returns 502 without a running backend. Help content/search does not require those services. This is not verification of live campaign delivery or other documented backend workflows.
- Browser checks confirmed profile-menu navigation and menu dismissal, ranked search for “create role”, article and related-article navigation, and the Leads category with all 12 articles. Article layouts had no horizontal overflow at 320px, 375px, and 768px; the category page also fit at 375px. Desktop and 320px screenshots were inspected in light/dark appearances, including dark mode applied through existing Appearance settings.
- An unknown article slug rendered “Guide not found”. Next.js streamed that development response with HTTP 200; this verifies the recovery view, not an HTTP 404 status.
- After final content corrections, the 20 Help Center tests passed again. `git diff --check` passed.
- The home page also fit at 768px with no horizontal overflow. The final browser error log was empty, and the isolated verification browser was closed.

The complete article inventory follows.

## Article inventory

| Article | Route | Content file |
| --- | --- | --- |
| Getting started with LeadCRM | /help/articles/welcome | getting-started.ts |
| Understanding the LeadCRM interface | /help/articles/interface | getting-started.ts |
| Navigating with the sidebar | /help/articles/sidebar | getting-started.ts |
| Using Global Search | /help/articles/global-search | getting-started.ts |
| Understanding Sandbox and Production | /help/articles/environments | getting-started.ts |
| Understanding Leads, Contacts, Accounts & Deals | /help/articles/crm-records | getting-started.ts |
| Recommended first setup | /help/articles/first-setup | getting-started.ts |
| A basic daily workflow | /help/articles/daily-workflow | getting-started.ts |
| What is a Lead? | /help/articles/what-is-lead | leads.ts |
| Creating a Lead | /help/articles/creating-leads | leads.ts |
| Editing a Lead | /help/articles/editing-leads | leads.ts |
| Understanding Lead Status | /help/articles/lead-status | leads.ts |
| Assigning Leads | /help/articles/assigning-leads | leads.ts |
| Searching and Filtering Leads | /help/articles/searching-leads | leads.ts |
| Sorting Leads | /help/articles/sorting-leads | leads.ts |
| Managing Lead Columns | /help/articles/lead-columns | leads.ts |
| Importing Leads | /help/articles/importing-leads | leads.ts |
| Archiving Leads | /help/articles/archiving-leads | leads.ts |
| Converting a Lead | /help/articles/converting-leads | leads.ts |
| Lead Profile / Details | /help/articles/lead-details | leads.ts |
| What is a Contact? | /help/articles/what-is-contact | contacts-accounts.ts |
| Creating a Contact | /help/articles/creating-contacts | contacts-accounts.ts |
| Editing Contact Information | /help/articles/editing-contacts | contacts-accounts.ts |
| Linking Contacts to Accounts | /help/articles/contact-account | contacts-accounts.ts |
| Contact Details | /help/articles/contact-details | contacts-accounts.ts |
| Filtering Contacts | /help/articles/filtering-contacts | contacts-accounts.ts |
| Sorting Contacts | /help/articles/sorting-contacts | contacts-accounts.ts |
| Managing Contact Columns | /help/articles/contact-columns | contacts-accounts.ts |
| Archiving Contacts | /help/articles/archiving-contacts | contacts-accounts.ts |
| What is an Account? | /help/articles/what-is-account | contacts-accounts.ts |
| Creating an Account | /help/articles/creating-accounts | contacts-accounts.ts |
| Editing an Account | /help/articles/editing-accounts | contacts-accounts.ts |
| Linking Contacts to an Account | /help/articles/account-contacts | contacts-accounts.ts |
| Linking Deals to an Account | /help/articles/account-deals | contacts-accounts.ts |
| Customer Classification | /help/articles/account-classification | contacts-accounts.ts |
| Account Address | /help/articles/account-address | contacts-accounts.ts |
| Filtering Accounts | /help/articles/filtering-accounts | contacts-accounts.ts |
| Archiving Accounts | /help/articles/archiving-accounts | contacts-accounts.ts |
| What is a Deal? | /help/articles/what-is-deal | deals-tasks.ts |
| Creating a Deal | /help/articles/creating-deals | deals-tasks.ts |
| Understanding Pipeline Stages | /help/articles/pipeline-stages | deals-tasks.ts |
| Moving a Deal Between Stages | /help/articles/moving-deals | deals-tasks.ts |
| Deal Priority | /help/articles/deal-priority | deals-tasks.ts |
| Expected Close Date | /help/articles/deal-close-date | deals-tasks.ts |
| Linking Accounts and Contacts to Deals | /help/articles/deal-relationships | deals-tasks.ts |
| Marking Deals Won or Lost | /help/articles/won-lost | deals-tasks.ts |
| Deal Details | /help/articles/deal-details | deals-tasks.ts |
| Pipeline View | /help/articles/pipeline-view | deals-tasks.ts |
| Table View | /help/articles/deal-table | deals-tasks.ts |
| Creating Tasks | /help/articles/creating-tasks | deals-tasks.ts |
| Assigning Tasks | /help/articles/assigning-tasks | deals-tasks.ts |
| Task Priority | /help/articles/task-priority | deals-tasks.ts |
| Due Dates | /help/articles/task-due-dates | deals-tasks.ts |
| Linking Tasks to CRM Records | /help/articles/linking-tasks | deals-tasks.ts |
| Completing Tasks | /help/articles/completing-tasks | deals-tasks.ts |
| Filtering Tasks | /help/articles/filtering-tasks | deals-tasks.ts |
| Campaigns Overview | /help/articles/campaigns-overview | campaigns.ts |
| Creating a Campaign | /help/articles/creating-campaigns | campaigns.ts |
| Email Campaigns | /help/articles/email-campaigns | campaigns.ts |
| SMS Campaigns | /help/articles/sms-campaigns | campaigns.ts |
| Multi-channel Campaigns | /help/articles/multi-channel-campaigns | campaigns.ts |
| Understanding Campaign Target Audiences | /help/articles/target-audiences | campaigns.ts |
| Creating SMS Templates | /help/articles/sms-templates | campaigns.ts |
| Creating Email Templates | /help/articles/email-templates | campaigns.ts |
| Scheduling Campaigns | /help/articles/scheduling-campaigns | campaigns.ts |
| Campaign Metrics | /help/articles/campaign-metrics | campaigns.ts |
| Campaign Statuses | /help/articles/campaign-statuses | campaigns.ts |
| Campaign delivery and current limitations | /help/articles/campaign-delivery | campaigns.ts |
| What is a Workflow? | /help/articles/what-is-workflow | workflows.ts |
| Creating a Workflow | /help/articles/creating-workflows | workflows.ts |
| Workflow Triggers | /help/articles/workflow-triggers | workflows.ts |
| Workflow Conditions | /help/articles/workflow-conditions | workflows.ts |
| Workflow Actions | /help/articles/workflow-actions | workflows.ts |
| Activating a Workflow | /help/articles/activating-workflows | workflows.ts |
| Testing a Workflow | /help/articles/workflow-testing | workflows.ts |
| Workflow History / Runs | /help/articles/workflow-history | workflows.ts |
| Troubleshooting Workflows | /help/articles/workflow-troubleshooting | workflows.ts |
| Understanding the Dashboard | /help/articles/dashboard-overview | dashboard.ts |
| Revenue Metrics | /help/articles/revenue-metrics | dashboard.ts |
| Forecasted Revenue | /help/articles/forecasted-revenue | dashboard.ts |
| Active Deals | /help/articles/active-deals | dashboard.ts |
| Total Leads | /help/articles/total-leads | dashboard.ts |
| Win Rate | /help/articles/win-rate | dashboard.ts |
| Average Velocity | /help/articles/average-velocity | dashboard.ts |
| Revenue Trend | /help/articles/revenue-trend | dashboard.ts |
| Action Center | /help/articles/action-center | dashboard.ts |
| Sales Leaderboard | /help/articles/sales-leaderboard | dashboard.ts |
| Pipeline Distribution | /help/articles/pipeline-distribution | dashboard.ts |
| Sync Metrics: current limitation | /help/articles/sync-metrics | dashboard.ts |
| Export Dashboard CSV | /help/articles/dashboard-export | dashboard.ts |
| Viewing Users | /help/articles/viewing-users | administration.ts |
| Creating a User | /help/articles/creating-users | administration.ts |
| Inviting Users | /help/articles/inviting-users | administration.ts |
| User Status | /help/articles/user-status | administration.ts |
| Departments | /help/articles/departments | administration.ts |
| Archiving Users | /help/articles/archiving-users | administration.ts |
| Filtering Users | /help/articles/filtering-users | administration.ts |
| Exporting Users | /help/articles/exporting-users | administration.ts |
| Understanding User Roles | /help/articles/user-roles | administration.ts |
| Understanding Roles | /help/articles/understanding-roles | administration.ts |
| System Roles vs Custom Roles | /help/articles/system-custom-roles | administration.ts |
| Creating a Custom Role | /help/articles/creating-roles | administration.ts |
| Assigning Permissions | /help/articles/assigning-permissions | administration.ts |
| Editing a Custom Role | /help/articles/editing-roles | administration.ts |
| Assigning Roles to Users | /help/articles/assigning-roles | administration.ts |
| Role Restrictions | /help/articles/role-restrictions | administration.ts |
| Profile Settings | /help/articles/profile-settings | settings.ts |
| Changing LeadCRM Appearance | /help/articles/appearance | settings.ts |
| General Organization Settings | /help/articles/general-settings | settings.ts |
| Custom Fields availability | /help/articles/custom-fields | settings.ts |
| Managing Archived Data | /help/articles/archived-data | settings.ts |
| Creating a Form | /help/articles/forms | settings.ts |
| Form Fields | /help/articles/form-fields | settings.ts |
| Publishing and Sharing Forms: current limits | /help/articles/form-publishing | settings.ts |
| Understanding the Audit Trail | /help/articles/audit-trail | settings.ts |
| Role-Based Access | /help/articles/role-based-access | settings.ts |
| Why can’t I create a record? | /help/articles/cannot-create-record | troubleshooting.ts |
| Why can’t I edit a setting? | /help/articles/readonly-settings | troubleshooting.ts |
| Why can’t I see a record? | /help/articles/missing-records | troubleshooting.ts |
| Why can’t I access a module? | /help/articles/module-access | troubleshooting.ts |
| Permission denied | /help/articles/permission-denied | troubleshooting.ts |
| Why does my phone number fail validation? | /help/articles/phone-validation | troubleshooting.ts |
| Why can’t I create a custom role? | /help/articles/role-problems | troubleshooting.ts |
| Campaign problems | /help/articles/campaign-problems | troubleshooting.ts |
| Common validation errors | /help/articles/validation-errors | troubleshooting.ts |
