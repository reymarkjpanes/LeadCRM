'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Layers, Users, Clock, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';

import { useRecordDetail } from '@/shared/hooks/use-record-detail';
import { useData } from '@/store/DataContext';
import { RecordDetailLayout } from '@/shared/components/crm/record-detail-layout';
import { RecordOverviewTab } from '@/shared/components/crm/record-overview-tab';
import { RecordRelatedTab } from '@/shared/components/crm/record-related-tab';
import { RecordTimelineTab } from '@/shared/components/crm/record-timeline-tab';
import { RecordFilesTab } from '@/shared/components/crm/record-files-tab';
import { accountDetailConfig } from '../config/record-detail.config';
import type { ActionConfig } from '@/shared/components/crm/record-detail-layout';

export default function AccountDetailPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const recordId = params?.id as string | undefined;

  const { record, relationships, activities, isLoading, isNotFound, refetch } = useRecordDetail({
    module: 'accounts',
    id: recordId,
  });

  const { updateOrganization, deleteOrganization } = useData();

  // ── Archive confirmation state ───────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Field save handler ──────────────────────────────────────────────────
  const handleFieldSave = useCallback(async (key: string, value: unknown): Promise<void> => {
    if (!recordId) return;
    await updateOrganization(recordId, { [key]: value });
  }, [recordId, updateOrganization]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const actions: ActionConfig[] = useMemo(() => {
    return accountDetailConfig.actionTemplates.map((tpl) => ({
      ...tpl,
      onClick: () => {
        switch (tpl.id) {
          case 'edit':
            toast.info('Edit form coming soon — use the side panel for now');
            break;
          case 'delete':
            if (recordId) setConfirmOpen(true);
            break;
        }
      },
    }));
  }, [recordId, deleteOrganization, router]);

  // ── Derived display data ────────────────────────────────────────────────
  const title = (record?.name as string) ?? 'Loading...';
  const subtitle = (record?.industry as string) ?? undefined;
  const statusValue = (record?.customerType as string) ?? 'Prospect';
  const statusConfig = accountDetailConfig.statuses.find((s) => s.value === statusValue)
    ?? { label: statusValue, variant: 'neutral' as const };

  // ── Avatar ──────────────────────────────────────────────────────────────
  const initials = record ? ((record.name as string)?.[0] ?? 'A').toUpperCase() : 'A';
  const avatar = (
    <div className="h-11 w-11 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center text-sm font-bold shrink-0">
      {initials}
    </div>
  );

  // ── Field sections ──────────────────────────────────────────────────────
  const fieldSections = useMemo(() => {
    if (!record) return [];
    return accountDetailConfig.buildFieldSections(record, handleFieldSave);
  }, [record, handleFieldSave]);

  // ── Related sections ────────────────────────────────────────────────────
  const relatedSections = useMemo(() => {
    const sections = accountDetailConfig.buildRelatedSections(relationships as Record<string, unknown> | null);
    // Inject parentId/parentEntityType for DealCardList rendering
    return sections.map((s) => {
      if (s.entityType === 'deals' && s.renderMode === 'card') {
        return { ...s, parentId: recordId ?? '', parentEntityType: 'account' as const };
      }
      return s;
    });
  }, [relationships, recordId]);

  // ── Tabs ────────────────────────────────────────────────────────────────
  const tabs = useMemo(() => [
    {
      id: 'overview',
      label: 'Overview',
      icon: Layers,
      content: (
        <RecordOverviewTab
          sections={fieldSections}
          editPermission={accountDetailConfig.editPermission}
        />
      ),
    },
    {
      id: 'related',
      label: 'Related',
      icon: Users,
      count: relatedSections.reduce((sum, s) => sum + s.records.length, 0) || undefined,
      content: <RecordRelatedTab sections={relatedSections} />,
    },
    {
      id: 'timeline',
      label: 'Timeline',
      icon: Clock,
      count: activities.length || undefined,
      content: (
        <RecordTimelineTab
          activities={activities}
          module="accounts"
          recordId={recordId ?? ''}
          onActivityCreated={refetch}
        />
      ),
    },
    {
      id: 'files',
      label: 'Files',
      icon: Paperclip,
      content: (
        <RecordFilesTab
          files={[]}
          deletePermission={accountDetailConfig.deletePermission}
        />
      ),
    },
  ], [fieldSections, relatedSections, activities, recordId, refetch]);

  return (
    <>
      <RecordDetailLayout
        module="accounts"
        title={title}
        subtitle={subtitle}
        avatar={avatar}
        status={{ label: statusConfig.label, variant: statusConfig.variant }}
        breadcrumbs={[
          { label: 'CRM', href: '/crm/accounts' },
          { label: 'Accounts', href: '/crm/accounts' },
          { label: title },
        ]}
        actions={actions}
        tabs={tabs}
        isLoading={isLoading}
        isNotFound={isNotFound}
        defaultTab="overview"
      />
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Archive Account"
        description="This account and its associated data will be moved to the archive."
        warning="You can restore it later from archived records."
        confirmLabel="Archive"
        variant="destructive"
        onConfirm={async () => {
          if (!recordId) return;
          await deleteOrganization(recordId);
          toast.success('Account archived');
          router.push('/crm/accounts');
        }}
      />
    </>
  );
}
