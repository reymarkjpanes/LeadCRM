'use client';
import { mapCampaignTextLinks, smsCampaignTrackingUrl, SMS_DEFAULT_FOOTER } from '@leadcrm/shared';
import { SmsFooterControl } from '@/shared/components/sms-footer-control';
import { insertVariableAtSelection } from '@/shared/utils/insert-variable';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAVIGATION_INTENT_EVENT, requestNavigation, type NavigationAction, type NavigationIntentEvent } from '@/shared/lib/navigation-intent';
import { CampaignDraftSchema, CampaignScheduleSchema, CampaignSendSchema, campaignApprovedVariableKeys, campaignVariableChoices, campaignVariableKeys, renderEmailVariables, buildFinalSms, smsMessageStats, SMS_MAX_LENGTH, type SavedAudience, type CampaignEmailSettings, type CampaignSmsSettings } from '@leadcrm/shared';
import { CampaignVariablePicker, useCampaignVariableFields, campaignSampleValues } from './campaign-variable-picker';
import { SmsMessageContent } from './sms-message-content';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { audiencesApi } from '@/shared/services/audiences.api';
import { AudiencePanel, FieldError } from './audience-panel';
import type { Campaign } from '@/store/types';
import type { AudiencePreviewResult } from '@leadcrm/shared';
import { PaginationControls } from '@/shared/components/crm/pagination-controls';
import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { renderCampaignPreview, prepareCampaignBody } from '../services/campaign-html';
import { useTheme } from '@/shared/hooks/use-theme';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { Button } from '@/shared/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/shared/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/shared/components/ui/dialog';
import { ManilaDateTimePicker } from '@/shared/components/ui/manila-date-time-picker';
import { manilaLocalDateTime, manilaTaskDueInstant } from '@/lib/manila-time';
import { toast } from 'sonner';
import { useAuth } from '@/store/AuthContext';
import { trackSmsCampaignSubmission } from '@/features/tenant/notifications/hooks/notification-requests';
import {
  ArrowLeft, Send, Mail, MessageSquare, Plus,
  Wand2, Monitor, Smartphone, Zap, Tags,
  PanelRight, X, ChevronDown, CalendarClock,
} from 'lucide-react';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { campaignsApi } from '@/shared/services/campaigns.api';

type CampaignType = 'Email' | 'SMS' | 'Multi-Channel';
type SaveIntent = 'draft' | 'send' | 'schedule';

function campaignScheduleInstant(value: string): string {
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error();
    const instant = manilaTaskDueInstant(value);
    if (CampaignScheduleSchema.safeParse({ scheduledFor: instant }).success) return instant;
  } catch { /* Invalid calendar values and elapsed instants share the same message. */ }
  throw new Error('Choose a valid future date and time in Asia/Manila.');
}

interface CampaignBuilderProps {
  onBack: () => void;
  initialCampaign?: Campaign;
  initialSubject?: string;
  canSend?: boolean;
  initialType?: string;
  initialContent?: string;

}

