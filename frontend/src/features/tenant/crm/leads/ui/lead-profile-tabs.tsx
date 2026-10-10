'use client';
import { useTasks } from '@/features/tenant/operations/tasks/use-tasks';
import { RelatedTasks } from '@/features/tenant/operations/tasks/ui/related-tasks';
import { uuid } from '@/lib/utils';

import React, { useState, useEffect } from 'react';
import { 
  User, Mail, Phone, Building, FileText, ChevronRight, MapPin, Tag, Calendar, 
  Clock, Plus, CheckCircle, MessageSquare, Send, Bell, Shield, Layers, HelpCircle, Briefcase, Activity, Edit
} from 'lucide-react';
import { Lead, User as UserType, Deal, Task, Campaign } from '@/store/types';
import { useData } from '@/store/DataContext';
import { ClientProfileFiles } from './lead-profile-files';
import { LeadActivitiesTab } from './tabs/lead-activities-tab';
import { LeadEmailTab } from './tabs/lead-email-tab';
import { LeadSmsTab } from './tabs/lead-sms-tab';
import { DealDetailsModal } from '@/features/tenant/crm/pipeline/ui/deal-details-modal';
import { CustomerJourneyTimeline } from './customer-journey-timeline';
import { ActionableEmptyState } from '@/shared/components/actionable-empty-state';
import { toast } from 'sonner';
import { getCRMStatusStyles, getCRMStatusStripColor, getConnectedDealsForLead } from '@/lib/utils';

interface Props {
  selectedLead: Lead;
  initialTab?: TabType;
  users: UserType[];
  deals: Deal[];
  tasks: Task[];
  campaigns: Campaign[];
  currentUser: UserType | null;
  updateLead: (id: string, updates: Partial<Lead>) => void;
  addTask: (taskData: any) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  onClose: () => void;
  onEditClick?: () => void;
}

export type TabType = 
  | 'overview' 
  | 'activities' 
  | 'notes' 
  | 'emails' 
  | 'sms' 
  | 'tasks' 
  | 'deals' 
  | 'pipelines' 
  | 'campaigns' 
  | 'files' 
  | 'audit';

