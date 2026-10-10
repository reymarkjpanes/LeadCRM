# Column Registry ↔ API Response DTO Field Mapping Audit

> Historical audit. The 2026-10-05 [CRM consistency validation](../../../../../docs/plans/crm-table-consistency-validation.md) supersedes the affected mappings below. Lead description, website, audit users, and status-change date are now populated fields; Contact and Lead use distinct models, and related-record display no longer depends solely on global lookup pages.

**Task:** 13.1 — Verify Column Registry ↔ API response DTO field mapping per module
**Date:** Audit performed as part of CRM Data View Modernization spec
**Requirements:** 12.1, 12.2

## Summary

All four modules have been audited. The column IDs in each frontend Column Registry
have been verified against the backend list API response fields and the adapter layer.

**Result:** All default-visible columns map correctly to API response fields.
Non-default columns that reference aspirational/future fields (communication, email stats,
opportunity stats, task stats) will render "—" via the em-dash fallback, which is by design
(Requirement 6.6). No breaking mismatches found.

---

## Module: Leads (78 columns)

### Backend List API: `GET /api/v1/crm/leads`
- **Prisma model:** `Lead`
- **Repository:** `contacts.repository.ts` → `prisma.lead.findMany`
- **Includes:** `assignedUser { id, firstName, lastName }`, `account { id, name }`
- **Adapter:** `contact.adapter.ts` → `toFrontendContact()`

### Core Field Mapping (default-visible columns)

| Column ID | API Response Field | Adapter Mapping | Status |
|-----------|-------------------|-----------------|--------|
| `firstName` | `firstName` | Direct (also builds `contactPerson`) | ✅ |
| `email` | `email` | Direct, separate Email address column | ✅ |
| `phone` | `phone` | Direct, separate Phone number column | ✅ |
| `companyName` | `companyName` | Direct | ✅ |
| `status` | `status` | `toFrontendStatus()` — UPPERCASE→TitleCase | ✅ |
| `createdAt` | `createdAt` | Direct (ISO string) | ✅ |
| `source` | `source` | Adapter maps to `leadSource` + `source` (both available) | ✅ |

### Non-Default Column Mapping

| Column ID | API Response Field | Notes | Status |
|-----------|-------------------|-------|--------|
| `description` | N/A | Not in Prisma `Lead` model — renders "—" | ✅ (by design) |
| `website` | N/A | Not in Prisma `Lead` model — renders "—" | ✅ (by design) |
| `createdBy` | N/A | Not in Prisma `Lead` model — renders "—" | ✅ (by design) |
| `updatedAt` | N/A | Not in Prisma `Lead` model — renders "—" | ✅ (by design) |
| `updatedBy` | N/A | Not in Prisma `Lead` model — renders "—" | ✅ (by design) |
| `address` | `address` | Direct | ✅ |
| `productInterest` | `productInterest[]` | Adapter maps to `productInterests` array | ✅ |
| `linkedinUrl` | N/A | Not in Prisma `Lead` model — renders "—" | ✅ (by design) |

### Aspirational Columns (Communication, Emails, Calls, SMS, Notes, Opportunities, Tasks)

All 58 columns in groups: Communication, Emails, Calls, SMS messages, Notes, Opportunities, Tasks
are **aspirational/future columns** not backed by computed fields in the current Lead API response.
They render "—" via the DataGrid em-dash fallback (Requirement 6.6, 13.6). This is intentional —
they represent the target column set for when activity aggregations are implemented.

**No adapter mapping needed** — the em-dash fallback handles undefined values.

### Cell Renderer Field Access (leads-data-grid.tsx)

| Renderer | Accesses | Matches API? |
|----------|----------|--------------|
| `firstName` | `row.leadPerson`, `row.firstName`, `row.lastName`, `row.companyName` | ✅ |
| `email` | `row.email` | ✅ |
| `phone` | `row.phone` | ✅ |
| `companyName` | `row.companyName` | ✅ |
| `status` | `row.status` | ✅ |
| `source` | `row.leadSource` | ✅ (adapter maps `source` → `leadSource`) |
| `createdAt` | `row.createdAt` | ✅ |
| `updatedAt` | `row.updatedAt` | ✅ (undefined → renders "—") |
| `website` | `row.website` | ✅ (undefined → renders "—") |

