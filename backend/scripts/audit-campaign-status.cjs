// Read-only inventory; never print connection strings or recipient data.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const target = new URL(process.env.DATABASE_URL);
  console.log(JSON.stringify({ host: target.hostname, database: target.pathname.slice(1) }));
  console.log(JSON.stringify({ enum: await db.$queryRawUnsafe(`SELECT enumlabel FROM pg_enum WHERE enumtypid = '"CampaignStatus"'::regtype ORDER BY enumsortorder`) }));
  console.log(JSON.stringify({ campaigns: await db.$queryRawUnsafe('SELECT status::text, count(*)::int FROM "Campaign" GROUP BY status ORDER BY status::text') }));
  console.log(JSON.stringify({ latestMigrations: await db.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 5') }));
})().catch(error => { console.error(error.code || error.name); process.exitCode = 1; }).finally(() => db.$disconnect());
