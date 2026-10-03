import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { WorkflowDraft } from '@leadcrm/shared';
import { cleanWorkflowName, workflowNameKey, suggestWorkflowCopyName, WORKFLOW_NAME_CONFLICT } from '../workflow-names';

vi.mock('../../../../config/database.config', () => ({ default: {
  workflow: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
} }));
import prisma from '../../../../config/database.config';
import { createWorkflow, updateWorkflow } from '../workflows.repository';

const draft: WorkflowDraft = { name: 'Lead Follow-up', trigger: 'lead.created', actions: [], isActive: false };

describe('workflow names', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.workflow.findMany).mockResolvedValue([]);
    vi.mocked(prisma.workflow.create).mockResolvedValue({ id: 'created' } as never);
    vi.mocked(prisma.workflow.update).mockResolvedValue({ id: 'existing' } as never);
  });

  it('matches case and repeated, surrounding, and Unicode whitespace without changing other characters', () => {
    expect(cleanWorkflowName('  Lead\u00a0 \u2003Follow-up  ')).toBe('Lead Follow-up');
    expect(workflowNameKey('  LEAD   follow-up ')).toBe(workflowNameKey('Lead Follow-up'));
    expect(workflowNameKey(' José — 営業 ')).toBe('josé — 営業');
    expect(workflowNameKey('Lead-Follow-up')).not.toBe(workflowNameKey('Lead Follow-up'));
  });

  it('suggests the next available copy name and respects the name length limit', () => {
    expect(suggestWorkflowCopyName('Lead Follow-up', ['Lead Follow-up', 'lead follow-up (copy)', 'Lead Follow-up (Copy 2)']))
      .toBe('Lead Follow-up (Copy 3)');
    expect(suggestWorkflowCopyName('Lead Follow-up (Copy)', ['Lead Follow-up (Copy)'])).toBe('Lead Follow-up (Copy 2)');
    expect(suggestWorkflowCopyName('A'.repeat(255), [])).toHaveLength(255);
  });

  it('checks all tenant workflow names, including archived names, before creating', async () => {
    vi.mocked(prisma.workflow.findMany).mockResolvedValue([{ name: '  lead   follow-up ' }] as never);
    await expect(createWorkflow('tenant-a', draft)).rejects.toThrow(WORKFLOW_NAME_CONFLICT);
    expect(prisma.workflow.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' }, select: { name: true } });
    expect(prisma.workflow.create).not.toHaveBeenCalled();
  });

  it('preserves capitalization but collapses display whitespace on save', async () => {
    await createWorkflow('tenant-a', { ...draft, name: '  Lead   Follow-up  ' });
    expect(prisma.workflow.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'Lead Follow-up', tenantId: 'tenant-a' }) }));
  });

  it('excludes only the edited workflow and allows its unchanged name', async () => {
    await updateWorkflow('workflow-a', 'tenant-a', { name: draft.name });
    expect(prisma.workflow.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', id: { not: 'workflow-a' } }, select: { name: true } });
    expect(prisma.workflow.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'workflow-a', tenantId: 'tenant-a' } }));
  });

  it('does not block pausing or archiving an existing conflicting legacy workflow', async () => {
    await updateWorkflow('workflow-a', 'tenant-a', { isActive: false, isArchived: true, status: 'PAUSED' });
    expect(prisma.workflow.findMany).not.toHaveBeenCalled();
    expect(prisma.workflow.update).toHaveBeenCalledOnce();
  });

  it.each(['create', 'update'] as const)('translates the atomic %s collision to a clear validation error', async operation => {
    vi.mocked(prisma.workflow[operation]).mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002', clientVersion: '5.22', meta: { target: 'Workflow_tenantId_normalizedName_key' },
    }));
    const result = operation === 'create' ? createWorkflow('tenant-a', draft) : updateWorkflow('workflow-a', 'tenant-a', { name: draft.name });
    await expect(result).rejects.toMatchObject({ name: 'ValidationError', message: WORKFLOW_NAME_CONFLICT });
  });

  it('preserves unrelated storage failures', async () => {
    const failure = new Error('Storage unavailable');
    vi.mocked(prisma.workflow.create).mockRejectedValueOnce(failure);
    await expect(createWorkflow('tenant-a', draft)).rejects.toBe(failure);
  });
});
