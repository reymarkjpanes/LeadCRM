// Exercises the committed migration against historical fixtures, never a live database.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const db = await PGlite.create();
const migration = '20261029000000_normalize_product_relationships';
try {
  await replayCrmMigrations(db, { before: migration });
  await db.exec(`
    INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('migration-products','Products','migration-products',now()),('migration-foreign','Foreign','migration-foreign',now());
    INSERT INTO "ProductInterest" (id,"tenantId",name,"dealValue","updatedAt") VALUES
      ('cctv','migration-products','CCTV Surveillance System',25000,now()),('bio','migration-products','Biometrics',15000,now()),
      ('others','migration-products','Others',0,now()),('foreign','migration-foreign','CCTV Surveillance System',99000,now());
    INSERT INTO "User" (id,"tenantId","firstName","lastName",email,role,"updatedAt") VALUES ('migration-actor','migration-products','Test','Actor','actor@example.test','Client Admin',now());
    INSERT INTO "Lead" (id,"tenantId","firstName","lastName","productInterest","productInterestIds","updatedAt") VALUES
      ('lead-normal','migration-products','Normal','Lead',ARRAY['CCTV Surveillance System','Biometrics','CCTV Surveillance System'],ARRAY['cctv','bio'],now()),
      ('lead-unresolved','migration-products','Legacy','Lead',ARRAY['CCTV','Others'],ARRAY[]::text[],now()),
      ('lead-id','migration-products','ID','Lead',ARRAY[]::text[],ARRAY['bio'],now());
    INSERT INTO "Contact" (id,"tenantId","firstName","lastName","productInterests","activeProducts","updatedAt") VALUES
      ('contact-normal','migration-products','Normal','Contact',ARRAY['CCTV Surveillance System','Others'],ARRAY['CCTV Surveillance System','Biometrics'],now());
    INSERT INTO "Account" (id,"tenantId",name,"productInterests","activeProducts","updatedAt") VALUES
      ('account-normal','migration-products','Normal',ARRAY['Others'],ARRAY['CCTV Surveillance System'],now());
    INSERT INTO "Pipeline" (id,"tenantId",name,"updatedAt") VALUES ('migration-pipeline','migration-products','Sales',now());
    INSERT INTO "Stage" (id,"tenantId","pipelineId",name,"order","requiredFields") VALUES ('migration-stage','migration-products','migration-pipeline','Lead',0,ARRAY[]::text[]);
    INSERT INTO "Deal" (id,"tenantId","pipelineId","stageId",title,value,"productInterests","productInterestIds","leadId","contactId","updatedAt") VALUES
      ('deal-single','migration-products','migration-pipeline','migration-stage','Single',12345.67,ARRAY['CCTV Surveillance System'],ARRAY[]::text[],'lead-normal','contact-normal',now()),
      ('deal-multi','migration-products','migration-pipeline','migration-stage','Historical bundle',333.33,ARRAY['CCTV Surveillance System','Biometrics'],ARRAY['cctv','bio'],NULL,NULL,now()),
      ('deal-unknown','migration-products','migration-pipeline','migration-stage','Unknown product',987.65,ARRAY['Retired unknown'],ARRAY[]::text[],NULL,NULL,now());
    INSERT INTO "Deal" (id,"tenantId","pipelineId","stageId",title,value,"productInterestId","productInterests","productInterestIds","updatedAt") VALUES
      ('deal-conflict','migration-products','migration-pipeline','migration-stage','Conflicting historical fields',123,'cctv',ARRAY['Biometrics'],ARRAY['bio'],now());
    INSERT INTO "Task" (id,"tenantId",title,"assignedUserId","dueDate","leadId","updatedAt") VALUES ('migration-task','migration-products','Keep positions','migration-actor',now(),'lead-id',now());
    INSERT INTO "TaskLead" ("taskId","tenantId","leadId",position) VALUES ('migration-task','migration-products','lead-normal',4);
  `);
  const rows = sql => db.query(sql).then(result => result.rows);
  const original = await rows('SELECT id,value,"productInterests","productInterestIds" FROM "Deal" ORDER BY id');
  const prices = await rows('SELECT id,"dealValue"::text FROM "ProductInterest" ORDER BY id');
  const originalLeads = await rows('SELECT id,"productInterest","productInterestIds" FROM "Lead" ORDER BY id');
  const tables = (await rows("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).map(row => row.tablename);
  const beforeCounts = Object.fromEntries(await Promise.all(tables.map(async table => [table, (await rows(`SELECT count(*)::int AS n FROM "${table}"`))[0].n])));
  await replayCrmMigrations(db, { from: migration });
  assert.deepEqual(await rows('SELECT id,value,"productInterests","productInterestIds" FROM "Deal" ORDER BY id'), original);
  assert.deepEqual(await rows('SELECT id,"dealValue"::text FROM "ProductInterest" ORDER BY id'), prices);
  assert.deepEqual(await rows('SELECT id,"productInterest","productInterestIds" FROM "Lead" ORDER BY id'), originalLeads);
  for (const table of tables.filter(t => !['LeadDeal','ContactDeal','TaskLead'].includes(t))) assert.equal((await rows(`SELECT count(*)::int AS n FROM "${table}"`))[0].n, beforeCounts[table], table + ' rows preserved');
  assert.equal((await rows('SELECT count(*)::int AS n FROM "LeadProductInterest"'))[0].n, 4);
  assert.equal((await rows('SELECT count(*)::int AS n FROM "ContactProductInterest"'))[0].n, 3);
  assert.equal((await rows('SELECT count(*)::int AS n FROM "AccountProductInterest"'))[0].n, 2);
  assert.deepEqual(await rows('SELECT "productInterestId",interested,"activeProduct" FROM "ContactProductInterest" ORDER BY "productInterestId"'), [
    { productInterestId: 'bio', interested: false, activeProduct: true },
    { productInterestId: 'cctv', interested: true, activeProduct: true },
    { productInterestId: 'others', interested: true, activeProduct: false },
  ]);
  assert.equal((await rows(`SELECT "productsNormalized" FROM "Lead" WHERE id='lead-unresolved'`))[0].productsNormalized, false);
  assert.equal((await rows(`SELECT "productsNormalized" FROM "Lead" WHERE id='lead-normal'`))[0].productsNormalized, true);
  assert.deepEqual(await rows('SELECT id,"productInterestId" FROM "Deal" ORDER BY id'), [
    { id: 'deal-conflict', productInterestId: 'cctv' },
    { id: 'deal-multi', productInterestId: null }, { id: 'deal-single', productInterestId: 'cctv' }, { id: 'deal-unknown', productInterestId: null },
  ]);
  assert.deepEqual(await rows('SELECT id,"productsNormalized" FROM "Deal" ORDER BY id'), [
    { id: 'deal-conflict', productsNormalized: false }, { id: 'deal-multi', productsNormalized: false },
    { id: 'deal-single', productsNormalized: true }, { id: 'deal-unknown', productsNormalized: false },
  ]);
  assert.deepEqual(await rows('SELECT "leadId",position FROM "TaskLead" ORDER BY position'), [{ leadId: 'lead-normal', position: 4 }, { leadId: 'lead-id', position: 5 }]);
  assert.equal((await rows('SELECT count(*)::int AS n FROM "LeadDeal"'))[0].n, 1);
  assert.equal((await rows('SELECT count(*)::int AS n FROM "ContactDeal"'))[0].n, 1);
  await assert.rejects(db.exec(`INSERT INTO "LeadProductInterest" ("leadId","productInterestId","tenantId") VALUES ('lead-normal','cctv','migration-products')`), /unique|duplicate/i);
  await assert.rejects(db.exec(`INSERT INTO "LeadProductInterest" ("leadId","productInterestId","tenantId") VALUES ('lead-normal','foreign','migration-products')`), /foreign key/i);
  await assert.rejects(db.exec(`DELETE FROM "ProductInterest" WHERE id='cctv'`), /foreign key/i);
  await assert.rejects(db.exec(`UPDATE "Deal" SET "productInterestId"='foreign' WHERE id='deal-single'`), /foreign key/i);
  console.log('PASS: complete migration replay; original rows, arrays, prices and Deal snapshots preserved; 4/3/2 product links; unresolved text and multi-product history retained; Deal/Task links backfilled without reordering; duplicate/cross-tenant/deletion constraints enforced.');
} finally { await db.close(); }
