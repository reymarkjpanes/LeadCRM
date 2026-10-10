// Read-only migration and aggregate inventory. Never prints credentials or CSV data.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ log: [], datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
const legacy = ['LeadImport', 'ContactImport', 'AccountImport', 'DealImport'];
(async () => {
  const migrations = await db.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at, checksum FROM "_prisma_migrations" ORDER BY started_at');
  const tables = await db.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  const present = new Set(tables.map(t => t.table_name));
  const inventory = {};
  for (const name of [...legacy.flatMap(name => [name, `${name}Result`]), 'CrmImportJob', 'CrmImportRowResult', 'CrmImportUpload', 'CrmImportChunk']) {
    if (present.has(name)) inventory[name] = Number((await db.$queryRawUnsafe(`SELECT count(*) AS count FROM "${name}"`))[0].count);
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), migrations, inventory }, null, 2));
})().catch(error => { console.error(JSON.stringify({ error: error.name, code: error.code || error.errorCode || 'CONNECTION_FAILED' })); process.exitCode = 1; })
  .finally(() => db.$disconnect());
