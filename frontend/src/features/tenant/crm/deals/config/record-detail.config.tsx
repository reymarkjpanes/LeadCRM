import {
  Pencil, Trash2, Copy, Archive, Building,
  User, UserPlus, CheckCircle2, Trophy,
} from 'lucide-react';
import type { RecordDetailConfig, StatusConfig } from '@/shared/components/crm/record-detail.types';
import type { FieldSection } from '@/shared/components/crm/record-overview-tab';
import type { RelatedSectionConfig } from '@/shared/components/crm/record-related-tab';

const DEAL_STATUSES: StatusConfig[] = [
  { value: 'In Progress', label: 'In Progress', variant: 'info' },
  { value: 'Closed Won', label: 'Won', variant: 'success' },
  { value: 'Closed Lost', label: 'Lost', variant: 'danger' },
];

export const dealDetailConfig: RecordDetailConfig = {
  module: 'deals',
  permissionModule: 'deals',
  editPermission: 'deals.edit',
  deletePermission: 'deals.archive',
  statuses: DEAL_STATUSES,
  activityFilterKey: 'dealId',
  headerExtra: 'pipeline-progress',

  actionTemplates: [
    { id: 'edit', label: 'Edit', icon: Pencil, primary: true, permission: 'deals.edit' },
    { id: 'duplicate', label: 'Duplicate', icon: Copy, permission: 'deals.create' },
    { id: 'archive', label: 'Archive', icon: Archive, permission: 'deals.archive' },
    { id: 'delete', label: 'Delete', icon: Trash2, variant: 'destructive', permission: 'deals.archive' },
  ],

  buildFieldSections: (record, onSave): FieldSection[] => [
    {
      id: 'deal-info',
      title: 'Deal Information',
      fields: [
        { key: 'title', label: 'Deal Title', value: record.title, type: 'text', editable: true, icon: Trophy, onSave: (v) => onSave('title', v) },
        { key: 'value', label: 'Value', value: record.value, type: 'number', editable: false, prefix: '₱' },
        { key: 'priority', label: 'Priority', value: record.priority, type: 'select', editable: true, options: [{ value: 'Low', label: 'Low' }, { value: 'Medium', label: 'Medium' }, { value: 'High', label: 'High' }], onSave: (v) => onSave('priority', v) },
        { key: 'expectedCloseDate', label: 'Close Date', value: record.expectedCloseDate, type: 'date', editable: true, onSave: (v) => onSave('expectedCloseDate', v) },
      ],
    },
    {
      id: 'pipeline-info',
      title: 'Pipeline & Stage',
      fields: [
        { key: 'pipelineName', label: 'Pipeline', value: (record.pipeline as Record<string, unknown>)?.name ?? '—', type: 'text', editable: false },
        { key: 'stageName', label: 'Stage', value: (record.stage as Record<string, unknown>)?.name ?? '—', type: 'text', editable: false },
        { key: 'lastStageChangeDate', label: 'Last Stage Change', value: record.lastStageChangeDate, type: 'date', editable: false },
      ],
    },
    {
      id: 'source-info',
      title: 'Source & Context',
      fields: [
        { key: 'leadSource', label: 'Lead Source', value: record.leadSource, type: 'text', editable: true, onSave: (v) => onSave('leadSource', v) },
        { key: 'industry', label: 'Industry', value: record.industry, type: 'text', editable: true, onSave: (v) => onSave('industry', v) },
        { key: 'companyName', label: 'Company', value: record.companyName, type: 'text', editable: false, icon: Building },
        { key: 'contactPerson', label: 'Contact', value: record.contactPerson, type: 'text', editable: false, icon: User },
      ],
    },
    {
      id: 'metadata',
      title: 'Record Info',
      defaultCollapsed: true,
      fields: [
        { key: 'createdAt', label: 'Created', value: record.createdAt, type: 'date', editable: false },
        { key: 'updatedAt', label: 'Updated', value: record.updatedAt, type: 'date', editable: false },
        { key: 'assignedUserId', label: 'Owner', value: (record.assignedUser as Record<string, unknown>)?.firstName ? `${(record.assignedUser as Record<string, unknown>).firstName} ${(record.assignedUser as Record<string, unknown>).lastName}` : (record.assignedUserId ?? 'Unassigned'), type: 'text', editable: false, icon: User },
      ],
    },
  ],

  buildRelatedSections: (relationships): Omit<RelatedSectionConfig, 'onAdd'>[] => {
    const rel = relationships ?? {};
    const sections: Omit<RelatedSectionConfig, 'onAdd'>[] = [];

    // Leads (via junction)
    const leads = (rel.leads as Array<Record<string, unknown>>) ?? [];
    if (leads.length > 0) {
      sections.push({
        id: 'leads',
        title: 'Associated Leads',
        icon: UserPlus,
        entityType: 'leads',
        records: leads,
        columns: [
          { key: 'firstName', label: 'Name', render: (_v, rec) => <span className="text-sm font-medium text-foreground">{`${rec.firstName ?? ''} ${rec.lastName ?? ''}`.trim()}</span> },
          { key: 'email', label: 'Email', render: (v) => <span className="text-xs text-muted-foreground">{String(v ?? '—')}</span> },
          { key: 'status', label: 'Status', render: (v) => <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{String(v ?? '')}</span> },
        ],
        emptyMessage: 'No leads linked to this deal.',
      });
    }

    // Contacts (via junction)
    const contacts = (rel.contacts as Array<Record<string, unknown>>) ?? [];
    sections.push({
      id: 'contacts',
      title: 'Associated Contacts',
      icon: User,
      entityType: 'contacts',
      records: contacts,
      columns: [
        { key: 'firstName', label: 'Name', render: (_v, rec) => <span className="text-sm font-medium text-foreground">{`${rec.firstName ?? ''} ${rec.lastName ?? ''}`.trim()}</span> },
        { key: 'email', label: 'Email', render: (v) => <span className="text-xs text-muted-foreground">{String(v ?? '—')}</span> },
        { key: 'phone', label: 'Phone', render: (v) => <span className="text-xs text-muted-foreground">{String(v ?? '—')}</span> },
      ],
      canAdd: true,
      addLabel: 'Link Contact',
      addPermission: 'deals.edit',
      emptyMessage: 'No contacts linked to this deal.',
    });

    // Account (single)
    const account = rel.account as Record<string, unknown> | null;
    if (account) {
      sections.push({
        id: 'account',
        title: 'Account',
        icon: Building,
        entityType: 'accounts',
        records: [account],
        columns: [
          { key: 'name', label: 'Name', render: (v) => <span className="text-sm font-semibold text-foreground">{String(v ?? '—')}</span> },
          { key: 'industry', label: 'Industry', render: (v) => <span className="text-xs text-muted-foreground">{String(v ?? '')}</span> },
        ],
        single: true,
        emptyMessage: 'No account linked.',
      });
    }

    // Tasks
    const tasks = (rel.tasks as Array<Record<string, unknown>>) ?? [];
    sections.push({
      id: 'tasks',
      title: 'Tasks',
      icon: CheckCircle2,
      entityType: 'tasks',
      records: tasks,
      columns: [
        { key: 'title', label: 'Title', render: (v) => <span className="text-sm font-medium text-foreground">{String(v ?? '—')}</span> },
        { key: 'status', label: 'Status', render: (v) => <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{String(v ?? 'pending')}</span> },
        { key: 'dueDate', label: 'Due', render: (v) => <span className="text-xs text-muted-foreground">{v ? new Date(String(v)).toLocaleDateString() : '—'}</span> },
      ],
      canAdd: true,
      addLabel: 'Add Task',
      addPermission: 'deals.create',
      emptyMessage: 'No tasks for this deal.',
    });

    return sections;
  },
};
