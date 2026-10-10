> Historical project/design record, not current implementation guidance. Retired SaaS access and billing descriptions below must not be implemented. Current authority: `docs/authentication.md`, `docs/crm-environments.md`, and `docs/internal-crm-cleanup.md`.

# LeadCRM — Repository Cleanup & Frontend Modernization
## Kiro Implementation Prompt v2.0

**Project:** LeadCRM — SaaS-Based Progressive Web CRM System  
**Repository:** https://github.com/reymarkjpanes/LeadCRM  
**Stack:** Next.js · React · TypeScript · Tailwind CSS · shadcn/ui · Express.js · PostgreSQL · Prisma · PWA

---

## EXECUTION MODEL — READ THIS FIRST

This task runs in controlled gates.

You MUST complete each gate fully before advancing to the next.  
You MUST NOT modify any file during a read-only gate.  
You MUST stop at every STOP GATE, present findings, and wait for explicit user approval.

```
GATE 1 — FULL AUDIT          (read-only, no changes)
GATE 2 — CLEANUP PLAN        (write one file only)
         ↓ STOP — present plan, wait for approval
GATE 3 — DOCS & SKILLS CLEANUP
         ↓ STOP — present results, wait for approval
GATE 4 — FRONTEND AUDIT      (read-only, no changes)
         ↓ STOP — present findings, wait for approval
GATE 5 — FRONTEND IMPLEMENTATION
         ↓ STOP — present changes, wait for approval
GATE 6 — VALIDATION
         ↓ STOP — present final report
```

If the user says **"proceed"** or **"approved"**, advance to the next gate.  
If the user does not say this, wait.

---

## ABSOLUTE SAFETY RULES

The following must never be changed unless explicitly required to fix a defect, remove duplication, or improve maintainability:

- Existing project functionality
- Database schema and migrations
- Backend API contracts
- Authentication and session architecture
- RBAC model and tenant isolation
- CRM workflows (Leads, Deals, Pipeline, Contacts)
- PWA behavior and manifest
- Capstone project scope

| Rule | Description |
|------|-------------|
| RULE 1 | Audit before modifying |
| RULE 2 | Plan before deleting |
| RULE 3 | Never delete unique project knowledge |
| RULE 4 | Never create duplicate documentation |
| RULE 5 | Never create duplicate skills |
| RULE 6 | Prefer consolidation over proliferation |
| RULE 7 | Prefer incremental refactoring over rewrites |
| RULE 8 | Preserve all working functionality |
| RULE 9 | Do not change the capstone scope |
| RULE 10 | Do not introduce new technologies not already in the stack |
| RULE 11 | Do not replace working stack choices just because something newer exists |
| RULE 12 | Do not optimize prematurely — identify a concrete reason first |
| RULE 13 | Do not hide errors |
| RULE 14 | Do not mark any task complete without running actual validation |
| RULE 15 | Document every architectural decision with its consequences |
| RULE 16 | When uncertain, inspect all references before making a destructive decision |

---

## GATE 1 — FULL REPOSITORY AUDIT (READ-ONLY)

Inspect the complete repository. Do not modify anything during this gate.

**Inspect every location:**

```
frontend/
backend/
.kiro/
docs/
data/
design-system/
middleware.ts
next.config.ts
tailwind.config.ts
tsconfig.json
package.json (frontend)
package.json (backend)
```

**Identify the current source of truth for:**

- Project requirements
- Architecture decisions
- Frontend standards
- Backend standards
- Database standards
- API contracts
- UX/UI standards
- Security standards
- Accessibility standards
- Testing strategy
- Deployment process

**During the audit, record:**

A. Every documentation file (.md, .txt, specifications) and its purpose  
B. Every Kiro skill under `.kiro/skills/` and its purpose  
C. Every duplicate pattern (components, hooks, API functions, utility functions, types)  
D. Every dead file (unused imports, exports, files not referenced anywhere)  
E. What is stored in DataContext and whether it is server state or UI state  
F. Every data-fetching pattern in use (useEffect/fetch, Context, API helpers, Server Components)  
G. Every error-handling pattern  
H. Every loading-state pattern  
I. Pipeline/DnD current implementation and known issues  
J. Authentication flow from login through tenant resolution to RBAC  
K. Bundle composition — which heavy libraries are imported globally vs per-route

