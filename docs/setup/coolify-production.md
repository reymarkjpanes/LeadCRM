# Coolify production configuration

Both applications build from the repository root and deploy the same reviewed
full Git SHA. Keep the root workspace lockfile and npm 11.19.1.

| Setting | Frontend | Backend |
| --- | --- | --- |
| Install | `npx --yes npm@11.19.1 ci --include=dev` | `npx --yes npm@11.19.1 ci --include=dev` |
| Build | `npm --prefix frontend run build` | `npm --prefix backend run build` |
| Start | `npm --prefix frontend start` | `npm --prefix backend run db:deploy && npm --prefix backend start` |
| Internal port | 3000 | 4000 |
| Health path | `/login` | `/health` |
| Public origin | `https://lead-crm.tech` | `https://api.lead-crm.tech` |

Configure frontend `API_URL=https://api.lead-crm.tech/api/v1` at build and runtime.
The browser uses same-origin `/api/proxy`; its route handler forwards the
HttpOnly session cookie and rewrites response cookies to the frontend origin.
Next config validates the same URL function at build/start. There is no competing
rewrite, public-variable fallback, or implicit deployment hostname.

Backend `APP_URL` and `ALLOWED_ORIGINS` must use the HTTPS frontend origin.
`TRUSTED_PROXIES` must contain only verified ingress addresses or Docker CIDRs.
Do not expose the backend port directly on the host. Configure provider callbacks
and signed webhooks against the verified HTTPS API domain.

Do not run local schedulers against an unverified remote database. Existing local
database credentials must remain unchanged unless a development database migration
is explicitly approved. Local API_URL, APP_URL, ALLOWED_ORIGINS and NODE_ENV differ
from production intentionally.

## Runtime environment contract

Derived from application source, Prisma schema, Next startup and the hosting
entry point. Paths below are relative to the repository root. Secret and private
values belong in hosting configuration, never in this document or examples.
Optional values may be absent. Feature-required values fail at the feature boundary
and do not prevent the rest of the CRM from starting.

