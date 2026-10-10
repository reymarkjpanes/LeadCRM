import type { Prisma } from '@prisma/client';
import { ValidationError } from '../../../shared/errors/http-error';

type StageState = { id: string; name: string; isWon: boolean; isLost: boolean };
type DealState = { id: string; stageId: string; hasEverBeenWon?: boolean; wonHistoryVerified?: boolean; wonConfirmedAt?: Date | null; stage: StageState };

export const isQualifiedStage = (stage: Pick<StageState, 'name' | 'isWon' | 'isLost'>) =>
  !stage.isWon && !stage.isLost && stage.name.trim().toLowerCase() === 'qualified';

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
  if (deal.stage.isLost && isQualifiedStage(nextStage) && !hasEverBeenWon && !deal.wonHistoryVerified) {
    throw new ValidationError('This Deal’s earlier sales history needs verification before it can be reopened. Create a new Deal for a new opportunity.');
  }
  if (deal.stage.isLost && (!isQualifiedStage(nextStage) || hasEverBeenWon)) {
    throw new ValidationError(hasEverBeenWon
      ? 'This Deal has previously been won. Create a new Deal for a new opportunity.'
      : 'A lost Deal can only be reopened in Qualified.');
  }
}