**Classify every documentation file:**

| Category | Meaning |
|----------|---------|
| A | Current source of truth |
| B | Current but should be merged into another file |
| C | Historical / archive |
| D | Outdated / obsolete |
| E | Duplicate |
| F | Temporary / generated |
| G | Required by tooling |
| H | Unknown — requires careful review |

**Classify every Kiro skill:**

| Category | Meaning |
|----------|---------|
| A | Active and correct |
| B | Active but overlaps with another skill |
| C | Active but contains outdated instructions |
| D | Obsolete |
| E | Redundant — subset of another skill |

---

## GATE 2 — CREATE THE CLEANUP PLAN

After completing Gate 1, create exactly one file:

**`docs/REPOSITORY-CLEANUP-PLAN.md`**

This document must contain:

1. Current repository problems — honest assessment, no sugarcoating
2. Documentation inventory table
3. Skills inventory table
4. Files to merge — specify destination
5. Files to archive — specify reason
6. Files to delete — specify reason and confirm references checked
7. Files to preserve — specify reason
8. Frontend architecture findings
9. State management findings
10. Performance findings
11. New canonical documentation structure
12. New canonical skills structure
13. Migration strategy
14. Risks
15. Validation checklist

**Documentation inventory format:**

| File | Category | Purpose | Duplicate Of | References | Action |
|------|----------|---------|--------------|------------|--------|

**Skills inventory format:**

| Skill | Purpose | Dependencies | Overlaps With | Status | Action |
|-------|---------|--------------|--------------|--------|--------|

**Frontend audit format:**

| Area | Current State | Problem | Severity | Recommended Change |
|------|--------------|---------|----------|--------------------|

---

### STOP GATE 1

After creating `REPOSITORY-CLEANUP-PLAN.md`, **stop completely**.

Present to the user:

- Summary of all problems found
- Complete list of files proposed for deletion
- Complete list of files proposed for merging
- Complete list of frontend changes proposed
- Any identified risks

**Do not proceed to Gate 3 until the user explicitly approves.**

---

## GATE 3 — DOCUMENTATION AND SKILLS CLEANUP

After approval, execute the approved plan.

### Documentation Cleanup

1. Merge duplicate documentation into the canonical file
2. Archive or remove outdated files per the approved plan
3. Update every reference to moved or renamed files
4. Update every internal link
5. Ensure every topic has exactly **one** canonical source of truth

**Target structure (reuse existing folders where practical):**

```
docs/
├── README.md
├── architecture/
├── frontend/
├── backend/
├── database/
├── api/
├── security/
├── testing/
├── deployment/
├── ux/
└── decisions/
```

The goal is: **fewer files, fewer sources of truth, less duplication, clear ownership.**

Do NOT create folders that do not already have content to put in them.

### Skills Cleanup

1. Inspect every skill under `.kiro/skills/`
2. Merge skills that substantially overlap into one
3. Remove skills that are obsolete
4. Consolidate skills that are subsets of another skill
5. Move generic project standards into `docs/` and reference them from skills — do not duplicate them inside skill files

**Wrong pattern — duplicating standards across skills:**

```
skill-frontend.md   → 300 lines of frontend standards
skill-performance.md → 250 lines of the same frontend standards
skill-api.md        → 200 lines of the same frontend standards
```

**Right pattern — single source of truth:**

```
docs/frontend/standards.md   ← canonical
skill-frontend.md            → references docs/frontend/standards.md
```

### After Cleanup

Search the entire repository for references to every deleted or moved file.  
Fix every broken reference.  
Fix every broken link.  
Update every Kiro instruction that pointed to moved files.  
Do not leave any dead references.

---

### STOP GATE 2

Present to the user:

- Complete list of documentation files removed
- Complete list of documentation files merged
- Complete list of skills removed
- Complete list of skills merged
- Confirmation that zero broken references remain

**Do not proceed to Gate 4 until the user explicitly approves.**

