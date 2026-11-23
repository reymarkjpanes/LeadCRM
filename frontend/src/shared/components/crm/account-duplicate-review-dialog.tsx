'use client';

import { ACCOUNT_DUPLICATE_REVIEW_MESSAGE, type AccountDuplicateMatch, type AccountDuplicateReview } from '@leadcrm/shared';
import { Button } from '@/shared/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';

export function AccountDuplicateReviewDialog({ review, busy, operation = 'create', onBack, onCreateAnyway, onUseExisting }: {
  review: AccountDuplicateReview | null;
  busy: boolean;
  operation?: 'create' | 'rename';
  onBack: () => void;
  onCreateAnyway?: (token: string) => void;
  onUseExisting?: (account: AccountDuplicateMatch) => void;
}) {
  if (!review) return null;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onBack(); }}>
    <DialogContent showClose={false} className="max-w-lg gap-4">
      <DialogHeader>
        <DialogTitle>{ACCOUNT_DUPLICATE_REVIEW_MESSAGE}</DialogTitle>
        <DialogDescription>{operation === 'rename' ? 'Confirm the proposed name belongs to a distinct Account.' : 'Review the matches before creating a separate Account.'}</DialogDescription>
      </DialogHeader>
      <ul className="max-h-60 space-y-2 overflow-y-auto">
        {review.matches.map(account => <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 space-y-1 break-words">
            <p className="text-sm font-medium">{account.name}</p>
            {account.website && <p className="text-xs text-muted-foreground">{account.website}</p>}
            {account.address && <p className="text-xs text-muted-foreground">{account.address}</p>}
          </div>
          {onUseExisting
            ? <Button type="button" size="sm" disabled={busy} onClick={() => onUseExisting(account)}>Use existing Account</Button>
            : <a href={`/crm/accounts/${encodeURIComponent(account.id)}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline-offset-4 hover:underline">View existing Account</a>}
        </li>)}
      </ul>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>{operation === 'rename' ? 'Back to edit' : 'Back to form'}</Button>
        {onCreateAnyway && <Button type="button" variant="outline" disabled={busy} onClick={() => onCreateAnyway(review.token)}>
          {operation === 'rename' ? 'Save rename anyway' : 'Create anyway'}
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
