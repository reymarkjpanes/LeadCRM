'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Layers, Users, Clock, Paperclip, DollarSign, Calendar, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { useRecordDetail } from '@/shared/hooks/use-record-detail';
import { useData } from '@/store/DataContext';
import { RecordDetailLayout } from '@/shared/components/crm/record-detail-layout';
import { RecordOverviewTab } from '@/shared/components/crm/record-overview-tab';
import { RecordRelatedTab } from '@/shared/components/crm/record-related-tab';
import { RecordTimelineTab } from '@/shared/components/crm/record-timeline-tab';
import { RecordFilesTab } from '@/shared/components/crm/record-files-tab';
import { PipelineProgressBar } from '@/shared/components/crm/pipeline-progress-bar';
import { RecordMetricsStrip } from '@/shared/components/crm/record-metrics-strip';
import type { MetricItem } from '@/shared/components/crm/record-metrics-strip';
import { QuickActionBar } from '@/shared/components/crm/quick-action-bar';
import { dealDetailConfig } from '../config/record-detail.config';
import { DealFormSheet } from './deal-form';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import type { ActionConfig } from '@/shared/components/crm/record-detail-layout';

// ─── Local Types ──────────────────────────────────────────────────────────────

interface ConfirmDialogState {
  title: string;
  description: string;
  warning: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

export default function DealDetailPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const recordId = params?.id as string | undefined;

  const { record, relationships, activities, isLoading, isNotFound, refetch } = useRecordDetail({
    module: 'deals',
    id: recordId,
  });

  const { updateDeal, deleteDeal, moveDealStage, pipelines } = useData();

  // ── Edit drawer state ───────────────────────────────────────────────────
  const [isEditOpen, setIsEditOpen] = useState(false);

