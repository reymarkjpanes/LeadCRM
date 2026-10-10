// Read-only complete row snapshot before guarded forward schema retirement.
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(import.meta.dirname, '../.env') });
const db=new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL||process.env.DATABASE_URL}},log:[]});
const folder=resolve(import.meta.dirname,'../../data/outputs/database-audit');mkdirSync(folder,{recursive:true});
const q=name=>'"'+name.replaceAll('"','""')+'"';
try {
 const backup=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  const tables=(await tx.$queryRawUnsafe("SELECT tablename name FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.name);
  const fks=await tx.$queryRawUnsafe(`SELECT child.relname child,parent.relname parent FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace n ON n.oid=child.relnamespace WHERE c.contype='f' AND n.nspname='public'`);
  const remaining=new Set(tables.filter(t=>t!=='_prisma_migrations')), restoreOrder=[];
  while(remaining.size) {
   const ready=[...remaining].filter(t=>!fks.some(f=>f.child===t&&f.parent!==t&&remaining.has(f.parent)));
   if(!ready.length)throw new Error('CYCLIC_RESTORE_ORDER');
   for(const t of ready){restoreOrder.push(t);remaining.delete(t);}
  }
  const rows={};for(const table of tables)rows[table]=(await tx.$queryRawUnsafe(`SELECT to_jsonb(t) row FROM ${q(table)} t ORDER BY to_jsonb(t)::text`)).map(r=>r.row);
  return {version:1,createdAt:new Date().toISOString(),restoreOrder,rows};
 },{timeout:180000});
 const backupPath=resolve(folder,'retirement-recovery-'+backup.createdAt.replace(/[:.]/g,'-')+'.json');
 const bytes=JSON.stringify(backup),sha256=createHash('sha256').update(bytes).digest('hex');
 const fd=openSync(backupPath,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 if(createHash('sha256').update(readFileSync(backupPath)).digest('hex')!==sha256)throw new Error('BACKUP_CHECKSUM_FAILED');
 writeFileSync(backupPath+'.sha256',sha256+'\n',{flag:'wx'});
 const report={backupPath,sha256,tables:backup.restoreOrder.length,counts:backup.restoreOrder.map(table=>({table,rows:backup.rows[table].length}))};
 writeFileSync(resolve(folder,'retirement-backup.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({backupPath,sha256,tables:report.tables,rows:report.counts.reduce((n,r)=>n+r.rows,0)}));
}finally{await db.$disconnect();}
