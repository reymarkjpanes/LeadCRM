# LeadCRM UI and behavior verification

Implemented in the current checkout on October 8, 2026. No schema migration was added. Existing tables, historical values, tenant boundaries, and permission checks are retained.

## Requested report

1. **Files changed:** the complete source/test inventory is listed below. This report and the scoped generated-output ignore rule are also included; generated browser evidence is excluded from the commit.
2. **Contact Full Address:** the create/edit form label uses Full Address while keeping the existing `address` property, validation, and persistence.
3. **Log Activity scrolling:** the shared timeline holds a ref to the existing Quick Log composer. Opening it scrolls its closest `data-record-scroll` container smoothly and focuses a composer control with `preventScroll`.
4. **Shared modules:** Leads, Contacts, Accounts, and Deals use this one implementation. Browser checks confirmed the panel scrolls while the browser page position stays unchanged.
5. **Contact Assigned Agent:** both frontend and backend column registries rename Assigned To without changing `assignedUserId`.
6. **Lead Assigned Agent:** the existing renderer is exposed through a default-visible column. Leads and Contacts share the same display-name helper and neutral em-dash fallback. Existing table interactions and filtering are retained.
7. **Account automatic assignment:** new Accounts default to Assign automatically. The backend reuses the existing transactional sales-agent rotation; eligible automatic candidates exclude Client Admin. With no eligible agent, the existing unassigned fallback remains.
8. **Active Products:** removed from Account creation controls and creation payload. Edit controls, historical values, Product Interest, and product records remain.
9. **Internal Notes:** removed from Account creation controls and creation payload. Normal Notes remain; edits preserve historical internal notes.
10. **Closed Won collapse:** the existing RecordSection supplies the header, chevron, state, and content visibility. A validation focus request reopens it. Requirement editing, progress, required-field enforcement, and locked evidence remain intact.
11. **Task Done:** accepts the valid draft date/time and closes the picker. Calendar, hour, minute, and AM/PM selections stay open until Done or Cancel. Existing Philippine date/time helpers remain authoritative, including the next-occurrence rule.
12. **Task Cancel:** discards the draft and restores the committed pre-open value; Escape also discards. Past calendar dates are disabled and invalid drafts cannot be accepted. Unrelated DatePicker callers keep their existing behavior.
13. **Audience validation timing:** new rows do not display validation errors. Invalid values receive messages after leaving the value control or submitting. Focus inside the existing portaled Product Interest menu stays within the control for validation. Preview validation no longer marks untouched rows invalid.
14. **Friendly messages:** Select a status.; Select a source.; Select a company.; Select a Product Interest.; Select an Assigned Agent.; Select a valid date.; Enter valid dates with From on or before To.; Select an existing company for this source. Local schema diagnostics are mapped to these messages.
15. **Company data source:** the authorized `GET /marketing/audiences/companies?source=...` reads tenant-scoped active CRM records, using Lead.companyName and a Contact's linked Account.name with Contact.company fallback. It does not depend on the current page of a frontend record cache.
16. **Company deduplication:** names are trimmed, compared case-insensitively, deduplicated, and sorted. Options change with Leads / Contacts / All. Changing source clears a stale company choice. The backend rejects newly saved choices absent from the selected source, and matching handles whitespace/case variants.
17. **Audience layout:** a wider existing SideSheet permits one row on sufficiently wide panels. Smaller panels stack controls, allow full-width Operator/Value controls, and keep the remove button and footer reachable. Checked at 1440, 1024, 768, 390, 375, and 320 pixels.
18. **Value required indicator:** every condition row uses Value with the shared red asterisk style. Existing Created Date Any date semantics remain supported.
19. **Multi removal:** new campaign UI shows Email and SMS only. A create-specific shared schema rejects new Multi campaigns on the backend.
20. **Historical Multi:** stored types, draft/read compatibility, and historical records are retained. Integration coverage confirms an existing Multi record remains readable.
21. **Group/Section source:** the select uses shared `CUSTOM_FIELD_BUILT_IN_GROUPS` through `customFieldGroupOptions`, also used by backend validation.
22. **Per-module groups:** each module receives its canonical sections; an incompatible selection is cleared when changing module. Editing an existing field keeps its own legacy group available. Arbitrary new groups and incompatible module/group combinations are rejected; existing IDs and values remain stable.
23. **Password strength reuse:** Reset Password and Change Password use the existing PasswordStrengthMeter. The former inline Change Password checklist was consolidated into that component.
24. **Password validation:** the existing StrongPasswordSchema gates reset submission. Inline confirmation mismatch, busy state, checklist, strength bar, and bcrypt byte limit remain consistent with the shared policy.
25. **New React component files:** none. The new TSX file contains tests only.
26. **Tests executed:** see the results and commands below. Failed harness selectors and a missing legacy form-test fixture were repaired before reporting final passing results.
27. **Typechecks:** frontend, backend, and shared `tsc --noEmit` passed, including a complete `npm run lint` run.
28. **Builds:** production frontend and backend builds passed. The frontend build uses an explicit HTTPS test API origin to satisfy production configuration validation; this does not contact or deploy to production.
29. **Diff check:** `git diff --check` passed. Git's LF/CRLF notices are informational.
30. **Limitations:** acceptance uses local Chromium, the locally built frontend, authenticated backend APIs, and disposable PostgreSQL-compatible PGlite data. Browser API transport is redirected to the local backend. Production deployment, production database contents, live email/SMS delivery, and other browser engines were not verified. I cannot confirm this. The entire repository test suite was not run; the requested affected areas were covered by the focused checks below.

