# Security cleanup

Password authentication uses bcrypt, persisted sessions, current-user response allowlists, employee-domain checks, tenant eligibility and RBAC. Valid password login rechecks credentials and eligibility within the session-creation transaction, then issues the existing HttpOnly session cookie.

Profile Settings exposes the existing Change Password dialog with new-password and confirmation inputs, strength requirements, show/hide controls, and field errors. Successful changes apply the canonical user response. `passwordChangedAt` is returned by normal authentication responses and displayed when present.

The shared strong-password policy, password reuse rejection, reset-token invalidation, session revocation and password-change audit remain. Password change preserves the current session; password reset revokes all sessions. Email verification and registration OTP code are unchanged.

See [API documentation](API.md) for the active authentication routes and [removal verification](auth-account-cleanup-verification.md) for the latest database cleanup, checks and deployment instructions.

## Earlier billing and domain cleanup

The inventory below describes the existing historical `20261008000000_remove_retired_billing_domains` migration. It is not part of the latest Account/security removal. Historical applied migrations remain unchanged.

Removed domain routes (under `/api/v1/administration`): GET/POST `/domains`, DELETE `/domains/:id`, POST `/domains/:id/verify`, GET/PUT `/domain-settings`. Removed billing routes (under `/api/v1/billing`): GET/POST `/invoices`, GET/PUT `/invoices/:id`, PATCH `/invoices/:id/pay`, PATCH `/invoices/:id/archive`, POST `/webhooks/paymongo`. No other hypothetical endpoints are claimed removed.

Dropped tables: **PricingPlan, PlanFeature, Subscription, PaymentMethod, Invoice, PaymentTransaction, StripeWebhookEvent, TenantDomain, TenantDomainSettings**. All their rows, columns (including all Stripe IDs), primary keys, indexes, and table-owned constraints are removed.

Dropped columns from retained tables:

- Tenant: `maxContacts`, `maxDeals`, `maxUsers`, `plan`, `stripeCustomerId`, `subscriptionEndsAt`, `subscriptionStatus`, `trialEndsAt`.
- SystemAdmin, TargetAudience, EmailAccount, AutomationRule: `paymentMethods`.
- Activity: `invoiceId`. Activity rows survive; the invoice relation is detached before the table is dropped.

Dropped enum types: **SubscriptionStatus, PlanType, BillingCycle, WebhookEventStatus**.

Explicitly dropped foreign keys: `PlanFeature_planId_fkey`, `Subscription_tenantId_fkey`, `Subscription_planId_fkey`, `PaymentMethod_tenantId_fkey`, `TenantDomain_tenantId_fkey`, `TenantDomainSettings_tenantId_fkey`, `Activity_invoiceId_fkey`, `Invoice_tenantId_fkey`, `Invoice_subscriptionId_fkey`, `Invoice_dealId_fkey`, `Invoice_leadId_fkey`, `Invoice_contactId_fkey`, `PaymentTransaction_tenantId_fkey`, `PaymentTransaction_invoiceId_fkey`, and `PaymentTransaction_paymentMethodId_fkey`.

Removed indexes (table-owned indexes disappear with DROP TABLE; Tenant index is explicitly dropped):

- `PricingPlan_name_key`
- `PricingPlan_stripeProductId_key`
- `PricingPlan_stripeMonthlyPriceId_key`
- `PricingPlan_stripeQuarterlyPriceId_key`
- `PricingPlan_stripeAnnualPriceId_key`
- `PlanFeature_planId_idx`
- `Subscription_stripeSubscriptionId_key`
- `Subscription_tenantId_status_idx`
- `Subscription_stripeSubscriptionId_idx`
- `PaymentMethod_tenantId_isActive_idx`
- `TenantDomain_tenantId_idx`
- `TenantDomain_tenantId_domain_key`
- `TenantDomainSettings_tenantId_key`
- `Invoice_tenantId_status_paymentStatus_idx`
- `Invoice_tenantId_dueDate_idx`
- `Invoice_tenantId_invoiceNumber_idx`
- `Invoice_tenantId_environment_idx`
- `PaymentTransaction_paymongoPaymentId_key`
- `PaymentTransaction_stripePaymentIntentId_key`
- `PaymentTransaction_stripeRefundId_key`
- `PaymentTransaction_tenantId_status_idx`
- `PaymentTransaction_invoiceId_idx`
- `PaymentTransaction_paymongoPaymentId_idx`
- `PaymentTransaction_stripePaymentIntentId_idx`
- `PaymentTransaction_stripeEventId_idx`
- `PaymentTransaction_tenantId_environment_idx`
- `StripeWebhookEvent_stripeEventId_key`
- `StripeWebhookEvent_type_idx`
- `StripeWebhookEvent_status_idx`
- `StripeWebhookEvent_createdAt_idx`
- `Tenant_stripeCustomerId_key`

Primary-key indexes removed: `PricingPlan_pkey`, `PlanFeature_pkey`, `Subscription_pkey`, `PaymentMethod_pkey`, `Invoice_pkey`, `PaymentTransaction_pkey`, `StripeWebhookEvent_pkey`, `TenantDomain_pkey`, `TenantDomainSettings_pkey`.

Impact: irreversible loss of all retired billing/domain records and invoice links, plus removal of billing permission grants. No active runtime path reads those structures after this change. Production row counts and lock durations were not measured; no production database was queried or migrated. Back up/export the retired tables before deployment. Unrelated tenant metadata, CRM deals/revenue/currency, and the deal frequency field remain intact.

Source removals: backend billing route, billing invoice/payment modules, PayMongo integration, domain administration module; frontend team-management-domains, domains.api, invoices.api, invoice mock data; shared billing contracts/types (including tracked JS). Invoice references were removed from merges, environment scoping, activities, seeds, cache metadata and DataContext. Billing permission entries were removed from shared/backend registries, templates, UI groups, mock labels and super-role expansion. The legacy profile route reuses real security components and retains its appearance/notification panes.

Remaining terminology is intentional: historical SQL and archived design documents; the pre-change migration-test fixture; CRM `Deal.billingFrequency` describing customer deal recurrence; campaign subscription terminology; ordinary document descriptions and revenue definitions. No live billing API, Stripe integration, team-domain administration, or billing permissions remain. Generated shared CommonJS companions were synchronized because Node/test resolution can select them before TypeScript; missing companions reached by shared barrels were supplied.
