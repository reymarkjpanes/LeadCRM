import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayCrmMigrations } from '../replay-crm-migrations';
import { workflowNameKey } from '../../modules/automation/workflows/workflow-names';

const name = '20261023000000_workflow_unique_names';
const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations', name, 'migration.sql'), 'utf8');

async function fixtures(db: PGlite) {
  await replayCrmMigrations(db, name);
  await db.exec(`INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES
    ('tenant-a','Name test A','workflow-name-test-a',now()), ('tenant-b','Name test B','workflow-name-test-b',now());`);
}

async function insert(db: PGlite, id: string, title: string, tenant = 'tenant-a', archived = false) {
  return db.query(`INSERT INTO "Workflow" (id,"tenantId",name,trigger,actions,"isArchived","updatedAt")
    VALUES ($1,$2,$3,'lead.created','[]',$4,now())`, [id, tenant, title, archived]);
}

describe('workflow name migration on disposable PostgreSQL', () => {
  it('preserves existing definitions and enforces normalized uniqueness across all states within each tenant', async () => {
    const db = await PGlite.create();
    try {
      await fixtures(db);
      await insert(db, 'existing', '  Lead   Follow-up  ', 'tenant-a', true);
      await db.exec(sql);
      expect((await db.query('SELECT name, "isArchived" FROM "Workflow" WHERE id=$1', ['existing'])).rows)
        .toEqual([{ name: '  Lead   Follow-up  ', isArchived: true }]);
      await expect(insert(db, 'collision', 'lead follow-up')).rejects.toMatchObject({ code: '23505' });
      await insert(db, 'other-tenant', 'lead follow-up', 'tenant-b');
      await insert(db, 'rename', 'Different');
      await expect(db.query('UPDATE "Workflow" SET name=$1 WHERE id=$2', ['LEAD  FOLLOW-UP', 'rename']))
        .rejects.toMatchObject({ code: '23505' });
      await db.query('UPDATE "Workflow" SET name=$1 WHERE id=$2', ['Lead Follow-up', 'existing']);
      expect((await db.query('SELECT count(*)::int AS count FROM "Workflow"')).rows).toEqual([{ count: 3 }]);

      for (const title of ['  Lead\u00a0 \u2003Follow-up  ', 'José — 営業', '\uFEFFhello\u202Fworld\u3000', 'One\t\nTwo']) {
        expect((await db.query<{ key: string }>('SELECT workflow_name_key($1) AS key', [title])).rows[0].key).toBe(workflowNameKey(title));
      }
    } finally { await db.close(); }
  }, 60000);

  it('rejects colliding legacy names with actionable IDs and rolls back without renaming anything', async () => {
    const db = await PGlite.create();
    try {
      await fixtures(db);
      await insert(db, 'original', 'Qualified Follow-up');
      await insert(db, 'archived-copy', ' qualified   FOLLOW-UP ', 'tenant-a', true);
      await expect(db.exec(sql)).rejects.toMatchObject({
        message: 'Duplicate workflow names must be resolved before applying workflow name uniqueness.',
        detail: expect.stringContaining('archived-copy, original'),
      });
      await db.exec('ROLLBACK');
      expect((await db.query('SELECT id, name FROM "Workflow" ORDER BY id')).rows).toEqual([
        { id: 'archived-copy', name: ' qualified   FOLLOW-UP ' }, { id: 'original', name: 'Qualified Follow-up' },
      ]);
      await db.query('UPDATE "Workflow" SET name=$1 WHERE id=$2', ['Archived qualified follow-up', 'archived-copy']);
      await db.exec(sql);
      await expect(insert(db, 'new-collision', 'Qualified Follow-up')).rejects.toMatchObject({ code: '23505' });
    } finally { await db.close(); }
  }, 60000);

  it('admits only one of simultaneous equivalent-name inserts', async () => {
    const db = await PGlite.create();
    try {
      await fixtures(db);
      await db.exec(sql);
      const results = await Promise.allSettled([
        insert(db, 'one', 'New follow-up'), insert(db, 'two', 'NEW  FOLLOW-UP'), insert(db, 'three', ' new follow-up '),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(2);
      expect((await db.query('SELECT count(*)::int AS count FROM "Workflow"')).rows).toEqual([{ count: 1 }]);
    } finally { await db.close(); }
  }, 60000);
});
