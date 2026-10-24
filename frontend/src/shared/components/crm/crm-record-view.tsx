'use client';
import { CrmStatusBadge, CustomerStatusMenu } from './crm-status';
import { dealAddressKey, dealAddressMessage, dealCustomerAddressMessage, resolveDealAddress, type DealAddressContext } from '@leadcrm/shared';
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';
import { RecordCustomFieldInlineRow, useRecordCustomFieldDetails } from './record-custom-fields';
import { InlineEditRows, type InlineRowDef } from './inline-edit-rows';
import { useFieldLayout } from '@/shared/hooks/use-field-layout';
import { panelSurfaceClass, panelHeaderClass, panelCloseClass } from '@/shared/components/side-panel-styles';
import { RecordIdentityHeader, RecordQuickInfo, RecordRows, RecordLinkRow } from './record-panel-presentation';

import React, { useEffect, useRef, useState } from 'react';
import { DealClosingRequirements } from './deal-closing-requirements';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Building, ChevronDown, ChevronRight, ExternalLink, Globe, Inbox, Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, User, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { USE_MOCK_DATA } from '@/lib/config';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import type { Lead, Contact } from '@/store/types';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { useRecordRelationships } from '@/shared/hooks/use-record-relationships';
import { useRecordActivities, type RecordActivityFilters, type TimelineActivity } from '@/shared/hooks/use-record-activities';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCrmRecordAccess } from '@/shared/hooks/use-crm-record-access';
import { useReadRecordNotifications } from '@/features/tenant/notifications/hooks/use-record-notifications';
import { showCrmMutationError } from '@/shared/utils/crm-mutation-error';
import { Button } from '@/shared/components/ui/button';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { Dialog, DialogContent } from '@/shared/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/shared/components/ui/dropdown-menu';
import { RecordTimelineTab } from './record-timeline-tab';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { CLOSED_WON_GROUP_ID, CRM_STATUSES, getCrmFieldCatalog, normalizeCrmStatus } from '@leadcrm/shared';
import type { RecordFileMetadata, RecordEmailAttachmentReference, RecordEmailAttachmentsPage } from '@leadcrm/shared';
import { getPageCache, getPageCacheGeneration, invalidatePageCache, requestPageCache } from '@/shared/cache/page-cache';
import { subscribeMailboxEvents } from '@/shared/services/mailbox-events';
import { RecordFilesTab } from './record-files-tab';
import { ConfirmActionDialog } from './confirm-action-dialog';
import { RecordSection } from './record-section';
export { RecordSection } from './record-section';
import { InlineDealForm } from './inline-deal-form';
import { RelatedTasks } from '@/features/tenant/operations/tasks/ui/related-tasks';
import type { Account } from '@/features/tenant/crm/accounts/types/account.types';
import { CrmEmailSchema } from '@leadcrm/shared';
import { DealCardMenu } from './deal-card-menu';
import { duplicateDeal } from '@/shared/services/deals-actions.api';
import { RecordBackButton } from './record-back-button';
import { ConvertLeadDialog } from '@/features/tenant/crm/leads/ui/convert-lead-dialog';
import { recordEmailComposeHref } from '@/features/tenant/inbox/services/compose-navigation';
import { copyTextWithFeedback } from '@/shared/utils/clipboard';
import { canonicalPersonFieldLayout } from '@/shared/utils/canonical-person-field-layout';

export type CrmRecordModule = 'leads' | 'contacts' | 'accounts' | 'deals';
type RecordData = Record<string, unknown>;
interface Relationships {
  hasMoreDeals?: boolean;
  account?: RecordData | null;
  contact?: RecordData | null;
  sourceLead?: RecordData | null;
  contacts?: RecordData[];
  leads?: RecordData[];
  deals?: RecordData[];
  activities?: TimelineActivity[];
}
const labels = { leads: 'Lead', contacts: 'Contact', accounts: 'Account', deals: 'Deal' } as const;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const personName = (record?: RecordData | null) => record ? [text(record.firstName), text(record.lastName)].filter(Boolean).join(' ') : '';
const object = (value: unknown): RecordData | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : undefined;


function RelatedRecords({ records, module, empty, showSubtitle = true }: { records: RecordData[]; module: string; empty: string; showSubtitle?: boolean }) {
  if (module === 'deals') return records.length ? <div className="divide-y divide-border/60">{records.filter(record => !record.isArchived).map(record => <div key={text(record.id)} className="flex min-w-0 items-center gap-2 px-3 py-2"><Link href={'/crm/deals/' + encodeURIComponent(text(record.id))} className="min-w-0 flex-1 py-2 text-sm font-medium [overflow-wrap:anywhere]">{text(record.title)}<span className="mt-1 block text-xs text-muted-foreground">{text(object(record.stage)?.name)}</span></Link><DealCardMenu dealId={text(record.id)} dealTitle={text(record.title)} /></div>)}</div> : <p className="p-4 text-sm text-muted-foreground">{empty}</p>;
  return records.length ? <div className="divide-y divide-border/60">{records.map(record => <RecordLinkRow key={text(record.id)} href={`/crm/${module}/${encodeURIComponent(text(record.id))}`} label={text(record.name) || text(record.title) || personName(record)} subtitle={showSubtitle ? text(record.email) || text(record.industry) || text(object(record.stage)?.name) : undefined} />)}</div> : <p className="px-4 py-7 text-center text-sm text-muted-foreground">{empty}</p>;
}

