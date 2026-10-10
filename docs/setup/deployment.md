# Internal CRM deployment update

For the Hostinger/Coolify deployment and the source-derived variable contract,
see [Coolify production configuration](coolify-production.md). `API_URL` is now
the only server-side backend authority; `NEXT_PUBLIC_API_URL` is not consumed.

Deploy the backend and frontend from the same reviewed revision. A successful Vercel frontend deployment does not deploy Render. The Vercel server-only `API_URL` must target that backend's `/api/v1`; keep production mock flags disabled. Use the root workspace lockfile, `render.yaml` build/start commands, and confirm required migrations are applied before accepting traffic. Do not reset or drop historical data.

Before accepting a release, run this read-only check with the intended full Git SHA:

```powershell
node scripts/verify-deployment.cjs https://lead-crm-frontend-pi.vercel.app <expected-full-git-sha>
```

The check reads `/api/proxy/health`, so it verifies the backend actually selected by Vercel. A 404 HTML response from `PATCH /api/proxy/auth/environment` with a matched proxy route indicates a missing upstream route; check backend revision and `API_URL` before changing authentication or dataset logic. Current backend unauthenticated environment requests are rejected by authentication, not by a missing route.

Service worker updates bypass the browser HTTP cache and are checked on load and when returning to a visible tab. Version changes purge older LeadCRM asset caches and offer a refresh after saving work. API/RSC responses are never cached by the worker. An already-open application remains its loaded version until refreshed.

While canonical relationship retirement is deferred, `db:deploy` applies the reviewed independent migrations `20261103000000_reply_engagement_deal_batches` and `20261104000000_user_first_login_onboarding` without running `20261102000000_retire_relationship_compatibility`. Existing relationship columns and bridges remain intact. Unknown later migrations stop deployment for dependency review; the separate authenticated retirement command is unchanged.

The independent migration list also includes `20261105000000_module_custom_fields` and additive `20261106000000_campaign_sms_snapshots`. The SMS migration adds nullable phone/submission/provider timestamps without depending on relationship retirement. Configure UniSMS backend variables and its webhook as described in [Campaigns deployment notes](../campaign-sms-improvements.md).

