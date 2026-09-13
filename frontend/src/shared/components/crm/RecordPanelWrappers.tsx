'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Info,
  CheckCircle2,
  Trophy,
  Contact as ContactIcon,
  Table2,
  Building,
  MapPin,
  Mail,
  Phone,
  Pencil,
  FileText,
  Trash2,
  Plus,
  Paperclip,
  UserPlus,
  ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

import { RecordPanel, SmallAction, Chip } from './RecordPanel';
import { PipelineProgressBar } from './pipeline-progress-bar';
import { RecordActionBar } from './record-action-bar';
import type { OverflowMenuItem } from './record-action-bar';
import { ConfirmActionDialog } from './confirm-action-dialog';
import { useConfirmDialog } from '@/shared/hooks/use-confirm-dialog';
import { InlineTaskForm } from './inline-task-form';
import { InlineDealForm } from './inline-deal-form';
import { CustomFieldsSection } from './custom-fields-section';
import { FilesSection } from './files-section';
import type { FileRecord } from './files-section';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { useData } from '@/store/DataContext';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import type { Lead, Contact, Deal, Task } from '@/store/types';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/AuthContext';
import { getTenantCurrency, formatCurrency } from '@/shared/utils/currency';
import type { CurrencyConfig } from '@/shared/utils/currency';
import {
  DEFAULT_LEAD_STATUSES,
  DEFAULT_CONTACT_STATUSES,
  DEFAULT_ACCOUNT_STATUSES,
  DEFAULT_PIPELINE,
  type ActivityItem,
  type FileItem,
  type CustomFieldItem,
} from './moduleConfig';

/* -------------------------------------------------------------------------- */
/*                                0. SHARED COMPONENTS                        */
/* -------------------------------------------------------------------------- */

