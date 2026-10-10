> Historical schema snapshot. For the current 57-model design, use the [current ERD](normalization-erd.md), [complete inventory](normalization-inventory.md), and [normalization audit](normalization-report.md). The removed operator, document, and login models below are not in the current database.

> Historical project/design record, not current implementation guidance. Retired SaaS access and billing descriptions below must not be implemented. Current authority: `docs/authentication.md`, `docs/crm-environments.md`, and `docs/internal-crm-cleanup.md`.

# Entity Relationship Diagram — LeadCRM

> **Source of truth:** `backend/prisma/schema.prisma`
> All 30 entities are now in the Prisma schema. No frontend-only entities remain.
> Last updated: July 22, 2026

---

## Full Entity Map

```
SystemAdmin (platform-global, no tenantId)

PricingPlan (platform-global)
  └──(n) PlanFeature
  └──(n) Subscription

Tenant (root)
  │
  ├──(n) Subscription ──── FK→PricingPlan
  ├──(n) PaymentMethod
  ├──(n) TenantDocument
  ├──(n) Environment
  │
  ├──(n) User
  │         └──(n) UserRole ──── FK→RoleDefinition
  │
  ├──(n) RoleDefinition
  │         └──(n) RolePermission  (module, canView/canCreate/canEdit/canDelete)
  │
  ├──(n) Session
  │
  ├──(n) Organization
  │         └──(n) Contact ──────────────────────────────────────────┐
  │                   │                                               │
  │                   └──(n) ContactDeal (junction) ────── Deal ──────┤
  │                                                          │        │
  ├──(n) Pipeline                                            │        │
  │         └──(n) Stage ──── Deal.stageId ──────────────────┘        │
  │                                                                    │
  ├──(n) Deal ────────────────────────────────────────────────────────┘
  │         ├──(n) DealStageHistory
  │         ├──(n) DealAction
  │         ├──(n) Task
  │         ├──(n) Activity
  │         ├──(n) Invoice ──── FK→Subscription?
  │         └──(n) ServiceOrder
  │
  ├──(n) TargetAudience
  │         └──(n) TargetAudienceCondition
  │         └──(n) Campaign ──── FK→Template (email + sms)
  │                   ├──(n) CampaignContact
  │                   ├──(n) CampaignMetrics
  │                   └──(n) EmailDeliveryLog
  │
  ├──(n) Template
  │
  ├──(n) Workflow
  │         └──(n) WorkflowTriggerRecord
  │                   └──(n) WorkflowExecutionRun
  │                             └──(n) WorkflowExecutionStep
  │
  ├──(n) Invoice ──── FK→PaymentTransaction
  │                         └── FK→PaymentMethod
  │
  ├──(n) Asset
  ├──(n) InventoryItem
  ├──(n) Notification
  └──(n) AuditLog
```


---

## Entity Definitions

### SystemAdmin `[DB — platform-global]`
```
id           String   cuid PK
email        String   unique
firstName    String
lastName     String
passwordHash String
isActive     Boolean  default true
createdAt    DateTime
updatedAt    DateTime
```
> No tenantId. LeadCRM platform operators only. Manages tenants, pricing, approvals.

---

### PricingPlan `[DB — platform-global]`
```
id             String   cuid PK
name           String   unique  (e.g. "Free", "Pro", "Enterprise")
planType       FREE | PRO | ENTERPRISE
monthlyPrice   Float
quarterlyPrice Float
annualPrice    Float
maxUsers       Int?
maxContacts    Int?
maxDeals       Int?
storageLimit   Int?     MB
isActive       Boolean
createdAt      DateTime
updatedAt      DateTime
```

### PlanFeature `[DB]`
```
id          String   cuid PK
planId      String   FK→PricingPlan
name        String   (e.g. "Workflow Automation", "Gmail Integration")
description String?
```

---