---

## Module: Contacts (10 columns)

### Backend List API: `GET /api/v1/crm/contacts`
- **Prisma model:** `Lead` (contacts are leads in the DB)
- **Repository:** `contacts.repository.ts` → `prisma.lead.findMany`
- **Includes:** `assignedUser { id, firstName, lastName }`, `account { id, name }`
- **Adapter:** `contact.adapter.ts` → `toFrontendContact()`

### Field Mapping

| Column ID | API Response Field | Adapter Mapping | Status |
|-----------|-------------------|-----------------|--------|
| `firstName` | `firstName` | Direct | ✅ |
| `lastName` | `lastName` | Direct | ✅ |
| `email` | `email` | Direct | ✅ |
| `phone` | `phone` | Direct | ✅ |
| `companyName` | `companyName` | Direct | ✅ |
| `status` | `status` | `toFrontendStatus()` | ✅ |
| `source` | `source` | Adapter maps to both `leadSource` and `source` | ✅ |
| `assignedUserId` | `assignedUserId` + `assignedUser` (included) | Lookup via prop | ✅ |
| `accountId` | `accountId` + `account { id, name }` (included) | Lookup via prop | ✅ |
| `createdAt` | `createdAt` | Direct (ISO string) | ✅ |

### Cell Renderer Field Access (contacts-data-grid.tsx)

| Renderer | Accesses | Matches API? |
|----------|----------|--------------|
| `firstName` | `row.contactPerson`, `row.firstName`, `row.lastName` | ✅ |
| `lastName` | `row.lastName` | ✅ |
| `email` | `row.email` | ✅ |
| `phone` | `row.phone` | ✅ |
| `companyName` | `getAccountName(row)` | ✅ |
| `status` | `row.status` | ✅ |
| `source` | `row.source` | ✅ |
| `assignedUserId` | `getAssignedUserName(row.assignedUserId)` | ✅ |
| `accountId` | `getAccountName(row)` | ✅ |
| `createdAt` | `row.createdAt` | ✅ |

**All 10 columns verified. No mismatches.**

---

## Module: Accounts (10 columns)

### Backend List API: `GET /api/v1/crm/accounts`
- **Prisma model:** `Account`
- **Repository:** `companies.repository.ts` → `prisma.account.findMany`
- **Includes:** `assignedUser { id, firstName, lastName }`
- **Adapter:** `organization.adapter.ts` → `toFrontendOrg()`

### Field Mapping

| Column ID | API Response Field | Adapter Mapping | Status |
|-----------|-------------------|-----------------|--------|
| `name` | `name` | Direct | ✅ |
| `industry` | `industry` | Direct | ✅ |
| `customerType` | `customerType` | Direct | ✅ |
| `size` | `size` | Direct | ✅ |
| `city` | `city` | Direct | ✅ |
| `country` | `country` | Direct | ✅ |
| `assignedUserId` | `assignedUserId` + `assignedUser` (included) | Lookup via prop | ✅ |
| `website` | `website` | Direct | ✅ |
| `tags` | `tags` (String[]) | Direct | ✅ |
| `createdAt` | `createdAt` | Direct (ISO string) | ✅ |

### Cell Renderer Field Access (accounts-data-grid.tsx)

| Renderer | Accesses | Matches API? |
|----------|----------|--------------|
| `name` | `row.name`, `row.city`, `row.country` | ✅ |
| `industry` | `row.industry` | ✅ |
| `customerType` | `row.customerType` | ✅ |
| `size` | `row.size` | ✅ |
| `city` | `row.city` | ✅ |
| `country` | `row.country` | ✅ |
| `assignedUserId` | `getOwnerName(row.assignedUserId)` | ✅ |
| `website` | `row.website` | ✅ |
| `tags` | `row.tags` | ✅ |
| `createdAt` | `row.createdAt` | ✅ |

**All 10 columns verified. No mismatches.**

---

## Module: Deals (10 columns)

### Backend List API: `GET /api/v1/crm/deals`
- **Prisma model:** `Deal`
- **Repository:** `deals.repository.ts` → `prisma.deal.findMany`
- **Includes:** `stage`, `pipeline`, `assignedUser { id, firstName, lastName }`, `leadDeals.lead`
- **Adapter:** `deal.adapter.ts` → `toFrontendDeal()`

