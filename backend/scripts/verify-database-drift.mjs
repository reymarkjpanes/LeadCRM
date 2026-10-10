// Never mutates a live database. Live mode runs Prisma introspection/diff only.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const root=resolve(import.meta.dirname,'..'), live=process.argv.includes('--live');
const folder=resolve(root,'../data/outputs/database-audit');mkdirSync(folder,{recursive:true});
let db,socket;
const env={...process.env};
try {
  if(live) Object.assign(env,dotenv.parse(readFileSync(resolve(root,'.env'))));
  else {
    db=await PGlite.create();await replayCrmMigrations(db);
    socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});await socket.start();
    env.DATABASE_URL=env.DIRECT_URL=`postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`;
  }
  const output=resolve(folder,live?'live-drift.sql':'replay-drift.sql');
  const child=spawn(process.execPath,[resolve(root,'../node_modules/prisma/build/index.js'),'migrate','diff','--from-schema-datasource',resolve(root,'prisma/schema.prisma'),'--to-schema-datamodel',resolve(root,'prisma/schema.prisma'),'--script','--output',output],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
  const code=await new Promise((done,fail)=>{child.on('exit',done);child.on('error',fail);});
  writeFileSync(resolve(folder,live?'live-drift.log':'replay-drift.log'),logs);
  console.log(JSON.stringify({mode:live?'live-readonly':'disposable',exitCode:code,output}));process.exitCode=code??1;
} finally {await socket?.stop();await db?.close();}
