# Product Details, Form Share, role label, and Deal email fixes

Implemented against the current checkout on October 8, 2026. The changes preserve the existing Poppins font, module boundaries, permissions, tenant isolation, and stored historical values. No migration or new production React component file is required.

## Product Details

- The existing `SlidingDrawer` keeps its default responsive width and close button. Its optional eyebrow displays **PRODUCT RECORD** above **Product details**.
- The actual Product name appears beneath the uppercase Product Name label without changing stored text. Deal Value/Status and Created/Updated use two columns when space permits and stack below 390px.
- The existing PHP `Intl.NumberFormat` and precision remain. `Badge` supplies Active/Archived status. Dates use the shared `formatDateTime` and `formatDate` helpers without a new timezone conversion.
- **Closed Won** replaces **Closed Won customers**. Its single-line header shows the existing API `meta.total`, correct record/records wording, and `RefreshButton` with `aria-label="Refresh Closed Won"` and the existing tooltip.
- Requests are locked while pending and cancelled on unmount/dependency changes. Refresh reads only the existing paginated Closed Won endpoint. Product metadata stays visible. The existing `DataLoadingSpinner` supplies a spinner with an accessible label and no visible loading text.
- Records use the existing **DataGrid TABLE**, including on mobile. No card renderer or alternate mobile presentation was added. DataGrid supplies compact headers, borders, row styling, and contained horizontal scrolling.
- Following the final requested layout, the table has exactly three columns: **Contacts**, **Won**, **Assigned Agent**. Contacts uses `AvatarCell` plus shared `getInitials`; company appears below the name when available. Deal/Product and Value columns are omitted; Product name and default value remain in the metadata above the table.
- Contact names/company and assigned agent come directly from `ProductWonDeal.customers`, `company`, and `assignedAgent`. The server resolves agent display names; IDs and agent email addresses are not displayed. The Contacts label does not alter the existing customer/Deal query semantics.
- Historical `ProductWonDeal.value`/`currency` and Deal titles remain unchanged in the API and database but are no longer rendered in this table. Won uses the Deal's `closedAt`, never Product `updatedAt`. The existing backend `stage.isWon` query is unchanged.
- `LeadsPagination` remains below the table, defaults to 25, and sends page/limit to the existing API. The page is clamped when a refreshed total reduces the number of pages. It remains visible but disabled during requests.
- Empty results display **No Closed Won records found.** inside DataGrid. Failures remain visible with the refresh action available to retry.

## Form Share

- Embed Code and Share Link retain their existing controls. Submission History uses the existing `RefreshButton`, tooltip, `aria-label="Refresh submissions"`, request lock, and shared spinner. No text refresh link remains.
- History loads on opening Share. Native `details`/`summary` disclosures remain collapsed initially and preserve open state when the same submission is refreshed. Load more keeps server pagination and de-duplicates IDs. Empty/error states remain explicit.
- Fields come from each submission's published schema and actual stored values; no permanent field list was introduced. Long values wrap within the panel.
- A small read-only repository lookup resolves selected Product UUIDs in one batched, tenant-scoped catalog query per submission page, including archived Products. The response adds optional `productLabels`; stored submission values are untouched.
- The frontend uses those catalog names, then existing published `optionLabels` as a historical fallback. Missing UUIDs display **Unavailable product**; legacy text remains readable. Arrays and comma-separated legacy IDs are supported.

## Role Name and Deal email

- The existing Role Name label now uses the standard `text-red-500` asterisk. Its required input and validation remain. **Description — Optional** remains optional.
- The shared Deal detail view uses the first ordered Contact relationship as the customer; only when no Contact exists does it use the first ordered Lead. It never substitutes the assigned agent, account owner, or signed-in user.
- The email chip invokes the same `recordEmailComposeHref`/Inbox navigation mechanism already used for Leads and Contacts. `URLSearchParams` safely encodes recipient and subject. Existing shared email validation still rejects invalid recipients.
- Deal detail now includes the existing `productInterestRecord` relation's ID/name. This authoritative name takes precedence over stale legacy display arrays and Deal title text. The shared Deal response type includes the optional relation.
- Inbox reuses the existing `ComposeModal` / New Message. To receives the customer email; Subject receives **&lt;Product name&gt; Inquiry**; Body starts blank and remains editable. To and Subject remain editable.
- A missing or invalid customer email disables the chip. A missing Product uses **Product Inquiry**. Query prefill is consumed once and removed synchronously; closing clears transient state and refreshing does not reopen the request.
- This flow only navigates and prepares a draft. It does not call Send, save an activity, or bypass mailbox connection, sender authorization, permissions, or backend send validation. Existing reply/draft/send behavior is retained.

