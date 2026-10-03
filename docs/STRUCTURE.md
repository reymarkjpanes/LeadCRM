# LeadCRM — Project Structure

## Monorepo Root

```
leadcrm/
├── frontend/              ← @leadcrm/frontend  (Next.js 15)
├── backend/               ← @leadcrm/backend   (Node.js + Express)
├── shared/                ← @leadcrm/shared    (types, RBAC, contracts, validation)
├── infrastructure/        ← Docker, Nginx, deployment scripts
├── docs/                  ← All project documentation
├── .github/               ← GitHub Actions CI/CD
├── package.json           ← Turborepo workspaces root
├── turbo.json             ← Build pipeline
├── tsconfig.base.json     ← Shared TypeScript base config
├── .gitignore
└── README.md
```

---

## Frontend (`frontend/`)

```
frontend/
├── app/                          ← Next.js App Router (routing shells ONLY — 3-line imports)
│   ├── layout.tsx
│   ├── page.tsx                  ← Root — redirects to login or dashboard
│   ├── login/page.tsx
│   ├── (tenant)/                 ← CRM portal routes (no URL segment added)
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── crm/
│   │   │   ├── contacts/page.tsx
│   │   │   ├── companies/page.tsx
│   │   │   ├── deals/page.tsx
│   │   │   └── pipeline/page.tsx
│   │   ├── marketing/
│   │   │   ├── campaigns/page.tsx
│   │   │   ├── email/page.tsx
│   │   │   └── templates/page.tsx
│   │   ├── operations/
│   │   │   ├── service-orders/page.tsx
│   │   │   ├── tasks/page.tsx
│   │   │   ├── taskboard/page.tsx
│   │   │   ├── assets/page.tsx
│   │   │   └── inventory/page.tsx
│   │   ├── automation/
│   │   │   └── workflows/page.tsx
│   │   ├── reporting/page.tsx
│   │   ├── settings/page.tsx
│   │   └── administration/
│   │       ├── users/page.tsx
│
├── src/
│   ├── features/                 ← ALL business feature code
│   │   ├── tenant/               ← CRM portal — domain module layout
│   │   │   ├── crm/
│   │   │   │   ├── contacts/     ← ui/ hooks/ services/ schemas/ types/ constants/ index.ts
│   │   │   │   │   └── ui/
│   │   │   │   │       ├── contact-profile-tabs.tsx   ← Deals tab: summary bar, contactIds-first matching, real stage tracker
│   │   │   │   │       ├── contact-detail-sheet.tsx
│   │   │   │   │       ├── contact-detail-view.tsx
│   │   │   │   │       ├── customer-journey-timeline.tsx ← Customer timeline progression
│   │   │   │   │       ├── contact-form.tsx
│   │   │   │   │       └── tabs/
│   │   │   │   ├── companies/
│   │   │   │   ├── deals/            ← standalone deals table page
│   │   │   │   └── pipeline/
│   │   │   │       ├── PipelinePage.tsx    ← Kanban + table + list, @dnd-kit, 14-filter system
│   │   │   │       ├── hooks/
│   │   │   │       │   └── use-pipeline.ts
│   │   │   │       ├── services/
│   │   │   │       │   └── pipeline.service.ts
│   │   │   │       └── ui/
│   │   │   │           └── deal-details-modal.tsx  ← Reusable Deal Details drawer (7 tabs with ModalCloseButton)
│   │   │   ├── marketing/
│   │   │   │   ├── campaigns/
│   │   │   │   ├── email/
│   │   │   │   └── templates/
│   │   │   ├── automation/
│   │   │   │   └── workflows/
│   │   │   ├── operations/
│   │   │   │   ├── service-orders/
│   │   │   │   ├── tasks/
│   │   │   │   │   ├── TaskBoard.tsx        ← 5-status task board
│   │   │   │   │   └── ui/
│   │   │   │   │       ├── task-details-drawer.tsx ← Reusable task detail view
│   │   │   │   │       └── technician-dashboard.tsx
│   │   │   │   ├── assets/
│   │   │   │   └── inventory/
│   │   │   ├── reporting/
│   │   │   ├── administration/
│   │   │   │   ├── users/
│   │   │   ├── dashboard/
│   │   │   ├── settings/
│   │   │   ├── pages/            ← LandingPage, login shell
│   │   │   └── layout/           ← CrmLayout, sidebar-nav, topbar, account-dropdown, use-layout
│   │   │
│   │
│   ├── shared/                   ← Reusable UI (used throughout the CRM)
│   │   ├── components/
│   │   │   ├── ui/               ← BackButton.tsx, ModalCloseButton.tsx, PageHeader.tsx, ShadCN primitives
│   │   │   ├── charts/           ← ChartComponents.tsx (ONLY chart import source)
│   │   │   ├── TrelloFilter.tsx  ← ONLY filter component to use
│   │   │   ├── SideSheet.tsx     ← Side sheet container with ModalCloseButton
│   │   │   ├── SlidingDrawer.tsx ← Animated drawer container with ModalCloseButton
│   │   │   ├── user-profile-drawer.tsx ← Reusable user profile info drawer
│   │   │   ├── actionable-empty-state.tsx ← Standard empty state layout
│   │   │   ├── EmptyState.tsx
│   │   │   ├── GlobalLoader.tsx
│   │   │   ├── CommandPalette.tsx
│   │   │   ├── NotesSidePanel.tsx
│   │   │   ├── DashboardSkeleton.tsx
│   │   │   └── CountryCodeSelector.tsx
│   │   ├── hooks/
│   │   │   └── useTheme.ts
│   │   ├── providers/
│   │   │   ├── app-providers.tsx
│   │   │   ├── auth-guard.tsx
│   │   │   └── theme-provider.tsx
│   │   └── lib/
│   │       └── route-map.ts
│   │
│   ├── store/                    ← Global state (localStorage phase)
│   │   ├── AuthContext.tsx        ← Auth state + login/logout; tenant from here
│   │   ├── DataContext.tsx        ← Single source of truth for all data ops + audit logging
│   │   │                            updateDeal: auto-appends history with previousStageId
│   │   │                            addTask: seeds first TaskAssignmentRecord on creation
│   │   │                            updateTask: appends TaskAssignmentRecord on reassign
│   │   │                            safeParse helper: resilient localStorage reads
│   │   ├── types.ts               ← Legacy shim — re-exports from types/ only.
│   │   │                            Do NOT define types here. No duplicate definitions.
│   │   ├── types/                 ← Canonical source — always import from here for new code
│   │   │   ├── contact.types.ts
│   │   │   ├── deal.types.ts      ← Deal.history entry has previousStageId?: string
│   │   │   │                        deal.contactIds: string[] (never contactId singular)
│   │   │   ├── user.types.ts
│   │   │   ├── campaign.types.ts
│   │   │   ├── workflow.types.ts  ← WorkflowExecution, WorkflowExecutionStep (3-level)
│   │   │   ├── shared.types.ts    ← Task: TaskStatus (5 values), assignedBy?,
│   │   │   │                        assignmentHistory?: TaskAssignmentRecord[]
│   │   │   │                        Activity: unified timeline entity
│   │   │   └── index.ts           ← Re-exports all types
│   │   └── mockData/             ← Seed data split by domain
│   │       ├── contacts.mock.ts
│   │       ├── deals.mock.ts
│   │       ├── campaigns.mock.ts
│   │       ├── workflows.mock.ts
│   │       ├── users.mock.ts
│   │       ├── service-orders.mock.ts
│   │       └── index.ts
│   │
│   ├── lib/                      ← Utilities
│   │   ├── utils.ts              ← cn() and shared helpers
│   │   ├── constants.ts          ← App-wide constants
│   │   └── countries.ts          ← Country/region data
│   │
│   └── index.css                 ← Global styles + Tailwind v4 @import
│
├── public/                       ← Static assets
│   ├── leadcrm_logo.png
│   ├── manifest.json             ← PWA manifest
│   └── sw.js                     ← Service worker
│
├── package.json                  ← @leadcrm/frontend dependencies
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json                 ← Includes path aliases for monorepo
├── shadcn.json
└── .env.local.example
```

