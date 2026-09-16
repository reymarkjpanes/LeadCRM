# LeadCRM — Performance Baseline & Loading Architecture

**Document status:** Post-implementation  
**Date:** September 2026  
**Scope:** Frontend loading architecture redesign — route-scoped data fetching, skeleton system, DataContext startup reduction

---

## Executive Summary

The loading architecture was redesigned from a global startup-load model (13+ API requests on every page load, global fetch-interceptor blocking modal) to a progressive, route-scoped, demand-driven model.

---

## Startup Request Reduction

| Phase | Batch 1 | Batch 1b | Batch 2 | Total |
|---|---|---|---|---|
| **Before** (baseline) | contacts, orgs, deals, pipelines, activities, users, roles, colPrefs | — | tasks, workflows, campaigns, templates, invoices, auditLogs | **13** |
| **After** (current) | orgs, deals, pipelines, users | roles (non-blocking) | tasks, workflows | **7** |

**Reduction: 6 requests eliminated from startup**

### What moved where

| Data | Before | After |
|---|---|---|
| contacts/leads | DataContext Batch 1 (100 records) | `useLeadsData` — loads on `/leads` navigation only, page 1 of 25 |
| activities | DataContext Batch 1 (50 records) | `activities-page.tsx` — loads on `/crm/activities` navigation only |
| column preferences | DataContext Batch 1 | `useColumnPreferences` per module (on module load) |
| campaigns + templates | DataContext Batch 2 (300 records) | `useCampaignsData` — loads on `/campaigns` navigation only |
| invoices | DataContext Batch 2 (100 records) | `useInvoicesData` — loads on `/billing` navigation only |
| auditLogs | DataContext Batch 2 (50 records) | `TimelineDrawer` — loads on-demand when user opens drawer |
| accounts list | DataContext Batch 1 (100 records) via `useAccounts` double-fetch | `useAccounts` via `useModuleData` — single fetch, route-scoped |

---

## Modules Migrated to Route-Scoped Fetching

| Module | Hook | Server-Side Pagination | Server-Side Filters | Background Refresh |
|---|---|---|---|---|
| Leads | `useLeadsData` | ✅ page/pageSize | ✅ status, source, assignedUserId, tab | 60s + focus |
| Accounts | `useAccounts` (via `useModuleData`) | ✅ page/pageSize | ✅ industry, type, assignedUserId | 60s + focus |
| Campaigns + Templates | `useCampaignsData` | — (full list, ≤200) | — | 2min + focus |
| Invoices (contract list) | `useInvoicesData` | — (full list, ≤100) | — | 5min + focus |
| Activities | `activities-page.tsx` (own fetch) | ✅ | ✅ type, dateRange, userId | — |
| Billing subscription | `useBillingData` | — | — | — |

---

## Modules Still in DataContext (cross-module consumers)

These require a future migration pass — each has 4+ consumers making isolated removal unsafe:

| Data | Batch | Reason for retention |
|---|---|---|
| organizations | Batch 1 (100 records) | RecordPanelWrappers, deals-page, contacts-page, global-omnibox |
| deals (flat list) | Batch 1 (100 records) | dashboard, reports, sidebar, command-palette, leads-table |
| pipelines | Batch 1 (all) | 9 consumers: pipeline-page, deals-page, dashboard, reports, forms |
| users | Batch 1 (200 records) | 15+ consumers for assignee pickers |
| tasks | Batch 2 (100 records) | dashboard, RecordPanelWrappers, deals-page, leads-table |
| workflows | Batch 2 (200 records) | workflows-page, campaign-builder, settings |

---

## UI Loading Experience

| Before | After |
|---|---|
| "Processing Request / Please wait..." global blocking modal on every API call >1s | ❌ Removed entirely |
| Dashboard fake 700ms setTimeout delay | ❌ Removed — data-driven isLoading |
| Dashboard handleRefresh 800ms fake delay | ❌ Removed — immediate |
| No route-level loading states | ✅ 18 `loading.tsx` files covering all major routes |
| No skeleton on Leads page | ✅ `DataLoadingSkeleton` while initial fetch runs |
| No skeleton on Accounts page | ✅ `DataLoadingSkeleton` while initial fetch runs |
| No skeleton on Campaigns page | ✅ `DataLoadingSkeleton` while initial fetch runs |
| No skeleton on Billing page | ✅ `DataLoadingSkeleton` while initial fetch runs |
| No skeleton on Pipeline (during chunk load) | ✅ `KanbanBoardSkeleton` |

---