  // ── Confirm dialog state (handles both archive + delete actions) ─────────
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  // ── Field save handler ──────────────────────────────────────────────────
  const handleFieldSave = useCallback(async (key: string, value: unknown): Promise<void> => {
    if (!recordId) return;
    await updateDeal(recordId, { [key]: value });
  }, [recordId, updateDeal]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const actions: ActionConfig[] = useMemo(() => {
    return dealDetailConfig.actionTemplates.map((tpl) => ({
      ...tpl,
      onClick: () => {
        switch (tpl.id) {
          case 'edit':
            setIsEditOpen(true);
            break;
          case 'duplicate':
            import('@/shared/services/deals-actions.api').then(({ duplicateDeal }) => {
              if (recordId) {
                duplicateDeal(recordId).then(() => toast.success('Deal duplicated')).catch(() => toast.error('Failed to duplicate'));
              }
            });
            break;
          case 'archive':
            if (recordId) {
              setConfirmDialog({
                title: 'Archive Deal',
                description: 'This deal will be moved to the archive and hidden from active views.',
                warning: 'You can restore it later from archived records.',
                confirmLabel: 'Archive',
                onConfirm: async () => {
                  await deleteDeal(recordId);
                  toast.success('Deal archived');
                  router.push('/crm/deals');
                },
              });
            }
            break;
          case 'delete':
            if (recordId) {
              setConfirmDialog({
                title: 'Delete Deal',
                description: 'This deal will be permanently deleted.',
                warning: 'This cannot be undone.',
                confirmLabel: 'Delete',
                onConfirm: async () => {
                  await deleteDeal(recordId);
                  toast.success('Deal deleted');
                  router.push('/crm/deals');
                },
              });
            }
            break;
        }
      },
    }));
  }, [recordId, deleteDeal, router]);

  // ── Derived display data ────────────────────────────────────────────────
  const title = (record?.title as string) ?? 'Loading...';
  const subtitle = (record?.companyName as string) ?? undefined;
  const dealValue = typeof record?.value === 'number' ? record.value : 0;

  // Pipeline + Stage info
  const dealPipelineId = record?.pipelineId as string | undefined;
  const dealStageId = record?.stageId as string | undefined;
  const dealPipeline = pipelines.find((p) => p.id === dealPipelineId) ?? pipelines[0];
  const currentStageObj = dealPipeline?.stages.find((s) => s.id === dealStageId);
  const isWon = currentStageObj?.isWon ?? false;
  const isLost = currentStageObj?.isLost ?? false;

  // Status derived from stage
  const statusLabel = isWon ? 'Won' : isLost ? 'Lost' : 'In Progress';
  const statusVariant = isWon ? 'success' : isLost ? 'danger' : 'info';

  // ── Pipeline progress bar (header extra) ────────────────────────────────
  const progressStages = useMemo(() => {
    return (dealPipeline?.stages ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      isWon: s.isWon,
      isLost: s.isLost,
      order: s.order,
    }));
  }, [dealPipeline]);

  const handleStageClick = useCallback(async (stageId: string): Promise<void> => {
    if (!recordId) return;
    try {
      await moveDealStage(recordId, stageId);
      const stageName = dealPipeline?.stages.find((s) => s.id === stageId)?.name ?? 'new stage';
      toast.success(`Stage moved to ${stageName}`);
    } catch {
      toast.error('Failed to change stage');
    }
  }, [recordId, moveDealStage, dealPipeline]);

  // ── Key Metrics Strip ───────────────────────────────────────────────────
  const dealMetrics: MetricItem[] = useMemo(() => {
    if (!record) return [];

    const metrics: MetricItem[] = [];

    // 1. Deal Value
    const value = typeof record.value === 'number' ? record.value : 0;
    metrics.push({
      icon: DollarSign,
      label: 'Deal Value',
      value: value > 0 ? `₱${value.toLocaleString()}` : '—',
    });

    // 2. Days in Stage
    const lastStageChange = record.lastStageChangeDate as string | undefined;
    const stageStartDate = lastStageChange ? new Date(lastStageChange) : (record.createdAt ? new Date(record.createdAt as string) : null);
    let daysInStage = 0;
    if (stageStartDate) {
      daysInStage = Math.floor((Date.now() - stageStartDate.getTime()) / 86400000);
    }
    metrics.push({
      icon: Clock,
      label: 'Days in Stage',
      value: `${daysInStage}d`,
      variant: daysInStage > 30 ? 'danger' : daysInStage > 14 ? 'warning' : 'default',
      tooltip: daysInStage > 14 ? 'This deal may need attention' : undefined,
    });

    // 3. Deal Age
    const createdAt = record.createdAt as string | undefined;
    let dealAge = 0;
    if (createdAt) {
      dealAge = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
    }
    metrics.push({
      icon: Calendar,
      label: 'Deal Age',
      value: `${dealAge}d`,
    });

    // 4. Next Step (from tasks in relationships)
    const tasks = (relationships?.tasks as Array<{ title?: string; status?: string; dueDate?: string }>) ?? [];
    const openTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'done');
    if (openTasks.length > 0) {
      const nextTask = openTasks[0];
      const dueDateStr = nextTask.dueDate ? new Date(nextTask.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      metrics.push({
        icon: CheckCircle2,
        label: 'Next Step',
        value: dueDateStr ? `Due ${dueDateStr}` : (nextTask.title ?? 'Task pending').slice(0, 20),
        tooltip: nextTask.title,
      });
    } else {
      metrics.push({
        icon: CheckCircle2,
        label: 'Next Step',
        value: 'No tasks',
        variant: 'warning',
        tooltip: 'Consider adding a follow-up task',
      });
    }

    return metrics;
  }, [record, relationships]);

  const headerExtra = dealPipeline && dealStageId ? (
    <div className="space-y-3">
      <PipelineProgressBar
        stages={progressStages}
        currentStageId={dealStageId}
        isWon={isWon}
        isLost={isLost}
        onStageClick={handleStageClick}
        canChangeStage={true}
      />
      <RecordMetricsStrip metrics={dealMetrics} />
    </div>
  ) : null;

  // ── Avatar ──────────────────────────────────────────────────────────────
  const avatar = (
    <div className="h-11 w-11 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center text-sm font-bold shrink-0">
      ₱
    </div>
  );

  // ── Field sections ──────────────────────────────────────────────────────
  const fieldSections = useMemo(() => {
    if (!record) return [];
    return dealDetailConfig.buildFieldSections(record, handleFieldSave);
  }, [record, handleFieldSave]);

  // ── Related sections ────────────────────────────────────────────────────
  const relatedSections = useMemo(() => {
    return dealDetailConfig.buildRelatedSections(relationships as Record<string, unknown> | null);
  }, [relationships]);

  // ── Tabs ────────────────────────────────────────────────────────────────
  const tabs = useMemo(() => [
    {
      id: 'overview',
      label: 'Overview',
      icon: Layers,
      content: (
        <RecordOverviewTab
          sections={fieldSections}
          editPermission={dealDetailConfig.editPermission}
          customFields={(record?.customFields as Record<string, string>) ?? undefined}
          onCustomFieldSave={async (fields) => {
            if (recordId) await updateDeal(recordId, { customFields: fields });
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
          module="deals"
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
          deletePermission={dealDetailConfig.deletePermission}
        />
      ),
    },
  ], [fieldSections, relatedSections, activities, recordId, record, updateDeal, refetch]);

  return (
    <>
    <RecordDetailLayout
      module="deals"
      title={`${title}${dealValue > 0 ? ` — ₱${dealValue.toLocaleString()}` : ''}`}
      subtitle={subtitle}
      avatar={avatar}
      status={{ label: statusLabel, variant: statusVariant as 'success' | 'danger' | 'info' }}
      breadcrumbs={[
        { label: 'CRM', href: '/crm/deals' },
        { label: 'Deals', href: '/crm/deals' },
        { label: title },
      ]}
      actions={actions}
      tabs={tabs}
      headerExtra={headerExtra}
      actionBar={
        recordId ? (
          <QuickActionBar module="deals" recordId={recordId} onActivityCreated={refetch} />
        ) : undefined
      }
      isLoading={isLoading}
      isNotFound={isNotFound}
      defaultTab="overview"
    />

    {/* Edit Deal Drawer */}
    <DealFormSheet
      isOpen={isEditOpen}
      onClose={() => setIsEditOpen(false)}
      mode="edit"
      initialData={record as Partial<import('@/store/types').Deal> | undefined}
      onSubmit={async (data) => {
        if (!recordId) return;
        await updateDeal(recordId, data);
        refetch();
        setIsEditOpen(false);
        toast.success('Deal updated');
      }}
    />

    {/* Confirm dialog — handles archive + delete actions */}
    {confirmDialog && (
      <ConfirmActionDialog
        open={true}
        onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}
        title={confirmDialog.title}
        description={confirmDialog.description}
        warning={confirmDialog.warning}
        confirmLabel={confirmDialog.confirmLabel}
        variant="destructive"
        onConfirm={async () => {
          await confirmDialog.onConfirm();
          setConfirmDialog(null);
        }}
      />
    )}
    </>
  );
}