export function CampaignBuilder({
  onBack,
  initialCampaign,
  initialSubject,
  canSend = true,
  initialType,
  initialContent,

}: CampaignBuilderProps) {
  const { tenant, user } = useAuth();
  const router = useRouter();

  const maySend = useHasPermission('campaigns.send') && canSend;
  const canCreate = useHasPermission('campaigns.create'), canEdit = useHasPermission('campaigns.edit');
  const canWrite = initialCampaign ? canEdit && initialCampaign.status.toLowerCase() === 'draft' : canCreate;
  const [campaignName, setCampaignName] = useState(initialCampaign?.name || '');
  const [campaignType, setCampaignType] = useState<CampaignType>(() => {
    const type = (initialCampaign?.type ?? initialType ?? 'Email').toLowerCase();
    return type === 'sms' ? 'SMS' : ['multi-channel', 'multi_channel'].includes(type) ? 'Multi-Channel' : 'Email';
  });
  const scheduled = initialCampaign?.status.toLowerCase() === 'scheduled';
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleSession, setScheduleSession] = useState(0);
  const [scheduledTime, setScheduledTime] = useState(initialCampaign?.scheduledFor ? manilaLocalDateTime(initialCampaign.scheduledFor) : '');
  const [targetAudience, setTargetAudience] = useState(initialCampaign?.targetAudienceId || initialCampaign?.audienceSource || '');
  const [messageBodies, setMessageBodies] = useState<Record<CampaignType, string>>(() => {
    const content = initialCampaign ? initialCampaign.body ?? '' : initialContent;
    return {
      Email: campaignType === 'Email' ? content ?? '' : '',
      SMS: campaignType === 'SMS' ? content ?? SMS_DEFAULT_FOOTER : SMS_DEFAULT_FOOTER,
      'Multi-Channel': campaignType === 'Multi-Channel' ? content ?? '' : '',
    };
  });
  const messageContent = messageBodies[campaignType];
  const setMessageContent = (value: string) => setMessageBodies(previous => ({ ...previous, [campaignType]: value }));
  const [emailSubject, setEmailSubject] = useState(initialCampaign?.subject || initialSubject || '');
  const draftSnapshot = JSON.stringify({ campaignName, campaignType, targetAudience, emailSubject, messageBodies });
  const [savedSnapshot, setSavedSnapshot] = useState(draftSnapshot);
  const dirty = draftSnapshot !== savedSnapshot;
  const [exit, setExit] = useState<NavigationAction | null>(null);
  const leaving = useRef(false), exitPending = useRef(false);
  const guardState = useRef({ dirty });
  guardState.current = { dirty };
  useEffect(() => { leaving.current = false; }, [draftSnapshot]);
  function leaveBuilder() {
    leaving.current = true; exitPending.current = false; setExit(null); onBack();
  }
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  useEffect(() => {
    const intent = (event: Event) => {
      if (leaving.current || !guardState.current.dirty) return;
      event.preventDefault();
      if (exitPending.current) return;
      exitPending.current = true;
      setExit(() => (event as NavigationIntentEvent).detail.navigate);
    };
    const link = (event: MouseEvent) => {
      if (leaving.current || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      // The inline builder shares the list URL. Preserve this button's list exit
      // before replaying the sidebar action, including its mobile close behavior.
      const control = target.closest('nav[aria-label="Workspace"] button[aria-label="Campaigns"]');
      if (control instanceof HTMLButtonElement && !control.disabled && ['/campaigns', '/marketing/campaigns'].includes(window.location.pathname)) {
        event.preventDefault(); event.stopPropagation();
        requestNavigation(() => { leaving.current = true; onBack(); control.click(); });
        return;
      }
      if (!guardState.current.dirty) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href), current = window.location;
      if (destination.origin !== current.origin || (destination.pathname === current.pathname && destination.search === current.search)) return;
      event.preventDefault(); event.stopPropagation();
      requestNavigation(() => router.push(destination.pathname + destination.search + destination.hash));
    };
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    const traverse = (event: Event) => {
      const entry = event as Event & { navigationType?: string; destination?: { url: string } };
      if (!guardState.current.dirty || leaving.current || !entry.cancelable || entry.navigationType !== 'traverse' || !entry.destination || entry.destination.url === window.location.href) return;
      event.preventDefault();
      const url = entry.destination.url;
      requestNavigation(() => window.location.assign(url));
    };
    window.addEventListener(NAVIGATION_INTENT_EVENT, intent);
    document.addEventListener('click', link, true);
    navigation?.addEventListener('navigate', traverse);
    return () => { window.removeEventListener(NAVIGATION_INTENT_EVENT, intent); document.removeEventListener('click', link, true); navigation?.removeEventListener('navigate', traverse); };
  }, [router, onBack]);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('mobile');
  const [showPreview, setShowPreview] = useState(true);
  const [isDesktop, setIsDesktop] = useState(true);
  const [mobilePreview, setMobilePreview] = useState(false);
  const formScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => { setIsDesktop(media.matches); if (media.matches) setMobilePreview(false); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobilePreview || isDesktop) return;
    const form = formScrollRef.current;
    const top = form?.scrollTop ?? 0;
    const previous = form?.style.overflow;
    if (form) form.style.overflow = 'hidden';
    return () => { if (form) { form.style.overflow = previous ?? ''; form.scrollTop = top; } };
  }, [mobilePreview, isDesktop]);
  const [showVarDropdown, setShowVarDropdown] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<SaveIntent | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null), bodyRef = useRef<HTMLTextAreaElement>(null);
  const activeField = useRef<'subject' | 'body'>('body');
  const emailSettings = useCachedPage<CampaignEmailSettings>({ module: 'settings', params: { campaignSender: 'EMAIL' }, disabled: campaignType !== 'Email', revalidateOnInvalidation: true, fetchFn: async () => (await campaignsApi.emailSettings()).data });
  const smsSettings = useCachedPage<CampaignSmsSettings>({ module: 'settings', params: { campaignSender: 'SMS' }, disabled: campaignType !== 'SMS', revalidateOnInvalidation: true, fetchFn: async () => (await campaignsApi.smsSettings()).data });
  const emailSender = emailSettings.data;
  const { isDark: previewDark } = useTheme();
  function insertVariable(token: string) {
    if (!canWrite || isSending) return;
    const field = campaignType === 'Email' ? activeField.current : 'body';
    const input = field === 'subject' ? subjectRef.current : bodyRef.current;
    const value = field === 'subject' ? emailSubject : messageContent;
    insertVariableAtSelection(input, value, token, field === 'subject' ? setEmailSubject : setMessageContent);
    setShowVarDropdown(false);
  }
  function dragVariable(event: React.DragEvent<HTMLButtonElement>, token: string) {
    event.dataTransfer.setData('text/plain', token);
    event.dataTransfer.effectAllowed = 'copy';
  }
  // Native text drops use browser caret hit-testing for wrapped/scrolled textareas.
  // React onChange persists the insertion. Existing dnd-kit sort/kanban helpers
  // do not support native text caret placement.

  const toApiType = (t: CampaignType): 'EMAIL' | 'SMS' | 'MULTI_CHANNEL' =>
    t === 'Email' ? 'EMAIL' : t === 'SMS' ? 'SMS' : 'MULTI_CHANNEL';

  const [savedId, setSavedId] = useState(initialCampaign?.id);
  const [audiences, setAudiences] = useState<SavedAudience[]>([]);
  const [editingAudience, setEditingAudience] = useState<SavedAudience | undefined>();
  const [showAudiencePanel, setShowAudiencePanel] = useState(false);
  const [counts, setCounts] = useState<AudiencePreviewResult | null>(null);
  const [recipientPage, setRecipientPage] = useState(1), [recipientLimit, setRecipientLimit] = useState(25);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requestLock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    audiencesApi.list().then(res => { if (!cancelled) setAudiences(res.data); }).catch(e => { if (!cancelled) setErrors({ targetAudienceId: e.message }); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { setRecipientPage(1); }, [targetAudience, audiences, campaignType]);
  useEffect(() => {
    let cancelled = false;
    setCounts(null);
    const audience = audiences.find(a => a.id === targetAudience);
    const source = ['LEADS', 'CONTACTS'].includes(targetAudience) ? targetAudience as 'LEADS' | 'CONTACTS' : undefined;
    if ((!source && !audience) || audience?.source === 'ALL' || audience?.repairReason) return;
    const definition = audience ? { source: audience.source, matchMode: audience.matchMode, conditions: audience.conditions } : { source: source!, conditions: [] };
    const timer = setTimeout(() => audiencesApi.preview({ ...definition, channel: campaignType === 'SMS' ? 'SMS' : 'EMAIL', page: recipientPage, limit: recipientLimit }).then(res => { if (!cancelled) setCounts(res.data); }).catch(e => { if (!cancelled) setErrors(prev => ({ ...prev, targetAudienceId: e.message })); }), 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [targetAudience, audiences, campaignType, recipientPage, recipientLimit]);
  const chosenAudience = audiences.find(audience => audience.id === targetAudience);
  const selectedSource = scheduled ? initialCampaign?.scheduleConfig?.source : (chosenAudience?.source === 'LEADS' || chosenAudience?.source === 'CONTACTS' ? chosenAudience.source : targetAudience === 'LEADS' || targetAudience === 'CONTACTS' ? targetAudience : undefined);
  const variableCatalog = useCampaignVariableFields();
  const variableError = variableCatalog.error;
  const variableFields = variableCatalog.fields.filter(field => field.module === (selectedSource === 'LEADS' ? 'leads' : selectedSource === 'CONTACTS' ? 'contacts' : ''));
  const senderValues = { sender_name: campaignType === 'SMS' ? smsSettings.data?.organizationName : emailSender?.senderName, sender_email: campaignType === 'SMS' ? smsSettings.data?.organizationEmail : emailSender?.senderEmail };
  const choices = campaignVariableChoices(variableCatalog.fields, selectedSource, { forInsertion: true }).map(choice => choice.category === 'Sender' && !senderValues[choice.technicalKey as keyof typeof senderValues] ? { ...choice, personalizationAvailable: false, unavailableReason: 'Sender configuration is unavailable. Configure the sender before using this variable.' } : choice);
  const quickKeys = ['firstName', 'lastName', 'companyName', 'phone', 'status', 'sender_name', 'sender_email'];
  const quickChoices = quickKeys.flatMap(key => { const choice = choices.find(choice => choice.technicalKey === key && (choice.category === 'Sender' || choice.origins.some(origin => origin.module === (selectedSource === 'CONTACTS' ? 'contacts' : 'leads')))); return choice ? [choice] : []; });
  const approvedVariables = campaignApprovedVariableKeys(variableCatalog.fields, selectedSource);
  const invalidVariables = selectedSource && variableCatalog.data ? campaignVariableKeys((campaignType === 'Email' ? emailSubject : '') + '\n' + messageContent).filter(key => !approvedVariables.has(key)) : [];
  const variableRepair = invalidVariables.length ? `Repair unavailable variables for this source: ${invalidVariables.map(key => '{{' + key + '}}').join(', ')}.` : '';
  const previewFields = selectedSource ? variableCatalog.fields.filter(field => [selectedSource === 'LEADS' ? 'leads' : 'contacts', 'accounts', 'deals'].includes(field.module)) : variableFields;
  const previewVariables = { ...campaignSampleValues(previewFields), firstName: 'John', lastName: 'Doe', email: 'jdoe@example.com', companyName: 'Example Company', phone: '+639123456789', first_name: 'John', last_name: 'Doe', company_name: 'Example Company', contact_number: '+639123456789', status: 'Hot', sender_name: senderValues.sender_name || 'Configured sender unavailable', sender_email: senderValues.sender_email || 'Sender email unavailable' };
  useEffect(() => {
    const refresh = () => { void variableCatalog.refetch(); void emailSettings.refetch(); void smsSettings.refetch(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [variableCatalog.refetch, emailSettings.refetch, smsSettings.refetch]);
  const getPreviewText = (text: string) => renderEmailVariables(text, previewVariables);
  const previewSubject = () => getPreviewText(emailSubject) || campaignName || 'Email preview';
  const previewBody = () => <iframe title="Email body preview" sandbox="allow-popups allow-popups-to-escape-sandbox" className="w-full h-full min-h-48 border-0" srcDoc={`<!doctype html><html><head><meta name="referrer" content="no-referrer"><base target="_blank"><style>body{font:14px/1.6 system-ui;margin:0;overflow-wrap:anywhere;color:${previewDark ? '#cbd5e1' : '#334155'}}a{color:#2563eb;text-decoration:underline}img,table{max-width:100%}</style></head><body>${renderCampaignPreview(messageContent, previewVariables)}</body></html>`} />;
  let smsPreview = '', smsLengthPreview = '', smsPreviewError = '';
  if (campaignType === 'SMS') {
    smsPreview = buildFinalSms({ body: messageContent, variables: previewVariables });
    smsLengthPreview = smsSettings.data?.trackingOrigin ? mapCampaignTextLinks(smsPreview, () => smsCampaignTrackingUrl(smsSettings.data!.trackingOrigin!, 'x'.repeat(24))) : smsPreview;
    if (smsLengthPreview.length > SMS_MAX_LENGTH) smsPreviewError = `SMS preview exceeds the ${SMS_MAX_LENGTH}-character limit after personalization and link tracking.`;
  }
  function openSchedule() {
    if (requestLock.current || !maySend) return;
    let next = scheduledTime;
    try { campaignScheduleInstant(next); }
    catch { next = manilaLocalDateTime(new Date(Date.now() + 3600000)); }
    setScheduledTime(next); setScheduleSession(previous => previous + 1); setErrors({}); setShowVarDropdown(false); setScheduleOpen(true);
  }
  function closeSchedule() { if (!requestLock.current) setScheduleOpen(false); }
  async function save(intent: SaveIntent, scheduleValue?: string) {
    const send = intent !== 'draft';
    if (requestLock.current || (send ? !maySend : !canWrite)) return;
    if (send && initialCampaign && initialCampaign.status.toLowerCase() !== 'draft') return;
    if (intent === 'schedule') {
      try { campaignScheduleInstant(scheduleValue || ''); }
      catch (error) { setErrors({ form: (error as Error).message }); return; }
      setScheduledTime(scheduleValue!);
    }
    const source = ['LEADS', 'CONTACTS'].includes(targetAudience) ? targetAudience : null;
    const input = { name: campaignName, type: toApiType(campaignType), subject: campaignType === 'Email' ? emailSubject : '', body: campaignType === 'Email' ? prepareCampaignBody(messageContent) : messageContent,
      audienceSource: source, targetAudienceId: source ? null : targetAudience || null };
    const parsed = (send ? CampaignSendSchema : CampaignDraftSchema).safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next); return;
    }
    if (targetAudience === 'ALL' || chosenAudience?.source === 'ALL' || chosenAudience?.repairReason) { setErrors({ audienceSource: 'Repair this legacy audience by selecting Leads, Contacts, or a new single-source audience.' }); return; }
    if (send && variableRepair) { setErrors({ form: variableRepair }); return; }
    if (send && variableError) { setErrors({ form: variableError }); return; }
    if (send && campaignVariableKeys(messageContent + '\n' + (campaignType === 'Email' ? emailSubject : '')).some(key => key in senderValues && !senderValues[key as keyof typeof senderValues])) { setErrors({ form: 'Configure the sender before using sender variables.' }); return; }
    if (send && campaignType === 'Multi-Channel') { setErrors({ form: 'Send Now supports Email or SMS. Save Multi-Channel campaigns as drafts.' }); return; }
    if (send && campaignType === 'SMS' && smsPreviewError) { setErrors({ form: smsPreviewError }); return; }
    requestLock.current = true; setIsSending(true); setPendingIntent(intent); setErrors({});
    let draftSaved = false;
    try {
      const res = !canWrite && savedId ? { data: { id: savedId } } : savedId ? await campaignsApi.update(savedId, parsed.data) : await campaignsApi.create(parsed.data);
      setSavedId(res.data.id);
      draftSaved = true;
      if (intent === 'draft') setSavedSnapshot(draftSnapshot);
      if (intent === 'schedule') {
        // Saving can take long enough for the selected minute to elapse.
        await campaignsApi.schedule(res.data.id, campaignScheduleInstant(scheduleValue!));
        toast.success('Campaign scheduled once in Asia/Manila.'); setScheduleOpen(false); leaveBuilder(); return;
      }
      if (send) {
        let result = (await campaignsApi.send(res.data.id)).data;
        if (campaignType === 'SMS') {
          toast.info('SMS campaign submitted. Waiting for gateway confirmation.');
          trackSmsCampaignSubmission(tenant?.id ?? user?.tenantId ?? '', user?.id ?? '');
          leaveBuilder(); return;
        }
        // Each status request stays within the proxy timeout. Closing the editor
        // does not cancel a database-prepared campaign or submit it a second time.
        for (let attempt = 0; (result.submissionComplete === false || (result.status === 'SENDING' && result.submissionComplete === undefined && result.submittedRecipients + result.failedRecipients < result.eligibleRecipients)) && attempt < 150; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const current = (await campaignsApi.get(res.data.id)).data;
          result = current.sendResult;
        }
        if (result.submissionInterrupted || result.status === 'INTERRUPTED') {
          toast.warning('Campaign submission was interrupted. Review the recipient report and provider history before sending again; uncertain recipients were not retried.');
          leaveBuilder(); return;
        }
        if (result.status === 'SENDING') {
          toast.warning(`${result.submittedRecipients} of ${result.eligibleRecipients} emails were submitted. Waiting for provider confirmation.`);
          leaveBuilder(); return;
        }
        const message = `${result.submittedRecipients} of ${result.eligibleRecipients} emails were submitted successfully.`;
        if (result.status === 'FAILED') toast.error(`Campaign sending failed. ${result.submittedRecipients} of ${result.eligibleRecipients} emails were submitted.`);
        else if (result.failedRecipients) toast.warning(`${message} ${result.failedRecipients} failed.`);
        else toast.success(message);
      } else toast.success('Campaign draft saved.');
      leaveBuilder();
    } catch (e) {
      const error = e as Error & { fieldErrors?: Record<string, string[]> };
      const next: Record<string, string> = {};
      for (const [field, messages] of Object.entries(error.fieldErrors || {})) if (messages[0]) next[field] = messages[0];
      if (!Object.keys(next).length) next.form = error.message || 'Could not save campaign.';
      if (intent === 'schedule' && draftSaved) next.form = `Campaign draft saved, but scheduling failed. ${error.message || 'Unable to schedule campaign.'}`;
      setErrors(next);
    } finally { requestLock.current = false; setIsSending(false); setPendingIntent(null); }
  }
  async function manageSchedule(cancel: boolean, value?: string) {
    if (requestLock.current || !initialCampaign || !maySend) return;
    let due = '';
    if (!cancel) {
      try { due = campaignScheduleInstant(value || ''); }
      catch (error) { setErrors({ form: (error as Error).message }); return; }
      setScheduledTime(value!);
    }
    requestLock.current = true; setIsSending(true); setErrors({});
    try { if (cancel) await campaignsApi.cancelSchedule(initialCampaign.id); else await campaignsApi.schedule(initialCampaign.id, due); toast.success(cancel ? 'Schedule cancelled. The campaign is now a draft.' : 'Campaign rescheduled.'); setScheduleOpen(false); leaveBuilder(); }
    catch (error) { setErrors({ form: error instanceof Error ? error.message : 'Unable to change schedule.' }); }
    finally { requestLock.current = false; setIsSending(false); }
  }
  const handleSaveDraft = () => save('draft');

  const inputCls = 'w-full h-9 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-white/3 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 transition-all duration-200';

  const preview = (
        <div id="campaign-live-preview" className="w-full min-w-0 min-h-0 flex-1 lg:flex-none lg:w-105 shrink-0 flex flex-col bg-linear-to-br from-slate-50 via-slate-100 to-blue-50/30 dark:from-[#030712] dark:via-[#0a1020] dark:to-blue-950/10 overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-white/5 bg-white/50 dark:bg-white/2 backdrop-blur-lg">
            <span id="campaign-preview-title" className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Live Preview</span>
            <div className="flex items-center gap-2">
              {!isDesktop && <button type="button" aria-label="Close preview" onClick={() => setMobilePreview(false)} className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X size={16} /></button>}
              <div className="flex gap-0.5 bg-slate-200/80 dark:bg-white/5 p-0.5 rounded-lg border border-gray-200 dark:border-white/5">
                <button type="button" onClick={() => setPreviewDevice('desktop')} className={`p-1.5 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${previewDevice === 'desktop' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'}`} aria-label="Desktop preview">
                  <Monitor size={14} />
                </button>
                <button type="button" onClick={() => setPreviewDevice('mobile')} className={`p-1.5 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${previewDevice === 'mobile' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'}`} aria-label="Mobile preview">
                  <Smartphone size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-start justify-center p-4 sm:p-6">
            {previewDevice === 'mobile' ? (
              <div className="w-70 max-w-full aspect-9/18 max-h-125 border-[6px] border-slate-800 dark:border-slate-600 rounded-[2.5rem] bg-white dark:bg-[#0c0f16] shadow-2xl shadow-black/20 dark:shadow-black/50 overflow-hidden flex flex-col relative">
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-4 bg-black rounded-xl z-10" />
                <div className="pt-8 px-3 pb-3 flex-1 flex flex-col overflow-hidden text-xs">
                  {campaignType === 'SMS' ? (
                    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
                      <div className="text-center text-[10px] text-slate-400 dark:text-slate-500 mb-3 font-medium">+639XXXXXXXXX · Today</div>
                      <div className="bg-emerald-500 text-white p-3 rounded-2xl rounded-tr-sm max-w-[85%] self-end wrap-break-word shadow-sm text-[11px] whitespace-pre-wrap leading-relaxed">
                        <SmsMessageContent content={smsPreview} />
                      </div>
                      <div className="text-[10px] text-slate-400 text-right mt-1.5 pr-1">Sample preview</div>
                      <div className="mt-auto pt-4 text-center"><div className="text-[10px] text-slate-400">{smsMessageStats(smsLengthPreview).characters} characters · {smsMessageStats(smsLengthPreview).segments} SMS segment(s)</div></div>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#131924] rounded-lg overflow-hidden border border-gray-200/50 dark:border-white/5">
                      <div className="p-2.5 border-b border-gray-200 dark:border-white/5 bg-white dark:bg-white/3">
                        <div className="font-semibold text-slate-900 dark:text-white text-[11px] truncate">{previewSubject()}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5 break-words">From: {emailSender?.senderEmail ? `${emailSender.senderName} <${emailSender.senderEmail}>` : 'Configured sender unavailable'}</div>
                        <div className="text-[9px] text-slate-500">To: John Doe &lt;jdoe@example.com&gt;</div>
                      </div>
                      <div className="p-3 flex-1 overflow-y-auto text-slate-700 dark:text-slate-300 leading-relaxed text-[11px] whitespace-pre-wrap">
                        {messageContent ? previewBody() : <span className="opacity-50 italic">Your email preview will appear here...</span>}
                      </div>
                      <div className="p-2 border-t border-gray-100 dark:border-white/3 text-[9px] text-slate-400 text-center">
                        Sample preview. Recipient values are personalized on send.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="w-full max-w-sm bg-white/80 dark:bg-white/2 backdrop-blur-xl border border-gray-200 dark:border-white/5 rounded-xl flex flex-col shadow-xl shadow-black/5 dark:shadow-black/30 overflow-hidden min-h-87.5">
                {campaignType === 'SMS' ? (
                  <div className="flex flex-col h-full p-5 justify-center">
                    <div className="text-xs text-slate-400 dark:text-slate-500 mb-2 text-center">SMS Preview</div>
                    <div className="bg-emerald-500 text-white px-4 py-3 rounded-2xl rounded-tr-sm max-w-[80%] self-end wrap-break-word shadow text-sm whitespace-pre-wrap leading-relaxed">
                      <SmsMessageContent content={smsPreview} />
                    </div>
                    <div className="text-[10px] text-slate-400 text-right mt-2 pr-2">Sample preview · No delivery confirmation</div>
                    <div className="mt-4 text-center text-xs text-slate-400">{smsMessageStats(smsLengthPreview).characters} characters · {smsMessageStats(smsLengthPreview).segments} SMS segment(s)</div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="p-4 border-b border-gray-200 dark:border-white/5 bg-slate-50/80 dark:bg-white/2">
                      <div className="flex items-center gap-2 text-xs"><span className="text-slate-400 w-14 font-medium">Subject:</span><span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{previewSubject()}</span></div>
                      <div className="flex items-center gap-2 text-xs mt-1"><span className="text-slate-400 w-14 font-medium">From:</span><span className="min-w-0 break-words text-slate-600 dark:text-slate-400">{emailSender?.senderEmail ? `${emailSender.senderName} <${emailSender.senderEmail}>` : 'Configured sender unavailable'}</span></div>
                      <div className="flex items-center gap-2 text-xs mt-1"><span className="text-slate-400 w-14 font-medium">To:</span><span className="text-slate-600 dark:text-slate-400">John Doe ({targetAudience})</span></div>
                    </div>
                    <div className="p-5 flex-1 overflow-y-auto text-slate-700 dark:text-slate-300 text-sm whitespace-pre-wrap leading-relaxed">
                      {messageContent ? previewBody() : <p className="opacity-50 italic">Your email preview will appear here...</p>}
                    </div>
                    <div className="p-3 border-t border-gray-100 dark:border-white/3 text-[10px] text-slate-400 text-center">
                      Sample preview. Recipient values are personalized on send.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
  );

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row md:flex-wrap md:items-center justify-between gap-3 border-b border-gray-200 dark:border-white/5 bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl px-3 sm:px-6 py-3 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <button disabled={isSending} onClick={() => requestNavigation(onBack)} aria-label="Back to campaigns" className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Create Campaign</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">Draft a new message to send to your contacts.</p>
          </div>
        </div>
        <div role="group" aria-label="Campaign actions" className="flex flex-nowrap items-center gap-1.5 sm:gap-2 self-end md:self-auto">
          <button aria-label="Save Draft" onClick={handleSaveDraft} disabled={isSending || !canWrite} className="whitespace-nowrap px-2 min-[375px]:px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 rounded-lg border border-gray-200 dark:border-white/10 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed">
            Save<span className="hidden min-[375px]:inline"> Draft</span>
          </button>
          <DropdownMenu open={sendMenuOpen} onOpenChange={setSendMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button type="button" aria-busy={isSending} disabled={isSending || !maySend || (!!initialCampaign && initialCampaign.status.toLowerCase() !== 'draft')} className="gap-1.5 sm:gap-2 px-2 min-[375px]:px-3 sm:px-5 text-xs sm:text-sm font-semibold shadow-md shadow-primary/20">
                <span>{pendingIntent === 'send' ? 'Sending...' : 'Send'}</span><ChevronDown size={14} className={`opacity-60 transition-transform ${sendMenuOpen ? 'rotate-180' : ''}`} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-48 rounded-lg py-1">
              <DropdownMenuItem disabled={isSending || !maySend} onSelect={() => void save('send')} className="gap-2.5 px-3.5 py-2.5 text-[13px]"><Send size={15} className="text-muted-foreground" />Send Now</DropdownMenuItem>
              <DropdownMenuItem disabled={isSending || !maySend} onSelect={openSchedule} className="gap-2.5 px-3.5 py-2.5 text-[13px]"><CalendarClock size={15} className="text-muted-foreground" />Schedule Send</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" onClick={() => isDesktop ? setShowPreview(previous => !previous) : setMobilePreview(previous => !previous)}
            aria-label={(isDesktop ? showPreview : mobilePreview) ? 'Hide live preview' : 'Show live preview'} aria-expanded={isDesktop ? showPreview : mobilePreview} aria-controls="campaign-live-preview"
            className="shrink-0 rounded-lg border border-gray-200 dark:border-white/10 p-2 text-slate-600 dark:text-slate-300 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <PanelRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <FieldError message={scheduleOpen ? undefined : errors.form || variableError || variableRepair || undefined} />
      {initialCampaign?.scheduleConfig?.scheduleFailureReason && <p role="status" className="m-3 rounded border border-amber-300 p-3 text-sm text-amber-800">Schedule failed: {initialCampaign.scheduleConfig.scheduleFailureReason}</p>}
      {scheduled && <div className="m-3 space-y-2 rounded border p-3 text-sm"><p>Approved content and audience rules are fixed. Cancel the schedule to edit them.</p><p>Scheduled for {manilaLocalDateTime(initialCampaign.scheduledFor || '').replace('T', ' ')} (Asia/Manila)</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={isSending || !maySend} onClick={openSchedule}>Reschedule</Button><Button type="button" variant="outline" disabled={isSending || !maySend} onClick={() => void manageSchedule(true)}>Cancel schedule</Button></div></div>}
      {/* Split Layout */}
      <div ref={formScrollRef} className="min-h-0 flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* Editor */}
        <fieldset disabled={!canWrite || isSending} className="min-w-0 shrink-0 lg:flex-1 lg:overflow-y-auto p-4 sm:p-6 space-y-5 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-white/5">
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Campaign Details</h3>
            <div>
              <label htmlFor="builder-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Campaign Name <span className="text-red-500">*</span></label>
              <input id="builder-name" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className={`${inputCls} placeholder:text-slate-400`} placeholder="e.g. Q3 Newsletter" />
              <FieldError message={errors.name} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Type <span className="text-red-500">*</span></label>
                <div className="flex rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden bg-slate-50 dark:bg-white/3">
                  {(['Email', 'SMS'] as CampaignType[]).map((t) => (
                    <button key={t} type="button" onClick={() => setCampaignType(t)} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-all duration-200 cursor-pointer ${campaignType === t ? 'bg-primary text-white shadow-sm shadow-primary/20' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-white/5'}`}>
                      {t === 'Email' && <Mail size={14} />}{t === 'SMS' && <MessageSquare size={14} />}{t === 'Multi-Channel' && <Zap size={14} />}
                      {t === 'Multi-Channel' ? 'Multi' : t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label htmlFor="builder-audience" className="text-sm font-medium text-slate-700 dark:text-slate-300">Target Audience <span className="text-red-500">*</span></label>
                  <button type="button" onClick={() => { setEditingAudience(undefined); setShowAudiencePanel(true); }} className="text-xs font-bold text-primary dark:text-primary hover:text-blue-700 dark:hover:text-blue-300 transition-colors duration-200 flex items-center gap-1 bg-primary/10 hover:bg-primary/20 px-2 py-0.5 rounded border border-primary/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <Plus size={11} className="stroke-[3px]" /> Create New
                  </button>
                </div>
                <div className="relative">
                  <select id="builder-audience" value={targetAudience} onChange={(e) => { setTargetAudience(e.target.value); setErrors(prev => ({ ...prev, targetAudienceId: '' })); }} className={`${inputCls} appearance-none cursor-pointer pr-8`}>
                    <option value="">Select an audience</option><option value="LEADS">All Leads</option><option value="CONTACTS">All Contacts</option>{targetAudience === 'ALL' && <option value="ALL" disabled>Legacy mixed audience — select a source</option>}
                    {audiences.map(a => <option key={a.id} value={a.id} disabled={a.source === 'ALL' || !!a.repairReason}>{a.name}{a.source === 'ALL' || a.repairReason ? ' — repair required' : ''}</option>)}
                  </select>
                  <Tags size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
                <FieldError message={errors.targetAudienceId || errors.audienceSource} />
                {chosenAudience && canEdit && <button type="button" className="mt-2 text-xs text-primary" onClick={() => { setEditingAudience(chosenAudience); setShowAudiencePanel(true); }}>{chosenAudience.source === 'ALL' || chosenAudience.repairReason ? 'Repair saved audience' : 'Edit saved audience'}</button>}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-white/3" />
          <section aria-label="Eligible Recipients" className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Eligible Recipients</h3>
            {!counts && targetAudience && <DataLoadingSkeleton rowCount={3} columnCount={2} />}
            {counts && <>
              <ul className="max-h-52 divide-y overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10">
                {counts.recipients.map(recipient => <li key={recipient.id} className="space-y-1 p-3 text-xs"><strong>{recipient.name || 'Unnamed recipient'}</strong> · {recipient.recordType}<p>{recipient.companyName}</p><p>{campaignType === 'SMS' ? recipient.phone : recipient.email}</p></li>)}
              </ul>
              {!counts.recipients.length && <p className="text-xs text-slate-500">No eligible recipients match these conditions.</p>}
              <PaginationControls currentPage={recipientPage} totalRecords={counts.meta.total} pageSize={recipientLimit} onPageChange={setRecipientPage} onPageSizeChange={size => { setRecipientPage(1); setRecipientLimit(size); }} showRange={false} />
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300" aria-live="polite">{counts.eligible} eligible recipient{counts.eligible === 1 ? '' : 's'}</p>
            </>}
          </section>

          {/* Message Content */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Message Content</h3>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Content <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <button type="button" aria-expanded={showVarDropdown} onClick={() => { if (!showVarDropdown) { void variableCatalog.refetch(); void emailSettings.refetch(); void smsSettings.refetch(); } setShowVarDropdown(!showVarDropdown); }} onKeyDown={event => { if (event.key === 'Escape') setShowVarDropdown(false); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary dark:text-primary bg-primary/10 rounded-md hover:bg-primary/20 transition-colors duration-200 border border-primary/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <Wand2 size={14} /> Insert Variable
                    </button>
                    {showVarDropdown && (
                      <div onKeyDown={event => { if (event.key === 'Escape') setShowVarDropdown(false); }} className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl overflow-hidden z-50 backdrop-blur-xl">
                        <CampaignVariablePicker choices={choices} onInsert={insertVariable} />
                      </div>
                    )}
                  </div>
                </div>
                {campaignType === 'Email' && (
                  <div className="mb-3">
                    <label htmlFor="builder-subject" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Subject Line <span className="text-red-500">*</span></label>
                    <input ref={subjectRef} onFocus={() => { activeField.current = 'subject'; }} id="builder-subject" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="w-full h-9 rounded-md border border-gray-200 dark:border-white/8 bg-white dark:bg-white/3 px-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary transition-colors" placeholder="e.g. Welcome to LeadCRM, {{firstName}}!" />
                    <FieldError message={errors.subject} />
                  </div>
                )}
                <label htmlFor="builder-body" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Body <span className="text-red-500">*</span></label>
                <textarea ref={bodyRef} onFocus={() => { activeField.current = 'body'; }} id="builder-body" rows={campaignType === 'Email' ? 8 : 10} className="w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/3 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 transition-all duration-200 resize-none leading-relaxed" placeholder={campaignType === 'SMS' ? 'Hi {{firstName}}, ...' : 'Hi {{firstName}},\n\nYour message here...'} value={messageContent} onChange={(e) => setMessageContent(e.target.value)} />
                <FieldError message={errors.body || (campaignType === 'SMS' ? smsPreviewError : '')} />
                {campaignType === 'SMS' && <SmsFooterControl value={messageContent} onChange={setMessageContent} />}
                {campaignType === 'SMS' && (
                  <div className="flex flex-col gap-1 mt-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{smsMessageStats(smsLengthPreview).characters} characters after personalization and link tracking · {smsMessageStats(smsLengthPreview).segments} SMS segment(s) · {smsMessageStats(smsLengthPreview).encoding} (sample recipient)</span>
                    <span>HTTP/HTTPS links use a recipient tracking URL when sent. The preview opens original destinations; sent links use recipient tracking. {smsSettings.data?.trackingOrigin ? 'Counts include the tracking URL.' : 'Tracking configuration is unavailable; final link lengths are checked before sending.'}</span>
                  </div>
                )}
                <div className="mt-2.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1.5">Quick fields:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {quickChoices.map(choice => (
                      <button key={choice.id} type="button" disabled={!choice.personalizationAvailable} title={choice.unavailableReason || choice.label} draggable={choice.personalizationAvailable} onDragStart={event => dragVariable(event, `{{${choice.technicalKey}}}`)} onClick={() => insertVariable(`{{${choice.technicalKey}}}`)} className="text-[11px] bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-md border border-gray-200 dark:border-white/5 transition-colors duration-150 cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{`{{${choice.technicalKey}}}`}</button>
                    ))}
                  </div>
                </div>
              </div>
          </div>
        </fieldset>

        {isDesktop ? (showPreview && preview) : <Sheet open={mobilePreview} onOpenChange={setMobilePreview}>
          <SheetContent showClose={false} trapFocus layerClassName="z-[300]" aria-labelledby="campaign-preview-title"
            className="h-dvh max-w-full sm:max-w-105 overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            {preview}
          </SheetContent>
        </Sheet>}
      </div>
      <Dialog open={scheduleOpen} onOpenChange={open => { if (!open) closeSchedule(); }}>
        <DialogContent showClose={false} aria-labelledby="campaign-schedule-title" aria-describedby="campaign-schedule-description" aria-busy={isSending} className="space-y-3 p-3 sm:p-5">
          <DialogHeader>
            <DialogTitle id="campaign-schedule-title">{scheduled ? 'Reschedule Campaign' : 'Schedule Send'}</DialogTitle>
            <DialogDescription id="campaign-schedule-description">Choose a future date and time in Asia/Manila.</DialogDescription>
          </DialogHeader>
          {scheduleOpen && <fieldset disabled={isSending} className="min-w-0">
            <ManilaDateTimePicker key={scheduleSession} value={scheduledTime} rollPastToday={false} busy={isSending} onCancel={closeSchedule} onDone={value => { if (scheduled) void manageSchedule(false, value); else void save('schedule', value); }} />
          </fieldset>}
          <FieldError message={Object.values(errors).filter(Boolean).join(' ') || undefined} />
        </DialogContent>
      </Dialog>
      {showAudiencePanel && <AudiencePanel initialAudience={editingAudience} channel={campaignType === 'SMS' ? 'SMS' : 'EMAIL'} onClose={() => setShowAudiencePanel(false)} onCreated={audience => { setAudiences(prev => prev.some(item => item.id === audience.id) ? prev.map(item => item.id === audience.id ? audience : item) : [...prev, audience]); setTargetAudience(audience.id); setShowAudiencePanel(false); }} />}
      <ConfirmActionDialog open={!!exit} onOpenChange={open => { if (!open) { exitPending.current = false; setExit(null); } }}
        title="Discard unsaved changes?" description="Your unsaved campaign changes will be lost."
        variant="warning" cancelLabel="Keep editing" confirmLabel="Discard changes"
        onConfirm={() => { const navigate = exit; if (!navigate || leaving.current) return; leaving.current = true; exitPending.current = false; setSavedSnapshot(draftSnapshot); setExit(null); return navigate(); }} />
    </div>
  );
}
