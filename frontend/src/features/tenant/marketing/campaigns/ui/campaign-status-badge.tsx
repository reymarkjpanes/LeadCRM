import { Badge, type BadgeProps } from '@/shared/components/ui/badge';

const statuses: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  SENDING: { label: 'Sending', variant: 'secondary' },
  SUBMITTED: { label: 'Submitted', variant: 'secondary' },
  INTERRUPTED: { label: 'Interrupted', variant: 'warning' },
  SCHEDULED: { label: 'Scheduled', variant: 'info' },
  DRAFT: { label: 'Draft', variant: 'secondary' },
  SENT: { label: 'Sent', variant: 'info' },
  PARTIALLY_SENT: { label: 'Partially Sent', variant: 'warning' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

export function formatCampaignStatus(status: string, reviewRequired = false) {
  if (reviewRequired) return ['DELIVERED', 'FAILED'].includes(status.toUpperCase()) ? `${statuses[status.toUpperCase()].label} · Review` : 'Needs review';
  return statuses[status.toUpperCase()]?.label ?? 'â€”';
}

export function CampaignStatusBadge({ status, reviewRequired = false }: { status: string; reviewRequired?: boolean }) {
  if (reviewRequired) return <Badge variant="warning">{formatCampaignStatus(status, true)}</Badge>;
  if (!status || !statuses[status.toUpperCase()]) return <span title="No confirmed delivery outcome">â€”</span>;
  return <Badge variant={statuses[status.toUpperCase()].variant}>{formatCampaignStatus(status)}</Badge>;
}
