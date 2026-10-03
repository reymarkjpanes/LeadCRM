'use client';
import { useTasks } from '@/features/tenant/operations/tasks/use-tasks';
import { RelatedTasks } from '@/features/tenant/operations/tasks/ui/related-tasks';
import { uuid } from '@/lib/utils';

import React, { useState, useMemo } from 'react';
import {
  Building, User, Calendar, Tag, ChevronRight, Shield, AlertCircle,
  CheckCircle2, MessageSquare, PhoneCall, Mail, Users, ArrowRight,
  Receipt, Rocket, Plus, Clock, CheckCircle, AlertTriangle, Trash2, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Deal, Pipeline, User as UserType, Task, TaskStatus } from '@/store/types';
import { useData } from '@/store/DataContext';
import { toast } from 'sonner';
import { ModalCloseButton } from '@/shared/components/ui/modal-close-button';
import { DealContactsField } from '@/features/tenant/crm/deals/ui/deal-contacts-field';

// ─── Types ──────────────────────────────────────────────────────────────────

type DrawerTab = 'overview' | 'activities' | 'history' | 'tasks' | 'automation';

interface EditFields {
  title: string;
  companyName: string;
  contactPerson: string;
  contactIds: string[];
  value: number;
  priority: string;
  expectedCloseDate: string;
  assignedUserId: string;
  stageId: string;
  leadSource: string;
  industry: string;
  address: string;
  productInterests: string;
  campaign: string;
  customerType: string;
  tags: string;
}

export interface DealDetailsModalProps {
  deal: Deal;
  pipeline: Pipeline;
  users: UserType[];
  tasks: Task[];
  currentUserId: string;
  canEdit: boolean;
  canDelete: boolean;
  isAutomatedOnly: boolean;
  isTransitioning?: boolean;
  onClose: () => void;
  onUpdateDeal: (id: string, updates: Partial<Deal>) => void;
  onDeleteDeal: (deal: Deal) => void;
  onAddTask: (taskData: Omit<Task, 'id' | 'tenantId' | 'createdAt'>) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onMarkLost: (deal: Deal) => void;
  onNavigate: (page: string) => void;
  tenantId: string;
  moveDealStage?: (dealId: string, stageId: string) => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  pending:      'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400',
  'in_progress':'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  blocked:      'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  completed:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  cancelled:    'bg-slate-100 text-slate-400 dark:bg-white/5 line-through',
};

const TASK_STATUS_OPTIONS: TaskStatus[] = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'];

