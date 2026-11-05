import type { Prisma } from '@prisma/client';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Prove this entry into Qualified from saved execution evidence, not today's Workflow. */
export async function isWorkflowQualified(tx: Prisma.TransactionClient, tenantId: string,
  deal: { id: string; stageId: string; currentStageHistoryId: string | null }) {
  if (!deal.currentStageHistoryId) return false;
  const entry = await tx.dealStageHistory.findFirst({ where: {
    tenantId, id: deal.currentStageHistoryId, dealId: deal.id, newStageId: deal.stageId,
  } });
  if (!entry || entry.previousStageId === entry.newStageId) return false;
  const steps = await tx.workflowExecutionStep.findMany({ where: {
    tenantId, actionType: 'move_deal_stage', status: 'success', executedAt: { lte: entry.movedAt },
    AND: [{ output: { path: ['movedDealIds'], array_contains: [deal.id] } }, { output: { path: ['stageId'], equals: deal.stageId } }],
    execution: { tenantId, status: 'completed', startedAt: { lte: entry.movedAt }, completedAt: { gte: entry.movedAt } },
  }, include: { execution: { select: { definitionSnapshot: true, completedAt: true,
    steps: { select: { stepIndex: true, executedAt: true }, orderBy: { stepIndex: 'asc' } },
  } } } });
  for (const step of steps) {
    if (step.stepIndex < 0 || object(step.output)?.unchanged === true) continue;
    const resolved = object(step.resolvedInput);
    const snapshot = object(step.execution.definitionSnapshot);
    const savedActions = snapshot?.actions;
    const actions = [resolved?.action, ...(Array.isArray(savedActions) ? [savedActions[step.stepIndex]] : [])]
      .filter(action => action !== undefined);
    if (!actions.length || actions.some(value => {
      const action = object(value), config = object(action?.config);
      return action?.type !== 'move_deal_stage' || action.enabled === false || config?.stageId !== deal.stageId ||
        !!config.currentStageId && config.currentStageId !== entry.previousStageId;
    })) continue;
    const next = step.execution.steps.find(candidate => candidate.stepIndex > step.stepIndex);
    const end = next?.executedAt ?? step.execution.completedAt!;
    if (next ? entry.movedAt >= end : entry.movedAt > end) continue;
    // Re-entry during a long-running action must not inherit an earlier qualification.
    const arrivals = await tx.dealStageHistory.findMany({ where: {
      tenantId, dealId: deal.id, newStageId: deal.stageId,
      movedAt: { gte: step.executedAt, ...(next ? { lt: end } : { lte: end }) },
    }, select: { id: true, previousStageId: true, newStageId: true } });
    const transitions = arrivals.filter(row => row.previousStageId !== row.newStageId);
    if (transitions.length === 1 && transitions[0].id === entry.id) return true;
  }
  return false;
}
