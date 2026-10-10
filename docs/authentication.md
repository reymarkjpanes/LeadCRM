# Authentication and onboarding

LeadCRM is an internally managed CRM for Camxian Technologies. PostgreSQL is the source of truth for account status, roles, password-change requirements, and onboarding. Existing bcrypt hashing, HttpOnly cookies, JWT verification, database sessions, tenant scoping, and RBAC remain in use.

See [security cleanup](security-cleanup-mfa.md) for password behavior and migration history.

## Supported flows

- All new users: sign in with email/password → change temporary password when required → informational LeadCRM onboarding → dashboard with existing role permissions.
- Returning users who have completed setup: sign in → dashboard.
- Existing users with `mustChangePassword=false` at migration time keep their established access; their passwords and roles are unchanged.

By default, tenant portal accounts require an exact, case-insensitive @camxian.com domain. Subdomains and suffix lookalikes are rejected. The backend checks the domain at password login and on every authenticated request, including existing sessions. Inactive accounts and suspended/rejected workspaces are denied access.

For local development and automated testing only, the backend can permit exact Gmail addresses from the server-side `LEADCRM_TEST_EMAIL_ALLOWLIST` when `LEADCRM_TEST_AUTH_ENABLED=true`. This exception is active only when `NODE_ENV` is `development` or `test`; production always ignores these test settings. Keep allowlists out of frontend variables. Users still need real persisted User records, normal passwords/sessions, roles, and backend permissions. Turning the applicable flag off rejects Gmail accounts at login and on existing sessions.

## Explicitly approved production accounts

The owner's subsequent instruction permits the two named Gmail accounts in the existing live deployment. This supersedes the earlier requirement that production have no personal-email exception. Keep `NODE_ENV=production`; enable the separate backend-only settings `LEADCRM_PRODUCTION_AUTH_ENABLED=true` and `LEADCRM_PRODUCTION_EMAIL_ALLOWLIST=tironjulieann10@gmail.com,reymarkjpanes@gmail.com` only for that approved policy. These settings have no effect in development, test, or unknown environments. The development test flag still cannot enable production access.

Matching remains exact after trimming/lowercasing; wildcards, Gmail dot/plus aliases and other accounts are rejected. No Google tokens, sessions, or permissions are fabricated. Disable `LEADCRM_PRODUCTION_AUTH_ENABLED` to remove this production exception immediately, including existing sessions.

After `npm --prefix backend run db:deploy`, run the existing provisioning CLI against the intended production database with `NODE_ENV=production`, the production settings above, and explicit `--production`:

```powershell
npm --prefix backend run db:provision-test-user -- --production --tenant-id <production-tenant-id> --email tironjulieann10@gmail.com --first-name "Julie Ann" --last-name Tiron
npm --prefix backend run db:provision-test-user -- --production --tenant-id <production-tenant-id> --email reymarkjpanes@gmail.com --first-name Reymark --last-name Panes
```

This deliberate operator action creates the persisted User and existing Client Admin assignment, hashes the independently generated temporary password, and submits each recipient's own welcome email. It preserves existing users unless `--reissue` is explicitly provided. `APP_URL=https://lead-crm-frontend-pi.vercel.app` supplies the approved login link. No credential is printed or returned by the CLI.

## Internal provisioning and passwords

Client Admin manages staff accounts through Team Management. There is no separate operator provisioning endpoint.

Team Management generates `firstname.lastnameNN`: names are normalized to lowercase ASCII letters/digits, unsupported characters/spaces are removed, and `crypto.randomInt(0, 100)` supplies two zero-padded digits. Empty normalized names use `user`/`account`. Each name part is limited to 34 characters, keeping the result within bcrypt's 72-byte limit. No shared `password123` credential is assigned by this flow.

The existing bcrypt helper hashes the credential. User creation, selected custom-role assignment, and the audit entry commit together. Only the hash is stored. Plaintext exists transiently for the existing branded `sendMail()` welcome email, which includes the recipient's own credential and `${APP_URL}/login`; it is never returned by the API, logged, or stored in audit records. The subject is **Welcome to LeadCRM**. `setupEmailSent=true` means the provider accepted submission; it does not confirm inbox delivery. An unsubmitted, rejected, or failed request produces an account-created warning. Retry account creation does not duplicate the user; administrators can use the existing Send Password Reset action for recovery.

User.mustChangePassword is persisted. Until cleared, authenticated tenant users can read /auth/me, change their password, or log out. Other protected APIs, including onboarding completion and preference endpoints, reject requests with PASSWORD_CHANGE_REQUIRED.

POST /auth/change-password accepts `{ password }` from the authenticated session. It compares the current password hash before applying `StrongPasswordSchema` so a lowercase temporary password gets the precise `PASSWORD_REUSE` error: “You cannot reuse your temporary password. Please choose a new password.” Different passwords must meet the shared strength policy. It writes the new hash, clears the flag, revokes other sessions and account-bound reset tokens, and records an audit event in one serializable transaction. The current database session stays valid. The frontend reuses the profile password form, shows field errors and “Password updated successfully.”, and applies the canonical user response to advance to onboarding. Password recovery uses the same strength policy, clears the flag, and revokes sessions; it does not complete onboarding.

User update and bulk-update payloads have an explicit allowlist. They cannot inject mustChangePassword, passwordHash, or tenantId. Primary-role changes synchronize User.role and UserRole in the same transaction; custom permission definitions remain unchanged.

## Informational onboarding