function isOverdue(task: Task): boolean {
  if (task.status === 'completed' || task.status === 'cancelled') return false;
  if (!task.dueDate) return false;
  return new Date(task.dueDate) < new Date();
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildEditFields(deal: Deal): EditFields {
  return {
    title: deal.title || '',
    companyName: deal.companyName || '',
    contactPerson: deal.contactPerson || '',
    contactIds: (deal as unknown as { contactIds?: string[] }).contactIds || [],
    value: deal.value || 0,
    priority: deal.priority || 'Medium',
    expectedCloseDate: deal.expectedCloseDate || '',
    assignedUserId: deal.assignedUserId || '',
    stageId: deal.stageId || '',
    leadSource: deal.leadSource || '',
    industry: deal.industry || '',
    address: deal.address || '',
    productInterests: deal.productInterests ? deal.productInterests.join(', ') : '',
    campaign: deal.campaign || '',
    customerType: deal.customerType || 'New Customer',
    tags: Array.isArray(deal.tags) ? deal.tags.join(', ') : '',
  };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function DealDetailsModal({
  deal,
  pipeline,
  users,
  tasks,
  currentUserId,
  canEdit,
  canDelete,
  isAutomatedOnly,
  isTransitioning = false,
  onClose,
  onUpdateDeal,
  onDeleteDeal,
  onAddTask,
  onUpdateTask,
  onMarkLost,
  onNavigate,
  tenantId,
}: DealDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState<EditFields>(buildEditFields(deal));

  // Activity log form state
  const [newActivity, setNewActivity] = useState({
    type: 'note' as 'note' | 'call' | 'email' | 'meeting',
    description: '',
    timestamp: new Date().toISOString().slice(0, 16),
    userId: currentUserId,
  });

  const currentStageIdx = pipeline.stages.findIndex(s => s.id === deal.stageId);
  const currentStageName = pipeline.stages[currentStageIdx]?.name ?? '—';
  const nextStage = pipeline.stages[currentStageIdx + 1];
  const isClosedWon = currentStageName === 'Closed Won';


  const isClosedLost = currentStageName === 'Closed Lost';

  const taskData = useTasks({ dealId: deal.id, limit: 1 });
  const taskCount = taskData.summary?.total ?? 0;

  function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    // Destructure stageId out — the edit form has no stage selector, so spreading
    // it would send the current (possibly stale or mock) stageId to the backend.
    // Stage changes must go through moveDealStage exclusively.
    const { stageId: _stageId, tags: tagsStr, ...editableFields } = editFields;
    onUpdateDeal(deal.id, {
      ...editableFields,
      productInterests: editFields.productInterests ? editFields.productInterests.split(',').map(s => s.trim()).filter(Boolean) : [],
      tags: tagsStr ? tagsStr.split(',').map(s => s.trim()).filter(Boolean) : [],
      priority: editFields.priority as Deal['priority'],
    });
    setIsEditing(false);
    toast.success('Deal updated');
  }

  function handleOpenEdit() {
    setEditFields(buildEditFields(deal));
    setIsEditing(true);
  }

  function handleLogActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!newActivity.description.trim()) return;
    const activity = {
      id: uuid(),
      ...newActivity,
      timestamp: newActivity.timestamp || new Date().toISOString(),
    };
    onUpdateDeal(deal.id, {
      activities: [...(deal.activities || []), activity],
    });
    setNewActivity({ type: 'note', description: '', timestamp: new Date().toISOString().slice(0, 16), userId: currentUserId });
    toast.success('Activity logged');
  }

  const tabClass = (tab: DrawerTab) =>
    `px-3 py-3 text-sm font-medium transition-all relative whitespace-nowrap ${
      activeTab === tab
        ? 'text-blue-400'
        : 'text-slate-500 hover:text-slate-700 dark:text-slate-300'
    }`;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[60]"
      />

      {/* Drawer panel */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-gray-50 dark:bg-slate-900 border-l border-gray-300 dark:border-white/[0.1] z-[70] shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-white/[0.05] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              deal.priority === 'High'   ? 'bg-red-500/10 text-red-400' :
              deal.priority === 'Medium' ? 'bg-orange-500/10 text-orange-400' :
                                           'bg-blue-500/10 text-blue-400'
            }`}>
              <Building size={20} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white leading-tight">{deal.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{deal.companyName}</p>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} ariaLabel="Close deal details drawer" size={20} />
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto border-b border-gray-200 dark:border-white/[0.05] shrink-0 scrollbar-none px-2">
          {(['overview', 'activities', 'tasks', 'history', 'automation'] as DrawerTab[]).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={tabClass(tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'tasks' && taskCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400">
                  {taskCount}
                </span>
              )}
              {activeTab === tab && (
                <motion.div layoutId="dealModalTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
              )}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <>
              {/* Quick stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] p-4 rounded-2xl">
                  <p className="text-xs text-slate-500 mb-1">Deal Value</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">₱{deal.value.toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] p-4 rounded-2xl">
                  <p className="text-xs text-slate-500 mb-1">Priority</p>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      deal.priority === 'High' ? 'bg-red-500' :
                      deal.priority === 'Medium' ? 'bg-orange-500' : 'bg-blue-500'
                    }`} />
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{deal.priority}</p>
                  </div>
                </div>
              </div>

              {/* Automation block */}
              {isAutomatedOnly && (
                <div className="bg-gradient-to-br from-blue-500/10 to-indigo-500/5 border border-blue-500/25 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield size={16} className="text-blue-400 animate-pulse" />
                      <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">Process Automation</h4>
                    </div>
                    <span className="text-[10px] bg-blue-500/20 text-blue-300 font-semibold px-2 py-0.5 rounded-full border border-blue-500/10">Active Enforcer</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Manual stage drags are disabled. This deal progresses automatically based on verified sales workflow rules.
                  </p>
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-2">
                      <span>Current: <strong className="text-slate-700 dark:text-slate-200">{currentStageName}</strong></span>
                      {nextStage && <span>Next: <strong className="text-slate-600 dark:text-slate-300">{nextStage.name}</strong></span>}
                    </div>
                    <div className="flex gap-1 w-full h-1.5 bg-gray-200 dark:bg-white/5 rounded-full overflow-hidden">
                      {pipeline.stages.map((st, idx) => (
                        <div key={st.id} className={`h-full flex-1 transition-all duration-300 ${idx <= currentStageIdx ? 'bg-blue-500' : 'bg-gray-300 dark:bg-white/10'}`} />
                      ))}
                    </div>
                  </div>
                  {nextStage ? (
                    <button
                      type="button"
                      onClick={() => onMarkLost(deal)}
                      disabled={isTransitioning}
                      className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/25 border border-red-500/20 text-red-400 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all"
                    >
                      <AlertCircle size={12} />
                      Mark Dead / Closed Lost
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-xs">
                      <CheckCircle2 size={16} />
                      Stage Process Complete. Deal is in its final state ({currentStageName})!
                    </div>
                  )}
                </div>
              )}

              {/* Edit form OR read-only details */}
              {isEditing ? (
                <form onSubmit={handleSaveEdit} className="space-y-4 bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] p-5 rounded-2xl">
                  <div className="flex items-center justify-between border-b border-gray-200 dark:border-white/[0.05] pb-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Edit Deal Fields</h4>
                    <span className="text-[10px] text-blue-400 font-semibold px-2 py-0.5 bg-blue-500/10 rounded-full">Editing</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Deal Title</label>
                    <input required type="text" value={editFields.title} onChange={e => setEditFields({ ...editFields, title: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none transition-all" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Value (₱)</label>
                      <input required type="number" value={editFields.value} onChange={e => setEditFields({ ...editFields, value: Number(e.target.value) })}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Priority</label>
                      <select value={editFields.priority} onChange={e => setEditFields({ ...editFields, priority: e.target.value })}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none">
                        <option>High</option><option>Medium</option><option>Low</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Assigned Agent</label>
                    <select value={editFields.assignedUserId} onChange={e => setEditFields({ ...editFields, assignedUserId: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none">
                      <option value="">Unassigned</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Expected Close Date</label>
                    <input type="date" value={editFields.expectedCloseDate} onChange={e => setEditFields({ ...editFields, expectedCloseDate: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Company Name</label>
                      <input type="text" value={editFields.companyName} onChange={e => setEditFields({ ...editFields, companyName: e.target.value })}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Contacts</label>
                      <DealContactsField
                        values={editFields.contactIds}
                        onChange={(ids) => setEditFields({ ...editFields, contactIds: ids })}
                        disabled={false}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Source</label>
                      <input type="text" value={editFields.leadSource} onChange={e => setEditFields({ ...editFields, leadSource: e.target.value })}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Industry</label>
                      <input type="text" value={editFields.industry} onChange={e => setEditFields({ ...editFields, industry: e.target.value })}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Product Interests (comma separated)</label>
                      <input type="text" value={editFields.productInterests} onChange={e => setEditFields({ ...editFields, productInterests: e.target.value })}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Address</label>
                      <input type="text" value={editFields.address} onChange={e => setEditFields({ ...editFields, address: e.target.value })}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Campaign</label>
                      <input type="text" value={editFields.campaign} onChange={e => setEditFields({ ...editFields, campaign: e.target.value })}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Customer Type</label>
                    <select value={editFields.customerType} onChange={e => setEditFields({ ...editFields, customerType: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none">
                      <option>New Customer</option><option>Existing Business</option><option>Partner</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Tags (comma-separated)</label>
                    <input type="text" value={editFields.tags} onChange={e => setEditFields({ ...editFields, tags: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none" />
                  </div>


                  <div className="flex gap-2 justify-end pt-1">
                    <button type="button" onClick={() => setIsEditing(false)}
                      className="px-4 py-2 border border-gray-200 dark:border-white/[0.08] text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-all">
                      Cancel
                    </button>
                    <button type="submit"
                      className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-500 transition-all shadow-md shadow-blue-500/10">
                      Save Changes
                    </button>
                  </div>
                </form>
              ) : (
                /* Read-only detail rows */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Details</h4>
                    {canEdit && (
                      <button type="button" onClick={handleOpenEdit} className="text-xs text-blue-500 hover:text-blue-400 font-bold">
                        Edit Fields
                      </button>
                    )}
                  </div>
                  <div className="space-y-3 text-sm">
                    {[
                      { icon: <User size={14} />, label: 'Assigned To',
                        value: users.find(u => u.id === deal.assignedUserId)
                          ? `${users.find(u => u.id === deal.assignedUserId)!.firstName} ${users.find(u => u.id === deal.assignedUserId)!.lastName}`
                          : 'Unassigned' },
                      { icon: <Calendar size={14} />, label: 'Close Date', value: deal.expectedCloseDate || 'Not set' },
                      { icon: <Tag size={14} />, label: 'Stage',
                        value: <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded text-xs font-medium">{currentStageName}</span> },
                      { icon: <span>🌐</span>, label: 'Contact Source', value: deal.leadSource || '—' },
                      { icon: <span>🏭</span>, label: 'Industry',       value: deal.industry    || '—' },
                      { icon: <span>📌</span>, label: 'Product Interests', value: deal.productInterests?.length ? deal.productInterests.join(', ') : '—' },
                      { icon: <span>📍</span>, label: 'Address',        value: deal.address     || '—' },
                      { icon: <span>📣</span>, label: 'Campaign',       value: deal.campaign    || '—' },
                      { icon: <span>👥</span>, label: 'Customer Type',  value: deal.customerType || 'New Customer' },
                    ].map(row => (
                      <div key={row.label} className="flex items-center justify-between">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-2">{row.icon} {row.label}</span>
                        <span className="text-slate-900 dark:text-white font-medium text-right max-w-[55%] truncate">{row.value}</span>
                      </div>
                    ))}
                    {deal.tags && deal.tags.length > 0 && (
                      <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-100 dark:border-white/[0.03]">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Tags</span>
                        <div className="flex flex-wrap gap-1">
                          {deal.tags.filter(Boolean).map(t => (
                            <span key={t} className="bg-slate-100 dark:bg-white/[0.05] text-slate-600 dark:text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-md">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Closed Won next steps */}
              {isClosedWon && (
                <div className="space-y-3 pt-1">
                  <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-widest">Next Steps</h4>
                  <button onClick={() => onNavigate('workflows')}
                    className="w-full flex items-center justify-between p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl hover:bg-blue-500/20 transition-all group">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                        <Rocket size={20} />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">Start Onboarding</p>
                        <p className="text-xs text-slate-500">Trigger onboarding workflow</p>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-slate-500 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
                  </button>
                </div>
              )}

              {/* Closed Lost reason */}
              {isClosedLost && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-red-500 uppercase tracking-widest">Reason for Loss</h4>
                    <button onClick={() => onMarkLost(deal)} className="text-[10px] text-red-400 hover:text-red-300 font-medium uppercase tracking-wider">
                      {deal.lostReason ? 'Edit' : 'Add Reason'}
                    </button>
                  </div>
                  {deal.lostReason ? (
                    <div className="bg-red-500/5 border border-red-500/10 p-4 rounded-2xl text-sm text-red-200 leading-relaxed">{deal.lostReason}</div>
                  ) : (
                    <div className="bg-red-500/5 border border-dashed border-red-500/20 p-4 rounded-2xl text-sm text-red-400/60 italic text-center">No reason provided yet.</div>
                  )}
                </div>
              )}

              {/* Recent activity preview */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Recent Activity</h4>
                  <button onClick={() => setActiveTab('activities')} className="text-xs text-blue-400 hover:text-blue-300 font-medium">View All</button>
                </div>
                <div className="space-y-3">
                  {(deal.activities?.length ?? 0) > 0 ? (
                    [...(deal.activities ?? [])].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 2).map(act => {
                      const actUser = users.find(u => u.id === act.userId);
                      return (
                        <div key={act.id} className="flex gap-3">
                          <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${
                            act.type === 'call'    ? 'bg-green-500/20 border-green-500/30 text-green-400' :
                            act.type === 'email'   ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' :
                            act.type === 'meeting' ? 'bg-purple-500/20 border-purple-500/30 text-purple-400' :
                                                     'bg-slate-500/20 border-slate-500/30 text-slate-400'
                          }`}>
                            {act.type === 'call' ? <PhoneCall size={12} /> : act.type === 'email' ? <Mail size={12} /> : act.type === 'meeting' ? <Users size={12} /> : <MessageSquare size={12} />}
                          </div>
                          <div>
                            <p className="text-sm text-slate-900 dark:text-white font-medium">{act.description}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{formatDate(act.timestamp)} · {actUser ? `${actUser.firstName} ${actUser.lastName}` : 'Unknown'}</p>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-slate-500 italic">No activities logged yet.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── ACTIVITIES TAB ───────────────────────────────────────────── */}
          {activeTab === 'activities' && (
            <div className="space-y-5">
              <form onSubmit={handleLogActivity} className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] rounded-2xl p-4 space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {(['note', 'call', 'email', 'meeting'] as const).map(type => (
                    <button key={type} type="button" onClick={() => setNewActivity({ ...newActivity, type })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                        newActivity.type === type
                          ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                          : 'bg-white dark:bg-white/[0.02] text-slate-500 border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.05]'
                      }`}>
                      {type === 'call' ? <PhoneCall size={12} /> : type === 'email' ? <Mail size={12} /> : type === 'meeting' ? <Users size={12} /> : <MessageSquare size={12} />}
                      <span className="capitalize">{type}</span>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Date & Time</label>
                    <input type="datetime-local" value={newActivity.timestamp}
                      onChange={e => setNewActivity({ ...newActivity, timestamp: e.target.value })}
                      className="w-full bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">User</label>
                    <select value={newActivity.userId} onChange={e => setNewActivity({ ...newActivity, userId: e.target.value })}
                      className="w-full bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none">
                      {users.filter(u => u.role?.toLowerCase() === 'user' || u.role?.toLowerCase() === 'client admin').map(u => (
                        <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <textarea rows={3} required value={newActivity.description}
                  onChange={e => setNewActivity({ ...newActivity, description: e.target.value })}
                  placeholder="Describe what happened..."
                  className="w-full bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] rounded-xl p-3 text-sm text-slate-900 dark:text-white focus:outline-none resize-none" />
                <div className="flex justify-end">
                  <button type="submit"
                    className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-500 transition-all">
                    Log Activity
                  </button>
                </div>
              </form>

              <div className="space-y-3">
                {(deal.activities?.length ?? 0) > 0 ? (
                  [...(deal.activities ?? [])].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map(act => {
                    const actUser = users.find(u => u.id === act.userId);
                    return (
                      <div key={act.id} className="flex gap-3">
                        <div className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${
                          act.type === 'call'    ? 'bg-green-500/20 border-green-500/30 text-green-400' :
                          act.type === 'email'   ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' :
                          act.type === 'meeting' ? 'bg-purple-500/20 border-purple-500/30 text-purple-400' :
                                                   'bg-slate-500/20 border-slate-500/30 text-slate-400'
                        }`}>
                          {act.type === 'call' ? <PhoneCall size={13} /> : act.type === 'email' ? <Mail size={13} /> : act.type === 'meeting' ? <Users size={13} /> : <MessageSquare size={13} />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-slate-900 dark:text-white font-medium">{act.description}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {formatDate(act.timestamp)} · {actUser ? `${actUser.firstName} ${actUser.lastName}` : 'Unknown'}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-500 italic text-center py-6">No activities logged yet. Use the form above to add the first one.</p>
                )}
              </div>
            </div>
          )}

          {/* ── TASKS TAB ────────────────────────────────────────────────── */}
          {activeTab === 'tasks' && <RelatedTasks links={{ dealId: deal.id }} />}

          {/* ── HISTORY TAB ──────────────────────────────────────────────── */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              {(deal.history?.length ?? 0) === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-6">No stage history recorded yet. Move this deal to a new stage to start tracking.</p>
              ) : (
                <div className="space-y-3 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1px] before:bg-gray-200 dark:before:bg-white/[0.05]">
                  {[...(deal.history ?? [])].reverse().map((entry, idx) => {
                    const stageName = pipeline.stages.find(s => s.id === entry.stageId)?.name ?? entry.stageId;
                    const prevStageName = entry.previousStageId
                      ? (pipeline.stages.find(s => s.id === entry.previousStageId)?.name ?? entry.previousStageId)
                      : null;
                    const histUser = users.find(u => u.id === entry.userId);
                    const isWon  = stageName === 'Closed Won';
                    const isLost = stageName === 'Closed Lost';

                    return (
                      <div key={idx} className="flex gap-3 relative">
                        <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 z-10 text-xs ${
                          isWon  ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' :
                          isLost ? 'bg-red-500/20 border-red-500/30 text-red-400' :
                                   'bg-blue-500/20 border-blue-500/30 text-blue-400'
                        }`}>
                          <ArrowRight size={12} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-slate-900 dark:text-white font-medium">
                            {prevStageName ? (
                              <span>
                                <span className="text-slate-500">{prevStageName}</span>
                                {' → '}
                                <span className={isWon ? 'text-emerald-400' : isLost ? 'text-red-400' : 'text-blue-400'}>{stageName}</span>
                              </span>
                            ) : (
                              <span className={isWon ? 'text-emerald-400' : isLost ? 'text-red-400' : 'text-blue-400'}>
                                Moved to {stageName}
                              </span>
                            )}
                          </p>
                          {entry.note && <p className="text-xs text-slate-500 mt-0.5 italic">{entry.note}</p>}
                          <p className="text-xs text-slate-400 mt-0.5">
                            {formatDate(entry.timestamp)} · {histUser ? `${histUser.firstName} ${histUser.lastName}` : 'System'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── AUTOMATION TAB ───────────────────────────────────────────── */}
          {activeTab === 'automation' && (
            <div className="space-y-3 p-4 text-sm text-slate-600 dark:text-slate-300">
              <p>Workflow activity is recorded in this deal's timeline. Open Workflows to inspect persisted runs and step results.</p>
              <a className="text-blue-600 dark:text-blue-400 underline" href="/automation/workflows">Open workflow runs</a>
            </div>
          )}
        </div>{/* end scrollable content */}

        {/* Sticky footer actions */}
        <div className="p-4 border-t border-gray-200 dark:border-white/[0.05] flex gap-3 shrink-0">
          <button type="button" onClick={() => setActiveTab('activities')}
            className="flex-1 py-2.5 bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.08] text-slate-700 dark:text-slate-300 rounded-xl text-sm font-semibold hover:bg-gray-100 dark:hover:bg-white/5 transition-all">
            Add Note
          </button>
          {canEdit && (
            <button type="button" onClick={handleOpenEdit}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-500/20">
              Edit Deal
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={() => onDeleteDeal(deal)}
              className="w-10 h-10 flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl transition-colors shrink-0">
              <Trash2 size={16} />
            </button>
          )}
        </div>

      </motion.div>
    </>
  );
}
