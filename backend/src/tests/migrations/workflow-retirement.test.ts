import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('workflow retirement migration preserves configured work', () => {
  const db = new PGlite();
  beforeAll(async () => {
    await db.exec(`
      CREATE TABLE "Workflow" (id text PRIMARY KEY, "tenantId" text, name text, trigger text, actions jsonb, conditions jsonb, "isActive" boolean, status text, "updatedAt" timestamptz);
      CREATE TABLE "Stage" (id text, "tenantId" text, name text, "isWon" boolean, "isLost" boolean);
      CREATE TABLE "Tenant" (id text PRIMARY KEY);
      CREATE TABLE "TenantPreference" ("tenantId" text, module text, key text, value jsonb);
      CREATE TABLE "ProductInterest" (id text, "tenantId" text, name text, "dealValue" numeric, active boolean, "createdAt" timestamptz, "updatedAt" timestamptz);
      CREATE FUNCTION workflow_name_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(btrim(value)); $$;
      INSERT INTO "Tenant" VALUES ('tenant'), ('disabled'), ('existing');
      INSERT INTO "TenantPreference" VALUES ('disabled','product-interests','enabled','false');
      INSERT INTO "ProductInterest" (id,"tenantId",name,"dealValue",active) VALUES ('original','existing','Others',55,true);
      INSERT INTO "Stage" VALUES ('q','tenant','Qualified',false,false);
    `);
    const guards = [
      { field: 'deal.hasEverBeenWon', operator: 'equals', value: false },
      { field: 'deal.wonHistoryVerified', operator: 'equals', value: true },
    ];
    for (const [id, name, actions, conditions] of [
      ['retired', 'Old campaign', [{ type: 'send_campaign', config: { campaignId: 'preserve' } }], null],
      ['disabled', 'Disabled legacy', [{ type: 'create_notification', enabled: false, config: { title: 'Preserve' } }, { type: 'create_task', config: { title: 'Valid' } }], null],
      ['qualified-unsafe', 'Qualified Deal Follow-up', [], { operator: 'AND', conditions: guards }],
      ['qualified-safe', 'Qualified Deal Follow-up', [{ type: 'create_task', config: { title: 'Call' } }], { operator: 'AND', conditions: [...guards, { field: 'event.newStageId', operator: 'equals', value: 'q' }] }],
    ]) await db.query('INSERT INTO "Workflow" VALUES ($1, $2, $3, $4, $5, $6, true, $7, now())', [id, 'tenant', name, 'deal.stage_changed', JSON.stringify(actions), JSON.stringify(conditions), 'ACTIVE']);
    await db.exec(await readFile(path.resolve(__dirname, '../../..', 'prisma/migrations/20261024000000_workflow_action_retirement/migration.sql'), 'utf8'));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  it('pauses enabled retired steps without deleting their configuration', async () => {
    const rows = (await db.query<any>('SELECT * FROM "Workflow" WHERE id IN ($1, $2) ORDER BY id', ['retired', 'disabled'])).rows;
    expect(rows[0].isActive).toBe(true);
    expect(rows[1]).toMatchObject({ isActive: false, status: 'PAUSED', actions: [{ type: 'send_campaign', config: { campaignId: 'preserve' } }] });
  });
  it('requires both eligibility guards and an actual Qualified destination', async () => {
    const rows = (await db.query<any>('SELECT id, "isActive" FROM "Workflow" WHERE id LIKE $1 ORDER BY id', ['qualified-%'])).rows;
    expect(rows).toEqual([{ id: 'qualified-safe', isActive: true }, { id: 'qualified-unsafe', isActive: false }]);
  });
  it('adds Others without overwriting existing choices or re-enabling a disabled catalog', async () => {
    const rows = (await db.query<any>('SELECT "tenantId", name, "dealValue" FROM "ProductInterest" ORDER BY "tenantId"')).rows;
    expect(rows.map(row => ({ ...row, dealValue: Number(row.dealValue) }))).toEqual([
      { tenantId: 'existing', name: 'Others', dealValue: 55 }, { tenantId: 'tenant', name: 'Others', dealValue: 0 },
    ]);
  });
});
