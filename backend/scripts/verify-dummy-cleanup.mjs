// Restore the local backup only into disposable PostgreSQL, then exercise cleanup.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
import { cleanupPlan, clearDummyRows } from './clear-dummy-data.mjs';
const folder=resolve(import.meta.dirname,'../../data/outputs/database-audit');
const plan=JSON.parse(readFileSync(resolve(folder,existsSync(resolve(folder,'cleanup-result.json'))?'cleanup-result.json':'cleanup-plan.json'),'utf8'));
const bytes=readFileSync(plan.backupPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'),plan.sha256,'Backup checksum');
const backup=JSON.parse(bytes.toString('utf8'));
const db=await PGlite.create();
try {
  await replayCrmMigrations(db,{before:'20261030000000_strengthen_relational_integrity'});
  const query=(sql,params=[])=>db.query(sql,params).then(r=>r.rows);
  // The live catalog still contains this retired nullable scalar; restore it too.
  if(backup.rows.Task?.some(row=>'organizationId' in row)) await db.exec('ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "organizationId" TEXT');
  for(const table of backup.restoreOrder) {
    const rows=backup.rows[table];
    if(rows.length) {
      const columns=Object.keys(rows[0]).map(k=>'"'+k.replaceAll('"','""')+'"').join(',');
      for(let offset=0;offset<rows.length;offset+=100) await query(`INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::"${table}",$1::jsonb)`,[JSON.stringify(rows.slice(offset,offset+100))]);
    }
    assert.equal((await query(`SELECT count(*)::int AS n FROM "${table}"`))[0].n,rows.length,table);
  }
  const target=await cleanupPlan(query, backup.restoreOrder);
  const snapshot=async()=>Object.fromEntries(await Promise.all(target.tables.map(async table=>[table,await query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)])));
  const restoredSnapshot=await snapshot();
  await replayCrmMigrations(db,{from:'20261030000000_strengthen_relational_integrity',before:'20261031000000_retire_obsolete_infrastructure'});
  assert.deepEqual(await snapshot(),restoredSnapshot,'Integrity migration preserves every restored row and column');
  const plans=[];
  const queries={
    leads:'SELECT id,"firstName","lastName" FROM "Lead" WHERE "tenantId"=$1 AND NOT "isArchived" ORDER BY "createdAt" DESC LIMIT 25',
    contacts:'SELECT id,"firstName","lastName" FROM "Contact" WHERE "tenantId"=$1 AND NOT "isArchived" ORDER BY "createdAt" DESC LIMIT 25',
    accounts:'SELECT id,name FROM "Account" WHERE "tenantId"=$1 AND NOT "isArchived" ORDER BY name LIMIT 25',
    pipeline:'SELECT d.id,d.title,s.name FROM "Deal" d JOIN "Stage" s ON s.id=d."stageId" WHERE d."tenantId"=$1 AND NOT d."isArchived" ORDER BY d."order" LIMIT 25',
    tasks:'SELECT id,title FROM "Task" WHERE "tenantId"=$1 AND NOT "isArchived" ORDER BY "dueDate" LIMIT 25',
    campaignReport:'SELECT c.id,c."sentCount",m."snapshotAt" FROM "Campaign" c LEFT JOIN LATERAL (SELECT "snapshotAt" FROM "CampaignMetrics" WHERE "campaignId"=c.id ORDER BY "snapshotAt" DESC LIMIT 1) m ON true WHERE c."tenantId"=$1',
    workflows:'SELECT "workflowId",status,count(*) FROM "WorkflowExecutionRun" WHERE "tenantId"=$1 GROUP BY "workflowId",status',
    notifications:'SELECT id,title FROM "Notification" WHERE "tenantId"=$1 AND NOT "isRead" ORDER BY "createdAt" DESC LIMIT 25',
    archivedData:'SELECT id FROM "Lead" WHERE "tenantId"=$1 AND "isArchived" ORDER BY "deletedAt" DESC LIMIT 25',
    team:'SELECT u.id,r."roleId" FROM "User" u LEFT JOIN "UserRole" r ON r."userId"=u.id AND r."tenantId"=u."tenantId" WHERE u."tenantId"=$1',
    importHistory:'SELECT id,"fileName",status FROM "CrmImportJob" WHERE "tenantId"=$1 ORDER BY "createdAt" DESC,id DESC LIMIT 25',
    mailbox:'SELECT id,subject FROM "MailboxMessage" WHERE "tenantId"=$1 ORDER BY "sentAt" DESC LIMIT 25',
  };
  await db.exec('ANALYZE');
  for(const [name,sql] of Object.entries(queries)) plans.push({name,plan:await query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,[target.user.tenantId])});
  writeFileSync(resolve(folder,'restored-query-plans.json'),JSON.stringify(plans,null,2));
  const original=(await query('SELECT to_jsonb(u) AS row FROM "User" u WHERE id=$1',[target.user.id]))[0].row;
  await db.exec('BEGIN');
  await clearDummyRows(query,target);
  await db.exec('ROLLBACK');
  for(const table of target.tables) assert.equal((await query(`SELECT count(*)::int AS n FROM "${table}"`))[0].n,backup.rows[table].length,table+' rollback');
  await db.exec('BEGIN');
  const counts=await clearDummyRows(query,target);
  await db.exec('COMMIT');
  assert.equal((await query('SELECT count(*)::int AS n FROM "User"'))[0].n,1);
  assert.deepEqual((await query('SELECT to_jsonb(u) AS row FROM "User" u'))[0].row,original);
  const orphanRoles=await query('SELECT count(*)::int AS n FROM "UserRole" r LEFT JOIN "User" u ON u.id=r."userId" LEFT JOIN "RoleDefinition" d ON d.id=r."roleId" WHERE u.id IS NULL OR d.id IS NULL');
  assert.equal(orphanRoles[0].n,0);
  const evidence={backupRestored:true,backupPath:plan.backupPath,checksumVerified:true,tables:target.tables.length,allRowCountsRestored:true,integrityMigrationPreservedEveryRow:true,queryPlans:plans.length,rollbackVerified:true,userExactlyPreserved:true,counts};
  writeFileSync(resolve(folder,'cleanup-rehearsal.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({backupRestored:true,tables:target.tables.length,rollbackVerified:true,userExactlyPreserved:true,remaining:counts.filter(c=>c.after>0)},null,2));
} catch(error) {
  console.error(JSON.stringify({status:'failed',code:error.code||error.name,message:String(error.message).slice(0,200)}));
  process.exitCode=1;
} finally {await db.close();}
