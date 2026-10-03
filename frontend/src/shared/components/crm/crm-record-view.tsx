'use client';

import React, { useEffect, useId, useState } from 'react';
import { DealClosingRequirements } from './deal-closing-requirements';
import { invalidatePageCache } from '@/shared/cache/page-cache';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Building, ChevronDown, ChevronRight, ExternalLink, Globe, Inbox, Mail, MapPin, MoreHorizontal, Loader2, Pencil, Phone, Plus, User, UserPlus, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { USE_MOCK_DATA } from '@/lib/config';
import { cn, getCRMStatusStyles } from '@/lib/utils';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import type { Lead, Contact } from '@/store/types';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { useRecordActivities, type TimelineActivity } from '@/shared/hooks/use-record-activities';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { Button } from '@/shared/components/ui/button';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/shared/components/ui/dropdown-menu';
import { RecordTimelineTab } from './record-timeline-tab';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { CRM_STATUSES, normalizeCrmStatus } from '@leadcrm/shared';
import type { RecordFileMetadata } from '@leadcrm/shared';
import { RecordFilesTab } from './record-files-tab';
import { ConfirmActionDialog } from './confirm-action-dialog';
import { RecordSection } from './record-section';
export { RecordSection } from './record-section';
import { InlineDealForm } from './inline-deal-form';
import { RelatedTasks } from '@/features/tenant/operations/tasks/ui/related-tasks';
import type { Account } from '@/features/tenant/crm/accounts/types/account.types';
import { CatalogProductInterestSelect } from './product-interest-select';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { CrmEmailSchema } from '@leadcrm/shared';
import { RecordBackButton } from './record-back-button';
import { ConvertLeadDialog } from '@/features/tenant/crm/leads/ui/convert-lead-dialog';
import { leadEmailComposeHref } from '@/features/tenant/inbox/services/compose-navigation';
import { copyTextWithFeedback } from '@/shared/utils/clipboard';

export type CrmRecordModule = 'leads' | 'contacts' | 'accounts' | 'deals';
type RecordData = Record<string, unknown>;
interface Relationships {
  account?: RecordData | null;
  contact?: RecordData | null;
  sourceLead?: RecordData | null;
  contacts?: RecordData[];
  leads?: RecordData[];
  deals?: RecordData[];
  activities?: TimelineActivity[];
}
const labels = { leads: 'Lead', contacts: 'Contact', accounts: 'Account', deals: 'Deal' };
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const personName = (record?: RecordData | null) => record ? [text(record.firstName), text(record.lastName)].filter(Boolean).join(' ') : '';
const object = (value: unknown): RecordData | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : undefined;
const displayText = (value: unknown): string => Array.isArray(value) ? value.join(', ') || '—' : String(value ?? '') || '—';
const present = (value: unknown) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);


function RecordQuickInfo({ items, actions }: { items: { value: string; icon: LucideIcon; href?: string; label?: string; onClick?: () => void; ariaLabel?: string; disabled?: boolean }[]; actions?: React.ReactNode }) {
  return <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1 sm:mt-4 sm:gap-1.5">
    {items.filter(item => item.value).map(({ value, icon: Icon, href, label, onClick, ariaLabel, disabled }) => {
      const content = <><Icon className="h-3 w-3 shrink-0 text-muted-foreground sm:h-3.5 sm:w-3.5" /><span className="min-w-0 [overflow-wrap:anywhere]">{label}{value}</span></>;
      const cls = 'inline-flex min-h-8 max-w-full items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-foreground sm:min-h-9 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs';
      if (onClick) return <button key={label || value} type="button" onClick={onClick} aria-label={ariaLabel} disabled={disabled} className={cn(cls, 'text-left enabled:cursor-pointer enabled:hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60')}>{content}</button>;
      return href ? <a key={label || value} href={href} className={cn(cls, 'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring')}>{content}</a> : <span key={label || value} className={cls}>{content}</span>;
    })}
    {actions}
  </div>;
}

// ── InlineEditRows — click-to-edit About section ─────────────────────────────
interface InlineRowDef {
  label: string;
  value: unknown;
  apiField?: string;
  required?: boolean;
  maxLength?: number;
  type?: 'text' | 'email' | 'tel' | 'url' | 'select' | 'textarea' | 'date' | 'products' | 'users' | 'accounts' | 'contacts' | 'leads';
  valueMode?: 'id' | 'name';
  displayValue?: unknown;
  productLabels?: Record<string, string>;
  options?: string[];
}

