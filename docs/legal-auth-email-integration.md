# Legal pages and authentication email integration

Implementation and verification date: October 9, 2026 (Asia/Manila).

This report records local validation before Git publication and Coolify release
reconciliation. Deployment results are tracked separately as release evidence.
The legal documents remain visibly marked as organizational review drafts with `noindex`.
The supplied text itself requires final operational verification before publication.

## Audit and resulting behavior

| Item | Existing behavior | Implemented behavior |
| --- | --- | --- |
| Privacy Policy | `/privacy-policy` used a browser-only generic policy with invented contacts and unrelated SaaS disclosures. Authentication emails linked to missing `/privacy`. | Server-rendered `/privacy-policy` contains all 17 supplied sections. |
| Terms of Service | No route; authentication emails linked to missing `/terms`. | Server-rendered `/terms-of-service` contains all 20 supplied sections. |
| Help Center | `/help` existed inside the protected tenant layout. | The existing home, category, article and not-found views are now public under `/help`. Signed-out visitors receive help content alone; restored signed-in users receive the existing CRM sidebar/top bar and theme. Other CRM routes retain `AuthGuard`. `/support` remains a public entry page linking to these guides. |
| Authentication emails | Decorative outer background, centered reset content, inline SVG, hardcoded 60-minute notice, old support contact. | Shared table-based layout follows the supplied screenshots: centered existing branding, white background, left-aligned body, solid blue CTA, information boxes, separators and pale footer. |
| Support contact | Reset email displayed `support@leadcrm.io`. | Both affected templates display and link `mailto:leadcrm.tech@gmail.com`. |
| Destinations | Footer used `/privacy`, `/terms`, `/help`; URL interpolation depended on raw `APP_URL`. | Footer uses `/privacy-policy`, `/terms-of-service`, `/help` on validated configured `APP_URL`. Login uses `/login`; recovery uses `/reset-password?token=...`. |
| Token notice | Token lifetime was configured, but the notice always said 60 minutes. | The token lifetime and email notice use the same validated `PASSWORD_RESET_TTL_MINUTES` setting, default 60. |

The later authentication redesign brief explicitly asks to replace the two
reference layouts; it takes precedence over the earlier brief's request to retain
their bodies. Legal/footer integration requirements apply to the resulting layout.

The Brevo transport, sender configuration, receipt tags, tracking behavior,
account provisioning and onboarding contracts remain in use. No provider tracking
redirect is hardcoded. Only the password-reset and administrator-created welcome
templates were replaced; the older unused workspace-welcome builder is unchanged.

## Document provenance and changes for review

The owner supplied a complete Privacy Policy and Terms of Service. Each document
has one version-controlled content source under
`frontend/src/features/tenant/legal/content/`. Structured JSON retains paragraphs,
subheadings, ordered lists and all numbered sections; React escapes the text.
No markdown engine, CMS or user-supplied HTML is involved.

The requested corrections are incorporated as follows:

- Terms introduction: explicitly describes an external student capstone team.
- Terms section 2: distinguishes Camxian's operations, account administration,
  policies and legal/privacy responsibilities from the student team's authorized
  development/assistance role. Students are separate from Camxian employees and
  do not automatically own company records or act as the DPO.
- Terms section 13: maintenance by the team requires express permission.
- Terms section 20 and document information: uses “LeadCRM Development Team
  (Student Capstone Project)”.
- The existing intellectual-property clause remains: ownership is subject to
  applicable employment, development, licensing and other agreements. No source
  code ownership is assigned by this implementation.
- Privacy sections 11 and 17: use the owner-confirmed organizational request
  channel `leadcrm.tech@gmail.com`. The unverified personal designation and
  `[To be confirmed]` placeholder are removed; no person receives a DPO title.
- Document headings/footer: use the requested student capstone attribution and
  supplied address: `180 Dr. Sixto Ave. Bgy Caniogan, Pasig City, Metro Manila`.
- The owner confirmed the supplied dates/address and organizational contact in
  this chat. Privacy effective date: September 23, 2026; updated: October 9, 2026.
  Terms effective date: October 9, 2026.

The original substantive provisions on processing, retention, rights, cookies,
communications, international processing, breach handling and permitted system
use remain. The supplied prepublication qualifications are deliberately retained.

## Remaining organizational decisions before final publication

Confirmation of a contact, dates and address does not supply the missing operational
details requested by the source policy. Camxian should approve the final document
and provide or explicitly approve these facts:

1. Retention periods or objective criteria for leads, customers, correspondence,
   campaign engagement, accounts, audit/security logs, archives and backups,
   together with actual disposal procedures. Section 8 requires a schedule.
