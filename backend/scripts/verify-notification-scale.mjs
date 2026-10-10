import { notificationTestPostgres } from './notification-test-postgres.mjs';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'), pg=await notificationTestPostgres();
const url=await pg.database('leadcrm_notification_scale_1');
Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),ENCRYPTION_KEY:randomBytes(32).toString('hex'),BREVO_API_KEY:'',RESEND_API_KEY:''});
const require=createRequire(import.meta.url),Module=require('node:module'),original=Module._resolveFilename;
Module._resolveFilename=function(request,parent,isMain,options){return request==='@leadcrm/shared'?resolve(root,'backend/dist/shared/src/index.js'):original.call(this,request,parent,isMain,options);};
const prisma=require('../dist/backend/src/config/database.config.js').default;
const {dispatchTenantNotifications,runNotificationWorker}=require('../dist/backend/src/modules/notifications/notification-events.service.js');
const {issueAuthSession}=require('../dist/backend/src/core/auth/auth-session.js');
const app=require('../dist/backend/src/app.js').default;
let server; const children=new Set();
const child=(tenantId,pause=false)=>{const worker=fork(resolve(import.meta.dirname,'notification-worker-once.cjs'),[],{windowsHide:true,stdio:['ignore','ignore','inherit','ipc'],env:{...process.env,TEST_TENANT_ID:tenantId,PAUSE_DELIVERY:String(pause)}});children.add(worker);worker.on('exit',()=>children.delete(worker));return worker;};
const exit=worker=>new Promise((done,fail)=>{worker.once('exit',code=>code===0?done():fail(Error('Worker exited '+code)));worker.once('error',fail);});
try {
  const tenants=[],users=[];
  for(let t=0;t<20;t++){
    const tenant=await prisma.tenant.create({data:{name:'Scale '+t,slug:randomUUID(),onboardingStep:3,onboardingCompletedAt:new Date()}});tenants.push(tenant.id);
    const role=await prisma.roleDefinition.create({data:{tenantId:tenant.id,name:'Scale Agent',permissions:{create:{module:'contacts',canView:true,canEdit:true}}}});
    for(let u=0;u<10;u++){
      const user=await prisma.user.create({data:{tenantId:tenant.id,email:randomUUID()+'@camxian.com',firstName:'Scale',lastName:'Agent',role:role.name,mustChangePassword:false,onboardingCompletedAt:new Date(),userRoles:{create:{roleId:role.id}}}});
      const contact=await prisma.contact.create({data:{tenantId:tenant.id,assignedUserId:user.id,firstName:'Scale',lastName:'History'}});users.push({...user,contactId:contact.id});
      // Test-only historical fixtures, each linked to a real owned Contact.
      const count=users.length===1?20000:500;
      await prisma.$executeRaw`INSERT INTO "Notification" (id,"tenantId","userId",type,title,"entityType","entityId","isRead","createdAt")
        SELECT gen_random_uuid()::text,${tenant.id},${user.id},'contact_assigned','Scale history','Contact',${contact.id},false,
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-g*interval '1 second' FROM generate_series(1,${count}::integer) g`;
    }
  }
  await prisma.$executeRaw`ANALYZE "Notification"`;
  const lead=users[0], before=await prisma.notification.count({where:{tenantId:lead.tenantId,userId:lead.id}});
  await prisma.notificationEvent.updateMany({data:{processedAt:new Date()}}); // finish fixture-creation events before the measured burst
  const started=performance.now();
  const contacts=[];for(let n=0;n<240;n++)contacts.push((await prisma.contact.create({data:{tenantId:lead.tenantId,assignedUserId:lead.id,firstName:'Burst',lastName:String(n)}})).id);
  const crashed=child(lead.tenantId,true);
  await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(Error('Worker never reached delivery')),15000);crashed.once('message',()=>{clearTimeout(timer);done();});crashed.once('error',fail);});
  const crashedExit=new Promise(done=>crashed.once('exit',done));crashed.kill('SIGKILL');await crashedExit;
  assert.ok(await prisma.notificationEvent.count({where:{tenantId:lead.tenantId,processedAt:null,leaseToken:{not:null}}}));
  await prisma.notificationEvent.updateMany({where:{tenantId:lead.tenantId,processedAt:null},data:{leaseUntil:new Date(Date.now()-1000)}}); // expedite the real 120-second expiry
  await Promise.all([exit(child(lead.tenantId)),exit(child(lead.tenantId))]);
  const burstMs=Math.round(performance.now()-started);
  assert.equal(await prisma.notification.count({where:{tenantId:lead.tenantId,userId:lead.id}}),before+240);
  assert.equal(await prisma.notificationDelivery.count({where:{tenantId:lead.tenantId,userId:lead.id}}),240);
  assert.equal(await prisma.notificationEvent.count({where:{processedAt:null}}),0);
  const discoveryStart=performance.now();await runNotificationWorker();const discoveryMs=Math.round(performance.now()-discoveryStart);
  server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));const base='http://127.0.0.1:'+server.address().port+'/api/v1/notifications';
  const token=(await issueAuthSession(lead)).token;
  async function measure(path){const elapsed=[];await fetch(base+path,{headers:{Authorization:'Bearer '+token}});for(let n=0;n<20;n++){const at=performance.now();const r=await fetch(base+path,{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);const body=await r.json();assert.equal(body.totalCount,before+240);elapsed.push(performance.now()-at);}elapsed.sort((a,b)=>a-b);return {medianMs:Math.round(elapsed[10]),p95Ms:Math.round(elapsed[18]),maxMs:Math.round(elapsed[19])};}
  const counts=await measure('/counts'),page=await measure('?limit=20');
  const concurrentStart=performance.now();await Promise.all(users.slice(0,20).map(async user=>{const session=await issueAuthSession(user);const response=await fetch(base+'/counts',{headers:{Authorization:'Bearer '+session.token}});assert.equal(response.status,200);const data=await response.json();assert.equal(data.totalCount,user.id===lead.id?20240:500);}));
  const concurrent20Ms=Math.round(performance.now()-concurrentStart);
  const plan=await prisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM "Notification" WHERE "tenantId"=${lead.tenantId} AND "userId"=${lead.id} ORDER BY "createdAt" DESC,id ASC LIMIT 20`;
  const result={tenants:20,activeEmployees:200,historyRows:119500,burstAssignments:240,processes:2,killedWorkerRecovered:true,leaseExpiryExpedited:true,duplicateDeliveries:0,burstMs,counts,page,concurrent20Ms,idleTenantDiscoveryMs:discoveryMs,queryPlan:plan};
  writeFileSync(resolve(root,'data/outputs/notification-verification/scale.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,queryPlan:undefined},null,2));
}finally{for(const worker of children)worker.kill();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await prisma.$disconnect();pg.stop();}
