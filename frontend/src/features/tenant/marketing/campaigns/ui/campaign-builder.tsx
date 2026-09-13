'use client';

import React, { useState } from 'react';
import { useData } from '@/store/DataContext';
import { toast } from 'sonner';
import {
  ArrowLeft, Send, Mail, MessageSquare, Calendar, Plus, Trash2,
  Wand2, Monitor, Smartphone, ListOrdered, Zap, Tags, Clock, Loader2,
  EyeOff, Eye,
} from 'lucide-react';
import { DatePicker, TimePicker } from '@/shared/components/ui/date-time-picker';
import { campaignsApi } from '@/shared/services/campaigns.api';

type CampaignType = 'Email' | 'SMS' | 'Multi-Channel';

interface CampaignBuilderProps {
  onBack: () => void;
  onCreateAudience?: () => void;
  initialType?: string;
  initialContent?: string;
  targetAudiences?: string[];
}

export function CampaignBuilder({
  onBack,
  onCreateAudience,
  initialType,
  initialContent,
  targetAudiences = ['All Contacts'],
}: CampaignBuilderProps) {
  const { addCampaign } = useData();
  const [campaignName, setCampaignName] = useState('');
  const [campaignType, setCampaignType] = useState<CampaignType>(
    (initialType as CampaignType) || 'Email',
  );
  const [targetAudience, setTargetAudience] = useState(targetAudiences[0] ?? 'All Contacts');
  const [messageContent, setMessageContent] = useState(initialContent || '');
  const [emailSubject, setEmailSubject] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [isTriggerBased, setIsTriggerBased] = useState(false);
  const [triggerEvent, setTriggerEvent] = useState('status_hot');
  const [isSequence, setIsSequence] = useState(false);
  const [sequenceSteps, setSequenceSteps] = useState([{ delay: 0, unit: 'days', content: '' }]);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('mobile');
  const [showPreview, setShowPreview] = useState(true);
  const [showVarDropdown, setShowVarDropdown] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const toApiType = (t: CampaignType): 'EMAIL' | 'SMS' | 'MULTI_CHANNEL' =>
    t === 'Email' ? 'EMAIL' : t === 'SMS' ? 'SMS' : 'MULTI_CHANNEL';

  const getPreviewText = (text: string): string => {
    if (!text) return '';
    return text
      .replace(/\{\{first_name\}\}/g, 'John')
      .replace(/\{\{last_name\}\}/g, 'Doe')
      .replace(/\{\{company_name\}\}/g, 'Acme Corporation')
      .replace(/\{\{sender_name\}\}/g, 'Sarah Jenkins')
      .replace(/\{\{sender_email\}\}/g, 'sjenkins@leadcrm.com')
      .replace(/\{\{contact_number\}\}/g, '+639123456789')
      .replace(/\{\{status\}\}/g, 'HOT');
  };

  const previewSubject = (): string => {
    if (emailSubject) return emailSubject.replace(/\{\{first_name\}\}/g, 'John').replace(/\{\{last_name\}\}/g, 'Doe').replace(/\{\{company_name\}\}/g, 'Acme Corporation');
    return campaignName || 'LeadCRM Broadcast';
  };

  const handleSend = async (): Promise<void> => {
    if (!campaignName.trim()) { toast.error('Please enter a campaign name.'); return; }
    if (campaignType === 'Email' && !emailSubject.trim()) { toast.error('Please enter a subject line.'); return; }
    if (isScheduling && (!scheduleDate || !scheduleTime)) { toast.error('Please specify both Date and Time for scheduling.'); return; }

    setIsSending(true);
    try {
      const createRes = await campaignsApi.create({
        name: campaignName,
        type: toApiType(campaignType),
        body: messageContent,
        subject: campaignType === 'Email' ? emailSubject : undefined,
      } as unknown as Parameters<typeof campaignsApi.create>[0]);

      const created = createRes?.data ?? createRes;
      const campaignId = (created as { id: string }).id;

      if (isScheduling) {
        const datetime = new Date(`${scheduleDate}T${scheduleTime}`);
        await campaignsApi.update(campaignId, {
          scheduledFor: datetime.toISOString(),
          status: 'scheduled',
        } as Parameters<typeof campaignsApi.update>[1]);
        toast.success(`Campaign "${campaignName}" scheduled!`);
      } else {
        await campaignsApi.send(campaignId);
        toast.success(`Campaign "${campaignName}" sent!`);
      }

      onBack();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send campaign');
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveDraft = async (): Promise<void> => {
    if (!campaignName.trim()) { toast.error('Please enter a campaign name.'); return; }

    setIsSending(true);
    try {
      const frontendType = campaignType === 'SMS' ? 'Sms' : campaignType === 'Multi-Channel' ? 'Multi-Channel' : 'Email';
      await addCampaign({
        name: campaignName,
        type: frontendType,
        body: messageContent,
        subject: campaignType === 'Email' ? emailSubject : undefined,
        status: 'Draft',
        targetAudience,
        description: undefined,
        isArchived: false,
      } as Parameters<typeof addCampaign>[0]);
      toast.success(`Draft "${campaignName}" saved!`);
      onBack();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setIsSending(false);
    }
  };

  const charCount = messageContent.length;
  const smsPartCount = Math.ceil(charCount / 160) || 1;
  const toggleCls = 'w-9 h-5 bg-gray-300 dark:bg-slate-600 peer-focus:ring-2 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:shadow-sm after:transition-all duration-200';
  const cardCls = 'flex items-center justify-between p-4 bg-white/60 dark:bg-white/2 backdrop-blur-sm border border-gray-200 dark:border-white/5 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200';
  const inputCls = 'w-full h-9 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-white/3 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-200';

  return (
    <div className="w-full h-full flex flex-col">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 dark:border-white/5 bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl px-4 sm:px-6 py-3 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label="Back to campaigns" className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
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
          <button onClick={handleSaveDraft} disabled={isSending} className="px-3 sm:px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 rounded-lg border border-gray-200 dark:border-white/10 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
            Save Draft
          </button>
          <button onClick={handleSend} disabled={isSending} className="flex items-center gap-2 px-4 sm:px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-blue-500/20 active:scale-95 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSending ? <Loader2 size={16} className="animate-spin" /> : isScheduling ? <Calendar size={16} /> : <Send size={16} />}
            {isScheduling ? 'Schedule' : 'Send Now'}
          </button>
        </div>
      </div>

      {/* Split Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Editor */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-white/5">
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Campaign Details</h3>
            <div>
              <label htmlFor="builder-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Campaign Name <span className="text-red-500">*</span></label>
              <input id="builder-name" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className={`${inputCls} placeholder:text-slate-400`} placeholder="e.g. Q3 Newsletter" />
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
                  <label htmlFor="builder-audience" className="text-sm font-medium text-slate-700 dark:text-slate-300">Target Audience</label>
                  <button type="button" onClick={() => onCreateAudience?.()} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors duration-200 flex items-center gap-1 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-0.5 rounded border border-blue-500/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                    <Plus size={11} className="stroke-[3px]" /> Create New
                  </button>
                </div>
                <div className="relative">
                  <select id="builder-audience" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} className={`${inputCls} appearance-none cursor-pointer pr-8`}>
                    {targetAudiences.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <Tags size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-white/3" />
          {/* Automation */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Automation</h3>
            <div className={cardCls}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20"><ListOrdered size={16} className="text-emerald-500" /></div>
                <div><h4 className="text-sm font-medium text-slate-900 dark:text-white">Drip Sequence</h4><p className="text-xs text-slate-500 dark:text-slate-400">Multi-step campaign</p></div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={isSequence} onChange={() => setIsSequence(!isSequence)} />
                <div className={`${toggleCls} peer-focus:ring-blue-500/20 peer-checked:bg-emerald-500`} />
              </label>
            </div>
            <div className={cardCls}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20"><Clock size={16} className="text-blue-500" /></div>
                <div><h4 className="text-sm font-medium text-slate-900 dark:text-white">Schedule Campaign</h4><p className="text-xs text-slate-500 dark:text-slate-400">Send at a later date and time</p></div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={isScheduling} onChange={() => setIsScheduling(!isScheduling)} />
                <div className={`${toggleCls} peer-focus:ring-blue-500/20 peer-checked:bg-blue-600`} />
              </label>
            </div>
            {isScheduling && (
              <div className="p-4 bg-white/60 dark:bg-white/2 backdrop-blur-sm border border-gray-200 dark:border-white/5 rounded-xl space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="builder-date" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                      <span className="flex items-center gap-1.5"><Calendar size={12} /> Date</span>
                    </label>
                    <DatePicker id="builder-date" value={scheduleDate} onChange={setScheduleDate} minDate={new Date().toISOString().split('T')[0]} placeholder="Pick a date" />
                  </div>
                  <div>
                    <label htmlFor="builder-time" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                      <span className="flex items-center gap-1.5"><Clock size={12} /> Time</span>
                    </label>
                    <TimePicker id="builder-time" value={scheduleTime} onChange={setScheduleTime} placeholder="Pick a time" />
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50/80 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-500/20 rounded-lg">
                  <Clock size={13} className="text-blue-500 shrink-0" />
                  <span className="text-xs text-blue-700 dark:text-blue-300 font-medium">Timezone: Asia/Manila (UTC+8)</span>
                </div>
              </div>
            )}
            <div className={cardCls}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20"><Zap size={16} className="text-amber-500" /></div>
                <div><h4 className="text-sm font-medium text-slate-900 dark:text-white">Trigger Automation</h4><p className="text-xs text-slate-500 dark:text-slate-400">Send automatically based on events</p></div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={isTriggerBased} onChange={() => setIsTriggerBased(!isTriggerBased)} disabled={isScheduling} />
                <div className={`${toggleCls} peer-focus:ring-amber-500/20 peer-checked:bg-amber-500 peer-disabled:opacity-50`} />
              </label>
            </div>
            {isTriggerBased && (
              <div className="p-4 bg-white/60 dark:bg-white/2 backdrop-blur-sm border border-gray-200 dark:border-white/5 rounded-xl">
                <label htmlFor="builder-trigger" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">When this event occurs:</label>
                <select id="builder-trigger" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} className={`${inputCls} appearance-none cursor-pointer`}>
                  <option value="status_hot">Contact becomes Hot</option>
                  <option value="deal_proposal">Deal moved to Proposal</option>
                  <option value="no_reply_3d">No reply for 3 days</option>
                  <option value="new_customer">New customer created</option>
                </select>
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 dark:border-white/3" />
          {/* Message Content */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Message Content</h3>
            {isSequence ? (
              <div className="space-y-4">
                {sequenceSteps.map((step, index) => (
                  <div key={index} className="p-4 bg-white/60 dark:bg-white/2 backdrop-blur-sm border border-gray-200 dark:border-white/5 rounded-xl">
                    <div className="flex justify-between items-center mb-3">
                      <h5 className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs font-bold">{index + 1}</span>
                        Step {index + 1}
                      </h5>
                      {index > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 dark:text-slate-400">Wait</span>
                          <input type="number" className="w-14 h-7 rounded-md border border-gray-200 dark:border-white/8 bg-white dark:bg-white/3 px-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 transition-colors" value={step.delay}
                            onChange={(e) => { const updated = [...sequenceSteps]; updated[index] = { ...updated[index], delay: parseInt(e.target.value) || 0 }; setSequenceSteps(updated); }} />
                          <select className="h-7 rounded-md border border-gray-200 dark:border-white/8 bg-white dark:bg-white/3 px-2 text-xs text-slate-900 dark:text-white appearance-none focus:outline-none focus:border-blue-500 transition-colors cursor-pointer" value={step.unit}
                            onChange={(e) => { const updated = [...sequenceSteps]; updated[index] = { ...updated[index], unit: e.target.value }; setSequenceSteps(updated); }}>
                            <option value="minutes">min</option>
                            <option value="hours">hrs</option>
                            <option value="days">days</option>
                          </select>
                          <button type="button" onClick={() => setSequenceSteps(sequenceSteps.filter((_, i) => i !== index))} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors cursor-pointer" aria-label="Remove step">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                    <textarea rows={3} className="w-full rounded-md border border-gray-200 dark:border-white/8 bg-white dark:bg-white/3 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors resize-none" placeholder="Message content for this step..." value={step.content}
                      onChange={(e) => { const updated = [...sequenceSteps]; updated[index] = { ...updated[index], content: e.target.value }; setSequenceSteps(updated); }} />
                  </div>
                ))}
                <button type="button" onClick={() => setSequenceSteps([...sequenceSteps, { delay: 3, unit: 'days', content: '' }])} className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer px-2 py-1">
                  <Plus size={14} /> Add Next Step
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Content <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <button onClick={() => setShowVarDropdown(!showVarDropdown)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 rounded-md hover:bg-blue-500/20 transition-colors duration-200 border border-blue-500/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      <Wand2 size={14} /> Insert Variable
                    </button>
                    {showVarDropdown && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl overflow-hidden z-50 backdrop-blur-xl">
                        {['{{first_name}}', '{{last_name}}', '{{company_name}}', '{{contact_number}}', '{{status}}', '{{sender_name}}', '{{sender_email}}'].map(v => (
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
                  </div>
                )}
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Body <span className="text-red-500">*</span></label>
                <textarea rows={campaignType === 'Email' ? 8 : 10} className="w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/3 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-200 resize-none leading-relaxed" placeholder={campaignType === 'SMS' ? 'Hi {{first_name}}, ...' : 'Hi {{first_name}},\n\nYour message here...'} value={messageContent} onChange={(e) => setMessageContent(e.target.value)} />
                {campaignType === 'SMS' && (
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{charCount} characters</span><span>{smsPartCount} SMS part{smsPartCount > 1 ? 's' : ''}</span>
                  </div>
                )}
                <div className="mt-2.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1.5">Quick fields:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {['{{first_name}}', '{{last_name}}', '{{company_name}}', '{{contact_number}}', '{{sender_name}}'].map(tag => (
                      <button key={tag} type="button" onClick={() => setMessageContent(prev => prev + tag)} className="text-[11px] bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-md border border-gray-200 dark:border-white/5 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{tag}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

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
                        <div className="text-[9px] text-slate-500 mt-0.5">From: you@gmail.com</div>
                        <div className="text-[9px] text-slate-500">To: John Doe &lt;jdoe@example.com&gt;</div>
                      </div>
                      <div className="p-3 flex-1 overflow-y-auto text-slate-700 dark:text-slate-300 leading-relaxed text-[11px] whitespace-pre-wrap">
                        {getPreviewText(messageContent) || <span className="opacity-50 italic">Your email preview will appear here...</span>}
                      </div>
                      <div className="p-2 border-t border-gray-100 dark:border-white/3 text-[9px] text-slate-400 text-center">
                        <span className="text-blue-500 underline cursor-pointer">Unsubscribe</span> from future emails.
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
                      <div className="flex items-center gap-2 text-xs mt-1"><span className="text-slate-400 w-14 font-medium">From:</span><span className="text-slate-600 dark:text-slate-400">you@gmail.com</span></div>
                      <div className="flex items-center gap-2 text-xs mt-1"><span className="text-slate-400 w-14 font-medium">To:</span><span className="text-slate-600 dark:text-slate-400">John Doe ({targetAudience})</span></div>
                    </div>
                    <div className="p-5 flex-1 overflow-y-auto text-slate-700 dark:text-slate-300 text-sm whitespace-pre-wrap leading-relaxed">
                      {getPreviewText(messageContent) || <p className="opacity-50 italic text-center py-8 text-slate-400">Your email preview will appear here...</p>}
                    </div>
                    <div className="p-3 border-t border-gray-100 dark:border-white/3 text-[10px] text-slate-400 text-center">
                      You received this email because you are subscribed. <span className="text-blue-500 underline cursor-pointer">Unsubscribe</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
