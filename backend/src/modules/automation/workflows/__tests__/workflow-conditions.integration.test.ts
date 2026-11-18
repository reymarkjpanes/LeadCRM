import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ClosingValues, WorkflowCondition, WorkflowConditionRule, WorkflowDraft, WorkflowEntity } from '@leadcrm/shared';
import { WORKFLOW_MODULES } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { updateContact as updateLead } from '../../../crm/contacts/contacts.service';
import { updateContact } from '../../../crm/contacts-v2/contacts-v2.service';
import { updateCompany } from '../../../crm/companies/companies.service';
import { createDeal, updateDeal } from '../../../crm/deals/deals.service';
import { listFields, saveField } from '../../../crm/closing-requirements/closing-requirements.service';
import { fireWorkflowTrigger } from '../workflow.engine';
import * as workflows from '../workflows.service';
import { flushWorkflowQueue } from './workflow-queue-test-helper';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
if (process.env.LEADCRM_QA_RUN === '1' && !disposable) throw new Error('Workflow conditions require a disposable local workflow database.');

const entities = ['lead', 'contact', 'account', 'deal'] as const;
type RecordPatch = { address?: string; customFieldValues?: ClosingValues; priority?: 'LOW' | 'MEDIUM' | 'HIGH' };
const textField = (entity: WorkflowEntity) => `${entity}.${entity === 'account' ? 'name' : entity === 'deal' ? 'title' : 'firstName'}`;
const optionalTextField = (entity: WorkflowEntity) => `${entity}.${entity === 'account' ? 'website' : entity === 'deal' ? 'lostReason' : 'companyName'}`;

