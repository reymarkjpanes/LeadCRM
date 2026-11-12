import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkflowAction } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import * as workflows from '../workflows.service';
import * as projection from '../workflow-preview';
import type { WorkflowDealProjection } from '../../actions/action-deal-targets';
import { NotFoundError } from '../../../../shared/errors/http-error';
import { moveDealStage } from '../../../crm/deals/deals.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('ordered Workflow previews on disposable PostgreSQL', () => {
  let tenantId: string, actorId: string, taskOwnerId: string, pipelineId: string, contactedId: string, qualifiedId: string, wonId: string, cancelledId: string, closingId: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const move = (stageId: string): WorkflowAction => ({ type: 'move_deal_stage', config: { stageId } });
  const sample = (extra = {}) => scope(() => prisma.deal.create({ data: {
    tenantId, pipelineId, stageId: contactedId, title: 'Ordered preview', value: 100, assignedUserId: actorId,
    engagementStatus: 'Warm', priority: 'LOW', wonHistoryVerified: true, closingValues: { [closingId]: 'Approved' }, ...extra,
  } }));
  const preview = async (dealId: string, actions: WorkflowAction[]) => scope(async () => {
    const workflow = await workflows.createWorkflow(tenantId, actorId, { name: `Preview ${randomUUID()}`, trigger: 'deal.created', isActive: false, actions });
    return workflows.testWorkflow(workflow.id, tenantId, dealId, actorId);
  });
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow preview', slug: `preview-${randomUUID()}`, status: 'ACTIVE' } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, email: `preview-${randomUUID()}@example.test`, role: 'Client Admin',
      firstName: 'Preview', lastName: 'Admin', emailVerified: new Date(), mustChangePassword: false } })).id;
    const taskRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Preview task staff', permissions: { create: { module: 'tasks', canView: true } } } });
    taskOwnerId = (await prisma.user.create({ data: { tenantId, role: taskRole.name, email: `task-preview-${randomUUID()}@example.test`,
      firstName: 'Task', lastName: 'Agent', userRoles: { create: { roleId: taskRole.id } } } })).id;
    await scope(async () => {
      pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Preview sales' } })).id;
      for (const [order, name] of ['Lead', 'Contacted', 'Qualified', 'Won', 'Cancelled'].entries()) {
        const stage = await prisma.stage.create({ data: { tenantId, pipelineId, name, order, isWon: name === 'Won', isLost: name === 'Cancelled', requiredFields: [] } });
        if (name === 'Contacted') contactedId = stage.id;
        if (name === 'Qualified') qualifiedId = stage.id;
        if (name === 'Won') wonId = stage.id;
        if (name === 'Cancelled') cancelledId = stage.id;
      }
      closingId = randomUUID();
      await prisma.closingFieldDefinition.create({ data: { tenantId, id: closingId, definition: {
        id: closingId, technicalAlias: 'approval-note', module: 'deals', group: 'Closed Won Requirements', name: 'Approval note',
        type: 'Text', active: true, required: true, visibleInForm: true, visibleInDetails: true, options: [], description: '', order: 0, version: 1,
      } } });
    });
  }, 60000);
  afterAll(async () => { await prisma.$disconnect(); });

  it('validates Contacted → Qualified → Won against earlier projected moves without writing CRM evidence', async () => {
    const deal = await sample();
    const before = await scope(() => Promise.all([
      prisma.deal.findFirstOrThrow({ where: { tenantId, id: deal.id } }), prisma.dealStageHistory.count({ where: { tenantId } }),
      prisma.activity.count({ where: { tenantId } }), prisma.task.count({ where: { tenantId } }), prisma.workflowExecutionRun.count({ where: { tenantId } }),
    ]));
    const result = await preview(deal.id, [move(qualifiedId), move(wonId)]);
    expect(result.valid, JSON.stringify(result)).toBe(true);
    expect(result.actions.map(action => action.status)).toEqual(['ready', 'ready']);
    const after = await scope(() => Promise.all([
      prisma.deal.findFirstOrThrow({ where: { tenantId, id: deal.id } }), prisma.dealStageHistory.count({ where: { tenantId } }),
      prisma.activity.count({ where: { tenantId } }), prisma.task.count({ where: { tenantId } }), prisma.workflowExecutionRun.count({ where: { tenantId } }),
    ]));
    expect(after).toEqual(before);
  });

  it('renders later Task variables from the projected stage and qualification priority', async () => {
    const deal = await sample();
    const result = await preview(deal.id, [move(qualifiedId), { type: 'create_task', config: {
      title: 'Review {{stageId}} / {{priority}}', assignedUserId: taskOwnerId,
    } }]);
    expect(result.valid, JSON.stringify(result)).toBe(true);
    expect(result.actions[1].taskPreview?.title).toBe('Review Qualified / HIGH');
    expect((await scope(() => prisma.deal.findFirstOrThrow({ where: { tenantId, id: deal.id } }))).priority).toBe('LOW');
  });

  it('does not let a projected Won move bypass closing requirements', async () => {
    const deal = await sample({ closingValues: {} });
    const result = await preview(deal.id, [move(qualifiedId), move(wonId)]);
    expect(result.valid).toBe(false);
    expect(result.actions[1]).toMatchObject({ status: 'failed', message: expect.stringContaining('Closed Won requirements') });
  });

  it('rejects a projected move after Won using the ordinary transition rule', async () => {
    const deal = await sample();
    const result = await preview(deal.id, [move(qualifiedId), move(wonId), move(contactedId)]);
    expect(result.valid).toBe(false);
    expect(result.actions[2]).toMatchObject({ status: 'failed', message: expect.stringContaining('has been won') });
  });

  it('uses a preceding projected field update for stage requirements', async () => {
    const destination = await scope(() => prisma.stage.create({ data: { tenantId, pipelineId, name: 'Reviewed', order: 4, requiredFields: ['address'] } }));
    const deal = await sample({ address: null });
    const failed = await preview(deal.id, [move(destination.id)]);
    expect(failed.actions[0].status).toBe('failed');
    const valid = await preview(deal.id, [{ type: 'update_field', config: { field: 'address', value: 'Verified address' } }, move(destination.id)]);
    expect(valid.valid, JSON.stringify(valid)).toBe(true);
    expect((await scope(() => prisma.deal.findFirstOrThrow({ where: { tenantId, id: deal.id } }))).address).toBeNull();
  });

  it('resolves legacy person requirements from Deal associations in preview and live stage moves', async () => {
    const [destination, lead, contact] = await scope(() => Promise.all([
      prisma.stage.create({ data: { tenantId, pipelineId, name: 'Participants verified', order: 5, requiredFields: ['leadId', 'contactId'] } }),
      prisma.lead.create({ data: { tenantId, firstName: 'Preview', lastName: 'Lead' } }),
      prisma.contact.create({ data: { tenantId, firstName: 'Preview', lastName: 'Contact' } }),
    ]));
    const deal = await sample();
    const requireParticipants = move(destination.id);
    await expect(scope(() => moveDealStage(deal.id, tenantId, actorId, { stageId: destination.id })))
      .rejects.toThrow('missing required fields — leadId, contactId');
    const projected = await preview(deal.id, [
      { type: 'update_field', config: { field: 'leadIds', value: [lead.id] } },
      { type: 'update_field', config: { field: 'contactIds', value: [contact.id] } },
      requireParticipants,
    ]);
    expect(projected.valid, JSON.stringify(projected)).toBe(true);
    await scope(async () => {
      expect(await prisma.leadDeal.count({ where: { tenantId, dealId: deal.id } })).toBe(0);
      expect(await prisma.contactDeal.count({ where: { tenantId, dealId: deal.id } })).toBe(0);
      await prisma.leadDeal.create({ data: { tenantId, dealId: deal.id, leadId: lead.id } });
      await prisma.contactDeal.create({ data: { tenantId, dealId: deal.id, contactId: contact.id } });
    });
    expect((await preview(deal.id, [requireParticipants])).actions[0].status).toBe('ready');
    const cleared = await preview(deal.id, [
      { type: 'update_field', config: { field: 'contactIds', clear: true } }, requireParticipants,
    ]);
    expect(cleared.actions[1]).toMatchObject({ status: 'failed', message: expect.stringContaining('missing required fields — contactId') });
    await expect(scope(() => moveDealStage(deal.id, tenantId, actorId, { stageId: destination.id })))
      .resolves.toMatchObject({ deal: { stageId: destination.id, leadId: lead.id, contactId: contact.id }, stageHistory: { newStageId: destination.id } });
  });

  it('does not mistake required customer fields for Closed Won evidence', async () => {
    const fieldId = randomUUID();
    await scope(() => prisma.closingFieldDefinition.create({ data: { tenantId, id: fieldId, definition: {
      id: fieldId, technicalAlias: 'customer-only', module: 'leads', group: 'Basic Information', name: 'Customer only', type: 'Text',
      active: true, required: true, visibleInForm: true, visibleInDetails: true, options: [], description: '', order: 1, version: 1,
    } } }));
    const deal = await sample();
    expect((await preview(deal.id, [move(qualifiedId), move(wonId)])).valid).toBe(true);
  });

  it('returns one failed action when a target becomes unavailable during projection', async () => {
    const deal = await sample();
    const unavailable = vi.spyOn(projection, 'projectWorkflowDealMove').mockRejectedValueOnce(new NotFoundError('Stage'));
    try {
      const result = await preview(deal.id, [move(qualifiedId)]);
      expect(result.valid).toBe(false);
      expect(result.actions).toEqual([{ type: 'move_deal_stage', valid: false, status: 'failed', message: 'Stage not found' }]);
      expect((await scope(() => prisma.deal.findFirstOrThrow({ where: { tenantId, id: deal.id } }))).stageId).toBe(contactedId);
    } finally { unavailable.mockRestore(); }
  });

  it('projects configured cancellation evidence and clears it on reopening without writing the Deal', async () => {
    const deal = await sample();
    const state: WorkflowDealProjection = new Map();
    const context: Record<string, unknown> = { 'deal.id': deal.id };
    await scope(async () => {
      await projection.loadWorkflowDealProjection(tenantId, deal.id, state);
      await projection.projectWorkflowDealMove({ type: 'move_deal_stage', config: {
        stageId: cancelledId, includeLossReason: true, lostReason: '  Customer cancelled  ',
      } }, [deal.id], tenantId, 'deal', context, state);
      const closedAt = state.get(deal.id)!.closedAt;
      expect(closedAt).toBeInstanceOf(Date);
      expect(state.get(deal.id)!.lostReason).toBe('Customer cancelled');
      expect(context).toMatchObject({ 'deal.closedAt': closedAt!.toISOString().slice(0, 10), 'deal.lostReason': 'Customer cancelled' });
      await projection.projectWorkflowDealMove(move(qualifiedId), [deal.id], tenantId, 'deal', context, state);
      expect(state.get(deal.id)).toMatchObject({ closedAt: null, lostReason: null });
      expect(context).toMatchObject({ 'deal.closedAt': null, 'deal.lostReason': null });
      expect(await prisma.deal.findFirstOrThrow({ where: { tenantId, id: deal.id } })).toMatchObject({
        stageId: contactedId, closedAt: null, lostReason: null,
      });
    });
  });
});