### Tenant `[DB]`
```
id                 String             cuid PK
name               String
slug               String             unique
industry           String?
companySize        String?            "1-10" | "11-50" | "51-200" | "200+"
email              String?
phone              String?
address            String?
status             SANDBOX | ACTIVE | SUSPENDED | CANCELLED | DELETED
subscriptionStatus TRIAL | ACTIVE | PAST_DUE | CANCELLED | EXPIRED
plan               FREE | PRO | ENTERPRISE  (denorm cache — source of truth = Subscription)
trialEndsAt        DateTime?
subscriptionEndsAt DateTime?
maxUsers           Int?
maxContacts        Int?
maxDeals           Int?
approvedById       String?            SystemAdmin.id
approvedAt         DateTime?
createdAt          DateTime
updatedAt          DateTime
```

### Subscription `[DB]`
```
id              String             cuid PK
tenantId        String             FK→Tenant
planId          String             FK→PricingPlan
billingCycle    MONTHLY | QUARTERLY | ANNUAL
status          SubscriptionStatus
amount          Float
startDate       DateTime
endDate         DateTime?
nextBillingDate DateTime?
cancelledAt     DateTime?
createdAt       DateTime
updatedAt       DateTime
```

### PaymentMethod `[DB]`
```
id            String   cuid PK
tenantId      String   FK→Tenant
methodName    String   "GCash" | "Maya" | "Credit Card" | "Bank Transfer"
accountName   String?
accountNumber String?  masked e.g. "****1234"
isDefault     Boolean
isActive      Boolean
createdAt     DateTime
updatedAt     DateTime
```

### TenantDocument `[DB]`
```
id           String    cuid PK
tenantId     String    FK→Tenant
fileName     String
documentType String    "contract" | "business_permit" | "id_proof" | "other"
filePath     String    URL to object storage (NOT base64)
fileSize     Int?      bytes
status       String    "pending" | "verified" | "rejected"
uploadedAt   DateTime
verifiedById String?   SystemAdmin.id
verifiedAt   DateTime?
```

### Environment `[DB]`
```
id            String    cuid PK
tenantId      String    FK→Tenant
envCode       String    "prod" | "staging" | "sandbox"
type          String    "production" | "staging" | "sandbox"
cpuUsage      Float?    percentage
ramUsage      Float?    percentage
storageUsage  Float?    percentage
uptimePct     Float?    percentage
isDefault     Boolean
lastCheckedAt DateTime?
createdAt     DateTime
updatedAt     DateTime
unique: [tenantId, envCode]
```


---

### User `[DB]`
```
id           String     cuid PK
tenantId     String     FK→Tenant  REQUIRED
email        String     unique per tenant
firstName    String
lastName     String
passwordHash String
role         String     "Sales Rep" (legacy fallback — use UserRole for new code)
status       ACTIVE | INACTIVE | PENDING
createdAt    DateTime
updatedAt    DateTime
```

### RoleDefinition `[DB]`
```
id           String   cuid PK
tenantId     String   FK→Tenant  REQUIRED
name         String   unique per tenant
description  String?
isSystemRole Boolean
isArchived   Boolean
createdAt    DateTime
updatedAt    DateTime
```
> `permissions String[]` removed. Use `RolePermission` table instead.

### RolePermission `[DB]`
```
id        String  cuid PK
tenantId  String
roleId    String  FK→RoleDefinition (cascade delete)
module    String  "contacts" | "deals" | "campaigns" | "workflows" |
                  "billing" | "reports" | "users" | "settings" |
                  "audit" | "organizations" | "tasks" | "service_orders"
canView   Boolean
canCreate Boolean
canEdit   Boolean
canDelete Boolean
unique: [roleId, module]
```

### UserRole `[DB]`
```
id       String  cuid PK
userId   String  FK→User (cascade delete)
roleId   String  FK→RoleDefinition (cascade delete)
tenantId String  FK→Tenant
unique: [userId, roleId, tenantId]
```

### Session `[DB]`
```
id           String    cuid PK
userId       String    FK→User
tenantId     String    FK→Tenant
tokenHash    String    unique  SHA-256 of JWT — never plaintext
userAgent    String?
ipAddress    String?
expiresAt    DateTime
revokedAt    DateTime?
lastActiveAt DateTime
createdAt    DateTime
```

