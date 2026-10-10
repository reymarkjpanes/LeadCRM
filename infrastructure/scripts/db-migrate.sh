#!/bin/bash
# Run Prisma migrations for the backend
set -e
cd "$(dirname "$0")/../../backend"
echo "[migrate] Running Prisma migrations..."
npm run db:deploy
echo "[migrate] Running database seed..."
npx ts-node prisma/seed.ts
echo "[migrate] Done."
