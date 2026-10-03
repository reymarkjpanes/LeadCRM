# LeadCRM scoped cleanup report

Implemented locally on 2026-10-02. No deployment or database migration was performed during implementation.

## Authentication findings and limits

The backend emits “Authentication required” when neither the session cookie nor an accepted authorization header is present. The supplied burst therefore represents requests arriving without credentials. It does not establish where those credentials were lost.

The apparent route mismatch has a confirmed explanation in the repository: the response logger read Express `req.path` after nested routing. Successful CRM requests could be logged as `/leads`, while requests rejected before that routing retained `/api/v1/crm/leads`. Both can originate from the same URL. The logger now captures `req.originalUrl` without the query string before routing.

Tracing the frontend found that protected CRM, permission, and workflow calls use the shared API client. Its browser branch already used the same-origin proxy with `credentials: 'include'`. Its server branch instead used `NEXT_PUBLIC_API_URL` directly, with no incoming browser cookie forwarding. Server fetch does not inherit a browser cookie jar. This unsafe fallback is now removed: the client always targets `/api/proxy` and refuses server-side execution before sending a request.

The existing Next proxy remains responsible for resolving the configured backend URL and forwarding the HttpOnly `leadcrm_token` cookie. Its cookie forwarding and Set-Cookie rewrite logic already existed and was retained. No token refresh flow was found; session restore uses `/auth/me`. This application uses its own cached-page hooks, not React Query.

Cached queries, DataProvider initialization, permission refresh, Product Interest loading, and Workflow metadata now wait for auth loading to finish and stop on an auth initialization error. The existing route AuthGuard remains in place. Existing 401 propagation, tenant checks, permissions, and backend auth middleware remain intact.

No active server-rendering caller of the unsafe fallback was demonstrated. **Whether that fallback or auth timing caused the supplied production burst: I cannot confirm this.** The original logs omit caller/origin and cookie-presence evidence, and the changed code has not been deployed. Production navigation without transient 401s: **I cannot confirm this.**

## Actual request paths

The browser uses `apiClient` → same-origin `/api/proxy` → the existing Next route handler → configured `API_URL` (fallback `NEXT_PUBLIC_API_URL`, then local development URL), preserving `/api/v1`.

| Purpose | Browser path | Backend path with the standard API base |
| --- | --- | --- |
| CRM lists and records | `/api/proxy/crm/{leads,contacts,accounts,deals}` with record suffixes/query parameters | `/api/v1/crm/{leads,contacts,accounts,deals}` |
| Team users | `/api/proxy/administration/users` | `/api/v1/administration/users` |
| User permissions | `/api/proxy/administration/users/:id/permissions` | `/api/v1/administration/users/:id/permissions` |
| Workflows | `/api/proxy/automation/workflows` | `/api/v1/automation/workflows` |
| Workflow metadata | `/api/proxy/automation/{triggers,actions}` | `/api/v1/automation/{triggers,actions}` |
| Workflow runs | `/api/proxy/automation/workflows/:id/executions?page=N` | `/api/v1/automation/workflows/:id/executions?page=N` |
| Product catalog | `/api/proxy/administration/product-interests` | `/api/v1/administration/product-interests` |

## UI and validation changes

- Product Interest: removed the selected-name list beneath the shared selector. Leads, Contacts, Accounts, and Deals retain the control summary, checkbox state, multiple selections, and existing ID/name mapping.
- Custom Fields: removed the Product Interest card and its unnecessary catalog request. Closed Won Requirements remains. The existing “enable field” operation moved into Products for disabled catalogs, using the same API and permission check; Forms guidance now points to Products.
- Workflows: removed the separate “Loading workflow options…” text. The title, search, filter, Create Workflow control, and existing table loading state remain.
- Workflow Runs: uses the same shared Sheet/SheetContent shell and width as CRM record panels, including mobile full width, right positioning, backdrop, closing behavior, and scrollable content. The header shows the workflow name/status. Existing run status, dates, record/type, errors, expanded action order/results, refresh, and pagination remain. Loading uses the existing skeleton within the panel.
- Full-page records: extracted the Import back control into RecordBackButton and reused it above the existing breadcrumbs with Back to Leads/Contacts/Accounts/Deals. The existing navigation behavior is preserved; mobile targets are at least 44px tall.
- Contact Details: First name and Last name now have red required asterisks, required input attributes, whitespace rejection, trimmed saves, and existing inline validation messages. Create/edit schemas use the same trimmed nonempty rule. Email remains required.
- Account Details: Account name now has the same required styling/validation and retains the 255-character limit. Creation also trims and rejects whitespace. Required label columns reserve sufficient width to keep the asterisk with its label on narrow screens.
- Backend Contact and Account DTOs already sanitized/trimmed and rejected blank names on create/update. Those validators were retained and tested. No additional Account fields became required.

Product IDs, pricing, deal-value calculation, automatic Deal creation, Forms options, workflow execution, triggers/actions, and pause/resume services were not changed. Live database-backed regression behavior for those services: **I cannot confirm this.**

## Checks actually executed

