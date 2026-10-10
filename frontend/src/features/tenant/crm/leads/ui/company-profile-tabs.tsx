'use client';
import { RelatedTasks } from '@/features/tenant/operations/tasks/ui/related-tasks';
import { uuid } from '@/lib/utils';

import React, { useState, useEffect } from 'react';
import { 
  Building, Mail, Phone, FileText, ChevronRight, MapPin, Tag, Calendar, 
  Clock, Plus, CheckCircle, MessageSquare, Send, Bell, Shield, Layers, HelpCircle, Briefcase, Activity, Edit, Users, Globe
} from 'lucide-react';
import { Lead, Organization, User as UserType, Deal, Task, Campaign } from '@/store/types';
import { useData } from '@/store/DataContext';
import { LeadActivitiesTab } from './tabs/lead-activities-tab';
import { LeadEmailTab } from './tabs/lead-email-tab';
import { LeadSmsTab } from './tabs/lead-sms-tab';
import { DealDetailsModal } from '@/features/tenant/crm/pipeline/ui/deal-details-modal';
import { toast } from 'sonner';
import { getCRMStatusStyles, getCRMStatusStripColor, getConnectedDealsForOrg } from '@/lib/utils';



export type ExtendedOrg = Organization & { leads: Lead[]; address?: string; status?: any; leadSource?: string; estimatedValue?: number; repId?: string };

interface Props {
  selectedOrg: ExtendedOrg;
  initialTab?: OrgTabType;
  users: UserType[];
  deals: Deal[];
  tasks: Task[];
  campaigns: Campaign[];
  currentUser: UserType | null;
  updateLead: (id: string, updates: Partial<Lead>) => void;
  addTask: (taskData: any) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  onClose: () => void;
  handleSyncCompanyDetails: (companyNameRef: string, updates: Partial<Lead>) => void;
  onEditClick?: () => void;
  setSelectedLead?: (lead: Lead | null) => void;
  setSelectedOrgName?: (orgName: string | null) => void;
}

export type OrgTabType = 
  | 'overview' 
  | 'leads'
  | 'activities' 
  | 'notes' 
  | 'emails' 
  | 'sms' 
  | 'tasks' 
  | 'deals' 
  | 'cascade';