function InlineEditRows({ rows, canEdit, onSave }: {
  rows: InlineRowDef[];
  canEdit: boolean;
  onSave: (field: string, value: string | string[]) => Promise<void>;
}) {
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string | string[]>('');
  const [isSaving, setIsSaving] = useState(false);
  const [fieldError, setFieldError] = useState('');

  const startEdit = (label: string, value: unknown) => {
    setFieldError('');
    setEditingLabel(label);
    setEditValue(Array.isArray(value) ? value : String(value ?? ''));
  };
  const cancelEdit = () => { setEditingLabel(null); setEditValue(''); };
  const commitEdit = async (apiField: string) => {
    if (isSaving) return;
    setFieldError('');
    const row = rows.find(row => row.apiField === apiField);
    if (row?.required && (typeof editValue !== 'string' || !editValue.trim())) { setFieldError(`${row.label} is required`); return; }
    if (row?.required && typeof editValue === 'string' && editValue.trim().length > (row.maxLength ?? 100)) { setFieldError(`Max ${row.maxLength ?? 100} characters`); return; }
    if (rows.find(row => row.apiField === apiField)?.type === 'email') {
      const result = CrmEmailSchema.safeParse(editValue);
      if (!result.success) { setFieldError(result.error.issues[0].message); return; }
    }
    setIsSaving(true);
    try { await onSave(apiField, typeof editValue === 'string' ? editValue.trim() : editValue); setEditingLabel(null); }
    catch (error) { setFieldError(error instanceof Error ? error.message : 'Unable to save field'); }
    finally { setIsSaving(false); }
  };

  return (
    <dl className="divide-y divide-border/60">
      {rows.filter(({ value, displayValue, apiField, label, required }) => required || present(displayValue ?? value) || (canEdit && !!apiField) || editingLabel === label).map(({ label, value, apiField, type, options, valueMode, displayValue, productLabels, required, maxLength }) => {
        const isEditing = editingLabel === label;
        const editable = canEdit && !!apiField;
        return (
          <div key={label} className={cn('grid min-w-0 gap-3 px-3 py-2.5 text-xs', required ? 'grid-cols-[minmax(max-content,2fr)_minmax(0,3fr)]' : 'grid-cols-[minmax(0,2fr)_minmax(0,3fr)]')}>
            <dt className="text-muted-foreground self-start pt-0.5">{label}{(required || type === 'email' && editable) && <span className="text-red-500"> *</span>}</dt>
            <dd className="min-w-0">
              {isEditing && apiField ? (
                <div className="flex flex-col gap-1.5">
                  {type === 'products' ? <CatalogProductInterestSelect values={Array.isArray(editValue) ? editValue : []} onChange={setEditValue} valueMode={valueMode} labels={productLabels} disabled={isSaving} /> : type === 'users' || type === 'accounts' ? <EntityCombobox entityType={type} multiple={false} disabled={isSaving} value={String(editValue) || null} onChange={value => setEditValue(value || '')} /> : type === 'contacts' || type === 'leads' ? <EntityCombobox entityType={type} multiple disabled={isSaving} values={Array.isArray(editValue) ? editValue : []} onMultiChange={setEditValue} /> : type === 'select' ? (
                    <select aria-label={label} disabled={isSaving} value={Array.isArray(editValue) ? editValue.join(', ') : editValue} onChange={e => setEditValue(e.target.value)} autoFocus className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                      {options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : type === 'textarea' ? (
                    <textarea aria-label={label} disabled={isSaving} value={Array.isArray(editValue) ? editValue.join(', ') : editValue} onChange={e => setEditValue(e.target.value)} rows={3} autoFocus onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }} className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
                  ) : (
                    <input aria-label={label} disabled={isSaving} type={type ?? 'text'} required={required || type === 'email'} aria-required={required || type === 'email'} aria-invalid={!!fieldError} maxLength={type === 'email' ? 254 : required ? maxLength ?? 100 : undefined} value={Array.isArray(editValue) ? editValue.join(', ') : editValue} onChange={e => setEditValue(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') void commitEdit(apiField); if (e.key === 'Escape') cancelEdit(); }} className={cn("w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring", fieldError ? "border-red-500" : "border-input")} />
                  )}
                  {fieldError && <p role="alert" className="text-xs text-destructive">{fieldError}</p>}
                  <div className="flex flex-wrap justify-end gap-1">
                    <button type="button" onClick={() => void commitEdit(apiField)} disabled={isSaving} className="inline-flex items-center rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">{isSaving ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Saving…</> : 'Save'}</button>
                    <button type="button" onClick={cancelEdit} disabled={isSaving} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={!editable || isSaving} aria-label={editable ? `Edit ${label}` : undefined}
                  className={cn('group flex w-full items-start justify-end gap-1.5 text-right [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default', editable && 'hover:text-primary hover:underline')}
                  onClick={() => startEdit(label, value)}>
                  <span className="min-w-0">{displayText(displayValue ?? value)}</span>{editable && <Pencil aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />}
                </button>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function RecordRows({ rows }: { rows: [string, unknown][] }) {
  return <dl className="divide-y divide-border/60">{rows.filter(([, value]) => present(value)).map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2.5 text-xs">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-right [overflow-wrap:anywhere]">{Array.isArray(value) ? <span className="flex flex-wrap justify-end gap-1">{value.map((item, index) => <span key={index} className="rounded-md bg-[var(--primary)]/10 px-1.5 py-0.5 text-[var(--primary)]">{String(item)}</span>)}</span> : String(value)}</dd>
  </div>)}</dl>;
}

function RelatedRecords({ records, module, empty }: { records: RecordData[]; module: string; empty: string }) {
  return records.length ? <div className="divide-y divide-border/60">{records.map(record => <Link key={text(record.id)} href={`/crm/${module}/${encodeURIComponent(text(record.id))}`} className="flex min-w-0 items-center gap-3 px-3 py-3 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
    <div className="min-w-0 flex-1 [overflow-wrap:anywhere]"><p className="text-sm font-medium">{text(record.name) || text(record.title) || personName(record)}</p><p className="mt-0.5 text-xs text-muted-foreground">{text(record.email) || text(record.industry) || text(object(record.stage)?.name)}</p></div><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
  </Link>)}</div> : <p className="px-4 py-7 text-center text-sm text-muted-foreground">{empty}</p>;
}

/** The drawer and route render this same record reader, actions and content. */
export function CrmRecordView({ module, id, onClose, onEdit, focusClosing = false }: { module: CrmRecordModule; id: string; onClose?: () => void; onEdit?: (record: RecordData) => void; focusClosing?: boolean }) {
  const router = useRouter();
  const { user, tenant } = useAuth();
  const data = useData();
  const canEdit = useHasPermission(module === 'deals' ? 'deals.edit' : module === 'accounts' ? 'accounts.edit' : module === 'leads' ? 'leads.edit' : 'contacts.edit');
  const hasArchivePermission = useHasPermission(module === 'deals' ? 'deals.archive' : module === 'accounts' ? 'accounts.archive' : module === 'leads' ? 'leads.archive' : 'contacts.archive');
  const canArchive = hasArchivePermission && !USE_MOCK_DATA;
  const canCreateDeal = useHasPermission('deals.create');
  const canReadDeals = useHasPermission('deals.view');
  const canReadContacts = useHasPermission('contacts.view');
  const canReadAccounts = useHasPermission('accounts.view');
  const [tab, setTab] = useState(focusClosing ? 'details' : 'activity');
  const [closingAttention, setClosingAttention] = useState(focusClosing);
  const [detailsVisited, setDetailsVisited] = useState(false);
  const [converting, setConverting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [creatingDeal, setCreatingDeal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lostStage, setLostStage] = useState<string>();
  const [lostReason, setLostReason] = useState('');
  const [taskCount, setTaskCount] = useState<number>();
  const [savingField, setSavingField] = useState<string | null>(null);
  const recordQuery = useCachedPage<RecordData>({ module, params: { recordId: id }, revalidateOnInvalidation: true,
    fetchFn: async signal => (await apiClient.get<{ data: RecordData }>(`/crm/${module}/${encodeURIComponent(id)}`, { signal })).data });
  // Contacts' timeline is already included in this endpoint; avoid a second read.
  const relatedQuery = useCachedPage<Relationships>({ module, params: { recordId: id, relationships: true }, revalidateOnInvalidation: true,
    disabled: module === 'deals' || USE_MOCK_DATA || (!detailsVisited && module !== 'contacts') || !recordQuery.data || !!recordQuery.error,
    fetchFn: async signal => (await apiClient.get<{ data: Relationships }>(`/crm/${module}/${encodeURIComponent(id)}/relationships?limit=50`, { signal })).data });
  const timeline = useRecordActivities(module, id, !!recordQuery.data && !recordQuery.error || USE_MOCK_DATA, module === 'contacts' ? relatedQuery.data?.activities ?? [] : undefined);
  const mockRecords = module === 'deals' ? data.deals : module === 'accounts' ? data.organizations : data.contacts;
  const mockRecord = USE_MOCK_DATA ? mockRecords.find(item => item.id === id && item.tenantId === tenant?.id) : undefined;
  const record = USE_MOCK_DATA ? mockRecord as unknown as RecordData : recordQuery.data;
  useEffect(() => {
    const focus = (event: Event) => {
      if (module !== 'deals' || (event as CustomEvent<string>).detail !== id) return;
      event.preventDefault(); setTab('details'); setDetailsVisited(true); setClosingAttention(true);
    };
    window.addEventListener('deal-closing-required', focus);
    return () => window.removeEventListener('deal-closing-required', focus);
  }, [module, id]);
  useEffect(() => {
    if (!closingAttention || !record || tab !== 'details') return;
    const frame = requestAnimationFrame(() => { const section = document.getElementById(`closing-requirements-${id}`); section?.scrollIntoView({ block: 'start' }); section?.focus(); setClosingAttention(false); });
    return () => cancelAnimationFrame(frame);
  }, [closingAttention, record, tab, id]);
  const filesQuery = useCachedPage<RecordFileMetadata[]>({ module, params: { recordId: id, files: true }, revalidateOnInvalidation: true,
    disabled: tab !== 'files' || !recordQuery.data || USE_MOCK_DATA,
    fetchFn: async signal => (await apiClient.get<{ data: RecordFileMetadata[] }>(`/crm/${module}/${encodeURIComponent(id)}/files`, { signal })).data });

  const relationships = relatedQuery.data;
  const label = labels[module];
  const refresh = () => { void recordQuery.refetch(); if (module !== 'deals') void relatedQuery.refetch(); void timeline.refetch(); };
  const edit = () => {
    setTab('details'); setDetailsVisited(true);
  };
  const save = async (payload: RecordData) => {
    if (saving) return;
    setSaving(true);
    try {
      if (USE_MOCK_DATA) {
        if (module === 'accounts') await data.updateOrganization(id, payload);
        else if (module === 'deals') await data.updateDeal(id, payload);
        else await data.updateContact(id, payload);
      } else await apiClient.put(`/crm/${module}/${encodeURIComponent(id)}`, payload);
      refresh();
      toast.success(`${label} updated`);
    } catch (error) { toast.error(error instanceof Error ? error.message : `Failed to update ${label.toLowerCase()}`); }
    finally { setSaving(false); }
  };

  const saveField = async (apiField: string, value: string | string[]): Promise<void> => {
    if (savingField) return;
    setSavingField(apiField);
    try {
      if (USE_MOCK_DATA) {
        if (module === 'accounts') await data.updateOrganization(id, { [apiField]: value });
        else if (module === 'deals') await data.updateDeal(id, { [apiField]: value });
        else await data.updateContact(id, { [apiField]: value });
      } else {
        const trimmed = typeof value === 'string' ? value.trim() : value;
        if (apiField === 'email' && (module === 'leads' || module === 'contacts')) CrmEmailSchema.parse(trimmed);
        const normalized = apiField === 'website' && module === 'accounts' && typeof trimmed === 'string' && trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
        await apiClient.put(`/crm/${module}/${encodeURIComponent(id)}`, { [apiField]: module === 'deals' && ['accountId', 'assignedUserId', 'expectedCloseDate'].includes(apiField) && normalized === '' ? null : apiField === 'expectedCloseDate' && normalized ? new Date(String(normalized)).toISOString() : normalized });
      }
      refresh();
      toast.success('Field updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update field');
      throw error;
    } finally {
      setSavingField(null);
    }
  };

  if (recordQuery.isInitialLoad) return <div role="status" aria-label={`Loading ${label.toLowerCase()}`} className="relative space-y-4 p-4 animate-pulse">{onClose && <Button variant="ghost" size="icon" className="absolute right-3 top-3" onClick={onClose} aria-label="Close record" title="Close record"><X size={16} /></Button>}<div className="h-12 w-12 rounded-xl bg-muted" /><div className="h-5 w-2/3 rounded bg-muted" /><div className="h-9 rounded-xl bg-muted" /><div className="h-44 rounded-xl bg-muted" /></div>;
  if (recordQuery.error || !record) return <div className="space-y-4 p-5"><h2 className="font-semibold">Unable to open {label.toLowerCase()}</h2><p role="alert" className="text-sm text-muted-foreground">{recordQuery.error || 'Record not found or access is unavailable.'}</p><Button variant="outline" onClick={() => void recordQuery.refetch()}>Retry</Button>{onClose && <Button variant="ghost" onClick={onClose}>Close</Button>}</div>;

  const title = module === 'deals' ? text(record.title) : module === 'accounts' ? text(record.name) : personName(record);
  const person = module === 'deals' ? object((record.leadDeals as RecordData[] | undefined)?.[0]?.lead) ?? object((record.contactDeals as RecordData[] | undefined)?.[0]?.contact) : record;
  const source = (module === 'deals' ? (record.productInterests as string[] | undefined)?.join(', ') : '') || text(record.source) || text(record.leadSource);
  const owner = personName(object(record.assignedUser)) || personName(object(record.owner));
  const company = text(object(record.organization)?.name) || text(person?.companyName) || text(person?.company) || text(record.companyName) || text(record.company) || text(object(record.account)?.name);
  const location = [text(record.address), text(record.city), text(record.province), text(record.country)].filter(Boolean).join(', ');
  const leadChipActions = module === 'leads' && !!onClose;
  const email = text(person?.email);
  const phone = text(person?.phone);
  const composeHref = leadChipActions ? leadEmailComposeHref(email) : null;
  const subtitle = module === 'deals' ? `₱${Number(record.value ?? 0).toLocaleString()} · ${text(object(record.pipeline)?.name)}` : module === 'accounts' ? text(record.industry) || text(record.website) : company || text(record.jobTitle) || location;
  const rawStatus = text(module === 'deals' ? object(record.stage)?.name : module === 'accounts' ? '' : record.status);
  const status = module === 'leads' || module === 'contacts' ? normalizeCrmStatus(rawStatus) : rawStatus;
  const statusLabel = status === status.toUpperCase() ? status.charAt(0) + status.slice(1).toLowerCase() : status;
  const dealStages = data.pipelines.find(p => p.id === record.pipelineId)?.stages ?? [];
  const changeStage = async (stageId: string, reason?: string) => {
    setSaving(true);
    try { await data.moveDealStage(id, stageId, undefined, reason); setLostStage(undefined); refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to move Deal'); }
    finally { setSaving(false); }
  };
  const statuses = [...CRM_STATUSES];
  const rows: [string, unknown][] = [
    ...(module === 'accounts' ? [['Account name', record.name], ['Industry', record.industry], ['Company size', record.size]] as [string, unknown][] : []),
    ...(module === 'deals' ? [['Deal title', title], ['Deal value', subtitle.split(' · ')[0]], ['Priority', record.priority], ['Associated Lead / Contact', personName(person)], ['Created', record.createdAt ? new Date(String(record.createdAt)).toLocaleDateString() : '']] as [string, unknown][] : []),
    ['Email', person?.email], ['Phone', person?.phone], ['Address', location], ['Company', module !== 'accounts' ? company : undefined], ['Job title', record.jobTitle], ['Website', record.website],
    ['Product interests', record.productInterest ?? record.productInterests], ['Source', module === 'deals' ? record.leadSource : source], ['Status', statusLabel], ['Assigned Agent', owner], ['Notes', module === 'deals' ? undefined : record.notes ?? record.description],
  ];
  const productIds = (record.productInterestIds as string[] | undefined)?.length ? record.productInterestIds as string[] : record.productInterestId ? [text(record.productInterestId)] : [];
  const productNames = (record.productInterest ?? record.productInterests ?? []) as string[];
  const productRow: InlineRowDef = { label: 'Product interests', value: module === 'leads' || module === 'deals' ? productIds : productNames, displayValue: productNames, apiField: module === 'leads' ? 'productInterest' : module === 'deals' ? 'productInterestIds' : 'productInterests', type: 'products', valueMode: module === 'leads' || module === 'deals' ? 'id' : 'name', productLabels: Object.fromEntries(productIds.map((id, i) => [id, productNames[i] ?? 'Unavailable product'])) };
  const aboutRows: InlineRowDef[] = module === 'deals' ? [
    { label: 'Deal title', value: title, apiField: 'title' },
    { label: 'Deal value', value: subtitle.split(' · ')[0] },
    productRow,
    { label: 'Priority', value: record.priority, apiField: 'priority', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'] },
    { label: 'Expected close date', value: text(record.expectedCloseDate).slice(0, 10), apiField: 'expectedCloseDate', type: 'date' },
    { label: 'Pipeline', value: object(record.pipeline)?.name },
    { label: 'Stage', value: statusLabel },
    { label: 'Assigned Agent', value: record.assignedUserId, displayValue: owner, apiField: 'assignedUserId', type: 'users' },
    { label: 'Account', value: record.accountId, displayValue: company, apiField: 'accountId', type: 'accounts' },
    { label: 'Contacts', value: (record.contactDeals as RecordData[] | undefined)?.map(link => text(object(link.contact)?.id)) ?? [], displayValue: (record.contactDeals as RecordData[] | undefined)?.map(link => personName(object(link.contact))) ?? [], apiField: 'contactIds', type: 'contacts' },
    { label: 'Leads', value: (record.leadDeals as RecordData[] | undefined)?.map(link => text(object(link.lead)?.id)) ?? [], displayValue: (record.leadDeals as RecordData[] | undefined)?.map(link => personName(object(link.lead))) ?? [], apiField: 'leadIds', type: 'leads' },
    { label: 'Source', value: record.leadSource, apiField: 'leadSource' },
    { label: 'Industry', value: record.industry, apiField: 'industry' },
    { label: 'Address', value: record.address, apiField: 'address' },
    { label: 'Created', value: record.createdAt },
  ] : [
    ...(module === 'accounts' ? [
      { label: 'Account name', value: record.name, apiField: 'name', required: true, maxLength: 255 },
      { label: 'Industry', value: record.industry, apiField: 'industry' },
      { label: 'Company size', value: record.size, apiField: 'size', type: 'select' as const, options: ['1-10', '11-50', '51-200', '200+'] },
      { label: 'Website', value: record.website, apiField: 'website', type: 'url' as const },
      { label: 'City', value: record.city, apiField: 'city' },
      { label: 'Province', value: record.province, apiField: 'province' },
    ] : [
      { label: 'First name', value: record.firstName, apiField: 'firstName', required: true },
      { label: 'Last name', value: record.lastName, apiField: 'lastName', required: true },
      { label: 'Email', value: record.email, apiField: 'email', type: 'email' as const },
      { label: 'Phone', value: record.phone, apiField: 'phone', type: 'tel' as const },
      { label: 'Company', value: module === 'leads' ? record.companyName : record.company, apiField: module === 'leads' ? 'companyName' : 'company' },
      ...(module === 'contacts' ? [{ label: 'Job title', value: record.jobTitle, apiField: 'jobTitle' }] : [{ label: 'Website', value: record.website, apiField: 'website' }]),
      { label: 'Source', value: source, apiField: 'source' },
    ]),
    { label: 'Address', value: record.address, apiField: 'address' },
    productRow,
    ...(module === 'accounts' ? [] : [{ label: 'Status', value: statusLabel, apiField: 'status', type: 'select' as const, options: statuses }]),
    { label: 'Assigned Agent', value: owner },
    { label: 'Notes', value: module === 'leads' ? record.description : record.notes, apiField: module === 'leads' ? 'description' : 'notes', type: 'textarea' },
  ];

  const customFields = object(record.customFields);
  const deals = relationships?.deals ?? [];
  const links = module === 'deals' ? { dealId: id } : module === 'leads' ? { leadId: id } : module === 'contacts' ? { contactId: id } : { accountId: id };
  const activityLoading = module === 'contacts' ? relatedQuery.isInitialLoad : timeline.isInitialLoad;
  const activityError = module === 'contacts' ? relatedQuery.error : timeline.error;
  const formRecord = { ...record, companyName: company, leadSource: source, organizationId: record.accountId, productInterests: record.productInterest ?? record.productInterests, status: statusLabel };
  const website = text(record.website);
  const websiteHref = website && !/^[a-z][a-z0-9+.-]*:/i.test(website) ? `https://${website}` : /^https?:\/\//i.test(website) ? website : undefined;

  const manageMenu = (canEdit || canArchive) && (
    <DropdownMenu>
      <TooltipProvider><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Record actions" title="Record actions">
          <MoreHorizontal size={16} />
        </Button>
      </DropdownMenuTrigger></TooltipTrigger><TooltipContent>Record actions</TooltipContent></Tooltip></TooltipProvider>
      <DropdownMenuContent align="end">
        {canEdit && <DropdownMenuItem onSelect={edit}><Pencil size={14} />Edit {label.toLowerCase()}</DropdownMenuItem>}
        {canEdit && !USE_MOCK_DATA && module === 'leads' && !record.contactId && <DropdownMenuItem onSelect={() => setConverting(true)}><UserPlus size={14} />Convert to contact</DropdownMenuItem>}
        {canArchive && <DropdownMenuItem onSelect={() => setArchiving(true)}><Archive size={14} />Archive {label.toLowerCase()}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return <div className="flex h-full min-h-0 min-w-0 flex-col bg-background [--panel-gutter:1rem]">
    <Tabs defaultValue="activity" value={tab} onValueChange={value => { setTab(value); if (value === 'details') setDetailsVisited(true); }} className="flex min-h-0 flex-1 flex-col">
      <header className="@container max-h-[60dvh] shrink-0 overflow-y-auto border-b border-border bg-card p-3 sm:p-4">
        <div className={cn('mx-auto min-w-0', !onClose && 'max-w-[1440px]')}>
        {!onClose && (
          <div className="mb-3">
            <RecordBackButton label={`${label}s`} onClick={() => { if (window.history.length > 1 && new URLSearchParams(window.location.search).get('from') === module) router.back(); else router.push(`/crm/${module}`); }} />
            <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span>CRM</span><ChevronRight size={12} /><Link className="hover:text-[var(--primary)]" href={`/crm/${module}`}>{label}s</Link><ChevronRight size={12} /><span className="min-w-0 [overflow-wrap:anywhere]" aria-current="page">{title}</span>
            </nav>
          </div>
        )}
        <div className="relative flex min-w-0 flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-sm font-semibold text-[var(--primary-foreground)]">{module === 'accounts' ? <Building size={20} /> : module === 'deals' ? title.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() : `${text(record.firstName)[0] || ''}${text(record.lastName)[0] || ''}`}</div>
          <div className="min-w-0 flex-1 basis-[calc(100%-64px)] pr-9 @min-[400px]:basis-0 @min-[400px]:pr-0">
            <div className="mb-1 flex flex-wrap gap-1"><span className="rounded bg-[var(--primary)]/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[var(--primary)]">{label.toUpperCase()}</span>{source && <span className="max-w-full rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground [overflow-wrap:anywhere]">{source}</span>}</div>
            <h1 className="text-base font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-lg">{title}</h1>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</p>}
            {onClose && <Link href={`/crm/${module}/${encodeURIComponent(id)}?from=${module}`} className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-[var(--primary)]">Open full page <ExternalLink size={11} /></Link>}
          </div>
          <div className="ml-[52px] flex min-w-0 max-w-[calc(100%-52px)] items-center gap-1.5 [&>div]:min-w-0 @min-[400px]:ml-0 @min-[400px]:pr-9">
            {manageMenu}
            {module === 'deals' && <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Open messages" title="Open messages" onClick={() => router.push('/inbox')}><Inbox size={16} /></Button></TooltipTrigger><TooltipContent>Open messages</TooltipContent></Tooltip></TooltipProvider>}
            {status && (canEdit ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" disabled={saving} className={cn('min-h-9 min-w-0 max-w-full gap-1 rounded-lg text-xs', getCRMStatusStyles(statusLabel))}><span className="min-w-0 max-w-[90px] truncate @min-[400px]:max-w-[140px]">{statusLabel}</span><ChevronDown size={12} className="shrink-0" /></Button></DropdownMenuTrigger><DropdownMenuContent>{module === 'deals' ? dealStages.map(stage => <DropdownMenuItem key={stage.id} onSelect={() => { if (stage.id === record.stageId) return; if (stage.isLost) { setLostReason(''); setLostStage(stage.id); } else void changeStage(stage.id); }}>{stage.name}</DropdownMenuItem>) : statuses.map(option => <DropdownMenuItem key={option} onSelect={() => void save({ status: option })}>{option}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu> : <span className={cn('rounded-lg px-2 py-1 text-xs', getCRMStatusStyles(statusLabel))}>{statusLabel}</span>)}
            {onClose && <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-9 w-9" onClick={onClose} aria-label="Close record" title="Close record"><X size={16} /></Button>}
          </div>
        </div>
        <RecordQuickInfo items={[
          { value: email, icon: Mail, ...(leadChipActions ? { onClick: () => { if (composeHref) router.push(composeHref); }, ariaLabel: `Compose email to ${email}`, disabled: !composeHref } : { href: email ? `mailto:${email}` : undefined }) },
          { value: phone, icon: Phone, ...(leadChipActions ? { onClick: () => { void copyTextWithFeedback(phone, 'Phone number'); }, ariaLabel: `Copy phone number ${phone}` } : { href: phone ? `tel:${phone}` : undefined }) },
          ...(module === 'deals' ? [{ value: personName(person), icon: User }, { value: company, icon: Building }] : []),
          { value: owner, icon: User, label: 'Agent: ' },
          ...(module === 'accounts' ? [{ value: website, icon: Globe, href: websiteHref }] : []),
          { value: location, icon: MapPin, ...(leadChipActions ? { onClick: () => { void copyTextWithFeedback(location, 'Address'); }, ariaLabel: `Copy address ${location}` } : {}) },
        ]} />
        <div className="mt-4" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
          if (current < 0) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[next].focus(); tabs[next].click();
        }}><TabsList className="grid w-full grid-cols-3 gap-1 overflow-visible bg-muted/70">
          <TabsTrigger value="activity" badge={!activityLoading && !activityError && timeline.activities.length < (module === 'contacts' ? 50 : 100) ? timeline.activities.length : undefined} className="min-w-0 px-1 py-2 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm [&>span]:justify-center [&>span]:gap-1">Activity</TabsTrigger>
          <TabsTrigger value="details" badge={rows.filter(([, value]) => present(value)).length} className="min-w-0 px-1 py-2 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm [&>span]:justify-center [&>span]:gap-1">Details</TabsTrigger>
          <TabsTrigger value="files" className="min-w-0 px-1 py-2 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm [&>span]:justify-center">Files</TabsTrigger>
        </TabsList></div>
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/20">
        <div className={cn('mx-auto w-full min-w-0', !onClose && 'max-w-[1440px]')}>
          <TabsContent value="activity" forceMount className="m-0">
            <RecordTimelineTab compact activities={timeline.activities} module={module} recordId={id} loading={activityLoading} error={activityError} onActivityCreated={refresh}
              tasks={<RecordSection title="Tasks" count={taskCount}><RelatedTasks links={links} onCountChange={setTaskCount} /></RecordSection>} />
          </TabsContent>
          <TabsContent value="details" forceMount className="m-0 p-4"><div className="space-y-3">
            {module === 'deals' && !USE_MOCK_DATA && <DealClosingRequirements dealId={id} canEdit={canEdit} onSaved={() => { for (const key of ['deals', 'leads', 'contacts', 'accounts', 'activities']) invalidatePageCache(key, tenant?.id || user?.tenantId || ''); refresh(); }} />}
            <RecordSection title="About">
              <InlineEditRows rows={aboutRows} canEdit={canEdit && !USE_MOCK_DATA} onSave={saveField} />
            </RecordSection>
            {detailsVisited && relatedQuery.isInitialLoad && <p role="status" className="animate-pulse p-3 text-sm text-muted-foreground">Loading related records…</p>}
            {relatedQuery.error && <div role="alert" className="rounded-xl border border-border p-3 text-sm"><p>{relatedQuery.error}</p><Button variant="ghost" size="sm" onClick={() => void relatedQuery.refetch()}>Retry related records</Button></div>}
            {module === 'deals' && <RecordSection title="Associations">{canReadContacts && <><RelatedRecords records={(record.leadDeals as RecordData[] | undefined)?.map(link => object(link.lead)!).filter(Boolean) ?? []} module="leads" empty="No originating Lead." /><RelatedRecords records={(record.contactDeals as RecordData[] | undefined)?.map(link => object(link.contact)!).filter(Boolean) ?? []} module="contacts" empty="No Contact linked yet." /></>}{canReadAccounts && record.organization != null && <RelatedRecords records={[object(record.organization)!]} module="accounts" empty="" />}</RecordSection>}
            {relationships && <>
              {module === 'accounts' && canReadContacts && <RecordSection title="Contacts" count={(relationships.contacts?.length ?? 0) < 50 ? relationships.contacts?.length : undefined}><RelatedRecords records={relationships.contacts ?? []} module="contacts" empty="No contacts linked to this account." /></RecordSection>}
              {module !== 'deals' && canReadDeals && <RecordSection title="Deals" count={deals.length < 50 ? deals.length : undefined} actions={canCreateDeal && !USE_MOCK_DATA && <Button variant="ghost" size="sm" className="min-h-9 gap-1 text-xs text-[var(--primary)]" onClick={() => setCreatingDeal(true)}><Plus size={13} />Create deal</Button>}>
                <RelatedRecords records={deals} module="deals" empty={`No deals attached to this ${label.toLowerCase()}.`} />
                {deals.length === 50 && <p className="px-3 pb-3 text-xs text-muted-foreground">Showing the latest 50 linked deals.</p>}
                {creatingDeal && <div className="border-t border-border p-3"><InlineDealForm relatedRecord={{ type: module === 'leads' ? 'lead' : module === 'contacts' ? 'contact' : 'account', id }} onError={error => toast.error(error instanceof Error ? error.message : 'Failed to create deal')} onCancel={() => setCreatingDeal(false)} onSubmit={async values => {
                  await apiClient.post('/crm/deals', { title: values.title, productInterestIds: values.productInterestIds, pipelineId: values.pipelineId, stageId: values.stageId, priority: values.priority, expectedCloseDate: values.expectedCloseDate ? new Date(values.expectedCloseDate).toISOString() : undefined, ...(module === 'leads' ? { leadIds: [id] } : module === 'contacts' ? { contactIds: [id] } : { accountId: id }) });
                  setCreatingDeal(false); void relatedQuery.refetch();
                }} /></div>}
              </RecordSection>}
              {module === 'leads' && canReadContacts && <RecordSection title="Converted contact" count={relationships.contact ? 1 : 0}><RelatedRecords records={relationships.contact ? [relationships.contact] : []} module="contacts" empty="Not yet converted to a contact." /></RecordSection>}
              {module !== 'accounts' && canReadAccounts && <RecordSection title={module === 'leads' ? 'Company / Organization' : 'Account / Company'} count={relationships.account ? 1 : 0}><RelatedRecords records={relationships.account ? [relationships.account] : []} module="accounts" empty="No parent company assigned." /></RecordSection>}
              {module === 'contacts' && relationships.sourceLead && canReadContacts && <RecordSection title="Related leads" count={1}><RelatedRecords records={[relationships.sourceLead]} module="leads" empty="" /></RecordSection>}
            </>}

            {customFields && Object.keys(customFields).length > 0 && <RecordSection title="Custom fields" count={Object.keys(customFields).length}><RecordRows rows={Object.entries(customFields)} /></RecordSection>}
          </div></TabsContent>
          <TabsContent value="files" className="m-0">
            <RecordFilesTab files={filesQuery.data ?? []} loading={filesQuery.isInitialLoad} error={filesQuery.error} onRetry={() => void filesQuery.refetch()}
              onUpload={canEdit && !USE_MOCK_DATA ? async file => {
                const query = new URLSearchParams({ name: file.name, type: file.type || 'application/octet-stream' });
                await apiClient.upload(`/crm/${module}/${encodeURIComponent(id)}/files?${query}`, new Blob([file], { type: 'application/octet-stream' }));
                await filesQuery.refetch(); refresh();
              } : undefined} />
          </TabsContent>
        </div>
      </div>
    </Tabs>

    {lostStage && <div role="dialog" aria-modal="true" aria-label="Close Deal as lost" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"><form className="w-full max-w-sm space-y-3 rounded-xl bg-card p-4" onSubmit={e => { e.preventDefault(); void changeStage(lostStage, lostReason); }}><label className="block text-sm">Lost reason<textarea required maxLength={2000} value={lostReason} onChange={e => setLostReason(e.target.value)} className="mt-2 w-full rounded border bg-background p-2" /></label><Button disabled={saving || !lostReason.trim()}>Save</Button><Button type="button" variant="ghost" onClick={() => setLostStage(undefined)}>Cancel</Button></form></div>}
    {converting && <ConvertLeadDialog isOpen lead={formRecord as unknown as Lead} onClose={() => setConverting(false)} onSuccess={refresh} />}
    <ConfirmActionDialog open={archiving} onOpenChange={setArchiving} title={`Archive ${label}`} description={`${title} will be moved to Archived Data.`} warning="You can restore this record later from Settings → Archived Data." confirmLabel="Archive" variant="default" onConfirm={async () => {
      try { await apiClient.patch(`/crm/${module}/${encodeURIComponent(id)}/archive`); toast.success(`${label} archived`); setArchiving(false); if (onClose) onClose(); else router.push(`/crm/${module}`); }
      catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to archive record'); }
    }} />
  </div>;
}

export function CrmRecordPanel({ module, id, open, onOpenChange, onEdit, focusClosing }: { module: CrmRecordModule; id?: string; open: boolean; onOpenChange: (open: boolean) => void; onEdit?: (record: RecordData) => void; focusClosing?: boolean }) {
  const { user } = useAuth();
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent showClose={false} aria-label={`${labels[module]} details`} className="w-full max-w-full sm:max-w-[480px]">
    {open && id && <CrmRecordView key={`${module}:${id}:${user?.id}`} module={module} id={id} onClose={() => onOpenChange(false)} onEdit={onEdit} focusClosing={focusClosing} />}
  </SheetContent></Sheet>;
}