describe.skipIf(!disposable)('Workflow condition semantics through persisted CRM events', { timeout: 30000 }, () => {
  let tenantId: string, actorId: string, ownerId: string, pipelineId: string;
  let initialId: string, contactedId: string, lostId: string, wonId: string, productId: string, referenceContactId: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const runs = (id: string) => scope(() => workflows.getWorkflowExecutions(id, tenantId));
  const create = (entity: WorkflowEntity, conditions: WorkflowCondition, actions?: WorkflowDraft['actions']) => scope(() => workflows.createWorkflow(tenantId, actorId, {
    name: `Condition acceptance ${randomUUID()}`, trigger: `${entity}.updated`, isActive: true, conditions,
    actions: actions ?? [{ type: 'update_field', config: { field: 'address', value: 'Condition action completed' } }],
  }));
  const record = (entity: WorkflowEntity) => scope(async () => {
    if (entity === 'account') return prisma.account.create({ data: { tenantId, name: 'Manila Sales' } });
    if (entity === 'lead') return prisma.lead.create({ data: { tenantId, firstName: 'Manila Sales', lastName: 'Condition', assignedUserId: ownerId } });
    if (entity === 'contact') return prisma.contact.create({ data: { tenantId, firstName: 'Manila Sales', lastName: 'Condition', assignedUserId: ownerId } });
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Deal', lastName: 'Condition', assignedUserId: ownerId } });
    return createDeal(tenantId, actorId, { title: 'Manila Sales', pipelineId, stageId: initialId, productInterestIds: [productId], assignedUserId: ownerId, leadIds: [lead.id] });
  });
  const edit = (entity: WorkflowEntity, id: string, patch: RecordPatch) => scope(async () => {
    if (entity === 'lead') await updateLead(id, tenantId, actorId, patch);
    else if (entity === 'contact') await updateContact(id, tenantId, patch, actorId);
    else if (entity === 'account') await updateCompany(id, tenantId, actorId, patch);
    else await updateDeal(id, tenantId, actorId, patch);
    await flushWorkflowQueue(tenantId);
  });
  const address = (entity: WorkflowEntity, id: string) => scope(async () => {
    if (entity === 'lead') return (await prisma.lead.findUniqueOrThrow({ where: { id } })).address;
    if (entity === 'contact') return (await prisma.contact.findUniqueOrThrow({ where: { id } })).address;
    if (entity === 'account') return (await prisma.account.findUniqueOrThrow({ where: { id } })).address;
    return (await prisma.deal.findUniqueOrThrow({ where: { id } })).address;
  });

  async function verify(entity: WorkflowEntity, id: string, conditions: WorkflowCondition, matched: boolean) {
    const workflow = await create(entity, conditions);
    const before = await Promise.all([
      prisma.workflowExecutionRun.count({ where: { tenantId, workflowId: workflow.id } }),
      prisma.activity.count({ where: { tenantId } }), prisma.auditLog.count({ where: { tenantId } }),
    ]);
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, id, actorId));
    expect(preview.valid, JSON.stringify(preview)).toBe(true);
    expect(preview.conditions.matched).toBe(matched);
    expect(await Promise.all([
      prisma.workflowExecutionRun.count({ where: { tenantId, workflowId: workflow.id } }),
      prisma.activity.count({ where: { tenantId } }), prisma.auditLog.count({ where: { tenantId } }),
    ])).toEqual(before);
    const originalAddress = `CRM edit ${randomUUID()}`;
    await edit(entity, id, { address: originalAddress });
    const history = await runs(workflow.id);
    expect(history).toHaveLength(1);
    expect(history[0].status, JSON.stringify(history[0])).toBe(matched ? 'completed' : 'skipped');
    expect(await address(entity, id)).toBe(matched ? 'Condition action completed' : originalAddress);
    expect(await prisma.activity.count({ where: { tenantId, type: 'workflow', metadata: { path: ['workflowId'], equals: workflow.id } } })).toBe(matched ? 1 : 0);
  }

  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow conditions', slug: randomUUID(), status: 'ACTIVE' } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, role: 'Client Admin', firstName: 'Condition', lastName: 'Admin', email: `${randomUUID()}@example.test` } })).id;
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Condition staff', permissions: { create: ['leads', 'contacts', 'deals', 'tasks'].map(module => ({ module, canView: true, canEdit: true })) } } });
    ownerId = (await prisma.user.create({ data: { tenantId, role: role.name, firstName: 'Condition', lastName: 'Owner', email: `${randomUUID()}@example.test`, userRoles: { create: { roleId: role.id } } } })).id;
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Condition pipeline' } })).id;
    initialId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Lead', order: 0 } })).id;
    contactedId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Contacted', order: 1 } })).id;
    lostId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Cancelled', order: 2, isLost: true } })).id;
    wonId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Won', order: 3, isWon: true } })).id;
    productId = (await prisma.productInterest.create({ data: { tenantId, name: 'Condition product', dealValue: 100 } })).id;
    referenceContactId = (await prisma.contact.create({ data: { tenantId, firstName: 'Reference', lastName: 'Contact', assignedUserId: ownerId } })).id;
    await scope(() => listFields(tenantId));
  }, 60000);
  beforeEach(async () => { await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false, status: 'PAUSED' } }); });
  afterAll(async () => { await prisma.$disconnect(); });

  const textCases: Array<[WorkflowConditionRule['operator'], string]> = [
    ['equals', 'mANILA sALES'], ['not_equals', 'Singapore'], ['contains', 'NILA'],
    ['not_contains', 'SINGAPORE'], ['starts_with', 'MANILA'], ['ends_with', 'SALES'],
  ];
  for (const entity of entities) it.each(textCases)(`${entity} %s uses the same case-insensitive result in preview and execution`, async (operator, value) => {
    const fixture = await record(entity);
    await verify(entity, fixture.id, { operator: 'AND', conditions: [{ field: textField(entity), operator, value }] }, true);
  });

  for (const entity of entities) it.each(['not_equals', 'not_contains'] as const)(`${entity} %s excludes an empty standard text field`, async operator => {
    const fixture = await record(entity);
    await verify(entity, fixture.id, { operator: 'OR', conditions: [{ field: optionalTextField(entity), operator, value: 'Blocked' }] }, false);
  });

  it.each(['lead', 'contact', 'deal'] as const)('%s Does not contain excludes an empty relationship list', async entity => {
    const fixture = await record(entity);
    const field = entity === 'deal' ? 'deal.contactIds' : `${entity}.productInterestIds`;
    await verify(entity, fixture.id, { operator: 'AND', conditions: [{ field, operator: 'not_contains', value: entity === 'deal' ? referenceContactId : productId }] }, false);
  });

  for (const entity of entities) it.each(['AND', 'OR'] as const)(`${entity} %s applies all/any logic to independent conditions`, async operator => {
    const fixture = await record(entity);
    await verify(entity, fixture.id, { operator, conditions: [
      { field: textField(entity), operator: 'equals', value: 'MANILA SALES' },
      { field: textField(entity), operator: 'starts_with', value: 'Singapore' },
    ] }, operator === 'OR');
  });

  it.each(entities)('%s evaluates Text, Number zero, Date and Dropdown custom values through CRM writes', async entity => {
    const fixture = await record(entity);
    const module = WORKFLOW_MODULES[entity];
    const group = entity === 'deal' ? 'Additional Details' : 'Additional Information';
    const definitions = await scope(async () => {
      const fields = [];
      for (const type of ['Text', 'Number', 'Date', 'Dropdown'] as const) fields.push(await saveField(tenantId, actorId, {
        module, group, name: `${type} ${randomUUID()}`, type, required: false, options: type === 'Dropdown' ? ['First', 'Second'] : [],
      }));
      return fields;
    });
    const [text, number, date, choice] = definitions;
    await edit(entity, fixture.id, { customFieldValues: { [text.id]: 'Manila', [number.id]: 0, [date.id]: '2026-10-01', [choice.id]: 'First' } });
    const conditions: WorkflowConditionRule[] = [
      { field: `${entity}.customFieldValues.${text.id}`, operator: 'equals', value: 'MANILA' },
      { field: `${entity}.customFieldValues.${number.id}`, operator: 'equals', value: 0 },
      { field: `${entity}.customFieldValues.${number.id}`, operator: 'greater_than', value: -1 },
      { field: `${entity}.customFieldValues.${number.id}`, operator: 'less_than_or_equal', value: 0 },
      { field: `${entity}.customFieldValues.${date.id}`, operator: 'equals', value: '2026-10-01' },
      { field: `${entity}.customFieldValues.${date.id}`, operator: 'before', value: '2026-10-02' },
      { field: `${entity}.customFieldValues.${date.id}`, operator: 'after', value: '2026-09-30' },
      { field: `${entity}.customFieldValues.${choice.id}`, operator: 'equals', value: 'First' },
    ];
    if (entity === 'deal') conditions.push({ field: 'deal.hasEverBeenWon', operator: 'equals', value: false });
    if (entity !== 'account') conditions.push({ field: `${entity}.assignedUserId`, operator: 'equals', value: ownerId });
    await verify(entity, fixture.id, { operator: 'AND', conditions }, true);
    await expect(create(entity, { operator: 'AND', conditions: [{ field: `${entity}.customFieldValues.${choice.id}`, operator: 'equals', value: 'first' }] })).rejects.toThrow(/supported/);
  });

  it.each(entities)('%s matches a changed custom field by canonical token and rejects an invented field value', async entity => {
    const fixture = await record(entity);
    const field = await scope(() => saveField(tenantId, actorId, { module: WORKFLOW_MODULES[entity], group: entity === 'deal' ? 'Additional Details' : 'Additional Information', name: `Changed ${randomUUID()}`, type: 'Text', required: false }));
    const workflow = await create(entity, { operator: 'AND', conditions: [{ field: 'event.changedFields', operator: 'contains', value: `customFieldValues.${field.id}` }] });
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, fixture.id, actorId));
    expect(preview.conditions.matched).toBe(false); // A record-only check has no field-change event evidence.
    await edit(entity, fixture.id, { customFieldValues: { [field.id]: 'Changed through CRM' } });
    expect((await runs(workflow.id)).map(run => run.status)).toEqual(['completed']);
    expect(await address(entity, fixture.id)).toBe('Condition action completed');
    await expect(create(entity, { operator: 'AND', conditions: [{ field: 'event.changedFields', operator: 'contains', value: 'unknownField' }] })).rejects.toThrow(/supported|available/i);
  });

  it.each(['priority', 'reason'] as const)('moves a Deal from a %s-only condition and creates one linked task across event retries', async source => {
    const fixture = await record('deal');
    // Persisted reason values can exist on imported records independently of stage.
    if (source === 'reason') await prisma.deal.update({ where: { id: fixture.id }, data: { lostReason: 'Customer requested cancellation' } });
    else await edit('deal', fixture.id, { priority: 'HIGH' });
    const taskTitle = `Condition task ${randomUUID()}`;
    const condition: WorkflowConditionRule = source === 'priority'
      ? { field: 'deal.priority', operator: 'equals', value: 'HIGH' }
      : { field: 'deal.lostReason', operator: 'is_not_empty', value: null };
    const target = source === 'priority' ? contactedId : lostId;
    const workflow = await create('deal', { operator: 'AND', conditions: [condition] }, [
      { type: 'move_deal_stage', config: { stageId: target } },
      { type: 'create_task', config: { title: taskTitle, assignedUserId: ownerId } },
    ]);
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, fixture.id, actorId));
    expect(preview.valid, JSON.stringify(preview)).toBe(true);
    expect(preview.conditions).toMatchObject({ matched: true, passed: 1, total: 1 });
    await edit('deal', fixture.id, { address: `Condition event ${randomUUID()}` });
    const history = await runs(workflow.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'completed', steps: [{ status: 'success' }, { status: 'success' }] });
    const trigger = await prisma.workflowTriggerRecord.findUniqueOrThrow({ where: { id: history[0].triggerId } });
    if (!trigger.eventId) throw new Error('The committed update must retain its idempotency key.');
    await scope(() => fireWorkflowTrigger({ tenantId, actorId, eventId: trigger.eventId, triggerType: 'deal.updated', entityType: 'deal', entityId: fixture.id, context: { 'event.changedFields': ['address'] } }));
    expect(await runs(workflow.id)).toHaveLength(1);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: fixture.id } })).stageId).toBe(target);
    expect(await prisma.task.count({ where: { tenantId, title: taskTitle, dealLinks: { some: { dealId: fixture.id } } } })).toBe(1);
    expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: fixture.id, previousStageId: initialId, newStageId: target } })).toBe(1);
  });

  it.each(['pipeline', 'required-fields', 'won-source'] as const)('retains the %s stage guard for a condition without Stage Equals', async guard => {
    const fixture = await record('deal');
    let target = contactedId;
    if (guard === 'pipeline') {
      const other = await prisma.pipeline.create({ data: { tenantId, name: 'Other condition pipeline' } });
      target = (await prisma.stage.create({ data: { tenantId, pipelineId: other.id, name: 'Contacted', order: 0 } })).id;
    } else if (guard === 'required-fields') {
      target = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Needs Account', order: 4, requiredFields: ['accountId'] } })).id;
    } else {
      const history = await prisma.dealStageHistory.create({ data: { tenantId, dealId: fixture.id, previousStageId: initialId, newStageId: wonId, movedById: actorId } });
      await prisma.deal.update({ where: { id: fixture.id }, data: { stageId: wonId, currentStageHistoryId: history.id, hasEverBeenWon: true, wonConfirmedAt: new Date() } });
    }
    const workflow = await create('deal', { operator: 'AND', conditions: [{ field: 'deal.title', operator: 'equals', value: 'MANILA SALES' }] }, [{ type: 'move_deal_stage', config: { stageId: target } }]);
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, fixture.id, actorId));
    expect(preview.valid).toBe(false);
    expect(preview.actions[0].status).toBe('failed');
    await edit('deal', fixture.id, { address: `Guarded update ${randomUUID()}` });
    expect((await runs(workflow.id))[0].status).toBe('failed');
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: fixture.id } })).stageId).toBe(guard === 'won-source' ? wonId : initialId);
  });
});