function EditableField({
  value,
  onSave,
  placeholder,
  icon: Icon,
  className,
}: {
  value: string;
  onSave: (val: string) => void;
  placeholder?: string;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [val, setVal] = useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setVal(value);
  }, [value]);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleSave = () => {
    setIsEditing(false);
    if (val !== value) {
      onSave(val);
    }
  };

  if (isEditing) {
    return (
      <div className={cn("flex min-w-0 items-center gap-2 flex-1", className)}>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') {
              setVal(value);
              setIsEditing(false);
            }
          }}
          className="flex h-7 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>
    );
  }

  return (
    <div 
      className={cn("group flex min-w-0 flex-1 items-center gap-3 cursor-pointer rounded-md hover:bg-accent/50 px-1 -mx-1 py-0.5 transition-colors", className)}
      onClick={() => setIsEditing(true)}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className={cn("truncate text-foreground", !val && "text-muted-foreground")}>
        {val || placeholder || 'Click to add...'}
      </span>
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground ml-auto shrink-0" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                         0b. EXPANDABLE INLINE CARDS                        */
/* -------------------------------------------------------------------------- */

const inlineInputCls =
  'w-full bg-card border border-border rounded-md px-2.5 py-1.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-all focus:ring-2 focus:ring-ring/20 focus:border-primary dark:bg-card dark:border-border dark:text-foreground';
const inlineSelectCls =
  'w-full bg-card border border-border rounded-md pl-2.5 pr-7 py-1.5 text-sm text-foreground outline-none appearance-none cursor-pointer focus:ring-2 focus:ring-ring/20 focus:border-primary transition-all dark:bg-card dark:border-border dark:text-foreground [&>option]:bg-card';
const inlineLabelCls = 'block text-xs text-muted-foreground mb-0.5';

interface ExpandableDealCardProps {
  deal: Deal;
  isExpanded: boolean;
  onToggle: () => void;
  pipelines: Array<{ id: string; name: string; stages?: Array<{ id: string; name: string }> }>;
  users: Array<{ id: string; firstName: string; lastName: string }>;
  contacts: Array<{ id: string; firstName: string; lastName: string; email?: string }>;
  onUpdate: (id: string, updates: Partial<Deal>) => Promise<void>;
  onAddContact?: (data: any) => Promise<void>;
}

function ExpandableDealCard({ deal, isExpanded, onToggle, pipelines, users, contacts, onUpdate, onAddContact }: ExpandableDealCardProps) {
  const currentPipeline = pipelines.find((p) => p.id === deal.pipelineId);
  const stagesForPipeline = currentPipeline?.stages ?? [];

  // Tenant-aware currency for all deal monetary values in this card
  const { tenant } = useAuth();
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);

  const [localValues, setLocalValues] = useState({
    pipelineId: deal.pipelineId || '',
    stageId: deal.stageId || '',
    value: deal.value ?? 0,
    priority: deal.priority || 'Medium',
    expectedCloseDate: deal.expectedCloseDate?.split('T')[0] || '',
    assignedUserId: (deal as any).assignedUserId || '',
    contactId: deal.contactId || '',
    billingFrequency: (deal as any).billingFrequency || '',
    description: deal.description || '',
  });
  const [isDirty, setIsDirty] = useState(false);
  const [showNewContactForm, setShowNewContactForm] = useState(false);
  const [newContact, setNewContact] = useState({ firstName: '', lastName: '', email: '' });

  // Reset local values when the deal prop changes
  React.useEffect(() => {
    setLocalValues({
      pipelineId: deal.pipelineId || '',
      stageId: deal.stageId || '',
      value: deal.value ?? 0,
      priority: deal.priority || 'Medium',
      expectedCloseDate: deal.expectedCloseDate?.split('T')[0] || '',
      assignedUserId: (deal as any).assignedUserId || '',
      contactId: deal.contactId || '',
      billingFrequency: (deal as any).billingFrequency || '',
      description: deal.description || '',
    });
    setIsDirty(false);
  }, [deal.id, deal.updatedAt]);

  const updateLocal = (field: string, value: string | number) => {
    setLocalValues((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const handleSave = async () => {
    try {
      await onUpdate(deal.id, localValues as any);
      setIsDirty(false);
      toast.success('Deal updated successfully');
    } catch {
      toast.error('Failed to update deal');
    }
  };

  const handleCancel = () => {
    setLocalValues({
      pipelineId: deal.pipelineId || '',
      stageId: deal.stageId || '',
      value: deal.value ?? 0,
      priority: deal.priority || 'Medium',
      expectedCloseDate: deal.expectedCloseDate?.split('T')[0] || '',
      assignedUserId: (deal as any).assignedUserId || '',
      contactId: deal.contactId || '',
      billingFrequency: (deal as any).billingFrequency || '',
      description: deal.description || '',
    });
    setIsDirty(false);
  };

  const handleCreateContact = async () => {
    if (!newContact.firstName.trim()) {
      toast.error('First name is required');
      return;
    }
    try {
      await onAddContact?.({ ...newContact });
      setShowNewContactForm(false);
      setNewContact({ firstName: '', lastName: '', email: '' });
      toast.success('Contact created');
    } catch {
      toast.error('Failed to create contact');
    }
  };

  // Get stages for currently selected pipeline in local state
  const localPipeline = pipelines.find((p) => p.id === localValues.pipelineId);
  const localStages = localPipeline?.stages ?? [];

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors cursor-pointer group text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">{deal.title}</p>
          <p className="text-xs text-muted-foreground">
            {formatCurrency(deal.value ?? 0, tenantCurrency)} · {deal.priority || 'Medium'}
          </p>
        </div>
        <Chip className="bg-warning/20 text-warning-foreground">{deal.priority || 'Medium'}</Chip>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-180'
          )}
        />
      </button>

      {/* Expanded area */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-2 space-y-2">
              {/* Row 1: Pipeline + Stage */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={inlineLabelCls}>Pipeline</label>
                  <div className="relative">
                    <select
                      value={localValues.pipelineId}
                      onChange={(e) => updateLocal('pipelineId', e.target.value)}
                      className={inlineSelectCls}
                    >
                      <option value="">Select pipeline</option>
                      {pipelines.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                </div>
                <div>
                  <label className={inlineLabelCls}>Stage</label>
                  <div className="relative">
                    <select
                      value={localValues.stageId}
                      onChange={(e) => updateLocal('stageId', e.target.value)}
                      className={inlineSelectCls}
                    >
                      <option value="">Select stage</option>
                      {localStages.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                </div>
              </div>

              {/* Row 2: Value + Billing Frequency */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={inlineLabelCls}>Value ({tenantCurrency.code})</label>
                  <input
                    type="number"
                    value={localValues.value}
                    onChange={(e) => updateLocal('value', Number(e.target.value))}
                    className={inlineInputCls}
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className={inlineLabelCls}>Billing Frequency</label>
                  <div className="relative">
                    <select
                      value={localValues.billingFrequency}
                      onChange={(e) => updateLocal('billingFrequency', e.target.value)}
                      className={inlineSelectCls}
                    >
                      <option value="">Select billing...</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                      <option value="one_time">One Time</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                </div>
              </div>

              {/* Row 3: Priority + Close Date */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={inlineLabelCls}>Priority</label>
                  <div className="relative">
                    <select
                      value={localValues.priority}
                      onChange={(e) => updateLocal('priority', e.target.value)}
                      className={inlineSelectCls}
                    >
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                </div>
                <div>
                  <label className={inlineLabelCls}>Close Date</label>
                  <input
                    type="date"
                    value={localValues.expectedCloseDate}
                    onChange={(e) => updateLocal('expectedCloseDate', e.target.value)}
                    className={inlineInputCls}
                  />
                </div>
              </div>

              {/* Row 4: Contact + Assigned */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={inlineLabelCls}>Contact</label>
                  <div className="relative">
                    <select
                      value={localValues.contactId}
                      onChange={(e) => {
                        if (e.target.value === '__new__') {
                          setShowNewContactForm(true);
                        } else {
                          updateLocal('contactId', e.target.value);
                        }
                      }}
                      className={inlineSelectCls}
                    >
                      <option value="">Select contact...</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.firstName} {c.lastName}{c.email ? ` (${c.email})` : ''}
                        </option>
                      ))}
                      <option value="__new__">+ Create New Contact</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>

                  {/* Inline new contact form */}
                  {showNewContactForm && (
                    <div className="mt-2 p-2 border border-dashed border-border rounded-md space-y-2 bg-muted/30 dark:bg-muted/10">
                      <input
                        placeholder="First Name"
                        value={newContact.firstName}
                        onChange={(e) => setNewContact((p) => ({ ...p, firstName: e.target.value }))}
                        className={inlineInputCls}
                      />
                      <input
                        placeholder="Last Name"
                        value={newContact.lastName}
                        onChange={(e) => setNewContact((p) => ({ ...p, lastName: e.target.value }))}
                        className={inlineInputCls}
                      />
                      <input
                        placeholder="Email"
                        type="email"
                        value={newContact.email}
                        onChange={(e) => setNewContact((p) => ({ ...p, email: e.target.value }))}
                        className={inlineInputCls}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCreateContact}
                          className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          Create
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowNewContactForm(false)}
                          className="px-2.5 py-1 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-secondary transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className={inlineLabelCls}>Assigned</label>
                  <div className="relative">
                    <select
                      value={localValues.assignedUserId}
                      onChange={(e) => updateLocal('assignedUserId', e.target.value)}
                      className={inlineSelectCls}
                    >
                      <option value="">Unassigned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                </div>
              </div>

              {/* Row 5: Notes (full-width) */}
              <div>
                <label className={inlineLabelCls}>Notes</label>
                <textarea
                  rows={3}
                  value={localValues.description}
                  onChange={(e) => updateLocal('description', e.target.value)}
                  placeholder="Add notes about this deal..."
                  className={cn(inlineInputCls, 'resize-none')}
                />
              </div>

              {/* Row 6: Save/Cancel — only when dirty */}
              {isDirty && (
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-secondary transition-colors dark:border-border dark:text-muted-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ExpandableTaskCardProps {
  task: Task;
  isExpanded: boolean;
  onToggle: () => void;
  users: Array<{ id: string; firstName: string; lastName: string }>;
  onUpdate: (id: string, updates: Partial<Task>) => Promise<void>;
}

function ExpandableTaskCard({ task, isExpanded, onToggle, users, onUpdate }: ExpandableTaskCardProps) {
  const handleFieldChange = async (field: string, value: string) => {
    try {
      await onUpdate(task.id, { [field]: value } as Partial<Task>);
      toast.success('Task updated');
    } catch {
      toast.error('Failed to update task');
    }
  };

  const handleComplete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await onUpdate(task.id, { status: task.status === 'completed' ? 'pending' : 'completed' } as Partial<Task>);
      toast.success(task.status === 'completed' ? 'Task reopened' : 'Task completed');
    } catch {
      toast.error('Failed to update task');
    }
  };

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Collapsed header */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors cursor-pointer group">
        <Checkbox
          checked={task.status === 'completed'}
          onCheckedChange={() => handleComplete({} as React.MouseEvent)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4"
        />
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 text-left"
        >
          <p className={cn(
            'truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors',
            task.status === 'completed' && 'line-through text-muted-foreground'
          )}>{task.title}</p>
          <p className="text-xs text-muted-foreground">
            Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No date'}
          </p>
        </button>
        <Chip className={task.priority === 'High' ? 'text-destructive bg-destructive/10' : ''}>
          {task.priority || 'Medium'}
        </Chip>
        <button type="button" onClick={onToggle}>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-200',
              isExpanded && 'rotate-180'
            )}
          />
        </button>
      </div>

      {/* Expanded area */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-2 space-y-2">
              {/* Title edit */}
              <div>
                <label className={inlineLabelCls}>Title</label>
                <input
                  type="text"
                  defaultValue={task.title}
                  onBlur={(e) => {
                    if (e.target.value !== task.title) {
                      handleFieldChange('title', e.target.value);
                    }
                  }}
                  className={inlineInputCls}
                />
              </div>

              {/* Row 1: Status + Priority */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={inlineLabelCls}>Status</label>
                  <div className="relative">
                    <select
                      value={task.status || 'pending'}
                      onChange={(e) => handleFieldChange('status', e.target.value)}
                      className={inlineSelectCls}
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="blocked">Blocked</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                </div>
                <div>
                  <label className={inlineLabelCls}>Priority</label>
                  <div className="relative">
                    <select
                      value={task.priority || 'Medium'}
                      onChange={(e) => handleFieldChange('priority', e.target.value)}
                      className={inlineSelectCls}
                    >
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                </div>
              </div>

              {/* Row 2: Due Date + Assigned */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={inlineLabelCls}>Due Date</label>
                  <input
                    type="date"
                    defaultValue={task.dueDate ? task.dueDate.split('T')[0] : ''}
                    onChange={(e) => handleFieldChange('dueDate', e.target.value)}
                    className={inlineInputCls}
                  />
                </div>
                <div>
                  <label className={inlineLabelCls}>Assigned</label>
                  <div className="relative">
                    <select
                      value={(task as any).assignedUserId || ''}
                      onChange={(e) => handleFieldChange('assignedUserId', e.target.value)}
                      className={inlineSelectCls}
                    >
                      <option value="">Unassigned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                1. LEAD PANEL                               */
/* -------------------------------------------------------------------------- */

export interface LeadPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onEdit?: (lead: Lead) => void;
}

export function LeadPanel({ open, onOpenChange, lead, onEdit }: LeadPanelProps) {
  const {
    updateContact: updateLead,
    deleteContact: deleteLead,
    tasks,
    deals,
    organizations,
    contacts,
    addTask,
    addDeal,
    addContact,
    updateDeal,
    updateTask,
    pipelines,
    users,
  } = useData();

  // Local UI states for inline forms
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showDealForm, setShowDealForm] = useState(false);
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const { dialogProps: confirmDialogProps, confirm: showConfirm } = useConfirmDialog();

  const [customFields, setCustomFields] = useState<CustomFieldItem[]>([
    { id: 'cf-1', name: 'Product Interest Keywords', type: 'text', value: 'Security, Cabling, CCTV' },
  ]);

  if (!lead) return null;

  const leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Unnamed Lead';
  const leadOrg = organizations.find((o) => o.id === lead.accountId || o.name === lead.companyName);

  // Associated tasks & deals
  const leadTasks = tasks.filter(
    (t: Task) => (t as any).leadId === lead.id || (t as any).contactId === lead.id || t.title.toLowerCase().includes(leadName.toLowerCase())
  );
  const leadDeals = deals.filter(
    (d: Deal) => d.leadId === lead.id || (d.leadIds ?? []).includes(lead.id)
  );

  // Dynamic activity generator
  const activityItems: ActivityItem[] = [
    {
      id: 'act-1',
      kind: 'created',
      title: `Lead record created for ${leadName}`,
      when: lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : 'Recently',
      actor: { name: 'System Admin', initials: 'SA' },
    },
    ...(lead.status
      ? [
          {
            id: 'act-2',
            kind: 'status' as const,
            from: 'Inquiry',
            to: lead.status,
            when: 'Recent',
            actor: { name: 'Lead Agent', initials: 'LA' },
          },
        ]
      : []),
    ...leadTasks.map((t, idx) => ({
      id: `act-task-${t.id || idx}`,
      kind: 'task' as const,
      title: `${t.status === 'completed' ? 'Task completed' : 'Task pending'}: ${t.title}`,
      when: t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'Scheduled',
      actor: { name: 'Assigned User', initials: 'AU' },
    })),
  ];

  // Handlers
  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateLead(lead.id, { status: newStatus });
      toast.success(`Status updated to ${newStatus}`);
    } catch {
      toast.error('Failed to update status');
    }
  };

  // Overflow menu items for RecordActionBar
  const overflowItems: OverflowMenuItem[] = [
    { label: 'Edit', icon: <Pencil className="size-4" />, onClick: () => onEdit?.(lead) },
    {
      label: 'Convert to Contact',
      icon: <UserPlus className="size-4" />,
      onClick: () => toast.info('Convert to Contact functionality coming soon'),
      permission: 'contacts.create',
    },
    {
      label: 'Delete',
      icon: <Trash2 className="size-4" />,
      onClick: () => showConfirm({
        title: `Delete Lead?`,
        description: `This will archive "${leadName}" and all associated data.`,
        warning: 'This action cannot be easily reversed.',
        variant: 'destructive',
        confirmLabel: 'Delete Lead',
        onConfirm: async () => {
          await deleteLead(lead.id);
          onOpenChange(false);
          toast.success('Lead deleted');
        },
      }),
      destructive: true,
      permission: 'contacts.delete',
    },
  ];

  // Sections configuration
  const sections = [
    // RecordActionBar section
    {
      id: 'action-bar',
      title: 'Actions',
      icon: Info,
      content: (
        <div className="px-4 py-2">
          <RecordActionBar
            email={lead.email ?? null}
            phone={lead.phone ?? null}
            onLogActivity={() => toast.info('Activity logging coming soon')}
            overflowItems={overflowItems}
          />
        </div>
      ),
    },
    {
      id: 'about',
      title: 'About',
      icon: Info,
      content: (
        <div className="divide-y divide-border text-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2">
            <EditableField 
              icon={Mail} 
              value={lead.email || ''} 
              placeholder="Add email address..."
              onSave={(val) => { updateLead(lead.id, { email: val }).catch(() => toast.error('Failed to update email')); }} 
            />
            {lead.email && (
              <SmallAction label="Copy Email" onClick={() => { navigator.clipboard.writeText(lead.email!); toast.success('Email copied'); }}>
                <FileText className="h-3.5 w-3.5" />
              </SmallAction>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2">
            <EditableField 
              icon={Phone} 
              value={lead.phone || ''} 
              placeholder="Add phone number..."
              onSave={(val) => { updateLead(lead.id, { phone: val }).catch(() => toast.error('Failed to update phone')); }} 
            />
            {lead.phone && (
              <SmallAction label="Copy Phone" onClick={() => { navigator.clipboard.writeText(lead.phone!); toast.success('Phone copied'); }}>
                <FileText className="h-3.5 w-3.5" />
              </SmallAction>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2">
            <EditableField 
              icon={MapPin} 
              value={lead.address || ''} 
              placeholder="Add physical address..."
              onSave={(val) => { updateLead(lead.id, { address: val }).catch(() => toast.error('Failed to update address')); }} 
            />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2">
            <EditableField 
              icon={Building} 
              value={lead.companyName || ''} 
              placeholder="Add company name..."
              onSave={(val) => { updateLead(lead.id, { companyName: val }).catch(() => toast.error('Failed to update company')); }} 
            />
            {lead.companyName && <Chip>Company</Chip>}
          </div>

          {lead.productInterests && lead.productInterests.length > 0 && (
            <div className="px-4 py-2.5">
              <span className="text-xs text-muted-foreground block mb-1.5">Product Interests</span>
              <div className="flex flex-wrap gap-1.5">
                {lead.productInterests.map((p) => (
                  <Chip key={p}>{p}</Chip>
                ))}
              </div>
            </div>
          )}

          {lead.leadSource && (
            <div className="flex items-center justify-between px-4 py-2.5 text-xs text-muted-foreground">
              <span>Source: <strong className="text-foreground">{lead.leadSource}</strong></span>
              <span>Score: <strong className="text-primary">{lead.score ?? 50}</strong></span>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'tasks',
      title: 'Tasks',
      icon: CheckCircle2,
      count: leadTasks.length,
      collapsible: true,
      actions: (
        <SmallAction label="Add Task" onClick={() => setShowTaskForm((v) => !v)}>
          <Plus className="h-4 w-4" />
        </SmallAction>
      ),
      content: (
        <div className="divide-y divide-border">
          {leadTasks.map((t) => (
            <ExpandableTaskCard
              key={t.id}
              task={t}
              isExpanded={expandedTaskId === t.id}
              onToggle={() => setExpandedTaskId((prev) => (prev === t.id ? null : t.id))}
              users={users}
              onUpdate={updateTask}
            />
          ))}

          {showTaskForm && (
            <div className="p-4">
              <InlineTaskForm
                recordName={leadName}
                onSubmit={async (taskData) => {
                  await addTask({
                    title: taskData.title,
                    description: taskData.title,
                    leadId: lead.id,
                    priority: taskData.priority === 'HIGH' ? 'High' : taskData.priority === 'LOW' ? 'Low' : 'Medium',
                    assignedUserId: taskData.assignedUserId || lead.assignedUserId || '',
                    dueDate: taskData.dueDate || new Date(Date.now() + 86400000 * 2).toISOString(),
                    status: 'pending',
                  } as any);
                  toast.success(taskData.type === 'call' ? 'Call task scheduled' : 'Task created');
                  setShowTaskForm(false);
                }}
                onCancel={() => setShowTaskForm(false)}
              />
            </div>
          )}

          {!showTaskForm && leadTasks.length === 0 && (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground">No tasks scheduled for this lead.</p>
              <button
                type="button"
                onClick={() => setShowTaskForm(true)}
                className="mt-1 text-xs font-semibold text-primary hover:underline"
              >
                + Add Task
              </button>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'deals',
      title: 'Deals',
      icon: Trophy,
      count: leadDeals.length,
      collapsible: true,
      actions: (
        <SmallAction label="Add Deal" onClick={() => setShowDealForm((v) => !v)}>
          <Plus className="h-4 w-4" />
        </SmallAction>
      ),
      content: (
        <div className="divide-y divide-border">
          {leadDeals.map((d) => (
            <ExpandableDealCard
              key={d.id}
              deal={d}
              isExpanded={expandedDealId === d.id}
              onToggle={() => setExpandedDealId((prev) => (prev === d.id ? null : d.id))}
              pipelines={pipelines}
              users={users}
              contacts={contacts}
              onUpdate={updateDeal}
              onAddContact={addContact}
            />
          ))}

          {showDealForm && (
            <div className="p-4">
              <InlineDealForm
                relatedRecord={{ type: 'lead', id: lead.id, organizationId: leadOrg?.id }}
                onSubmit={async (dealData) => {
                  await addDeal({
                    title: dealData.title,
                    value: dealData.value || 0,
                    currency: 'PHP',
                    leadId: dealData.leadId || lead.id,
                    organizationId: dealData.organizationId || leadOrg?.id,
                    stageId: dealData.stageId,
                    pipelineId: dealData.pipelineId,
                    description: dealData.description,
                    priority: 'Medium',
                    expectedCloseDate: dealData.expectedCloseDate || new Date(Date.now() + 86400000 * 30).toISOString(),
                  } as any);
                  toast.success('Deal created');
                  setShowDealForm(false);
                }}
                onCancel={() => setShowDealForm(false)}
              />
            </div>
          )}

          {!showDealForm && leadDeals.length === 0 && (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground">No active deals attached to this lead.</p>
              <button
                type="button"
                onClick={() => setShowDealForm(true)}
                className="mt-1 text-xs font-semibold text-primary hover:underline"
              >
                + Create Deal
              </button>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'converted-contact',
      title: 'Converted Contact',
      icon: UserPlus,
      count: (lead as any).contactId ? 1 : 0,
      collapsible: true,
      content: (lead as any).contactId ? (
        (() => {
          const linkedContact = contacts.find((c) => c.id === (lead as any).contactId);
          if (!linkedContact) return <div className="p-4 text-center text-xs text-muted-foreground">Contact record not loaded.</div>;
          return (
            <Link href={`/crm/contacts?id=${linkedContact.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors cursor-pointer group block">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{linkedContact.firstName} {linkedContact.lastName}</p>
                <p className="text-xs text-muted-foreground">{linkedContact.email || 'Contact'}</p>
              </div>
              <Chip>Contact</Chip>
            </Link>
          );
        })()
      ) : (
        <div className="p-4 text-center text-xs text-muted-foreground">
          {lead.status === 'Converted' ? 'Contact record linked via conversion.' : 'Not yet converted to a contact.'}
        </div>
      ),
    },
    {
      id: 'contacts',
      title: 'Company / Organization',
      icon: Building,
      count: leadOrg ? 1 : 0,
      collapsible: true,
      content: leadOrg ? (
        <Link href={`/crm/accounts?id=${leadOrg.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors cursor-pointer group block">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{leadOrg.name}</p>
            <p className="text-xs text-muted-foreground">{leadOrg.industry || 'General Industry'}</p>
          </div>
          <Chip>{leadOrg.city || 'Account'}</Chip>
        </Link>
      ) : (
        <div className="p-4 text-center text-xs text-muted-foreground">
          No parent company assigned.
        </div>
      ),
    },
    {
      id: 'custom-fields',
      title: 'Custom Fields',
      icon: Table2,
      count: customFields.length,
      collapsible: true,
      content: (
        <div className="px-4 py-3">
          <CustomFieldsSection
            fields={customFields}
            canEdit={true}
            onAdd={(field) => {
              const newField: CustomFieldItem = { id: `cf-${Date.now()}`, ...field };
              setCustomFields((prev) => [...prev, newField]);
              toast.success('Custom field added');
            }}
            onUpdate={(fieldId, value) => {
              setCustomFields((prev) =>
                prev.map((f) => (f.id === fieldId ? { ...f, value } : f))
              );
              toast.success('Field updated');
            }}
            onDelete={(fieldId) => {
              setCustomFields((prev) => prev.filter((f) => f.id !== fieldId));
              toast.success('Custom field removed');
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <>
    <ConfirmActionDialog {...confirmDialogProps} />
    <RecordPanel
      open={open}
      onOpenChange={onOpenChange}
      module="lead"
      fullPageHref={`/crm/leads/${lead.id}`}
      record={{
        id: lead.id,
        title: leadName,
        subtitle: lead.companyName || lead.email || 'Lead Profile',
        email: lead.email,
        phone: lead.phone,
        company: lead.companyName,
        owner: (lead as any).assignedTo || 'Sales Team',
        tags: [lead.source || 'Inbound'].filter(Boolean),
      }}
      statuses={DEFAULT_LEAD_STATUSES}
      status={lead.status || 'Inquiry'}
      onStatusChange={handleStatusChange}
      activity={activityItems}
      sections={sections}
      actions={{
        email: () => {
          if (lead.email) window.location.href = `mailto:${lead.email}`;
          else toast.info('No email address on file');
        },
        call: () => {
          if (lead.phone) window.location.href = `tel:${lead.phone}`;
          else toast.info('No phone number on file');
        },
        message: () => toast.info('Message client opened'),
        add: () => setShowTaskForm(true),
      }}
      manageMenu={[
        {
          label: 'Edit Lead',
          icon: Pencil,
          onSelect: () => onEdit?.(lead),
        },
        {
          label: 'Convert to Contact',
          icon: UserPlus,
          onSelect: () => toast.info('Convert to Contact functionality coming soon'),
        },
        {
          label: 'Delete Lead',
          icon: Trash2,
          destructive: true,
          onSelect: () => showConfirm({
            title: 'Delete Lead',
            description: `Delete ${leadName}?`,
            warning: 'All associated activities and tasks will also be affected.',
            confirmLabel: 'Delete Lead',
            variant: 'destructive',
            onConfirm: async () => {
              await deleteLead(lead.id);
              onOpenChange(false);
              toast.success('Lead deleted');
            },
          }),
        },
      ]}
    />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                               2. CONTACT PANEL                             */
/* -------------------------------------------------------------------------- */

export interface ContactPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  onEdit?: (contact: Contact) => void;
}

export function ContactPanel({ open, onOpenChange, contact, onEdit }: ContactPanelProps) {
  const { updateContact, deleteContact, tasks, deals, organizations, addTask } = useData();

  // Local UI states
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [customFields, setCustomFields] = useState<CustomFieldItem[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const { dialogProps: confirmDialogProps, confirm: showConfirm } = useConfirmDialog();

  // Tenant-aware currency for deal values shown in this panel
  const { tenant } = useAuth();
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);

  if (!contact) return null;

  const contactName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Contact';
  const relatedAccount = organizations.find((o) => o.id === contact.accountId || o.name === contact.companyName);
  const contactDeals = deals.filter(
    (d) => (d.contactIds ?? []).includes(contact.id) || d.contactId === contact.id
  );
  const contactTasks = tasks.filter(
    (t: Task) => (t as any).contactId === contact.id || t.title.toLowerCase().includes(contactName.toLowerCase())
  );

  // Overflow menu items for RecordActionBar
  const overflowItems: OverflowMenuItem[] = [
    { label: 'Edit', icon: <Pencil className="size-4" />, onClick: () => onEdit?.(contact) },
    {
      label: 'Delete',
      icon: <Trash2 className="size-4" />,
      onClick: () => showConfirm({
        title: 'Delete Contact',
        description: `Delete ${contactName}?`,
        warning: 'This cannot be undone.',
        confirmLabel: 'Delete Contact',
        variant: 'destructive',
        onConfirm: async () => {
          await deleteContact(contact.id);
          onOpenChange(false);
          toast.success('Contact deleted');
        },
      }),
      destructive: true,
      permission: 'contacts.delete',
    },
  ];

  const sections = [
    // RecordActionBar section
    {
      id: 'action-bar',
      title: 'Actions',
      icon: Info,
      content: (
        <div className="px-4 py-2">
          <RecordActionBar
            email={contact.email ?? null}
            phone={contact.phone ?? null}
            onLogActivity={() => toast.info('Activity logging coming soon')}
            overflowItems={overflowItems}
          />
        </div>
      ),
    },
    {
      id: 'about',
      title: 'About',
      icon: Info,
      content: (
        <div className="divide-y divide-border text-sm">
          <div className="flex items-center justify-between px-4 py-2">
            <EditableField 
              icon={Mail} 
              value={contact.email || ''} 
              placeholder="Add email address..."
              onSave={(val) => { updateContact(contact.id, { email: val }).catch(() => toast.error('Failed to update email')); }} 
            />
          </div>
          <div className="flex items-center justify-between px-4 py-2">
            <EditableField 
              icon={Phone} 
              value={contact.phone || ''} 
              placeholder="Add phone number..."
              onSave={(val) => { updateContact(contact.id, { phone: val }).catch(() => toast.error('Failed to update phone')); }} 
            />
          </div>
          <div className="flex items-center justify-between px-4 py-2">
            <EditableField 
              icon={MapPin} 
              value={contact.address || ''} 
              placeholder="Add physical address..."
              onSave={(val) => { updateContact(contact.id, { address: val }).catch(() => toast.error('Failed to update address')); }} 
            />
          </div>
        </div>
      ),
    },
    {
      id: 'account',
      title: 'Related Account',
      icon: Building,
      content: relatedAccount ? (
        <Link href={`/crm/accounts/${relatedAccount.id}`} className="p-4 flex items-center justify-between text-sm hover:bg-secondary/50 transition-colors cursor-pointer group block">
          <div>
            <p className="font-semibold text-foreground group-hover:text-primary transition-colors">{relatedAccount.name}</p>
            <p className="text-xs text-muted-foreground">{relatedAccount.industry || 'Organization'}</p>
          </div>
          <Chip>{relatedAccount.city || 'Account'}</Chip>
        </Link>
      ) : (
        <div className="p-4 text-xs text-muted-foreground text-center">No associated account.</div>
      ),
    },
    // Tasks section with InlineTaskForm
    {
      id: 'tasks',
      title: 'Tasks',
      icon: CheckCircle2,
      count: contactTasks.length,
      collapsible: true,
      actions: (
        <SmallAction label="Add Task" onClick={() => setShowTaskForm((v) => !v)}>
          <Plus className="h-4 w-4" />
        </SmallAction>
      ),
      content: (
        <div className="divide-y divide-border">
          {contactTasks.map((t) => (
            <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  Due: {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'No date'}
                </p>
              </div>
              <Chip className={t.priority === 'High' ? 'text-destructive bg-destructive/10' : ''}>
                {t.priority || 'Medium'}
              </Chip>
            </div>
          ))}

          {showTaskForm && (
            <div className="p-4">
              <InlineTaskForm
                recordName={contactName}
                onSubmit={async (taskData) => {
                  await addTask({
                    title: taskData.title,
                    description: taskData.title,
                    contactId: contact.id,
                    priority: taskData.priority === 'HIGH' ? 'High' : taskData.priority === 'LOW' ? 'Low' : 'Medium',
                    assignedUserId: taskData.assignedUserId || '',
                    dueDate: taskData.dueDate || new Date(Date.now() + 86400000 * 2).toISOString(),
                    status: 'pending',
                  } as any);
                  toast.success(taskData.type === 'call' ? 'Call task scheduled' : 'Task created');
                  setShowTaskForm(false);
                }}
                onCancel={() => setShowTaskForm(false)}
              />
            </div>
          )}

          {!showTaskForm && contactTasks.length === 0 && (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground">No tasks scheduled for this contact.</p>
              <button
                type="button"
                onClick={() => setShowTaskForm(true)}
                className="mt-1 text-xs font-semibold text-primary hover:underline"
              >
                + Add Task
              </button>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'deals',
      title: 'Deals',
      icon: Trophy,
      count: contactDeals.length,
      collapsible: true,
      content: (
        <div className="divide-y divide-border text-sm">
          {contactDeals.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelectedDealId(d.id)}
              className="w-full p-3 flex justify-between items-center hover:bg-secondary/50 transition-colors cursor-pointer group text-left"
            >
              <div>
                <p className="font-medium text-foreground group-hover:text-primary transition-colors">{d.title}</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(d.value ?? 0, tenantCurrency)}</p>
              </div>
              <Chip>Active</Chip>
            </button>
          ))}
          {contactDeals.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground text-center">No deals connected.</p>
          )}
        </div>
      ),
    },
    // Custom Fields section
    {
      id: 'custom-fields',
      title: 'Custom Fields',
      icon: Table2,
      count: customFields.length,
      collapsible: true,
      content: (
        <div className="px-4 py-3">
          <CustomFieldsSection
            fields={customFields}
            canEdit={true}
            onAdd={(field) => {
              const newField: CustomFieldItem = { id: `cf-${Date.now()}`, ...field };
              setCustomFields((prev) => [...prev, newField]);
              toast.success('Custom field added');
            }}
            onUpdate={(fieldId, value) => {
              setCustomFields((prev) =>
                prev.map((f) => (f.id === fieldId ? { ...f, value } : f))
              );
              toast.success('Field updated');
            }}
            onDelete={(fieldId) => {
              setCustomFields((prev) => prev.filter((f) => f.id !== fieldId));
              toast.success('Custom field removed');
            }}
          />
        </div>
      ),
    },
    // Files section
    {
      id: 'files',
      title: 'Files',
      icon: Paperclip,
      count: files.length,
      collapsible: true,
      content: (
        <div className="px-4 py-3">
          <FilesSection
            files={files}
            canUpload={true}
            canDelete={true}
            onUpload={async (file) => {
              const newFile: FileRecord = {
                id: `file-${Date.now()}`,
                name: file.name,
                size: file.size,
                url: URL.createObjectURL(file),
                uploadedBy: 'You',
                uploadedAt: new Date().toISOString(),
              };
              setFiles((prev) => [newFile, ...prev]);
              toast.info('File stored locally — server upload coming soon');
            }}
            onDelete={(fileId) => {
              setFiles((prev) => prev.filter((f) => f.id !== fileId));
              toast.info('File removed locally — server sync coming soon');
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <>
    <ConfirmActionDialog {...confirmDialogProps} />
    <RecordPanel
      open={open}
      onOpenChange={onOpenChange}
      module="contact"
      fullPageHref={`/crm/contacts/${contact.id}`}
      record={{
        id: contact.id,
        title: contactName,
        subtitle: contact.companyName || contact.email || 'Contact Profile',
        email: contact.email,
        phone: contact.phone,
        company: contact.companyName,
        owner: (contact as any).assignedTo,
      }}
      statuses={DEFAULT_CONTACT_STATUSES}
      status={contact.status || 'Qualified'}
      onStatusChange={async (s) => {
        await updateContact(contact.id, { status: s });
        toast.success(`Status updated to ${s}`);
      }}
      activity={[
        {
          id: '1',
          kind: 'created',
          title: `Contact created for ${contactName}`,
          when: contact.createdAt ? new Date(contact.createdAt).toLocaleDateString() : 'Recent',
        },
      ]}
      sections={sections}
      actions={{
        email: () => contact.email && (window.location.href = `mailto:${contact.email}`),
        call: () => contact.phone && (window.location.href = `tel:${contact.phone}`),
      }}
      manageMenu={[
        {
          label: 'Edit Contact',
          icon: Pencil,
          onSelect: () => onEdit?.(contact),
        },
        {
          label: 'Delete Contact',
          icon: Trash2,
          destructive: true,
          onSelect: () => showConfirm({
            title: 'Delete Contact',
            description: `Delete ${contactName}?`,
            warning: 'This cannot be undone.',
            confirmLabel: 'Delete Contact',
            variant: 'destructive',
            onConfirm: async () => {
              await deleteContact(contact.id);
              onOpenChange(false);
              toast.success('Contact deleted');
            },
          }),
        },
      ]}
    />

    {/* DealPanel overlay — opens when a deal is clicked */}
    {selectedDealId && (
      <DealPanel
        open={!!selectedDealId}
        onOpenChange={(isOpen) => { if (!isOpen) setSelectedDealId(null); }}
        deal={deals.find((d) => d.id === selectedDealId) ?? null}
      />
    )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                               3. ACCOUNT PANEL                             */
/* -------------------------------------------------------------------------- */

export interface AccountPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: any | null;
  onEdit?: (account: any) => void;
}

export function AccountPanel({ open, onOpenChange, account, onEdit }: AccountPanelProps) {
  const { contacts, deals, updateOrganization, deleteOrganization } = useData();

  // Local UI states
  const [customFields, setCustomFields] = useState<CustomFieldItem[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const { dialogProps: confirmDialogProps, confirm: showConfirm } = useConfirmDialog();

  // Tenant-aware currency for deal values shown in this panel
  const { tenant } = useAuth();
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);

  if (!account) return null;

  const accountName = account.name || 'Account';
  const relatedContacts = contacts.filter((c) => c.accountId === account.id || c.companyName === accountName);
  const relatedLeads = contacts.filter((c) => (c.accountId === account.id || c.organizationId === account.id) && c.status !== 'Converted' && c.status !== 'Merged');
  const relatedDeals = deals.filter((d: Deal) => d.organizationId === account.id);
  const selectedDeal = selectedDealId ? deals.find((d) => d.id === selectedDealId) ?? null : null;

  // Overflow menu items for RecordActionBar
  const overflowItems: OverflowMenuItem[] = [
    { label: 'Edit', icon: <Pencil className="size-4" />, onClick: () => onEdit?.(account) },
    {
      label: 'Delete',
      icon: <Trash2 className="size-4" />,
      onClick: () => showConfirm({
        title: 'Delete Account',
        description: `Delete ${accountName}?`,
        warning: 'Associated leads, contacts, and deals will be unlinked.',
        confirmLabel: 'Delete Account',
        variant: 'destructive',
        onConfirm: async () => {
          await deleteOrganization(account.id);
          onOpenChange(false);
          toast.success('Account deleted');
        },
      }),
      destructive: true,
      permission: 'accounts.delete',
    },
  ];

  const sections = [
    // RecordActionBar section (no email/phone for org)
    {
      id: 'action-bar',
      title: 'Actions',
      icon: Info,
      content: (
        <div className="px-4 py-2">
          <RecordActionBar
            email={null}
            phone={null}
            onLogActivity={() => toast.info('Activity logging coming soon')}
            overflowItems={overflowItems}
          />
        </div>
      ),
    },
    {
      id: 'about',
      title: 'About',
      icon: Info,
      content: (
        <div className="divide-y divide-border text-sm">
          <div className="flex justify-between px-4 py-2">
            <EditableField 
              value={account.industry || ''} 
              placeholder="Industry"
              onSave={(val) => { updateOrganization(account.id, { industry: val }).catch(() => toast.error('Failed to update industry')); }} 
            />
          </div>
          <div className="flex justify-between px-4 py-2">
            <EditableField 
              value={account.size || ''} 
              placeholder="Company Size"
              onSave={(val) => { updateOrganization(account.id, { size: val as '1-10' | '11-50' | '51-200' | '200+' }).catch(() => toast.error('Failed to update size')); }} 
            />
          </div>
          <div className="flex justify-between px-4 py-2">
            <EditableField 
              value={account.website || ''} 
              placeholder="Website"
              onSave={(val) => { updateOrganization(account.id, { website: val }).catch(() => toast.error('Failed to update website')); }} 
              className="text-primary"
            />
          </div>
          <div className="flex justify-between px-4 py-2">
            <EditableField 
              value={[account.city, account.province, account.country].filter(Boolean).join(', ') || ''} 
              placeholder="Location"
              onSave={(val) => { 
                const parts = val.split(',').map(s => s.trim());
                const locationUpdate: Record<string, string> = {};
                if (parts[0]) locationUpdate.city = parts[0];
                if (parts[1]) locationUpdate.province = parts[1];
                if (parts[2]) locationUpdate.country = parts[2];
                updateOrganization(account.id, locationUpdate).catch(() => toast.error('Failed to update location'));
              }} 
            />
          </div>
        </div>
      ),
    },
    {
      id: 'contacts',
      title: 'Contacts',
      icon: ContactIcon,
      count: relatedContacts.length,
      collapsible: true,
      content: (
        <div className="divide-y divide-border text-sm">
          {relatedContacts.map((c) => (
            <Link key={c.id} href={`/crm/contacts/${c.id}`} className="p-3 flex justify-between items-center hover:bg-secondary/50 transition-colors cursor-pointer group block">
              <div>
                <p className="font-medium text-foreground group-hover:text-primary transition-colors">{c.firstName} {c.lastName}</p>
                <p className="text-xs text-muted-foreground">{c.email || c.phone || 'Contact'}</p>
              </div>
              <Chip>{c.status || 'Active'}</Chip>
            </Link>
          ))}
          {relatedContacts.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground text-center">No contacts under this account.</p>
          )}
        </div>
      ),
    },
    {
      id: 'leads',
      title: 'Leads',
      icon: UserPlus,
      count: relatedLeads.length,
      collapsible: true,
      content: (
        <div className="divide-y divide-border text-sm">
          {relatedLeads.map((l) => (
            <Link key={l.id} href={`/crm/leads/${l.id}`} className="p-3 flex justify-between items-center hover:bg-secondary/50 transition-colors cursor-pointer group block">
              <div>
                <p className="font-medium text-foreground group-hover:text-primary transition-colors">{l.firstName} {l.lastName}</p>
                <p className="text-xs text-muted-foreground">{l.email || l.phone || 'Lead'}</p>
              </div>
              <Chip>{l.status || 'Inquiry'}</Chip>
            </Link>
          ))}
          {relatedLeads.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground text-center">No leads under this account.</p>
          )}
        </div>
      ),
    },
    {
      id: 'deals',
      title: 'Deals',
      icon: Trophy,
      count: relatedDeals.length,
      collapsible: true,
      content: (
        <div className="divide-y divide-border text-sm">
          {relatedDeals.map((d) => (
            <div key={d.id} onClick={() => setSelectedDealId(d.id)} className="p-3 flex justify-between items-center hover:bg-secondary/50 transition-colors cursor-pointer group">
              <div>
                <p className="font-medium text-foreground group-hover:text-primary transition-colors">{d.title}</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(d.value ?? 0, tenantCurrency)}</p>
              </div>
              <Chip>In Progress</Chip>
            </div>
          ))}
          {relatedDeals.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground text-center">No active deals for this account.</p>
          )}
        </div>
      ),
    },
    // Custom Fields section
    {
      id: 'custom-fields',
      title: 'Custom Fields',
      icon: Table2,
      count: customFields.length,
      collapsible: true,
      content: (
        <div className="px-4 py-3">
          <CustomFieldsSection
            fields={customFields}
            canEdit={true}
            onAdd={(field) => {
              const newField: CustomFieldItem = { id: `cf-${Date.now()}`, ...field };
              setCustomFields((prev) => [...prev, newField]);
              toast.success('Custom field added');
            }}
            onUpdate={(fieldId, value) => {
              setCustomFields((prev) =>
                prev.map((f) => (f.id === fieldId ? { ...f, value } : f))
              );
              toast.success('Field updated');
            }}
            onDelete={(fieldId) => {
              setCustomFields((prev) => prev.filter((f) => f.id !== fieldId));
              toast.success('Custom field removed');
            }}
          />
        </div>
      ),
    },
    // Files section
    {
      id: 'files',
      title: 'Files',
      icon: Paperclip,
      count: files.length,
      collapsible: true,
      content: (
        <div className="px-4 py-3">
          <FilesSection
            files={files}
            canUpload={true}
            canDelete={true}
            onUpload={async (file) => {
              const newFile: FileRecord = {
                id: `file-${Date.now()}`,
                name: file.name,
                size: file.size,
                url: URL.createObjectURL(file),
                uploadedBy: 'You',
                uploadedAt: new Date().toISOString(),
              };
              setFiles((prev) => [newFile, ...prev]);
              toast.info('File stored locally — server upload coming soon');
            }}
            onDelete={(fileId) => {
              setFiles((prev) => prev.filter((f) => f.id !== fileId));
              toast.info('File removed locally — server sync coming soon');
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <ConfirmActionDialog {...confirmDialogProps} />
      <RecordPanel
        open={open}
        onOpenChange={onOpenChange}
        module="account"
        fullPageHref={`/crm/accounts/${account.id}`}
        record={{
          id: account.id,
          title: accountName,
          subtitle: account.industry || account.website || 'Account Profile',
          company: accountName,
          tags: [account.size, account.industry].filter(Boolean) as string[],
        }}
        statuses={DEFAULT_ACCOUNT_STATUSES}
        status={account.customerType || 'Prospect'}
        onStatusChange={async (s) => {
          await updateOrganization(account.id, { customerType: s } as any);
          toast.success(`Classification updated to ${s}`);
        }}
        activity={[
          {
            id: '1',
            kind: 'created',
            title: `Account established for ${accountName}`,
            when: account.createdAt ? new Date(account.createdAt).toLocaleDateString() : 'Recent',
          },
        ]}
        sections={sections}
        manageMenu={[
          {
            label: 'Edit Account',
            icon: Pencil,
            onSelect: () => onEdit?.(account),
          },
          {
            label: 'Delete Account',
            icon: Trash2,
            destructive: true,
            onSelect: () => showConfirm({
              title: 'Delete Account',
              description: `Delete ${accountName}?`,
              warning: 'Associated leads, contacts, and deals will be unlinked.',
              confirmLabel: 'Delete Account',
              variant: 'destructive',
              onConfirm: async () => {
                await deleteOrganization(account.id);
                onOpenChange(false);
                toast.success('Account deleted');
              },
            }),
          },
        ]}
      />
      {selectedDeal && (
        <DealPanel
          open={!!selectedDeal}
          onOpenChange={(isOpen) => { if (!isOpen) setSelectedDealId(null); }}
          deal={selectedDeal}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                4. DEAL PANEL                               */
/* -------------------------------------------------------------------------- */

export interface DealPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal | null;
  onEdit?: (deal: Deal) => void;
  onOpenContactPanel?: (contactId: string) => void;
  onOpenAccountPanel?: (accountId: string) => void;
}

export function DealPanel({ open, onOpenChange, deal, onEdit, onOpenContactPanel, onOpenAccountPanel }: DealPanelProps) {
  const { pipelines, moveDealStage, deleteDeal, tasks, contacts, organizations, addTask, updateDeal, updateTask } = useData();
  const canEditDeal = useHasPermission('deals.edit');
  const canDeleteDeal = useHasPermission('deals.delete');
  const canCreateDeal = useHasPermission('deals.create');

  // Local UI states for DealPanel
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [customFields, setCustomFields] = useState<CustomFieldItem[]>(
    (deal as any)?.customFields ?? []
  );
  const [files, setFiles] = useState<FileRecord[]>(
    (deal as any)?.files ?? []
  );
  const { dialogProps: confirmDialogProps, confirm: showConfirm } = useConfirmDialog();

  // Tenant-aware currency for all deal monetary values in this panel
  const { tenant } = useAuth();
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);

  if (!deal) return null;

  const dealPipeline = pipelines.find((p) => p.id === deal.pipelineId) || pipelines[0];
  const dealStages = dealPipeline?.stages.map((s) => ({
    id: s.id,
    label: s.name,
    tone: s.isWon ? ('success' as const) : s.isLost ? ('muted' as const) : ('warning' as const),
  })) || DEFAULT_PIPELINE.stages;

  const currentStage = dealStages.find((s) => s.id === deal.stageId)?.label || 'In Progress';
  const dealTasks = tasks.filter((t) => t.dealId === deal.id);

  // Associated contacts: from deal.contactIds or deal.leadIds, or fallback to contactId
  const linkedContactIds = deal.contactIds ?? (deal.leadIds ?? (deal.leadId ? [deal.leadId] : []));
  const linkedContacts = contacts.filter((c) => linkedContactIds.includes(c.id));
  const primaryContact = linkedContacts[0] ?? null;

  // Company/Organization from deal's organizationId or companyId
  const dealOrganization = organizations.find(
    (o) => o.id === deal.organizationId || o.id === (deal as any).companyId || o.name === deal.companyName
  );

  // Current stage info for won/lost detection
  const currentStageObj = dealPipeline?.stages.find((s) => s.id === deal.stageId);
  const isWon = currentStageObj?.isWon ?? false;
  const isLost = currentStageObj?.isLost ?? false;

  // Pipeline progress bar stages
  const progressStages = (dealPipeline?.stages ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    isWon: s.isWon,
    isLost: s.isLost,
    order: s.order,
  }));

  const handleStageClick = async (stageId: string): Promise<void> => {
    if (!canEditDeal) return;
    try {
      await moveDealStage(deal.id, stageId);
      const stageName = dealPipeline?.stages.find((s) => s.id === stageId)?.name ?? 'new stage';
      toast.success(`Stage moved to ${stageName}`);
    } catch {
      toast.error('Failed to change stage');
    }
  };

  const handleDuplicate = async (): Promise<void> => {
    try {
      const { duplicateDeal: duplicateApi } = await import('@/shared/services/deals-actions.api');
      await duplicateApi(deal.id);
    } catch {
      toast.error('Failed to duplicate deal');
    }
  };

  const handleArchiveRestore = async (): Promise<void> => {
    if (deal.isArchived) {
      try {
        const { restoreDeal: restoreApi } = await import('@/shared/services/deals-actions.api');
        await restoreApi(deal.id);
      } catch {
        toast.error('Failed to restore deal');
      }
    } else {
      await deleteDeal(deal.id);
      toast.success('Deal archived');
    }
  };

  // Overflow menu items for RecordActionBar
  const overflowItems: OverflowMenuItem[] = [
    { label: 'Edit', icon: <Pencil className="size-4" />, onClick: () => onEdit?.(deal) },
    { label: 'Duplicate', icon: <FileText className="size-4" />, onClick: handleDuplicate, permission: 'deals.create' },
    { label: deal.isArchived ? 'Restore' : 'Archive', icon: <Trash2 className="size-4" />, onClick: handleArchiveRestore, permission: 'deals.delete' },
    {
      label: 'Delete',
      icon: <Trash2 className="size-4" />,
      onClick: () => showConfirm({
        title: 'Delete Deal',
        description: `Delete ${deal.title}?`,
        warning: 'This cannot be undone.',
        confirmLabel: 'Delete Deal',
        variant: 'destructive',
        onConfirm: async () => {
          await deleteDeal(deal.id);
          onOpenChange(false);
          toast.success('Deal deleted');
        },
      }),
      destructive: true,
      permission: 'deals.delete',
    },
  ];

  const sections = [
    // 21.1: Pipeline Progress Bar section
    {
      id: 'pipeline-progress',
      title: 'Pipeline',
      icon: Info,
      content: (
        <div className="px-4 py-3">
          <PipelineProgressBar
            stages={progressStages}
            currentStageId={deal.stageId}
            isWon={isWon}
            isLost={isLost}
            onStageClick={handleStageClick}
            canChangeStage={canEditDeal}
          />
        </div>
      ),
    },
    // 21.2: Record Action Bar section
    {
      id: 'action-bar',
      title: 'Actions',
      icon: Info,
      content: (
        <div className="px-4 py-2">
          <RecordActionBar
            email={primaryContact?.email ?? null}
            phone={primaryContact?.phone ?? null}
            onLogActivity={() => toast.info('Activity logging coming soon')}
            overflowItems={overflowItems}
          />
        </div>
      ),
    },
    // About Deal
    {
      id: 'about',
      title: 'About Deal',
      icon: Info,
      content: (
        <div className="divide-y divide-border text-sm">
          <div className="flex justify-between px-4 py-2">
            <span className="text-muted-foreground self-center">Deal Value</span>
            <div className="flex items-center">
              <span className="text-muted-foreground mr-1">{tenantCurrency.symbol}</span>
              <EditableField 
                value={deal.value?.toString() || '0'} 
                placeholder="0"
                onSave={(val) => { updateDeal(deal.id, { value: parseFloat(val) || 0 }).catch(() => toast.error('Failed to update value')); }} 
                className="font-bold w-[120px]"
              />
            </div>
          </div>
          <div className="flex justify-between px-4 py-2">
            <span className="text-muted-foreground self-center">Priority</span>
            <EditableField 
              value={deal.priority || 'Medium'} 
              placeholder="Medium"
              onSave={(val) => { updateDeal(deal.id, { priority: val as Deal['priority'] }).catch(() => toast.error('Failed to update priority')); }} 
              className="w-[120px]"
            />
          </div>
          <div className="flex justify-between px-4 py-2">
            <span className="text-muted-foreground self-center">Expected Close</span>
            <EditableField 
              value={deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString().split('T')[0] : ''} 
              placeholder="YYYY-MM-DD"
              onSave={(val) => { updateDeal(deal.id, { expectedCloseDate: val }).catch(() => toast.error('Failed to update close date')); }} 
              className="w-[120px]"
            />
          </div>
          {deal.description && (
            <div className="px-4 py-2.5">
              <span className="text-xs text-muted-foreground block mb-1">Description</span>
              <p className="text-xs text-foreground bg-secondary/50 p-2.5 rounded-lg border border-border">
                {deal.description}
              </p>
            </div>
          )}
        </div>
      ),
    },
    // 21.3: Associated Contacts section
    {
      id: 'contacts',
      title: 'Associated Contacts',
      icon: ContactIcon,
      count: linkedContacts.length,
      collapsible: true,
      content: (
        <div className="divide-y divide-border text-sm">
          {linkedContacts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpenContactPanel?.(c.id)}
              className="w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors cursor-pointer text-left"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {`${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unnamed Contact'}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.email || c.phone || 'No contact info'}
                </p>
              </div>
              {c.phone && (
                <span className="text-xs text-muted-foreground">{c.phone}</span>
              )}
            </button>
          ))}
          {linkedContacts.length === 0 && (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground">No contacts linked.</p>
              <button
                type="button"
                className="mt-1 text-xs font-semibold text-primary hover:underline"
                onClick={() => toast.info('Link Contact functionality coming soon')}
              >
                + Link Contact
              </button>
            </div>
          )}
        </div>
      ),
    },
    // 21.4: Company/Organization section
    {
      id: 'organization',
      title: 'Company / Organization',
      icon: Building,
      count: dealOrganization ? 1 : 0,
      collapsible: true,
      content: dealOrganization ? (
        <button
          type="button"
          onClick={() => onOpenAccountPanel?.(dealOrganization.id)}
          className="w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors cursor-pointer text-left"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {dealOrganization.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {dealOrganization.industry || 'General Industry'}
            </p>
          </div>
          <Chip>{dealOrganization.city || 'Account'}</Chip>
        </button>
      ) : (
        <div className="p-4 text-center text-xs text-muted-foreground">
          No organization linked to this deal.
        </div>
      ),
    },
    // 21.5: Tasks section with InlineTaskForm
    {
      id: 'tasks',
      title: 'Tasks',
      icon: CheckCircle2,
      count: dealTasks.length,
      collapsible: true,
      actions: (
        <SmallAction label="Add Task" onClick={() => setShowTaskForm((v) => !v)}>
          <Plus className="h-4 w-4" />
        </SmallAction>
      ),
      content: (
        <div className="divide-y divide-border">
          {dealTasks.map((t) => (
            <div key={t.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
              <Checkbox
                checked={t.status === 'completed'}
                onCheckedChange={async (checked) => {
                  try {
                    await updateTask(t.id, { status: checked ? 'completed' : 'pending' });
                    toast.success(checked ? 'Task completed' : 'Task reopened');
                  } catch {
                    toast.error('Failed to update task status');
                  }
                }}
                className="shrink-0"
              />
              <div className="min-w-0">
                <p className={cn(
                  "truncate text-sm font-medium text-foreground",
                  t.status === 'completed' && "line-through text-muted-foreground"
                )}>
                  {t.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  Due: {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'No date'}
                </p>
              </div>
              <Chip className={t.priority === 'High' ? 'text-destructive bg-destructive/10' : ''}>
                {t.priority || 'Medium'}
              </Chip>
            </div>
          ))}

          {showTaskForm && (
            <div className="p-4">
              <InlineTaskForm
                recordName={deal.title}
                onSubmit={async (taskData) => {
                  await addTask({
                    title: taskData.title,
                    description: taskData.title,
                    dealId: deal.id,
                    priority: taskData.priority === 'HIGH' ? 'High' : taskData.priority === 'LOW' ? 'Low' : 'Medium',
                    assignedUserId: taskData.assignedUserId || '',
                    dueDate: taskData.dueDate || new Date(Date.now() + 86400000 * 2).toISOString(),
                    status: 'pending',
                  } as any);
                  toast.success(taskData.type === 'call' ? 'Call task scheduled' : 'Task created');
                  setShowTaskForm(false);
                }}
                onCancel={() => setShowTaskForm(false)}
              />
            </div>
          )}

          {!showTaskForm && dealTasks.length === 0 && (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground">No tasks linked to this deal.</p>
              <button
                type="button"
                onClick={() => setShowTaskForm(true)}
                className="mt-1 text-xs font-semibold text-primary hover:underline"
              >
                + Add Task
              </button>
            </div>
          )}
        </div>
      ),
    },
    // 21.6: Custom Fields section
    {
      id: 'custom-fields',
      title: 'Custom Fields',
      icon: Table2,
      count: customFields.length,
      collapsible: true,
      content: (
        <div className="px-4 py-3">
          <CustomFieldsSection
            fields={customFields}
            canEdit={canEditDeal}
            onAdd={(field) => {
              const newField: CustomFieldItem = {
                id: `cf-${Date.now()}`,
                ...field,
              };
              setCustomFields((prev) => [...prev, newField]);
              if (updateDeal) {
                updateDeal(deal.id, { customFields: [...customFields, newField] } as any).catch(() => {
                  toast.error('Failed to save custom field');
                });
              }
              toast.success('Custom field added');
            }}
            onUpdate={(fieldId, value) => {
              setCustomFields((prev) =>
                prev.map((f) => (f.id === fieldId ? { ...f, value } : f))
              );
              const updated = customFields.map((f) => (f.id === fieldId ? { ...f, value } : f));
              if (updateDeal) {
                updateDeal(deal.id, { customFields: updated } as any).catch(() => {
                  toast.error('Failed to update custom field');
                });
              }
              toast.success('Field updated');
            }}
            onDelete={(fieldId) => {
              setCustomFields((prev) => prev.filter((f) => f.id !== fieldId));
              const updated = customFields.filter((f) => f.id !== fieldId);
              if (updateDeal) {
                updateDeal(deal.id, { customFields: updated } as any).catch(() => {
                  toast.error('Failed to delete custom field');
                });
              }
              toast.success('Custom field removed');
            }}
          />
        </div>
      ),
    },
    // 21.7: Files section
    {
      id: 'files',
      title: 'Files',
      icon: Paperclip,
      count: files.length,
      collapsible: true,
      content: (
        <div className="px-4 py-3">
          <FilesSection
            files={files}
            canUpload={canEditDeal}
            canDelete={canEditDeal}
            onUpload={async (file) => {
              // Placeholder — file upload backend not yet implemented
              const newFile: FileRecord = {
                id: `file-${Date.now()}`,
                name: file.name,
                size: file.size,
                url: URL.createObjectURL(file),
                uploadedBy: 'You',
                uploadedAt: new Date().toISOString(),
              };
              setFiles((prev) => [newFile, ...prev]);
              toast.info('File stored locally — server upload coming soon');
            }}
            onDelete={(fileId) => {
              setFiles((prev) => prev.filter((f) => f.id !== fileId));
              toast.info('File removed locally — server sync coming soon');
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <>
    <ConfirmActionDialog {...confirmDialogProps} />
    <RecordPanel
      open={open}
      onOpenChange={onOpenChange}
      module="deal"
      fullPageHref={`/crm/deals/${deal.id}`}
      record={{
        id: deal.id,
        title: deal.title,
        subtitle: `${formatCurrency(deal.value ?? 0, tenantCurrency)} · ${dealPipeline?.name || 'Pipeline'}`,
        company: deal.companyName,
        tags: [deal.priority ? `${deal.priority} Priority` : 'Medium Priority'],
      }}
      statuses={dealStages}
      status={currentStage}
      onStatusChange={async (stageLabel) => {
        const targetStage = dealStages.find((s) => s.label === stageLabel || s.id === stageLabel);
        if (targetStage?.id) {
          await moveDealStage(deal.id, targetStage.id);
          toast.success(`Stage moved to ${stageLabel}`);
        }
      }}
      pipeline={{
        name: dealPipeline?.name || 'Sales Pipeline',
        stages: dealStages,
        current: currentStage,
        onChange: async (st) => {
          const target = dealStages.find((s) => s.id === st || s.label === st);
          if (target?.id) {
            await moveDealStage(deal.id, target.id);
            toast.success(`Stage moved to ${target.label}`);
          }
        },
      }}
      activity={[
        {
          id: '1',
          kind: 'created',
          title: `Deal created: ${deal.title}`,
          when: deal.createdAt ? new Date(deal.createdAt).toLocaleDateString() : 'Recent',
        },
      ]}
      sections={sections}
      manageMenu={[
        {
          label: 'Edit Deal',
          icon: Pencil,
          onSelect: () => onEdit?.(deal),
        },
        {
          label: 'Delete Deal',
          icon: Trash2,
          destructive: true,
          onSelect: () => showConfirm({
            title: 'Delete Deal',
            description: `Delete ${deal.title}?`,
            warning: 'This cannot be undone.',
            confirmLabel: 'Delete Deal',
            variant: 'destructive',
            onConfirm: async () => {
              await deleteDeal(deal.id);
              onOpenChange(false);
              toast.success('Deal deleted');
            },
          }),
        },
      ]}
    />
    </>
  );
}