/** The drawer and route render this same record reader, actions and content. */
export function CrmRecordView({ module, id, onClose, onEdit, focusClosing = false, focusNote = false, initialTab = 'activity' }: { module: CrmRecordModule; id: string; onClose?: () => void; onEdit?: (record: RecordData) => void; focusClosing?: boolean; focusNote?: boolean; initialTab?: 'activity' | 'details' }) {
  const router = useRouter();
  const fieldLayout = useFieldLayout(module);
  const detailLayout = canonicalPersonFieldLayout(fieldLayout.layout);
  const isPerson = module === 'leads' || module === 'contacts';
  const customFields = useRecordCustomFieldDetails(module, id);
  const { user, tenant } = useAuth();
  const data = useData();
  const hasEditPermission = useHasPermission(module === 'deals' ? 'deals.edit' : module === 'accounts' ? 'accounts.edit' : module === 'leads' ? 'leads.edit' : 'contacts.edit');
  const recordAccess = useCrmRecordAccess(module);
  const hasArchivePermission = useHasPermission(module === 'deals' ? 'deals.archive' : module === 'accounts' ? 'accounts.archive' : module === 'leads' ? 'leads.archive' : 'contacts.archive');
  const canCreateDeal = useHasPermission('deals.create');
  const canReadDeals = useHasPermission('deals.view');
  const canReadContacts = useHasPermission('contacts.view');
  const canReadLeads = useHasPermission('leads.view');
  const canReadAccounts = useHasPermission('accounts.view');
  const canEditContacts = useHasPermission('contacts.edit');
  const canEditLeads = useHasPermission('leads.edit');
  const [tab, setTab] = useState<string>(focusClosing ? 'details' : initialTab);
  const [closingAttention, setClosingAttention] = useState(focusClosing);
  const [detailsVisited, setDetailsVisited] = useState(initialTab === 'details' || focusClosing);
  useEffect(() => { if (initialTab === 'details') { setTab('details'); setDetailsVisited(true); } }, [initialTab]);
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
  const [activityFilters, setActivityFilters] = useState<RecordActivityFilters>({});
  const relatedQuery = useRecordRelationships<Relationships>(module, id, module === 'deals' || USE_MOCK_DATA || !detailsVisited || !recordQuery.data);
  const timeline = useRecordActivities(module, id, !!recordQuery.data || USE_MOCK_DATA, undefined, activityFilters);
  const mockRecords = module === 'deals' ? data.deals : module === 'accounts' ? data.organizations : data.contacts;
  const mockRecord = USE_MOCK_DATA ? mockRecords.find(item => item.id === id && item.tenantId === tenant?.id) : undefined;
  const record = USE_MOCK_DATA ? mockRecord as unknown as RecordData : recordQuery.data;
  const primaryContact = (record?.contactDeals as RecordData[] | undefined)?.[0];
  const primaryLead = (record?.leadDeals as RecordData[] | undefined)?.[0];
  const primaryContactId = text(record?.contactId) || text(primaryContact?.contactId) || text(object(primaryContact?.contact)?.id);
  const primaryLeadId = text(record?.leadId) || text(primaryLead?.leadId) || text(object(primaryLead?.lead)?.id);
  const customerModule = primaryContactId ? 'contacts' : 'leads';
  const customerId = primaryContactId || primaryLeadId;
  const customerAccess = useCrmRecordAccess(customerModule);
  const canReadCustomer = customerModule === 'contacts' ? canReadContacts : canReadLeads;
  const customerQuery = useCachedPage<RecordData>({ module: customerModule, params: { recordId: customerId },
    disabled: USE_MOCK_DATA || module !== 'deals' || !customerId || !canReadCustomer,
    revalidateOnInvalidation: true,
    fetchFn: async signal => (await apiClient.get<{ data: RecordData }>(`/crm/${customerModule}/${encodeURIComponent(customerId)}`, { signal })).data });
  const mockCustomer = USE_MOCK_DATA ? data.contacts.find(item => item.id === customerId && item.tenantId === tenant?.id) as unknown as RecordData | undefined : undefined;
  const customerRecord = module === 'deals'
    ? canReadCustomer && USE_MOCK_DATA ? mockCustomer : canReadCustomer && ![401, 403, 404].includes(customerQuery.errorStatus ?? 0) && customerQuery.data?.id === customerId ? customerQuery.data : undefined
    : record;
  const canEditCustomer = module === 'deals'
    ? !!customerRecord && (customerModule === 'contacts' ? canEditContacts : canEditLeads) && customerAccess.canMutate(customerRecord) && !(customerModule === 'leads' && customerRecord.convertedAt)
    : hasEditPermission && recordAccess.canMutate(record) && !(module === 'leads' && record?.convertedAt);
  useReadRecordNotifications(labels[module], id,
    !USE_MOCK_DATA && !!record && !recordQuery.isInitialLoad && !recordQuery.isRefreshing && !recordQuery.error);
  const canEdit = hasEditPermission && recordAccess.canMutate(record);
  const canArchive = hasArchivePermission && recordAccess.canMutate(record, 'canArchive') && !USE_MOCK_DATA;
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
  const fileIdentity = JSON.stringify([module, id, tenant?.id, user?.id, getPageCacheGeneration()]);
  const filesState = useRef({ identity: fileIdentity, query: filesQuery });
  filesState.current = { identity: fileIdentity, query: filesQuery };
  useEffect(() => () => { filesState.current.identity = ''; }, []);
  const [emailRevision, setEmailRevision] = useState(0);
  const emailIdentity = JSON.stringify([module, id, tenant?.id, user?.id, user?.role, getPageCacheGeneration(), emailRevision]);
  const [emailPagination, setEmailPagination] = useState({ identity: emailIdentity, count: 1 });
  const emailPageCount = emailPagination.identity === emailIdentity ? emailPagination.count : 1;
  useEffect(() => {
    if (tab !== 'files') setEmailPagination(current => current.identity === emailIdentity && current.count === 1 ? current : { identity: emailIdentity, count: 1 });
  }, [tab, emailIdentity]);
  const emailContext = module === 'accounts' ? undefined : { recordModule: module, recordId: id };
  const canReadEmailFiles = !!emailContext && !!recordQuery.data && !USE_MOCK_DATA && (canReadLeads || canReadContacts);
  const emailFiles = useCachedPage<RecordEmailAttachmentsPage>({ module: 'record-email-attachments',
    params: { emailIdentity, emailPageCount }, revalidateOnInvalidation: true,
    disabled: !canReadEmailFiles || tab !== 'files',
    fetchFn: async signal => {
      const attachments = new Map<string, RecordEmailAttachmentReference>();
      let cursor: string | undefined, error: string | undefined;
      for (let page = 0; page < emailPageCount; page++) {
        const params = { emailIdentity, cursor, userId: user?.id, role: user?.role };
        const cached = emailPageCount > 1 ? getPageCache<RecordEmailAttachmentsPage>('record-email-attachments', tenant?.id ?? '', params) : null;
        const response = cached && !cached.isStale ? cached.data : await requestPageCache<RecordEmailAttachmentsPage>('record-email-attachments', tenant?.id ?? '', params,
          async requestSignal => (await apiClient.get<{ data: RecordEmailAttachmentsPage }>(`/crm/${module}/${encodeURIComponent(id)}/email-attachments`, { signal: requestSignal, params: { cursor } })).data, signal);
        response.attachments.forEach(file => attachments.set(file.id, file));
        error ||= response.error; cursor = response.nextCursor;
        if (!cursor) break;
      }
      return { attachments: [...attachments.values()], nextCursor: cursor, error };
    },
  });
  const resetEmailAccess = () => {
    invalidatePageCache('record-email-attachments', tenant?.id ?? '', false);
    setEmailRevision(value => value + 1);
  };
  useEffect(() => {
    if (!emailContext || tab !== 'files' || !recordQuery.data || USE_MOCK_DATA || !tenant?.id || !user?.id || !(canReadLeads || canReadContacts)) return;
    const refresh = () => invalidatePageCache('record-email-attachments', tenant.id);
    const subscription = subscribeMailboxEvents(tenant.id, user.id, {
      onChange: refresh, onOpen: refresh,
      onAccessChanged: () => { invalidatePageCache('record-email-attachments', tenant.id, false); setEmailRevision(value => value + 1); },
    });
    return () => subscription.close();
  }, [module, id, tab, !!recordQuery.data, tenant?.id, user?.id, user?.role, canReadLeads, canReadContacts]);
  const emailUnavailable = [401, 403, 404, 409].includes(emailFiles.errorStatus ?? 0);
  const loadedEmailFiles = useRef<{ identity: string; page?: RecordEmailAttachmentsPage }>({ identity: emailIdentity });
  if (loadedEmailFiles.current.identity !== emailIdentity || emailUnavailable || !canReadEmailFiles) loadedEmailFiles.current = { identity: emailIdentity };
  if (canReadEmailFiles && !emailUnavailable && emailFiles.data) loadedEmailFiles.current.page = emailFiles.data;
  const emailPage = loadedEmailFiles.current.page;
  const combinedFiles = [...(filesQuery.data ?? []), ...(emailPage?.attachments ?? []).map(file => ({
    id: file.id, name: file.name || 'Unnamed attachment', type: file.type, size: file.size, uploadedAt: file.sentAt, emailAttachment: file,
  }))].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || b.id.localeCompare(a.id));

  const relationships = relatedQuery.data;
  const label = labels[module];
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
      } else {
        const response = await apiClient.put<{ data: RecordData }>(`/crm/${module}/${encodeURIComponent(id)}`, payload);
        // A committed Workflow can already have advanced this Deal while its
        // original edit response was in flight. Reconcile through the guarded read.
        if (module === 'deals') await recordQuery.refetchSilently();
        else if (response.data) recordQuery.setData(response.data);
      }
      toast.success(`${label} updated`);
    } catch (error) { showCrmMutationError(error, `Failed to update ${label.toLowerCase()}`); }
    finally { setSaving(false); }
  };

  const saveCustomerStatus = async (status: string) => {
    if (saving || !canEditCustomer) return;
    if (module !== 'deals') { await save({ status, ...(record?.updatedAt ? { expectedUpdatedAt: record.updatedAt } : {}) }); return; }
    setSaving(true);
    try {
      const response = await apiClient.put<{ data: RecordData }>(`/crm/${customerModule}/${encodeURIComponent(customerId)}`, { status, ...(customerRecord?.updatedAt ? { expectedUpdatedAt: customerRecord.updatedAt } : {}) });
      customerQuery.setData(response.data);
      await recordQuery.refetchSilently();
      toast.success('Customer status updated');
    } catch (error) { showCrmMutationError(error, 'Unable to update customer status'); }
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
        const addressOption = apiField === 'addressSource' ? addressContext.options.find(option => dealAddressKey(option) === normalized) : undefined;
        const sourceValue = addressOption ? { type: addressOption.type, id: addressOption.id } : null;
        const response = await apiClient.put<{ data: RecordData }>(`/crm/${module}/${encodeURIComponent(id)}`, { [apiField]: apiField === 'addressSource' ? sourceValue : module === 'deals' && ['accountId', 'assignedUserId', 'expectedCloseDate'].includes(apiField) && normalized === '' ? null : apiField === 'expectedCloseDate' && normalized ? new Date(String(normalized)).toISOString() : normalized });
        if (module === 'deals') await recordQuery.refetchSilently();
        else if (response.data) recordQuery.setData(response.data);
      }
      toast.success('Field updated');
    } catch (error) {
      showCrmMutationError(error, 'Failed to update field');
      throw error;
    } finally {
      setSavingField(null);
    }
  };

  if (recordQuery.isInitialLoad) return <div role="status" aria-label={`Loading ${label.toLowerCase()}`} className="relative space-y-4 p-4 animate-pulse">{onClose && <Button variant="ghost" size="icon" className="absolute right-3 top-3" onClick={onClose} aria-label="Close record" title="Close record"><X size={16} /></Button>}<div className="h-12 w-12 rounded-xl bg-muted" /><div className="h-5 w-2/3 rounded bg-muted" /><div className="h-9 rounded-xl bg-muted" /><div className="h-44 rounded-xl bg-muted" /></div>;
  if (!record) return <div className="space-y-4 p-5"><h2 className="font-semibold">Unable to open {label.toLowerCase()}</h2><p role="alert" className="text-sm text-muted-foreground">{recordQuery.error || 'Record not found or access is unavailable.'}</p><Button variant="outline" onClick={() => void recordQuery.refetch()}>Retry</Button>{onClose && <Button variant="ghost" onClick={onClose}>Close</Button>}</div>;

  const title = module === 'deals' ? text(record.title) : module === 'accounts' ? text(record.name) : personName(record);
  const person = module === 'deals' ? object((record.contactDeals as RecordData[] | undefined)?.[0]?.contact) ?? object((record.leadDeals as RecordData[] | undefined)?.[0]?.lead) : record;
  const source = (module === 'deals' ? (record.productInterests as string[] | undefined)?.join(', ') : '') || text(record.source) || text(record.leadSource);
  const owner = personName(object(record.assignedUser)) || 'Unassigned';
  const company = text(object(record.account)?.name) || text(object(record.organization)?.name) || text(person?.companyName) || text(record.companyName) || text(object(record.account)?.name);
  const addressContext = (record.addressContext as DealAddressContext | undefined) ?? resolveDealAddress(text(record.address), record.addressSource, []);
  const location = module === 'deals' ? addressContext.effectiveAddress ?? '' : module === 'accounts' ? text(record.address)
    : [text(record.address), text(record.city), text(record.province), text(record.country)].filter(Boolean).join(', ');
  const personChipActions = module === 'contacts' || (module === 'leads' && !!onClose);
  const email = text(person?.email);
  const phone = text(person?.phone);
  const personInboxAction = module === 'leads' || module === 'contacts';
  const emailChipAction = personInboxAction || module === 'deals';
  const ownsRecordMailbox = !!user?.id && (user.role === 'Client Admin' || record.assignedUserId === user.id);
  // The API projects canonical Product relations into these ID/name arrays.
  const dealProductIds = (record.productInterestIds as string[] | undefined)?.length ? record.productInterestIds as string[] : record.productInterestId ? [text(record.productInterestId)] : [];
  const dealProductNames = record.productInterests as string[] | undefined;
  const dealProductName = text(object(record.productInterestRecord)?.name) || (record.productInterestRecord !== null && dealProductIds.length === 1 && dealProductNames?.length === 1 ? dealProductNames[0] : '');
  const composeHref = emailChipAction || personInboxAction ? recordEmailComposeHref(email, module === 'deals' ? `${dealProductName || 'Product'} Inquiry` : undefined, module === 'deals' ? id : undefined, module === 'leads' || module === 'contacts' ? { recordModule: module, recordId: id } : undefined) : null;
  const composeDisabled = !composeHref && (!personInboxAction || ownsRecordMailbox);
  const openRecordEmail = () => {
    if (personInboxAction && !ownsRecordMailbox) {
      toast.error(`You cannot email this ${module === 'leads' ? 'lead' : 'contact'} because it is not assigned to you.`);
      return;
    }
    if (composeHref) router.push(composeHref);
  };
  const openDealEmail = () => {
    if (!ownsRecordMailbox) {
      toast.error('You cannot email this deal because it is not assigned to you.');
      return;
    }
    if (!composeHref) {
      toast.error('No valid email address available.');
      return;
    }
    router.push(composeHref);
  };
  const subtitle = module === 'deals' ? `₱${Number(record.value ?? 0).toLocaleString()} · ${text(object(record.pipeline)?.name)}` : module === 'accounts' ? text(record.industry) || text(record.website) : company || (module === 'leads' ? text(record.jobTitle) : '') || location;
  const rawStatus = text(module === 'deals' ? object(record.stage)?.name : module === 'accounts' ? '' : record.status);
  const status = module === 'leads' || module === 'contacts' ? normalizeCrmStatus(rawStatus) : rawStatus;
  const statusLabel = status === status.toUpperCase() ? status.charAt(0) + status.slice(1).toLowerCase() : status;
  const dealStages = data.pipelines.find(p => p.id === record.pipelineId)?.stages ?? [];
  const changeStage = async (stageId: string, reason?: string) => {
    setSaving(true);
    try { await data.moveDealStage(id, stageId, undefined, reason); setLostStage(undefined); }
    catch (error) { showCrmMutationError(error, 'Unable to move Deal'); }
    finally { setSaving(false); }
  };
  const statusManaged = !!record.statusManagedByDeals;
  const statuses = statusManaged ? record.manualCancellation ? ['Inquiry'] : ['Cancelled'] : [...CRM_STATUSES];
  const productIds = (record.productInterestIds as string[] | undefined)?.length ? record.productInterestIds as string[] : record.productInterestId ? [text(record.productInterestId)] : [];
  const productNames = (record.productInterest ?? record.productInterests ?? []) as string[];
  const productRow: InlineRowDef = { technicalKey: 'productInterestIds', label: 'Product interests', value: module === 'leads' || module === 'deals' ? productIds : productNames, displayValue: productNames, apiField: module === 'leads' ? 'productInterest' : module === 'deals' ? undefined : 'productInterests', type: 'products', showUncategorized: false, valueMode: module === 'leads' || module === 'deals' ? 'id' : 'name', productLabels: Object.fromEntries(productIds.map((id, i) => [id, productNames[i] ?? 'Unavailable product'])) };
  const aboutRows: InlineRowDef[] = module === 'deals' ? [
    { label: 'Deal title', value: title, apiField: 'title' },
    { technicalKey: 'value', label: 'Deal value', value: subtitle.split(' · ')[0] },
    productRow,
    { label: 'Priority', value: record.priority, apiField: 'priority', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'] },
    { label: 'Expected close date', value: text(record.expectedCloseDate).slice(0, 10), apiField: 'expectedCloseDate', type: 'date' },
    { technicalKey: 'pipelineId', label: 'Pipeline', value: object(record.pipeline)?.name },
    { technicalKey: 'stageId', label: 'Stage', value: statusLabel },
    ...(canReadAccounts ? [{ technicalKey: 'accountId', label: 'Account', value: object(record.organization)?.name ?? object(record.account)?.name }] : []),
    { label: 'Assigned Agent', value: record.assignedUserId, displayValue: owner, apiField: 'assignedUserId', type: 'users' },
    { label: 'Source', value: record.leadSource, apiField: 'leadSource' },
    { label: 'Deal Address (override)', value: record.address, apiField: 'address', type: 'textarea' },
    { technicalKey: 'createdAt', label: 'Created', value: record.createdAt, displayValue: formatDateTime(record.createdAt as string | null | undefined) },
  ] : [
    ...(module === 'accounts' ? [
      { label: 'Account name', value: record.name, apiField: 'name', required: true, maxLength: 255 },
      { label: 'Industry', value: record.industry, apiField: 'industry' },
      { label: 'Company size', value: record.size, apiField: 'size', type: 'select' as const, options: ['1-10', '11-50', '51-200', '200+'] },
      { label: 'Website', value: record.website, apiField: 'website', type: 'url' as const },
    ] : [
      { label: 'First name', value: record.firstName, apiField: 'firstName', required: true },
      { label: 'Last name', value: record.lastName, apiField: 'lastName', required: true },
      { label: 'Email', value: record.email, apiField: 'email', type: 'email' as const },
      { label: 'Phone', value: record.phone, apiField: 'phone', type: 'tel' as const },
      { label: 'Company', value: record.companyName, apiField: 'companyName' },
      ...(canReadAccounts ? [{ technicalKey: 'accountId', label: 'Account', value: object(record.account)?.name ?? object(record.organization)?.name }] : []),
      { label: 'Source', value: source, apiField: 'source' },
    ]),
    { label: 'Address', value: record.address, apiField: 'address' },
    productRow,
    ...(module === 'accounts' ? [] : [{ label: 'Status', value: statusLabel, apiField: statusManaged ? undefined : 'status', type: 'select' as const, options: statuses }]),
    ...(module === 'accounts' ? [] : [{ technicalKey: 'assignedUserId', label: 'Assigned Agent', value: record.assignedUserId, displayValue: owner, apiField: 'assignedUserId', type: 'users' as const }]),
    ...(module === 'leads' || module === 'accounts' ? [] : [{ label: 'Notes', value: record.notes, apiField: 'notes', type: 'textarea' as const }]),
    { technicalKey: 'createdAt', label: 'Created', value: record.createdAt, displayValue: formatDateTime(record.createdAt as string | null | undefined) },
  ];
  // Saved retired values remain readable; closing evidence uses its specialized component.
  const catalog = getCrmFieldCatalog(module, customFields.fields.map(field => ({ ...field, deletedAt: undefined })), detailLayout);
  const accountField = catalog.find(field => field.technicalKey === 'accountId');
  const showAccount = canReadAccounts && accountField?.visibleInDetails !== false;
  const linkedAccount = showAccount ? object(record.account) ?? object(record.organization) ?? relationships?.account : null;
  const configuredRows = aboutRows.filter(row => row.technicalKey !== 'accountId')
    .map(row => ({ row, field: catalog.find(field => field.technicalKey === (row.technicalKey ?? row.apiField)) })).filter(item => item.field?.visibleInDetails !== false);
  const relationshipGroupId = accountField?.groupId ?? `${module}:section:${module === 'deals' ? 1 : 2}`;
  const relationshipContent = module === 'deals' ? <div className="divide-y divide-border">
    {canReadLeads && <div><h3 className="px-3 pt-3 text-xs font-semibold text-muted-foreground">Leads</h3><RelatedRecords records={(record.leadDeals as RecordData[] | undefined)?.map(link => object(link.lead)!).filter(Boolean) ?? []} module="leads" empty="No originating Lead." /></div>}
    {canReadContacts && <div><h3 className="px-3 pt-3 text-xs font-semibold text-muted-foreground">Contacts</h3><RelatedRecords records={(record.contactDeals as RecordData[] | undefined)?.map(link => object(link.contact)!).filter(Boolean) ?? []} module="contacts" empty="No Contact linked yet." /></div>}
    {showAccount && <div><h3 className="px-3 pt-3 text-xs font-semibold text-muted-foreground">Account</h3><RelatedRecords records={linkedAccount ? [linkedAccount] : []} module="accounts" empty="No Account linked yet." showSubtitle={false} /></div>}
  </div> : (module === 'leads' || module === 'contacts') && showAccount ? <div>
    <h3 className="px-3 pt-3 text-xs font-semibold text-muted-foreground">Account</h3>
    <RelatedRecords records={linkedAccount ? [linkedAccount] : []} module="accounts" empty="No Account linked yet." showSubtitle={false} />
    {linkedAccount && <RecordRows rows={[["Company Address", linkedAccount.address], ["Industry", linkedAccount.industry], ["Size", linkedAccount.size], ["Website", linkedAccount.website]]} />}
  </div> : null;
  const showRelationships = module === 'deals' ? canReadLeads || canReadContacts || showAccount : isPerson &&
    (showAccount || Boolean(relationships && canReadDeals) || Boolean(module === 'contacts' && relationships?.sourceLead && canReadLeads));
  const detailGroups = [...detailLayout.groups].sort((a, b) => a.order - b.order).filter(group => group.id !== CLOSED_WON_GROUP_ID).map(group => ({ group,
    fields: catalog.filter(field => field.groupId === group.id && field.visibleInDetails && (field.customFieldId ? !USE_MOCK_DATA : configuredRows.some(item => item.field?.technicalKey === field.technicalKey))),
    relationships: group.id === relationshipGroupId && showRelationships,
  })).filter(group => group.fields.length || group.relationships);
  const detailCount = detailGroups.reduce((count, group) => count + group.fields.length + (group.relationships ? module === 'deals'
    ? (canReadLeads ? ((record.leadDeals as unknown[])?.length ?? 0) : 0) + (canReadContacts ? ((record.contactDeals as unknown[])?.length ?? 0) : 0) + (linkedAccount ? 1 : 0)
    : linkedAccount ? 1 : 0 : 0), 0);

  const mockCustomFields = object(record.customFields);
  const deals = (relationships?.deals ?? []).filter(deal => !isPerson || !deal.isArchived);
  const dealCount = (relationships?.deals?.length ?? 0) < 50 ? deals.length : undefined;
  const links = module === 'deals' ? { dealId: id } : module === 'leads' ? { leadId: id } : module === 'contacts' ? { contactId: id } : { accountId: id };
  const activityLoading = timeline.isInitialLoad;
  const activityError = timeline.error;
  const formRecord = { ...record, companyName: company, leadSource: source, organizationId: record.accountId, productInterests: record.productInterest ?? record.productInterests, status: status, statusManagedByDeals: statusManaged, manualCancellation: record.manualCancellation };
  const website = text(record.website);
  const websiteHref = website && !/^[a-z][a-z0-9+.-]*:/i.test(website) ? `https://${website}` : /^https?:\/\//i.test(website) ? website : undefined;

  const dealActions = canCreateDeal && !USE_MOCK_DATA && <Button variant="ghost" size="sm" className="min-h-9 gap-1 text-xs text-[var(--primary)]" onClick={() => setCreatingDeal(true)}><Plus size={13} />Create deal</Button>;
  const dealContent = <>
    <RelatedRecords records={deals} module="deals" empty={`No deals attached to this ${label.toLowerCase()}.`} />
    {relationships?.hasMoreDeals && <Button variant="ghost" size="sm" onClick={relatedQuery.loadMore} disabled={relatedQuery.isRefreshing}>Load older deals</Button>}
    {creatingDeal && <div className="border-t border-border p-3"><InlineDealForm relatedRecord={{ type: module === 'leads' ? 'lead' : module === 'contacts' ? 'contact' : 'account', id }} onError={error => toast.error(error instanceof Error ? error.message : 'Failed to create deal')} onCancel={() => setCreatingDeal(false)} onSubmit={async values => {
      await apiClient.post('/crm/deals', { address: values.address, addressSource: values.addressSource, customFieldValues: values.customFieldValues, title: values.title, productInterestIds: values.productInterestIds, pipelineId: values.pipelineId, stageId: values.stageId, priority: values.priority, expectedCloseDate: values.expectedCloseDate ? new Date(values.expectedCloseDate).toISOString() : undefined, ...(values.leadId ? { leadIds: [values.leadId] } : { contactIds: [values.contactId!] }) });
      setCreatingDeal(false);
    }} /></div>}
  </>;

  const manageMenu = (canEdit || canArchive) && (
    <DropdownMenu>
      <TooltipProvider><Tooltip><DropdownMenuTrigger asChild><TooltipTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Record actions" title="Record actions">
          <MoreHorizontal size={16} />
        </Button>
      </TooltipTrigger></DropdownMenuTrigger><TooltipContent>Record actions</TooltipContent></Tooltip></TooltipProvider>
      <DropdownMenuContent align="end">
        {canEdit && <DropdownMenuItem onSelect={edit}><Pencil size={14} />Edit {label.toLowerCase()}</DropdownMenuItem>}
        {module === 'deals' && canCreateDeal && !USE_MOCK_DATA && <DropdownMenuItem onSelect={() => { void duplicateDeal(id).then(next => router.push('/crm/deals/' + next.id)).catch(() => {}); }}>Duplicate deal</DropdownMenuItem>}
        {canEdit && !USE_MOCK_DATA && module === 'leads' && !record.contactId && <DropdownMenuItem onSelect={() => setConverting(true)}><UserPlus size={14} />Convert to contact</DropdownMenuItem>}
        {canArchive && <DropdownMenuItem onSelect={() => setArchiving(true)}><Archive size={14} />Archive {label.toLowerCase()}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return <div className={cn('flex h-full min-h-0 min-w-0 flex-col [--panel-gutter:1rem]', onClose ? 'bg-white dark:bg-slate-900 sm:[--panel-gutter:1.5rem]' : 'bg-background')}>
    <Tabs defaultValue="activity" value={tab} onValueChange={value => { setTab(value); if (value === 'details') setDetailsVisited(true); }} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('@container max-h-[60dvh] shrink-0 overflow-y-auto', onClose ? panelHeaderClass : 'border-b border-border bg-card p-3 sm:p-4')}>
        <div className={cn('mx-auto min-w-0', !onClose && 'max-w-[1440px]')}>
        {!onClose && (
          <div className="mb-3">
            <RecordBackButton label={`${label}s`} onClick={() => { if (window.history.length > 1 && new URLSearchParams(window.location.search).get('from') === module) router.back(); else router.push(`/crm/${module}`); }} />
            <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span>CRM</span><ChevronRight size={12} /><Link className="hover:text-[var(--primary)]" href={`/crm/${module}`}>{label}s</Link><ChevronRight size={12} /><span className="min-w-0 [overflow-wrap:anywhere]" aria-current="page">{title}</span>
            </nav>
          </div>
        )}
        <RecordIdentityHeader
          avatar={module === 'accounts' ? <Building size={20} /> : module === 'deals' ? title.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() : `${text(record.firstName)[0] || ''}${text(record.lastName)[0] || ''}`}
          label={label} title={title} subtitle={subtitle} panel={!!onClose}
          badges={source && <span className="max-w-full rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground [overflow-wrap:anywhere]">{source}</span>}
          titleAction={onClose && <Link href={`/crm/${module}/${encodeURIComponent(id)}?from=${module}`} className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-[var(--primary)]">Open full page <ExternalLink size={11} /></Link>}
          actions={<>
            {manageMenu}
            {module !== 'accounts' && <TooltipProvider><Tooltip>
              <TooltipTrigger asChild><span tabIndex={personInboxAction && composeDisabled ? 0 : undefined}>
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Open messages"
                  title={personInboxAction && composeDisabled ? 'No valid email address available.' : 'Open messages'}
                  disabled={personInboxAction && composeDisabled}
                  onClick={module === 'deals' ? openDealEmail : () => { if (personInboxAction) openRecordEmail(); else router.push('/inbox'); }}>
                  <Inbox size={16} />
                </Button>
              </span></TooltipTrigger>
              <TooltipContent>{personInboxAction && composeDisabled ? 'No valid email address available.' : 'Open messages'}</TooltipContent>
            </Tooltip></TooltipProvider>}
            {module !== 'accounts' && <CustomerStatusMenu status={text(customerRecord?.status)} managed={!!customerRecord?.statusManagedByDeals} manuallyCancelled={!!customerRecord?.manualCancellation}
              restrictions={customerRecord?.statusEditRestrictions as Record<string, string> | undefined} options={Array.isArray(customerRecord?.statusEditOptions) ? customerRecord.statusEditOptions as string[] : undefined} canEdit={canEditCustomer} busy={saving} label={module === 'deals' ? 'Customer Status' : undefined} onChange={saveCustomerStatus} />}
            {onClose && <Button variant="ghost" size="icon" className={panelCloseClass + " absolute -right-1 -top-1"} onClick={onClose} aria-label="Close record" title="Close record"><X size={16} /></Button>}
          </>}
        />
        <RecordQuickInfo items={[
          { value: email || (module === 'deals' ? 'No email address is available for this Deal.' : ''), icon: Mail, ...(emailChipAction ? { onClick: module === 'deals' ? openDealEmail : openRecordEmail, ariaLabel: email ? `Compose email to ${email}` : 'No email address is available for this Deal.', disabled: module !== 'deals' && composeDisabled } : { href: email ? `mailto:${email}` : undefined }) },
          { value: phone, icon: Phone, ...(personChipActions ? { onClick: () => { void copyTextWithFeedback(phone, 'Phone number'); }, ariaLabel: `Copy phone number ${phone}` } : { href: phone ? `tel:${phone}` : undefined }) },
          ...(module === 'deals' ? [{ value: personName(person), icon: User }, { value: company, icon: Building }] : []),
          ...(module === 'accounts' ? [] : [{ value: owner, icon: User, label: 'Agent: ' }]),
          ...(module === 'accounts' ? [{ value: website, icon: Globe, href: websiteHref }] : []),
          { value: location, icon: MapPin, ...(personChipActions ? { onClick: () => { void copyTextWithFeedback(location, 'Address'); }, ariaLabel: `Copy address ${location}` } : {}) },
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
          <TabsTrigger value="activity" badge={timeline.total} className="min-w-0 px-1 py-2 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm [&>span]:justify-center [&>span]:gap-1">Activity</TabsTrigger>
          <TabsTrigger value="details" badge={detailCount} className="min-w-0 px-1 py-2 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm [&>span]:justify-center [&>span]:gap-1">Details</TabsTrigger>
          <TabsTrigger value="files" className="min-w-0 px-1 py-2 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm [&>span]:justify-center">Files</TabsTrigger>
        </TabsList></div>
        </div>
      </header>
      <div data-record-scroll className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain', onClose ? 'bg-white dark:bg-slate-900' : 'bg-muted/20')}>
        <div className={cn('mx-auto w-full min-w-0', !onClose && 'max-w-[1440px]')}>
          <TabsContent value="activity" forceMount className={cn('m-0', onClose && '[&>div]:px-[var(--panel-gutter)]')}>
            <RecordTimelineTab compact focusNote={focusNote && tab === 'activity'} activities={timeline.activities} module={module} recordId={id} loading={activityLoading} error={activityError} hasMore={timeline.hasMore} onLoadMore={timeline.loadMore} onFiltersChange={setActivityFilters} onRetry={() => void timeline.refetch()}
              canEditRecord={canEdit} tasks={<RecordSection title="Tasks" count={taskCount}><RelatedTasks links={links} onCountChange={setTaskCount} allowCreate={module === "deals" && recordAccess.canMutate(record)} readOnly={module !== "deals"} /></RecordSection>} />
          </TabsContent>
          <TabsContent value="details" forceMount className={cn('m-0 p-4', onClose && 'px-[var(--panel-gutter)]')}><div className="space-y-3">
            {module === 'deals' && !USE_MOCK_DATA && <DealClosingRequirements focusRequested={closingAttention} dealId={id} canEdit={canEdit} />}
            {module === 'deals' && <InlineEditRows canEdit={false} onSave={saveField} rows={[{ label: 'Deal Engagement', value: record.engagementStatus, alwaysVisible: true, renderValue: () => <CrmStatusBadge status={text(record.engagementStatus)} /> }]} />}
            {!USE_MOCK_DATA && customFields.query.error && <div role="alert" className="text-xs text-destructive">{customFields.query.error}<Button variant="ghost" size="sm" onClick={() => void customFields.query.refetch()}>Retry custom fields</Button></div>}
            {detailGroups.map(({ group, fields, relationships: hasRelationships }) => <RecordSection key={group.id} title={group.label}>
              {hasRelationships && !isPerson && relationshipContent}
              {fields.map(field => {
                if (field.customFieldId) return !USE_MOCK_DATA && <RecordCustomFieldInlineRow key={field.customFieldId} details={customFields} fieldId={field.customFieldId} canEdit={canEdit} />;
                const row = configuredRows.find(item => item.field?.technicalKey === field.technicalKey)?.row;
                return row ? <InlineEditRows key={field.technicalKey} rows={[...(module === 'deals' && field.technicalKey === 'address' ? [{
                  label: 'Customer Address', apiField: 'addressSource', alwaysVisible: true,
                  value: record.addressSource ? dealAddressKey(record.addressSource as import('@leadcrm/shared').DealAddressSource) : '',
                  displayValue: dealCustomerAddressMessage(addressContext),
                  renderValue: () => <span className="block whitespace-pre-wrap break-words">{dealCustomerAddressMessage(addressContext)}<span className="block text-xs text-muted-foreground">{addressContext.options.find(option => option.type === addressContext.source?.type && option.id === addressContext.source?.id)?.label}</span></span>,
                  renderEditor: ({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) => <select aria-label="Customer Address" className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1 text-xs" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Automatic / choose later</option>{value && !addressContext.options.some(option => dealAddressKey(option) === value) && <option value={value}>Selected address unavailable</option>}{addressContext.options.map(option => <option key={dealAddressKey(option)} value={dealAddressKey(option)}>{option.label}</option>)}</select>,
                }] : []), { ...row, label: field.label, alwaysVisible: field.technicalKey === 'address', apiField: row.apiField === 'assignedUserId' && !(recordAccess.canReassignRecord?.(record) ?? recordAccess.canReassign) ? undefined : row.apiField }]} canEdit={canEdit && !USE_MOCK_DATA} onSave={saveField} /> : null;
              })}
              {hasRelationships && isPerson && <>
                {relationshipContent}
                {relationships && canReadDeals && <div className="border-t border-border/60">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-1 px-3 pt-2"><h3 className="text-xs font-semibold text-muted-foreground">Deals{dealCount !== undefined && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{dealCount}</span>}</h3>{dealActions}</div>
                  {dealContent}
                </div>}
                {module === 'contacts' && relationships?.sourceLead && canReadLeads && <div className="border-t border-border/60">
                  <h3 className="px-3 pt-3 text-xs font-semibold text-muted-foreground">Related Leads<span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">1</span></h3>
                  <RelatedRecords records={[relationships.sourceLead]} module="leads" empty="" />
                </div>}
              </>}
            </RecordSection>)}
            {detailsVisited && relatedQuery.isInitialLoad && <p role="status" className="animate-pulse p-3 text-sm text-muted-foreground">Loading related records…</p>}
            {relatedQuery.error && <div role="alert" className="rounded-xl border border-border p-3 text-sm"><p>{relatedQuery.error}</p><Button variant="ghost" size="sm" onClick={() => void relatedQuery.refetch()}>Retry related records</Button></div>}

            {relationships && <>
              {module === 'accounts' && canReadContacts && <RecordSection title="Contacts" count={(relationships.contacts?.length ?? 0) < 50 ? relationships.contacts?.length : undefined}><RelatedRecords records={relationships.contacts ?? []} module="contacts" empty="No contacts linked to this account." /></RecordSection>}
              {module === 'accounts' && canReadDeals && <RecordSection title="Deals" count={dealCount} actions={dealActions}>{dealContent}</RecordSection>}
            </>}

            {USE_MOCK_DATA && mockCustomFields && Object.keys(mockCustomFields).length > 0 && <RecordSection title="Custom fields" count={Object.keys(mockCustomFields).length}><RecordRows rows={Object.entries(mockCustomFields)} /></RecordSection>}
          </div></TabsContent>
          <TabsContent value="files" className={cn('m-0', onClose && '[&>div]:px-[var(--panel-gutter)]')}>
            <RecordFilesTab files={combinedFiles} loading={filesQuery.isInitialLoad || emailFiles.isInitialLoad && !emailPage}
              restrictFormats={module !== 'accounts'}
              error={filesQuery.error || emailFiles.error || emailPage?.error}
              onRetry={() => { void filesQuery.refetch(); resetEmailAccess(); }} emailContext={emailContext}
              attachmentAccessKey={emailIdentity + ':' + emailUnavailable + ':' + canReadEmailFiles} onEmailUnavailable={resetEmailAccess}
              hasMore={!!emailPage?.nextCursor} loadingMore={emailFiles.isInitialLoad || emailFiles.isRefreshing}
              onLoadMore={() => setEmailPagination({ identity: emailIdentity, count: emailPageCount + 1 })}
              onUpload={canEdit && !USE_MOCK_DATA ? async file => {
                const generation = getPageCacheGeneration();
                const query = new URLSearchParams({ name: file.name, type: file.type || 'application/octet-stream' });
                const saved = await apiClient.upload<{ data: RecordFileMetadata }>(`/crm/${module}/${encodeURIComponent(id)}/files?${query}`, new Blob([file], { type: 'application/octet-stream' }));
                if (filesState.current.identity === fileIdentity && getPageCacheGeneration() === generation) {
                  const current = filesState.current.query;
                  current.setData([saved.data, ...(current.data ?? []).filter(existing => existing.id !== saved.data.id)]);
                }
              } : undefined} />
          </TabsContent>
        </div>
      </div>
    </Tabs>

    <Dialog open={Boolean(lostStage)} onOpenChange={open => { if (!open && !saving) setLostStage(undefined); }}>
      <DialogContent showClose={false} aria-label="Cancel Deal" className="max-w-sm">
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (lostStage && !saving) void changeStage(lostStage, lostReason); }}>
          <label className="block text-sm">Reason for Cancellation<textarea required maxLength={2000} value={lostReason} onChange={e => setLostReason(e.target.value)} className="mt-2 w-full rounded border bg-background p-2" /></label>
          <div className="flex flex-wrap gap-2"><Button disabled={saving || !lostReason.trim()}>Save</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => setLostStage(undefined)}>Cancel</Button></div>
        </form>
      </DialogContent>
    </Dialog>
    {converting && <ConvertLeadDialog isOpen lead={formRecord as unknown as Lead} onClose={() => setConverting(false)} onSuccess={() => setConverting(false)} />}
    <ConfirmActionDialog open={archiving} onOpenChange={setArchiving} title={`Archive ${label}`} description={`${title} will be moved to Archived Data.`} warning="You can restore this record later from Settings → Archived Data." confirmLabel="Archive" variant="destructive" onConfirm={async () => {
      try { await apiClient.patch(`/crm/${module}/${encodeURIComponent(id)}/archive`); toast.success(`${label} archived`); setArchiving(false); if (onClose) onClose(); else router.push(`/crm/${module}`); }
      catch (error) { throw error instanceof Error ? error : new Error('Failed to archive record'); }
    }} />
  </div>;
}

export function CrmRecordPanel({ module, id, open, onOpenChange, onEdit, focusClosing, focusNote, initialTab }: { module: CrmRecordModule; id?: string; open: boolean; onOpenChange: (open: boolean) => void; onEdit?: (record: RecordData) => void; focusClosing?: boolean; focusNote?: boolean; initialTab?: 'activity' | 'details' }) {
  const { user } = useAuth();
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent showClose={false} aria-label={`${labels[module]} details`} className={panelSurfaceClass}>
    {open && id && <CrmRecordView key={`${module}:${id}:${user?.id}`} module={module} id={id} onClose={() => onOpenChange(false)} onEdit={onEdit} focusClosing={focusClosing} focusNote={focusNote} initialTab={initialTab} />}
  </SheetContent></Sheet>;
}