## Files changed

Production frontend:

- `frontend/src/features/tenant/settings/ui/products-page.tsx`
- `frontend/src/features/tenant/settings/ui/roles-permissions.tsx`
- `frontend/src/features/tenant/marketing/forms/ui/form-share-panel.tsx`
- `frontend/src/features/tenant/inbox/services/compose-navigation.ts`
- `frontend/src/features/tenant/inbox/ui/inbox-page.tsx`
- `frontend/src/shared/components/crm/crm-record-view.tsx`
- `frontend/src/shared/components/crm/data-view-states.tsx`
- `frontend/src/shared/components/sliding-drawer.tsx`
- `frontend/src/shared/services/forms.api.ts`

Backend/shared:

- `backend/src/modules/marketing/forms/forms.repository.ts`
- `backend/src/modules/crm/deals/deals.repository.ts`
- `shared/src/contracts/forms.contract.ts`
- `shared/src/types/deal.types.ts`

Tests and reproducible verification:

- `frontend/src/features/tenant/settings/ui/product-interests-settings.test.tsx`
- `frontend/src/features/tenant/marketing/forms/ui/form-share-panel.test.tsx` (new test file only)
- `frontend/src/features/tenant/inbox/ui/compose-navigation.test.tsx`
- `frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx`
- `backend/src/modules/marketing/forms/forms.integration.test.ts`
- `backend/src/modules/crm/leads/sales-automation.integration.test.ts`
- `backend/scripts/test-product-share-db.mjs`
- `backend/scripts/verify-product-share-browser.mjs`
- This report; local screenshots/results under `data/outputs/product-share-browser/`.

New production React component files: **none**. Existing integration test users now satisfy the current onboarding prerequisite so HTTP assertions exercise their intended authorization and behavior.

## Executed checks

| Check | Result |
| --- | --- |
| Focused frontend tests: Products, Forms Builder/public UI, Submission History, Roles, Deal detail/form, Product selector, Inbox and prefill | 119 passed across nine suites; Deal/Inbox rerun passed all 61 tests; after the final three-column change, all 22 Product tests passed again |
| `node backend/scripts/test-product-share-db.mjs` | 42 Forms/Product tests passed; targeted Closed Won API test passed; 27 unrelated sales tests intentionally filtered out |
| Frontend `npm --prefix frontend run lint` | Passed |
| Backend `npm --prefix backend run lint` | Passed |
| Shared `npm --prefix shared run lint` | Passed |
| `npm --prefix frontend run build` | Passed with all 180 static pages generated |
| `npm --prefix backend run build` | Passed, including Prisma generation and TypeScript |
| `git diff --check` | Passed |
| `node backend/scripts/verify-product-share-browser.mjs <Playwright module path>` | Final three-column build: 21 browser checks passed; no page errors or transport errors |

Browser layout checks passed for **1440, 1024, 768, 390, 375, and 320px** on both Product Details and Forms Share. The computed font remained Poppins at every width. Product metadata wrapped/stacked, Closed Won remained a table with internal horizontal scrolling, pagination was reachable, and refresh controls fit without browser-level overflow. The browser also verified both requested Product subjects, Contact precedence, Lead fallback, editable composer fields, blank initial Body, one-time query consumption, and unchanged activity counts without any send request.

Evidence: `data/outputs/product-share-browser/results.json`, `product-*-top.png`, `product-*.png`, `submissions-*.png`, and `compose-*.png`.

The tests cover Product create/edit/archive validation, decimal price preservation, Closed Won lookup/pagination/isolation, submission persistence and schema values, archived Product labels, publish/unpublish/public submissions, role validation, recipient precedence, dynamic Product subjects, invalid/missing email, missing Product, consumed query state, and no automatic send.

Initial Windows sandbox runs were blocked by temporary-file rename/read-path/localhost restrictions; the affected checks were rerun outside the sandbox. An older Forms migration fixture also hit an existing retirement guard before tests; the new runner replays current migrations into a fresh disposable database and runs the same Forms suites successfully. Next.js still emits its existing multiple-lockfile workspace-root warning; Vitest emits its existing config-loader warning.

## Verification boundaries

Browser evidence uses the actual local production build, actual API, and a disposable database, with browser API transport redirected to that local API. No production records were modified. No email was sent. Live Gmail OAuth, delivery, live mailbox synchronization, and deployed-site behavior: **I cannot confirm this.** The full monorepo test suite was not run. Generated screenshots and logs are local ignored artifacts; the verification scripts reproduce them. Deployment verification is separate from Git publication.