---

### Organization `[DB]`
```
id             String    cuid PK
tenantId       String    FK→Tenant  REQUIRED
assignedUserId String?   FK→User
name           String
industry       String?
size           String?   "1-10" | "11-50" | "51-200" | "200+"
website        String?
taxId          String?
tags           String[]
address        String?
city           String?
province       String?
country        String    default "Philippines"
isArchived     Boolean
deletedAt      DateTime?
deletedBy      String?
createdAt      DateTime
updatedAt      DateTime
```

### Contact `[DB]`
```
id              String        cuid PK
tenantId        String        FK→Tenant  REQUIRED
organizationId  String?       FK→Organization
assignedUserId  String?       FK→User (current handler — can change)
ownerId         String?       FK→User (original capturer — immutable)
firstName       String
lastName        String
email           String?
phone           String?
company         String?
jobTitle        String?
linkedinUrl     String?
status          HOT | WARM | COLD | CANCELLED | CLOSED
score           Int           default 75
source          String?
notes           String?
lastContactedAt DateTime?
convertedAt     DateTime?
doNotContact    Boolean
isArchived      Boolean
archiveReason   String?
deletedAt       DateTime?
deletedBy       String?
createdAt       DateTime
updatedAt       DateTime
```


---

### Pipeline `[DB]`
```
id         String   cuid PK
tenantId   String   FK→Tenant  REQUIRED
name       String
type       String?  "Sales" | "Service" | "Onboarding"
isDefault  Boolean
currency   String   default "PHP"
isArchived Boolean
createdAt  DateTime
updatedAt  DateTime
```

### Stage `[DB]`
```
id          String   cuid PK
pipelineId  String   FK→Pipeline
name        String
order       Int
probability Int?     0–100 for revenue forecasting
color       String?  hex e.g. "#3fb950"
description String?
isWon       Boolean  terminal — deal won
isLost      Boolean  terminal — deal lost
isDefault   Boolean  starting stage for new deals
createdAt   DateTime
```

### Deal `[DB]`
```
id                String    cuid PK
tenantId          String    FK→Tenant  REQUIRED
pipelineId        String    FK→Pipeline
stageId           String    FK→Stage
contactId         String?   FK→Contact  (legacy singular — use ContactDeal for new code)
organizationId    String?   FK→Organization
assignedUserId    String?   FK→User (current handler)
ownerId           String?   FK→User (original owner — immutable)
title             String
value             Float?
currency          String    default "PHP"
priority          LOW | MEDIUM | HIGH
expectedCloseDate DateTime?
closedAt          DateTime? stamped when stage isWon/isLost = true
lostReason        String?
description       String?
leadSource        String?
industry          String?
tags              String?
order             Int
isArchived        Boolean
archiveReason     String?
deletedAt         DateTime?
createdAt         DateTime
updatedAt         DateTime
```

### ContactDeal `[DB]` — N:M junction
```
id        String   cuid PK
contactId String   FK→Contact (cascade delete)
dealId    String   FK→Deal    (cascade delete)
tenantId  String   FK→Tenant
role      String?  "Primary Contact" | "Decision Maker" | "Technical Evaluator"
addedById String?  FK→User
addedAt   DateTime
unique: [contactId, dealId]
```

### DealStageHistory `[DB]`
```
id              String    cuid PK
tenantId        String    FK→Tenant
dealId          String    FK→Deal (cascade delete)
previousStageId String?   FK→Stage
newStageId      String    FK→Stage
movedById       String    FK→User
movedAt         DateTime
timeInPrevStage Int?      minutes in previous stage
note            String?
```