2. Actual production service-provider categories, arrangements and safeguards.
   Code integrations identify Brevo, connected Gmail accounts, PostgreSQL and
   Supabase storage; deployment uses Coolify. Code alone does not establish every
   enabled production processor, contract or processing location.
3. Production processing locations and cross-border transfer safeguards. Sections
   6 and 7 require verification against actual services and agreements.
4. Documented lawful bases for each processing activity, including marketing
   consent/preferences, suppression and opt-out handling.
5. Operational request verification, response/escalation, deletion/retention and
   breach-notification procedures, and authorized handlers behind the confirmed
   privacy channel.
6. Actual security/logging/session/tracking practices in the serving release,
   including connected providers and any public-page/form tracking.

These facts were not invented. `LEGAL_REVIEW_PENDING` should be removed only after
the reviewed content accurately reflects the approved operations. The draft banner
and metadata are controlled in `legal-documents.ts`.

## Sender and authentication security audit

The user specifies `reymarkjpanes@12066156.brevosend.com` as the authentication
sender and `leadcrm.tech@gmail.com` as support. Those identities serve different
purposes. `sendMail` continues to use `BREVO_FROM_EMAIL`/`BREVO_FROM_NAME`.
The local backend environment currently has `reymarkjpanes@gmail.com` as its
configured sender, and `http://localhost:3000` as `APP_URL`; it is a development
configuration. No local or production sender setting was silently changed. The
production sender and `APP_URL=https://lead-crm.tech` must be checked in Coolify.

Recovery audit and automated tests confirm 32 random bytes, configured expiration,
account-specific supersession, rejection of invalid/expired links, token deletion
on successful reset, password hashing and session revocation. Rendering rejects
foreign origins, credential-bearing URLs, unexpected reset paths/parameters and
invalid production origins without echoing a reset URL in errors. Email submission
logs contain provider outcome metadata rather than HTML, passwords or tokens.

Welcome compatibility requires the existing temporary credential: there is no
single-use activation-link flow to substitute safely. Account provisioning stores
a bcrypt hash, sets `mustChangePassword`, and emails the escaped credential only in
the existing outgoing message. Forced password change and onboarding remain tested.

Separate existing security concerns require follow-up before claiming readiness:

- Temporary passwords are derived from normalized names plus two random digits,
  leaving only 100 suffix possibilities for a known name.
- No temporary-password expiry field/control was found. Forced password change
  applies after sign-in, but does not expire an unused credential.
- Recovery tokens currently remain readable in the database. Token hashing and
  an activation-link migration require a separately reviewed authentication change.

This task did not silently alter those credential/onboarding contracts.

## Files

| Area | Files |
| --- | --- |
| Thin public routes | `frontend/app/privacy-policy/page.tsx`, `frontend/app/terms-of-service/page.tsx`, `frontend/app/support/page.tsx` |
| Public Help Center | `frontend/app/help/`; existing domain content/UI under `frontend/src/features/tenant/help/`, with conditional `ui/help-layout.tsx` |
| Document content and rendering | `frontend/src/features/tenant/legal/legal-documents.ts`, `content/privacy-policy.json`, `content/terms-of-service.json`, `legal-document-page.tsx`, `public-document-layout.tsx`, `public-support-page.tsx` |
| Removed generic source | `frontend/src/features/tenant/pages/privacy-policy.tsx` |
| Shared auth email layout | `backend/src/shared/services/auth-email.templates.ts`; existing `email.service.ts` re-exports the builders |
| Public destination and lifetime helper | `backend/src/shared/helpers/auth-email-config.ts` |
| Recovery integration | `backend/src/core/auth/password-reset.service.ts` |
| Email-safe existing Lucide icons | `frontend/public/email/clock.png`, `frontend/public/email/shield-check.png` |
| Template/document tests | `auth-email.templates.test.ts`, `legal-document-page.test.tsx` |
| Existing regression tests updated | `email.service.test.ts`, `account-email-regression.test.ts`, `first-login.integration.test.ts`, `security.integration.test.ts` |

## Original integration verification evidence

