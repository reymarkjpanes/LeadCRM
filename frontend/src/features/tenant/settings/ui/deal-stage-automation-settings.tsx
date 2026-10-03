'use client';
import { useState } from 'react';
import type { DealStageAutomation } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { Button } from '@/shared/components/ui/button';
import { toast } from 'sonner';
import { CustomFieldCard } from './custom-field-card';

const endpoint = '/administration/deal-stage-automation';
export function DealStageAutomationSettings() {
  const canEdit = useHasPermission('custom_fields.edit');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = useCachedPage<DealStageAutomation>({ module: 'settings', params: { dealStageAutomation: true },
    fetchFn: async signal => (await apiClient.get<{ data: DealStageAutomation }>(endpoint, { signal })).data });
  const enabled = query.data?.enabled ?? false;
  return <>
    <CustomFieldCard title="Deal Stage Automation" description="Controls whether detected customer engagement can automatically progress Deal pipeline stages."
      kind="requirements" status={query.isInitialLoad ? 'Loading' : query.error ? 'Unavailable' : enabled ? 'Enabled' : 'Disabled'} meta="Automatic stage changes"
      onClick={() => setOpen(true)} actions={[{ id: 'configure', label: canEdit ? 'Edit configuration' : 'View configuration', onClick: () => setOpen(true) }]} />
    <SlidingDrawer isOpen={open} onClose={() => setOpen(false)} title="Deal Stage Automation" subtitle="Manage automatic Deal stage changes.">
      <div className="min-w-0 space-y-5 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Controls whether detected customer engagement can automatically progress Deal pipeline stages.</p>
        {query.error ? <div role="alert">Unable to load configuration.<Button onClick={() => void query.refetch()}>Retry</Button></div> :
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm font-medium">Automatic Deal Stage Changes
            <input type="checkbox" role="switch" aria-label="Automatic Deal Stage Changes" className="h-5 w-5 shrink-0 accent-blue-600"
              disabled={!canEdit || busy || query.isInitialLoad} checked={enabled} onChange={async event => {
                const next = event.target.checked;
                setBusy(true);
                try { await apiClient.patch(endpoint, { enabled: next }); await query.refetch(); toast.success('Deal stage automation updated'); }
                catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save configuration.'); }
                finally { setBusy(false); }
              }} />
          </label>}
        <p className="text-xs text-muted-foreground">{enabled ? 'Enabled' : 'Disabled'}: {enabled ? 'Engagement may progress the clearly associated Deal.' : 'Staff control Deal stage changes. Engagement and customer status detection remain active.'} Closed Won still requires completion of Closed Won Requirements.</p>
      </div>
    </SlidingDrawer>
  </>;
}