---

## Backend (`backend/`)

```
backend/
├── prisma/
│   ├── schema.prisma             ← Single source of truth for all DB models
│   ├── migrations/               ← Auto-generated by prisma migrate dev
│   └── seed.ts                   ← Entry point for all seeders
│
├── src/
│   ├── modules/                  ← Domain-driven business modules
│   │   ├── crm/
│   │   │   ├── contacts/         ← controller, service, repository, dto, types
│   │   │   ├── companies/
│   │   │   ├── deals/
│   │   │   └── pipeline/
│   │   ├── marketing/
│   │   │   ├── campaigns/
│   │   │   ├── email/
│   │   │   └── templates/
│   │   ├── automation/
│   │   │   ├── workflows/
│   │   │   ├── triggers/
│   │   │   └── actions/
│   │   ├── operations/
│   │   │   ├── service-orders/
│   │   │   └── tasks/
│   │   ├── administration/
│   │   │   ├── users/
│   │   │   ├── roles/
│   │   │   ├── permissions/
│   │   │   └── audit/
│   │   └── reporting/
│   │       └── reports/
│   │
│   ├── integrations/
│   │   ├── gmail/                ← gmail.service.ts, gmail.oauth.ts, gmail.types.ts
│   │
│   ├── core/
│   │   ├── auth/                 ← auth.service.ts, jwt.service.ts
│   │   ├── permissions/          ← permission.registry.ts
│   │   ├── audit/                ← audit.service.ts
│   │   └── tenant/               ← tenant.service.ts
│   │
│   ├── api/
│   │   ├── middleware/           ← auth, rbac, tenant, validate, error, logger, rate-limit
│   │   └── routes/               ← crm, marketing, automation, operations, administration, reporting
│   │
│   ├── database/
│   │   └── seeders/              ← roles.seed.ts, permissions.seed.ts, admin.seed.ts
│   │
│   ├── config/                   ← app.config.ts, database.config.ts, mail.config.ts
│   ├── shared/
│   │   ├── constants/            ← permissions.ts, roles.ts, http-status.ts
│   │   ├── helpers/              ← pagination.ts, date.ts, crypto.ts
│   │   └── errors/               ← app-error.ts, http-error.ts
│   │
│   ├── app.ts                    ← Express app setup
│   └── server.ts                 ← Entry point — env guard + listen
│
├── package.json                  ← @leadcrm/backend dependencies
├── tsconfig.json
└── .env.example
```