| Check | Result and proof boundary |
| --- | --- |
| Full workspace lint | `npm run lint`: all three workspaces passed. |
| Production build | All three workspaces passed. The local HTTP API setting is intentionally rejected by the existing production guard, so validation used temporary `API_URL=https://backend.example.com/api/v1` only for the build process. No saved configuration changed. This proves compilation and prerendering, not production API connectivity. |
| Focused backend tests | 82 distinct tests passed across template, transport, account-email, welcome-credential, first-login and security suites. Delivery is mocked; integration suites use disposable PGlite/PostgreSQL protocol fixtures. |
| Focused frontend tests | 21 tests passed across document rendering, auth guard lifecycle, login integration and auth entry suites. |
| Anonymous public routes | 36 browser checks passed: `/privacy-policy`, `/terms-of-service`, `/support` at 320, 375, 390, 430, 768 and 1440 pixels, with JavaScript enabled and disabled. HTTP 200, one H1, canonical metadata and complete document sections verified. No horizontal overflow. |
| Account states | 12 browser checks passed across the three public routes with simulated staff, Client Admin, password-change-required and onboarding-required auth responses. No setup/login redirect. These are controlled frontend fixtures, not real production accounts. |
| Rendered email layout | 24 browser checks passed across both templates at 320, 375, 390, 430, 512 and 1024 pixels in light/dark browser preferences. Existing logo and PNG icons loaded; no horizontal overflow. The email intentionally uses a light scheme. This does not verify a mail client's automatic dark-mode transformations. |
| Footer interactions | All six generated-email footer clicks passed against intercepted local routes for the production URLs. The welcome Login CTA and reset CTA also opened the existing local routes. The reset token in previews is synthetic and was not submitted. |
| Help Center access | The original protected-help check is superseded by the public-access follow-up below. Existing guide content/search is reused; only Help Center routes leave the protected tenant group. |
| Browser errors | No uncaught page errors in the recorded public-route pass. Auth reads were controlled fixtures; this is not a claim about production console/backend logs. |
| Accessibility | One H1, semantic numbered sections, lists, linked contacts, focus styles and wrapping verified. Mobile headers were visually inspected; both keyboard skip links worked with JavaScript disabled. |
| Content/escaping | All numbered source sections, requested company/address/developer corrections, absence of published placeholders and safe text/credential escaping passed focused tests. |
| Git hygiene | `git diff --check` passed. Screenshots, rendered synthetic emails and browser scripts/evidence are outside the repository. No commit or push was performed. |

The two older authentication integration fixtures initially stopped at the newer
Lead-form retirement guard. They were updated only in their disposable test
databases to record the matching contract marker; production SQL and deployment
guards were not modified. A later run under concurrent build load hit the default
5-second timeout in two first-login tests. An isolated rerun with
`--testTimeout=20000` passed all 12 tests. Windows sandbox filesystem restrictions
also required approved retries for test caches, Next.js, Turborepo and headless Edge.

Screenshots and detailed evidence are saved under:

`C:\Users\Julie Ann Tiron\.codex\visualizations\2026\10\09\01a12090-2243-7540-95fd-d5e2c5965725`

Notable artifacts (the public-access follow-up below supersedes the older Help Center/footer records):

- `browser-evidence.json`: original legal/email viewport/state/footer records.
- `public-help-evidence.json`: current public/signed-in Help Center, protected-route and email-footer records.
- `email-preview-evidence.json`: successful focused email/footer rerun after browser route cleanup was corrected.
- `reset-email-512.png`, `welcome-email-512.png`: final desktop previews.
- `reset-email-320.png`, `welcome-email-320.png`: final mobile previews.
- `privacy-policy-320-top.png`, `terms-of-service-320-top.png`: mobile document headers.
- `privacy-policy-1440.png`, `terms-of-service-1440.png`: complete desktop documents.
- `support-320.png`: public support entry page.
- `reset-email.html`, `welcome-email.html`: actual generated HTML with synthetic credentials.

Visual inspection confirms the centered existing mark/wordmark and company subtitle,
white email surface, left-aligned copy, solid rounded CTA, pale security box,
rounded welcome credential box, clock/shield icons and restrained footer.
The required legal links and small developer attribution add footer height compared
with the screenshots. Actual production reset URLs may wrap over more lines than
the short example token shown in the reference. No claim of pixel identity is made.

## Public Help Center and reset preview follow-up

The requested white space below the reset footer came from the browser screenshot's
fixed 1,000-pixel canvas. The generated HTML already ends at the footer and contains
no bottom spacer or fixed/minimum content height. Reset and welcome previews now
capture the intrinsic email table bounds, so the image ends at the footer. The
footer's internal padding is retained. No CSS height workaround is applied to the
delivered template.

Help Center route shells move from `frontend/app/(tenant)/help/` to
`frontend/app/help/`. The Help-only layout renders guides immediately while session
state is restoring or unavailable. Once a user is restored, it adds the existing
`CrmLayout`; help content itself requires neither CRM data nor permissions. All
other tenant routes retain the existing authentication, password-change,
onboarding, tenant and module-access boundaries. Email and public-document Help
Center links now point directly to `/help`. The query-aware Help home renders on
the server rather than a client-only Suspense fallback, so browsing also works
with JavaScript disabled. Interactive search still requires JavaScript.

