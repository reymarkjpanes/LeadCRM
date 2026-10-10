# Local Development Setup

## Prerequisites
- Node.js 20+
- PostgreSQL 16+
- npm 9+
- Git

## Step 0 — Clone the repository

```bash
git clone https://github.com/reymarkjpanes/OWN-CRM-1.git
cd OWN-CRM-1
```

## Step 1 — Install dependencies

```bash
# From monorepo root — installs all workspaces
npm install

# Or per-package
cd frontend && npm install
cd backend && npm install
cd shared && npm install
```

## Step 2 — Configure environment variables

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your actual values:
# - DATABASE_URL: your PostgreSQL connection string
# - JWT_SECRET: any strong random string (min 32 chars)

# Frontend
cp frontend/.env.local.example frontend/.env.local
# NEXT_PUBLIC_API_URL defaults to http://localhost:4000/api/v1
```

## Step 3 — Set up PostgreSQL database

Open pgAdmin or a PostgreSQL shell as the `postgres` superuser and run:

```sql
-- Create the database user
CREATE ROLE leadcrm LOGIN PASSWORD 'your-password-from-env';

-- Create the database
CREATE DATABASE leadcrm_dev OWNER leadcrm;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE leadcrm_dev TO leadcrm;
```

Or run the provided script (fill in the password first):

```bash
# Edit infrastructure/scripts/setup-db.sql — replace YOUR_PASSWORD_HERE
# Then run:
psql -U postgres -f infrastructure/scripts/setup-db.sql
psql -U postgres -c "CREATE DATABASE leadcrm_dev OWNER leadcrm;"
```

## Step 4 — Run Prisma migrations

```bash
cd backend
npx prisma migrate dev --name init
```

This creates all tables defined in `backend/prisma/schema.prisma`.

## Step 5 — Seed the database

```bash
cd backend
npx ts-node prisma/seed.ts
```

Runs role repairs, the optional configured Gmail sender setup, and sample tenant generation in development. Set `SKIP_DEMO_TENANTS=true` to skip sample data. See [database seeders](../../backend/src/database/seeders/README.md).

## Step 6 — Start development servers

```bash
# Option A: Start everything with Turborepo (from monorepo root)
npm run dev

# Option B: Start individually
# Terminal 1 — Backend API
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- Health check: http://localhost:4000/health

## Verify it works

```bash
# Check backend health
curl http://localhost:4000/health

# Should return: {"status":"ok","timestamp":"..."}
```

## Common Issues

### `P1000: Authentication failed`
The PostgreSQL user or password in `DATABASE_URL` doesn't match. Check:
1. The user `leadcrm` exists in PostgreSQL
2. The password matches what's in `backend/.env`

### `P1003: Database does not exist`
The database `leadcrm_dev` hasn't been created yet. Run Step 3.

### `Cannot find module '@prisma/client'`
Run `npx prisma generate` from the `backend/` directory after `npm install`.

### Port already in use
Frontend uses port 3000, backend uses port 4000. Change `PORT` in `backend/.env` or `--port` in `frontend/package.json` if needed.
