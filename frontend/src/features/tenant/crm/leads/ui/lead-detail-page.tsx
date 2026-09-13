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
import { leadDetailConfig } from '../config/record-detail.config';
import type { ActionConfig } from '@/shared/components/crm/record-detail-layout';

export default function LeadDetailPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const recordId = params?.id as string | undefined;

  const { record, relationships, activities, isLoading, isNotFound, refetch } = useRecordDetail({
    module: 'leads',
    id: recordId,
  });

  const { updateContact: updateLead, deleteContact: deleteLead } = useData();

  // ── Archive confirmation state ───────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Field save handler ──────────────────────────────────────────────────
  const handleFieldSave = useCallback(async (key: string, value: unknown): Promise<void> => {
    if (!recordId) return;
    await updateLead(recordId, { [key]: value });
  }, [recordId, updateLead]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const actions: ActionConfig[] = useMemo(() => {
    return leadDetailConfig.actionTemplates.map((tpl) => ({
      ...tpl,
      onClick: () => {
        switch (tpl.id) {
          case 'edit':
            // Navigate back to list with edit state (or open form modal — future enhancement)
            toast.info('Edit form coming soon — use the side panel for now');
            break;
          case 'convert':
            toast.info('Convert to Contact functionality coming soon');
            break;
          case 'delete':
            if (recordId) setConfirmOpen(true);
            break;
        }
      },
    }));
  }, [recordId, deleteLead, router]);

  // ── Derived display data ────────────────────────────────────────────────
  const title = record
    ? `${record.firstName ?? ''} ${record.lastName ?? ''}`.trim() || 'Unnamed Lead'
    : 'Loading...';
  const subtitle = (record?.companyName as string) ?? undefined;
  const statusValue = (record?.status as string) ?? 'Warm';
  const statusConfig = leadDetailConfig.statuses.find((s) => s.value === statusValue)
    ?? { label: statusValue, variant: 'neutral' as const };

  // ── Avatar ──────────────────────────────────────────────────────────────
  const initials = record
    ? `${(record.firstName as string)?.[0] ?? ''}${(record.lastName as string)?.[0] ?? ''}`.toUpperCase() || 'L'
    : 'L';
  const avatar = (
    <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
      {initials}
    </div>
  );

  // ── Field sections for Overview tab ─────────────────────────────────────
  const fieldSections = useMemo(() => {
    if (!record) return [];
    return leadDetailConfig.buildFieldSections(record, handleFieldSave);
  }, [record, handleFieldSave]);

  // ── Related sections ────────────────────────────────────────────────────
  const relatedSections = useMemo(() => {
    const sections = leadDetailConfig.buildRelatedSections(relationships as Record<string, unknown> | null);
    return sections.map((s) => {
      if (s.entityType === 'deals' && s.renderMode === 'card') {
        return { ...s, parentId: recordId ?? '', parentEntityType: 'lead' as const };
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
          editPermission={leadDetailConfig.editPermission}
          customFields={(record?.customFields as Record<string, string>) ?? undefined}
          onCustomFieldSave={async (fields) => {
            if (recordId) await updateLead(recordId, { customFields: fields });
          }}
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
          module="leads"
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
          deletePermission={leadDetailConfig.deletePermission}
        />
      ),
    },
  ], [fieldSections, relatedSections, activities, recordId, record, updateLead, refetch]);

  return (
    <>
      <RecordDetailLayout
        module="leads"
        title={title}
        subtitle={subtitle}
        avatar={avatar}
        status={{ label: statusConfig.label, variant: statusConfig.variant }}
        breadcrumbs={[
          { label: 'CRM', href: '/crm/leads' },
          { label: 'Leads', href: '/crm/leads' },
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
        title="Archive Lead"
        description="This lead will be moved to the archive and hidden from active views."
        warning="You can restore it later from archived records."
        confirmLabel="Archive"
        variant="destructive"
        onConfirm={async () => {
          if (!recordId) return;
          await deleteLead(recordId);
          toast.success('Lead archived');
          router.push('/crm/leads');
        }}
      />
    </>
  );
}