### DealAction `[DB]`
```
id            String         cuid PK
tenantId      String         FK→Tenant
dealId        String         FK→Deal (cascade delete)
performedById String         FK→User
actionType    DealActionType
              UPDATE_FIELD | ASSIGN_AGENT | CHANGE_STATUS |
              SEND_EMAIL | SEND_SMS | ADD_NOTE | CREATE_TASK | CHANGE_STAGE
payload       Json?          e.g. { field: "status", from: "WARM", to: "HOT" }
note          String?
performedAt   DateTime
```

---

### Task `[DB]`
```
id             String    cuid PK
tenantId       String    FK→Tenant  REQUIRED
dealId         String?   FK→Deal    (set null on delete)
contactId      String?   FK→Contact (set null on delete)
organizationId String?
assignedUserId String    FK→User (current owner)
assignedById   String?   FK→User (who assigned it)
completedById  String?   FK→User
title          String
description    String?
status         pending | in_progress | blocked | completed | cancelled
priority       Low | Medium | High
dueDate        DateTime
reminderAt     DateTime?
completedAt    DateTime?
isArchived     Boolean
createdAt      DateTime
updatedAt      DateTime
```

### Activity `[DB]` — unified timeline
```
id             String    cuid PK
tenantId       String    FK→Tenant  REQUIRED
createdById    String    FK→User
type           call | meeting | email | sms | note | task |
               workflow | stage_change | deal_action | file_upload
title          String
description    String?
metadata       Json?
contactId      String?   FK→Contact  (exactly one of these is non-null)
dealId         String?   FK→Deal
organizationId String?   FK→Organization
taskId         String?   FK→Task
invoiceId      String?   FK→Invoice
createdAt      DateTime
```

### ServiceOrder `[DB]`
```
id                   String    cuid PK
tenantId             String    FK→Tenant  REQUIRED
assignedTechnicianId String?   FK→User
contactId            String?   FK→Contact
organizationId       String?   FK→Organization
dealId               String?   FK→Deal
invoiceId            String?
title                String
description          String?
status               pending | in_progress | completed | cancelled
scheduledDate        DateTime
completedAt          DateTime?
actualDurationMins   Int?
photos               Json?     { before: [url], after: [url] } — object storage URLs
signature            String?   URL to signed document
notes                String?
createdAt            DateTime
updatedAt            DateTime
```

### Asset `[DB]`
```
id             String    cuid PK
tenantId       String    FK→Tenant  REQUIRED
organizationId String?   FK→Organization
name           String
category       String    Security | Telecom | IT | Infrastructure
serialNumber   String
client         String
status         Active | Maintenance | Retired | Faulty
installDate    DateTime
warrantyExpiry DateTime
location       String
createdAt      DateTime
updatedAt      DateTime
```

### InventoryItem `[DB]`
```
id            String    cuid PK
tenantId      String    FK→Tenant  REQUIRED
name          String
sku           String    unique per tenant
category      String
quantity      Int
minQuantity   Int       reorder threshold
unitPrice     Float
supplier      String?
lastRestocked DateTime?
createdAt     DateTime
updatedAt     DateTime
```

### Notification `[DB]`
```
id         String    cuid PK
tenantId   String    FK→Tenant
userId     String    FK→User
type       String    deal_assigned | task_due | campaign_sent | workflow_failed | deal_action
title      String
body       String?
entityType String?
entityId   String?
isRead     Boolean
readAt     DateTime?
createdAt  DateTime
```


---

### TargetAudience `[DB]`
```
id          String   cuid PK
tenantId    String   FK→Tenant  REQUIRED
name        String
description String?
isActive    Boolean
createdAt   DateTime
updatedAt   DateTime
```
> No `audience_contacts` junction table — contacts resolved dynamically via conditions at query time.

### TargetAudienceCondition `[DB]`
```
id               String   cuid PK
targetAudienceId String   FK→TargetAudience (cascade delete)
field            String   contact field: "status" | "score" | "source" | "tags" | ...
operator         String   equals | not_equals | contains | gte | lte | in | not_in
value            String   stored as string, cast at query time
conditionOrder   Int
createdAt        DateTime
```

