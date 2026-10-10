# Production account provisioning — 2026-10-07

The owner explicitly approved production access for these two accounts, superseding the original development-only restriction. Production continues to run with `NODE_ENV=production`; the original development flag is ignored there.

## Release and configuration

- Commit: `d435573492060c4aa013bc060cf8b01ab9f213b6`, verified on both `origin/main` and `upstream/main`.
- Render service: `leadcrm-backend` (`srv-d9q1v1lbedkc73audjsg`).
- Backend-only production exception enabled for exactly `tironjulieann10@gmail.com,reymarkjpanes@gmail.com`.
- Disable `LEADCRM_PRODUCTION_AUTH_ENABLED` and apply the updated Render environment to revoke the exception, including existing sessions. The development flag does not control production access.
- Login URL: https://lead-crm-frontend-pi.vercel.app/login
- Public frontend proxy confirmed the expected backend commit and HTTP 401 for unauthenticated `/auth/me`.
- Migrations `20261103000000_reply_engagement_deal_batches` and `20261104000000_user_first_login_onboarding` applied successfully. The separate relationship compatibility retirement remains deferred.

## Accounts and email submissions

| Account | Persisted status | Existing role | Welcome submission |
| --- | --- | --- | --- |
| tironjulieann10@gmail.com | ACTIVE | Client Admin | Brevo HTTP 201 at 04:23:38 UTC |
| reymarkjpanes@gmail.com | ACTIVE | Client Admin | Brevo HTTP 201 at 04:23:42 UTC |

Database reads confirmed both UserRole assignments, bcrypt password storage, `mustChangePassword=true`, incomplete per-user onboarding, and normal provisioning audit records. The workspace has four users, including its two existing users.

The initial local welcome submission for Julie Ann was rejected by Brevo's IP restriction. No local email was accepted. The existing CLI then ran on Render, deliberately reissuing Julie Ann's unused credential and creating Reymark's account. Both hosted submissions were accepted. The temporary build command was restored to its original value immediately after submission; normal builds do not provision users or resend credentials.

Each welcome email contains that recipient's own generated temporary password. No shared `password123` was assigned. Credentials were not returned by the CLI or included in this report. Recipients must change their password and complete or skip onboarding before using protected modules.

Provider message IDs:

- Julie Ann: `<202610070423.55307004021@smtp-relay.mailin.fr>`
- Reymark: `<202610070423.21380885767@smtp-relay.mailin.fr>`

Provider acceptance is verified; inbox delivery and the recipients' first login are not confirmed. Gmail authorization, mailbox synchronization, and customer-reply behavior have not been exercised with these live accounts. Gmail integration still requires each user's legitimate Google authorization. If the Google app is External and in Testing, both accounts must be included in its Google OAuth test-user list; see `docs/authentication.md`.

## Verification before release

The production-policy implementation passed 186 focused backend auth, middleware, and mailbox-ownership checks (six unrelated dedicated-runner checks skipped), three deployment checks, backend lint/typecheck, and backend build. Live checks above are distinct from those automated checks.
