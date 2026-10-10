// Read-only audit of the configured database. No schema or record changes.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const root = resolve(import.meta.dirname, '../..'), output = resolve(root, 'data/outputs/dashboard-verification');
mkdirSync(output,{recursive:true});
const require = createRequire(import.meta.url);
require('dotenv').config({path:resolve(root,'backend/.env')});
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({log:[]});
const result = { database:'Configured connection; host and credentials withheld', checkedAt:new Date().toISOString() };
try {
  result.audit = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15000ms'");
    const pipelines = await tx.$queryRawUnsafe(`SELECT p.id, p."tenantId", p.name, p."isArchived", json_agg(json_build_object('id',s.id,'name',s.name,'order',s."order",'color',s.color,'probability',s.probability,'isWon',s."isWon",'isLost',s."isLost") ORDER BY s."order",s.id) AS stages FROM "Pipeline" p JOIN "Stage" s ON s."pipelineId"=p.id AND s."tenantId"=p."tenantId" WHERE lower(p.name)='sales pipeline' GROUP BY p.id`);
    const anomalies = await tx.$queryRawUnsafe(`SELECT d."tenantId", COUNT(*)::int AS deals, COUNT(*) FILTER (WHERE (s."isWon" OR s."isLost") AND d."closedAt" IS NULL)::int AS "missingClose", COUNT(*) FILTER (WHERE d."closedAt" < d."createdAt")::int AS "invalidClose", COUNT(*) FILTER (WHERE d.currency IS DISTINCT FROM COALESCE(t.currency,'PHP'))::int AS "otherCurrency", COUNT(*) FILTER (WHERE d.value IS NULL OR d.value < 0)::int AS "missingAmount", COUNT(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM "DealStageHistory" h WHERE h."dealId"=d.id AND h."previousStageId" IS NULL AND h."movedAt"=d."createdAt"))::int AS "missingInitialHistory" FROM "Deal" d JOIN "Stage" s ON s.id=d."stageId" AND s."tenantId"=d."tenantId" JOIN "Tenant" t ON t.id=d."tenantId" WHERE NOT d."isArchived" AND d."deletedAt" IS NULL GROUP BY d."tenantId"`);
    const migrations = await tx.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name DESC LIMIT 8');
    const schema = await tx.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Deal' AND column_name IN ('revenueOwnerId','revenueOwnerEligible')`);
    // Tenant UUIDs are reported as aliases; actual stage/pipeline UUIDs are needed
    // to verify canonical mappings. No users or individual CRM records are read.
    const aliases = new Map(); const alias = id => { if(!aliases.has(id)) aliases.set(id,`Workspace ${aliases.size+1}`); return aliases.get(id); };
    return {pipelines:pipelines.map(p=>({...p,tenantId:alias(p.tenantId)})),anomalies:anomalies.map(a=>({...a,tenantId:alias(a.tenantId)})),migrations,schema};
  },{timeout:30000});
  console.log(JSON.stringify(result,null,2));
} catch(error) { result.error = error.code || error.name || 'Connection unavailable'; console.log(JSON.stringify(result,null,2)); process.exitCode=1; }
finally { writeFileSync(resolve(output,'configured-db-audit.json'),JSON.stringify(result,null,2)); await db.$disconnect(); }
