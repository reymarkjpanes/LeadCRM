'use client';

import React, { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Pencil,
  ExternalLink,
  Copy,
  Zap,
  Mail,
  MessageSquare,
  Archive,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shared/components/ui/dropdown-menu';
import { ConfirmActionDialog } from './confirm-action-dialog';
import { useConfirmDialog } from '@/shared/hooks/use-confirm-dialog';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { duplicateDeal } from '@/shared/services/deals-actions.api';

// ─── Props ───────────────────────────────────────────────────────────────────

interface DealCardMenuProps {
  dealId: string;
  dealTitle: string;
  onEdit?: () => void;
  onDelete?: (dealId: string) => Promise<void>;
  onArchive?: (dealId: string) => Promise<void>;
  onDuplicated?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DealCardMenu({
  dealId,
  dealTitle,
  onEdit,
  onDelete,
  onArchive,
  onDuplicated,
}: DealCardMenuProps): React.ReactElement {
  const router = useRouter();
  const { dialogProps, confirm } = useConfirmDialog();

  const canEdit = useHasPermission('deals.edit');
  const canCreate = useHasPermission('deals.create');
  const canDelete = useHasPermission('deals.archive');

  const handleViewDetails = useCallback((): void => {
    router.push(`/crm/deals/${dealId}`);
  }, [dealId, router]);

  const handleDuplicate = useCallback(async (): Promise<void> => {
    try {
      await duplicateDeal(dealId);
      onDuplicated?.();
    } catch {
      // Error handled by duplicateDeal (shows toast)
    }
  }, [dealId, onDuplicated]);

  const handleArchive = useCallback((): void => {
    confirm({
      title: 'Archive Deal?',
      description: `"${dealTitle}" will be moved to the archive. You can restore it later.`,
      confirmLabel: 'Archive',
      variant: 'destructive',
      onConfirm: async () => {
        if (onArchive) {
          await onArchive(dealId);
        }
      },
    });
  }, [dealId, dealTitle, confirm, onArchive]);

  const handleDelete = useCallback((): void => {
    confirm({
      title: 'Delete Deal?',
      description: `"${dealTitle}" will be permanently deleted.`,
      warning: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
      onConfirm: async () => {
        if (onDelete) {
          await onDelete(dealId);
        }
      },
    });
  }, [dealId, dealTitle, confirm, onDelete]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            aria-label={`Actions for ${dealTitle}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {/* Edit */}
          {canEdit && onEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}

          {/* View Full Details */}
          <DropdownMenuItem onSelect={handleViewDetails}>
            <ExternalLink className="h-4 w-4" />
            View Full Details
          </DropdownMenuItem>

          {/* Duplicate */}
          {canCreate && (
            <DropdownMenuItem onSelect={handleDuplicate}>
              <Copy className="h-4 w-4" />
              Duplicate
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {/* Placeholder actions */}
          {canEdit && (
            <>
              <DropdownMenuItem onSelect={() => toast.info('Workflow picker coming soon')}>
                <Zap className="h-4 w-4" />
                Run Workflow
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toast.info('Email composer coming soon')}>
                <Mail className="h-4 w-4" />
                Send Email
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toast.info('SMS composer coming soon')}>
                <MessageSquare className="h-4 w-4" />
                Send SMS
              </DropdownMenuItem>
            </>
          )}

          {/* Destructive actions */}
          {canDelete && (onArchive || onDelete) && (
            <>
              <DropdownMenuSeparator />
              {onArchive && (
                <DropdownMenuItem onSelect={handleArchive} destructive>
                  <Archive className="h-4 w-4" />
                  Archive
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem onSelect={handleDelete} destructive>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirm Dialog (rendered outside dropdown to prevent portal conflicts) */}
      <ConfirmActionDialog {...dialogProps} />
    </>
  );
}
