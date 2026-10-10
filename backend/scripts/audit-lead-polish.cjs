// Read-only, aggregate-only audit. Never print connection strings or record values.
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ log: [], datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
(async () => {
  try {
    const columns = await db.$queryRawUnsafe(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='Lead' ORDER BY ordinal_position`);
    const retired = columns.filter(c => ['description', 'website', 'productInterestOther'].includes(c.column_name)).map(c => c.column_name);
    const counts = await db.$queryRawUnsafe(`SELECT count(*)::int AS leads, count(*) FILTER (WHERE "productsNormalized")::int AS normalized, count(*) FILTER (WHERE NOT "productsNormalized")::int AS unresolved, count(*) FILTER (WHERE "isArchived")::int AS archived, count(*) FILTER (WHERE "convertedAt" IS NOT NULL)::int AS converted${retired.map(c => `, count(*) FILTER (WHERE "${c}" IS NOT NULL)::int AS "${c}Values"`).join('')} FROM "Lead"`);
    const migrations = await db.$queryRawUnsafe(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 5`);
    console.log(JSON.stringify({ columns, counts, migrations }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ audit: 'unavailable', code: error.code || error.name })); process.exitCode = 1;
  } finally { await db.$disconnect(); }
})();
