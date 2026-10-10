import { notificationTestPostgres } from './notification-test-postgres.mjs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),pg=await notificationTestPostgres();
const database=await pg.database('leadcrm_notification_worker_1');
Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),ENCRYPTION_KEY:randomBytes(32).toString('hex'),BREVO_API_KEY:'',RESEND_API_KEY:''});
const require=createRequire(import.meta.url),Module=require('node:module'),original=Module._resolveFilename;
Module._resolveFilename=function(request,parent,isMain,options){return request==='@leadcrm/shared'?resolve(root,'backend/dist/shared/src/index.js'):original.call(this,request,parent,isMain,options);};
const prisma=require('../dist/backend/src/config/database.config.js').default;
let worker;
const start=()=>{worker=spawn(process.execPath,[resolve(root,'backend/dist/start.js'),'--notifications-worker'],{cwd:resolve(root,'backend'),windowsHide:true,stdio:'ignore',env:process.env});};
const stop=async()=>{if(worker&&worker.exitCode===null){const exited=new Promise(done=>worker.once('exit',done));worker.kill();await exited;}worker=undefined;};
const until=async check=>{for(let n=0;n<150;n++){if(worker?.exitCode!==null)throw Error('Standalone worker exited early');if(await check())return;await new Promise(done=>setTimeout(done,100));}throw Error('Standalone worker did not drain its queue');};
try {
  const tenant=await prisma.tenant.create({data:{name:'Worker entrypoint',slug:randomUUID()}});
  const role=await prisma.roleDefinition.create({data:{tenantId:tenant.id,name:'Agent',permissions:{create:{module:'contacts',canView:true}}}});
  const user=await prisma.user.create({data:{tenantId:tenant.id,email:randomUUID()+'@camxian.com',firstName:'Worker',lastName:'Tester',role:'Agent',userRoles:{create:{roleId:role.id}}}});
  const contact=await prisma.contact.create({data:{tenantId:tenant.id,firstName:'Worker',lastName:'Contact',assignedUserId:user.id}});
  start();await until(async()=>await prisma.notification.count({where:{tenantId:tenant.id,entityId:contact.id}})===1);await stop();
  const notice=await prisma.notification.findFirstOrThrow({where:{tenantId:tenant.id,entityId:contact.id}});
  await prisma.notification.delete({where:{id:notice.id}});
  await prisma.notificationEvent.updateMany({where:{tenantId:tenant.id,entityId:contact.id},data:{processedAt:null}});
  start();await until(async()=>await prisma.notificationEvent.count({where:{tenantId:tenant.id,processedAt:null}})===0);
  assert.equal(await prisma.notification.count({where:{tenantId:tenant.id,entityId:contact.id}}),0);
  console.log('PASS compiled standalone worker starts, delivers, restarts, and preserves deleted-event identity.');
}finally{await stop();await prisma.$disconnect();pg.stop();}