| Variable | Consumer | Sensitivity / requirement | Local behavior | Production behavior |
| --- | --- | --- | --- | --- |
| API_URL | frontend/src/lib/server/backend-url.ts; next.config.ts; proxy and keep-alive routes | Public URL, core required | Explicit `http://localhost:4000/api/v1` | Explicit verified HTTPS backend ending `/api/v1`; same at build/runtime |
| NEXT_PUBLIC_USE_MOCK_AUTH | frontend/src/lib/config.ts; store/AuthContext.tsx | Flag, optional | Explicit true opts into mocks; false for real stack | Always disabled by code; configure false |
| NEXT_PUBLIC_USE_MOCK_DATA | frontend/src/lib/config.ts | Flag, optional | Explicit true opts into mocks; false for real stack | Always disabled by code; configure false |
| NEXT_PUBLIC_FORM_ORIGIN | frontend/src/features/tenant/marketing/forms/services/forms.service.ts | Public URL, optional | Current browser origin when unset | Current browser origin when unset; deliberate public Forms origin otherwise |
| NODE_ENV | frontend flags/cookies; backend/server.ts, config, auth, email, middleware, webhooks | Flag, core production | development | production |
| PORT | Next start; backend/src/server.ts and config/app.config.ts | Infrastructure, optional | Frontend 3000; backend 4000 | Match each container's exposed port; need not match another host |
| DATABASE_URL | backend/prisma/schema.prisma; config/database.config.ts; config/validate-env.ts | Secret, core required | Intended development database | Same production resource/value as Render |
| DIRECT_URL | backend/prisma/schema.prisma; scripts/deploy-crm-imports.cjs | Secret, deployment required | Development migration connection | Same production migration connection as Render |
| JWT_SECRET | backend/src/config/app.config.ts; core/auth/jwt.service.ts; api/middleware/auth.middleware.ts | Secret, core required | Local secret may differ | Preserve Render secret and existing sessions |
| APP_URL | backend/src/config/validate-env.ts; core/auth/password-reset.service.ts; shared/services/email.service.ts; integrations/gmail/gmail.controller.ts | Public URL, core required in production | `http://localhost:3000` | Exact HTTPS frontend origin; no login path |
| ALLOWED_ORIGINS | backend/src/app.ts; config/validate-env.ts | Public origins, core required in production | `http://localhost:3000` | Explicit HTTPS frontend origins; no wildcard |
| TRUSTED_PROXIES | backend/src/app.ts | Network policy, infrastructure required behind ingress | loopback default | Verified proxy addresses/CIDRs only; never blanket trust |
| RATE_LIMIT_MAX | backend/src/api/middleware/rate-limit.middleware.ts | Number, optional | Development limit is 10000 | Default general limit 500/minute; separate auth/reset limits remain |
| ENCRYPTION_KEY | backend/src/core/encryption/crypto.service.ts; integrations/gmail/gmail.oauth.ts | Secret, Gmail feature required | Local integration key | Preserve Render value for encrypted persisted OAuth tokens |
| BREVO_API_KEY | backend/src/shared/services/email.service.ts; config/validate-env.ts | Secret, core required in production | Required for real reset delivery | Exact Render key; authorize the new server IP at Brevo |
| BREVO_FROM_EMAIL | backend/src/shared/services/email.service.ts; modules/marketing/campaigns/campaigns.service.ts; config/validate-env.ts | Sender identity, core required in production | Verified test sender for real mail | Existing verified Render sender |
| BREVO_FROM_NAME | backend/src/shared/services/email.service.ts; modules/marketing/campaigns/campaigns.service.ts | Sender label, optional | Default LeadCRM | Preserve Render display name |
| BREVO_SANDBOX_EMAILS | backend/src/shared/services/email.service.ts; modules/marketing/campaigns/audiences.service.ts | Private allowlist, optional | Restricts email recipients when supplied | Ignored in production; do not copy development restrictions |
| BREVO_DAILY_EMAIL_LIMIT | backend/src/modules/marketing/campaigns/campaigns.service.ts | Number, optional | Default 300 | Provider-plan capacity; default 300 |
| BREVO_WEBHOOK_TOKEN | backend/src/modules/marketing/campaigns/brevo-webhook.ts | Secret, delivery webhook required | Feature only | Preserve token and provider authorization header |
| PASSWORD_RESET_TTL_MINUTES | backend/src/core/auth/password-reset.service.ts | Number, optional | Default 60 | Preserve policy; default 60 |
| GMAIL_CLIENT_ID | backend/src/config/mail.config.ts; integrations/gmail/gmail.oauth.ts | OAuth client identity, Gmail required | Development client or approved shared client | Preserve Render client |
| GMAIL_CLIENT_SECRET | backend/src/config/mail.config.ts; integrations/gmail/gmail.oauth.ts | Secret, Gmail required | Development credentials | Preserve Render credential |
| GMAIL_REDIRECT_URI | backend/src/config/mail.config.ts; integrations/gmail/gmail.oauth.ts | Public URL, Gmail required | Local backend callback registered in Google | Verified API `/api/v1/integrations/gmail/callback`; register exact URI in Google |
| GMAIL_SYNC_INTERVAL_SECONDS | backend/src/integrations/gmail/mailbox-sync.service.ts; config/validate-env.ts | Number, optional; integer 60–3600 | Default 60 | Default 60; one leased incremental sync per mailbox, independent of browser tabs |
| GMAIL_TEST_MAILBOX_OVERRIDE | backend/src/config/mail.config.ts; integrations/gmail/mailbox-ownership.ts | Private JSON, optional | Exact temporary mailbox exception only | Preserve a deliberate existing exception; expired/invalid JSON grants no access |
| GMAIL_SYSTEM_SENDER_USER_ID | backend/src/integrations/gmail/gmail.service.ts | Private account identifier, feature required for system sender | Existing connected account if used | Same stored production account |
| GMAIL_SYSTEM_SENDER_GMAIL_EMAIL | backend/src/integrations/gmail/gmail.service.ts | Legacy system sender identity, optional | Actual connected sender when used; display name Camxian Technologies | Preserve the authorized mailbox identity; no invented default |
| SMTP_FROM | backend/src/integrations/gmail/gmail.service.ts | Explicit legacy system sender header, optional | Must belong to the connected system mailbox | Preserve if configured; does not enable SMTP transport. Staff Inbox sends always use their own connected mailbox |
| TEXTBEE_API_KEY | backend/src/shared/services/sms.service.ts | Secret, SMS feature required | Test sending only when authorized | Exact existing Render key |
| TEXTBEE_DEVICE_ID | backend/src/shared/services/sms.service.ts; modules/marketing/campaigns/textbee-webhook.ts | Device identifier, optional | Empty uses provider default | Preserve selected production device |
| TEXTBEE_WEBHOOK_SECRET | backend/src/modules/marketing/campaigns/textbee-webhook.ts | Secret, delivery webhook required | Signed delivery events only | Preserve signature secret; update provider URL; inbound SMS remains disabled |
| SUPABASE_URL | backend/src/core/auth/profile.service.ts; modules/crm/record-files/record-files.service.ts | Resource URL, storage feature required | Development storage | Same existing production storage |
| SUPABASE_SERVICE_ROLE_KEY | backend/src/core/auth/profile.service.ts; modules/crm/record-files/record-files.service.ts | Secret, storage feature required | Development storage credential | Exact Render credential; never expose to frontend |
| SUPABASE_AVATAR_BUCKET | backend/src/core/auth/profile.service.ts | Resource name, avatar feature required | Existing development bucket | Existing production bucket; no new bucket |
| SUPABASE_RECORD_FILES_BUCKET | backend/src/modules/crm/record-files/record-files.service.ts | Resource name, CRM files feature required | Existing development bucket | Existing production bucket; no new bucket |
| LEADCRM_TEST_AUTH_ENABLED | backend/src/core/auth/account-access.ts | Access policy, optional | Explicit development Gmail exception | Ignored in production; set false |
| LEADCRM_TEST_EMAIL_ALLOWLIST | backend/src/core/auth/account-access.ts | Private access policy, optional | Exact approved Gmail addresses only | Ignored in production |
| LEADCRM_PRODUCTION_AUTH_ENABLED | backend/src/core/auth/account-access.ts | Access policy, feature required for approved Gmail accounts | Ignored outside production | Preserve explicit approved Render policy |
| LEADCRM_PRODUCTION_EMAIL_ALLOWLIST | backend/src/core/auth/account-access.ts | Private access policy, feature required for approved Gmail accounts | Ignored outside production | Preserve exact approved Render allowlist; never broaden |
| SOURCE_COMMIT | backend/src/api/routes/index.ts | Public release metadata, optional | Normally absent | Coolify-injected full deployed SHA |
| RENDER_GIT_COMMIT | backend/src/api/routes/index.ts | Public release metadata, optional | Normally absent | Render-injected SHA; fallback when SOURCE_COMMIT absent |