---

## GATE 4 — FRONTEND ARCHITECTURE AUDIT (READ-ONLY)

Perform a deep frontend audit. Do not modify any code during this gate.

### Component Architecture

- How many components use `'use client'` unnecessarily?
- Are Server Components used where data can be fetched on the server?
- Is the `'use client'` boundary narrow or does it wrap entire pages?
- Are there large Client Component trees that could be split?

### State Management

For every piece of state in DataContext, classify it:

| Category | Description |
|----------|-------------|
| SERVER STATE | Data owned by the backend — leads, deals, users, pipelines, etc. |
| UI STATE | Temporary interface state — modal open, selected tab, sidebar collapsed |
| URL STATE | State that should survive refresh — search, filters, pagination, sort |
| FORM STATE | Managed by React Hook Form |
| AUTH STATE | Session and user identity |
| DERIVED STATE | Computed from other state |

Determine:

- What is currently stored in DataContext?
- What should move to TanStack Query?
- What should become URL state?
- What should remain as local useState?

### Data Fetching

Identify every data fetching pattern in use and for each one determine:

- Does it handle loading state correctly?
- Does it handle error state correctly?
- Does it handle empty state correctly?
- Is the result cached?
- Are duplicate requests possible?
- Is pagination implemented?
- Is search debounced?

### Performance

Identify:

- Large dependencies loaded globally that should be lazy-loaded
- Client Components that could become Server Components
- Missing dynamic imports for route-specific heavy libraries
- Missing debounce on search inputs
- Missing request cancellation
- Large table renders without pagination or virtualization
- Expensive calculations inside render

**Pay particular attention to these libraries:**

| Library | Question |
|---------|---------|
| Three.js / React Three Fiber | Loaded globally or only on 3D routes? |
| Chart.js | Loaded globally or only on dashboard/analytics routes? |
| DnD Kit | Loaded globally or only on pipeline pages? |
| Motion | Global or scoped? |

### Pipeline / DnD

- Does drag trigger multiple API calls?
- Does it use optimistic updates with rollback?
- Does it handle empty pipeline, concurrent modification, unauthorized move, network failure?

### Error Handling

- Is there a centralized `ApiError` class?
- Are HTTP status codes handled with different messages?
- Are user-facing messages meaningful, not raw stack traces?
- Are server validation errors shown inline in forms?

### Authentication

- Confirm the full flow: login → session → tenant → role → permissions → protected route
- Middleware configuration
- Session expiry behavior
- Protected route redirects

---

### STOP GATE 3

Present the full frontend audit report.  
List every proposed change with severity (CRITICAL / HIGH / MEDIUM / LOW).

**Do not proceed to Gate 5 until the user explicitly approves.**

---

## GATE 5 — FRONTEND IMPLEMENTATION

After approval, implement changes in this order. After each area, run TypeScript check and verify the affected feature still works before moving to the next.

```
1. State management
2. Data fetching and API layer
3. Error handling
4. Loading / empty / error states
5. Forms
6. Performance optimizations
7. Pipeline stabilization
8. UX consistency
9. Accessibility
10. PWA
```

Apply every standard from the **Frontend Engineering Standards** section below.

---

### STOP GATE 4

Present to the user:

- Every file changed
- Every pattern introduced or removed
- TypeScript check result after changes
- Any regressions identified and fixed

**Do not proceed to Gate 6 until the user explicitly approves.**

---

## GATE 6 — VALIDATION

Run full validation after Gate 5.

```bash
# TypeScript
npx tsc --noEmit

# Lint
npx eslint .

# Production build
npm run build

# Tests
npm test
```

**Verify these critical workflows still function after all changes:**

**Authentication**
- [ ] Login
- [ ] Registration
- [ ] Email verification
- [ ] Session persistence across refresh
- [ ] Session expiry redirects to login
- [ ] Logout

**Authorization**
- [ ] Protected routes redirect unauthenticated users
- [ ] RBAC hides unauthorized UI elements
- [ ] Backend still rejects unauthorized API requests independently

