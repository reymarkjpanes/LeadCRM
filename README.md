# LeadCRM

LeadCRM is the internally managed CRM for Camxian Technologies. Start at `/login`. See [current authentication and onboarding](docs/authentication.md) and the [internal CRM migration notes](docs/plans/internal-camxian-crm.md); historical SaaS descriptions below do not define current access behavior.

> **Enterprise-Grade Multi-Tenant CRM & Automated Workflow Execution Platform**
> Tailored for IT Solutions Providers, Security Firms, Managed Service Providers (MSPs), and Telecom Agencies.

[![Next.js 15](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js)](https://nextjs.org)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss)](https://tailwindcss.com)
[![Express.js 4](https://img.shields.io/badge/Express-4.x-green?logo=express)](https://expressjs.com)
[![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org)
[![Prisma ORM](https://img.shields.io/badge/Prisma-5.x-2D3748?logo=prisma)](https://www.prisma.io)
[![Turborepo 2](https://img.shields.io/badge/Turborepo-2.x-EF4444?logo=turborepo)](https://turbo.build)
[![PWA Ready](https://img.shields.io/badge/PWA-Enabled-purple?logo=pwa)](https://web.dev/progressive-web-apps/)

---

## 📌 Executive Summary

**LeadCRM** is an end-to-end multi-tenant Customer Relationship Management (CRM) and automated operational platform. Unlike traditional simple contact logs, LeadCRM unites sales pipeline management, automated trigger-condition-action workflow execution, multi-channel marketing campaigns, service order technician dispatch, asset tracking into a single, cohesive software system.

Built upon a Turborepo monorepo with Next.js, Express, TypeScript, PostgreSQL and Prisma, LeadCRM provides a tenant-scoped CRM for Client Admin and staff users.

---

## 🎯 Mission, Vision & Core Objectives

### Mission

To empower growing IT service providers, MSPs, security agencies, and telecom firms with an enterprise-grade, automated CRM ecosystem that streamlines sales pipelines, automates repetitive operational workflows, and eliminates cross-departmental data silos.

### Vision

To become the benchmark open-architecture CRM and workflow automation platform for technology service enterprises, delivering seamless scalability, strict multi-tenant security, and real-time operational intelligence.

### Core Objectives

#### General Objective

Design, develop, and deploy a secure, high-performance multi-tenant CRM and workflow automation platform capable of managing complex enterprise customer lifecycles from lead capture to closed deals.

#### Specific Objectives

1. **Automated Pipeline Management**: Implement Kanban, table, and list pipeline views with automated stage progression, aging metrics, and revenue forecasting.
2. **Event-Driven Workflow Automation**: Engineer a visual Trigger → Condition → Action workflow builder capable of automated deal assignments, task dispatch, email notifications, and SLA escalations.
3. **Workspace Isolation**: Enforce tenant-scoped CRM data and role permissions.
4. **Granular Role-Based Access Control (RBAC)**: Enforce module-level permission guards (`canView`, `canCreate`, `canEdit`, `canDelete`) across custom roles and multi-tenant scopes.
5. **Operational Synergy**: Integrate sales pipeline data directly with technician service orders, asset tracking, inventory allocation.

---

## 💡 Problem Statement & Proposed Solution

### The Problem

Small-to-medium IT solutions providers, security agencies, and telecom firms frequently struggle with fragmented software stacks:

- **Disjointed Tools**: Using separate tools for lead tracking, task management, email marketing, and technician service dispatches leading to lost context.
- **Manual Overhead**: Sales reps waste hours manually assigning leads, updating pipeline stages, sending follow-up emails, and logging service orders.
- **Lack of Visibility**: Managers lack real-time visibility into deal velocity, sales rep leaderboards, campaign attribution, and technician job completion rates.
- **Data Security Concerns**: Multi-tenant data leakage risks when using poorly isolated systems or single-tenant legacy tools.

### The Proposed Solution

LeadCRM solves these challenges by providing a single, unified platform:

- **Unified Operational Hub**: Consolidates CRM, marketing automation, service order management, asset tracking in one platform.
- **Rule-Based Automation Engine**: Automates lead scoring, deal assignment, follow-ups, and service order creation via visual workflow rules.
- **Multi-Tenant Data Isolation**: Ensures database-level `tenantId` query scoping and strict JWT authorization across every request.
- **Standardized Navigation & UI**: Delivers a polished, accessible user experience with dark/light mode glassmorphism, responsive navigation primitives (`BackButton`, `ModalCloseButton`, `PageHeader`), and real-time interactive dashboards.

---

## 🚀 Key Modules & Feature Highlights

### 1. 🏢 Tenant CRM Portal (`(tenant)`)

- **Contacts & Companies**: Full customer profiles, demographic details, communication logs, and customer journey timeline tracking.
- **Deals & Pipeline Engine**: Interactive Kanban board (via `@dnd-kit`), table, and list views. Supports multi-pipeline switching, 14-filter search system, stage history trail, deal aging, and probability forecasting.
- **Unified Deal Details Drawer**: Reusable 7-tab drawer (`Overview`, `Activities`, `Tasks`, `Emails`, `Files`, `History`, `Automation`) with inline task creation and stage change audit trail.
- **Task Management**: Multi-view Taskboard (Kanban / Table), priority flags, overdue badges, user assignment, and `TaskDetailsDrawer`.

### 2. ⚡ Workflow Automation Engine

- **Visual Workflow Builder**: Full-screen canvas builder to construct custom automation trees using `Trigger → Condition → Action` logic.
- **Recipe Templates**: Pre-configured workflow recipes for instant activation (e.g., _Stale Deal Escalation_, _New Lead Auto-Assignment_, _High-Value Deal Alert_).
- **Execution Log Inspector**: Real-time modal inspecting execution history, trigger inputs, step outcomes, and error tracebacks.

### 3. 📢 Marketing & Campaigns

- **Multi-Channel Campaigns**: Email and SMS campaign creation, target audience condition builder, and template library.
- **Campaign Performance Analytics**: Real-time delivery, open rate, click-through rate, and lead attribution tracking via interactive charts.

### 4. 🛠️ Operations & Field Services

- **Service Orders & Technician Dashboard**: Field service order tracking, technician assignment, job status updates, and mobile-friendly task interfaces.
- **Asset & Inventory Management**: Tracking hardware assets, stock levels, equipment locations, and serial numbers tied to client accounts.

### 5. 📊 Reporting & Analytics

- **Executive Dashboards**: Real-time KPI summary widgets, revenue trends, pipeline distribution charts, lead attribution breakdowns, and sales rep leaderboards powered by Chart.js.

### 6. Team Administration

- Client Admin manages team members and custom roles through Settings.
- Record Activity tabs and Team Management history retain event logging.

---

## 🧩 Reusable Navigation & UI Design System

LeadCRM enforces strict visual standards and reusable navigation primitives across all modules:

| Component              | Path                                                                                                                 | Description                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`BackButton`**       | [`frontend/src/shared/components/ui/BackButton.tsx`](./frontend/src/shared/components/ui/BackButton.tsx)             | Accessible navigation back button with `ChevronLeft` icon, custom labels, hover states, router fallback, and glassmorphism styling.              |
| **`ModalCloseButton`** | [`frontend/src/shared/components/ui/ModalCloseButton.tsx`](./frontend/src/shared/components/ui/ModalCloseButton.tsx) | Standardized `X` close button component for modals, side sheets, and drawers, ensuring consistent sizing, aria-labels, and keyboard interaction. |
| **`PageHeader`**       | [`frontend/src/shared/components/ui/PageHeader.tsx`](./frontend/src/shared/components/ui/PageHeader.tsx)             | Unified page header container supporting title, subtitle description, optional embedded `BackButton`, status badges, and action buttons.         |
| **`SlidingDrawer`**    | [`frontend/src/shared/components/SlidingDrawer.tsx`](./frontend/src/shared/components/SlidingDrawer.tsx)             | Animated side drawer container (via `motion/react`) with backdrop blur overlay, ESC key handlers, and `ModalCloseButton`.                        |
| **`SideSheet`**        | [`frontend/src/shared/components/SideSheet.tsx`](./frontend/src/shared/components/SideSheet.tsx)                     | Standard right-side slide-out panel for quick details and contextual editing.                                                                    |

---

## 🛠️ Technology Stack

| Layer                  | Technology                   | Version        | Description                                                      |
| ---------------------- | ---------------------------- | -------------- | ---------------------------------------------------------------- |
| **Monorepo Framework** | Turborepo                    | `v2.x`         | High-performance build system & workspace runner                 |
| **Frontend Framework** | Next.js (App Router)         | `v15.5`        | React 19 framework with SSR/SSG & Client SPA capabilities        |
| **Language**           | TypeScript                   | `v5.8`         | Strict type safety across frontend, backend, and shared packages |
| **Styling**            | Tailwind CSS                 | `v4.x`         | Modern utility-first CSS framework with native CSS `@import`     |
| **UI Components**      | ShadCN UI / Radix            | Latest         | Accessible, unstyled primitive components                        |
| **Animations**         | Motion (`motion/react`)      | `v12.x`        | Smooth layout transitions and hardware-accelerated animations    |
| **Drag and Drop**      | `@dnd-kit`                   | `v6.x`         | Modern drag-and-drop toolkit for Kanban pipeline boards          |
| **Charts & Graphs**    | Chart.js / `react-chartjs-2` | `v4.x`         | Canvas-based analytics and metric visualization                  |
| **Toasts**             | Sonner                       | `v2.x`         | Stackable, custom-styled toast notification system               |
| **Backend API**        | Node.js / Express.js         | `v4.x`         | Modular REST API server handling 85+ route endpoints             |
| **ORM & Database**     | Prisma ORM / PostgreSQL      | `v5.x` / `16+` | Type-safe query engine and relational database                   |
| **Authentication**     | JWT + HttpOnly Cookies       | Standard       | Secure stateless sessions with automatic cookie storage          |
| **Integrations**       | Gmail API         | —              | Email integration                         |

---

## 🏗️ System Architecture & Data Flow

```
                                    +-----------------------------------+
                                    |        Client / Browser           |
                                    | (PWA / Desktop / Mobile Browser)  |
                                    +-----------------------------------+
                                                      |
                                       HTTP / HTTPS (Rest API / Next.js)
                                                      |
                                                      v
                                    +-----------------------------------+
                                    |     Next.js 15 App Router         |
                                    |      (@leadcrm/frontend)          |
                                    +-----------------------------------+
                                                |
                                         (CRM Portal)
                                                |
                                 +-----------------------------+
                                 |  DataContext & AuthContext  |
                                 | (State Layer & Data Router) |
                                 +-----------------------------+
                                                |
               +--------------------------------+--------------------------------+
               | (NEXT_PUBLIC_USE_MOCK_DATA=true)                                | (NEXT_PUBLIC_USE_MOCK_DATA=false)
               v                                                                 v
     +-------------------+                                             +--------------------+
     | LocalStorage Data |                                             | Express REST API   |
     | Persistence Layer |                                             | (@leadcrm/backend) |
     +-------------------+                                             +--------------------+
                                                                                 |
                                                                         Prisma ORM (tenantId Scoped)
                                                                                 |
                                                                                 v
                                                                       +--------------------+
                                                                       | PostgreSQL 16 DB   |
                                                                       | (30 Schema Models) |
                                                                       +--------------------+
```

### Data Layer Modes (`NEXT_PUBLIC_USE_MOCK_DATA`)

LeadCRM frontend features a dual-mode data layer configured via `frontend/.env.local`:

- **Mock Mode (`NEXT_PUBLIC_USE_MOCK_DATA=true`)**: Runs the frontend standalone with rich mock data persisted in `localStorage`. Ideal for client demos, UI development, and offline evaluation.
- **Live API Mode (`NEXT_PUBLIC_USE_MOCK_DATA=false`)**: Connects seamlessly to the Express.js API (`http://localhost:4000/api/v1`) backed by PostgreSQL.

---

## 📁 Repository & Project Structure

```
leadcrm/                                 ← Monorepo Root (Turborepo)
├── frontend/                            ← Next.js 15 App Router Frontend (@leadcrm/frontend)
│   ├── app/                             ← Routing Shells ONLY (Clean 3-line imports)
│   │   ├── (tenant)/                    ← Tenant CRM Portal routes (/dashboard, /crm/*, /operations/*)
│   │   ├── login/                       ← Public authentication routes
│   │   └── layout.tsx                   ← Root layout, metadata & PWA settings
│   └── src/
│       ├── features/                    ← Domain Feature Modules
│       │   ├── tenant/                  ← CRM Portal features (contacts, deals, pipeline, workflows)
│       ├── shared/                      ← Shared UI Library
│       │   ├── components/
│       │   │   ├── ui/                  ← BackButton, ModalCloseButton, PageHeader, ShadCN
│       │   │   └── charts/              ← ChartComponents.tsx
│       │   └── hooks/                   ← Custom React hooks
│       ├── store/                       ← AuthContext, DataContext, Types, Mock Data
│       └── lib/                         ← Utilities, constants, helper functions
│
├── backend/                             ← Express.js REST API Server (@leadcrm/backend)
│   ├── prisma/                          ← Prisma schema.prisma (30 models), migrations & seeds
│   └── src/
│       ├── modules/                     ← crm/, automation/, marketing/, operations/
│       ├── core/                        ← auth/, audit/, permissions/, tenant/
│       └── api/                         ← Middleware, express routes, controllers
│
├── shared/                              ← Shared Monorepo Package (@leadcrm/shared)
│   └── src/                             ← Canonical TypeScript interfaces, Zod schemas & RBAC contracts
│
├── docs/                                ← Project Documentation & Architecture Guides
│   ├── ARCHITECTURE.md                  ← Deep-dive system architecture guide
│   ├── STRUCTURE.md                     ← Complete folder layout & module anatomy
│   ├── PORTAL-SEPARATION.md             ← Physical dual-portal separation philosophy
│   ├── API.md                           ← REST API specification
│   ├── database/                        ← ERD diagrams & database summary
│   ├── security/                        ← RBAC permission matrix & audit logging strategy
│   ├── setup/                           ← Local dev setup & environment variable guide
│   └── workflows/                       ← Core business workflow flowcharts
│
├── .kiro/                               ← AI Agent Steering, Skills & Hooks configuration
├── package.json                         ← Monorepo workspace configuration
├── turbo.json                           ← Turborepo task pipeline configuration
└── tsconfig.base.json                   ← Base TypeScript configuration
```

---

## ⚡ Installation & Quick Start Guide

### Prerequisites

| Requirement    | Required Version    | Verification Command |
| -------------- | ------------------- | -------------------- |
| **Node.js**    | `20.19+`, `22.13+`, or `24+` | `node --version`     |
| **npm**        | `11.19.1` (project-pinned) | `npx --yes npm@11.19.1 --version` |
| **PostgreSQL** | `v16.0` or higher   | `psql --version`     |
| **Git**        | Any modern version  | `git --version`      |

> [!IMPORTANT]
> Always execute `npm` commands from the **monorepo root** directory (`OWN-CRM-1`). npm workspaces hoist dependencies automatically.

---

### Step-by-Step Setup

#### 1. Clone the Repository

```bash
git clone https://github.com/reymarkjpanes/OWN-CRM-1.git
cd OWN-CRM-1
```

#### 2. Install Workspace Dependencies

```bash
# Installs dependencies for frontend, backend, and shared packages in one step
npx --yes npm@11.19.1 ci
```

#### 3. Configure Environment Variables

**Backend (`backend/.env`):**

```bash
cp backend/.env.example backend/.env
```

Ensure `backend/.env` contains your PostgreSQL credentials:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/leadcrm_dev?schema=public"
JWT_SECRET="leadcrm_super_secret_jwt_key_min_32_characters_long"
NODE_ENV="development"
PORT=4000
ALLOWED_ORIGINS="http://localhost:3000"
```

**Frontend (`frontend/.env.local`):**

```bash
# Create frontend/.env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1" > frontend/.env.local
echo "NEXT_PUBLIC_USE_MOCK_DATA=false" >> frontend/.env.local
```

> [!NOTE]
> Set `NEXT_PUBLIC_USE_MOCK_DATA=false` to connect to the Express API and use the PostgreSQL database (Recommended for full-stack). Set to `true` to run the frontend independently using localStorage data (no backend required).

#### 4. Initialize Database & Run Seed

```bash
cd backend

# Generate Prisma Client (builds the ORM based on your schema)
npx prisma generate

# Apply the committed forward migrations
npm run db:deploy

# Seed the database with real demo data!
# This command automatically populates the database with:
# - A default Tenant (LeadCRM Demo)
# - Mock Users (Client Admin, Sales Rep, Viewer)
# - Realistic CRM data: Organizations, Contacts, Pipelines, Deals, and Tasks
npm run db:seed

cd ..
```

#### 5. Launch Development Servers

```bash
# From monorepo root — runs frontend (port 3000) and backend (port 4000) in parallel via Turborepo
npm run dev
```

---

## 🌐 Application Access & Port Reference

| Component                | URL / Endpoint                 | Target Audience / Credentials                              |
| ------------------------ | ------------------------------ | ---------------------------------------------------------- |
| **Tenant CRM Portal**    | `http://localhost:3000`        | Client Admins, Sales Reps, Viewers, Technicians            |
| **Backend REST API**     | `http://localhost:4000/api/v1` | Developer API Endpoints                                    |
| **Prisma Studio**        | `http://localhost:5555`        | Database Inspection UI (`npx prisma studio` in `backend/`) |

### Demo Accounts (Mock Mode)

| Role             | Email                | Password   | Access Scope                                  |
| ---------------- | -------------------- | ---------- | --------------------------------------------- |
| **Client Admin** | `client@example.com` | `password` | Full organization administration & CRM access |
| **Sales Rep**    | `rep@example.com`    | `password` | Sales pipeline, contacts, deals, tasks        |
| **Viewer**       | `viewer@example.com` | `password` | Read-only CRM & reporting inspection          |

---

## 📱 Mobile & PWA Setup

LeadCRM is fully optimized as a **Progressive Web App (PWA)**:

1. Ensure your computer and mobile device are connected to the **same local Wi-Fi network**.
2. Find your local IP address:
   - **Windows**: `ipconfig`
   - **macOS / Linux**: `ifconfig`
3. On your mobile browser, navigate to `http://<YOUR_LOCAL_IP>:3000`.
4. Tap **"Add to Home Screen"** in your mobile browser to install LeadCRM as a standalone native-like mobile application.

---

## 🔑 Role-Based Access Control (RBAC) Matrix

LeadCRM implements module-level permission guards (`module.action`) evaluated against the authenticated user's role:

| Module                      | Action                        | Client Admin |  Sales Rep   |    Viewer    |     Technician     |
| --------------------------- | ----------------------------- | :----------: | :----------: | :----------: | :----------------: |
| **Contacts & Companies**    | View / Create / Edit / Delete |      ✅      |      ✅      | 👁️ View Only |         ❌         |
| **Deals & Pipelines**       | Manage / Move Stages          |      ✅      |      ✅      | 👁️ View Only |         ❌         |
| **Tasks & Activities**      | Create / Assign / Complete    |      ✅      |      ✅      | 👁️ View Only |  ✅ Assigned Only  |
| **Workflows & Automation**  | Create / Edit / Trigger       |      ✅      |      ❌      | 👁️ View Only |         ❌         |
| **Marketing Campaigns**     | Build / Dispatch / View       |      ✅      | 👁️ View Only | 👁️ View Only |         ❌         |
| **Service Orders & Assets** | Create / Dispatch / Complete  |      ✅      |      ❌      | 👁️ View Only | ✅ Full Operations |
| **User Administration**     | Invite Users / Assign Roles   |      ✅      |      ❌      |      ❌      |         ❌         |

---

## 🔐 Security & Hardening Architecture

- **JWT Authentication**: Encrypted JSON Web Tokens delivered via secure **HttpOnly, SameSite cookies** to prevent XSS credential theft.
- **Tenant Isolation Guard**: Every database query is strictly scoped by `tenantId`. Cross-tenant data leakage is prevented at both the application and ORM levels.
- **Input Validation**: All API request payloads are validated using **Zod schemas** before reaching controller logic.
- **Rate Limiting**: Rate limiting guards applied on sensitive routes (Authentication: 5 attempts/15min, Public API: 100 requests/min per IP).
- **Audit Trails**: Immutable system logging capturing timestamp, actor ID, action type, IP address, and target resource for compliance.

---

## 📚 Documentation Directory Index

For detailed architectural specifications and guidelines, consult the files in [`docs/`](./docs/):

| Document                                                                       | Purpose                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)                               | In-depth technical architecture, state model, chart rules, and state guards |
| [`docs/STRUCTURE.md`](./docs/STRUCTURE.md)                                     | Exhaustive folder map, module anatomy, and file directory standards         |
| [`docs/PORTAL-SEPARATION.md`](./docs/PORTAL-SEPARATION.md)                     | Tenant workspace boundaries and access                   |
| [`docs/API.md`](./docs/API.md)                                                 | Full REST API specification (85+ endpoints)                                 |
| [`docs/authentication.md`](./docs/authentication.md)                           | Password authentication and account security                          |
| [`docs/user-roles.md`](./docs/user-roles.md)                                   | Role-Based Access Control (RBAC) overview                                   |
| [`docs/registration-flow.md`](./docs/registration-flow.md)                     | Historical registration flows (superseded)                                         |
| [`docs/demo-accounts.md`](./docs/demo-accounts.md)                             | Database seeder & demo credentials                                          |
| [`docs/database/erd.md`](./docs/database/erd.md)                               | Database Schema v2 Mermaid ERD & entity descriptions                        |
| [`docs/security/permission-matrix.md`](./docs/security/permission-matrix.md)   | Exhaustive RBAC permission matrix and role specifications                   |
| [`docs/setup/local-dev.md`](./docs/setup/local-dev.md)                         | Advanced local development, debugging, and setup guide                      |
| [`docs/setup/deployment.md`](./docs/setup/deployment.md)                       | Full production deployment guide (Vercel + Railway / Render + PostgreSQL)   |
| [`docs/setup/environment-variables.md`](./docs/setup/environment-variables.md) | Full environment variable reference table                                   |

---

## 👨‍💻 Development Workflow & Scripts

### Available NPM Scripts (Monorepo Root)

```bash
# Start both frontend and backend concurrently in development mode
npm run dev

# Build all monorepo packages for production
npm run build

# Run ESLint and TypeScript validation across all workspaces
npm run lint
```

### Pre-Commit Quality Checklist

Before committing or opening a pull request, run the verification loop:

```bash
# 1. Verify TypeScript type safety across all packages (must return 0 errors)
npx tsc --noEmit

# 2. Verify ESLint compliance
npm run lint

# 3. Test production build
npm run build
```

## ⚖️ License & Intellectual Property

**Private & Confidential** — Developed exclusively as an STI College Capstone Project. All rights reserved. No part of this software repository may be reproduced, distributed, or transmitted in any form without prior written permission from the development team and institution.