`SKIP_DEMO_TENANTS=true` remains the requested hosting convention. There is no
active runtime consumer; startup does not seed accounts. `GOOGLE_OAUTH_CLIENT_ID`
is read into an unused legacy appConfig property and enables no login capability.
`DEMO_USER_PASSWORD` appears only in an unrouted legacy controller. Neither is a
production requirement. `NEXT_PUBLIC_API_URL` is no longer consumed.

Retired local/hosting names such as SYSTEM_ADMIN_*, DEV_OTP_BYPASS, DEMO_MODE,
DEV_SEED_EMAILS, RESEND_*, GOOGLE_OAUTH_CLIENT_SECRET, NEXTAUTH_*, GOOGLE_CLIENT_*,
STRIPE_*, ADMIN_BILLING_BYPASS_ENABLED, UNISMS_*, FRONTEND_URL and BACKEND_URL
must not be treated as current requirements. Legacy stored values were not rotated
or repurposed. Gmail setup-script access/refresh tokens and expiry are not runtime
requirements; connected credentials live encrypted in the database. CRM_*_VERIFY_*
values belong only to separately invoked migration verification/retirement commands,
not normal production startup. Test fixtures and disposable scripts are excluded.

The examples retain clearly marked legacy local keys with empty placeholders so
local environment files can share the same key inventory without discarding old
credentials. They are not additional hosting requirements. Preserve secret values
and environment-specific URLs; matching templates does not mean copying secrets
into examples or copying production resources into development.

## Inbox synchronization without Pub/Sub