**CRM Core**
- [ ] Create lead
- [ ] Edit lead
- [ ] Change lead status
- [ ] Delete lead with confirmation dialog
- [ ] Create contact
- [ ] Create deal
- [ ] Create pipeline
- [ ] Create stage
- [ ] Move deal between stages
- [ ] Pipeline DnD works with optimistic update
- [ ] Pipeline DnD rolls back correctly on failure

**Dashboard**
- [ ] Metrics load
- [ ] Charts load
- [ ] Dashboard does not block rendering while one section is slow

**PWA**
- [ ] Manifest is valid
- [ ] Service worker registers
- [ ] App is installable
- [ ] Offline state shows a meaningful message

**Final duplication check — search repository for:**

- Duplicate documentation
- Duplicate skills
- Duplicate components
- Duplicate API functions
- Duplicate validation schemas
- Duplicate types
- Dead imports
- Dead files
- Stale documentation references
- Broken internal links

---

### STOP GATE 5 — FINAL REPORT

Present the full final report in this format:

```
## Repository Cleanup
- Files removed: N
- Files merged: N
- Files archived: N
- Files retained: N
- Final documentation structure

## Kiro Skills
- Skills removed: N
- Skills merged: N
- Skills retained: N
- Final skill structure

## Frontend Changes
- State management
- Data fetching
- API layer
- Performance
- UX improvements
- Error handling
- PWA
- Accessibility

## Critical Issues Found and Fixed
[List every defect discovered and resolved]

## Remaining Issues
[List anything that could not be safely fixed — be specific]

## Validation Results
- TypeScript: PASS / FAIL — [details]
- Lint: PASS / FAIL — [details]
- Build: PASS / FAIL — [details]
- Tests: PASS / FAIL — [details]
- Critical workflows: PASS / FAIL — [details]
```

Do not claim success for anything that was not actually run and validated.

---

---

# FRONTEND ENGINEERING STANDARDS

These standards govern every frontend implementation decision in LeadCRM.  
Apply these as rules, not suggestions.

---

## STATE ARCHITECTURE

Separate three distinct categories of state. Never mix them.

### Server State — data owned by the backend

Examples: Leads, Contacts, Deals, Pipelines, Stages, Users, Roles, Permissions, Campaigns, Workflows, Billing, Dashboard metrics.

**Manage server state with TanStack Query.**  
Never use `useState` to store server data.  
Never use Context as a server-state cache.

### UI State — temporary interface state

Examples: `isModalOpen`, `selectedTab`, `sidebarCollapsed`, `activeFilter`, `draggedDeal`.

**Use `useState()` or `useReducer()`.**

### URL State — state that survives browser refresh and can be shared

Examples: `?page=2&status=HOT&search=John&pipeline=123&sort=createdAt`

**Use URL search parameters for CRM filter, search, and pagination state.**

This lets users share filtered views and prevents filter loss on refresh.

---

## SERVER COMPONENTS vs CLIENT COMPONENTS

Use Server Components by default. Add `'use client'` only when the component requires:

- `useState` or `useReducer`
- Event handlers (`onClick`, `onChange`, etc.)
- Browser APIs (`window`, `navigator`, `localStorage`)
- `useEffect`
- Context consumers that rely on the above

**Keep the `'use client'` boundary as narrow as possible.**

**Wrong — entire page becomes a Client Component:**

```tsx
'use client';
export default function Dashboard() {
  // 800 lines of mixed server and client logic
}
```

**Right — narrow boundary:**

```tsx
// app/dashboard/page.tsx — Server Component
export default async function DashboardPage() {
  const initialData = await getDashboardData();
  return <DashboardClient initialData={initialData} />;
}

// features/dashboard/components/DashboardClient.tsx
'use client';
export function DashboardClient({ initialData }: { initialData: DashboardData }) {
  const [period, setPeriod] = useState('30d');
  // only the interactive part lives here
}
```

---

## TANSTACK QUERY

Install TanStack Query if not already present. Configure a `QueryProvider` wrapping the app.

Every server-state **read** uses `useQuery`.  
Every server-state **write** (create, update, delete) uses `useMutation`.

### Query Key Structure

Use domain-specific, structured keys. Never use generic keys like `['data']`.

