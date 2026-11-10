import type { Prisma } from '@prisma/client';

/** Preserve a provider's known outcome; only pending delivery evidence becomes uncertain. */
export async function interruptWorkflowEvidence(tx: Prisma.TransactionClient, run: { id: string; tenantId: string }) {
  const steps = await tx.workflowExecutionStep.findMany({ where: { tenantId: run.tenantId, executionId: run.id,
    OR: [{ status: 'running' }, { status: 'failed', actionType: { in: ['send_email', 'send_sms'] } }] },
    select: { id: true, actionType: true, status: true, resolvedInput: true } });
  for (const step of steps) {
    const providerAction = ['send_email', 'send_sms'].includes(step.actionType);
    if (step.status === 'running') await tx.workflowExecutionStep.updateMany({ where: { id: step.id, tenantId: run.tenantId, executionId: run.id, status: 'running' }, data: {
      status: 'failed', error: 'Action outcome requires review after dispatch interruption. Automatic replay is disabled.',
      ...(providerAction ? { output: { outcomeUnknown: true } } : {}),
    } });
    const input = step.resolvedInput as { deliveryLogId?: string } | null;
    if (step.actionType === 'send_email' && input && typeof input.deliveryLogId === 'string') await tx.emailDeliveryLog.updateMany({
      where: { id: input.deliveryLogId, tenantId: run.tenantId, status: 'pending' }, data: { status: 'uncertain', errorMessage: 'Dispatch was interrupted. Verify Gmail before any replay.' },
    });
  }
}

/** Both crash recovery and dispatch failures commit run/step/delivery evidence together. */
export async function interruptWorkflowRun(tx: Prisma.TransactionClient, run: { id: string; tenantId: string }, condition: Prisma.WorkflowExecutionRunWhereInput,
  now = new Date(), reason = 'Dispatch was interrupted. Review CRM and delivery history; automatic replay is disabled.') {
  const changed = await tx.workflowExecutionRun.updateMany({ where: { AND: [{ id: run.id, tenantId: run.tenantId }, condition] },
    data: { status: 'interrupted', completedAt: now, errorMessage: reason, leaseId: null, leaseUntil: null } });
  if (changed.count) await interruptWorkflowEvidence(tx, run);
  return changed.count > 0;
}
