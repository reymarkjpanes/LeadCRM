'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CampaignDraftSchema, CampaignSendSchema, EMAIL_VARIABLE_TOKENS, renderEmailVariables, type SavedAudience, type AudienceBreakdown } from '@leadcrm/shared';
import { audiencesApi } from '@/shared/services/audiences.api';
import { AudiencePanel, AudienceCounts, FieldError } from './audience-panel';
import type { Campaign } from '@/store/types';
import DOMPurify from 'dompurify';
import { toast } from 'sonner';
import {
  ArrowLeft, Send, Mail, MessageSquare, Plus,
  Wand2, Monitor, Smartphone, Zap, Tags, Loader2,
  EyeOff, Eye,
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
  const [showVarDropdown, setShowVarDropdown] = useState(false);
  const [isSending, setIsSending] = useState(false);

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
    const definition = audience ? { source: audience.source, conditions: audience.conditions.map(({ field, operator, value }) => ({ field, operator, value })) } : { source: source!, conditions: [] };
    audiencesApi.preview(definition).then(res => { if (!cancelled) setCounts(res.data); }).catch(e => { if (!cancelled) setErrors(prev => ({ ...prev, targetAudienceId: e.message })); });
    return () => { cancelled = true; };
  }, [targetAudience, audiences]);
  const getPreviewText = (text: string) => renderEmailVariables(text, { first_name: 'John', last_name: 'Doe', company_name: 'Example Company', contact_number: '+639123456789', status: 'HOT', sender_name: 'Configured sender', sender_email: 'sender@example.com' });
  const previewSubject = () => getPreviewText(emailSubject) || campaignName || 'Email preview';
  const previewBody = () => <iframe title="Email body preview" sandbox="" className="w-full h-full min-h-48 border-0" srcDoc={DOMPurify.sanitize(getPreviewText(messageContent).replace(/\n/g, '<br>'))} />;
  async function save(send: boolean) {
    if (requestLock.current || (send ? !maySend : !canWrite)) return;
    const source = ['LEADS', 'CONTACTS', 'ALL'].includes(targetAudience) ? targetAudience : null;
    const input = { name: campaignName, type: toApiType(campaignType), subject: emailSubject, body: campaignType === 'Email' ? DOMPurify.sanitize(messageContent, { FORBID_TAGS: ['form', 'input', 'button', 'svg', 'iframe', 'object', 'embed'] }) : messageContent,
      audienceSource: source, targetAudienceId: source ? null : targetAudience || null };
    const parsed = (send ? CampaignSendSchema : CampaignDraftSchema).safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next); return;
    }
    if (send && (campaignType !== 'Email')) { setErrors({ form: 'Send Now supports a single EMAIL message. Save other campaign types as drafts.' }); return; }
    requestLock.current = true; setIsSending(true); setErrors({});
    try {
      const res = !canWrite && savedId ? { data: { id: savedId } } : savedId ? await campaignsApi.update(savedId, parsed.data) : await campaignsApi.create(parsed.data);
      setSavedId(res.data.id);
      if (send) {
        let result = (await campaignsApi.send(res.data.id)).data;
        // Each status request stays within the proxy timeout. Closing the editor
        // does not cancel a database-prepared campaign or submit it a second time.
        for (let attempt = 0; result.status === 'SENDING' && attempt < 150; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const current = (await campaignsApi.get(res.data.id)).data;
          result = current.sendResult;
        }
        if (result.status === 'SENDING') {
          toast.warning('Campaign is still processing. Check its status before taking further action.');
          onBack(); return;
        }
        if (result.status === 'PAUSED') {
          toast.warning(`${result.submittedRecipients} of ${result.eligibleRecipients} emails were submitted successfully. Some results are unconfirmed; review them before sending another campaign.`);
          onBack(); return;
        }
        const message = `${result.submittedRecipients} of ${result.eligibleRecipients} emails were submitted successfully.`;
        if (result.status === 'FAILED') toast.error(`Campaign sending failed. ${result.submittedRecipients} of ${result.eligibleRecipients} emails were submitted.`);
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

  const charCount = messageContent.length;
  const smsPartCount = Math.ceil(charCount / 160) || 1;
  const inputCls = 'w-full h-9 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-white/3 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-200';

  return (
    <div className="w-full h-full flex flex-col">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 dark:border-white/5 bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl px-4 sm:px-6 py-3 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <button disabled={isSending} onClick={onBack} aria-label="Back to campaigns" className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Create Campaign</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">Draft a new message to send to your contacts.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Mobile preview toggle — hidden on lg+ where side-by-side layout handles it */}
          <button
            type="button"
            onClick={() => setShowPreview((prev) => !prev)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label={showPreview ? 'Hide live preview' : 'Show live preview'}
          >
            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            <span className="hidden xs:inline">{showPreview ? 'Hide Preview' : 'Preview'}</span>
          </button>
          <button onClick={handleSaveDraft} disabled={isSending || !canWrite} className="px-3 sm:px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 rounded-lg border border-gray-200 dark:border-white/10 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
            Save Draft
          </button>
          <button onClick={handleSend} disabled={isSending || !maySend || (!!initialCampaign && initialCampaign.status.toLowerCase() !== 'draft')} className="flex items-center gap-2 px-4 sm:px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-blue-500/20 active:scale-95 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {isSending ? 'Sending...' : 'Send Now'}
          </button>
        </div>
      </div>

      <FieldError message={errors.form} />
      {/* Split Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Editor */}
        <fieldset disabled={!canWrite || isSending} className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-white/5">
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
                  {(['Email', 'SMS', 'Multi-Channel'] as CampaignType[]).map((t) => (
                    <button key={t} type="button" onClick={() => setCampaignType(t)} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-all duration-200 cursor-pointer ${campaignType === t ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-white/5'}`}>
                      {t === 'Email' && <Mail size={14} />}{t === 'SMS' && <MessageSquare size={14} />}{t === 'Multi-Channel' && <Zap size={14} />}
                      {t === 'Multi-Channel' ? 'Multi' : t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label htmlFor="builder-audience" className="text-sm font-medium text-slate-700 dark:text-slate-300">Target Audience <span className="text-red-500">*</span></label>
                  <button type="button" onClick={() => setShowAudiencePanel(true)} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors duration-200 flex items-center gap-1 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-0.5 rounded border border-blue-500/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
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
          <AudienceCounts counts={counts} />

          {/* Message Content */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Message Content</h3>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Content <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <button onClick={() => setShowVarDropdown(!showVarDropdown)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 rounded-md hover:bg-blue-500/20 transition-colors duration-200 border border-blue-500/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      <Wand2 size={14} /> Insert Variable
                    </button>
                    {showVarDropdown && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl overflow-hidden z-50 backdrop-blur-xl">
                        {EMAIL_VARIABLE_TOKENS.map(v => (
                          <button key={v} onClick={() => { setMessageContent(prev => prev + v); setShowVarDropdown(false); }} className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors duration-150 cursor-pointer">{v}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {campaignType === 'Email' && (
                  <div className="mb-3">
                    <label htmlFor="builder-subject" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Subject Line <span className="text-red-500">*</span></label>
                    <input id="builder-subject" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="w-full h-9 rounded-md border border-gray-200 dark:border-white/8 bg-white dark:bg-white/3 px-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors" placeholder="e.g. Welcome to LeadCRM, {{first_name}}!" />
                    <FieldError message={errors.subject} />
                  </div>
                )}
                <label htmlFor="builder-body" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Body <span className="text-red-500">*</span></label>
                <textarea id="builder-body" rows={campaignType === 'Email' ? 8 : 10} className="w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/3 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-200 resize-none leading-relaxed" placeholder={campaignType === 'SMS' ? 'Hi {{first_name}}, ...' : 'Hi {{first_name}},\n\nYour message here...'} value={messageContent} onChange={(e) => setMessageContent(e.target.value)} />
                <FieldError message={errors.body} />
                {campaignType === 'SMS' && (
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{charCount} characters</span><span>{smsPartCount} SMS part{smsPartCount > 1 ? 's' : ''}</span>
                  </div>
                )}
                <div className="mt-2.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1.5">Quick fields:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {EMAIL_VARIABLE_TOKENS.map(tag => (
                      <button key={tag} type="button" onClick={() => setMessageContent(prev => prev + tag)} className="text-[11px] bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-md border border-gray-200 dark:border-white/5 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{tag}</button>
                    ))}
                  </div>
                </div>
              </div>
          </div>
        </fieldset>

        {/* Right Side — Live Preview: always shown on lg+, toggleable on smaller screens */}
        {(showPreview) && (
        <div className="w-full lg:w-105 shrink-0 flex flex-col bg-linear-to-br from-slate-50 via-slate-100 to-blue-50/30 dark:from-[#030712] dark:via-[#0a1020] dark:to-blue-950/10 overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-white/5 bg-white/50 dark:bg-white/2 backdrop-blur-lg">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Live Preview</span>
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5 bg-slate-200/80 dark:bg-white/5 p-0.5 rounded-lg border border-gray-200 dark:border-white/5">
                <button type="button" onClick={() => setPreviewDevice('desktop')} className={`p-1.5 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${previewDevice === 'desktop' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'}`} aria-label="Desktop preview">
                  <Monitor size={14} />
                </button>
                <button type="button" onClick={() => setPreviewDevice('mobile')} className={`p-1.5 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${previewDevice === 'mobile' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'}`} aria-label="Mobile preview">
                  <Smartphone size={14} />
                </button>
              </div>
              {/* Close preview — only visible on smaller screens where it can block content */}
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="lg:hidden p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Close preview"
              >
                <EyeOff size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            {previewDevice === 'mobile' ? (
              <div className="w-70 aspect-9/18 max-h-125 border-[6px] border-slate-800 dark:border-slate-600 rounded-[2.5rem] bg-white dark:bg-[#0c0f16] shadow-2xl shadow-black/20 dark:shadow-black/50 overflow-hidden flex flex-col relative">
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-4 bg-black rounded-xl z-10" />
                <div className="pt-8 px-3 pb-3 flex-1 flex flex-col overflow-hidden text-xs">
                  {campaignType === 'SMS' ? (
                    <div className="flex flex-col h-full">
                      <div className="text-center text-[10px] text-slate-400 dark:text-slate-500 mb-3 font-medium">+639XXXXXXXXX · Today</div>
                      <div className="bg-emerald-500 text-white p-3 rounded-2xl rounded-tr-sm max-w-[85%] self-end wrap-break-word shadow-sm text-[11px] whitespace-pre-wrap leading-relaxed">
                        {getPreviewText(messageContent) || <span className="italic opacity-60">Your SMS message will appear here...</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 text-right mt-1.5 pr-1">Delivered</div>
                      <div className="mt-auto pt-4 text-center"><div className="text-[10px] text-slate-400">{charCount} chars · {smsPartCount} part{smsPartCount > 1 ? 's' : ''}</div></div>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#131924] rounded-lg overflow-hidden border border-gray-200/50 dark:border-white/5">
                      <div className="p-2.5 border-b border-gray-200 dark:border-white/5 bg-white dark:bg-white/3">
                        <div className="font-semibold text-slate-900 dark:text-white text-[11px] truncate">{previewSubject()}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">From: configured sender</div>
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
                      {getPreviewText(messageContent) || <span className="italic opacity-60">Message preview...</span>}
                    </div>
                    <div className="text-[10px] text-slate-400 text-right mt-2 pr-2">Delivered via SIM · Today</div>
                    <div className="mt-4 text-center text-xs text-slate-400">{charCount} chars · {smsPartCount} SMS part{smsPartCount > 1 ? 's' : ''}</div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="p-4 border-b border-gray-200 dark:border-white/5 bg-slate-50/80 dark:bg-white/2">
                      <div className="flex items-center gap-2 text-xs"><span className="text-slate-400 w-14 font-medium">Subject:</span><span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{previewSubject()}</span></div>
                      <div className="flex items-center gap-2 text-xs mt-1"><span className="text-slate-400 w-14 font-medium">From:</span><span className="text-slate-600 dark:text-slate-400">Configured sender</span></div>
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
        )}
      </div>
      {showAudiencePanel && <AudiencePanel onClose={() => setShowAudiencePanel(false)} onCreated={audience => { setAudiences(prev => [...prev, audience]); setTargetAudience(audience.id); setShowAudiencePanel(false); }} />}
    </div>
  );
}
