import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayCrmMigrations } from '../replay-crm-migrations';
const name = '20261115000000_workflow_assignment_history';
const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations', name, 'migration.sql'), 'utf8');
async function fixture(db: PGlite) {
  await replayCrmMigrations(db, name);
  await db.exec(`
    INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('tenant','History','workflow-history',now()), ('foreign','Foreign','workflow-foreign',now());
    INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('author','foreign','a@camxian.com','A','B','Client Admin',now());
    INSERT INTO "Workflow" (id,"tenantId",name,trigger,actions,"updatedAt") VALUES ('wf','tenant','Legacy workflow','lead.created','[]',now());
    INSERT INTO "WorkflowTriggerRecord" (id,"tenantId","workflowId","triggerType","entityType","entityId") VALUES ('event','tenant','wf','lead.created','lead','record');
    INSERT INTO "WorkflowExecutionRun" (id,"tenantId","workflowId","triggerId","entityType","entityId") VALUES ('run','tenant','wf','event','lead','record');
    INSERT INTO "WorkflowExecutionStep" (id,"tenantId","executionId","stepIndex","actionType",status) VALUES ('step','tenant','run',0,'create_task','success');
  `);
}
describe('workflow history additive migration', () => {
  it('preserves legacy JSON, leaves unknown historical versions null and enforces new integrity', async () => {
    const db = await PGlite.create();
    try {
      await fixture(db); await db.exec(sql);
      expect((await db.query('SELECT version, actions FROM "Workflow"')).rows).toEqual([{ version: 1, actions: [] }]);
      expect((await db.query('SELECT "workflowVersion", "definitionSnapshot" FROM "WorkflowExecutionRun"')).rows).toEqual([{ workflowVersion: null, definitionSnapshot: null }]);
      await expect(db.exec(`INSERT INTO "WorkflowExecutionStep" (id,"tenantId","executionId","stepIndex","actionType",status) VALUES ('duplicate','tenant','run',0,'create_task','success')`)).rejects.toMatchObject({ code: '23505' });
      await expect(db.exec(`UPDATE "Workflow" SET "activatedById"='author' WHERE id='wf'`)).rejects.toMatchObject({ code: '23503' });
    } finally { await db.close(); }
  }, 60000);
  it('blocks duplicates and invalid authors before applying changes without deleting history', async () => {
    const db = await PGlite.create();
    try {
      await fixture(db);
      await db.exec(`INSERT INTO "WorkflowExecutionStep" (id,"tenantId","executionId","stepIndex","actionType",status) VALUES ('duplicate','tenant','run',0,'create_task','success')`);
      await expect(db.exec(sql)).rejects.toThrow('duplicate execution step indexes'); await db.exec('ROLLBACK');
      expect((await db.query(`SELECT count(*)::int AS count FROM "WorkflowExecutionStep"`)).rows).toEqual([{ count: 2 }]);
      await db.exec(`DELETE FROM "WorkflowExecutionStep" WHERE id='duplicate'; UPDATE "Workflow" SET "activatedById"='author' WHERE id='wf';`);
      await expect(db.exec(sql)).rejects.toThrow('activation authors'); await db.exec('ROLLBACK');
      expect((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='Workflow' AND column_name='version'`)).rows).toEqual([]);
    } finally { await db.close(); }
  }, 60000);
});
