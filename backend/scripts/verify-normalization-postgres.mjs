// Actual Prisma deploy/diff on a fresh local PostgreSQL cluster; no .env is loaded.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const bin=process.env.CRM_TEST_POSTGRES_BIN||'C:/Program Files/PostgreSQL/17/bin';
const folder=resolve(root,'../data/outputs/database-audit');mkdirSync(folder,{recursive:true});
const directory=mkdtempSync(resolve(folder,'postgres-')), port='55447';
const exe=name=>resolve(bin,name+(process.platform==='win32'?'.exe':''));
const url=`postgresql://postgres@127.0.0.1:${port}/leadcrm_environment_test_2?connection_limit=5`;
const env={...process.env,DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),ENCRYPTION_KEY:randomBytes(32).toString('hex')};
const run=(file,args)=>new Promise((done,fail)=>{const child=spawn(file,args,{cwd:root,env,stdio:'inherit',windowsHide:true});child.on('error',fail);child.on('exit',code=>done(code??1));});
const prisma=args=>run(process.execPath,[resolve(root,'../node_modules/prisma/build/index.js'),...args]);
let started=false;
try {
  if(await run(exe('initdb'),['-D',directory,'-U','postgres','-A','trust','--encoding=UTF8','--no-locale']))throw new Error('INITDB_FAILED');
  if(await run(exe('pg_ctl'),['-D',directory,'-l',resolve(directory,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']))throw new Error('POSTGRES_START_FAILED');started=true;
  if(await run(exe('createdb'),['-h','127.0.0.1','-p',port,'-U','postgres','leadcrm_environment_test_2']))throw new Error('CREATEDB_FAILED');
  const replay=await prisma(['migrate','deploy','--schema','prisma/schema.prisma']);
  if(replay)throw new Error('PRISMA_REPLAY_FAILED');
  const diff=await prisma(['migrate','diff','--from-schema-datasource','prisma/schema.prisma','--to-schema-datamodel','prisma/schema.prisma','--exit-code','--script','--output',resolve(folder,'native-replay-drift.sql')]);
  if(diff)throw new Error('PRISMA_DRIFT_DETECTED');
  const roles=await run(process.execPath,[resolve(root,'../node_modules/vitest/vitest.mjs'),'run','src/modules/administration/roles/__tests__/roles.integration.test.ts','--maxWorkers=1']);
  const groupUrl=url.replace('leadcrm_environment_test_2','leadcrm_campaign_test_2');
  if(await run(exe('createdb'),['-h','127.0.0.1','-p',port,'-U','postgres','leadcrm_campaign_test_2']))throw new Error('GROUP_DATABASE_FAILED');
  env.DATABASE_URL=env.DIRECT_URL=groupUrl;
  if(await prisma(['migrate','deploy','--schema','prisma/schema.prisma']))throw new Error('GROUP_REPLAY_FAILED');
  const groups=await run(process.execPath,[resolve(root,'../node_modules/vitest/vitest.mjs'),'run','src/modules/administration/groups/groups.integration.test.ts','--maxWorkers=1']);
  const evidence={prismaMigrationDeploy:replay,prismaSchemaDiff:diff,roleIntegration:roles,groupIntegration:groups};
  writeFileSync(resolve(folder,'native-verification.json'),JSON.stringify(evidence,null,2));
  process.exitCode=roles||groups;
} finally {if(started)await run(exe('pg_ctl'),['-D',directory,'-m','fast','-w','stop']);}
