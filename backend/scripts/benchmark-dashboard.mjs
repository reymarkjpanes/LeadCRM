// Synthetic, explicitly disposable reporting scale check; never a production SLA.
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {replayCrmMigrations} from './replay-crm-migrations.mjs';
const root=resolve(import.meta.dirname,'../..'),output=resolve(root,'data/outputs/dashboard-verification');mkdirSync(output,{recursive:true});
const pg=await PGlite.create();await replayCrmMigrations(pg);
const socket=new PGLiteSocketServer({db:pg,host:'127.0.0.1',port:0});await socket.start();
process.env.DATABASE_URL=`postgresql://postgres:postgres@${socket.getServerConn()}/dashboard_benchmark?connection_limit=1&statement_cache_size=0`;process.env.DIRECT_URL=process.env.DATABASE_URL;process.env.NODE_ENV='test';
const require=createRequire(import.meta.url),Module=require('node:module'),original=Module._resolveFilename;
Module._resolveFilename=function(request,parent,isMain,options){return request==='@leadcrm/shared'?resolve(root,'backend/dist/shared/src/index.js'):original.call(this,request,parent,isMain,options);};
const db=require('../dist/backend/src/config/database.config.js').default;
const {getDashboard}=require('../dist/backend/src/modules/reporting/reports/dashboard.service.js');
const {tenantContext}=require('../dist/backend/src/core/tenant/tenant-context.js');
const {salesPipeline,salesTransaction}=require('../dist/backend/src/modules/crm/leads/lead-automation.service.js');
try {
  const tenant=await db.tenant.create({data:{name:'Disposable benchmark',slug:randomUUID(),onboardingStep:3,onboardingCompletedAt:new Date()}});
  const admin=await db.user.create({data:{tenantId:tenant.id,firstName:'Benchmark',lastName:'Admin',email:'benchmark@camxian.com',role:'Client Admin'}});
  const scope=work=>tenantContext.run({tenantId:tenant.id},work);
  const {pipeline}=await scope(()=>salesTransaction(tx=>salesPipeline(tx,tenant.id)));
  const stages=await db.stage.findMany({where:{pipelineId:pipeline.id},orderBy:{order:'asc'}});
  const now=new Date(),createdAt=new Date(+now-86400000*3),ids=Array.from({length:1000},()=>randomUUID());
  await db.deal.createMany({data:ids.map((id,i)=>({id,tenantId:tenant.id,pipelineId:pipeline.id,stageId:stages[i<100?3:0].id,title:`Benchmark ${i}`,ownerId:admin.id,value:1000,currency:'PHP',createdAt,...(i<100?{closedAt:new Date(+now-86400000)}:{})}))});
  const history=[];
  for(const id of ids.slice(100)) for(const [i,next] of [1,2,0,1,2].entries()) history.push({tenantId:tenant.id,dealId:id,previousStageId:stages[[0,1,2,0,1][i]].id,newStageId:stages[next].id,movedById:admin.id,movedAt:new Date(+createdAt+(i+1)*60000)});
  await db.dealStageHistory.createMany({data:history});
  await db.deal.updateMany({where:{id:{in:ids.slice(100)}},data:{stageId:stages[2].id,stageChangedAt:new Date(+createdAt+300000)}});
  const samples=[];
  for(let i=0;i<6;i++) {const report=await scope(()=>getDashboard({userId:admin.id,tenantId:tenant.id,role:admin.role,email:admin.email},{range:'last7'}));samples.push(report.queryMs);
    assert.equal(report.metrics.totalRevenue,100000);assert.equal(report.metrics.activeDeals,900);assert.equal(report.metrics.totalRevenue,report.trend.reduce((sum,p)=>sum+p.revenue,0));assert.equal(report.metrics.activeDeals,report.distribution.reduce((sum,p)=>sum+p.count,0));assert.equal(report.metrics.openPipelineValue,report.distribution.reduce((sum,p)=>sum+(p.value??0),0));}
  const result={engine:'PGlite PostgreSQL-compatible WASM, one Prisma connection, local synthetic data',deals:1000,historyEvents:await db.dealStageHistory.count(),queryMs:samples,minimum:Math.min(...samples),maximum:Math.max(...samples),mean:Math.round(samples.reduce((a,b)=>a+b,0)/samples.length*10)/10,claims:'Aggregate reconciliation only; not production concurrency or network performance'};
  writeFileSync(resolve(output,'benchmark.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await db.$disconnect();await socket.stop();await pg.close();}
