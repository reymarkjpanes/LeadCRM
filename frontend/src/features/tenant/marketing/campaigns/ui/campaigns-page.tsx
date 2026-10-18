'use client';
import { campaignEngagementRate } from '@leadcrm/shared';
import { insertVariableAtSelection } from '@/shared/utils/insert-variable';
import { useTablePreferences } from '@/shared/hooks/use-table-preferences';
import { useNotificationRecordLink } from '@/features/tenant/notifications/hooks/use-notification-record-link';
import { PageHeader } from '@/shared/components/ui/page-header';
import { panelBodyClass, panelFooterClass, panelInputClass, panelLabelClass, panelPrimaryActionClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';
import DOMPurify from 'dompurify';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import type { Campaign, Template } from '@/store/types';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCampaignsData } from '../hooks/use-campaigns-data';
import { campaignsApi } from '@/shared/services/campaigns.api';
import { templatesApi } from '@/shared/services/templates.api';
import { CampaignVariablePicker, useCampaignVariableFields, campaignSampleValues } from './campaign-variable-picker';
import { MarketingTemplateSchema, renderEmailVariables, campaignVariableChoices, type CampaignEmailSettings, type CampaignSmsSettings } from '@leadcrm/shared';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { FieldError } from './audience-panel';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import { useAuth } from '@/store/AuthContext';
import { toast } from 'sonner';
import { Archive, Plus, Send, X, Mail, MessageSquare, Megaphone, BarChart2, Eye, MousePointerClick, Edit2, Trash2, Play, Pause, Search, Filter, TrendingUp, TrendingDown, Copy, Calendar, ArrowLeft, SplitSquareHorizontal, ListOrdered, Monitor, Smartphone, Tags, Wand2, LayoutTemplate, Zap, Trophy, MoreVertical, Sparkles, Users, Loader2 } from 'lucide-react';
import EmptyState from '@/shared/components/empty-state';
import { FilterButton } from '@/shared/components/crm/filter-button';
import { ModuleFilterRail } from '@/shared/components/crm/module-filter-rail';
import { SideSheet } from '@/shared/components/side-sheet';
import { Dialog, DialogContent } from '@/shared/components/ui/dialog';
import { CreateActionDropdown } from '@/shared/components/crm/module-workspace';
import { CampaignReportView } from './campaign-report-view';
import { CampaignBuilder } from './campaign-builder';
import { CampaignStatusBadge } from './campaign-status-badge';
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';

import { DataGrid, type DataGridColumnDef, type SortState } from '@/shared/components/data-grid';
import { BulkSelectionBar, executeSelectedRows } from '@/shared/components/crm/bulk-selection-bar';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { ModuleTableToolbar } from '@/shared/components/crm/module-table-toolbar';
import { useModuleTableColumns } from '@/shared/hooks/use-module-table-columns';
import { CAMPAIGNS_TABLE_COLUMNS } from '@leadcrm/shared';
import { ModuleTabs } from '@/shared/components/crm/module-tabs';
import { QuotationTemplates } from './quotation-templates';
import { LeadsPagination } from '@/shared/components/crm/leads-pagination';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';


