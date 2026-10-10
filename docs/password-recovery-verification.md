# Forgot Password implementation and verification

Verified locally on October 10, 2026 (Asia/Manila). **Implemented and locally verified; not deployed or declared production-ready.**

## 1. Root cause and audit findings

The previous generic response was intentional. `password-reset.service.ts` explicitly said to always return success to avoid leaking email existence, and `auth.controller.ts` repeated that policy. Unknown/ambiguous addresses already returned without creating tokens or calling Brevo. The frontend interpreted every resolved recovery request as success and moved to its existing confirmation view.

The inaccurate part was the heading “Email Sent Successfully,” alongside a hardcoded 60-minute notice. The backend supported a configurable lifetime; the frontend did not consume it. AuthContext also collapsed all recovery errors into `false`, losing provider errors, machine-readable codes and retry guidance. Forgot Password had no submission mutex/loading state. Recovery's email schema/lookup differed from login's normalization. The service did not enforce the current employee, active-account or accessible-workspace policy, and stored raw reset tokens. Reset revoked sessions, but had no reset audit event and needed stronger concurrent single-use handling.

Audited the login/recovery/reset UI, AuthContext/API client, public auth routes/controllers/services, administrator recovery, authoritative User identity model, employee/access policy, Brevo transport/templates, token schema, IP/proxy configuration, rate limiting, Sonner toast provider, first-login/provisioning and auth tests. Team Management screenshots were context, not authoritative account lookup data.

## 2. Confirmed security policy

The owner's latest instruction explicitly selected **Option 2 — Approve explicit account-not-found disclosure**, superseding the earlier neutral-response choice. This approval authorizes public disclosure of account existence on Forgot Password and Resend Link:

- Zero authoritative matches: HTTP 404, `ACCOUNT_NOT_FOUND`, “No account exists with this email address.”
- Existing inactive, pending, retired-role, disallowed-email, inaccessible-workspace or ambiguous identities: neutral success, no token, no email, no status/tenant/role/security metadata.
- Public input is strictly `{ email }`; tenant selection is rejected.

This policy intentionally permits account enumeration. IP/address limits reduce abuse; they do not make it equivalent to generic responses. [OWASP recommends consistent account-existence responses](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). The neutral alternative was not selected in the owner's final instruction.

## 3. Backend validation and abuse protection

Frontend/backend share `ForgotPasswordSchema`: trim, lowercase, maximum 254 characters, email validation, and a strict input object. Services also parse input to protect administrative/internal callers. Authoritative Prisma lookup uses the same case-insensitive email rule as login. Public recovery requires exactly one identity; tenant-scoped duplicate addresses remain neutral. Authorized administrator recovery binds the existing selected User/tenant and fails safely when that target is ineligible.

Production retains the existing three-per-hour IP reset limiter and adds three-per-hour normalized-address limiting after validation. Address keys are hashed. Development retains the repository's higher test limits. The trusted-proxy policy remains unchanged. Rate-limited events and HTTP error codes support operational monitoring without logging addresses, tokens or hashes. The production limiter settings were executed in a controlled middleware HTTP test.

Serializable ORM transactions arbitrate eligible-account requests, preserving tenant middleware. Accepted requests suppress additional sends during the 60-second resend cooldown. Pending/uncertain attempts durably suppress further submissions until expiry. These account-bound controls survive process restarts; IP/address limiter counters still use the existing process-local store. Multiple backend replicas would require a shared limiter store for aggregate limits.

## 4. Frontend toast, loading and navigation

AuthContext/API preserve structured errors and backend lifetime/retry guidance. Forgot Password validates before calling the API, uses a synchronous submission mutex, disables submission while pending, and restores the loading state in `finally`.

`ACCOUNT_NOT_FOUND` is identified by code, never by message matching. It displays the exact requested Sonner error toast, preserves the entered email, keeps the form visible, and allows correction. If returned during resend, it returns to that form. Provider rejection stays on the form with the safe provider-failure message. HTTP rate-limit and uncertain-outcome retry guidance disable unsafe immediate retries.

The same split-screen/branding/forms, confirmation, reset and login layout classes remain. Confirmation says “Password reset email requested,” conditionally describes eligibility, and uses `expiresInMinutes` from the backend. Administrator recovery feedback also says “requested” instead of asserting email delivery. No new modal/page was introduced.

## 5. Brevo handling

The existing Brevo transport and branded email templates remain in use. HTTP acceptance is treated as successful submission, including acceptance with an unreadable tracking body; it does not prove inbox delivery. Production credentials/sender/origin were not changed.

Definite provider rejection, a configured development delivery block, or missing provider configuration returns `PASSWORD_RESET_EMAIL_FAILED` with “Unable to send the password reset email. Please try again later.” The failed attempt's token is removed to permit a rate-limited manual retry. Network/timeout outcomes return `PASSWORD_RESET_SUBMISSION_UNCONFIRMED` and `retryAt`; their hashed token remains usable if a message was actually submitted. No automatic resend occurs. Persistence uncertainty also retains the durable pending protection. Recovery logs omit exception messages, metadata and stacks that could contain security data.