Focused follow-up checks passed: 45 frontend tests across Help Center content/search,
conditional layout, legal rendering and authentication lifecycle/login suites;
26 backend email-template/account-email regression tests. Backend TypeScript lint
and the production frontend build passed. The build includes all 123 article
and 14 category paths. An initial build failed on an obsolete generated
`.next-dev/types/app/(tenant)/help/page.ts` entry; only that cache file was removed,
then the build passed. The same temporary build-only HTTPS API setting described
above was used.

Follow-up browser evidence:

| Check | Result and proof boundary |
| --- | --- |
| Anonymous Help Center | 36 checks passed across home, Getting Started category and welcome article at 320, 375, 390, 430, 768 and 1440 pixels, with JavaScript enabled/disabled. HTTP 200, guide headings, absence of CRM sidebar/top bar, and no horizontal overflow verified. Before interaction checks, the only anonymous API read was `/auth/me`. |
| Signed-in Help Center | 36 checks passed across the same three routes at 320, 768 and 1440 pixels, using simulated staff, Client Admin, password-change-required and onboarding-required users. Existing sidebar/top bar rendered; guides stayed accessible and had no horizontal overflow. Unrelated CRM API calls returned controlled 503 responses; these checks do not prove CRM backend connectivity or production accounts. |
| Session unavailable | All three Help routes remained public at 390 pixels with a controlled 503 session response. |
| Protected CRM routes | Signed-out `/dashboard` redirected to `/login`; password-change-required and onboarding-required fixtures still redirected to `/change-password` and `/onboarding`, respectively. Authentication and module guards were not edited. |
| Interactions | Anonymous role-guide search, article opening, breadcrumb return, public support entry and signed-in mobile sidebar open/close passed. Unknown articles displayed the existing public guide-not-found view. |
| Reset preview bounds | Desktop PNG is 512 × 857 and mobile PNG is 320 × 965. In both cases the email table ends at the footer, with zero table height below it. Both templates also fit at 320/512 pixels with loaded images. |
| Email Help links | Four clicks across reset/welcome previews at 320/512 pixels opened public `/help` with no CRM shell. Production URLs were intercepted to the local frontend; no email was sent. |
| Browser errors and cleanup | Observed anonymous/signed-in Help contexts recorded no uncaught page errors. The first full harness completed its assertions but exited with an in-flight intercepted request error during browser teardown. The harness now waits for network idle and route callbacks before closing. A focused rerun of the four affected email/footer cases exited successfully. |

Visual review confirmed the public mobile guides have no CRM navigation, the
signed-in desktop view retains the existing sidebar/top bar, and the reset preview
ends at the pale footer without the earlier blank canvas. Evidence screenshots
include `help-public-category-320.png`, `help-public-category-1440.png`,
`help-signed-in-category-320.png` and `help-signed-in-category-1440.png`. Signed-in
screenshots can show a data-load toast from the intentionally unavailable fixture
backend; no product error was hidden for those captures.

## Live and delivered-email limits

Read-only checks before this release of `https://lead-crm.tech` returned:

| Path | HTTP result |
| --- | --- |
| `/privacy-policy` | 200; the response did not contain the newly supplied text/student attribution in server HTML. A status alone does not verify the new policy content. |
| `/terms-of-service` | 404 |
| `/support` | 404 |
| `/help` | 200 HTML; the protected route's browser guard is separate from this HTTP response. |
| `/login` | 200 |
| `/reset-password` | 200 without submitting a token/password |

During the local implementation audit, no Coolify deployment or configuration mutation occurred. Production sender,
APP_URL, serving commit, backend logs and authenticated workflow acceptance were
not inspected. I cannot confirm this production integration.

No controlled recipient was authorized: the owner clarified the sender/support
identities instead. No real welcome/reset message was sent. Gmail web/mobile,
Outlook, Apple Mail, real support-mail-client launching, Brevo click-tracking
redirects, delivered-logo availability and real inbox placement remain unverified.
I cannot confirm this delivered-email behavior. Provider HTTP acceptance or a local
browser preview would not replace those checks.

Before declaring production readiness, complete the organizational review above,
verify the configured sender and production origin, deploy the reviewed release,
then test both delivered messages with an explicitly authorized controlled recipient.
Click every footer link and the primary/fallback CTA in the delivered messages;
record the final destinations after Brevo redirects and the supported mail clients.