```ts
['leads']
['leads', leadId]
['leads', { status, search, page }]
['deals', pipelineId]
['pipelines']
['users']
['roles']
['permissions']
['dashboard', period]
```

### Caching Strategy

| Data | staleTime |
|------|-----------|
| Permissions | 15 minutes |
| Roles | 10 minutes |
| Pipeline definitions | 5 minutes |
| Pipeline stages | 5 minutes |
| Leads | 30 seconds |
| Deals | 30 seconds |
| Dashboard metrics | 60 seconds |
| Campaigns | 60 seconds |
| Billing | 5 minutes |

### Mutations — invalidate only affected queries

```ts
const createLead = useMutation({
  mutationFn: createLeadRequest,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['leads'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    toast.success('Lead created successfully.');
  },
  onError: (error) => {
    toast.error(getApiErrorMessage(error));
  },
});
```

Never do this — it refetches everything unnecessarily:

```ts
queryClient.invalidateQueries(); // ❌
```

---

## PIPELINE — OPTIMISTIC UPDATES WITH ROLLBACK

The pipeline drag-and-drop must use optimistic updates. UI moves immediately on drag. If the API fails, the move rolls back and the user is notified.

```ts
const moveDeal = useMutation({
  mutationFn: moveDealRequest,

  onMutate: async ({ dealId, stageId }) => {
    await queryClient.cancelQueries({ queryKey: ['deals'] });
    const previous = queryClient.getQueryData(['deals']);
    queryClient.setQueryData(['deals'], old =>
      moveDealLocally(old, dealId, stageId)
    );
    return { previous };
  },

  onError: (_error, _variables, context) => {
    queryClient.setQueryData(['deals'], context?.previous);
    toast.error('Unable to move deal. Your changes were not saved.');
  },

  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['deals'] });
  },
});
```

**During drag, never call the API repeatedly.** Call exactly one mutation on drop.

**Handle these pipeline edge cases explicitly:**

- No stages / empty pipeline
- No deals in a stage (empty column)
- Unauthorized move attempt
- Network failure during move
- Concurrent modification by another user

---

## API LAYER

Never scatter `fetch()` calls inside components. Create a layered API architecture.

```
Component → Hook → API function → apiClient → Express endpoint
```

### Centralized API client

```ts
// lib/api/client.ts
export async function apiClient<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  return response.json();
}
```

### Domain-specific API functions

```ts
// features/leads/api/getLeads.ts
export function getLeads(params: LeadFilters) {
  const search = new URLSearchParams();
  if (params.search) search.set('search', params.search);
  if (params.status) search.set('status', params.status);
  if (params.page)   search.set('page', String(params.page));
  return apiClient<LeadResponse>(`/api/v1/crm/leads?${search}`);
}
```

---

## ERROR HANDLING

### ApiError class

```ts
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

### Handle errors by status code

```ts
function getApiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'An unexpected error occurred. Please try again.';
  }

  switch (error.status) {
    case 401: return 'Your session has expired. Please log in again.';
    case 403: return 'You do not have permission to perform this action.';
    case 404: return 'The requested resource was not found.';
    case 409: return 'A conflict occurred. The data may have changed.';
    case 422: return 'Please check your inputs and try again.';
    case 429: return 'Too many requests. Please wait a moment and try again.';
    case 500:
    default:  return 'A server error occurred. Please try again later.';
  }
}
```

Never show raw backend error objects or stack traces to users.

### Retry strategy

```ts
retry: (failureCount, error) => {
  // Never retry client errors
  if (error instanceof ApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429) {
    return false;
  }
  return failureCount < 2;
}
```

---

## LOADING, EMPTY, AND ERROR STATES

Every data-dependent view must handle all four states:

- `isPending` → show skeleton (not a spinner)
- `error` → show error state with retry
- data is empty → show empty state with a call to action
- `isFetching` (background refresh with cached data) → show a subtle indicator only, not a full skeleton replacement

**Wrong — handles happy path only:**

```tsx
if (data) {
  return <LeadTable leads={data.items} />;
}
```

**Right — handles all states:**

```tsx
if (isPending) {
  return <LeadTableSkeleton />;
}

