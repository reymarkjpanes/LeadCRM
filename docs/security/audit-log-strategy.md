# Audit Log Strategy — LeadCRM

> Last updated: June 27, 2026

## Principle

Every data-mutating operation in LeadCRM generates an `AuditLog` entry. No exception.
This provides full traceability — who did what, when, to which record, from where.

---

## AuditLog Model

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  tenantId   String                          // tenant scope — REQUIRED
  userId     String                          // FK → User
  action     String                          // "contact.created" | "deal.stage_changed" | ...
  entityType String                          // "Contact" | "Deal" | "User" | ...
  entityId   String?
  category   String   @default("crm")       // auth | crm | billing | workflow | admin | system
  changeset  Json?                           // { before: {...}, after: {...} }
  metadata   Json?
  ipAddress  String?
  userAgent  String?
  sessionId  String?
  severity   String   @default("INFO")      // INFO | WARNING | CRITICAL
  createdAt  DateTime @default(now())
}
```

---

## Category Values

| Category | Used For |
|---|---|
| `auth` | Login, logout, failed login, password change, token revocation |
| `crm` | Contact, Deal, Organization, Task mutations |
| `billing` | Invoice, PaymentTransaction changes |
| `workflow` | Workflow CRUD, execution runs, trigger events |
| `admin` | User, Role, and RolePermission changes |
| `system` | Workspace system events |

---

## Severity Values

| Severity | Examples |
|---|---|
| `INFO` | Normal CRUD operations — contact created, deal updated |
| `WARNING` | Failed login attempts, permission denied events, archived records |
| `CRITICAL` | Security events — account lockout, suspicious IP, bulk deletes, role changes |

---

## What Gets Logged

### Auth Events (category: auth)
| Action | Severity |
|---|---|
| `user.login` | INFO |
| `user.logout` | INFO |
| `user.login_failed` | WARNING |
| `session.revoked` | WARNING |

### CRM Events (category: crm)
| Action | Severity |
|---|---|
| `contact.created` | INFO |
| `contact.updated` | INFO |
| `contact.archived` | WARNING |
| `contact.deleted` | WARNING |
| `deal.created` | INFO |
| `deal.updated` | INFO |
| `deal.stage_changed` | INFO |
| `deal.action_performed` | INFO |
| `deal.archived` | WARNING |
| `deal.lost` | INFO |
| `deal.won` | INFO |
| `task.created` | INFO |
| `task.reassigned` | INFO |
| `task.completed` | INFO |

### Billing Events (category: billing)
| Action | Severity |
|---|---|
| `invoice.created` | INFO |
| `invoice.updated` | INFO |
| `payment.received` | INFO |
| `payment.failed` | WARNING |
| `payment_method.added` | INFO |

### Workflow Events (category: workflow)
| Action | Severity |
|---|---|
| `workflow.created` | INFO |
| `workflow.activated` | INFO |
| `workflow.execution_failed` | WARNING |

### Admin Events (category: admin)
| Action | Severity |
|---|---|
| `user.created` | INFO |
| `user.role_changed` | WARNING |
| `role.permissions_changed` | CRITICAL |
| `invitation.sent` | INFO |
| `invitation.revoked` | WARNING |


---

## Log Entry Shape (TypeScript)

```typescript
interface AuditLogEntry {
  tenantId:   string;
  userId:     string;
  action:     string;
  entityType: string;
  entityId?:  string;
  category:   'auth' | 'crm' | 'billing' | 'workflow' | 'admin' | 'system';
  severity:   'INFO' | 'WARNING' | 'CRITICAL';
  changeset?: {
    before: Record<string, unknown>;
    after:  Record<string, unknown>;
  };
  metadata?:  Record<string, unknown>;
  ipAddress?: string;   // req.ip
  userAgent?: string;   // req.headers['user-agent']
  sessionId?: string;
}
```

---

## Changeset Format

For updates, record only the fields that changed:

```json
{
  "action": "deal.stage_changed",
  "category": "crm",
  "changeset": {
    "before": { "stageId": "stage_proposal",    "stageName": "Proposal" },
    "after":  { "stageId": "stage_negotiation", "stageName": "Negotiation" }
  }
}
```

---

## Implementation Pattern

### Backend (Service layer)
```typescript
// audit.service.ts
await auditService.log({
  tenantId:   req.user.tenantId,
  userId:     req.user.id,
  action:     'contact.created',
  entityType: 'Contact',
  entityId:   contact.id,
  category:   'crm',
  severity:   'INFO',
  metadata:   { source: contact.source },
  ipAddress:  req.ip,
  userAgent:  req.headers['user-agent'],
  sessionId:  req.user.sessionId,
});
```

### Frontend (DataContext — until USE_MOCK_DATA=false)
```typescript
addAuditLog({
  action:     'deal.updated',
  entityType: 'Deal',
  entityId:   deal.id,
  category:   'crm',
  severity:   'INFO',
  changeset:  { before: { stageId: old }, after: { stageId: newId } },
});
```

---

## History consumers

The standalone administrative viewer has been removed. `AuditLog` storage and tenant-scoped audit services remain for Team Management user history. Record Activity tabs use the activity APIs and continue to show email, task, status, and workflow events. See the [retirement report](../retired-features-cleanup.md).

---

## Retention Policy

| Plan | Retention |
|---|---|
| Sandbox | 30 days |
| Free | 90 days |
| Pro | 1 year |
| Enterprise | Unlimited |

---

## What Does NOT Get Logged

- Read operations (view, search, export preview)
- Failed permission checks (go to security/system logs)
- Health check endpoints

---

## See Also
- `backend/src/core/audit/audit.service.ts`
- `frontend/src/store/DataContext.tsx` — `addAuditLog()` implementation
- `docs/security/permission-matrix.md`
- `docs/database/erd.md` — AuditLog entity definition
