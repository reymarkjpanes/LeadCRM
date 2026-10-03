> Historical schema snapshot. The removed operator, document, and login models below are not in the current database. See the [retirement report](../retired-features-cleanup.md) and `backend/prisma/schema.prisma`.

> Historical database design snapshot. Ignored SaaS structures are retained only for stored history, not runtime access. See ../crm-environments.md and ../internal-crm-cleanup.md for the current model.

# LeadCRM ERD — Summary & Recommendations

**Last Updated:** July 22, 2026
**Interactive HTML ERD:** `docs/database/erd.html` (open in browser — hover cards to highlight connectors)

---

## 📊 Overview

**Total Entities:** 30
**All entities in Prisma schema (DB):** 30 ✅
**Frontend-only entities remaining:** 0
**Migration backlog:** Cleared

---

## ✅ Entity Groups

### Platform / Global (no tenantId)
| Entity | Purpose |
|---|---|
| `SystemAdmin` | Cross-tenant LeadCRM operators — manages tenants, pricing, approvals |
| `PricingPlan` | Global plan catalog (Free / Pro / Enterprise) |
| `PlanFeature` | Feature list per pricing plan |

### Tenant Root
| Entity | Purpose |
|---|---|
| `Tenant` | Root of all multi-tenant data — has industry, email, phone, approvedById |
| `Subscription` | Billing source of truth — plan, billingCycle, status, amount |
| `PaymentMethod` | Saved payment methods per tenant |
| `TenantDocument` | Onboarding files (contracts, permits) — verified by SystemAdmin |
| `Environment` | Tenant resource monitoring — CPU, RAM, storage, uptime |

### Auth / RBAC
| Entity | Purpose |
|---|---|
| `User` | Tenant users with role string (legacy) + UserRole junction |
| `UserRole` | Many-to-many User ↔ RoleDefinition junction |
| `RoleDefinition` | Role names per tenant — permissions moved to RolePermission |
| `RolePermission` | Per-module CRUD flags: canView / canCreate / canEdit / canDelete |
| `Session` | JWT token revocation via SHA-256 hash |

### CRM
| Entity | Purpose |
|---|---|
| `Organization` | Company/account linked to contacts and deals |
| `Contact` | Lead or customer — HOT / WARM / COLD / CANCELLED / CLOSED |
| `Pipeline` | Sales or service pipeline (has `type` field) |
| `Stage` | Ordered stages within a pipeline with probability and color |
| `Deal` | Opportunity in a pipeline stage |
| `ContactDeal` | N:M junction — one deal can have many contacts with roles |
| `DealStageHistory` | Full audit trail of stage moves with previousStageId |
| `DealAction` | Manual user-initiated deal operations (ASSIGN_AGENT, SEND_EMAIL, etc.) |

### Operations
| Entity | Purpose |
|---|---|
| `Task` | Action items linked to deals, contacts, or organizations |
| `Activity` | Unified timeline events for all entities |
| `ServiceOrder` | Field technician dispatch — photos, signatures, scheduling |
| `Asset` | Physical assets tracked per organization |
| `InventoryItem` | Stock items with quantity, min thresholds, and reorder tracking |
| `Notification` | In-app notifications per user |

### Marketing
| Entity | Purpose |
|---|---|
| `TargetAudience` | Campaign audience defined by filter conditions (no junction table) |
| `TargetAudienceCondition` | Filter rules: field + operator + value (queried dynamically) |
| `Campaign` | Email / SMS / Multi-Channel campaigns linked to audience + templates |
| `CampaignContact` | Per-contact delivery tracking |
| `CampaignMetrics` | Historical metric snapshots (openRate, clickRate, bounceRate, etc.) |
| `Template` | Email or SMS content templates |
| `EmailDeliveryLog` | Gmail delivery tracking per message |

### Automation
| Entity | Purpose |
|---|---|
| `Workflow` | Trigger → Conditions → Actions automation rules |
| `WorkflowTriggerRecord` | Logged trigger event per entity |
| `WorkflowExecutionRun` | One execution run per trigger |
| `WorkflowExecutionStep` | One step per action in the run |

### Billing
| Entity | Purpose |
|---|---|
| `Invoice` | Billing document linked to deal, contact, or subscription |
| `PaymentTransaction` | Individual payment attempt with PayMongo integration |

### System
| Entity | Purpose |
|---|---|
| `AuditLog` | All mutations logged with category (auth/crm/billing/workflow/admin/system) |

---

## 🔴 Schema Changes from Previous Version