---

## Shared Package (`shared/`)

```
shared/
└── src/
    ├── types/
    │   ├── contact.types.ts      ← Contact, ContactStatus
    │   ├── company.types.ts      ← Company
    │   ├── deal.types.ts         ← Deal, Pipeline, Stage, DealPriority
    │   ├── user.types.ts         ← User, UserStatus
    │   ├── campaign.types.ts     ← Campaign, CampaignType, CampaignStatus
    │   ├── tenant.types.ts       ← Tenant, TenantStatus
    │   ├── api.types.ts          ← ApiResponse, PaginatedResponse, PaginationMeta
    │   └── index.ts              ← Re-exports all types
    │
    ├── constants/
    │   ├── roles.ts              ← Workspace role constants
    │   ├── permissions.ts        ← Permission constants (contacts.create, etc.)
    │   └── index.ts
    │
    ├── contracts/
    │   ├── contact.contract.ts   ← CreateContactRequest, ContactListResponse
    │   ├── user.contract.ts      ← CreateUserRequest, AuthResponse
    │   ├── campaign.contract.ts  ← CreateCampaignRequest
    │   └── index.ts
    │
    ├── validation/
    │   ├── contact.schema.ts     ← Zod: ContactSchema, UpdateContactSchema
    │   ├── user.schema.ts        ← Zod: LoginSchema, RegisterSchema, CreateUserSchema
    │   └── index.ts
    │
    └── index.ts                  ← Main barrel export (@leadcrm/shared entry)
```

---

## Infrastructure (`infrastructure/`)

```
infrastructure/
├── docker/
│   ├── Dockerfile.frontend
│   ├── Dockerfile.backend
│   └── docker-compose.yml
├── nginx/
│   └── nginx.conf
└── scripts/
    └── db-migrate.sh
```

---

## Non-Negotiable Rules

### Frontend

- All data ops through `DataContext` — never direct `localStorage` in components
- All charts from `ChartComponents.tsx` only — never recharts
- All filters use `<TrelloFilter>` — never raw `<select>`
- No `tailwind.config.js` — Tailwind v4 uses `@import "tailwindcss"` in CSS
- Animations: `motion/react` only — never `framer-motion`
- `tenantId` on every data record; `addAuditLog()` on every mutation; `addActivity()` on every observable event
- RBAC guard before every create/edit/delete UI element
- `deal.contactIds` is always `string[]` — never `deal.contactId` (singular) for new code
- Path aliases: `@/features/tenant/*`, `@/shared/*`, `@/store/*`, `@/lib/*`

### Backend

- Controller → never touches DB
- Service → never uses `req`/`res`
- Repository → never has business logic, always filters by `tenantId`
- `tenantId` sourced from JWT only — never from request body
- All input validated with Zod before controller executes

### Shared

- Types, RBAC constants, API contracts, and Zod schemas defined once in `shared/`
- Both frontend and backend import from `@leadcrm/shared`
- Never duplicate type definitions across packages

---

## Documentation Index

| [ARCHITECTURE.md](./ARCHITECTURE.md) | System overview, tech stack, dual-portal design, key rules |
| [STRUCTURE.md](./STRUCTURE.md) | This file — full folder map |
| [PORTAL-SEPARATION.md](./PORTAL-SEPARATION.md) | Why two portals, physical separation, routing |
| [API.md](./API.md) | Backend API endpoints reference |
| [dashboard-kpis.md](./dashboard-kpis.md) | KPI formulas — Pipeline Value, Win Rate, Conversion Rate, etc. |
| **workflows/** | |
| [workflows/customer-lifecycle.md](./workflows/customer-lifecycle.md) | Full customer journey from lead to retention |
| [workflows/lead-to-deal.md](./workflows/lead-to-deal.md) | Lead capture → deal creation step-by-step |
| [workflows/pipeline-stage-flow.md](./workflows/pipeline-stage-flow.md) | 4 pipelines, stage rules, velocity, aging indicators |
| [workflows/task-assignment.md](./workflows/task-assignment.md) | Task lifecycle, assignment audit trail, overdue detection |
| **security/** | |
| [security/permission-matrix.md](./security/permission-matrix.md) | Role × module access matrix + granular permission keys |
| [security/audit-log-strategy.md](./security/audit-log-strategy.md) | What gets logged, log entry shape, changeset format |
| **database/** | |
| [database/erd.md](./database/erd.md) | Entity relationships, Prisma model map, migration path |
| **setup/** | |
| [setup/local-dev.md](./setup/local-dev.md) | Local development setup guide |
| [setup/deployment.md](./setup/deployment.md) | Production deployment guide (Vercel + Railway / Render + PostgreSQL) |
| [setup/environment-variables.md](./setup/environment-variables.md) | All environment variables reference |
