import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { salesTransaction } from '../../../crm/leads/lead-automation.service';
import { updateDeal, moveDealStage, moveDealPipeline } from '../../../crm/deals/deals.service';
import { saveField } from '../../../crm/closing-requirements/closing-requirements.service';
import { createDeal } from '../../../crm/deals/deals.repository';
import { bulkStageChange } from '../../../crm/deals/bulk-deals.service';
import { fireDealUpdated } from '../../triggers/triggers.service';
import { dispatchQueuedWorkflows, startWorkflowScheduler } from '../workflow-queue';
import * as workflows from '../workflows.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('post-commit workflow stage dispatch', () => {
  let tenantId: string, actorId: string, pipelineId: string, initialId: string, targetId: string;
  let stop: (() => Promise<void>) | undefined;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const deal = () => scope(() => prisma.deal.create({ data: { tenantId, pipelineId, stageId: initialId, title: randomUUID(), value: 1000, priority: 'LOW', assignedUserId: actorId } }));
  const workflow = (extra = {}) => scope(() => workflows.createWorkflow(tenantId, actorId, {
    name: randomUUID(), trigger: 'deal.updated', isActive: true,
    conditions: { operator: 'AND', conditions: [{ field: 'deal.priority', operator: 'equals', value: 'HIGH' }] },
    actions: [{ type: 'move_deal_stage', config: { stageId: targetId } }], ...extra,
  }));
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Realtime fixture', slug: randomUUID() } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, role: 'Client Admin', firstName: 'Workflow', lastName: 'Admin', email: `${randomUUID()}@camxian.com` } })).id;
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Sales' } })).id;
    initialId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Lead', order: 0 } })).id;
    targetId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Qualified', order: 1 } })).id;
  });
  beforeEach(async () => { await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } }); });
  afterEach(async () => { await stop?.(); stop = undefined; });
  afterAll(async () => { await prisma.$disconnect(); });

  it('cancels on a committed cancellation reason with only the configured stage workflow running', async () => {
    const field = await scope(() => saveField(tenantId, actorId, {
      module: 'deals', group: 'Additional Details', name: 'Reason for Cancellation', type: 'Long Text', required: false, options: [],
    }));
    const cancelled = await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Cancelled', order: 2, isLost: true } });
    const [backlogged, immediate, blank, mixed] = await Promise.all([deal(), deal(), deal(), deal()]);
    const conditions = { operator: 'AND', conditions: [{ field: `deal.customFieldValues.${field.id}`, operator: 'is_not_empty', value: null }] };
    const stageAction = { type: 'move_deal_stage', config: { stageId: cancelled.id } };
    const configured = await workflow({ conditions, actions: [stageAction] });
    const other = await workflow({ conditions, actions: [stageAction] });
    const saveReason = (id: string, value: string) => scope(() => updateDeal(id, tenantId, actorId, { customFieldValues: { [field.id]: value } }));
    const stageOf = async (id: string) => (await prisma.deal.findUniqueOrThrow({ where: { id } })).stageId;
    const runStatus = async (workflowId: string, entityId: string) =>
      (await prisma.workflowExecutionRun.findFirstOrThrow({ where: { workflowId, entityId } })).status;
    await prisma.workflow.update({ where: { id: configured.id }, data: { actions: [
      stageAction, { type: 'create_task', config: { title: 'Other action', assignedUserId: actorId } },
    ] } });
    await saveReason(mixed.id, 'Out of scope');
    await prisma.workflow.update({ where: { id: configured.id }, data: { actions: [stageAction] } });
    await saveReason(backlogged.id, 'Budget');
    expect(await runStatus(configured.id, backlogged.id)).toBe('queued');

    stop = startWorkflowScheduler(configured.id);
    await vi.waitFor(async () => expect(await stageOf(backlogged.id)).toBe(cancelled.id), { timeout: 5000 });
    await saveReason(blank.id, '   ');
    await saveReason(immediate.id, 'Budget');
    await vi.waitFor(async () => expect(await runStatus(configured.id, immediate.id)).toBe('completed'), { timeout: 5000 });
    expect(await stageOf(immediate.id)).toBe(cancelled.id);
    expect(await stageOf(blank.id)).toBe(initialId);
    expect(await stageOf(mixed.id)).toBe(initialId);
    expect(await runStatus(configured.id, mixed.id)).toBe('queued');
    expect(await runStatus(other.id, immediate.id)).toBe('queued');
    // Keep the unrelated durable runs for their intended worker, then clean up the fixture.
    await stop(); stop = undefined;
    await prisma.workflow.updateMany({ where: { id: { in: [configured.id, other.id] } }, data: { isActive: false } });
    await dispatchQueuedWorkflows();
  });

  it('moves a Deal after a field edit promptly, publishes content and deduplicates competing dispatch', async () => {
    const saved = await deal(); const configured = await workflow();
    const before = (await prisma.dashboardRevision.findUniqueOrThrow({ where: { tenantId } })).content;
    stop = startWorkflowScheduler();
    const started = Date.now();
    await scope(() => updateDeal(saved.id, tenantId, actorId, { priority: 'HIGH' }));
    await vi.waitFor(async () => expect((await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } })).stageId).toBe(targetId), { timeout: 5000 });
    expect(Date.now() - started).toBeLessThan(5000);
    // An identical source event and another worker must not replay the transition.
    const updated = await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } });
    await scope(() => fireDealUpdated({ tenantId, actorId, record: updated, eventId: 'duplicate-delivery', changedFields: ['priority'] }));
    await Promise.all([dispatchQueuedWorkflows(), dispatchQueuedWorkflows()]);
    await stop(); stop = undefined;
    expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: saved.id, newStageId: targetId } })).toBe(1);
    expect((await prisma.dashboardRevision.findUniqueOrThrow({ where: { tenantId } })).content).toBeGreaterThan(before);
    expect(await prisma.workflowExecutionRun.count({ where: { workflowId: configured.id, status: 'completed' } })).toBeGreaterThan(0);
  });

  it('never dispatches the source transaction before commit and drops rolled-back work', async () => {
    const saved = await deal(); await workflow(); stop = startWorkflowScheduler();
    const content = (await prisma.dashboardRevision.findUniqueOrThrow({ where: { tenantId } })).content;
    let release!: () => void; let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = scope(() => salesTransaction(async () => {
      await updateDeal(saved.id, tenantId, actorId, { priority: 'HIGH' });
      entered(); await new Promise<void>(resolve => { release = resolve; }); throw new Error('rollback');
    }));
    const rejected = expect(pending).rejects.toThrow('rollback');
    await ready;
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } })).priority).toBe('LOW');
    expect(await prisma.workflowExecutionRun.count({ where: { tenantId, entityId: saved.id } })).toBe(0);
    release(); await rejected; await stop(); stop = undefined;
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } })).stageId).toBe(initialId);
    expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: saved.id, newStageId: targetId } })).toBe(0);
    expect((await prisma.dashboardRevision.findUniqueOrThrow({ where: { tenantId } })).content).toBe(content);
  });

  it('sets High on manual and bulk Qualified entry, preserving same-stage requests and later priority edits', async () => {
    for (const bulk of [false, true]) {
      const saved = await deal();
      if (bulk) expect((await scope(() => bulkStageChange(tenantId, actorId, { dealIds: [saved.id], stageId: targetId }))).succeeded).toBe(1);
      else await scope(() => moveDealStage(saved.id, tenantId, actorId, { stageId: targetId }));
      const moved = await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } });
      expect(moved.priority).toBe('HIGH');
      await scope(() => updateDeal(saved.id, tenantId, actorId, { priority: 'LOW' }));
      await scope(() => moveDealStage(saved.id, tenantId, actorId, { stageId: targetId }));
      expect(await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ priority: 'LOW', stageChangedAt: moved.stageChangedAt });
      expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: saved.id, newStageId: targetId } })).toBe(1);
      await scope(() => moveDealStage(saved.id, tenantId, actorId, { stageId: initialId }));
      await scope(() => moveDealStage(saved.id, tenantId, actorId, { stageId: targetId }));
      expect((await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } })).priority).toBe('HIGH');
    }
  });

  it('sets High for repository creation and pipeline transfer into Qualified, without changing financial snapshots', async () => {
    const product = await prisma.productInterest.create({ data: { tenantId, name: randomUUID(), dealValue: 12000 } });
    const created = await scope(() => salesTransaction(tx => createDeal(tenantId, actorId, { pipelineId, stageId: targetId, title: 'Qualified creation',
      priority: 'LOW', currency: 'PHP', productInterestId: product.id, assignedUserId: actorId }, tx)));
    expect(created).toMatchObject({ priority: 'HIGH', value: 12000 });
    const second = await prisma.pipeline.create({ data: { tenantId, name: 'Other pipeline' } });
    const target = await prisma.stage.create({ data: { tenantId, pipelineId: second.id, name: 'Qualified', order: 0 } });
    const saved = await deal();
    await scope(() => moveDealPipeline(saved.id, tenantId, actorId, { pipelineId: second.id, stageId: target.id }));
    const moved = await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } });
    expect(moved).toMatchObject({ priority: 'HIGH', value: 1000, pipelineId: second.id });
    await scope(() => updateDeal(saved.id, tenantId, actorId, { priority: 'MEDIUM' }));
    await scope(() => moveDealPipeline(saved.id, tenantId, actorId, { pipelineId: second.id, stageId: target.id }));
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ priority: 'MEDIUM', stageChangedAt: moved.stageChangedAt });
  });

  it('wakes for standalone trigger transactions and skips duplicate deliveries', async () => {
    const saved = await deal(); await workflow();
    const changed = await prisma.deal.update({ where: { id: saved.id }, data: { priority: 'HIGH' } });
    stop = startWorkflowScheduler();
    const event = { tenantId, actorId, record: changed, eventId: 'standalone-edit', changedFields: ['priority'] };
    await scope(() => fireDealUpdated(event)); await scope(() => fireDealUpdated(event));
    await vi.waitFor(async () => expect((await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } })).stageId).toBe(targetId), { timeout: 5000 });
    await stop(); stop = undefined;
    expect(await prisma.workflowExecutionRun.count({ where: { tenantId, entityId: saved.id } })).toBe(1);
    expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: saved.id, newStageId: targetId } })).toBe(1);
  });

  it('claims one execution across competing dispatchers and duplicate queued events', async () => {
    const saved = await deal(); await workflow();
    const changed = await prisma.deal.update({ where: { id: saved.id }, data: { priority: 'HIGH' } });
    const event = { tenantId, actorId, record: changed, eventId: 'concurrent-edit', changedFields: ['priority'] };
    await Promise.all([scope(() => fireDealUpdated(event)), scope(() => fireDealUpdated(event))]);
    await Promise.all([dispatchQueuedWorkflows(), dispatchQueuedWorkflows(), dispatchQueuedWorkflows()]);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } })).stageId).toBe(targetId);
    expect(await prisma.workflowExecutionRun.count({ where: { tenantId, entityId: saved.id } })).toBe(1);
    expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: saved.id, newStageId: targetId } })).toBe(1);
  });

  it.each(['unmatched', 'paused', 'invalid-stage', 'unauthorized'] as const)('does not move Deals for %s workflows', async scenario => {
    const saved = await deal(); const configured = await workflow();
    if (scenario === 'paused') await prisma.workflow.update({ where: { id: configured.id }, data: { isActive: false, status: 'PAUSED' } });
    if (scenario === 'invalid-stage') await prisma.stage.update({ where: { id: targetId }, data: { requiredFields: ['address'] } });
    if (scenario === 'unauthorized') {
      const inactive = await prisma.user.create({ data: { tenantId, role: 'Client Admin', status: 'INACTIVE', firstName: 'Inactive', lastName: 'Actor', email: `${randomUUID()}@camxian.com` } });
      await prisma.workflow.update({ where: { id: configured.id }, data: { activatedById: inactive.id } });
    }
    try {
      stop = startWorkflowScheduler();
      await scope(() => updateDeal(saved.id, tenantId, actorId, { priority: scenario === 'unmatched' ? 'MEDIUM' : 'HIGH' }));
      if (scenario !== 'paused') await vi.waitFor(async () => {
        const runs = await prisma.workflowExecutionRun.findMany({ where: { workflowId: configured.id } });
        expect(runs.some(run => !['queued', 'running'].includes(run.status))).toBe(true);
      }, { timeout: 5000 });
      await stop(); stop = undefined;
      expect((await prisma.deal.findUniqueOrThrow({ where: { id: saved.id } })).stageId).toBe(initialId);
      expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: saved.id, newStageId: targetId } })).toBe(0);
    } finally {
      await prisma.stage.update({ where: { id: targetId }, data: { requiredFields: [] } });
    }
  });
});
