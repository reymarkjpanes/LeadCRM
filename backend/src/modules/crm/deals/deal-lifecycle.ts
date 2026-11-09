import type { Prisma } from '@prisma/client';
import { normalizeCrmStatus, type CrmStatus } from '@leadcrm/shared';
import { ValidationError } from '../../../shared/errors/http-error';

type StageState = { id: string; name: string; isWon: boolean; isLost: boolean };
type DealState = { id: string; stageId: string; hasEverBeenWon?: boolean; wonHistoryVerified?: boolean; wonConfirmedAt?: Date | null; stage: StageState };

/** Internal execution policy; never accepted from an HTTP request body. */
export interface DealStageMovePolicy { optionalLossReason?: boolean; automatic?: boolean; deferCustomerStatus?: boolean }

export interface RelatedDealMoveGuard {
  pipelineId: string;
  currentStageId?: string;
  productInterestId?: string;
  related: { entity: 'lead' | 'contact'; id: string };
}

export const isQualifiedStage = (stage: Pick<StageState, 'name' | 'isWon' | 'isLost'>) =>
  !stage.isWon && !stage.isLost && stage.name.trim().toLowerCase() === 'qualified';

/** Persist the stage's canonical status once; views read the saved value. */
export function dealStageStatus(stage: Pick<StageState, 'name' | 'isWon' | 'isLost'>, current: string): CrmStatus {
  if (stage.isWon) return 'Closed Deal';
  if (stage.isLost) return 'Cancelled';
  return ({ lead: 'Inquiry', contacted: 'Warm', qualified: 'Hot' } as const)[stage.name.trim().toLowerCase() as 'lead' | 'contacted' | 'qualified'] ?? normalizeCrmStatus(current);
}

/** Query all history, including imported legacy outcomes outside the recent UI page. */
export async function dealHasEverBeenWon(tx: Prisma.TransactionClient, tenantId: string, deal: DealState) {
  if (deal.hasEverBeenWon || deal.wonConfirmedAt || deal.stage.isWon) return true;
  return !!await tx.dealStageHistory.findFirst({
    where: { tenantId, dealId: deal.id, OR: [{ newStage: { isWon: true } }, { previousStage: { isWon: true } }] },
    select: { id: true },
  });
}

export function assertDealStageTransition(deal: DealState, nextStage: StageState, hasEverBeenWon: boolean) {
  if (deal.stageId === nextStage.id) return;
  if (deal.stage.isWon) throw new ValidationError('This Deal has been won. Create a new Deal for a new opportunity.');
  const reopeningStage = isQualifiedStage(nextStage) || !nextStage.isWon && !nextStage.isLost && nextStage.name.trim().toLowerCase() === 'lead';
  if (deal.stage.isLost && reopeningStage && !hasEverBeenWon && !deal.wonHistoryVerified) {
    throw new ValidationError('This Deal’s earlier sales history needs verification before it can be reopened. Create a new Deal for a new opportunity.');
  }
  if (deal.stage.isLost && (!reopeningStage || hasEverBeenWon)) {
    throw new ValidationError(hasEverBeenWon
      ? 'This Deal has previously been won. Create a new Deal for a new opportunity.'
      : 'A cancelled Deal can only be reopened in Lead or Qualified.');
  }
}
