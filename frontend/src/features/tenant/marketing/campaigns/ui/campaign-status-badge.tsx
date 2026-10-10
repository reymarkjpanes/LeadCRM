import { Badge, type BadgeProps } from '@/shared/components/ui/badge';

const statuses: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  SENDING: { label: 'Sending', variant: 'secondary' },
  INTERRUPTED: { label: 'Interrupted', variant: 'warning' },
  DRAFT: { label: 'Draft', variant: 'secondary' },
  SENT: { label: 'Sent', variant: 'info' },
  PARTIALLY_SENT: { label: 'Partially Sent', variant: 'warning' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

export function formatCampaignStatus(status: string) {
  return statuses[status.toUpperCase()]?.label ?? '—';
}

export function CampaignStatusBadge({ status }: { status: string }) {
  if (!status || !statuses[status.toUpperCase()]) return <span title="No confirmed delivery outcome">—</span>;
  return <Badge variant={statuses[status.toUpperCase()].variant}>{formatCampaignStatus(status)}</Badge>;
}
