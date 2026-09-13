/**
 * Trigger helpers — called by other services when entity state changes.
 *
 * Usage pattern:
 *   import { fireContactCreated } from '../../automation/triggers/triggers.service';
 *   await fireContactCreated({ contact, tenantId });
 *
 * Each function builds the context object and delegates to the engine.
 * Non-blocking — errors are caught and logged, never surface to the caller.
 */

import { fireWorkflowTrigger } from '../workflows/workflow.engine';

export async function fireContactCreated(params: {
  tenantId: string;
  contact: { id: string; status: string; source?: string | null; score: number; assignedUserId?: string | null };
}): Promise<void> {
  await fireWorkflowTrigger({
    triggerType: 'contact.created',
    entityType:  'Contact',
    entityId:    params.contact.id,
    tenantId:    params.tenantId,
    context: {
      'contact.id':             params.contact.id,
      'contact.status':         params.contact.status,
      'contact.source':         params.contact.source,
      'contact.score':          params.contact.score,
      'contact.assignedUserId': params.contact.assignedUserId,
    },
  }).catch((err) => console.error('[Trigger] contact.created failed:', err));
}

export async function fireContactStatusChanged(params: {
  tenantId:   string;
  contact:    { id: string; status: string; score: number; assignedUserId?: string | null };
  prevStatus: string;
}): Promise<void> {
  await fireWorkflowTrigger({
    triggerType: 'contact.status_changed',
    entityType:  'Contact',
    entityId:    params.contact.id,
    tenantId:    params.tenantId,
    context: {
      'contact.id':             params.contact.id,
      'contact.status':         params.contact.status,
      'contact.prevStatus':     params.prevStatus,
      'contact.score':          params.contact.score,
      'contact.assignedUserId': params.contact.assignedUserId,
    },
  }).catch((err) => console.error('[Trigger] contact.status_changed failed:', err));
}

export async function fireDealCreated(params: {
  tenantId: string;
  deal: { id: string; title: string; value?: number | null; pipelineId: string; stageId: string; assignedUserId?: string | null };
}): Promise<void> {
  await fireWorkflowTrigger({
    triggerType: 'deal.created',
    entityType:  'Deal',
    entityId:    params.deal.id,
    tenantId:    params.tenantId,
    context: {
      'deal.id':             params.deal.id,
      'deal.title':          params.deal.title,
      'deal.value':          params.deal.value,
      'deal.pipelineId':     params.deal.pipelineId,
      'deal.stageId':        params.deal.stageId,
      'deal.assignedUserId': params.deal.assignedUserId,
    },
  }).catch((err) => console.error('[Trigger] deal.created failed:', err));
}

export async function fireDealStageChanged(params: {
  tenantId: string;
  deal: { id: string; title: string; value?: number | null; assignedUserId?: string | null };
  newStageId:  string;
  newStageName: string;
  isWon:  boolean;
  isLost: boolean;
  prevStageId?: string;
}): Promise<void> {
  const triggerType = params.isWon  ? 'deal.closed_won'
                    : params.isLost ? 'deal.closed_lost'
                    : 'deal.stage_changed';

  await fireWorkflowTrigger({
    triggerType,
    entityType: 'Deal',
    entityId:   params.deal.id,
    tenantId:   params.tenantId,
    context: {
      'deal.id':             params.deal.id,
      'deal.title':          params.deal.title,
      'deal.value':          params.deal.value,
      'deal.stageId':        params.newStageId,
      'deal.stageName':      params.newStageName,
      'deal.prevStageId':    params.prevStageId,
      'deal.isWon':          params.isWon,
      'deal.isLost':         params.isLost,
      'deal.assignedUserId': params.deal.assignedUserId,
    },
  }).catch((err) => console.error(`[Trigger] ${triggerType} failed:`, err));
}

/**
 * Fired when a new Lead record is created via POST /crm/leads.
 *
 * Distinct from fireContactCreated which operates on the Contact table.
 * Lead and Contact are separate Prisma models — leads are pre-conversion
 * prospects; contacts are post-conversion CRM records.
 *
 * Context keys follow the lead.* namespace to avoid collision with contact.*
 * keys in workflow condition templates.
 */
export async function fireLeadCreated(params: {
  tenantId: string;
  lead: {
    id:             string;
    status:         string;
    source?:        string | null;
    score?:         number | null;
    assignedUserId?: string | null;
    companyName?:   string | null;
  };
}): Promise<void> {
  await fireWorkflowTrigger({
    triggerType: 'lead.created',
    entityType:  'Lead',
    entityId:    params.lead.id,
    tenantId:    params.tenantId,
    context: {
      'lead.id':             params.lead.id,
      'lead.status':         params.lead.status,
      'lead.source':         params.lead.source,
      'lead.score':          params.lead.score ?? 0,
      'lead.assignedUserId': params.lead.assignedUserId,
      'lead.companyName':    params.lead.companyName,
    },
  }).catch((err) => console.error('[Trigger] lead.created failed:', err));
}

/**
 * Fired when a Lead's status field changes via PUT /crm/leads/:id.
 *
 * Allows workflows to react to lead qualification transitions,
 * e.g. New → Hot, Hot → Disqualified.
 */
export async function fireLeadStatusChanged(params: {
  tenantId:   string;
  lead: {
    id:             string;
    status:         string;
    score?:         number | null;
    assignedUserId?: string | null;
  };
  prevStatus: string;
}): Promise<void> {
  await fireWorkflowTrigger({
    triggerType: 'lead.status_changed',
    entityType:  'Lead',
    entityId:    params.lead.id,
    tenantId:    params.tenantId,
    context: {
      'lead.id':             params.lead.id,
      'lead.status':         params.lead.status,
      'lead.prevStatus':     params.prevStatus,
      'lead.score':          params.lead.score ?? 0,
      'lead.assignedUserId': params.lead.assignedUserId,
    },
  }).catch((err) => console.error('[Trigger] lead.status_changed failed:', err));
}