### Campaign `[DB]`
```
id               String         cuid PK
tenantId         String         FK→Tenant  REQUIRED
targetAudienceId String?        FK→TargetAudience (set null on delete)
emailTemplateId  String?        FK→Template (type=Email)
smsTemplateId    String?        FK→Template (type=SMS)
name             String
type             EMAIL | SMS | MULTI_CHANNEL
status           DRAFT | ACTIVE | PAUSED | COMPLETED | SCHEDULED
subject          String?
body             String?        inline override when no template selected
sentCount        Int
openedCount      Int
clickedCount     Int
engagement       Float
scheduledFor     DateTime?
sentAt           DateTime?
isArchived       Boolean
createdAt        DateTime
updatedAt        DateTime
```

### CampaignContact `[DB]` — per-contact delivery tracking
```
id           String    cuid PK
tenantId     String    FK→Tenant
campaignId   String    FK→Campaign (cascade delete)
contactId    String    FK→Contact  (cascade delete)
status       pending | sent | delivered | opened | clicked | bounced | unsubscribed
sentAt       DateTime?
deliveredAt  DateTime?
openedAt     DateTime?
clickedAt    DateTime?
bouncedAt    DateTime?
unsubscribed Boolean
unique: [campaignId, contactId]
```

### CampaignMetrics `[DB]` — historical snapshots
```
id             String   cuid PK
tenantId       String   FK→Tenant
campaignId     String   FK→Campaign (cascade delete)
sentCount      Int
deliveredCount Int
openedCount    Int
clickedCount   Int
respondedCount Int
bouncedCount   Int
openRate       Float
clickRate      Float
deliveryRate   Float
responseRate   Float
bounceRate     Float
snapshotAt     DateTime
```

### Template `[DB]`
```
id         String   cuid PK
tenantId   String   FK→Tenant  REQUIRED
name       String
type       String   "Email" | "SMS"
category   String?
subject    String?  email only
content    String
isArchived Boolean
createdAt  DateTime
updatedAt  DateTime
```

### EmailDeliveryLog `[DB]`
```
id             String    cuid PK
tenantId       String    FK→Tenant
campaignId     String?   FK→Campaign
contactId      String?   FK→Contact
fromEmail      String
toEmail        String
subject        String
gmailMessageId String?   unique
gmailThreadId  String?
status         sent | delivered | opened | clicked | bounced | failed
sentAt         DateTime?
openedAt       DateTime?
clickedAt      DateTime?
bouncedAt      DateTime?
errorMessage   String?
createdAt      DateTime
```

---

### Workflow `[DB]`
```
id          String   cuid PK
tenantId    String   FK→Tenant  REQUIRED
name        String
description String?
trigger     String   "deal.stage_changed" | "contact.created" | "task.overdue" | ...
conditions  Json?    WorkflowCondition[] — never eval()'d
actions     Json     WorkflowAction[]
isActive    Boolean
isArchived  Boolean
createdAt   DateTime
updatedAt   DateTime
```

### WorkflowTriggerRecord `[DB]`
```
id          String   cuid PK
tenantId    String   FK→Tenant
workflowId  String   FK→Workflow
triggerType String
entityType  String
entityId    String
triggeredAt DateTime
payload     Json?
```

### WorkflowExecutionRun `[DB]`
```
id           String    cuid PK
tenantId     String    FK→Tenant
workflowId   String    FK→Workflow
triggerId    String    FK→WorkflowTriggerRecord
entityType   String
entityId     String
status       running | completed | failed | skipped
startedAt    DateTime
completedAt  DateTime?
errorMessage String?
```

### WorkflowExecutionStep `[DB]`
```
id          String   cuid PK
tenantId    String   FK→Tenant
executionId String   FK→WorkflowExecutionRun (cascade delete)
stepIndex   Int
actionType  String   create_task | send_email | assign_owner | update_field | send_sms | change_status | ...
status      success | failed | skipped
output      Json?
error       String?
executedAt  DateTime
```

---

