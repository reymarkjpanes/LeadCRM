import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const folder=resolve(import.meta.dirname,'../../data/outputs/database-audit');
const report=JSON.parse(readFileSync(resolve(folder,'retirement-backup.json'),'utf8')), bytes=readFileSync(report.backupPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'),report.sha256);
const backup=JSON.parse(bytes),db=await PGlite.create();
try {
 const applied=backup.rows._prisma_migrations.filter(r=>r.finished_at&&!r.rolled_back_at).map(r=>r.migration_name).sort();
 const latest=applied.at(-1);
 assert.ok(latest,'Backup contains an applied migration ledger');
 await replayCrmMigrations(db,{before:latest+'\uffff'});
 if(backup.rows.Task?.some(row=>'organizationId' in row))await db.exec('ALTER TABLE "Task" ADD COLUMN "organizationId" TEXT');
 for(const table of backup.restoreOrder) {
  const rows=backup.rows[table];if(rows.length){const cols=Object.keys(rows[0]).map(k=>'"'+k.replaceAll('"','""')+'"').join(',');await db.query(`INSERT INTO "${table}" (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::"${table}",$1::jsonb)`,[JSON.stringify(rows)]);}
  const actual=(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);
  assert.deepEqual(actual,rows,table+' exact restore');
 }
 const userBefore=(await db.query('SELECT to_jsonb(t) row FROM "User" t')).rows;
 await replayCrmMigrations(db,{from:latest+'\uffff',before:'20261102000000'});
 // This is an isolated restore rehearsal, never a live deployment marker.
 await db.exec(`COMMENT ON TABLE "MailboxThreadAssociation" IS 'canonical-crm-relations-api-verified-v1'`);
 if(latest<'20261102000000')await replayCrmMigrations(db,{from:'20261102000000'});
 assert.deepEqual((await db.query('SELECT to_jsonb(t) row FROM "User" t')).rows,userBefore);
 const evidence={checksumVerified:true,allRowsExactlyRestored:true,tables:backup.restoreOrder.length,restoredThrough:latest,forwardRetirementPassed:true,preservedUserUnchanged:true};
 writeFileSync(resolve(folder,'retirement-backup-verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await db.close();}
