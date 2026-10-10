'use client';

import React, { useMemo, useCallback } from 'react';
import { Trophy } from 'lucide-react';
import { DealCard } from '@/shared/components/crm/deal-card';
import { DealCardMenu } from '@/shared/components/crm/deal-card-menu';
import { mapToDealCardData } from '@/shared/components/crm/deal-card.utils';
import type { DealCardData } from '@/shared/components/crm/deal-card.utils';
import type { Deal } from '@/store/types';
import { useData } from '@/store/DataContext';
import { toast } from 'sonner';

// ─── Props ───────────────────────────────────────────────────────────────────

interface DealsGridViewProps {
  deals: Deal[];
  onEdit?: (deal: Deal) => void;
  onDelete?: (dealId: string) => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DealsGridView({ deals, onEdit, onDelete }: DealsGridViewProps): React.ReactElement {
  const { deleteDeal } = useData();

  // Map deals to DealCardData
  const cardDeals: DealCardData[] = useMemo(() => {
    return deals.map((deal) => mapToDealCardData(deal as unknown as Record<string, unknown>));
  }, [deals]);

  const handleEdit = useCallback((dealId: string): void => {
    const deal = deals.find((d) => d.id === dealId);
    if (deal && onEdit) {
      onEdit(deal);
    }
  }, [deals, onEdit]);

  const handleDelete = useCallback(async (dealId: string): Promise<void> => {
    if (onDelete) {
      await onDelete(dealId);
    } else {
      await deleteDeal(dealId);
      toast.success('Deal archived');
    }
  }, [onDelete, deleteDeal]);

  if (cardDeals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <Trophy className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No deals match your current filters.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
      {cardDeals.map((deal) => (
        <DealCard
          key={deal.id}
          deal={deal}
          variant="full"
          showActions
          menuContent={
            <DealCardMenu
              dealId={deal.id}
              dealTitle={deal.title}
              onEdit={() => handleEdit(deal.id)}
              onArchive={handleDelete}
            />
          }
        />
      ))}
    </div>
  );
}
