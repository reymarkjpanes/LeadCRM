'use client';

import React from 'react';
import { Mail, Phone, MessageSquare, Activity, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shared/components/ui/dropdown-menu';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import type { PermissionKey } from '@leadcrm/shared';

// --- Types ---

interface OverflowMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  permission?: string; // e.g. 'deals.archive' — hide if user lacks this permission
}

interface RecordActionBarProps {
  email?: string | null;
  phone?: string | null;
  onLogActivity?: () => void;
  overflowItems?: OverflowMenuItem[];
}

// --- Permission-Gated Overflow Item ---

function GatedOverflowItem({ item }: { item: OverflowMenuItem }): React.ReactNode {
  const hasPermission = useHasPermission(
    (item.permission ?? 'deals.view') as PermissionKey
  );

  if (item.permission && !hasPermission) return null;

  return (
    <DropdownMenuItem
      destructive={item.destructive}
      onSelect={item.onClick}
    >
      {item.icon && <span className="size-4 shrink-0">{item.icon}</span>}
      {item.label}
    </DropdownMenuItem>
  );
}

// --- Main Component ---

export function RecordActionBar({
  email,
  phone,
  onLogActivity,
  overflowItems,
}: RecordActionBarProps): React.ReactNode {
  const hasEmail = Boolean(email);
  const hasPhone = Boolean(phone);

  const handleEmail = (): void => {
    if (hasEmail) {
      window.location.href = `mailto:${email}`;
    }
  };

  const handleCall = (): void => {
    if (hasPhone) {
      window.location.href = `tel:${phone}`;
    }
  };

  const handleMessage = (): void => {
    toast.info('Messaging is not available yet');
  };

  return (
    <div className="flex items-center gap-1">
      {/* Email */}
      <Button
        variant="ghost"
        size="icon"
        disabled={!hasEmail}
        onClick={handleEmail}
        title={hasEmail ? `Email ${email}` : 'No email available'}
        className={cn(
          'size-8 text-muted-foreground hover:text-foreground',
          'disabled:opacity-40 disabled:cursor-not-allowed'
        )}
      >
        <Mail className="size-4" />
      </Button>

      {/* Call */}
      <Button
        variant="ghost"
        size="icon"
        disabled={!hasPhone}
        onClick={handleCall}
        title={hasPhone ? `Call ${phone}` : 'No phone available'}
        className={cn(
          'size-8 text-muted-foreground hover:text-foreground',
          'disabled:opacity-40 disabled:cursor-not-allowed'
        )}
      >
        <Phone className="size-4" />
      </Button>

      {/* Message (placeholder) */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleMessage}
        title="Send message"
        className="size-8 text-muted-foreground hover:text-foreground"
      >
        <MessageSquare className="size-4" />
      </Button>

      {/* Log Activity */}
      {onLogActivity && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onLogActivity}
          title="Log activity"
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          <Activity className="size-4" />
        </Button>
      )}

      {/* Overflow Menu */}
      {overflowItems && overflowItems.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title="More actions"
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflowItems.map((item) => (
              <GatedOverflowItem key={item.label} item={item} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export type { RecordActionBarProps, OverflowMenuItem };
