# LeadCRM Database Seeders

This directory contains database seeding scripts for different environments and use cases.

## Available Seeders

The obsolete operator seeder has been removed. Server startup does not provision accounts or reset passwords.

### 2. Seeder Account (`seeder.seed.ts`)

Complete seeder account with comprehensive CRM data for testing and development.

**Credentials:**

- **Email:** `seeder@leadcrm.com`
- **Password:** `seeder123`
- **Tenant:** `seeder-company`
- **Role:** Client Admin

**Includes:**

- 4 Accounts (Organizations)
- 4 Leads
- 2 Customers
- 6 Deals (1 Won, 1 Lost, 4 Active)
- 1 Sales Pipeline with 7 stages
- 5 Tasks
- 5 Activities
- 3 Campaigns
- 3 Service Orders
- Full role permissions for all modules

**Run:**

```bash
npm run db:seed:seeder
```

### 3. Reymark Account (`reymark.seed.ts`)

Production-ready account with realistic Philippine business data.

**Tenant:** Rey Campany  
**User:** `reymarkjpanes@gmail.com`

**Run:**

```bash
npm run db:seed:reymark
```

### 4. Production Test (`production-test.seed.ts`)

Minimal test data for production campaign testing with Gmail integration.

**Run:**

```bash
npm run db:seed:production-test
```

### 5. Main Seed (`prisma/seed.ts`)

Entry point for standard database seeding. Runs role repairs, the optional Gmail system sender setup, and sample tenants (development only).

**Run:**

```bash
npm run db:seed
# or
npx prisma db seed
```

## Usage

### Run Individual Seeders

```bash
# Seeder account with full CRM data
npm run db:seed:seeder

# Reymark account
npm run db:seed:reymark

# Production test data
npm run db:seed:production-test
```

### Run All Standard Seeds

```bash
npm run db:seed
```

## Seeder Account Details

The **seeder account** is perfect for:

- ✅ Testing all CRM features
- ✅ Demonstrating pipeline functionality
- ✅ Training and onboarding
- ✅ UI/UX testing
- ✅ API testing and integration work

**What's Included:**

| Entity           | Count      | Details                                          |
| ---------------- | ---------- | ------------------------------------------------ |
| Accounts         | 4          | Mix of industries and sizes                      |
| Leads            | 4          | Various statuses (Inquiry, Contacted, Qualified) |
| Customers        | 2          | Active customers                                 |
| Deals            | 6          | Different stages including won/lost              |
| Pipeline         | 1          | 7-stage sales pipeline                           |
| Tasks            | 5          | Various priorities and statuses                  |
| Activities       | 5          | Calls, emails, meetings, notes                   |
| Campaigns        | 3          | Active, draft, completed                         |
| Service Orders   | 3          | Different statuses                               |
| Role Permissions | 12 modules | Full Client Admin access                         |

## Environment Variables

The main seed reads `DATABASE_URL`, `NODE_ENV`, and `SKIP_DEMO_TENANTS`. Gmail sender setup additionally reads `GMAIL_SYSTEM_SENDER_*` and `ENCRYPTION_KEY`; see `prisma/seed.ts`.

## Safety Notes

- All seeders use `upsert` operations — safe to run multiple times
- Production test seeder cleans up old test campaigns automatically
- Reymark seeder cleans up legacy non-UUID records

## Creating New Seeders

Follow the pattern in `seeder.seed.ts`:

1. Import Prisma client and helpers
2. Use `upsert` for idempotency
3. Maintain tenant isolation
4. Create records in dependency order
5. Use `skipDuplicates` for many-to-many relations
6. Add audit logs for key actions
7. Print summary at the end
8. Add npm script to package.json

## Quick Login Test

After seeding, test login:

```bash
# Start backend
npm run dev

# Login with an eligible employee account
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "your-user@camxian.com", "password": "your-password"}'

# Check if user exists
curl http://localhost:4000/api/v1/auth/me
```