The Inbox uses server-owned Gmail History checks. No Google Cloud Pub/Sub topic,
subscription, service account, IAM grant, push endpoint, or `users.watch` is needed.
Do not configure `GMAIL_PUBSUB_*` variables. See the
[Inbox implementation and acceptance report](../inbox-redesign-report.md).

Set `GMAIL_SYNC_INTERVAL_SECONDS=60` in backend runtime configuration. Every ten
seconds the persistent backend worker discovers due work; an individual mailbox
with completed history waits at least the configured interval. Continuation pages,
new connections, assignment changes and explicit Sync now requests can run sooner.
Database leases prevent replicas from synchronizing the same mailbox concurrently;
provider cooldowns and persisted retry deadlines take precedence. At normal load,
new mail appears after the next check plus processing and SSE delivery time. This
is periodic synchronization, not instantaneous provider push.

The same backend process checks persisted scheduled sends every ten seconds.
Keep the existing migration-before-start command above. There is no extra cron
service or separate queue subscription. Startup logs include `[mailbox-worker]`
with the interval, and each bounded sync reports counts and duration without email
content. Saved configuration only takes effect after the reviewed code is deployed
and the service starts with the forward migration applied.

List/search/thread/count endpoints read scoped database rows. The authenticated
same-origin SSE endpoint observes database revisions; it never requests Gmail.
Keep response streaming enabled through the proxy. The stream reauthenticates on
reconnect, and the list stays visible while background updates arrive.

Dashboard also streams `/api/proxy/reporting/dashboard/events` and
`/api/proxy/auth/events`. Preserve `text/event-stream`, `Cache-Control: no-store,
no-transform`, and `X-Accel-Buffering: no`; disable response buffering and keep
proxy idle timeouts above the 45-second stream lifetime (heartbeats every three
seconds). Native reconnect retrieves committed database revisions; no sticky
sessions or additional WebSocket host is required. Deploy the additive
`20261115000000_dashboard_revisions` migration before starting this Dashboard
revision. Use the existing deployment runner and record its ledger result.
Verify two authenticated users, permission revocation/restoration and recovery
through the deployed proxy before claiming live Dashboard readiness.

NIXPACKS_NODE_VERSION and RAILPACK_NODE_VERSION are hosting build controls,
not application runtime configuration. Keep the configured Node version compatible
with the root package.json engines and pinned package manager.

## Release verification and rollback

1. Compare active production secrets privately with Render. Preserve JWT,
   encryption, database, provider and storage identities. Record status only.
2. Verify DNS/TLS before configuring URLs; configure build/runtime variables and
   commands, then redeploy both applications from the same reviewed full SHA.
3. Confirm `/health` and `/api/proxy/health`, including backend release metadata.
4. Test anonymous `/auth/me` (401), approved login, HttpOnly Secure SameSite=Lax
   Path=/ cookie, authenticated `/auth/me` (200), refresh, logout and anonymous 401.
5. Submit one password reset after the email provider is ready. Verify actual
   provider submission and the received link's frontend origin without logging tokens.
6. Check Gmail, TextBee and Brevo callbacks. Leave inbound SMS disabled.
7. Suspend the Render runtime after Coolify acceptance to avoid duplicate recurring
   jobs against one database. Keep Render configuration as rollback. Stop Coolify
   before resuming Render; never leave both scheduler sets active permanently.

Use the existing phased `db:deploy` runner. Do not replace it with migrate reset,
db push, migrate dev, or an unreviewed bare migrate deploy. Record which migrations
actually execute. A health response alone does not prove database migration state.

Provider rejection and transport failure are distinct: backend Brevo rejection
returns its 502 response, while an unreachable backend returns
`PROXY_UPSTREAM_UNREACHABLE`. Missing API_URL returns a configuration error.
Never disable required mail submission or password-reset rate limiting to hide
provider failures.

References: [Coolify variables](https://coolify.io/docs/applications/configuration/environment-variables),
[Coolify health checks](https://coolify.io/docs/applications/configuration/health-checks),
[Brevo IP authorization](https://help.brevo.com/hc/en-us/articles/5740111683858-Authorize-and-block-IP-addresses-for-API-and-SMTP-security).