### Invoice `[DB]`
```
id              String    cuid PK
tenantId        String    FK→Tenant  REQUIRED
subscriptionId  String?   FK→Subscription (set null on delete)
dealId          String?   FK→Deal    (set null on delete)
contactId       String?   FK→Contact (set null on delete)
organizationId  String?
invoiceNumber   String    INV-2024-001 (tenant-scoped)
plan            String?
amount          Float
taxAmount       Float
discountAmount  Float
totalAmount     Float
currency        String    default "PHP"
frequency       Monthly | Quarterly | Annual | One-time
status          Pending | Active | Expired | Cancelled
paymentStatus   Unpaid | Paid | Overdue
startDate       DateTime
dueDate         DateTime?
nextBillingDate DateTime?
paidAt          DateTime?
notes           String?
isArchived      Boolean
createdAt       DateTime
updatedAt       DateTime
```

### PaymentTransaction `[DB]`
```
id                 String    cuid PK
tenantId           String    FK→Tenant
invoiceId          String    FK→Invoice
paymentMethodId    String?   FK→PaymentMethod (set null on delete)
amount             Float
currency           String    default "PHP"
status             pending | paid | failed | refunded
transactionRef     String?
paymongoPaymentId  String?   unique
paymongoPaymentUrl String?
paymentMethod      String?   card | gcash | maya | bank_transfer (denorm display)
paidAt             DateTime?
failureReason      String?
metadata           Json?
createdAt          DateTime
```

---

### AuditLog `[DB]`
```
id         String   cuid PK
tenantId   String   FK→Tenant  REQUIRED
userId     String   FK→User
action     String   "contact.created" | "deal.stage_changed" | "user.login" | ...
entityType String   "Contact" | "Deal" | "User" | ...
entityId   String?
category   String   auth | crm | billing | workflow | admin | system
changeset  Json?    { before: { status: "WARM" }, after: { status: "HOT" } }
metadata   Json?
ipAddress  String?
userAgent  String?
sessionId  String?
severity   INFO | WARNING | CRITICAL
createdAt  DateTime
```


---

## Relationship Summary