export const ClientProfileTabs = ({
  selectedLead: lead,
  initialTab = 'overview',
  users,
  deals,
  tasks,
  campaigns,
  currentUser,
  updateLead,
  addTask,
  updateTask,
  onClose,
  onEditClick
}: Props) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const { pipelines = [], updateDeal, deleteDeal } = useData();
  const [selectedDealModal, setSelectedDealModal] = useState<Deal | null>(null);

  // Interactive local states for persistence
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [leadNotes, setLeadNotes] = useState(lead.notes || '');
  const [internalNotes, setInternalNotes] = useState(lead.internalNotes || '');
  
  // Simulated communications state
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const [smsText, setSmsText] = useState('');
  const [isSendingSms, setIsSendingSms] = useState(false);

  // Custom logging inline states
  const [logType, setLogType] = useState<'Call' | 'Meeting' | 'Note'>('Call');
  const [logNotes, setLogNotes] = useState('');

  // Predefined email templates
  const EMAIL_TEMPLATES = [
    { id: 'intro', name: 'CRM Introduction Intro', subject: 'Welcome to TechFlow - CCTV Installation Consultation', body: `Hi ${lead.leadPerson},\n\nThank you for reaching out to us. We would love to evaluate your site for our advanced services.\n\nAre you available for a phone appointment tomorrow?\n\nBest regards,\nCRM Admin Team` },
    { id: 'followup', name: 'Standard Lead Follow Up', subject: 'Following up on your structured cabling quotation', body: `Hi ${lead.leadPerson},\n\nHope you are having a productive week.\n\nI wanted to check if you reviewed the quotation we supplied. Let me know if you would like me to adjust any items.\n\nBest,\n` },
    { id: 'meeting_con', name: 'Consultation Confirmation', subject: 'Confirmed: Technical Site Assessment', body: `Hi ${lead.leadPerson},\n\nThis email confirms your upcoming engineering evaluation scheduled for next Thursday.\n\nOur technician will communicate with you prior to the arrival.\n\nRegards,\n` }
  ];

  // Load activities of this lead
  useEffect(() => {
    const defaultActivities = [
      { id: 'e1', type: 'note', text: 'Lead / Organization CRM record registered in database.', time: lead.createdAt || '3 days ago', user: lead.createdBy || 'System' },
      { id: 'e2', type: 'note', text: `Lead established with status '${lead.status}' and value of $${lead.estimatedValue?.toLocaleString()}.`, time: '3 days ago', user: 'System' },
      { id: 'e3', type: 'note', text: lead.assignedUserId ? `Assigned to representative handler.` : 'Registered as unassigned account.', time: '3 days ago', user: 'System' }
    ];

    const savedActivities = localStorage.getItem(`crm_activities_${lead.id}`);
    if (savedActivities) {
      setTimelineEvents(JSON.parse(savedActivities));
    } else {
      setTimelineEvents(defaultActivities);
    }

    setLeadNotes(lead.notes || '');
    setInternalNotes(lead.internalNotes || '');
  }, [lead]);

  const saveActivities = (updatedList: any[]) => {
    setTimelineEvents(updatedList);
    localStorage.setItem(`crm_activities_${lead.id}`, JSON.stringify(updatedList));
  };

  const addActivityLog = (text: string, type: string = 'note') => {
    const newLog = {
      id: uuid(),
      type,
      text,
      time: 'Just now',
      user: currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'CRM Staff'
    };
    const updated = [newLog, ...timelineEvents];
    saveActivities(updated);
  };

  // Log interaction (Call / Meeting / Note)
  const handleLogInteraction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!logNotes.trim()) return;
    addActivityLog(`Logged custom ${logType}: "${logNotes}"`, 'note');
    setLogNotes('');
    toast.success(`Registered custom ${logType} session directly in timeline!`);
  };

  // Note handler
  const handleSaveNotes = async () => {
    try {
      await updateLead(lead.id, { notes: leadNotes, internalNotes: internalNotes });
      toast.success('Successfully committed notes changes!');
      addActivityLog(`Wrote and saved updated profile internal notes.`, 'note');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update notes");
    }
  };

  // Email simulation
  const handleSendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailBody.trim()) return;
    setIsSendingEmail(true);
    setTimeout(() => {
      addActivityLog(`Email Sent to ${lead.email || 'customer'}. Subject: "${emailSubject}"`, 'email');
      toast.success(`Success! Email dispatched to ${lead.email || 'customer'}`);
      setIsSendingEmail(false);
      setEmailSubject('');
      setEmailBody('');
      setSelectedEmailTemplate('');
    }, 1200);
  };

  const handleApplyTemplate = (id: string) => {
    const selected = EMAIL_TEMPLATES.find(t => t.id === id);
    if (selected) {
      setSelectedEmailTemplate(id);
      setEmailSubject(selected.subject);
      setEmailBody(selected.body);
    }
  };

  // SMS simulation
  const handleSendSms = (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsText.trim()) return;
    setIsSendingSms(true);
    setTimeout(() => {
      addActivityLog(`SMS Sent to ${lead.phone || 'customer'}. Message: "${smsText}"`, 'sms');
      toast.success(`Sms Text delivered successfully.`);
      setIsSendingSms(false);
      setSmsText('');
    }, 1000);
  };

  // Dynamic tags parsed
  const parsedTags = lead.tags ? lead.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Connected Deals — authoritative SSOT helper
  const connectedDeals = React.useMemo(() => {
    return getConnectedDealsForLead(lead, deals);
  }, [lead, deals]);

  // Deal summary stats — derived with enterprise KPI metrics
  const activeDealsList = connectedDeals.filter(d => !['stage_won','stage_lost'].some(s => d.stageId.includes(s.replace('stage_',''))));
  const wonDealsList    = connectedDeals.filter(d => d.stageId.toLowerCase().includes('won'));
  const lostDealsList   = connectedDeals.filter(d => d.stageId.toLowerCase().includes('lost'));

  const pipelineValue = activeDealsList.reduce((sum, d) => sum + (d.value || 0), 0);
  const totalValue    = connectedDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const avgDealSize   = connectedDeals.length > 0 ? Math.round(totalValue / connectedDeals.length) : 0;
  const closedCount   = wonDealsList.length + lostDealsList.length;
  const winRate       = closedCount > 0 ? Math.round((wonDealsList.length / closedCount) * 100) : (wonDealsList.length > 0 ? 100 : 0);

  const dealStats = {
    total:         connectedDeals.length,
    active:        activeDealsList.length,
    won:           wonDealsList.length,
    lost:          lostDealsList.length,
    pipelineValue,
    totalValue,
    avgDealSize,
    winRate,
  };

  const linkedTaskData = useTasks({ leadId: lead.id, limit: 1 });

  // Helper: get real stage name from pipeline data
  const getStageName = (pipelineId: string, stageId: string): string => {
    const pipeline = pipelines.find(p => p.id === pipelineId);
    if (!pipeline) return stageId;
    return pipeline.stages.find(s => s.id === stageId)?.name ?? stageId;
  };



  return (
    <div className="flex flex-col md:flex-row gap-6 h-full text-slate-800 dark:text-slate-100" id="client-profile-container">
      {/* Left Static Side card */}
      <div className="w-full md:w-72 shrink-0 space-y-6">
        <div className="bg-white dark:bg-white/2 border border-gray-150 dark:border-white/4 rounded-2xl p-5 text-center shadow-sm relative overflow-hidden">
          {/* Status highlight strip */}
          <div className={`absolute top-0 left-0 right-0 h-1.5 ${getCRMStatusStripColor(lead.status)}`} />

          <div className="w-16 h-16 mx-auto mt-2 rounded-full bg-linear-to-tr from-sky-400 to-indigo-500 text-white font-extrabold flex items-center justify-center text-2xl uppercase shadow-md shadow-indigo-500/10">
            {lead.firstName ? lead.firstName.charAt(0) : (lead.leadPerson ?? '?').charAt(0)}
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white mt-3 flex items-center justify-center gap-1.5">
            {lead.displayName || lead.leadPerson}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {lead.recordType === 'Individual' 
              ? '🏡 Residential Customer' 
              : `${lead.jobTitle || 'Customer Client'} • ${lead.companyName}`}
          </p>
          
          <div className="mt-4 flex flex-wrap justify-center gap-1">
            {(() => {
              const isHealthy = (connectedDeals.some(d => d.stageId !== 'stage_lost') || (lead.status === 'Hot' || lead.status === 'Warm')) && !((linkedTaskData.summary?.overdue ?? 0) > 0);
              const isAtRisk = ((linkedTaskData.summary?.overdue ?? 0) > 0);
              const healthText = isAtRisk ? '🟡 At Risk' : isHealthy ? '🟢 Healthy' : '🔴 Inactive';
              const healthCls = isAtRisk ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200' : isHealthy ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200';
              return (
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${healthCls}`}>
                  {healthText}
                </span>
              );
            })()}
            <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${getCRMStatusStyles(lead.status)}`}>
              {lead.status} Status
            </span>
            <span className="text-[10px] font-bold bg-blue-500/10 text-blue-400 px-2.5 py-0.5 rounded-full border border-blue-500/10">
              {lead.leadSource || 'Direct Input'}
            </span>
          </div>

          {onEditClick && (
            <button
              onClick={onEditClick}
              className="mt-4 w-full py-1.5 px-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all"
            >
              <Edit size={12} /> Update Profile Details
            </button>
          )}

          <div className="border-t border-gray-100 dark:border-white/5 mt-5 pt-4 text-left space-y-3">
            <div className="flex items-center gap-2.5 text-xs">
              <Mail size={13} className="text-slate-400" />
              <span className="truncate text-slate-700 dark:text-slate-300 font-medium">{lead.email}</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs">
              <Phone size={13} className="text-slate-400" />
              <span className="text-slate-700 dark:text-slate-300 font-medium">{lead.phone || 'No phone number'}</span>
            </div>
            {lead.recordType !== 'Individual' && lead.companyName && (
              <div className="flex items-center gap-2.5 text-xs">
                <Building size={13} className="text-slate-400" />
                <span className="text-slate-700 dark:text-slate-300 font-medium truncate">{lead.companyName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Financial Worth card */}
        <div className="bg-linear-to-br from-indigo-900 to-slate-900 border border-slate-800 text-white rounded-2xl p-5 shadow-sm">
          <div className="text-[10px] uppercase font-bold tracking-wider text-indigo-250">Estimated Potential Value</div>
          <div className="text-2xl font-bold mt-1.5 text-slate-100">${(lead.estimatedValue ?? 0).toLocaleString()}</div>
          <div className="text-[10px] text-slate-400 mt-1">Calculated probability score: {lead.score || 70}/100</div>
          
          <div className="border-t border-white/5 mt-4 pt-3 text-xs flex justify-between items-center text-slate-300">
            <span>Interest Tier:</span>
            <span className="font-semibold text-white">{(lead.estimatedValue ?? 0) > 80000 ? 'High Worth Asset' : 'Midtier Base'}</span>
          </div>
        </div>
      </div>

      {/* Right Details Tabs view */}
      <div className="flex-1 flex flex-col bg-white dark:bg-slate-950 border border-gray-150 dark:border-white/4 rounded-2xl p-5 shadow-sm min-w-0">

        {/* Scrollable horizontal tabs row */}
        <div className="flex gap-1.5 border-b border-gray-200 dark:border-white/5 pb-2.5 overflow-x-auto scrollbar-none shrink-0 mb-6" id="details-tabs-bar">
          {(['overview', 'activities', 'notes', 'emails', 'sms', 'tasks', 'deals', 'pipelines', 'campaigns', 'files', 'audit'] as TabType[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all capitalize whitespace-nowrap ${
                activeTab === tab 
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/5'
              }`}
            >
              {tab === 'sms' ? 'SMS Messages' : tab === 'audit' ? 'Audit History' : tab}
            </button>
          ))}
        </div>

        {/* Tab Body Contents */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6 text-left animate-in fade-in duration-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Section A: Demographic Basics */}
                <div className="space-y-3 p-4 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/3 rounded-xl text-xs">
                  <h4 className="font-bold text-slate-900 dark:text-white border-b border-gray-200 dark:border-white/5 pb-1.5 uppercase tracking-wider text-[10px]">1. Basic Details</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-400 text-[10px] block">First Name</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.firstName || (lead.leadPerson ?? '').split(' ')[0] || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Last Name</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.lastName || (lead.leadPerson ?? '').split(' ').slice(1).join(' ') || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Preferred Name</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.preferredName || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Middle Name</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.middleName || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Suffix / Honorific</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.suffix || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Customer Type</span>
                      <span className="font-semibold text-slate-800 dark:text-[#a0c5f5]">{lead.customerType || 'Individual'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Product Interests</span>
                      <span className="font-semibold text-slate-800 dark:text-[#a0c5f5]">
                        {lead.productInterests && lead.productInterests.length > 0 ? lead.productInterests.join(', ') : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section B: Additional Lead Info */}
                <div className="space-y-3 p-4 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/3 rounded-xl text-xs">
                  <h4 className="font-bold text-slate-900 dark:text-white border-b border-gray-200 dark:border-white/5 pb-1.5 uppercase tracking-wider text-[10px]">2. Communication Directory</h4>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-[10px] block">Secondary Email</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">{lead.secondaryEmail || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Work Email</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">{lead.workEmail || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Alternate Telephone</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 block">{lead.altPhone || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">LinkedIn URL</span>
                      {lead.linkedin ? (
                        <a href={lead.linkedin} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline inline-block font-semibold truncate max-w-full">{lead.linkedin}</a>
                      ) : <span className="text-slate-400">Not linked</span>}
                    </div>
                  </div>
                </div>

                {/* Section C: Complete Address */}
                <div className="sm:col-span-2 space-y-3 p-4 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/3 rounded-xl text-xs">
                  <h4 className="font-bold text-slate-900 dark:text-white border-b border-gray-200 dark:border-white/5 pb-1.5 uppercase tracking-wider text-[10px]">3. Address & Geographical Information</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <span className="text-slate-400 text-[10px] block">Country</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.country || 'Philippines'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Region / Province</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.region || lead.province || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">City / Municipality</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.city || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Barangay</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.barangay || '—'}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 text-[10px] block">Street Address Details</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.streetAddress || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Building / Suite / Unit</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {[lead.building, lead.floor, lead.unit].filter(Boolean).join(', ') || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Postal Code</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.postalCode || '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Section D: Custom fields */}
                <div className="sm:col-span-2 space-y-3 p-4 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/3 rounded-xl text-xs text-left">
                  <h4 className="font-bold text-slate-900 dark:text-white border-b border-gray-200 dark:border-white/5 pb-1.5 uppercase tracking-wider text-[10px]">4. Configured Custom Segmentation Fields</h4>
                  {lead.customFields && Object.keys(lead.customFields).length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(lead.customFields).map(([key, value]) => (
                        <div key={key} className="bg-white dark:bg-white/5 p-2 rounded-lg border border-gray-150 dark:border-white/5">
                          <span className="text-[10px] text-slate-400 block capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                          <span className="font-bold text-slate-800 dark:text-white mt-0.5 inline-block">{value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-slate-500 py-3 text-center border-dashed border border-gray-200 dark:border-white/5 rounded-lg">
                      No custom metadata tags declared. Click Edit Profile on main board to establish fields (e.g. Installation Date).
                    </div>
                  )}
                </div>

                {/* Section E: Connected Tags */}
                <div className="sm:col-span-2 space-y-2">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Classification Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {parsedTags.map(tag => (
                      <span key={tag} className="text-[10px] font-bold bg-indigo-500/10 text-indigo-400 px-2.5 py-1 rounded-md border border-indigo-500/20">
                        Label: {tag}
                      </span>
                    ))}
                    {parsedTags.length === 0 && (
                      <span className="text-xs text-slate-500 italic">No segmentation tags attached.</span>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* TAB 2: ACTIVITIES & CUSTOMER JOURNEY TIMELINE */}
          {activeTab === 'activities' && (
            <div className="space-y-6">
              <CustomerJourneyTimeline
                lead={lead}
                deals={deals}
                onSelectDeal={(d) => setSelectedDealModal(d)}
              />

              <LeadActivitiesTab
                timelineEvents={timelineEvents}
                logType={logType}
                logNotes={logNotes}
                onSetLogType={setLogType}
                onSetLogNotes={setLogNotes}
                onLogInteraction={handleLogInteraction}
              />
            </div>
          )}

          {/* TAB 3: NOTES AND RICH INTERNAL PERSISTENCE */}
          {activeTab === 'notes' && (
            <div className="space-y-4 text-left animate-in fade-in duration-100">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">General Client Notes (Visually Shared)</label>
                <textarea 
                  rows={4} 
                  value={leadNotes} 
                  onChange={e => setLeadNotes(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/5 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-gray-300 dark:focus:border-white/10 transition-all"
                  placeholder="Notes shown on main screens..."
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Internal Private Records (Audit-Locked)</label>
                <textarea 
                  rows={4} 
                  value={internalNotes} 
                  onChange={e => setInternalNotes(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/5 rounded-xl p-3 text-xs text-amber-600 dark:text-amber-400 focus:outline-none focus:border-gray-300 dark:focus:border-white/10 transition-all font-mono"
                  placeholder="Insert confidential credit evaluation or internal warnings here..."
                />
              </div>

              <div className="flex justify-end pt-2">
                <button 
                  type="button" 
                  onClick={handleSaveNotes}
                  className="bg-primary hover:bg-primary/90 font-bold text-white px-4 py-2 rounded-xl text-xs transition-colors shadow-md shadow-blue-500/10"
                >
                  Save Internal Notes
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: EMAIL COMPOSE */}
          {activeTab === 'emails' && (
            <LeadEmailTab
              leadEmail={lead.email ?? ''}
              templates={EMAIL_TEMPLATES}
              emailSubject={emailSubject}
              emailBody={emailBody}
              selectedTemplateId={selectedEmailTemplate}
              isSending={isSendingEmail}
              onApplyTemplate={handleApplyTemplate}
              onSubjectChange={setEmailSubject}
              onBodyChange={setEmailBody}
              onSend={handleSendEmail}
            />
          )}

          {/* TAB 5: SMS DISPATCH */}
          {activeTab === 'sms' && (
            <LeadSmsTab
              smsText={smsText}
              isSending={isSendingSms}
              onSmsTextChange={setSmsText}
              onSend={handleSendSms}
            />
          )}

          {/* TAB 6: TASKS INTEGRATION */}
          {activeTab === 'tasks' && <RelatedTasks links={{ leadId: lead.id }} />}

          {/* TAB 7: DEALS — Enterprise Deals Table with Value column & KPI bar */}
          {activeTab === 'deals' && (
            <div className="space-y-5 text-left animate-in fade-in duration-100">

              {/* Deal Summary Bar */}
              {connectedDeals.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                  {[
                    { label: 'Total Deals',     value: dealStats.total,                                        color: 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300' },
                    { label: 'Active',          value: dealStats.active,                                       color: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400' },
                    { label: 'Pipeline Value',  value: `₱${dealStats.pipelineValue.toLocaleString()}`,         color: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' },
                    { label: 'Won Deals',       value: dealStats.won,                                          color: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
                    { label: 'Win Rate',        value: `${dealStats.winRate}%`,                                color: 'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400' },
                    { label: 'Avg Deal Size',   value: `₱${dealStats.avgDealSize.toLocaleString()}`,           color: 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400' },
                  ].map(stat => (
                    <div key={stat.label} className={`rounded-xl p-3 border border-transparent ${stat.color} text-center`}>
                      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{stat.label}</p>
                      <p className="text-sm sm:text-base font-extrabold mt-0.5">{stat.value}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center border-b border-gray-200 dark:border-white/5 pb-2">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Revenue Opportunities</h4>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  {connectedDeals.length} linked record{connectedDeals.length !== 1 ? 's' : ''}
                </span>
              </div>

              {connectedDeals.length > 0 ? (
                <div className="overflow-x-auto border border-gray-200 dark:border-white/5 rounded-xl bg-white dark:bg-white/1">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-white/5 bg-slate-50/70 dark:bg-white/2">
                        <th className="py-2.5 px-3 font-semibold text-slate-600 dark:text-slate-300">Deal</th>
                        <th className="py-2.5 px-3 font-semibold text-slate-600 dark:text-slate-300 text-right">Value</th>
                        <th className="py-2.5 px-3 font-semibold text-slate-600 dark:text-slate-300">Stage & Pipeline</th>
                        <th className="py-2.5 px-3 font-semibold text-slate-600 dark:text-slate-300">Assigned Agent</th>
                        <th className="py-2.5 px-3 font-semibold text-slate-600 dark:text-slate-300">Priority</th>
                        <th className="py-2.5 px-3 font-semibold text-slate-600 dark:text-slate-300">Expected Close</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                      {connectedDeals.map(deal => {
                        const stageName = getStageName(deal.pipelineId, deal.stageId);
                        const isWon     = stageName === 'Closed Won'  || deal.stageId.toLowerCase().includes('won');
                        const isLost    = stageName === 'Closed Lost' || deal.stageId.toLowerCase().includes('lost');
                        const isOverdue = deal.expectedCloseDate && new Date(deal.expectedCloseDate) < new Date() && !isWon && !isLost;
                        const agent     = users.find(u => u.id === deal.assignedUserId);
                        const agentName = agent ? `${agent.firstName} ${agent.lastName}` : (deal.assignedUserId || 'Unassigned');

                        return (
                          <tr key={deal.id} 
                            onClick={() => setSelectedDealModal(deal)}
                            className="hover:bg-slate-50/80 dark:hover:bg-white/2 transition-colors cursor-pointer group"
                            title="Click to view & edit complete deal details"
                          >
                            {/* 1. Deal Column (Enriched with Title + Subtext) */}
                            <td className="py-3 px-3 min-w-50">
                              <p className="font-bold text-slate-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{deal.title}</p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                {deal.companyName} {deal.leadSource ? `• ${deal.leadSource}` : ''}
                              </p>
                            </td>

                            {/* 2. Value Column (Positioned immediately next to Deal) */}
                            <td className="py-3 px-3 text-right font-black text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {typeof deal.value === 'number' && deal.value > 0 ? (
                                <span className="inline-flex flex-col items-end">
                                  <span>₱{deal.value.toLocaleString('en-PH')}</span>
                                  <span className="text-[9px] font-semibold text-indigo-500 dark:text-indigo-400">PHP</span>
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>

                            {/* 3. Stage & Pipeline */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                isWon  ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20' :
                                isLost ? 'bg-red-100   dark:bg-red-500/10   text-red-700   dark:text-red-400   border border-red-500/20'     :
                                         'bg-blue-100  dark:bg-blue-500/10  text-blue-700  dark:text-blue-400 border border-blue-500/20'
                              }`}>
                                {stageName}
                              </span>
                            </td>

                            {/* 4. Assigned Agent */}
                            <td className="py-3 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              <span className="font-medium">{agentName}</span>
                            </td>

                            {/* 5. Priority */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className={`font-semibold text-[10px] ${
                                deal.priority === 'High' ? 'text-red-500' : deal.priority === 'Medium' ? 'text-amber-500' : 'text-slate-400'
                              }`}>
                                {deal.priority}
                              </span>
                            </td>

                            {/* 6. Expected Close Date */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className={`font-medium ${isOverdue ? 'text-red-500 font-bold' : 'text-slate-600 dark:text-slate-400'}`}>
                                {deal.expectedCloseDate || '—'}
                                {isOverdue && ' ⚠'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* Actionable Empty State */
                <div className="py-12 text-center border border-dashed border-gray-200 dark:border-white/10 rounded-xl bg-slate-50/50 dark:bg-white/1">
                  <Briefcase className="w-10 h-10 mx-auto text-slate-400 opacity-40 mb-2" />
                  <h5 className="font-bold text-sm text-slate-700 dark:text-slate-200">No deals found</h5>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">This client has no associated opportunities yet.</p>
                  <button 
                    onClick={() => toast.info('Initiate new deal creation from the Deals page or Pipeline module.')}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-white shadow-sm transition-colors"
                  >
                    <Plus size={14} />
                    Create Deal
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 8: PIPELINE STAGE TRACKER — real pipeline data */}
          {activeTab === 'pipelines' && (
            <div className="space-y-4 text-left animate-in fade-in duration-100">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Pipeline Stage Tracking</h4>
              {connectedDeals.length > 0 ? (
                <div className="space-y-4">
                  {connectedDeals.map(deal => {
                    const pipeline = pipelines.find(p => p.id === deal.pipelineId);
                    if (!pipeline) return null;
                    const currentStageIdx = pipeline.stages.findIndex(s => s.id === deal.stageId);
                    const currentStageName = pipeline.stages[currentStageIdx]?.name ?? '—';

                    return (
                      <div key={deal.id} className="bg-slate-50 dark:bg-white/1 border border-gray-200 dark:border-white/3 p-4 rounded-xl space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-900 dark:text-white truncate pr-2">{deal.title}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">{pipeline.name}</span>
                        </div>

                        {/* Real stage progress bar */}
                        <div className="space-y-1.5">
                          <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${pipeline.stages.length}, 1fr)` }}>
                            {pipeline.stages.map((stage, idx) => {
                              const isCompleted = idx < currentStageIdx;
                              const isCurrent   = idx === currentStageIdx;
                              const isWonStage  = stage.name === 'Closed Won'  || stage.name.toLowerCase().includes('won');
                              const isLostStage = stage.name === 'Closed Lost' || stage.name.toLowerCase().includes('lost');
                              return (
                                <div key={stage.id} className="space-y-1" title={stage.name}>
                                  <div className={`h-1.5 rounded-full transition-all ${
                                    isCurrent && isWonStage  ? 'bg-emerald-500' :
                                    isCurrent && isLostStage ? 'bg-red-500' :
                                    isCurrent                ? 'bg-blue-500 shadow-sm shadow-blue-500/40' :
                                    isCompleted              ? 'bg-blue-300 dark:bg-blue-500/40' :
                                                               'bg-slate-200 dark:bg-white/5'
                                  }`} />
                                  <span className={`text-[8px] block truncate ${isCurrent ? 'text-blue-500 font-bold' : 'text-slate-400'}`}>
                                    {stage.name}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-slate-500 pt-1">
                            Current stage: <strong className="text-slate-700 dark:text-slate-300">{currentStageName}</strong>
                            {deal.expectedCloseDate && (
                              <span className="ml-2 text-slate-400">· Close: {deal.expectedCloseDate}</span>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic py-4 border border-dotted border-gray-200 dark:border-white/5 rounded-xl text-center">
                  No deals linked to this lead. Create a deal in Pipeline Management to track stages here.
                </div>
              )}
            </div>
          )}

          {/* TAB 9: CAMPAIGNS SUBSCRIPTIONS */}
          {activeTab === 'campaigns' && (
            <div className="space-y-4 text-left animate-in fade-in duration-100">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Channel Newsletter Distributions</h4>
              <div className="space-y-2">
                {campaigns.slice(0, 2).map((camp, idx) => (
                  <div key={camp.id || idx} className="p-3.5 bg-white dark:bg-white/2 border border-gray-150 dark:border-white/3 rounded-xl flex items-center justify-between text-xs">
                    <div className="text-left">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 block">{camp.name}</span>
                      <span className="text-[10px] text-slate-500 block mt-0.5">Subject: Welcome Promo Discount Series</span>
                    </div>
                    <span className="bg-emerald-500/10 text-emerald-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase tracking-wider">
                      Subscribed
                    </span>
                  </div>
                ))}
                {campaigns.length === 0 && (
                  <div className="p-3 p-y-4 bg-white dark:bg-white/2 border border-gray-150 dark:border-white/3 rounded-xl flex items-center justify-between text-xs">
                    <div className="text-left">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 block">Outbound Newsletter Loop</span>
                      <span className="text-[10px] text-slate-500 block mt-0.5">Status: Not actively targeted</span>
                    </div>
                    <span className="bg-slate-500/10 text-slate-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-slate-500/20 uppercase tracking-wider">
                      Inactive
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 10: SIMULATED FILES ATTACHMENTS */}
          {activeTab === 'files' && (
            <div className="animate-in fade-in duration-100">
              <ClientProfileFiles leadId={lead.id} currentUser={currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'CRM Staff'} />
            </div>
          )}

          {/* TAB 11: AUDIT RECORD HISTORY */}
          {activeTab === 'audit' && (
            <div className="space-y-4 text-left animate-in fade-in duration-100">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Record Modification Integrity Logs</h4>
              <div className="space-y-2">
                <div className="p-3 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/2 rounded-xl text-[11px] space-y-1">
                  <div className="flex justify-between items-center text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                    <span>Modifying User: CRM Web Service</span>
                    <span>Just now</span>
                  </div>
                  <p className="font-medium text-slate-800 dark:text-slate-350">Committed complete profile update matching the new 8 Sections Redesign system schema.</p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/2 rounded-xl text-[11px] space-y-1">
                  <div className="flex justify-between items-center text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                    <span>Modifying User: System</span>
                    <span>3 days ago</span>
                  </div>
                  <p className="font-medium text-slate-800 dark:text-slate-350">Instantiated central index representation for '{lead.companyName}' with key leads setup.</p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
