# LeadCRM — Stripe Local Development Setup

This guide walks through configuring Stripe for local development so the full
`SANDBOX → paid plan → ACTIVE → Client Admin` flow works end-to-end.

---

## Prerequisites

- Stripe CLI installed: <https://docs.stripe.com/stripe-cli>
- Real Stripe **test-mode** keys in `backend/.env`
  (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`)
- Backend and frontend running (`npm run dev` from the monorepo root)

---

## Step 1 — Stripe CLI login (one-time)

```bash
stripe login
```

Follow the browser prompt. The CLI stores a credential locally — you only need
to do this once per machine.

---

## Step 2 — Forward webhooks to the local backend

```bash
stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe
```

The CLI prints a signing secret like:

```
> Ready! Your webhook signing secret is whsec_abc123... (^C to quit)
```

**Copy that `whsec_...` value.** You will need it in Step 3.

> ⚠️ **CLI secret vs Dashboard secret — they are different.**
>
> - **Local dev**: use the secret printed by `stripe listen` (above).
> - **Production**: use the secret from Stripe Dashboard →
>   Developers → Webhooks → your endpoint → Signing secret.
>
> Using the Dashboard secret locally causes:
> `400 Webhook signature verification failed`

---

## Step 3 — Set the webhook secret

Open `backend/.env` and set:

```env
STRIPE_WEBHOOK_SECRET="whsec_<the secret from Step 2>"
```

Then restart the backend (`Ctrl+C` → `npm run dev`).

On startup the server will print one of:

```
[Stripe] ✓ Stripe configuration looks ready — checkout and webhooks should work
```

or warnings like:

```
[Stripe] ⚠ Plan "Starter" missing stripeMonthlyPriceId — run: POST /api/v1/admin/billing/plans/sync-all
```

If you see the second kind, proceed to Step 4.

---

## Step 4 — Sync pricing plans to Stripe (first-time only)

The three LeadCRM pricing plans (Starter / Professional / Enterprise) need to
exist as Stripe Products + Prices before checkout can proceed.

Call the sync endpoint with a System Admin session:

```bash
curl -X POST http://localhost:4000/api/v1/admin/billing/plans/sync-all \
  -H "Cookie: leadcrm_token=<your-system-admin-token>"
```

Or use the System Admin portal UI: **Admin → Pricing → Sync All Plans to Stripe**.

This is **idempotent** — safe to call multiple times. It creates missing Stripe
Products/Prices and updates the `stripeMonthlyPriceId`, `stripeQuarterlyPriceId`,
and `stripeAnnualPriceId` columns on each `PricingPlan` row.

After syncing, the startup check should show `[Stripe] ✓`.

---

## Step 5 — Run the end-to-end test

1. Register a new account at `/register`
2. Verify email
   - `DEV_OTP_BYPASS=true` → enter code `000000`
   - `DEV_OTP_BYPASS=false` → check your email inbox
3. Navigate to **Billing & Subscription** → click **Upgrade Plan**
4. Select a plan and billing cycle (e.g. Starter — Monthly)
5. Complete Stripe test checkout with card: `4242 4242 4242 4242`
   (any future expiry, any CVC)
6. Observe backend logs — look for:
   ```
   [Stripe Webhook] event logged: checkout.session.completed
   ```
7. Browser redirects to `/billing/client?session_id=cs_test_...`
8. The page shows **"Finalizing your account…"** then resolves automatically
9. Sandbox banner disappears. Plan card shows active subscription.

### Verify in database

```sql
SELECT status, "subscriptionStatus", plan FROM "Tenant" WHERE id = '<tenantId>';
-- Expected: ACTIVE | ACTIVE | STARTER

SELECT role FROM "User" WHERE id = '<ownerUserId>';
-- Expected: Client Admin
```

---

## Dev Bypass (no Stripe required)

If `stripe listen` is not available (e.g. CI, offline, demo environment),
use the System Admin bypass endpoint to activate a sandbox tenant instantly:

```bash
# Requires ADMIN_BILLING_BYPASS_ENABLED=true in backend/.env (default: true for local dev)
curl -X PATCH http://localhost:4000/api/v1/admin/tenants/<tenantId>/activate-subscription \
  -H "Content-Type: application/json" \
  -H "Cookie: leadcrm_token=<system-admin-token>" \
  -d '{"planType":"STARTER"}'
```

This runs the **same atomic transaction** as the Stripe webhook:
- `Tenant.status` → `ACTIVE`
- `Tenant.subscriptionStatus` → `ACTIVE`
- `Tenant.plan` → `STARTER`
- `User.role` → `Client Admin` (ownerUserId user)
- `Subscription` row created (`stripeSubscriptionId: null`)
- Audit log: `activationSource: "SYSTEM_ADMIN_BYPASS"`

> Only works for tenants in `SANDBOX` state.
> Does **not** fabricate a Stripe subscription ID.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `BILLING_NOT_CONFIGURED` on checkout | Stripe Price IDs not in DB | Run Step 4 |
| `400 Webhook signature verification failed` | Wrong `STRIPE_WEBHOOK_SECRET` | Use CLI secret (Step 2–3), not Dashboard secret |
| Page stays on "Finalizing…" after checkout | Webhook not received | Check `stripe listen` is running; check backend logs |
| `stripe trigger checkout.session.completed` doesn't activate tenant | Synthetic event has no `tenantId`/`planId` metadata | Use the real E2E test (Step 5) instead |
| `403 Admin billing bypass is not enabled` | Env flag missing | Set `ADMIN_BILLING_BYPASS_ENABLED=true` in `backend/.env` |
| `400 Tenant is already active` | Bypass called on non-SANDBOX tenant | Only valid for `SANDBOX` tenants |

---

## Notes on `stripe trigger`

```bash
stripe trigger checkout.session.completed
```

This generates a **synthetic** event without LeadCRM's required metadata:
`tenantId`, `planId`, `billingCycle`. The webhook handler will log:

```
[Stripe Webhook] checkout.session.completed missing metadata <sessionId>
```

and return early — no activation occurs. The real E2E test (Step 5) is the
only valid way to test the full activation flow.