| Parent | Child | Cardinality | FK Field |
|---|---|---|---|
| PricingPlan | PlanFeature | 1:N | `PlanFeature.planId` |
| PricingPlan | Subscription | 1:N | `Subscription.planId` |
| Tenant | Subscription | 1:N | `Subscription.tenantId` |
| Tenant | PaymentMethod | 1:N | `PaymentMethod.tenantId` |
| Tenant | TenantDocument | 1:N | `TenantDocument.tenantId` |
| Tenant | Environment | 1:N | `Environment.tenantId` |
| Tenant | User | 1:N | `User.tenantId` |
| Tenant | RoleDefinition | 1:N | `RoleDefinition.tenantId` |
| Tenant | Session | 1:N | `Session.tenantId` |
| Tenant | Organization | 1:N | `Organization.tenantId` |
| Tenant | Contact | 1:N | `Contact.tenantId` |
| Tenant | Pipeline | 1:N | `Pipeline.tenantId` |
| Tenant | Deal | 1:N | `Deal.tenantId` |
| Tenant | Task | 1:N | `Task.tenantId` |
| Tenant | Activity | 1:N | `Activity.tenantId` |
| Tenant | Campaign | 1:N | `Campaign.tenantId` |
| Tenant | TargetAudience | 1:N | `TargetAudience.tenantId` |
| Tenant | Template | 1:N | `Template.tenantId` |
| Tenant | Workflow | 1:N | `Workflow.tenantId` |
| Tenant | Invoice | 1:N | `Invoice.tenantId` |
| Tenant | ServiceOrder | 1:N | `ServiceOrder.tenantId` |
| Tenant | Asset | 1:N | `Asset.tenantId` |
| Tenant | InventoryItem | 1:N | `InventoryItem.tenantId` |
| Tenant | Notification | 1:N | `Notification.tenantId` |
| Tenant | AuditLog | 1:N | `AuditLog.tenantId` |
| RoleDefinition | RolePermission | 1:N | `RolePermission.roleId` |
| RoleDefinition | UserRole | 1:N | `UserRole.roleId` |
| User | UserRole | 1:N | `UserRole.userId` |
| User | AuditLog | 1:N | `AuditLog.userId` |
| User | Activity | 1:N | `Activity.createdById` |
| User | DealAction | 1:N | `DealAction.performedById` |
| Organization | Contact | 1:N | `Contact.organizationId` |
| Organization | Deal | 1:N | `Deal.organizationId` |
| Pipeline | Stage | 1:N | `Stage.pipelineId` |
| Pipeline | Deal | 1:N | `Deal.pipelineId` |
| Stage | Deal | 1:N | `Deal.stageId` |
| Contact | Deal | N:M | `ContactDeal` junction |
| Deal | DealStageHistory | 1:N | `DealStageHistory.dealId` |
| Deal | DealAction | 1:N | `DealAction.dealId` |
| Deal | Task | 1:N | `Task.dealId` |
| Deal | Activity | 1:N | `Activity.dealId` |
| Deal | Invoice | 1:N | `Invoice.dealId` |
| Deal | ServiceOrder | 1:N | `ServiceOrder.dealId` |
| Subscription | Invoice | 1:N | `Invoice.subscriptionId` |
| PaymentMethod | PaymentTransaction | 1:N | `PaymentTransaction.paymentMethodId` |
| Invoice | PaymentTransaction | 1:N | `PaymentTransaction.invoiceId` |
| TargetAudience | TargetAudienceCondition | 1:N | `TargetAudienceCondition.targetAudienceId` |
| TargetAudience | Campaign | 1:N | `Campaign.targetAudienceId` |
| Template | Campaign (email) | 1:N | `Campaign.emailTemplateId` |
| Template | Campaign (sms) | 1:N | `Campaign.smsTemplateId` |
| Campaign | CampaignContact | 1:N | `CampaignContact.campaignId` |
| Campaign | CampaignMetrics | 1:N | `CampaignMetrics.campaignId` |
| Campaign | EmailDeliveryLog | 1:N | `EmailDeliveryLog.campaignId` |
| Workflow | WorkflowTriggerRecord | 1:N | `WorkflowTriggerRecord.workflowId` |
| WorkflowTriggerRecord | WorkflowExecutionRun | 1:N | `WorkflowExecutionRun.triggerId` |
| WorkflowExecutionRun | WorkflowExecutionStep | 1:N | `WorkflowExecutionStep.executionId` |

---

## Tenant Isolation Rule

Every tenant-scoped table has `tenantId` as a **required, indexed** field. Enforced at three layers:

```typescript
// 1. Repository layer — every query is tenant-scoped
prisma.contact.findMany({ where: { tenantId: req.user.tenantId } })

// 2. Middleware — tenantId sourced from JWT, never from request body
const contact = await repo.create(dto, req.user.tenantId);

// 3. Response — 404 (not 403) when tenantId mismatch to avoid revealing other tenants
if (!contact) throw new AppError('Contact not found', 404);
```

---

## Workflow Execution Rule (Three Records Per Execution)

Every automated workflow execution MUST create exactly three record types:

```
WorkflowExecutionRun   (status: running → completed/failed)
WorkflowExecutionStep  (one per action — status: success/failed/skipped)
Activity               (type: 'workflow', linked to the entity)
```

---

## See Also
- `backend/prisma/schema.prisma` — Prisma DB schema (single source of truth)
- `docs/database/erd.html` — Interactive visual ERD
- `docs/database/ERD-SUMMARY.md` — Entity group overview and change log
- `docs/security/permission-matrix.md` — RBAC role × module matrix
- `docs/security/audit-log-strategy.md` — Audit log categories and patterns
- `docs/workflows/customer-lifecycle.md` — Full customer journey
- `docs/workflows/lead-to-deal.md` — Lead capture to deal creation
- `docs/workflows/deal-to-payment.md` — Deal won to payment collected