### Field Mapping

| Column ID | API Response Field | Adapter Mapping | Status |
|-----------|-------------------|-----------------|--------|
| `title` | `title` | Direct | ✅ |
| `value` | `value` (Float) | Direct | ✅ |
| `stageId` | `stageId` + `stage` (included) | Lookup via `stageNameMap` prop | ✅ |
| `priority` | `priority` (enum) | `toFrontendPriority()` — UPPERCASE→TitleCase | ✅ |
| `assignedUserId` | `assignedUserId` + `assignedUser` (included) | Lookup via prop | ✅ |
| `accountId` | `accountId` → adapter: `organizationId` | `getAccountName(row.organizationId)` | ✅ |
| `expectedCloseDate` | `expectedCloseDate` (DateTime) | Direct (ISO string) | ✅ |
| `leadSource` | `leadSource` | Direct | ✅ |
| `industry` | `industry` | Direct | ✅ |
| `createdAt` | `createdAt` | Direct (ISO string) | ✅ |

### Adapter Notes for Deals

The `deal.adapter.ts` → `toFrontendDeal()` performs these key transformations:
- `backendDeal.organizationId` → `organizationId` and `companyId` (both set)
- `backendDeal.organization?.name` → `companyName`
- `backendDeal.priority` → `toFrontendPriority()` (UPPERCASE→TitleCase)
- `backendDeal.leadDeals` → `contactIds[]` and `contactPerson`

### Cell Renderer Field Access (deals-data-grid.tsx)

| Renderer | Accesses | Matches API? |
|----------|----------|--------------|
| `title` | `row.title`, `row.companyName` | ✅ |
| `value` | `row.value` | ✅ |
| `stageId` | `stageNameMap[row.stageId]` | ✅ |
| `priority` | `row.priority` | ✅ |
| `assignedUserId` | `getAssignedUserName(row.assignedUserId)` | ✅ |
| `accountId` | `getAccountName(row.organizationId)` | ✅ (adapter maps `accountId`→`organizationId`) |
| `expectedCloseDate` | `row.expectedCloseDate` | ✅ |
| `leadSource` | `row.leadSource` | ✅ |
| `industry` | `row.industry` | ✅ |
| `createdAt` | `row.createdAt` | ✅ |

**All 10 columns verified. No mismatches.**

---

## Existing Adapter Files

| File | Role | Modules Using |
|------|------|---------------|
| `contact.adapter.ts` | Lead/Contact API ↔ Frontend type mapping | Leads, Contacts |
| `deal.adapter.ts` | Deal API ↔ Frontend type mapping | Deals |
| `organization.adapter.ts` | Account/Company API ↔ Frontend type mapping | Accounts |
| `pipeline.adapter.ts` | Pipeline/Stage data transforms | Deals (Kanban) |

---

## Key Adapter Transformations

### contact.adapter.ts
- `status`: UPPERCASE (backend) ↔ TitleCase (frontend) via `toBackendStatus()`/`toFrontendStatus()`
- `source` (backend) → `leadSource` + `source` (frontend — both populated)
- `productInterest[]` (backend) → `productInterests[]` + `productInterest` (frontend)
- `firstName` + `lastName` → `contactPerson` (derived display name)

### deal.adapter.ts
- `priority`: UPPERCASE enum (backend) ↔ TitleCase (frontend) via `toBackendPriority()`/`toFrontendPriority()`
- `accountId` (Prisma) / `organizationId` (DTO field name) → `organizationId` + `companyId` (frontend)
- `organization.name` → `companyName` (derived)
- `contactDeals[].contact` → `contactIds[]` + `contactPerson` (derived)
- `expectedCloseDate`: plain date string → ISO datetime via `toISODatetime()` (on create/update)

### organization.adapter.ts
- Mostly 1:1 mapping — field names match between API and frontend
- `tags`: ensures array normalization

---

## Conclusion

**No new adapter mappings are needed.** All column registry IDs map correctly to their
corresponding API response fields, either directly or through the existing adapter layer.

The aspirational columns in the Leads module (groups: Communication, Emails, Calls,
SMS, Notes, Opportunities, Tasks) are intentionally present without backend backing —
they define the future column set and render "—" via the DataGrid em-dash fallback.
This aligns with Requirements 6.6 and 13.6.
