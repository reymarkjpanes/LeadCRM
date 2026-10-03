import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20261011000000_task_multiple_associations/migration.sql'), 'utf8');
async function legacyDatabase() {
  const db = await PGlite.create();
  await db.exec(`CREATE TYPE "CrmEnvironment" AS ENUM ('PRODUCTION','SANDBOX');
    CREATE TABLE "Task" (id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, environment "CrmEnvironment" NOT NULL, "leadId" TEXT, "contactId" TEXT, "dealId" TEXT, "accountId" TEXT);`);
  for (const kind of ['Lead','Contact','Deal','Account']) {
    await db.exec(`CREATE TABLE "${kind}" (id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, environment "CrmEnvironment" NOT NULL);
      INSERT INTO "${kind}" VALUES ('related','tenant','PRODUCTION'),('foreign','other','PRODUCTION'),('sandbox','tenant','SANDBOX');`);
  }
  return db;
}
it('backfills existing links and enforces scope, uniqueness, and cascading deletion', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(`INSERT INTO "Task" VALUES ('task','tenant','PRODUCTION','related','related','related','related');`);
    await db.exec(migration);
    for (const kind of ['Lead','Contact','Deal','Account']) {
      expect((await db.query(`SELECT * FROM "Task${kind}"`)).rows).toHaveLength(1);
      const column = kind.toLowerCase() + 'Id';
      for (const target of ['foreign','sandbox','related']) {
        await expect(db.exec(`INSERT INTO "Task${kind}" ("taskId","${column}","tenantId",environment) VALUES ('task','${target}','tenant','PRODUCTION')`)).rejects.toThrow();
      }
    }
    await db.exec(`DELETE FROM "Task" WHERE id='task'`);
    for (const kind of ['Lead','Contact','Deal','Account']) expect((await db.query(`SELECT * FROM "Task${kind}"`)).rows).toHaveLength(0);
  } finally { await db.close(); }
}, 30000);
it('aborts migration on invalid historical links without changing existing data', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(`INSERT INTO "Task" VALUES ('bad','tenant','PRODUCTION','foreign',NULL,NULL,NULL);`);
    await expect(db.exec(migration)).rejects.toThrow('repair these before retrying');
    await db.exec('ROLLBACK');
    expect((await db.query(`SELECT "leadId" FROM "Task" WHERE id='bad'`)).rows).toEqual([{leadId:'foreign'}]);
    expect((await db.query(`SELECT to_regclass('"TaskLead"') AS table_name`)).rows).toEqual([{table_name:null}]);
  } finally { await db.close(); }
}, 30000);
