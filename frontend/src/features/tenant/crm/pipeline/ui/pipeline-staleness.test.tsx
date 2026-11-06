import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Deal, Pipeline } from '@/store/types';
import { toFrontendDeal } from '@/lib/api/adapters/deal.adapter';
import { PipelineDealCard } from './pipeline-deal-card';
import { PipelineKanbanBoard } from './pipeline-kanban-board';
vi.mock('@/features/tenant/notifications/hooks/use-record-notifications', () => ({ UnreadRecordDot: () => null }));

vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true }) }));
vi.mock('@/shared/components/crm/deal-card-menu', () => ({ DealCardMenu: () => null }));
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const pipeline = { id: 'sales', name: 'Sales', stages: [{ id: 'qualified', name: 'Qualified', order: 0, rottenAfterDays: 14 }] } as Pipeline;
const raw = { id: 'deal', title: 'Opportunity', pipelineId: 'sales', stageId: 'qualified', priority: 'HIGH',
  createdAt: '2000-01-01T00:00:00Z', updatedAt: '2099-01-01T00:00:00Z',
  staleness: { stageId: 'qualified', stageName: 'Qualified', thresholdDays: 14, daysInStage: 15, isStale: true } };

function cards(deal: Deal) {
  return <><PipelineDealCard deal={deal} canDrag={false} onClick={vi.fn()} />
    <PipelineKanbanBoard pipeline={pipeline} deals={[deal]} users={[]} canEdit={false} canDelete={false}
      onDealClick={vi.fn()} onDealDragEnd={vi.fn()} onAddDeal={vi.fn()} onLoadMore={vi.fn()}
      loadingStages={new Set()} hasMoreByStage={{}} /></>;
}

it('preserves the server result through the adapter and uses it for card badges, borders and tooltips', () => {
  const deal = toFrontendDeal(raw) as Deal;
  expect(deal.staleness).toEqual(raw.staleness);
  render(cards(deal));
  expect(screen.getAllByTitle('Stale deal: 15 days in Qualified (threshold: 14 days)')).toHaveLength(2);
  expect(document.querySelector('[data-deal-id="deal"]')?.className).toContain('border-red-300');
});

it('shows days inactive when the Deal has spent longer in the current stage', () => {
  render(cards(toFrontendDeal({ ...raw, staleness: { ...raw.staleness, daysInStage: 21, daysInactive: 14 } }) as Deal));
  expect(screen.getAllByTitle('Stale deal: 14 days inactive in Qualified (threshold: 14 days)')).toHaveLength(2);
  expect(screen.getAllByText('14d')).toHaveLength(2);
});

it.each([7, 14, 23])('uses the server verdict at a configured %i day boundary regardless of browser time', threshold => {
  const deal = toFrontendDeal({ ...raw, staleness: { ...raw.staleness, thresholdDays: threshold, daysInStage: threshold, isStale: true } }) as Deal;
  const view = render(cards(deal));
  expect(screen.getAllByTitle(`Stale deal: ${threshold} days in Qualified (threshold: ${threshold} days)`)).toHaveLength(2);
  view.rerender(cards({ ...deal, staleness: { ...deal.staleness!, daysInStage: threshold - 1, isStale: false } }));
  expect(screen.queryByTitle(/^Stale deal:/)).toBeNull();
  expect(document.querySelector('[data-deal-id="deal"]')?.className).not.toContain('border-red-300');
});

it('does not invent aging when the server disables it or when a drag preview changes the stage', () => {
  const deal = toFrontendDeal(raw) as Deal;
  for (const row of [
    { ...deal, staleness: undefined }, { ...deal, isArchived: true },
    { ...deal, staleness: { ...deal.staleness!, thresholdDays: null, isStale: false } },
    { ...deal, staleness: { ...deal.staleness!, stageId: 'previous-stage' } },
  ]) {
    const view = render(cards(row));
    expect(screen.queryByTitle(/^Stale deal:/)).toBeNull();
    view.unmount();
  }
});