export const CompanyProfileTabs = ({
  selectedOrg,
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
  handleSyncCompanyDetails,
  onEditClick,
  setSelectedLead,
  setSelectedOrgName
}: Props) => {
  const { 
    contacts: allLeads = [], 
    pipelines = [], 
    updateDeal, 
    deleteDeal, 
    activities,
    addActivity,
    updateOrganization
  } = useData();

  const [activeTab, setActiveTab ] = useState<OrgTabType>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Interactive local states for persistence
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [companyNotes, setCompanyNotes] = useState(selectedOrg.notes || '');
  const [internalNotes, setInternalNotes] = useState(selectedOrg.internalNotes || '');
  
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

  // Cascade states
  const [cascadeWeb, setCascadeWeb] = useState(selectedOrg.website !== 'N/A' ? selectedOrg.website : '');
  const [cascadeIndustry, setCascadeIndustry] = useState(selectedOrg.industry);
  const [cascadeSize, setCascadeSize] = useState<string | undefined>(selectedOrg.size);
  const [cascadeAddress, setCascadeAddress] = useState(selectedOrg.address !== 'N/A' ? selectedOrg.address : '');

  // Predefined email templates
  const EMAIL_TEMPLATES = [
    { id: 'intro', name: 'Corporate Intro', subject: `TechFlow Business Partnership - ${selectedOrg.name}`, body: `Dear members of ${selectedOrg.name},\n\nWe would like to introduce our executive enterprise infrastructure offerings tailored specifically for the ${selectedOrg.industry} industry.\n\nAre you available for a structured assessment meeting next Tuesday?\n\nBest regards,\nEnterprise Solutions Architect` },
    { id: 'proposal', name: 'Enterprise Proposal Focus', subject: `Executive Network Proposal: ${selectedOrg.name}`, body: `Dear Management Team,\n\nFollowing up on our engineering consultation. We have formulated a tailored scope of services representing a custom deployment.\n\nLet us know if you require any adjustments.\n\nWarm regards,\n` },
    { id: 'review', name: 'Strategic Account Review', subject: `Quarterly Account Evaluation: ${selectedOrg.name}`, body: `Dear partners,\n\nWe wish to organize an automated telemetry review of the cabling work conducted on your offices.\n\nPlease confirm availability for a 15-minute briefing.\n\nRespectfully,\n` }
  ];

  // Load activities of this company
  useEffect(() => {
    setCompanyNotes(selectedOrg.notes || '');
    setInternalNotes(selectedOrg.internalNotes || '');

    // Reset cascades
    setCascadeWeb(selectedOrg.website !== 'N/A' ? selectedOrg.website : '');
    setCascadeIndustry(selectedOrg.industry);
    setCascadeSize(selectedOrg.size);
    setCascadeAddress(selectedOrg.address !== 'N/A' ? selectedOrg.address : '');

  }, [selectedOrg]);

  const orgActivities = activities
    .filter(a => (a as any).organizationId === selectedOrg.id || (a.relatedToType === 'company' && a.relatedToId === selectedOrg.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(a => ({
      id: a.id,
      type: a.type,
      text: a.title || a.description || (a as any).notes || a.type,
      time: new Date(a.createdAt).toLocaleDateString(),
      user: users.find(u => u.id === (a.createdBy || (a as any).userId))?.firstName || (a.createdBy === 'note' ? 'System' : 'Admin')
    }));

  const saveActivities = (updatedList: any[]) => {
    // Legacy function, no longer used directly as activities are saved to DB
  };

  const addActivityLog = (text: string, type: string = 'note') => {
    addActivity({
      type: type as any,
      title: text,
      relatedToType: 'company',
      relatedToId: selectedOrg.id,
      createdBy: currentUser?.id || 'note',
      createdAt: new Date().toISOString(),
    });
  };

  const handleLogInteraction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!logNotes.trim()) return;
    addActivityLog(`Logged Corporate interaction [${logType}]: "${logNotes}"`, 'note');
    setLogNotes('');
    toast.success(`Registered interaction for ${selectedOrg.name}!`);
  };

  const handleSaveNotes = () => {
    updateOrganization(selectedOrg.id, { notes: companyNotes, internalNotes: internalNotes });
    toast.success('Successfully updated corporate records!');
    addActivityLog(`Modified central organization internal dossiers.`, 'note');
  };

  const handleSendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailBody.trim()) return;
    setIsSendingEmail(true);
    setTimeout(() => {
      addActivityLog(`Enterprise Broadcast Sent to all ${selectedOrg.leads.length} key leads. Subject: "${emailSubject}"`, 'email');
      toast.success(`Enterprise dispatch broadcasted successfully to personnel of ${selectedOrg.name}`);
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

  const handleSendSms = (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsText.trim()) return;
    setIsSendingSms(true);
    setTimeout(() => {
      addActivityLog(`SMS Broadcaster Disposed to corporate lead loop. Text: "${smsText}"`, 'sms');
      toast.success(`Corporate mobile notification sent.`);
      setIsSendingSms(false);
      setSmsText('');
    }, 1000);
  };

  const handlePerformCascadeWeb = (e: React.FormEvent) => {
    e.preventDefault();
    const fields: Partial<Lead> = {};
    if (cascadeWeb) { fields.orgWebsite = cascadeWeb; fields.website = cascadeWeb; }
    if (cascadeIndustry) { fields.businessType = cascadeIndustry; }
    if (cascadeSize) { fields.companySize = cascadeSize; }
    if (cascadeAddress) { fields.address = cascadeAddress; }

    handleSyncCompanyDetails(selectedOrg.name, fields);
    addActivityLog(`Executed global parameter sync: website, industry, size coordinates.`, 'note');
  };

  const [selectedDealModal, setSelectedDealModal] = useState<Deal | null>(null);

  const orgLeads = selectedOrg?.leads || [];

  // Connected Deals — authoritative SSOT helper
  const connectedDeals = React.useMemo(() => {
    return getConnectedDealsForOrg(selectedOrg, deals, allLeads);
  }, [selectedOrg, deals, allLeads]);

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

  const getStageName = (pipelineId: string, stageId: string): string => {
    const pipeline = pipelines.find(p => p.id === pipelineId);
    if (!pipeline) return stageId;
    return pipeline.stages.find(s => s.id === stageId)?.name ?? stageId;
  };



  const assignedRep = users.find(u => u.id === selectedOrg.repId);

  return (
    <div className="flex flex-col md:flex-row gap-6 h-full text-slate-800 dark:text-slate-100" id="company-profile-container">
       {/* Left Static Side card */}
      <div className="w-full md:w-72 shrink-0 space-y-6">
        <div className="bg-white dark:bg-white/2 border border-gray-150 dark:border-white/4 rounded-2xl p-5 text-center shadow-sm relative overflow-hidden">
          {/* Glowing border highlight strip */}
          <div className={`absolute top-0 left-0 right-0 h-1.5 animate-pulse ${getCRMStatusStripColor(selectedOrg?.status || 'Customer')}`} />

          <div className="w-16 h-16 mx-auto mt-2 rounded-full bg-linear-to-tr from-orange-400 to-amber-500 text-white font-extrabold flex items-center justify-center text-2xl uppercase shadow-md shadow-amber-500/10">
            {(selectedOrg?.name || 'O').charAt(0)}
          </div>
          
          <h3 className="text-base font-bold text-slate-900 dark:text-white mt-3 flex items-center justify-center gap-1.5">
            {selectedOrg?.name || 'Organization'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            🏢 {selectedOrg?.industry || 'General'} • Corporate Account
          </p>
          
          <div className="mt-4 flex flex-wrap justify-center gap-1">
            <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${getCRMStatusStyles(selectedOrg?.status || 'Customer')}`}>
              {selectedOrg?.status || 'Customer'} Account
            </span>
            <span className="text-[10px] font-bold bg-primary/10 text-blue-400 px-2.5 py-0.5 rounded-full border border-primary/10">
              {selectedOrg?.leadSource || 'Website Portal'}
            </span>
          </div>

          {onEditClick && (
            <button
              onClick={onEditClick}
              className="mt-4 w-full py-1.5 px-3 bg-primary hover:bg-blue-550 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all"
            >
              <Edit size={12} /> Update Company Details
            </button>
          )}

          <div className="border-t border-gray-100 dark:border-white/5 mt-5 pt-4 text-left space-y-3">
            <div className="flex items-center gap-2.5 text-xs">
              <Globe size={13} className="text-slate-400 shrink-0" />
              <span className="truncate text-slate-705 dark:text-slate-300 font-medium">
                {selectedOrg?.website && selectedOrg.website !== 'N/A' ? (
                  <a href={selectedOrg.website.startsWith('http') ? selectedOrg.website : `https://${selectedOrg.website}`} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                    {selectedOrg.website}
                  </a>
                ) : 'No website synced'}
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-xs">
              <Users size={13} className="text-slate-400 shrink-0" />
              <span className="text-slate-705 dark:text-slate-300 font-bold">{orgLeads.length} Associated Leads</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs">
              <MapPin size={13} className="text-slate-400 shrink-0" />
              <span className="text-slate-705 dark:text-slate-300 font-medium truncate" title={selectedOrg?.address && selectedOrg.address !== 'N/A' ? selectedOrg.address : 'HQ'}>
                {selectedOrg?.address && selectedOrg.address !== 'N/A' ? selectedOrg.address : 'Unverified Address'}
              </span>
            </div>
          </div>
        </div>

        {/* Dynamic Financial Worth card */}
        <div className="bg-linear-to-br from-indigo-900 to-slate-900 border border-slate-800 text-white rounded-2xl p-5 shadow-sm">
          <div className="text-[10px] uppercase font-bold tracking-wider text-indigo-250">Combined B2B Account Worth</div>
          <div className="text-2xl font-bold mt-1.5 text-slate-100">${(selectedOrg.estimatedValue ?? 0).toLocaleString()}</div>
          <p className="text-[10px] text-slate-400 mt-1 leading-snug">Weighted based on aggregate lead files from personnel leads.</p>
          
          <div className="border-t border-white/5 mt-4 pt-3 text-xs flex justify-between items-center text-slate-300">
            <span>Corporate Tier:</span>
            <span className="font-semibold text-white">{(selectedOrg.estimatedValue ?? 0) > 150000 ? 'Tier-1 Key Account' : 'Midmarket Entity'}</span>
          </div>
        </div>
      </div>

      {/* Right Details Tabs view */}
      <div className="flex-1 flex flex-col bg-white dark:bg-slate-950 border border-gray-150 dark:border-white/4 rounded-2xl p-5 shadow-sm min-w-0">
        {/* Scrollable horizontal tabs row */}
        <div className="flex gap-1.5 border-b border-gray-200 dark:border-white/5 pb-2.5 overflow-x-auto scrollbar-none shrink-0 mb-6" id="details-tabs-bar">
          {(['overview', 'leads', 'activities', 'notes', 'emails', 'sms', 'tasks', 'deals', 'cascade'] as OrgTabType[]).map((tab) => (
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
              {tab === 'sms' ? 'SMS Messages' : 
               tab === 'cascade' ? '🔄 Cascade Sync' : 
               tab === 'leads' ? '👥 Personnel Leads' : 
               tab === 'overview' ? 'Overview' : tab}
            </button>
          ))}
        </div>

        {/* Tab Body Contents */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6 text-left animate-in fade-in duration-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Section A: Company demographics */}
                <div className="space-y-3 p-4 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/3 rounded-xl text-xs">
                  <h4 className="font-bold text-slate-900 dark:text-white border-b border-gray-200 dark:border-white/5 pb-1.5 uppercase tracking-wider text-[10px]">1. Basic Details</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <span className="text-slate-400 text-[10px] block font-semibold">Corporate Legal Name</span>
                      <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">{selectedOrg.name}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Primary Industry</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedOrg.industry}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Product Interests</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedOrg.productInterests && selectedOrg.productInterests.length > 0
                          ? selectedOrg.productInterests.join(', ') 
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">Account Size Bracket</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedOrg.size}</span>
                    </div>
                  </div>
                </div>

                {/* Section B: Corporate directory leads */}
                <div className="space-y-3 p-4 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/3 rounded-xl text-xs font-sans">
                  <h4 className="font-bold text-slate-900 dark:text-white border-b border-gray-200 dark:border-white/5 pb-1.5 uppercase tracking-wider text-[10px]">2. Communication Directory</h4>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-[10px] block">Primary Website URL</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">{selectedOrg.website}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-400 text-[10px] block">Assigned Advisor</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">
                          {assignedRep ? `${assignedRep.firstName} ${assignedRep.lastName}` : 'Unassigned'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block">Personnel Registered</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 block">{selectedOrg.leads.length} profiles</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section C: Complete Address */}
                <div className="sm:col-span-2 space-y-3 p-4 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/3 rounded-xl text-xs">
                  <h4 className="font-bold text-slate-900 dark:text-white border-b border-gray-200 dark:border-white/5 pb-1.5 uppercase tracking-wider text-[10px]">3. Address & Geographical Information</h4>
                  <div className="space-y-3">
                    <div>
                      <span className="text-slate-400 text-[10px] block">Verified Head Office Address</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100 text-xs">{selectedOrg.address !== 'N/A' ? selectedOrg.address : 'No central address mapped. Navigate to Cascade updates tab to set.'}</span>
                    </div>
                  </div>
                </div>

                {/* Section D: Custom fields rollup */}
                <div className="sm:col-span-2 space-y-3 p-4 bg-gray-50 dark:bg-white/1 border border-gray-150 dark:border-white/3 rounded-xl text-xs text-left">
                  <h4 className="font-bold text-slate-900 dark:text-white border-b border-gray-200 dark:border-white/5 pb-1.5 uppercase tracking-wider text-[10px]">4. Configured Custom Segmentation Fields</h4>
                  <p className="text-slate-500 font-medium">To keep datasets aligned across all personnel registered under this firm, please utilize the <span className="font-bold text-slate-700 dark:text-slate-300">"Cascade Sync"</span> panel tab. Changes propagate instantly to all sub-leads.</p>
                </div>

              </div>
            </div>
          )}

          {/* TAB 2: PERSONNEL LIST DIRECTORY ACCORDION */}
          {activeTab === 'leads' && (
            <div className="space-y-4 text-left animate-in fade-in duration-100">
              <div className="flex justify-between items-center border-b border-gray-200 dark:border-white/5 pb-1.5 shrink-0">
                <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Associated Key Leads</h4>
                <span className="text-[10px] text-slate-500 font-bold">{selectedOrg.leads.length} Associated records</span>
              </div>

              <div className="space-y-2">
                {selectedOrg.leads.map(c => (
                  <div 
                    key={c.id}
                    onClick={() => {
                      if (setSelectedLead && setSelectedOrgName) {
                        setSelectedLead(c);
                        setSelectedOrgName(null);
                      }
                    }}
                    className="p-3 border border-gray-150 dark:border-white/3 bg-gray-50/50 dark:bg-white/1 hover:border-primary/25 rounded-xl flex items-center justify-between cursor-pointer transition-all hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    <div className="text-left space-y-0.5">
                      <span className="font-bold text-slate-900 dark:text-white block text-xs md:text-sm">{c.leadPerson}</span>
                      <span className="text-[10px] text-slate-500 block font-semibold">{c.jobTitle || 'Representative Lead'} • {c.email || 'No email'}</span>
                    </div>
                    <button
                      type="button"
                      className="text-blue-500 hover:text-blue-400 font-bold text-[10px] bg-white dark:bg-white/5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/5"
                    >
                      View Folder
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: ACTIVITIES TIMELINE */}
          {activeTab === 'activities' && (
            <LeadActivitiesTab
              timelineEvents={orgActivities}
              logType={logType}
              logNotes={logNotes}
              onSetLogType={setLogType}
              onSetLogNotes={setLogNotes}
              onLogInteraction={handleLogInteraction}
            />
          )}

          {/* TAB 4: NOTES AND RICH INTERNAL PERSISTENCE */}
          {activeTab === 'notes' && (
            <div className="space-y-4 text-left animate-in fade-in duration-100">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">General Corporate History Dossier</label>
                <textarea 
                  rows={4} 
                  value={companyNotes} 
                  onChange={e => setCompanyNotes(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/5 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-gray-300 dark:focus:border-white/10 transition-all"
                  placeholder="History or account logs..."
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Enterprise Internal Audits (Confidential)</label>
                <textarea 
                  rows={4} 
                  value={internalNotes} 
                  onChange={e => setInternalNotes(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/5 rounded-xl p-3 text-xs text-amber-600 dark:text-amber-400 focus:outline-none focus:border-gray-300 dark:focus:border-white/10 transition-all font-mono"
                  placeholder="Confidential comments, compliance audits, discount tiers..."
                />
              </div>

              <div className="flex justify-end pt-2">
                <button 
                  type="button" 
                  onClick={handleSaveNotes}
                  className="bg-primary hover:bg-blue-550 font-bold text-white px-4 py-2 rounded-xl text-xs transition-colors shadow-md shadow-primary/10"
                >
                  Save Corporate Records
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: BROADCAST EMAIL */}
          {activeTab === 'emails' && (
            <LeadEmailTab
              leadEmail={`[Broadcast → all ${selectedOrg.leads.length} leads of ${selectedOrg.name}]`}
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

          {/* TAB 6: CORPORATE SMS NOTIFICATION */}
          {activeTab === 'sms' && (
            <LeadSmsTab
              smsText={smsText}
              isSending={isSendingSms}
              onSmsTextChange={setSmsText}
              onSend={handleSendSms}
            />
          )}

          {/* TAB 7: OUTLINE CORPORATE TASKS */}
          {activeTab === 'tasks' && <RelatedTasks links={{ accountId: selectedOrg.id }} />}

          {/* TAB 8: ASSOCIATED DEALS PIPELINE — Enterprise Deals Table */}
          {activeTab === 'deals' && (
            <div className="space-y-5 text-left animate-in fade-in duration-100">
              
              {/* Deal Summary Bar */}
              {connectedDeals.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                  {[
                    { label: 'Total Deals',     value: dealStats.total,                                        color: 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300' },
                    { label: 'Active',          value: dealStats.active,                                       color: 'bg-blue-50 dark:bg-primary/10 text-blue-700 dark:text-primary' },
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
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Enterprise B2B Deals</h4>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  {connectedDeals.length} deal record{connectedDeals.length !== 1 ? 's' : ''}
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
                        const agentName = agent ? `${agent.firstName} ${agent.lastName}` : (deal.assignedUserId || 'System');

                        return (
                          <tr key={deal.id} 
                            onClick={() => setSelectedDealModal(deal)}
                            className="hover:bg-slate-50/80 dark:hover:bg-white/2 transition-colors cursor-pointer group"
                            title="Click to view & edit complete deal details"
                          >
                            {/* 1. Deal Column (Enriched with Title + Subtext) */}
                            <td className="py-3 px-3 min-w-50">
                              <p className="font-bold text-slate-900 dark:text-white truncate group-hover:text-primary dark:group-hover:text-blue-400 transition-colors">{deal.title}</p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                Rep: {deal.leadPerson || 'General Lead'} {deal.leadSource ? `• ${deal.leadSource}` : ''}
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
                                         'bg-blue-100  dark:bg-primary/10  text-blue-700  dark:text-primary border border-primary/20'
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
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">This account has no associated B2B deals yet.</p>
                  <button 
                    onClick={() => toast.info('Initiate new B2B deal from the Deals page or Pipeline module.')}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-white shadow-sm transition-colors"
                  >
                    <Plus size={14} />
                    Create Deal
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 9: CASCADE PARAMETERS CONFIG */}
          {activeTab === 'cascade' && (
            <div className="space-y-4 text-left animate-in fade-in duration-100">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs border-b border-gray-150 dark:border-white/5 pb-1.5 uppercase tracking-wider font-sans flex items-center gap-1.5">
                <span>🔄 Cascade sync company-wide updates</span>
              </h4>
              <p className="text-[11px] text-slate-500 leading-relaxed dark:text-slate-400">
                Any modifications entered down below will instantly propagate to all <span className="font-bold text-blue-500">{selectedOrg.leads.length} personnel leads</span> registered under the firm name <span className="font-bold">'{selectedOrg.name}'</span>. This ensures dataset alignment automatically.
              </p>

              <form onSubmit={handlePerformCascadeWeb} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase select-none mb-1">Company Website Domain</label>
                    <input 
                      type="text" 
                      value={cascadeWeb}
                      onChange={e => setCascadeWeb(e.target.value)}
                      placeholder="e.g. acme.com or https://acme.org"
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/5 rounded-lg px-3 py-2 text-xs focus:outline-none dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase select-none mb-1">Primary Industry Sector</label>
                    <input 
                      type="text" 
                      value={cascadeIndustry}
                      onChange={e => setCascadeIndustry(e.target.value)}
                      placeholder="e.g. Hospital & Health Care"
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/5 rounded-lg px-3 py-2 text-xs focus:outline-none dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase select-none mb-1">Account Size Bracket</label>
                    <input 
                      type="text" 
                      value={cascadeSize}
                      onChange={e => setCascadeSize(e.target.value)}
                      placeholder="e.g. 100-500 employees"
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/5 rounded-lg px-3 py-2 text-xs focus:outline-none dark:text-white"
                    />
                  </div>


                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase select-none mb-1">HQ Corporate Address details</label>
                    <input 
                      type="text" 
                      value={cascadeAddress}
                      onChange={e => setCascadeAddress(e.target.value)}
                      placeholder="Street, City, General Coordinates..."
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/5 rounded-lg px-3 py-2 text-xs focus:outline-none dark:text-white"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button 
                    type="submit" 
                    className="bg-primary hover:bg-blue-550 text-white font-bold text-xs px-4.5 py-2 rounded-xl transition-all shadow-md shadow-primary/10 flex items-center gap-1.5"
                  >
                    🔄 Propagate sync to {selectedOrg.leads.length} personnel profiles
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