The existing onboarding status/completion routes and canonical auth response now use `User.onboardingCompletedAt`. Migration `20261104000000_user_first_login_onboarding` adds that nullable timestamp and backfills established users with `mustChangePassword=false`. Legacy Tenant fields are retained for compatibility; another user's or workspace's completion cannot skip a new user's tour.

The Login-inspired layout has a blue branding/progress panel and an informational content panel, stacked on small screens. Eight steps cover Welcome, Leads & Contacts, Accounts & Deals, Tasks & Activities, Campaigns & Email, Workflows, Forms & Products, and Notifications & Search. Next advances the local reading step. Skip and Finish both call the existing completion endpoint. Completion is persisted per user and audited once; the server response sends the user to Dashboard. Future logins skip the completed tour. No permissions are granted by completing it.

All protected module APIs and mailbox operations enforce password setup first, then onboarding, then the normal RBAC checks. Client route guards mirror that order. A localStorage flag or a manually entered URL cannot complete either server requirement.

## Development test-user provisioning

Use a confirmed development/test backend and database for the development mode, with both test-auth environment variables configured server-side. A production backend ignores this development exception even when the flag is enabled. The Vercel frontend URL alone does not establish the backend environment; `render.yaml` configures production. Do not switch production to development to permit these accounts; use the explicitly approved production policy above.

After applying the migration to the confirmed development database, run the deliberate CLI for each account (replace `<development-tenant-id>` with the existing test workspace ID):

```powershell
npm --prefix backend run db:provision-test-user -- --tenant-id <development-tenant-id> --email tironjulieann10@gmail.com --first-name "Julie Ann" --last-name Tiron
npm --prefix backend run db:provision-test-user -- --tenant-id <development-tenant-id> --email reymarkjpanes@gmail.com --first-name Reymark --last-name Panes
```

The CLI requires explicit development/test mode, the enabled flag, an exact allowlisted Gmail address, and an existing active Client Admin role in the selected workspace. It normalizes email comparison, rejects ambiguous/foreign-workspace matches, and preserves existing accounts by default. `--reissue` is a deliberate credential reset: generates a new temporary password, resets password/onboarding requirements, revokes sessions/reset tokens, and emails the new credential. No stored plaintext is recovered. A failed submission can be retried with `--reissue`; the new credential supersedes the previous one.

Set `APP_URL=https://lead-crm-frontend-pi.vercel.app` for the requested welcome link only when that frontend points to the confirmed test backend. If `BREVO_SANDBOX_EMAILS` is configured, include both recipient addresses there. The CLI prints only email, status, and the provider-submission boolean. Set `LEADCRM_TEST_AUTH_ENABLED=false` to immediately reject both Gmail accounts at login and on existing sessions.

## Recovery and account provisioning

Public password recovery uses the owner's explicitly approved account-existence disclosure policy: an unknown normalized email returns HTTP 404 with `ACCOUNT_NOT_FOUND` and “No account exists with this email address.” This is an intentional enumeration tradeoff, approved on October 10, 2026. Ineligible or ambiguous existing identities retain neutral responses; public callers cannot select a tenant. See the [recovery audit, approval, test results and deployment requirements](password-recovery-verification.md).

Recovery shares login's trimmed, case-insensitive identity lookup and the current employee/workspace/account access policies. Issued tokens are stored as SHA-256 hashes. Resend uses the same endpoint, rate limits and durable submission state; an uncertain provider submission is retained without automatic retry until its original expiry. The confirmation page displays the backend lifetime and acknowledges a recovery request without claiming inbox delivery.

Deploy migration `20261120000000_password_recovery_security` with the matching backend/frontend release. Stop old backend processes before hashing existing token rows; old binaries cannot read the new storage format. The migration preserves token identity, account binding and expiration, and the normal guarded deployment path continues to defer unrelated column retirements.

Tenant user accounts are provisioned by administrators through Team Management. The tenant-invitation flow and its token-based acceptance endpoint have been retired. Provisioned passwords are temporary when required, and users can establish their password through authenticated password change or password recovery.

Public signup, Google account sign-in, OTP, email-verification sessions, company setup, and old onboarding progress endpoints are disabled. Retired authentication bridge routes are unavailable. Gmail OAuth remains a separate CRM email integration and is not affected by the LeadCRM test-account exception: each tester must connect their mailbox through Google's real OAuth authorization and grant the requested Gmail scopes.

If the Google OAuth app is configured as **External** and its publishing status is **Testing**, add both `tironjulieann10@gmail.com` and `reymarkjpanes@gmail.com` to the OAuth app's **Test users** list in Google Auth Platform. An **Internal** app is limited to accounts in its Google Workspace organization, so personal Gmail accounts cannot use that configuration. See Google's [OAuth app state and access rules](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) and [consent screen setup](https://developers.google.com/workspace/guides/configure-oauth-consent).

## Deployment

Apply forward migrations with `npm --prefix backend run db:deploy`. See [retirement migration and validation](retired-features-cleanup.md). Existing passwordless accounts use password recovery or administrator provisioning.

The final role migration disables historical Guest accounts, revokes their sessions and any legacy pending invitations, and archives their role definitions without deleting identities, CRM data, assignments, or permissions. Only Client Admin is seeded as a predefined tenant role. There is no automatic User role: an administrator must select an existing custom role. Existing User definitions become editable custom roles with unchanged permissions. See [migration and verification](plans/final-role-model.md).

See [implementation and retirement inventory](plans/internal-camxian-crm.md) for affected files, preserved dependencies, and verification.
