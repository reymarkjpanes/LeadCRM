import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
export async function notificationTestPostgres() {
 const root = resolve(import.meta.dirname, '../..');
 const output = resolve(root, 'data/outputs/notification-verification');
 mkdirSync(output, { recursive: true });
 const directory = mkdtempSync(join(output, 'postgres-'));
 const bin = process.env.POSTGRES_TEST_BIN || 'C:/Program Files/PostgreSQL/17/bin';
 const exe = name => resolve(bin, name + (process.platform === 'win32' ? '.exe' : ''));
 if (!existsSync(exe('initdb'))) throw Error('Set POSTGRES_TEST_BIN to the PostgreSQL bin directory.');
 const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
 const port = probe.address().port; await new Promise(done => probe.close(done));
 // Windows postgres inherits pg_ctl's output handles; pipes keep spawnSync waiting
 // after pg_ctl has exited even when the server is already ready.
 const run = (name,args) => execFileSync(exe(name),args,{ windowsHide:true, stdio:name==='pg_ctl'?'ignore':'pipe', timeout:120000 })?.toString() ?? '';
 run('initdb',['-D',directory,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
 run('pg_ctl',['-D',directory,'-l',join(directory,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c timezone=UTC -c max_connections=30`,'-w','start']);
 const psql = (database,args) => run('psql',['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1',...args]);
 const migrations = resolve(root,'backend/prisma/migrations');
 const sql = ['CREATE TABLE "_prisma_migrations" (migration_name text, finished_at timestamptz, rolled_back_at timestamptz);'];
 for (const name of readdirSync(migrations).sort()) {
   const file=join(migrations,name,'migration.sql'); if(!existsSync(file))continue;
   sql.push(readFileSync(file,'utf8'),`INSERT INTO "_prisma_migrations" VALUES ('${name}',now(),NULL);`);
 }
 const schema = join(directory,'schema.sql'); writeFileSync(schema,sql.join('\n'));
 return {
  directory,
  async database(name) {
   if(!/^leadcrm_[a-z_]+_\d+$/.test(name))throw Error('Disposable database name required');
   psql('postgres',['-c',`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`]);
   psql('postgres',['-c',`CREATE DATABASE "${name}"`]);
   psql(name,['-f',schema]);
   return `postgresql://postgres@127.0.0.1:${port}/${name}?connection_limit=4&statement_cache_size=0`;
  },
  stop() { run('pg_ctl',['-D',directory,'-m','fast','-w','stop']); },
 };
}
export async function runNotificationTestFile(file,url) {
 const root=resolve(import.meta.dirname,'..');
 const child=spawn(process.execPath,[resolve(root,'../node_modules/vitest/vitest.mjs'),'run',file,'--maxWorkers=1'],{
  cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',
   JWT_SECRET:randomBytes(32).toString('hex'),ENCRYPTION_KEY:randomBytes(32).toString('hex'),BREVO_API_KEY:'',BREVO_SMS_SENDER:'',RESEND_API_KEY:'',
   GMAIL_CLIENT_ID:'disposable-test',GMAIL_CLIENT_SECRET:'disposable-test',GMAIL_REDIRECT_URI:'http://localhost:4000/api/v1/integrations/gmail/callback',APP_URL:'http://localhost:3000',
  }});
 return new Promise((done,fail)=>{child.on('exit',code=>done(code??1));child.on('error',fail);});
}