export default function CampaignsPage() {


  const { sort: savedSort, setSort } = useTablePreferences('campaigns');
  const sort = savedSort ?? { field: 'createdAt', direction: 'desc' as const };
  const [editingCampaign, setEditingCampaign] = useState<Campaign | undefined>();
  const [builderSubject, setBuilderSubject] = useState('');
  const [templateErrors, setTemplateErrors] = useState<Record<string, string>>({});
  const templateLock = useRef(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'all' | 'email' | 'sms' | 'quotation'>('all');
  const [showBuilder, setShowBuilder] = useState(false);
  const [selectedCampaignForReport, setSelectedCampaignForReport] = useState<Campaign | null>(null);
  const [builderInitialType, setBuilderInitialType] = useState<string | undefined>();
  const [builderInitialContent, setBuilderInitialContent] = useState<string | undefined>();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [currentPage, goToPage] = useState(1);
  const [pageSize, updatePageSize] = useState(25);
  const setPageSize = (size: number) => { updatePageSize(size); goToPage(1); };
  // Route-scoped fetch — replaces DataContext Batch 2 startup load
  const {
    total: totalItems,
    campaigns: serverCampaigns,
    templates: serverTemplates,
    isInitialLoad,
    isRefreshing,
    error: campaignsError,
    refetch: refetchCampaigns,
  } = useCampaignsData({
    disabled: showBuilder || !!selectedCampaignForReport,
    intervalMs: activeTab === 'all' ? 7500 : 0,
    query: {
      sort: `${sort.field}:${sort.direction}`, page: currentPage, limit: pageSize, search: searchTerm,
      status: statusFilter.map(value => value.toUpperCase()).join(','),
      type: typeFilter.map(value => value.toUpperCase().replace('-', '_')).join(','),
    }
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState<Campaign | null>(null);
  useEffect(() => { setSelected(new Set()); setArchiving(null); }, [user?.tenantId, currentPage, pageSize, searchTerm, statusFilter, typeFilter, activeTab]);
  useEffect(() => { if (campaignsError) toast.error(campaignsError); }, [campaignsError]);
  const campaigns = serverCampaigns;
  const templates = serverTemplates;
  useEffect(() => { goToPage(1); }, [searchTerm, statusFilter, typeFilter, activeTab]);
  useEffect(() => {
    if (!showBuilder && !selectedCampaignForReport && !isInitialLoad && !campaignsError && currentPage > Math.max(1, Math.ceil(totalItems / pageSize))) goToPage(Math.max(1, Math.ceil(totalItems / pageSize)));
  }, [showBuilder, selectedCampaignForReport, isInitialLoad, campaignsError, currentPage, totalItems, pageSize]);
  const [showFilters, setShowFilters] = useState(false);
  const [filterSearchTerm, setFilterSearchTerm] = useState('');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [newTemplateType, setNewTemplateType] = useState<'Email' | 'SMS'>('Email');
  const [newTemplate, setNewTemplate] = useState({ name: '', subject: '', content: '', category: 'Marketing' });
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const templateCatalog = useCampaignVariableFields(isTemplateModalOpen || !!previewTemplate);
  const templateEmailSettings = useCachedPage<CampaignEmailSettings>({ module: 'settings', params: { campaignSender: 'EMAIL' }, disabled: !(isTemplateModalOpen && newTemplateType === 'Email' || previewTemplate?.type === 'Email'), revalidateOnInvalidation: true, fetchFn: async () => (await campaignsApi.emailSettings()).data });
  const templateSmsSettings = useCachedPage<CampaignSmsSettings>({ module: 'settings', params: { campaignSender: 'SMS' }, disabled: !(isTemplateModalOpen && newTemplateType === 'SMS' || previewTemplate?.type === 'SMS'), revalidateOnInvalidation: true, fetchFn: async () => (await campaignsApi.smsSettings()).data });
  const templateSubjectRef = useRef<HTMLInputElement>(null), templateBodyRef = useRef<HTMLTextAreaElement>(null);
  const templateActiveField = useRef<'subject' | 'content'>('content');
  // Templates have no audience source; retain choices approved for either module.
  const contactTemplateChoices = new Map(campaignVariableChoices(templateCatalog.fields, 'CONTACTS', { forInsertion: true }).map(choice => [choice.id, choice]));
  const templateChoices = campaignVariableChoices(templateCatalog.fields, 'LEADS', { forInsertion: true }).map(choice => {
    const contactChoice = contactTemplateChoices.get(choice.id);
    if (choice.personalizationAvailable || !contactChoice) return choice;
    return contactChoice.personalizationAvailable || choice.origins.every(origin => origin.module === 'contacts') ? contactChoice : choice;
  });
  const [showVarDropdown, setShowVarDropdown] = useState(false);


  useEffect(() => { setShowBuilder(false); setEditingCampaign(undefined); setSelectedCampaignForReport(null); setIsTemplateModalOpen(false); setPreviewTemplate(null); setNewTemplate({ name: '', subject: '', content: '', category: 'Marketing' }); }, [user?.tenantId]);

  const getPreviewText = (text: string) => renderEmailVariables(text, { ...campaignSampleValues(templateCatalog.fields), firstName: 'John', lastName: 'Doe', first_name: 'John', last_name: 'Doe', company_name: 'Example Company', sender_name: (previewTemplate?.type === 'SMS' ? templateSmsSettings.data?.organizationName : templateEmailSettings.data?.senderName) || 'Configured sender unavailable', sender_email: (previewTemplate?.type === 'SMS' ? templateSmsSettings.data?.organizationEmail : templateEmailSettings.data?.senderEmail) || 'Sender email unavailable', contact_number: '+639123456789', status: 'HOT' });
  function insertTemplateVariable(token: string) {
    const field = newTemplateType === 'Email' ? templateActiveField.current : 'content';
    const input = field === 'subject' ? templateSubjectRef.current : templateBodyRef.current;
    insertVariableAtSelection(input, newTemplate[field], token, value => setNewTemplate(previous => ({ ...previous, [field]: value })));
    setShowVarDropdown(false);
  }
  const canCreateCampaign = useHasPermission('campaigns.create');
  const canEditCampaign = useHasPermission('campaigns.edit');
  const canDeleteCampaign = useHasPermission('campaigns.archive');
  const canDuplicateCampaign = useHasPermission('campaigns.duplicate'), canViewReports = useHasPermission('campaigns.view_reports');
  const canSendCampaign = useHasPermission('campaigns.send');

  const [repairDuplicate, setRepairDuplicate] = useState<Campaign | null>(null);
  const handleDuplicate = async (camp: Campaign, source?: 'LEADS' | 'CONTACTS') => {
    try {
      if (source) await campaignsApi.duplicate(camp.id, source); else await campaignsApi.duplicate(camp.id);
      setRepairDuplicate(null);
      refetchCampaigns(); toast.success('Draft copy created.');
    } catch (e) { if (e instanceof Error && e.message.includes('legacy mixed')) setRepairDuplicate(camp); else toast.error(e instanceof Error ? e.message : 'Could not duplicate campaign.'); }
  };
  const handleSaveTemplate = async () => {
    if (templateLock.current) return;
    const parsed = MarketingTemplateSchema.safeParse({ ...newTemplate, type: newTemplateType });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
      setTemplateErrors(errors); return;
    }
    templateLock.current = true; setSavingTemplate(true); setTemplateErrors({});
    try {
      await templatesApi.create({ ...parsed.data, content: parsed.data.type === 'Email' ? DOMPurify.sanitize(parsed.data.content, { FORBID_TAGS: ['form', 'input', 'button', 'svg', 'iframe', 'object', 'embed'] }) : parsed.data.content });
      setIsTemplateModalOpen(false); setNewTemplate({ name: '', subject: '', content: '', category: 'Marketing' });
      refetchCampaigns(); toast.success('Template saved.');
    } catch (e) {
      const error = e as Error & { fieldErrors?: Record<string, string[]> };
      const errors: Record<string, string> = {};
      for (const [key, messages] of Object.entries(error.fieldErrors || {})) if (messages[0]) errors[key] = messages[0];
      if (!Object.keys(errors).length) errors.form = error.message;
      setTemplateErrors(errors);
    } finally { templateLock.current = false; setSavingTemplate(false); }
  };

  const getTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'email': return <Mail size={16} className="text-slate-500 dark:text-slate-400" />;
      case 'sms': return <MessageSquare size={16} className="text-slate-500 dark:text-slate-400" />;
      default: return <Megaphone size={16} className="text-slate-500 dark:text-slate-400" />;
    }
  };


  const emailTemplates = templates.filter(t => t.type === 'Email');
  const smsTemplates = templates.filter(t => t.type === 'SMS');

  const filteredCampaigns = campaigns;
  useNotificationRecordLink('campaignId', user?.id ?? '', !!user,
    async id => (await campaignsApi.get(id)).data,
    campaign => { if (canViewReports && !['draft', 'scheduled'].includes(campaign.status.toLowerCase())) setSelectedCampaignForReport(campaign); else { setEditingCampaign(campaign); setShowBuilder(true); } });
  const viewCampaign = (campaign: Campaign) => {
    if (['draft', 'scheduled'].includes(campaign.status.toLowerCase()) || !canViewReports) { setEditingCampaign(campaign); setShowBuilder(true); }
    else if (canViewReports) setSelectedCampaignForReport(campaign);
  };
  const campaignColumns: DataGridColumnDef<Campaign>[] = [
    { id: 'name', sortable: true, header: 'Campaign', accessor: row => row.name, width: 260 },
    { id: 'type', header: 'Type', accessor: row => row.type, width: 140, cell: (_, row) => <span className="flex items-center gap-2">{getTypeIcon(row.type)}{row.type.toUpperCase() === 'SMS' ? 'SMS' : row.type}</span> },
    { id: 'status', header: 'Status', accessor: row => row.status, width: 140, cell: (_, row) => <CampaignStatusBadge status={row.status} reviewRequired={row.reviewRequired} /> },
    { id: 'target', header: 'Target', accessor: row => row.targetAudience, width: 180 },
    { id: 'submitted', header: 'Submitted', accessor: row => row.sentCount, width: 120 },
    { id: 'opened', header: 'Opened', accessor: row => row.type.toUpperCase() === 'SMS' ? '—' : row.openedCount ?? 0, width: 110, cell: (_, row) => <span title={row.type.toUpperCase() === 'SMS' ? 'SMS opens are unavailable' : 'Unique opened recipients'}>{row.type.toUpperCase() === 'SMS' ? '—' : row.openedCount ?? 0}</span> },
    { id: 'clicked', header: 'Clicked', accessor: row => row.type.toUpperCase() === 'SMS' && row.smsTrackingVersion !== 1 ? '—' : row.clickedCount ?? 0, width: 110, cell: (_, row) => <span title={row.type.toUpperCase() === 'SMS' && row.smsTrackingVersion !== 1 ? 'Older SMS links were not tracked' : 'Unique clicking recipients'}>{row.type.toUpperCase() === 'SMS' && row.smsTrackingVersion !== 1 ? '—' : row.clickedCount ?? 0}</span> },
    { id: 'engagement', header: 'Engagement', accessor: row => campaignEngagementRate(row) === null ? '—' : `${Math.round(campaignEngagementRate(row)!)}%`, width: 130, cell: (_, row) => <span title={row.type.toUpperCase() === 'SMS' ? 'Unique clicking recipients / SMS submissions; older SMS links are untracked' : 'Unique opens / email submissions'}>{campaignEngagementRate(row) === null ? '—' : `${Math.round(campaignEngagementRate(row)!)}%`}</span> },
    { id: 'createdAt', sortable: true, header: 'Created', accessor: row => row.createdAt, width: 210, cell: (_, row) => <span title={formatDateTime(row.createdAt)}>{formatDateTime(row.createdAt)}</span> },
  ];
  const tableColumns = useModuleTableColumns('campaigns', CAMPAIGNS_TABLE_COLUMNS, campaignColumns.filter(column => canViewReports || !['submitted', 'opened', 'clicked', 'engagement'].includes(column.id)));

  if (showBuilder) {
    return <CampaignBuilder key={`${user?.tenantId}`} initialCampaign={editingCampaign} initialType={builderInitialType} initialContent={builderInitialContent} initialSubject={builderSubject} canSend={canSendCampaign}
      onBack={() => { setShowBuilder(false); setEditingCampaign(undefined); setBuilderInitialContent(undefined); setBuilderSubject(''); refetchCampaigns(); }} />;
  }

  if (selectedCampaignForReport) {
    return (
      <CampaignReportView
        campaign={selectedCampaignForReport}
        onBack={() => setSelectedCampaignForReport(null)}
      />
    );
  }

  // ── Error state (only when no data to show) ───────────────────────────────
  if (campaignsError && campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-red-500 dark:text-red-400 mb-3">{campaignsError}</p>
        <button
          onClick={refetchCampaigns}
          className="text-xs text-blue-500 hover:text-primary underline underline-offset-2 cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full min-w-0 space-y-4"
    >

      {/* 1. Standardized Header Row */}
      <PageHeader title="Campaigns" subtitle="Create, send, and monitor customer marketing campaigns." badge={<span className="text-xs text-slate-500">{isInitialLoad ? '…' : totalItems} total</span>}
        actions={canCreateCampaign && activeTab !== 'quotation' && <CreateActionDropdown primaryActionLabel="Create Campaign" onPrimaryAction={() => {
          setEditingCampaign(undefined); setBuilderInitialType('Email'); setBuilderInitialContent(undefined); setBuilderSubject(''); setShowBuilder(true);
        }} />} />

      <ModuleTabs<'all' | 'email' | 'sms' | 'quotation'> ariaLabel="Campaign views" activeTab={activeTab} onTabChange={setActiveTab} tabs={[
        { id: 'all', label: 'All Campaigns' }, { id: 'email', label: 'Email Templates' },
        { id: 'sms', label: 'SMS Templates' }, { id: 'quotation', label: 'Quotation Templates' },
      ]} />
      {activeTab === 'quotation' && <QuotationTemplates />}
      {activeTab === 'all' && <>
        {tableColumns.drawer}
        <ModuleTableToolbar stackSearchOnMobile label="Campaigns" search={searchTerm} onSearch={setSearchTerm} placeholder="Search campaigns..."
          filter={<FilterButton title="campaigns" open={showFilters} active={!!(statusFilter.length || typeFilter.length)} onClick={() => setShowFilters(!showFilters)} />}
          refreshing={isInitialLoad || isRefreshing} onRefresh={refetchCampaigns} onManageColumns={tableColumns.openColumns} onResetColumnSize={tableColumns.resetColumnWidths}
          sort={sort} sortFields={tableColumns.sortFields} onSortChange={next => { setSort(next); goToPage(1); }} />
      </>}

      {/* Tab Content */}
      {activeTab === 'all' && (
        totalItems === 0 && !searchTerm && !statusFilter.length && !typeFilter.length && !isInitialLoad && !isRefreshing ? (
          <div className="py-12">
            <EmptyState
              type="campaigns"
              title="No Campaigns Created Yet"
              actionLabel={canCreateCampaign ? 'Create Campaign' : undefined}
              onAction={canCreateCampaign ? () => setShowBuilder(true) : undefined}
              secondaryActionLabel={templates.filter(t => t.type === 'Email').length === 0 ? undefined : "Browse Templates"}
              onSecondaryAction={templates.filter(t => t.type === 'Email').length === 0 ? undefined : () => setActiveTab('email')}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex min-w-0 items-start gap-3">
              <ModuleFilterRail
                showFilters={showFilters}
                onToggleFilters={() => setShowFilters(false)}
                filterSearchTerm={filterSearchTerm}
                onFilterSearch={setFilterSearchTerm}
                totalRecords={totalItems}
                onClearFilters={searchTerm || statusFilter.length || typeFilter.length ? () => { setSearchTerm(''); setStatusFilter([]); setTypeFilter([]); } : undefined}
                filterGroups={[
                  {
                    id: 'status', label: 'Status', items: [
                      { id: 'sent', label: 'Sent' },
                      { id: 'partially_sent', label: 'Partially Sent' },
                      { id: 'interrupted', label: 'Interrupted' },
                      { id: 'delivered', label: 'Delivered' },
                      { id: 'failed', label: 'Failed' },
                      { id: 'draft', label: 'Draft' },
                      { id: 'scheduled', label: 'Scheduled' },
                    ].map(item => ({ ...item, isChecked: statusFilter.includes(item.id) }))
                  },
                  {
                    id: 'type', label: 'Type', items: [
                      { id: 'email', label: 'Email' },
                      { id: 'sms', label: 'SMS' },
                    ].map(item => ({ ...item, isChecked: typeFilter.includes(item.id) }))
                  },
                ]}
                onFilterToggle={(groupId, itemId) => {
                  const setFilter = groupId === 'status' ? setStatusFilter : setTypeFilter;
                  setFilter(previous => previous.includes(itemId) ? previous.filter(id => id !== itemId) : [...previous, itemId]);
                }}
              />
              <div className="min-w-0 flex-1">
                {isInitialLoad ? <TableLoadingState label="Loading campaigns..." /> : <DataGrid<Campaign> isRefreshing={isRefreshing} sort={sort} sortingMode="external" sortFields={tableColumns.sortFields} defaultSort={{ field: 'createdAt', direction: 'desc' }} onSortReset={() => setSort(null)} onSortChange={next => { setSort(next); goToPage(1); }}
                  columns={tableColumns.columns} onColumnWidthChange={tableColumns.onColumnWidthChange} data={filteredCampaigns} getRowId={row => row.id} height="auto" selectable={canDeleteCampaign} selectedIds={selected} onSelectionChange={setSelected}
                  enableColumnMenu ariaLabel="Campaigns table" summaryLabel={`${totalItems} total records`} onRowClick={viewCampaign}
                  rowActions={campaign => [
                    { id: 'view', label: 'View', icon: <Eye size={14} />, onClick: () => viewCampaign(campaign) },
                    ...(canDuplicateCampaign ? [{ id: 'duplicate', label: 'Duplicate', icon: <Copy size={14} />, onClick: () => void handleDuplicate(campaign) }] : []),
                    ...(canDeleteCampaign ? [{ id: 'archive', label: 'Archive', icon: <Archive size={14} />, separator: true, onClick: () => setArchiving(campaign) }] : []),
                  ]} />}
                <BulkSelectionBar selectedCount={selected.size} selectedIds={selected} onClearSelection={() => setSelected(new Set())} onRemoveIds={ids => setSelected(previous => new Set([...previous].filter(id => !ids.includes(id))))}
                  actions={canDeleteCampaign ? [{ id: 'archive', label: 'Archive', entityName: 'campaign', destructive: true, onExecute: async ids => { const result = await executeSelectedRows(ids, campaignsApi.archive); await refetchCampaigns(); return result; } }] : []} />
                <Dialog open={!!repairDuplicate} onOpenChange={open => { if (!open) setRepairDuplicate(null); }}><DialogContent aria-label="Repair legacy campaign source"><h2 className="text-lg font-semibold">Choose the copy’s source</h2><p className="text-sm">This legacy campaign mixed Leads and Contacts. Select one source for its new draft.</p><div className="flex gap-2"><button className="rounded border px-3 py-2" onClick={() => repairDuplicate && void handleDuplicate(repairDuplicate, 'LEADS')}>Leads</button><button className="rounded border px-3 py-2" onClick={() => repairDuplicate && void handleDuplicate(repairDuplicate, 'CONTACTS')}>Contacts</button></div></DialogContent></Dialog>
                <ConfirmActionDialog open={!!archiving} onOpenChange={open => { if (!open) setArchiving(null); }} title="Archive this campaign?" description="Campaign history and status are preserved." confirmLabel="Archive" variant="destructive" onConfirm={async () => {
                  if (!archiving) return;
                  try { await campaignsApi.archive(archiving.id); setArchiving(null); setSelected(new Set()); await refetchCampaigns(); toast.success('Campaign archived.'); }
                  catch (e) { throw new Error(e instanceof Error ? e.message : 'Unable to archive campaign.'); }
                }} />

                <div className="mt-4">
                  <LeadsPagination
                    currentPage={currentPage}
                    pageSize={pageSize}
                    totalRecords={totalItems}
                    loading={isInitialLoad} disabled={isInitialLoad}
                    onPageChange={goToPage}
                    onPageSizeChange={setPageSize}
                  />
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {activeTab === 'email' && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => { setNewTemplateType('Email'); setIsTemplateModalOpen(true); }}
              className="flex items-center gap-2 bg-gray-50 dark:bg-white/5 border border-gray-300 dark:border-white/10 text-slate-900 dark:text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              <Plus size={16} aria-hidden="true" /> New Email Template
            </button>
          </div>
          {emailTemplates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {emailTemplates.map(template => (
                <div key={template.id} className="bg-white dark:bg-white/2 rounded-xl border border-gray-200 dark:border-white/5 p-5 shadow-lg backdrop-blur-xl flex flex-col h-full">
                  <div className="flex justify-between items-start mb-3">
                    <span className="px-2.5 py-1 bg-gray-50 dark:bg-white/5 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-md border border-gray-200 dark:border-white/5">
                      {template.category}
                    </span>
                    <Mail size={16} className="text-slate-500 dark:text-slate-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">{template.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 line-clamp-1">{template.subject}</p>
                  <div className="bg-white dark:bg-white/2 border border-gray-200 dark:border-white/5 rounded-lg p-4 text-sm text-slate-700 dark:text-slate-300 mb-6 grow">
                    <p className="line-clamp-3">{template.content}</p>
                  </div>
                  <div className="flex gap-3 mt-auto">
                    <button onClick={() => setPreviewTemplate(template)} className="flex-1 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-white/2 border border-gray-300 dark:border-white/10 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-colors">
                      Preview
                    </button>
                    <button onClick={() => {
                      setBuilderInitialType('Email'); setBuilderInitialContent(template.content); setBuilderSubject(template.subject || '');
                      setBuilderInitialType('Email');
                      setBuilderInitialContent(template.content); setBuilderSubject(template.subject || '');
                      setShowBuilder(true);
                    }} className="flex-1 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors shadow-[0_0_15px_rgba(10,110,255,0.2)]">
                      Use Template
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8">
              <EmptyState
                type="email"
                title="No Email Templates Found"
                description="Save reusable drafts for follow-ups, newsletters, and announcements to establish consistent client touchpoints."
                actionLabel="Create First Email Template"
                onAction={() => { setNewTemplateType('Email'); setIsTemplateModalOpen(true); }}
              />
            </div>
          )}
        </div>
      )}

      {activeTab === 'sms' && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => { setNewTemplateType('SMS'); setIsTemplateModalOpen(true); }}
              className="flex items-center gap-2 bg-gray-50 dark:bg-white/5 border border-gray-300 dark:border-white/10 text-slate-900 dark:text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              <Plus size={16} aria-hidden="true" /> New SMS Template
            </button>
          </div>
          {smsTemplates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {smsTemplates.map(template => (
                <div key={template.id} className="bg-white dark:bg-white/2 rounded-xl border border-gray-200 dark:border-white/5 p-5 shadow-lg backdrop-blur-xl flex flex-col h-full">
                  <div className="flex justify-between items-start mb-3">
                    <span className="px-2.5 py-1 bg-gray-50 dark:bg-white/5 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-md border border-gray-200 dark:border-white/5">
                      {template.category}
                    </span>
                    <MessageSquare size={16} className="text-slate-500 dark:text-slate-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">{template.name}</h3>
                  <div className="bg-white dark:bg-white/2 border border-gray-200 dark:border-white/5 rounded-lg p-4 text-sm text-slate-700 dark:text-slate-300 mb-2 grow">
                    <p className="line-clamp-4">{template.content}</p>
                  </div>
                  <div className="text-xs text-slate-500 mb-6">
                    {template.content.length} characters
                  </div>
                  <div className="flex gap-3 mt-auto">
                    <button onClick={() => setPreviewTemplate(template)} className="flex-1 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-white/2 border border-gray-300 dark:border-white/10 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 hover:text-slate-905 hover:text-slate-900 dark:hover:text-white transition-colors">
                      Preview
                    </button>
                    <button onClick={() => {
                      setBuilderInitialType('SMS'); setBuilderInitialContent(template.content);
                      setShowBuilder(true);
                    }} className="flex-1 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors shadow-[0_0_15px_rgba(10,110,255,0.2)]">
                      Use Template
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8">
              <EmptyState
                type="sms"
                title="No SMS Templates Found"
                description="Draft quick SMS templates with dynamic placeholders like {{firstName}} to let your representatives reply to prospects instantly."
                actionLabel="Create First SMS Template"
                onAction={() => { setNewTemplateType('SMS'); setIsTemplateModalOpen(true); }}
              />
            </div>
          )}
        </div>
      )}

      {/* Create Campaign Side Panel */}
      {/* Create Template Side Panel */}
      <SideSheet isOpen={isTemplateModalOpen} onClose={() => setIsTemplateModalOpen(false)} title={`Create ${newTemplateType} Template`} subtitle="Save a message to reuse in future campaigns.">
        <div className="flex h-full min-h-0 flex-col"><div className={panelBodyClass + " space-y-4"}>
          <div>
            <label htmlFor="template-name" className={panelLabelClass + " mb-1.5"}>Template Name <span className="text-red-500">*</span></label>
            <input
              id="template-name" className={panelInputClass}
              placeholder="e.g. Welcome Series - Email 1"
              value={newTemplate.name}
              onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
            />
            <FieldError message={templateErrors.name} />
          </div>
          <div>
            <label htmlFor="template-category" className={panelLabelClass + " mb-1.5"}>Category</label>
            <select id="template-category"
              className={panelInputClass}
              value={newTemplate.category}
              onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value })}
            >
              <option className="bg-gray-50 dark:bg-slate-950">Marketing</option>
              <option className="bg-gray-50 dark:bg-slate-950">Sales</option>
              <option className="bg-gray-50 dark:bg-slate-950">Onboarding</option>
              <option className="bg-gray-50 dark:bg-slate-950">Support</option>
            </select>
          </div>
          {newTemplateType === 'Email' && (
            <div>
              <label htmlFor="template-subject" className={panelLabelClass + " mb-1.5"}>Subject Line <span className="text-red-500">*</span></label>
              <input
                ref={templateSubjectRef} onFocus={() => { templateActiveField.current = 'subject'; }} id="template-subject" className={panelInputClass}
                placeholder="Welcome to LeadCRM!"
                value={newTemplate.subject}
                onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })}
              />
              <FieldError message={templateErrors.subject} />
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <label htmlFor="template-content" className={panelLabelClass}>Message Content <span className="text-red-500">*</span></label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowVarDropdown(!showVarDropdown)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary dark:text-primary bg-primary/10 rounded-md hover:bg-primary/20 transition-colors duration-200 border border-primary/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Wand2 size={14} /> Insert Variable
                </button>
                {showVarDropdown && (
                  <div className="absolute right-0 bottom-full mb-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl overflow-hidden z-50 backdrop-blur-xl">
                    <CampaignVariablePicker choices={templateChoices} onInsert={insertTemplateVariable} />
                  </div>
                )}
              </div>
            </div>
            <textarea
              ref={templateBodyRef} onFocus={() => { templateActiveField.current = 'content'; }} id="template-content" rows={8}
              className={panelInputClass + " resize-none"}
              placeholder={`Hi {{firstName}},\n\n...`}
              value={newTemplate.content}
              onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
            ></textarea>
            <FieldError message={templateErrors.content} />
          </div>
          <FieldError message={templateErrors.form} />
        </div><div className={panelFooterClass + " justify-end"}>
            <button onClick={() => setIsTemplateModalOpen(false)} className={panelSecondaryActionClass}>Cancel</button>
            <button
              onClick={handleSaveTemplate} disabled={savingTemplate}
              className={panelPrimaryActionClass}
            >
              {savingTemplate ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </div>
      </SideSheet>
      {/* Preview Template Modal */}
      {previewTemplate && (
        <Dialog open={!!previewTemplate} onOpenChange={open => { if (!open) setPreviewTemplate(null); }}>
          <DialogContent showClose={false} aria-label="Template Preview" className="bg-gray-50 dark:bg-slate-950 max-w-lg p-0 sm:p-0 [overflow-wrap:anywhere]">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-white/5">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Template Preview</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{previewTemplate.name}</p>
              </div>
              <button aria-label="Close template preview" onClick={() => setPreviewTemplate(null)} className="p-2 min-h-11 min-w-11 grid place-items-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/5 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              {previewTemplate.type === 'Email' && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Subject</label>
                  <div className="text-sm text-slate-900 dark:text-white font-medium">{getPreviewText(previewTemplate.subject || '')}</div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Content</label>
                <div className="bg-white dark:bg-white/2 border border-gray-200 dark:border-white/5 rounded-lg p-4 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {getPreviewText(previewTemplate.content)}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-3 p-4 sm:p-6 border-t border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-slate-950">
              <button onClick={() => setPreviewTemplate(null)} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/5 rounded-lg transition-colors">Close</button>
              <button
                onClick={() => {
                  setBuilderInitialType(previewTemplate.type); setBuilderInitialContent(previewTemplate.content); setBuilderSubject(previewTemplate.subject || '');
                  setShowBuilder(true);
                  setPreviewTemplate(null);
                }}
                className="px-4 py-2 bg-primary text-slate-900 dark:text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors shadow-[0_0_15px_rgba(10,110,255,0.2)]"
              >
                Use Template
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </motion.div>
  );
}