- `npm run lint`: passed all three workspaces (TypeScript checks).
- `npm run build`: passed frontend production compilation/static generation (188 pages) and backend Prisma generation/TypeScript build. The initial sandbox run failed with a Windows EPERM; the approved rerun passed. Build warnings included existing multiple-lockfile/root detection and a local backend URL warning.
- Backend: `npm --prefix backend test -- src/modules/crm/__tests__/required-record-names.test.ts src/api/middleware/__tests__/auth-state.test.ts src/modules/crm/companies/companies-validation.test.ts` — 21 tests passed across 3 files. These include missing/forged credentials, session/tenant constraints, Contact names/email, and Account names.
- Frontend: 119 distinct targeted tests have passing final results across 12 suites. The combined run passed 117/119; two test assumptions were corrected (read-only status markup and asynchronous catalog refresh), then both affected suites passed all 40/40. The other ten suites passed 79/79. Early panel tests also exposed animation timing; the unit suite now applies final div visibility immediately, while browser checks exercise the real animation components. Existing non-failing jsdom/React act warnings remain.
- Browser: `node data/outputs/scoped-cleanup/browser-checks.cjs` uses headless Chrome, the actual Next frontend/proxy on port 3107, and a fixture backend on port 4107. It navigates Leads, Contacts, Accounts, Deals, Team Management, and Workflows; checks inline blank-name rejection, Custom Fields card removal, Workflow local loading, dropdown selection state, and the four full-page back labels.
- Responsive: 45 scenarios cover Workflow Runs, four inline Product Interest selectors, and four creation-panel selectors at 320, 375, 390, 768, and 1440px. Checks assert viewport bounds, no page overflow, mobile panel width/right alignment, and retained selections. Screenshots were inspected. All signed-in requests carried the fixture session; clearing it returned 401. The fixture cookie is test-only and was never used against production.
- `git diff --check`: passed. Existing LF/CRLF notices are informational.

Detailed evidence is in [browser-checks.json](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/data/outputs/scoped-cleanup/browser-checks.json>), [frontend combined test results](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/data/outputs/scoped-cleanup-tests.json>), and [final 40-test rerun](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/data/outputs/scoped-cleanup-final-retests.json>). The browser script and screenshots are in [the QA directory](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/data/outputs/scoped-cleanup>).

## Files changed

**Authentication and request diagnostics**

- [frontend/src/lib/api/client.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/lib/api/client.ts>)
- [frontend/src/store/AuthContext.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/store/AuthContext.tsx>)
- [frontend/src/store/DataContext.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/store/DataContext.tsx>)
- [frontend/src/shared/hooks/use-cached-page.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/hooks/use-cached-page.ts>)
- [frontend/src/shared/hooks/use-product-interests.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/hooks/use-product-interests.ts>)
- [backend/src/api/middleware/logger.middleware.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/middleware/logger.middleware.ts>)

**CRM display and required fields**

- [frontend/src/shared/components/crm/product-interest-select.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/product-interest-select.tsx>)
- [frontend/src/shared/components/crm/crm-record-view.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/crm-record-view.tsx>)
- [frontend/src/shared/components/crm/record-back-button.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/record-back-button.tsx>)
- [frontend/src/features/tenant/crm/shared/import/ui/import-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/shared/import/ui/import-page.tsx>)
- [frontend/src/features/tenant/crm/contacts/schemas/contact-form.schema.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/schemas/contact-form.schema.ts>)
- [frontend/src/features/tenant/crm/contacts/ui/contact-form.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/ui/contact-form.tsx>)
- [frontend/src/features/tenant/crm/accounts/schemas/account.schema.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/accounts/schemas/account.schema.ts>)

**Settings and Workflow presentation**

- [frontend/src/features/tenant/settings/ui/product-interests-settings.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/product-interests-settings.tsx>)
- [frontend/src/features/tenant/settings/ui/closing-fields-settings.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/closing-fields-settings.tsx>)
- [frontend/src/features/tenant/settings/ui/products-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/products-page.tsx>)
- [frontend/src/features/tenant/marketing/forms/ui/form-canvas.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/forms/ui/form-canvas.tsx>)
- [frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx>)
- [frontend/src/features/tenant/automation/workflows/ui/workflow-execution-log-modal.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/automation/workflows/ui/workflow-execution-log-modal.tsx>)

**Tests added or updated**

- [frontend/src/lib/api/client-auth.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/lib/api/client-auth.test.ts>)
- [frontend/app/api/proxy/[...path]/__tests__/proxy-cookie-forwarding.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/app/api/proxy/[...path]/__tests__/proxy-cookie-forwarding.test.ts>)
- [frontend/src/shared/hooks/__tests__/cached-page.integration.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/hooks/__tests__/cached-page.integration.test.tsx>)
- [frontend/src/shared/components/crm/__tests__/product-interest-select.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/__tests__/product-interest-select.test.tsx>)
- [frontend/src/shared/components/crm/__tests__/form-errors.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/__tests__/form-errors.test.tsx>)
- [frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx>)
- [frontend/src/features/tenant/settings/ui/product-interests-settings.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/product-interests-settings.test.tsx>)
- [frontend/src/features/tenant/automation/workflows/ui/workflow-execution-log-modal.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/automation/workflows/ui/workflow-execution-log-modal.test.tsx>)
- [backend/src/api/middleware/__tests__/auth-state.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/middleware/__tests__/auth-state.test.ts>)
- [backend/src/modules/crm/__tests__/required-record-names.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/__tests__/required-record-names.test.ts>)

This report and the scoped-cleanup QA artifacts were also added. Pre-existing changes to `docs/messages-work-email.md` and `data/outputs/live-sales-flow/` were left untouched.
