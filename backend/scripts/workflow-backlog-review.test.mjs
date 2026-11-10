// Each run owns a fresh loopback cluster and never reads application database URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { notificationTestPostgres } from './notification-test-postgres.mjs';

const source = readFileSync(resolve(import.meta.dirname, 'workflow-backlog-review.sql'), 'utf8');
const psqlValue = value => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

test('Workflow backlog retirement reviews by default and changes only explicitly approved safe queued runs', { timeout: 240000 }, async t => {
  const pg = await notificationTestPostgres();
  let db;
  try {
    const database = `leadcrm_workflow_backlog_${Date.now()}`;
    const url = await pg.database(database);
    db = new PrismaClient({ datasources: { db: { url } } });
    const cutoff = '2026-01-02T00:00:00.000Z';
    const old = new Date('2026-01-01T00:00:00.000Z');
    const fresh = new Date('2026-01-03T00:00:00.000Z');
    const tenant = await db.tenant.create({ data: { name: 'Backlog fixture', slug: randomUUID() } });
    const foreign = await db.tenant.create({ data: { name: 'Foreign backlog fixture', slug: randomUUID() } });
    const user = (tenantId, status = 'ACTIVE') => db.user.create({ data: { tenantId, firstName: 'Operator', lastName: 'Fixture',
      email: `${randomUUID()}@example.test`, role: 'Client Admin', status } });
    const actor = await user(tenant.id), outsider = await user(foreign.id), inactive = await user(tenant.id, 'INACTIVE');
    const workflow = await db.workflow.create({ data: { tenantId: tenant.id, name: 'Backlog review', trigger: 'lead.created', actions: [],
      status: 'ACTIVE', isActive: true, activatedById: actor.id } });
    const foreignWorkflow = await db.workflow.create({ data: { tenantId: foreign.id, name: 'Foreign backlog', trigger: 'lead.created', actions: [] } });
    const createRun = async (label, overrides = {}, step) => {
      const selected = overrides.tenantId === foreign.id ? foreignWorkflow : workflow;
      const trigger = await db.workflowTriggerRecord.create({ data: { tenantId: selected.tenantId, workflowId: selected.id,
        entityId: randomUUID(), entityType: 'lead', triggerType: 'lead.created', eventId: randomUUID(), payload: { recordName: label } } });
      return db.workflowExecutionRun.create({ data: { tenantId: selected.tenantId, workflowId: selected.id, triggerId: trigger.id,
        entityId: trigger.entityId, entityType: 'lead', status: 'queued', startedAt: old, ...overrides,
        ...(step ? { steps: { create: { stepIndex: 0, actionType: 'send_email', ...step } } } : {}) } });
    };
    const safe = [
      await createRun('untouched'),
      await createRun('expired claim', { leaseId: randomUUID(), leaseUntil: old }),
      await createRun('deferred preparation', { leaseUntil: new Date('2099-01-01') }),
      await createRun('skipped step without action evidence', {}, { status: 'skipped' }),
    ];
    const excluded = [
      await createRun('new event', { startedAt: fresh }),
      await createRun('exact cutoff', { startedAt: new Date(cutoff) }),
      await createRun('completed', { status: 'completed', completedAt: old }),
      await createRun('interrupted', { status: 'interrupted', completedAt: old, dispatchStartedAt: old }),
      await createRun('active claim', { leaseId: randomUUID(), leaseUntil: new Date('2099-01-01') }),
      await createRun('claim with unknown expiry', { leaseId: randomUUID() }),
      await createRun('dispatch already started', { dispatchStartedAt: old }),
      await createRun('inconsistent completion', { completedAt: old }),
      await createRun('failed step', {}, { status: 'failed' }),
      await createRun('resolved input', {}, { status: 'skipped', resolvedInput: { deliveryLogId: 'preserve-evidence' } }),
      await createRun('partial output', {}, { status: 'skipped', output: { outcomeUnknown: true } }),
      await createRun('step error', {}, { status: 'skipped', error: 'Uncertain outcome' }),
      await createRun('foreign queued', { tenantId: foreign.id }),
    ];
    const review = parameters => {
      const variables = { tenant_id: tenant.id, cutoff, actor_id: actor.id, expected_count: safe.length, ...parameters };
      return pg.executeSql(database, `${Object.entries(variables).map(([key, value]) => `\\set ${key} ${psqlValue(value)}`).join('\n')}\n${source}`);
    };
    const snapshot = async () => ({
      runs: await db.workflowExecutionRun.findMany({ orderBy: { id: 'asc' } }),
      steps: await db.workflowExecutionStep.findMany({ orderBy: { id: 'asc' } }),
      audits: await db.auditLog.findMany({ orderBy: { id: 'asc' } }),
    });
    await t.test('default review has no durable writes and leaves every run and step unchanged', async () => {
      const before = await snapshot(); const output = review({});
      assert.match(output, /eligible_for_retirement/); assert.match(output, /ROLLBACK/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('apply without explicit stopped-worker confirmation is rejected without writes', async () => {
      const before = await snapshot();
      assert.throws(() => review({ apply: true }), /Command failed/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('a count mismatch rolls back without audit or run changes', async () => {
      const before = await snapshot();
      assert.throws(() => review({ apply: true, workers_stopped: true, expected_count: safe.length + 1 }), /Inventory count changed/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('a foreign actor or inactive actor cannot authorize the audit receipt', async () => {
      const before = await snapshot();
      for (const candidate of [outsider, inactive]) {
        assert.throws(() => review({ apply: true, workers_stopped: true, actor_id: candidate.id }), /active same-tenant operator/);
      }
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('a running execution blocks retirement even when it is not a retirement candidate', async () => {
      const running = await createRun('running', { status: 'running', dispatchStartedAt: old });
      const before = await snapshot();
      assert.throws(() => review({ apply: true, workers_stopped: true }), /Running executions remain/);
      assert.deepEqual(await snapshot(), before);
      // This fixture was created by this test; no production or pre-existing row is touched.
      await db.workflowExecutionRun.update({ where: { id: running.id }, data: { status: 'interrupted', completedAt: new Date() } });
      excluded.push(await db.workflowExecutionRun.findUniqueOrThrow({ where: { id: running.id } }));
    });
    await t.test('unknown tenants and future cutoffs fail before any durable write', async () => {
      const before = await snapshot();
      assert.throws(() => review({ tenant_id: randomUUID() }), /explicitly selected tenant does not exist/);
      assert.throws(() => review({ cutoff: '2099-01-01T00:00:00Z' }), /cutoff cannot be in the future/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('an audit receipt failure rolls back the retirement updates', async () => {
      pg.executeSql(database, `CREATE FUNCTION public.workflow_backlog_fixture_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action = 'workflow.backlog_retired' THEN RAISE EXCEPTION 'Fixture rejected the retirement audit'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER workflow_backlog_fixture_reject_audit BEFORE INSERT ON "AuditLog"
        FOR EACH ROW EXECUTE FUNCTION public.workflow_backlog_fixture_reject_audit();`);
      try {
        const before = await snapshot();
        assert.throws(() => review({ apply: true, workers_stopped: true }), /Fixture rejected the retirement audit/);
        assert.deepEqual(await snapshot(), before);
      } finally {
        pg.executeSql(database, `DROP TRIGGER workflow_backlog_fixture_reject_audit ON "AuditLog";
          DROP FUNCTION public.workflow_backlog_fixture_reject_audit();`);
      }
    });
    await t.test('exact-count approved apply skips only safe old runs and writes one atomic receipt', async () => {
      const before = await snapshot();
      review({ apply: true, workers_stopped: true });
      for (const original of safe) {
        const changed = await db.workflowExecutionRun.findUniqueOrThrow({ where: { id: original.id } });
        assert.equal(changed.status, 'skipped'); assert.ok(changed.completedAt instanceof Date);
        assert.equal(changed.leaseId, null); assert.equal(changed.leaseUntil, null);
        assert.equal(changed.dispatchStartedAt, null);
        assert.match(changed.errorMessage, /without replay/);
        assert.deepEqual({ ...changed, status: original.status, completedAt: original.completedAt, leaseId: original.leaseId,
          leaseUntil: original.leaseUntil, errorMessage: original.errorMessage }, original);
      }
      for (const original of excluded) assert.deepEqual(await db.workflowExecutionRun.findUniqueOrThrow({ where: { id: original.id } }), original);
      assert.deepEqual(await db.workflowExecutionStep.findMany({ orderBy: { id: 'asc' } }), before.steps);
      const receipts = await db.auditLog.findMany({ where: { action: 'workflow.backlog_retired' } });
      assert.equal(receipts.length, 1); assert.equal(receipts[0].tenantId, tenant.id); assert.equal(receipts[0].userId, actor.id);
      assert.equal(receipts[0].metadata.count, safe.length);
      assert.deepEqual([...receipts[0].metadata.runIds].sort(), safe.map(row => row.id).sort());
      assert.equal(await db.auditLog.count({ where: { tenantId: foreign.id } }), 0);
    });
    await t.test('repeating an old approval count fails instead of creating another receipt', async () => {
      const before = await snapshot();
      assert.throws(() => review({ apply: true, workers_stopped: true }), /Inventory count changed/);
      assert.deepEqual(await snapshot(), before);
    });
  } finally { await db?.$disconnect(); pg.stop(); }
});