## 6. Resend verification

Resend calls the same recovery service/endpoint and applies the same validation, identity/access policy, token rules and IP/address limits. Frontend/backend cooldowns prevent unnecessary duplicate messages. A successful resend after cooldown replaces that account's previous link. Uncertain outcomes remain blocked until expiry; expired attempts permit a new request. Definite rejection permits safe manual retry under the normal limits.

Automated checks covered successful, rejected, uncertain, expired, rate-limited and removed-account resend scenarios. Browser checks observed the disabled countdown, its eventual enablement, accurate resend toast, unchanged confirmation and retained single current account token.

## 7. Token, password and session security

New tokens retain 32 cryptographically random bytes and store only SHA-256 digests. The atomic forward migration hashes existing token values while preserving record identity, User binding, email, creation and expiry; existing raw link tokens still hash to the migrated digest. [PostgreSQL's built-in SHA-256 function](https://www.postgresql.org/docs/16/functions-binarystring.html) is used without requiring a new extension. Expiration derives from `PASSWORD_RESET_TTL_MINUTES` (default 60), shared with the email notice. Tests also used 25 minutes to detect hardcoded notices.

Reset checks the token's digest/expiry and rechecks authoritative account-access eligibility. Shared password strength and password-reuse rules remain. Token consumption, bcrypt password update, first-login flag clearing, all session revocation, account-bound token cleanup and a secret-free `PASSWORD_RESET` audit entry commit in one serializable transaction. Simultaneous reset attempts succeed once. Reset does not complete onboarding or reactivate accounts.

## 8. Files modified/added

Paths are relative to the repository; TypeScript is canonical. JavaScript companions below were generated by the shared build.

| Area | Files |
| --- | --- |
| Shared | `shared/src/validation/auth.schema.ts`, `.js`; `shared/src/contracts/auth.contract.ts`, `.js` |
| Token schema/forward migration | `backend/prisma/schema.prisma`; `backend/prisma/migrations/20261120000000_password_recovery_security/migration.sql` |
| Backend recovery | `backend/src/core/auth/auth.dto.ts`; `auth.controller.ts`; `password-reset.service.ts` |
| Public API/operational protection | `backend/src/api/routes/auth.routes.ts`; `backend/src/api/middleware/rate-limit.middleware.ts`; `error.middleware.ts` |
| Administrator feedback | `backend/src/modules/administration/users/users.controller.ts`; `frontend/src/features/tenant/settings/ui/user-panel.tsx` |
| Frontend recovery | `frontend/src/features/tenant/pages/modern-login-page.tsx`; `frontend/src/shared/services/auth.api.ts`; `frontend/src/store/AuthContext.tsx` |
| Deployment guard | `backend/scripts/deploy-crm-imports.cjs`; `verify-canonical-rollout.test.cjs` |
| Reproducible native/browser fixtures | `backend/scripts/test-password-recovery.mjs`; `preview-password-recovery.mjs` |
| New backend tests | `backend/src/core/auth/__tests__/password-recovery.integration.test.ts`; `backend/src/api/middleware/__tests__/password-recovery-rate-limit.test.ts`; `backend/src/tests/migrations/password-recovery-security.test.ts` |
| Updated backend regressions | `backend/src/core/auth/__tests__/first-login.integration.test.ts`; `security.integration.test.ts`; `backend/src/shared/services/__tests__/account-email-regression.test.ts`; `backend/src/modules/administration/users/users-import.integration.test.ts`; `backend/src/api/middleware/__tests__/error.middleware.test.ts` |
| New frontend tests | `frontend/src/features/tenant/auth/__tests__/password-recovery.test.tsx` |
| Documentation | `docs/authentication.md`; `docs/API.md`; this report |

## 9. Executed tests and outcomes

These are focused suites, not a claim that the entire repository test suite ran. Overlapping reruns are not added to the counts.

| Executed check | Actual result |
| --- | --- |
| Backend focused Vitest: account-email regression, Brevo transport, auth templates, account access, login, password change, production recovery limiter, error middleware | 8 files, 101 tests passed |
| `node backend/scripts/test-password-recovery.mjs` — fresh native PostgreSQL recovery and administration/import HTTP suites | 12 recovery + 4 administration tests passed, zero skipped |
| Backend first-login/security integration and token migration Vitest | 3 files, 32 tests passed |
| Frontend recovery, auth entry, password change, UserPanel and login-flow Vitest | 5 files, 24 tests passed |
| `npm --prefix backend run test:rollout` | 9 passed; unrelated retirement exclusions and rejection of unreviewed migrations preserved |
| `npm run lint` | Shared, backend and frontend TypeScript checks passed |
| `npm run build` with process-only production `API_URL=https://api.lead-crm.tech/api/v1` | All three workspace builds passed; Prisma generation succeeded; 180 frontend pages generated |
| `git diff --check`; syntax checks for both added `.mjs` scripts | Passed |

Initial sandbox runs failed before test execution due to Windows temporary-file access or local socket restrictions; approved outside-sandbox reruns executed successfully. The old local preview's Prisma DLL lock was resolved before the production build. Native tests initially found an invalid active-Guest fixture, insufficient concurrency-test timeout and an administrator recovery regression from a raw-query approach. The fixture/timeout were corrected, and the implementation now uses the canonical serializable ORM boundary. Final runs above passed.

The new migration initially triggered the deliberate unreviewed-migration guard. Its preserving SQL was reviewed and tested, then only its exact name was added to the existing independent-transition allowlist. No unrelated guard or retirement gate was disabled.

### Requested A–J coverage

| Scenario | Verification |
| --- | --- |
| A Unknown email | Native HTTP: exact 404/code, unchanged token count, zero provider calls. Browser: exact toast, email/form retained; fixture counters were zero tokens/zero provider requests. |
| B Registered email | Native HTTP: real User lookup, simulated Brevo 201, hashed stored token, working reset. Browser: existing disposable account reached confirmation. |
| C Invalid email | API validation rejected malformed/arbitrary tenant input. Frontend unit/browser validation prevented a recovery request. |
| D Case normalization | Native HTTP trimmed/uppercase input and browser uppercase input found the eligible account. |
| E Restricted account | Inactive/pending/retired-role/disallowed-email/suspended-workspace/ambiguous identities remained neutral without tokens/mail. Reset after deactivation was denied. |
| F Brevo failure | Controlled 401 rejection returned safe failure with no retained failed token; timeout retained the uncertain attempt and suppressed duplicate submission. Browser rejection kept the form. |
| G Repeated requests | Frontend mutex and native concurrent requests sent once. Production IP/address rate limits returned 429 with retry guidance. |
| H Resend | Native/unit/browser results as recorded in section 6. |
| I Expired/reused tokens | Expired/replaced/reused tokens denied; concurrent token consumption succeeded once. |
| J Successful reset | Real bcrypt hash changed; sessions/tokens revoked; old password rejected, new password accepted; secret-free audit recorded; first-login/onboarding restrictions preserved. |

Browser checks used the actual frontend/proxy/backend against a disposable native PostgreSQL instance with a simulated provider. Desktop 1440×900 and mobile 390×844 layouts were checked; mobile confirmation had no horizontal overflow. Back to Login remained functional. Browser viewport overrides were reset. Screenshots are outside the repository in the task's visualization output directory: `recovery-unknown-desktop.jpg`, `recovery-requested-mobile.jpg`, `recovery-provider-rejected.jpg` and `recovery-resend-mobile.jpg`.

## 10. Production verification

Public production baseline checks were executed on October 10, 2026:

- `https://lead-crm.tech/login`: HTTP 200.
- `/api/proxy/health`: HTTP 200, status `ok`, backend commit `08c7ee73bc7b5195e678503ce15e1c7d2ba44b02` (also the local starting HEAD).
- One stateless POST for a synthetic `.invalid` address: HTTP 200 with the previous generic message, “If that email is registered, a reset link has been sent.” It did not exercise the new implementation.

The in-app production browser already had the owner's session, so its login navigation redirected to Dashboard. That session was not logged out, reset or used to request recovery for a real user. No real-user credentials, production tokens or account lists were retrieved. Production database/provider token counts and inbox delivery were not verified. **I cannot confirm this.**

This report records local and pre-publication verification. Git publication is separate from deployment verification. No Coolify deployment or production migration was performed during this audit. Production backend/frontend logs for a newly deployed revision, real Brevo acceptance, an authorized production test-account reset and live expiration/session behavior remain unverified. **I cannot confirm this.**

## 11. Remaining limits and release requirements

Local mandatory scenarios A–J are covered with the boundaries above; real provider acceptance/inbox delivery and deployed A–J acceptance are not established. This release requires a named, authorized production test account and verification after deployment. The displayed expiration is now backend-authoritative; production's actual configured value was not inspected.

Use the normal guarded forward migration path. Stop old backend processes before `20261120000000_password_recovery_security`, then release the matching backend/frontend revision and verify both services/proxy reach it. Do not run old token-handling binaries against the migrated digest format. Preserve the separate historical retirement gates. Do not apply destructive schema/reset commands. See [authentication deployment guidance](authentication.md) and [normalization rollout](csv-import-normalization.md).

For production acceptance, verify the unknown toast/form with a synthetic address, then use only the authorized test account to verify Brevo acceptance, link expiration/use, successful password change, old/new login behavior, session revocation, resend/rate limits and safe logs. Inbox receipt is a separate observation from provider submission. Explicit existence disclosure retains enumeration risk even after all checks pass.