### New models (12 added)
1. `SystemAdmin` — platform operators, no tenantId
2. `PricingPlan` — global plan catalog with monthly/quarterly/annual pricing
3. `PlanFeature` — features list per plan
4. `Subscription` — billing lifecycle source of truth
5. `PaymentMethod` — saved payment methods per tenant
6. `RolePermission` — replaces `permissions String[]` on RoleDefinition
7. `DealAction` — manual deal operations (UPDATE_FIELD, ASSIGN_AGENT, CHANGE_STATUS, SEND_EMAIL, SEND_SMS, ADD_NOTE, CREATE_TASK, CHANGE_STAGE)
8. `TargetAudience` — campaign audience segmentation
9. `TargetAudienceCondition` — filter rules for dynamic contact resolution
10. `CampaignMetrics` — historical metric snapshots
11. `TenantDocument` — tenant onboarding document uploads
12. `Environment` — tenant environment resource monitoring

### Modified models
- `Tenant` — added `industry`, `companySize`, `email`, `phone`, `address`, `approvedById`, `approvedAt`
- `RoleDefinition` — removed `permissions String[]` → use `RolePermission` table
- `Campaign` — replaced `targetAudience String?` with `targetAudienceId FK`, added `emailTemplateId` + `smsTemplateId`
- `Pipeline` — added `type String?`
- `Invoice` — added `subscriptionId FK`
- `PaymentTransaction` — added `paymentMethodId FK`, `transactionRef`
- `AuditLog` — added `category` field (auth | crm | billing | workflow | admin | system)

---

## � RBAC Summary

**5 System Roles:**
- **System Admin** — platform-wide access (Admin Portal), no tenantId
- **Client Admin** — full tenant access (CRM Portal), bypasses RBAC checks
- **Sales Rep** — contacts/deals full CRUD, campaigns/workflows read-only
- **Technician** — contacts and deals read-only, service orders CRUD
- **Viewer** — all modules read-only

**Permission model:** `RolePermission` table — one row per module per role with `canView`, `canCreate`, `canEdit`, `canDelete` booleans. Unique constraint on `[roleId, module]`.

```typescript
// Middleware enforcement:
router.post('/contacts', rbac('contacts', 'canCreate'), controller.create);

// Frontend guard:
{userCan('contacts', 'canDelete') && <Button>Delete</Button>}
```

---

## � Lead → Deal → Invoice Flow

```
1. Lead Capture
   └→ Contact created (status=WARM, score=75)
   └→ AuditLog: contact.created (category=crm)
   └→ Activity: contact-created

2. Lead Qualification
   └→ Sales Rep promotes to status=HOT (score=95)
   └→ Workflow may trigger: "Welcome Email", "Create Follow-up Task"

3. Deal Creation
   └→ Deal linked to Contact via ContactDeal junction
   └→ Pipeline (Sales Inquiries), Stage (Discovery)
   └→ AuditLog: deal.created (category=crm)

4. Stage Progression + Deal Actions
   └→ Drag deal across stages
   └→ DealStageHistory row created per move (previousStageId recorded)
   └→ DealAction (CHANGE_STAGE) created for manual moves
   └→ Manual actions (SEND_EMAIL, ADD_NOTE, ASSIGN_AGENT) → DealAction + Activity

5A. Deal Won
   └→ Deal.closedAt stamped
   └→ Contact.status = CLOSED
   └→ Invoice created with subscriptionId if billing active

5B. Deal Lost
   └→ Lost Reason modal → Deal.lostReason
   └→ Contact.status = COLD / CANCELLED
   └→ DealAction (CHANGE_STATUS) created
```

---

## 📋 Next Steps

1. **`npx prisma migrate dev --name schema-v2-billing-rbac-campaigns`** — apply all new tables
2. **Seed `PricingPlan` + `PlanFeature`** — Free / Pro / Enterprise tiers
3. **Seed `SystemAdmin`** — first platform operator account
4. **Data migration** — `RoleDefinition.permissions String[]` → `RolePermission` rows (one-time)
5. **Update auth middleware** — read `canView/canCreate/canEdit/canDelete` from `RolePermission`
6. **Set `USE_MOCK_DATA=false`** — all 30 entities are now in DB

---

## � Related Docs

- `docs/database/erd.html` — **Interactive HTML ERD (open this first — hover cards to highlight connectors!)**
- `docs/database/erd.md` — Text version of ERD with full field listings
- `backend/prisma/schema.prisma` — Prisma schema (single source of truth)
- `docs/ARCHITECTURE.md` — System architecture overview
- `docs/security/permission-matrix.md` — RBAC role × module matrix
- `docs/security/audit-log-strategy.md` — Audit log strategy with category field
- `docs/workflows/lead-to-deal.md` — Lead lifecycle workflow
- `docs/workflows/deal-to-payment.md` — Deal won to payment collected