## Server-Side Filter Integration

| Module | Filter fields (server-side) | Filter fields (client-side only) |
|---|---|---|
| Leads | status, source (leadSource), assignedUserId, tab (my/active) | touched/untouched flags, has_email, has_phone |
| Accounts | industry, type (size), assignedUserId | has_deals (no DB field) |

Backend filter parser: `backend/src/shared/helpers/filter-parser.ts`  
Format: `filter[field]=operator:value` (e.g. `filter[status]=in:Hot,Warm`)  
Security: allowlist-enforced per repository — disallowed fields are silently dropped

---

## Sidebar Badge Counts

Badge counts are no longer derived from DataContext arrays at startup:

| Mode | Source |
|---|---|
| Real-API | `useModuleCounts` — fetches `GET /crm/leads?page=1&pageSize=1` (meta.total only), cached 5 min |
| Mock | DataContext contacts/orgs/deals arrays (unchanged) |

Cache is cleared on logout via `clearModuleCountsCache()` — ensures tenant isolation across sessions.

---

## Shared Infrastructure Added

| File | Purpose |
|---|---|
| `shared/hooks/use-route-data.ts` | SWR boilerplate primitive (mountedRef, hasLoadedOnce, interval, focus) |
| `shared/hooks/use-module-counts.ts` | Lightweight count cache for sidebar badges |
| `shared/hooks/use-module-data.ts` | Server-paginated data hook (already existed, now wired to pages) |
| `shared/components/kanban-skeleton.tsx` | Pipeline board loading skeleton |
| `backend/src/shared/helpers/filter-parser.ts` | Backend filter[field]=operator:value parser |

---

## Performance Objectives (Targets)

These are architectural targets, not measured numbers (measurement requires a running backend):

| Metric | Before | Target |
|---|---|---|
| Startup API requests | 13 | ≤7 (achieved: 7) |
| Leads page API calls on navigation | 8 (part of global batch) | 1 (achieved: 1 paginated request) |
| Records held in memory per paginated module | 100 (full dataset) | 25 (one page) |
| Global blocking modal appearances | Every request >1s | 0 (achieved: removed) |
| Artificial loading delays | 2 (700ms + 800ms) | 0 (achieved: removed) |
| Server-side filter fields (leads) | 0 (all client-side) | 3 (status, source, owner — achieved) |
| Server-side filter fields (accounts) | 0 (all client-side) | 3 (industry, type, owner — achieved) |

---

## Performance Budget (enforced by code review)

- No CRM data loads at startup beyond Batch 1 (orgs, deals, pipelines, users) + Batch 2 (tasks, workflows)
- Paginated modules default to pageSize=25, max 100
- Search sent to server after 300ms debounce — no client-side array filtering for paginated modules
- No artificial setTimeout delays anywhere in loading paths
- No global loading overlays
- Sidebar badge counts via lightweight count-only endpoint (not full dataset)
- Cache keys implicitly tenant-safe (authenticated HttpOnly cookie)
- `clearModuleCountsCache()` called on logout

---

## Test Coverage for Loading Architecture

| Test File | What it covers |
|---|---|
| `use-leads-data.property.test.ts` | isInitialLoad / isRefreshing state machine (15 tests) |
| `use-leads-data-background-refresh.test.ts` | Interval scheduling, cleanup, SWR data preservation (13 tests) |
| `use-accounts.test.ts` | Loading flags, archive filter, tenant isolation, SWR (16 tests) |
| `use-campaigns-data.test.ts` | Loading flags, archive filter, SWR (13 tests) |
| `use-invoices-data.test.ts` | Loading flags, KPI computations, SWR (16 tests) |
| `use-route-data.test.ts` | Shared SWR primitive (14 tests) |
| `use-module-counts.test.ts` | Cache TTL, isolation, tenant-safe clearing (23 tests) |
| `kanban-skeleton.test.tsx` | Accessibility, structure, dark mode, reduced motion (12 tests) |
| `command-palette.test.ts` | RBAC access rules, enabled flag, query filtering (21 tests) |
| `dashboard-lead-count.test.ts` | totalLeadsCount derivation (mock/real modes) (16 tests) |
| `sidebar-badge-counts.test.ts` | Badge derivation (path routing, archived exclusion) (18 tests) |
| `timeline-drawer-audit-mapping.test.ts` | Audit field mapping, relevance filter (17 tests) |
| `filter-parser.test.ts` (backend) | Parse + build Prisma filters, injection prevention (22 tests) |

**Total new tests: ~196 across 13 test files**