if (error) {
  return (
    <ErrorState
      title="Unable to load leads"
      action={<Button onClick={() => refetch()}>Try again</Button>}
    />
  );
}

if (!data?.items.length) {
  return (
    <EmptyState
      title="No leads yet"
      description="Start building your sales pipeline by adding your first lead."
      action={<Button>Add Lead</Button>}
    />
  );
}

return (
  <>
    {isFetching && <RefreshingIndicator />}
    <LeadTable leads={data.items} />
  </>
);
```

`isPending` means no data exists yet.  
`isFetching` means data exists but a background refresh is running.  
These produce different UI behavior — use them correctly.

**Empty states for new tenants must include a call to action.** A brand-new tenant will have zero leads, zero deals, zero campaigns. Never show "No data." — show what to do next.

---

## FORMS

Every form uses React Hook Form + Zod.

```ts
const schema = z.object({
  name:    z.string().min(2, 'Name must be at least 2 characters'),
  email:   z.string().email('Please enter a valid email'),
  company: z.string().min(2, 'Company name is required'),
});

type FormData = z.infer<typeof schema>;

const form = useForm<FormData>({
  resolver: zodResolver(schema),
});
```

Every form must:

- Disable the submit button while `isPending`
- Show a loading label on the submit button during submission
- Preserve all field values when an API error occurs — never reset the form on failure
- Show server validation errors inline next to the relevant field
- Show success feedback (toast) on completion
- Prevent double submission

```tsx
<Button type="submit" disabled={mutation.isPending}>
  {mutation.isPending ? 'Creating...' : 'Create Lead'}
</Button>
```

---

## SEARCH AND FILTERS

Never store CRM page filters only in React state. Use URL search parameters.

```
/leads?search=john&status=HOT&page=2&sort=createdAt&direction=desc
```

Debounce search before triggering queries:

```ts
const debouncedSearch = useDebounce(search, 300);

useQuery({
  queryKey: ['leads', { search: debouncedSearch, status, page }],
  queryFn: () => getLeads({ search: debouncedSearch, status, page }),
});
```

Use 250–400ms debounce for CRM search inputs.

---

## PAGINATION

Never fetch all records and filter or sort client-side.

Use server-side pagination on every list endpoint:

```
GET /api/v1/crm/leads?page=1&limit=25
```

The frontend receives only the records it needs to render. Never receive 10,000 records and display 25.

---

## PERFORMANCE

### Dynamic imports for heavy libraries

```ts
const RevenueChart = dynamic(
  () => import('./RevenueChart'),
  { loading: () => <ChartSkeleton /> }
);
```

**Three.js / React Three Fiber must not be in the critical bundle** if it is only used on the authentication or landing page hero. Lazy-load it.

**Chart.js must not be imported on routes that have no charts.**

**DnD Kit must not be imported on pages with no drag-and-drop.**

### useTransition for expensive UI updates

```ts
const [isPending, startTransition] = useTransition();

function applyFilter(value: string) {
  startTransition(() => {
    setFilter(value);
  });
}

{isPending && <SmallSpinner />}
```

Use this for complex CRM filter changes that cause expensive re-renders.

### Do not render thousands of rows

Use server-side pagination. Virtualization is only required if you have a legitimate reason to render a long scrollable list without pagination (e.g., audit logs).

### Measure before optimizing

Do not apply `useMemo`, `useCallback`, or `memo` everywhere by default. Identify the expensive render first, then apply the optimization.

---

## TYPE SAFETY

Never use `any` for API responses.

```ts
export type LeadStatus =
  | 'HOT'
  | 'WARM'
  | 'COLD'
  | 'CANCELLED'
  | 'CLOSED';

