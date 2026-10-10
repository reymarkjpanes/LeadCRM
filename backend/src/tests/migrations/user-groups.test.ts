import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

it('preserves legacy departments, existing memberships and tenant boundaries before removing the column', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE "User" ("id" text PRIMARY KEY, "tenantId" text, "department" text);
      CREATE TABLE "TenantGroup" ("id" text PRIMARY KEY, "tenantId" text, "name" text, "createdAt" timestamp, "updatedAt" timestamp);
      CREATE TABLE "TenantGroupMember" ("id" text PRIMARY KEY, "groupId" text, "userId" text, "tenantId" text, UNIQUE("groupId", "userId"));
      INSERT INTO "User" VALUES ('a','t1',' Sales '),('b','t1','sales'),('c','t2','Sales'),('d','t1','  '),('e','t1','Support');
      INSERT INTO "TenantGroup" VALUES ('existing','t1','SALES',now(),now()),('extra','t1','Other',now(),now());
      INSERT INTO "TenantGroupMember" VALUES ('membership','extra','a','t1');`);
    await db.exec(readFileSync(resolve(__dirname, '../../../prisma/migrations/20261116000000_user_groups/migration.sql'), 'utf8'));
    const rows = await db.query<{ userId: string; tenantId: string; name: string }>(`SELECT m."userId", m."tenantId", g."name" FROM "TenantGroupMember" m JOIN "TenantGroup" g ON g."id"=m."groupId" ORDER BY m."userId", g."name"`);
    expect(rows.rows).toEqual([
      { userId: 'a', tenantId: 't1', name: 'Other' }, { userId: 'a', tenantId: 't1', name: 'SALES' },
      { userId: 'b', tenantId: 't1', name: 'SALES' }, { userId: 'c', tenantId: 't2', name: 'Sales' },
      { userId: 'e', tenantId: 't1', name: 'Support' },
    ]);
    expect((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='User' AND column_name='department'`)).rows).toEqual([]);
  } finally { await db.close(); }
}, 30000);