## Test evidence

| Verification | Final result |
| --- | --- |
| Frontend affected-component regressions | 95 distinct tests passed across 15 files, including successful reruns after fixture fixes |
| Campaign/audience authenticated database integration | 38 passed |
| Custom fields and Account assignment database integration | 9 passed, plus migration-preservation checks |
| CRM completion / Closed Won database integration | 14 passed, plus migration-preservation checks |
| Password/auth and campaign-content unit regressions | 14 passed across 3 files |
| Workspace lint/typechecks | 3 of 3 workspaces passed |
| Production builds | frontend and backend passed |
| Browser acceptance | 65 checks passed; zero page errors and zero transport errors |
| Whitespace validation | git diff --check passed |

Frontend regression coverage:
- Task Editor and Philippine task-date helpers.
- AudiencePanel, campaign builder, custom-field settings, and Change Password.
- Closed Won requirements, activity timeline, status forms, and Product Interest.
- Leads table records, Assigned Agent controls, Contact filters, Account validation, and Deal form.

Backend commands executed:
- `node backend/scripts/test-campaign-groups.mjs src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts`
- `node backend/scripts/test-custom-fields.mjs`
- `node backend/scripts/test-crm-completion.mjs`
- `npm --prefix backend run test -- src/core/auth/__tests__/change-password.service.test.ts src/core/auth/__tests__/security-validation.test.ts src/modules/marketing/campaigns/__tests__/campaign-content.test.ts`

Other commands executed:
- `npm run lint`
- `npm run build` with `API_URL=https://leadcrm-build.example/api/v1`
- `npm --prefix frontend run build` with the same test origin
- `npm --prefix backend run build`
- `git diff --check`
- `node backend/scripts/verify-ui-fixes-browser.mjs <installed-playwright-module-path>`

The browser harness checks Contact address persistence; Account creation; all four Quick Log panels; Closed Won collapse; Task Cancel/Done and persisted creation; campaign type options; audience validation/companies/layouts; module-specific groups; password strength/mismatch; successful password reset and session revocation; and rejection of reused, invalid, and expired reset tokens. Screenshots cover forms, condition controls, and the open Product Interest popup at all six requested widths.

Generated evidence (48 screenshots, results JSON, and build/browser logs) is preserved locally outside the repository and excluded from this commit. Rerunning the browser harness writes fresh evidence to `data/outputs/ui-fixes-browser/`, which is ignored by Git.

## Source and test files

- `backend/scripts/verify-ui-fixes-browser.mjs`
- `backend/src/api/routes/marketing.routes.ts`
- `backend/src/modules/crm/closing-requirements/closing-requirements.service.ts`
- `backend/src/modules/crm/closing-requirements/custom-fields.integration.test.ts`
- `backend/src/modules/crm/companies/companies.repository.ts`
- `backend/src/modules/crm/leads/lead-automation.service.ts`
- `backend/src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts`
- `backend/src/modules/marketing/campaigns/audiences.controller.ts`
- `backend/src/modules/marketing/campaigns/audiences.service.ts`
- `backend/src/modules/marketing/campaigns/campaigns.service.ts`
- `backend/src/modules/preferences/column-registry.ts`
- `frontend/src/features/tenant/crm/accounts/ui/__tests__/account-validation.test.tsx`
- `frontend/src/features/tenant/crm/accounts/ui/account-form.tsx`
- `frontend/src/features/tenant/crm/contacts/ui/contact-form.tsx`
- `frontend/src/features/tenant/crm/contacts/ui/contacts-page.tsx`
- `frontend/src/features/tenant/crm/leads/ui/leads-page.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/audience-panel.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/audience-panel.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaign-builder.tsx`
- `frontend/src/features/tenant/operations/tasks/__tests__/task-editor.test.tsx`
- `frontend/src/features/tenant/operations/tasks/ui/task-editor.tsx`
- `frontend/src/features/tenant/pages/modern-login-page.tsx`
- `frontend/src/features/tenant/settings/ui/__tests__/closing-fields-settings.test.tsx`
- `frontend/src/features/tenant/settings/ui/closing-fields-settings.tsx`
- `frontend/src/features/tenant/settings/ui/password-change-form.tsx`
- `frontend/src/shared/components/crm/__tests__/crm-status-forms.test.tsx`
- `frontend/src/shared/components/crm/__tests__/deal-closing-requirements.test.tsx`
- `frontend/src/shared/components/crm/crm-record-view.tsx`
- `frontend/src/shared/components/crm/deal-closing-requirements.tsx`
- `frontend/src/shared/components/crm/record-section.tsx`
- `frontend/src/shared/components/crm/record-timeline-tab.tsx`
- `frontend/src/shared/components/password-strength-meter.tsx`
- `frontend/src/shared/components/ui/date-time-picker.tsx`
- `frontend/src/shared/constants/column-registries.ts`
- `frontend/src/shared/services/audiences.api.ts`
- `frontend/src/shared/utils/assigned-agents.ts`
- `shared/src/contracts/campaign-email.js`
- `shared/src/contracts/campaign-email.ts`
- `shared/src/contracts/closing-requirements.ts`
