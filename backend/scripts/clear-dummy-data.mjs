// Explicit one-off user-authorized cleanup. Default mode only backs up and plans.
// Never resets schemas, truncates tables, disables constraints, or contacts providers.
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const q = name => '"' + name.replaceAll('"','""') + '"';
export const preservedEmail = 'seeder@camxian.com';

export async function cleanupPlan(query, reviewedTables) {
  const users = await query('SELECT id,"tenantId",email,role,status,"passwordHash" IS NOT NULL AS "hasPassword" FROM "User" WHERE lower(trim(email))=$1',[preservedEmail]);
  if (users.length !== 1 || users[0].status !== 'ACTIVE' || !users[0].hasPassword) throw new Error('PRESERVED_ACCOUNT_NOT_UNAMBIGUOUS_AND_LOGIN_READY');
  const user=users[0];
  const roles=await query('SELECT id FROM "RoleDefinition" WHERE "tenantId"=$1 AND (name=$2 OR id IN (SELECT "roleId" FROM "UserRole" WHERE "userId"=$3))',[user.tenantId,user.role,user.id]);
  if (!roles.length) throw new Error('PRESERVED_ROLE_MISSING');
  const tables=(await query("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).map(t=>t.name);
  const models=reviewedTables ? [...reviewedTables].sort() : [...readFileSync(resolve(import.meta.dirname,'../prisma/schema.prisma'),'utf8').matchAll(/^model (\w+) \{/gm)].map(m=>m[1]).sort();
  if (JSON.stringify(tables)!==JSON.stringify(models)) throw new Error('UNREVIEWED_PHYSICAL_TABLES');
  const fks=await query(`SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace n ON n.oid=child.relnamespace WHERE c.contype='f' AND n.nspname='public'`);
  const order=[], remaining=new Set(tables);
  while(remaining.size) {
    const leaves=[...remaining].filter(table=>!fks.some(f=>f.parent===table && f.child!==table && remaining.has(f.child)));
    if(!leaves.length) throw new Error('CYCLIC_DELETE_DEPENDENCIES');
    for(const table of leaves) {order.push(table);remaining.delete(table);}
  }
  return { user,roleIds:roles.map(r=>r.id),tables,order };
}

export function preservation(plan,table) {
  const {user,roleIds}=plan;
  if(table==='User') return {sql:'id=$1',params:[user.id]};
  if(table==='Tenant') return {sql:'id=$1',params:[user.tenantId]};
  if(table==='RoleDefinition') return {sql:'id = ANY($1::text[])',params:[roleIds]};
  if(table==='RolePermission') return {sql:'"roleId" = ANY($1::text[])',params:[roleIds]};
  if(table==='UserRole') return {sql:'"userId"=$1 AND "tenantId"=$2',params:[user.id,user.tenantId]};
  if(table==='Session') return {sql:'"userId"=$1 AND "tenantId"=$2',params:[user.id,user.tenantId]};
  return {sql:'FALSE',params:[]};
}

export async function clearDummyRows(query,plan) {
  const beforeUser=(await query('SELECT to_jsonb(u) AS row FROM "User" u WHERE id=$1',[plan.user.id]))[0].row;
  const counts=[];
  for(const table of plan.order) {
    const keep=preservation(plan,table);
    const [{count:before}]=await query(`SELECT count(*)::int AS count FROM ${q(table)}`);
    await query(`DELETE FROM ${q(table)} WHERE NOT (${keep.sql}) RETURNING 1`,keep.params);
    const [{count:after}]=await query(`SELECT count(*)::int AS count FROM ${q(table)}`);
    counts.push({table,before,after,deleted:before-after});
    const [{count:unexpected}]=await query(`SELECT count(*)::int AS count FROM ${q(table)} WHERE NOT (${keep.sql})`,keep.params);
    if(unexpected) throw new Error('UNEXPECTED_REMAINING_ROWS');
  }
  const afterUser=(await query('SELECT to_jsonb(u) AS row FROM "User" u WHERE id=$1',[plan.user.id]))[0].row;
  if(JSON.stringify(beforeUser)!==JSON.stringify(afterUser)) throw new Error('PRESERVED_USER_CHANGED');
  return counts.sort((a,b)=>a.table.localeCompare(b.table));
}

async function main() {
  const apply=process.argv.includes('--apply');
  if(process.argv.slice(2).some(arg=>!['--apply','--backup'].includes(arg))) throw new Error('INVALID_MODE');
  dotenv.config({path:resolve(import.meta.dirname,'../.env')});
  const db=new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL||process.env.DATABASE_URL}}});
  const folder=resolve(import.meta.dirname,'../../data/outputs/database-audit');
  mkdirSync(folder,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backupPath=resolve(folder,`recovery-${stamp}.json`);
  try {
    const result=await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      if(!apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='30s'");
      const query=(sql,params=[])=>tx.$queryRawUnsafe(sql,...params);
      const plan=await cleanupPlan(query);
      if(apply) await tx.$executeRawUnsafe(`LOCK TABLE ${plan.tables.map(q).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      const rows={};
      for(const table of [...plan.tables,'_prisma_migrations']) rows[table]=(await query(`SELECT to_jsonb(t) AS row FROM ${q(table)} t`)).map(r=>r.row);
      const backup={version:1,createdAt:new Date().toISOString(),schema:readFileSync(resolve(import.meta.dirname,'../prisma/schema.prisma'),'utf8'),restoreOrder:[...plan.order].reverse(),rows};
      const bytes=JSON.stringify(backup);
      const fd=openSync(backupPath,'wx',0o600);
      try { writeFileSync(fd,bytes);fsyncSync(fd); } finally {closeSync(fd);}
      const digest=createHash('sha256').update(bytes).digest('hex');
      writeFileSync(backupPath+'.sha256',digest+'\n',{flag:'wx'});
      if(createHash('sha256').update(readFileSync(backupPath)).digest('hex')!==digest) throw new Error('BACKUP_VERIFICATION_FAILED');
      if(!apply) return {mode:'backup-and-plan',backupPath,sha256:digest,preservedEmail,counts:plan.tables.map(table=>({table,before:rows[table].length})),preserves:['User','Tenant','RoleDefinition','RolePermission','UserRole','Session']};
      const counts=await clearDummyRows(query,plan);
      return {mode:'applied',backupPath,sha256:digest,preservedEmail,counts};
    },{maxWait:10000,timeout:300000});
    const reportPath=resolve(folder,apply?'cleanup-result.json':'cleanup-plan.json');
    writeFileSync(reportPath,JSON.stringify(result,null,2));
    console.log(JSON.stringify({mode:result.mode,backupPath:result.backupPath,reportPath,preservedEmail,remaining:result.counts.filter(c=>c.after>0),deleted:result.counts.reduce((n,c)=>n+(c.deleted||0),0)},null,2));
  } finally {await db.$disconnect();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{
  writeFileSync(resolve(import.meta.dirname,'../../data/outputs/database-audit/cleanup-error.json'),JSON.stringify({code:error.code,meta:error.meta,message:error.message},null,2));
  console.error(JSON.stringify({status:'failed',code:error.code||error.errorCode||error.message?.match(/^[A-Z_]+$/)?.[0]||error.name,postgresCode:error.meta?.code,detail:'Transaction did not commit. Backup files, if created, were retained.'}));process.exitCode=1;
});