Apply `20260919000000_internal_accounts` before deploying the new backend. Public signup, Google account authentication, OTP, subscriptions, pricing, and SaaS billing are retired. Gmail integration credentials remain separate. Follow [current authentication deployment requirements](../authentication.md#deployment). The older rollout notes below are historical.

# Running LeadCRM locally and on Vercel / Render

LeadCRM is an npm-workspace monorepo. The Next.js frontend and Express backend
both depend on shared source under `shared/`. Keep the repository root lockfile.

## Local development

1. Run `npx --yes npm@11.19.1 ci` from the repository root. The pinned npm release correctly applies workspace security overrides.
2. Copy `backend/.env.example` to `backend/.env` and
   `frontend/.env.example` to `frontend/.env.local`; supply your own credentials.
   Existing configured files do not need to be replaced.
3. Configure DATABASE_URL and DIRECT_URL for the intended database. The direct
   connection (or session pooler) is used for migrations; the runtime URL can use
   a transaction pooler with the provider's recommended parameters.
4. With the backend stopped, run `npm --prefix backend run db:generate`.
5. Review pending migrations, then run `npm --prefix backend run db:deploy`
   against the intended database. This applies committed migrations and does not
   run the legacy onboarding data repair.
6. Run `npm run dev` from the root. Open http://localhost:3000.
   Backend health is http://localhost:4000/health.

Local backend settings include APP_URL=http://localhost:3000 and
ALLOWED_ORIGINS=http://localhost:3000. The frontend's server-only API_URL must be
http://localhost:4000/api/v1. Production build/start requires an explicit HTTPS
API_URL ending in /api/v1. NEXT_PUBLIC_API_URL is not a fallback.

Use NEXT_PUBLIC_USE_MOCK_AUTH=false and NEXT_PUBLIC_USE_MOCK_DATA=false to verify
real password authentication. Gmail connection credentials are configured only on the backend; see the work email OAuth section below.

### Build output isolation

Next development writes to `frontend/.next-dev`; production build/start use
`frontend/.next`. Running a frontend production build while dev is active no
longer overwrites the development manifest and chunks. Production keeps the
standard Next.js output directory expected by hosting platforms.
See [Next.js distDir](https://nextjs.org/docs/app/api-reference/config/next-config-js/distDir).

On Windows, stop the backend before regenerating Prisma Client: the running
process can lock query_engine-windows.dll.node. Do not kill every Node process.
A stale Next.js process must also be stopped before starting another on port 3000.

For a full production build, stop the dev servers and run `npm run build`.
For a frontend-only build, run `npm --prefix frontend run build`.
Google Fonts are downloaded by next/font during compilation, so the build needs
outbound HTTPS access.

## Render backend

Use the repository's `render.yaml`, or configure equivalent settings:

| Setting | Value |
| --- | --- |
| Root directory | Repository root (leave blank) |
| Build command | `npx --yes npm@11.19.1 ci --include=dev && npm --prefix backend run build` |
| Start command | `npm --prefix backend run db:deploy && npm --prefix backend start` |
| Health check | `/health` |
| NODE_ENV | `production` |
| SKIP_DEMO_TENANTS | `true` |

`db:deploy` uses the phased CRM import migration runner. It applies expansion
before startup and defers legacy-table retirement until the deployed import APIs
have been verified. Do not substitute `npx prisma migrate deploy` in Render's
saved commands: that attempts retirement before the new server can start.
See [CRM import rollout and recovery](../csv-import-normalization.md).

If the retirement migration failed during an older Render build, run
`npm --prefix backend run db:imports:recover` once. Recovery checks migration
checksums (allowing Git's LF/CRLF difference), retained source tables, write
guards and exact historical payloads before marking that failed attempt rolled
back through Prisma. It never marks unexecuted SQL as applied. Then deploy with
the commands above. Unrelated failed migrations remain blocking errors.

Do not set rootDir to backend: the compilation needs ../shared, tsconfig.base.json,
and the workspace lockfile. Files outside a Render root directory are unavailable
to that service. See [Render monorepo support](https://render.com/docs/monorepo-support).

The build generates Prisma Client, compiles backend plus shared TypeScript, and
copies the existing production launcher. npm start uses dist/start.js so
@leadcrm/shared resolves to compiled JavaScript rather than source TypeScript.
Dependency installation runs once in the hosting install/build command.

Configure these secrets and settings in Render, not in committed files:

- DATABASE_URL and DIRECT_URL for the production database.
- JWT_SECRET: a strong unique secret.
- APP_URL: the exact public frontend origin.
- ALLOWED_ORIGINS: comma-separated permitted frontend origins; do not use * with cookies.
- BREVO_API_KEY and BREVO_FROM_EMAIL; BREVO_FROM_NAME if desired.
  The existing production server requires a valid Brevo configuration.
- GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REDIRECT_URI for work email.

Render provides PORT; the backend reads it. Startup does not seed accounts or reset passwords.

Before updating an existing Render service, correct its saved Root Directory and
commands too: committing a Blueprint does not guarantee that a manually configured
service adopts it. Review migrations before deployment; do not baseline/reset a
database or run the historical onboarding repair automatically.

## Vercel frontend

Create/import a Next.js project with Root Directory `frontend`.
Enable **Include source files outside of the Root Directory in the Build Step**
so the build can read `shared/` and the repository workspace files.
Use the workspace-root install (`npx --yes npm@11.19.1 ci`, or `cd .. && npx --yes npm@11.19.1 ci` when overriding
a command that Vercel runs inside frontend), build with `npm run build`, and
leave Output Directory at the Next.js default.
See [Vercel monorepo settings](https://vercel.com/docs/monorepos/monorepo-faq).

| Variable | Value |
| --- | --- |
| API_URL | https://your-backend.onrender.com/api/v1 |
| NEXT_PUBLIC_USE_MOCK_AUTH | false |
| NEXT_PUBLIC_USE_MOCK_DATA | false |

Use the appropriate environment values for preview and production deployments.
Redeploy after changing build-time NEXT_PUBLIC variables. Keep secrets out of
next.config's env object; that object embeds values into bundles.

The browser sends API requests to same-origin /api/proxy; Next.js forwards the
LeadCRM session cookie to Render. This avoids depending on third-party browser
cookies. AuthGuard controls page navigation; backend middleware enforces access.

## Work email OAuth

Configure the Google authorized redirect URI to match backend `GMAIL_REDIRECT_URI`, normally `https://your-backend.onrender.com/api/v1/integrations/gmail/callback`. Gmail uses `EmailAccount` and one-time mailbox connection state; it does not authenticate application users.

## Release smoke checks

- / and /login render successfully in the browser.
- Backend /health returns 200.
- An anonymous /api/proxy/auth/me request returns 401 JSON, not HTML/500.
- Public signup and Google account provisioning are disabled. Client Admin selects custom roles for users.
- Password login, password recovery, session restoration, logout and Client Admin onboarding follow [authentication](../authentication.md).
- Confirm Render can read the migrated schema and that real Google/email
  credentials work. A local build alone does not prove hosted deployment success.

## September 18 local repair

The local frontend was returning bare HTTP 500 after production and development
compilers had used the same output directory. Separating the outputs and restarting
the affected dev tree restored HTTP 200. Prisma generation succeeded once that
backend process released its Windows DLL.

A read-only check also found the configured Supabase database lacked Tenant.website.
With user approval, only the pending 20260917000000_tenant_company_website migration
was applied. It adds a nullable column; no historical role/onboarding repair was run.
