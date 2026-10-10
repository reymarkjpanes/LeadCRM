'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CampaignDraftSchema, CampaignSendSchema, EMAIL_VARIABLE_TOKENS, renderEmailVariables, buildFinalSms, smsMessageStats, SMS_MAX_LENGTH, type SavedAudience, type AudienceBreakdown, type CampaignEmailSettings } from '@leadcrm/shared';
import { audiencesApi } from '@/shared/services/audiences.api';
import { AudiencePanel, AudienceCounts, FieldError } from './audience-panel';
import type { Campaign } from '@/store/types';
import { renderCampaignPreview, prepareCampaignBody } from '../services/campaign-html';
import { useTheme } from '@/shared/hooks/use-theme';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { toast } from 'sonner';
import {
  ArrowLeft, Send, Mail, MessageSquare, Plus,
  Wand2, Monitor, Smartphone, Zap, Tags, Loader2,
  PanelRight, X,
} from 'lucide-react';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { campaignsApi } from '@/shared/services/campaigns.api';

type CampaignType = 'Email' | 'SMS' | 'Multi-Channel';

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

  const maySend = useHasPermission('campaigns.send') && canSend;
  const canCreate = useHasPermission('campaigns.create'), canEdit = useHasPermission('campaigns.edit');
  const canWrite = initialCampaign ? canEdit && initialCampaign.status.toLowerCase() === 'draft' : canCreate;
  const [campaignName, setCampaignName] = useState(initialCampaign?.name || '');
  const [campaignType, setCampaignType] = useState<CampaignType>(
    (initialCampaign?.type === 'Sms' ? 'SMS' : initialCampaign?.type as CampaignType) || (initialType as CampaignType) || 'Email',
  );
  const [targetAudience, setTargetAudience] = useState(initialCampaign?.targetAudienceId || initialCampaign?.audienceSource || '');
  const [messageContent, setMessageContent] = useState(initialCampaign?.body || initialContent || '');
  const [emailSubject, setEmailSubject] = useState(initialCampaign?.subject || initialSubject || '');
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
  const subjectRef = useRef<HTMLInputElement>(null), bodyRef = useRef<HTMLTextAreaElement>(null);
  const activeField = useRef<'subject' | 'body'>('body');
  const [organizationEmail, setOrganizationEmail] = useState<string | null>(null);
  const [emailSender, setEmailSender] = useState<CampaignEmailSettings | null>(null);
  const { isDark: previewDark } = useTheme();
  useEffect(() => {
    let cancelled = false;
    campaignsApi.emailSettings().then(res => { if (!cancelled) setEmailSender(res.data); })
      .catch(() => { if (!cancelled) setEmailSender(null); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (campaignType !== 'SMS') return;
    let cancelled = false;
    campaignsApi.smsSettings().then(res => { if (!cancelled) setOrganizationEmail(res.data.organizationEmail); })
      .catch(() => { if (!cancelled) setOrganizationEmail(null); });
    return () => { cancelled = true; };
  }, [campaignType]);
  function insertVariable(token: string) {
    if (!canWrite || isSending) return;
    const field = campaignType === 'Email' ? activeField.current : 'body';
    const input = field === 'subject' ? subjectRef.current : bodyRef.current;
    const value = field === 'subject' ? emailSubject : messageContent;
    const start = input?.selectionStart ?? value.length, end = input?.selectionEnd ?? start;
    const next = value.slice(0, start) + token + value.slice(end);
    (field === 'subject' ? setEmailSubject : setMessageContent)(next);
    setShowVarDropdown(false);
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + token.length, start + token.length); });
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
  const [showAudiencePanel, setShowAudiencePanel] = useState(false);
  const [counts, setCounts] = useState<AudienceBreakdown | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requestLock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    audiencesApi.list().then(res => { if (!cancelled) setAudiences(res.data); }).catch(e => { if (!cancelled) setErrors({ targetAudienceId: e.message }); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setCounts(null);
    const audience = audiences.find(a => a.id === targetAudience);
    const source = ['ALL', 'LEADS', 'CONTACTS'].includes(targetAudience) ? targetAudience as 'ALL' | 'LEADS' | 'CONTACTS' : undefined;
    if (!source && !audience) return;
    const definition = audience ? { source: audience.source, conditions: audience.conditions } : { source: source!, conditions: [] };
    const timer = setTimeout(() => audiencesApi.preview({ ...definition, channel: campaignType === 'SMS' ? 'SMS' : 'EMAIL' }).then(res => { if (!cancelled) setCounts(res.data); }).catch(e => { if (!cancelled) setErrors(prev => ({ ...prev, targetAudienceId: e.message })); }), 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [targetAudience, audiences, campaignType]);
  const previewVariables = { first_name: 'John', last_name: 'Doe', company_name: 'Example Company', contact_number: '+639123456789', status: 'Hot', sender_name: emailSender?.senderName || 'Configured sender unavailable', sender_email: emailSender?.senderEmail || 'Sender email unavailable' };
  const getPreviewText = (text: string) => renderEmailVariables(text, previewVariables);
  const previewSubject = () => getPreviewText(emailSubject) || campaignName || 'Email preview';
  const previewBody = () => <iframe title="Email body preview" sandbox="allow-popups allow-popups-to-escape-sandbox" className="w-full h-full min-h-48 border-0" srcDoc={`<!doctype html><html><head><meta name="referrer" content="no-referrer"><base target="_blank"><style>body{font:14px/1.6 system-ui;margin:0;overflow-wrap:anywhere;color:${previewDark ? '#cbd5e1' : '#334155'}}a{color:${previewDark ? '#60a5fa' : '#2563eb'}}img,table{max-width:100%}</style></head><body>${renderCampaignPreview(messageContent, previewVariables)}</body></html>`} />;
  let smsPreview = '', smsPreviewError = '';
  if (campaignType === 'SMS') {
    smsPreview = buildFinalSms({ body: messageContent, variables: { first_name: 'John', last_name: 'Doe', company_name: 'Example Company', contact_number: '+639123456789', status: 'Hot', sender_name: 'Camxian Technologies', sender_email: organizationEmail || '' } });
    if (smsPreview.length > SMS_MAX_LENGTH) smsPreviewError = `SMS preview exceeds the ${SMS_MAX_LENGTH}-character limit including personalization and the contact footer.`;
  }
  async function save(send: boolean) {
    if (requestLock.current || (send ? !maySend : !canWrite)) return;
    const source = ['LEADS', 'CONTACTS', 'ALL'].includes(targetAudience) ? targetAudience : null;
    const input = { name: campaignName, type: toApiType(campaignType), subject: emailSubject, body: campaignType === 'Email' ? prepareCampaignBody(messageContent) : messageContent,
      audienceSource: source, targetAudienceId: source ? null : targetAudience || null };
    const parsed = (send ? CampaignSendSchema : CampaignDraftSchema).safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next); return;
    }
    if (send && campaignType === 'Multi-Channel') { setErrors({ form: 'Send Now supports Email or SMS. Save Multi-Channel campaigns as drafts.' }); return; }
    if (send && campaignType === 'SMS' && smsPreviewError) { setErrors({ form: smsPreviewError }); return; }
    requestLock.current = true; setIsSending(true); setErrors({});
    try {
      const res = !canWrite && savedId ? { data: { id: savedId } } : savedId ? await campaignsApi.update(savedId, parsed.data) : await campaignsApi.create(parsed.data);
      setSavedId(res.data.id);
      if (send) {
        let result = (await campaignsApi.send(res.data.id)).data;
        // Each status request stays within the proxy timeout. Closing the editor
        // does not cancel a database-prepared campaign or submit it a second time.
        for (let attempt = 0; (result.submissionComplete === false || (result.status === 'SENDING' && result.submissionComplete === undefined && result.submittedRecipients + result.failedRecipients < result.eligibleRecipients)) && attempt < 150; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const current = (await campaignsApi.get(res.data.id)).data;
          result = current.sendResult;
        }
        if (result.submissionInterrupted || result.status === 'INTERRUPTED') {
          toast.warning('Campaign submission was interrupted. Review the recipient report and provider history before sending again; uncertain recipients were not retried.');
          onBack(); return;
        }
        if (result.status === 'SENDING') {
          toast.warning(`${result.submittedRecipients} of ${result.eligibleRecipients} ${campaignType === 'SMS' ? 'SMS messages' : 'emails'} were submitted. Waiting for provider confirmation.`);
          onBack(); return;
        }
        const message = `${result.submittedRecipients} of ${result.eligibleRecipients} ${campaignType === 'SMS' ? 'SMS messages' : 'emails'} were submitted successfully.`;
        if (result.status === 'FAILED') toast.error(`Campaign sending failed. ${result.submittedRecipients} of ${result.eligibleRecipients} ${campaignType === 'SMS' ? 'SMS messages' : 'emails'} were submitted.`);
        else if (result.failedRecipients) toast.warning(`${message} ${result.failedRecipients} failed.`);
        else toast.success(message);
      } else toast.success('Campaign draft saved.');
      onBack();
    } catch (e) {
      const error = e as Error & { fieldErrors?: Record<string, string[]> };
      const next: Record<string, string> = {};
      for (const [field, messages] of Object.entries(error.fieldErrors || {})) if (messages[0]) next[field] = messages[0];
      if (!Object.keys(next).length) next.form = error.message || 'Could not save campaign.';
      setErrors(next);
    } finally { requestLock.current = false; setIsSending(false); }
  }
  const handleSend = () => save(true);
  const handleSaveDraft = () => save(false);

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
                        {smsPreview || <span className="italic opacity-60">Your SMS message will appear here...</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 text-right mt-1.5 pr-1">Sample preview</div>
                      <div className="mt-auto pt-4 text-center"><div className="text-[10px] text-slate-400">{smsMessageStats(smsPreview).characters} characters · {smsMessageStats(smsPreview).segments} SMS segment(s)</div></div>
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
                      {smsPreview || <span className="italic opacity-60">Message preview...</span>}
                    </div>
                    <div className="text-[10px] text-slate-400 text-right mt-2 pr-2">Sample preview · No delivery confirmation</div>
                    <div className="mt-4 text-center text-xs text-slate-400">{smsMessageStats(smsPreview).characters} characters · {smsMessageStats(smsPreview).segments} SMS segment(s)</div>
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
          <button disabled={isSending} onClick={onBack} aria-label="Back to campaigns" className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Create Campaign</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">Draft a new message to send to your contacts.</p>
          </div>
        </div>
        <div role="group" aria-label="Campaign actions" className="flex flex-nowrap items-center gap-1.5 sm:gap-2 self-end md:self-auto">
          <button aria-label="Save Draft" onClick={handleSaveDraft} disabled={isSending || !canWrite} className="whitespace-nowrap px-2 min-[375px]:px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 rounded-lg border border-gray-200 dark:border-white/10 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed">
            Save<span className="hidden min-[375px]:inline"> Draft</span>
          </button>
          <button onClick={handleSend} disabled={isSending || !maySend || (!!initialCampaign && initialCampaign.status.toLowerCase() !== 'draft')} className="flex items-center whitespace-nowrap gap-1.5 sm:gap-2 px-2 min-[375px]:px-3 sm:px-5 py-2 bg-primary hover:bg-primary/90 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-md shadow-primary/20 active:scale-95 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {isSending ? 'Sending...' : 'Send Now'}
          </button>
          <button type="button" onClick={() => isDesktop ? setShowPreview(previous => !previous) : setMobilePreview(previous => !previous)}
            aria-label={(isDesktop ? showPreview : mobilePreview) ? 'Hide live preview' : 'Show live preview'} aria-expanded={isDesktop ? showPreview : mobilePreview} aria-controls="campaign-live-preview"
            className="shrink-0 rounded-lg border border-gray-200 dark:border-white/10 p-2 text-slate-600 dark:text-slate-300 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <PanelRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <FieldError message={errors.form} />
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
                  <button type="button" onClick={() => setShowAudiencePanel(true)} className="text-xs font-bold text-primary dark:text-primary hover:text-blue-700 dark:hover:text-blue-300 transition-colors duration-200 flex items-center gap-1 bg-primary/10 hover:bg-primary/20 px-2 py-0.5 rounded border border-primary/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <Plus size={11} className="stroke-[3px]" /> Create New
                  </button>
                </div>
                <div className="relative">
                  <select id="builder-audience" value={targetAudience} onChange={(e) => { setTargetAudience(e.target.value); setErrors(prev => ({ ...prev, targetAudienceId: '' })); }} className={`${inputCls} appearance-none cursor-pointer pr-8`}>
                    <option value="">Select an audience</option><option value="LEADS">All Leads</option><option value="CONTACTS">All Contacts</option><option value="ALL">All Leads &amp; Contacts</option>
                    {audiences.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <Tags size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
                <FieldError message={errors.targetAudienceId || errors.audienceSource} />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-white/3" />
          <AudienceCounts counts={counts} channel={campaignType === 'SMS' ? 'SMS' : 'EMAIL'} />

          {/* Message Content */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Message Content</h3>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Content <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <button type="button" onClick={() => setShowVarDropdown(!showVarDropdown)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary dark:text-primary bg-primary/10 rounded-md hover:bg-primary/20 transition-colors duration-200 border border-primary/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <Wand2 size={14} /> Insert Variable
                    </button>
                    {showVarDropdown && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl overflow-hidden z-50 backdrop-blur-xl">
                        {EMAIL_VARIABLE_TOKENS.map(v => (
                          <button key={v} type="button" onClick={() => insertVariable(v)} className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors duration-150 cursor-pointer">{v}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {campaignType === 'Email' && (
                  <div className="mb-3">
                    <label htmlFor="builder-subject" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Subject Line <span className="text-red-500">*</span></label>
                    <input ref={subjectRef} onFocus={() => { activeField.current = 'subject'; }} id="builder-subject" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="w-full h-9 rounded-md border border-gray-200 dark:border-white/8 bg-white dark:bg-white/3 px-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary transition-colors" placeholder="e.g. Welcome to LeadCRM, {{first_name}}!" />
                    <FieldError message={errors.subject} />
                  </div>
                )}
                <label htmlFor="builder-body" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Body <span className="text-red-500">*</span></label>
                <textarea ref={bodyRef} onFocus={() => { activeField.current = 'body'; }} id="builder-body" rows={campaignType === 'Email' ? 8 : 10} className="w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/3 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 transition-all duration-200 resize-none leading-relaxed" placeholder={campaignType === 'SMS' ? 'Hi {{first_name}}, ...' : 'Hi {{first_name}},\n\nYour message here...'} value={messageContent} onChange={(e) => setMessageContent(e.target.value)} />
                <FieldError message={errors.body || (campaignType === 'SMS' ? smsPreviewError : '')} />
                {campaignType === 'SMS' && (
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{smsMessageStats(smsPreview).characters} characters including footer · {smsMessageStats(smsPreview).segments} SMS segment(s) · {smsMessageStats(smsPreview).encoding} (sample recipient)</span>
                  </div>
                )}
                <div className="mt-2.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1.5">Quick fields:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {EMAIL_VARIABLE_TOKENS.map(tag => (
                      <button key={tag} type="button" draggable onDragStart={event => dragVariable(event, tag)} onClick={() => insertVariable(tag)} className="text-[11px] bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-md border border-gray-200 dark:border-white/5 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{tag}</button>
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
      {showAudiencePanel && <AudiencePanel channel={campaignType === 'SMS' ? 'SMS' : 'EMAIL'} onClose={() => setShowAudiencePanel(false)} onCreated={audience => { setAudiences(prev => prev.some(item => item.id === audience.id) ? prev.map(item => item.id === audience.id ? audience : item) : [...prev, audience]); setTargetAudience(audience.id); setShowAudiencePanel(false); }} />}
    </div>
  );
}