export interface Lead {
  id:        string;
  name:      string;
  email:     string;
  status:    LeadStatus;
  score:     number;
  createdAt: string;
}
```

Use Zod for runtime API response validation. TypeScript only protects at compile time — Zod protects at runtime against malformed API responses.

---

## STATUS DISPLAY SYSTEM

All CRM statuses must use a single shared configuration. Never display HOT / Hot / hot / hotlead inconsistently.

```ts
const leadStatusConfig = {
  HOT:       { label: 'Hot',       icon: Flame,        color: 'text-red-500'    },
  WARM:      { label: 'Warm',      icon: Thermometer,  color: 'text-orange-500' },
  COLD:      { label: 'Cold',      icon: Snowflake,    color: 'text-blue-400'   },
  CANCELLED: { label: 'Cancelled', icon: XCircle,      color: 'text-gray-400'   },
  CLOSED:    { label: 'Closed',    icon: CheckCircle,  color: 'text-green-500'  },
} as const;
```

Every component that renders a lead status imports from this single config.

---

## FORMATTING UTILITIES

Create shared formatting functions. Never repeat formatting logic across components.

```ts
formatCurrency(value, currency?)
formatDate(date, format?)
formatRelativeTime(date)
formatPhoneNumber(phone)
formatPercentage(value)
```

```ts
export function formatCurrency(value: number, currency = 'PHP') {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency,
  }).format(value);
}
```

---

## DESTRUCTIVE ACTIONS

All destructive actions require a confirmation dialog before executing:

- Delete pipeline
- Delete workflow
- Delete stage
- Archive lead
- Deactivate user
- Cancel subscription

The dialog must:

- Clearly describe what will happen
- Explain consequences (e.g., "Existing deals may be affected")
- Require an explicit affirmative click
- Show loading state while executing

---

## TOAST NOTIFICATIONS

Use toasts for lightweight, non-critical success feedback:

```
Lead created successfully.
Pipeline stage updated.
Workflow activated.
User deactivated.
```

Do **not** use toasts as the only indication of important errors. Payment failures, authentication failures, and data loss risks require inline error states, not just a toast.

---

## SECURITY

- Never put secrets in `NEXT_PUBLIC_` variables — anything prefixed with `NEXT_PUBLIC_` is exposed to the browser
- Never render unsanitized HTML with `dangerouslySetInnerHTML` without explicit sanitization
- Never trust frontend permission checks as a security boundary — the backend enforces authorization
- Never store authentication tokens in `localStorage`
- Never derive tenant identity from client-side state

**Frontend RBAC is UX only:**

```tsx
{hasPermission(user, 'deals.create') && (
  <Button>Create Deal</Button>
)}
```

The Express API validates the same permission independently for every request. The frontend hiding a button does not protect the operation.

---

## PWA STANDARDS

**Safe to cache aggressively:** App shell, icons, fonts, static CSS, static JS, public images.

**Do not cache without careful design:** Private CRM data — leads, deals, contacts, billing, any user-specific or tenant-specific data. Incorrect caching can serve Tenant A's data to Tenant B.

**Offline behavior must be explicit:**

```
You are currently offline.
Changes cannot be saved until your connection is restored.
[Retry]
```

Do not implement offline data synchronization unless the project requirements explicitly call for it and the architecture supports safe conflict resolution.

---

## ACCESSIBILITY

Every interactive element must be reachable by keyboard.

**Wrong:**

```tsx
<div onClick={openModal}>Open</div>
```

**Right:**

```tsx
<button type="button" onClick={openModal}>Open</button>
```

Every form field must have an associated `<label>`.  
Every dialog must trap focus on open and restore focus on close.  
Every image must have descriptive `alt` text.  
Color must not be the only indicator of status — pair it with a label or icon.  
Provide visible focus states for all interactive elements.  
Respect `prefers-reduced-motion`.

---

## DATA FLOW RULE

This is the most important architectural rule for LeadCRM.

```
DATABASE
   ↓
EXPRESS API — business rules, authorization, validation
   ↓
TANSTACK QUERY — server-state cache
   ↓
REACT UI
   ├── UI state (useState, useReducer)
   └── URL state (searchParams)
```

The frontend must never become the business logic layer.  
The Express API validates and enforces every business rule independently.  
Never assume that hiding a button in the UI protects the underlying operation.

---

*LeadCRM Kiro Prompt v2.0 — Repository cleanup, documentation consolidation, skills consolidation, frontend modernization.*
