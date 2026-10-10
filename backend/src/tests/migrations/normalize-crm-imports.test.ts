import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { replayCrmMigrations } from '../replay-crm-migrations';

const expansion = '20261027000000_crm_import_integrity';
const retirement = '20261028000000_retire_legacy_crm_imports';
const sql = (name: string) => readFileSync(resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'), 'utf8');
const modules = ['Lead', 'Contact', 'Account', 'Deal'];
const approve = `COMMENT ON TABLE "CrmImportJob" IS 'crm-import-normalization-api-verified-v1'`;

async function fixture() {
  const db = await PGlite.create();
  await replayCrmMigrations(db, expansion);
  await db.exec(`INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('tenant','Import migration','import-migration',now()),('foreign','Foreign','foreign-import',now());
    INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('actor','tenant','fixture@example.test','Test','Actor','Client Admin',now()),('foreign-actor','foreign','foreign@example.test','Other','Actor','Client Admin',now());`);
  for (const module of modules) {
    for (let i = 0; i < 2; i++) {
      await db.query(`INSERT INTO "${module}Import" (id,"tenantId","createdById","fileName","totalRecords","successfulRecords","failedRecords",status,"createdAt","completedAt")
        VALUES ($1,'tenant','actor','historical.csv',2,1,1,'completed_with_errors','2026-09-01','2026-09-02')`, [`${module}-${i}`]);
      for (let n = 0; n < 2; n++) {
        const columns = module === 'Deal' ? ',data' : module === 'Account' ? ',name,industry' : ',"firstName",email';
        const values = module === 'Deal' ? `,'{"title":"Original Deal","resolvedValue":"25000","nested":{"keep":true}}'` : module === 'Account' ? ",'Acme',NULL" : ",'José','ORIGINAL@example.test'";
        await db.query(`INSERT INTO "${module}ImportResult" (id,"importId","rowNumber",status,remarks,"createdAt"${columns}) VALUES ($1,$2,$3,$4,$5,'2026-09-02'${values})`,
          [`${module}-${i}-${n}`, `${module}-${i}`, n + 2, n ? 'failed' : 'imported', n ? 'Original error reason' : null]);
      }
    }
  }
  // History must survive deletion of an imported domain record, as it did before.
  await db.exec(`INSERT INTO "Lead" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('historical-lead','tenant','Historical','Lead',now());
    UPDATE "LeadImportResult" SET "leadId"='historical-lead' WHERE id='Lead-0-0';
    DELETE FROM "Lead" WHERE id='historical-lead'`);
  return db;
}

it('preserves every historical job/result field, count, ID, timestamp and relationship before retiring old tables', async () => {
  const db = await fixture();
  try {
    await db.exec(sql(expansion));
    const counts = (await db.query('SELECT * FROM crm_verify_import_normalization() ORDER BY module')).rows;
    expect(counts).toEqual(['LEAD', 'CONTACT', 'ACCOUNT', 'DEAL'].map(module => ({ module, jobs: 2, results: 4 })));
    const jobs = (await db.query('SELECT * FROM "CrmImportJob" ORDER BY id')).rows;
    const rows = (await db.query('SELECT * FROM "CrmImportRowResult" ORDER BY id')).rows;
    expect(jobs).toHaveLength(8); expect(rows).toHaveLength(16);
    expect(rows.find((r: any) => r.id === 'Lead-0-0')).toMatchObject({ importJobId: 'Lead-0', recordId: 'historical-lead', rowNumber: 2, data: { firstName: 'José', email: 'ORIGINAL@example.test', lastName: null } });
    expect(rows.find((r: any) => r.id === 'Deal-0-0')).toMatchObject({ data: { title: 'Original Deal', resolvedValue: '25000', nested: { keep: true } } });
    // Deployment is a separate step; legacy reads survive and writes cannot diverge.
    await expect(db.exec(`UPDATE "LeadImport" SET "fileName"='changed.csv'`)).rejects.toThrow('deploy the normalized import service');
    await expect(db.exec(sql(retirement))).rejects.toThrow('Verify normalized imports and History');
    await db.exec('ROLLBACK');
    expect((await db.query('SELECT count(*) AS count FROM "LeadImportResult"')).rows[0]).toEqual({ count: 4 });
    // This fixture simulates the approval made only after service/API verification.
    await db.exec(approve);
    await db.exec(sql(retirement));
    expect((await db.query('SELECT * FROM "CrmImportJob" ORDER BY id')).rows).toEqual(jobs);
    expect((await db.query('SELECT * FROM "CrmImportRowResult" ORDER BY id')).rows).toEqual(rows);
    for (const name of modules.flatMap(m => [`${m}Import`, `${m}ImportResult`])) expect((await db.query('SELECT to_regclass($1) AS name', [`"${name}"`])).rows[0]).toEqual({ name: null });
    await db.exec(`DELETE FROM "CrmImportJob" WHERE id='Lead-0'`);
    expect((await db.query(`SELECT count(*) AS count FROM "CrmImportRowResult" WHERE "importJobId"='Lead-0'`)).rows[0]).toEqual({ count: 0 });
  } finally { await db.close(); }
}, 60000);

it('aborts retirement on missing or changed historical data even with equal counts and an approval marker', async () => {
  const db = await fixture();
  try {
    await db.exec(sql(expansion)); await db.exec(approve);
    await db.exec(`INSERT INTO "CrmImportRowResult" (id,"importJobId","rowNumber",status) VALUES ('extra','Contact-0',99,'failed')`);
    await expect(db.exec(sql(retirement))).rejects.toThrow('Import result count mismatch'); await db.exec('ROLLBACK');
    await db.exec(`DELETE FROM "CrmImportRowResult" WHERE id='extra'`);
    await db.exec(`UPDATE "CrmImportRowResult" SET data='{"tampered":true}' WHERE id='Contact-0-0'`);
    await expect(db.exec(sql(retirement))).rejects.toThrow('Import result migration mismatch'); await db.exec('ROLLBACK');
    expect((await db.query('SELECT count(*) AS count FROM "ContactImportResult"')).rows[0]).toEqual({ count: 4 });
    await db.exec(`DELETE FROM "CrmImportRowResult" WHERE id='Contact-0-0'`);
    await expect(db.exec(sql(retirement))).rejects.toThrow('Import result migration mismatch'); await db.exec('ROLLBACK');
  } finally { await db.close(); }
}, 60000);

it('rolls back expansion on conflicting IDs or duplicate row numbers without altering old history', async () => {
  for (const conflict of ['id', 'row']) {
    const db = await fixture();
    try {
      if (conflict === 'id') await db.exec(`INSERT INTO "ContactImport" (id,"tenantId","createdById","fileName") VALUES ('Lead-0','tenant','actor','collision.csv')`);
      else await db.exec(`UPDATE "LeadImportResult" SET "rowNumber"=2 WHERE id='Lead-0-1'`);
      await expect(db.exec(sql(expansion))).rejects.toThrow(); await db.exec('ROLLBACK');
      expect((await db.query('SELECT count(*) AS count FROM "LeadImportResult"')).rows[0]).toEqual({ count: 4 });
      expect((await db.query(`SELECT to_regclass('"CrmImportJob"') AS name`)).rows[0]).toEqual({ name: null });
    } finally { await db.close(); }
  }
}, 60000);

it('retains legacy tables if an unexpected dependent table prevents safe retirement', async () => {
  const db = await fixture();
  try {
    await db.exec(sql(expansion)); await db.exec(approve);
    await db.exec(`CREATE TABLE "ImportExtension" (id text PRIMARY KEY, "oldJobId" text REFERENCES "LeadImport"(id)); INSERT INTO "ImportExtension" VALUES ('keep','Lead-0')`);
    await expect(db.exec(sql(retirement))).rejects.toThrow(); await db.exec('ROLLBACK');
    expect((await db.query('SELECT * FROM "ImportExtension"')).rows).toEqual([{ id: 'keep', oldJobId: 'Lead-0' }]);
    expect((await db.query('SELECT count(*) AS count FROM "LeadImport"')).rows[0]).toEqual({ count: 2 });
  } finally { await db.close(); }
}, 60000);

it('enforces row uniqueness and scoped actor/upload FKs, and cascades temporary content without losing jobs', async () => {
  const db = await fixture();
  try {
    await db.exec(sql(expansion));
    await expect(db.exec(`INSERT INTO "CrmImportRowResult" (id,"importJobId","rowNumber",status) VALUES ('duplicate','Lead-0',2,'failed')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO "CrmImportRowResult" (id,"importJobId","rowNumber",status) VALUES ('orphan','missing',2,'failed')`)).rejects.toThrow();
    await db.exec(`INSERT INTO "Lead" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('foreign-lead','foreign','Foreign','Lead',now())`);
    await expect(db.exec(`INSERT INTO "CrmImportRowResult" (id,"importJobId","rowNumber",status,"recordId") VALUES ('foreign-result','Lead-0',20,'imported','foreign-lead')`)).rejects.toThrow('crosses tenant');
    await expect(db.exec(`INSERT INTO "CrmImportUpload" (id,"tenantId","actorId",module,"totalChunks","expiresAt") VALUES ('bad','tenant','foreign-actor','LEAD',1,now())`)).rejects.toThrow('crosses tenant');
    await db.exec(`INSERT INTO "CrmImportUpload" (id,"tenantId","actorId",module,"totalChunks","expiresAt") VALUES ('upload','tenant','actor','LEAD',1,now()); INSERT INTO "CrmImportChunk" (id,"uploadId","chunkIndex",content) VALUES ('chunk','upload',0,'sensitive');`);
    await db.exec(`UPDATE "CrmImportUpload" SET "sourceHash"='first-digest' WHERE id='upload'`);
    await expect(db.exec(`UPDATE "CrmImportUpload" SET "sourceHash"='changed-digest' WHERE id='upload'`)).rejects.toThrow('digest cannot change');
    await expect(db.exec(`UPDATE "CrmImportJob" SET "uploadId"='upload' WHERE id='Contact-0'`)).rejects.toThrow('crosses scope');
    await expect(db.exec(`UPDATE "CrmImportJob" SET module='CONTACT' WHERE id='Lead-0'`)).rejects.toThrow('identity cannot change');
    await db.exec(`UPDATE "CrmImportJob" SET "uploadId"='upload' WHERE id='Lead-0'; DELETE FROM "CrmImportUpload" WHERE id='upload'`);
    expect((await db.query('SELECT count(*) AS count FROM "CrmImportChunk"')).rows[0]).toEqual({ count: 0 });
    expect((await db.query(`SELECT "uploadId" FROM "CrmImportJob" WHERE id='Lead-0'`)).rows[0]).toEqual({ uploadId: null });
  } finally { await db.close(); }
}, 60000);
