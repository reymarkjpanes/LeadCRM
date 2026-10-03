import {
  Pencil, Archive, Mail, Phone, MapPin, Building,
  Tag, Trophy, CheckCircle2, User,
} from 'lucide-react';
import type { RecordDetailConfig } from '@/shared/components/crm/record-detail.types';
import type { FieldSection } from '@/shared/components/crm/record-overview-tab';
import type { RelatedSectionConfig } from '@/shared/components/crm/record-related-tab';

import { CRM_DETAIL_STATUSES } from '@/shared/components/crm/crm-status';

export const contactDetailConfig: RecordDetailConfig = {
  module: 'contacts',
  permissionModule: 'contacts',
  editPermission: 'contacts.edit',
  deletePermission: 'contacts.archive',
  statuses: CRM_DETAIL_STATUSES,
  activityFilterKey: 'contactId',

  actionTemplates: [
    { id: 'edit', label: 'Edit', icon: Pencil, primary: true, permission: 'contacts.edit' },
    { id: 'archive', label: 'Archive', icon: Archive, permission: 'contacts.archive' },
  ],

  buildFieldSections: (record, onSave): FieldSection[] => [
    {
      id: 'contact-info',
      title: 'Contact Information',
      fields: [
        { key: 'firstName', label: 'First Name', value: record.firstName, type: 'text', editable: true, onSave: (v) => onSave('firstName', v) },
        { key: 'lastName', label: 'Last Name', value: record.lastName, type: 'text', editable: true, onSave: (v) => onSave('lastName', v) },
        { key: 'email', label: 'Email', value: record.email, type: 'email', editable: true, icon: Mail, onSave: (v) => onSave('email', v) },
        { key: 'phone', label: 'Phone', value: record.phone, type: 'phone', editable: true, icon: Phone, onSave: (v) => onSave('phone', v) },
        { key: 'address', label: 'Address', value: record.address, type: 'text', editable: true, icon: MapPin, onSave: (v) => onSave('address', v) },
        { key: 'jobTitle', label: 'Job Title', value: record.jobTitle, type: 'text', editable: true, onSave: (v) => onSave('jobTitle', v) },
      ],
    },
    {
      id: 'company-info',
      title: 'Company',
      fields: [
        { key: 'companyName', label: 'Company', value: record.companyName, type: 'text', editable: true, icon: Building, onSave: (v) => onSave('companyName', v) },
        { key: 'department', label: 'Department', value: record.department, type: 'text', editable: true, onSave: (v) => onSave('department', v) },
      ],
    },
    {
      id: 'contact-details',
      title: 'Details',
      fields: [
        { key: 'lifecycleStage', label: 'Lifecycle', value: record.lifecycleStage, type: 'text', editable: true, onSave: (v) => onSave('lifecycleStage', v) },
        { key: 'leadSource', label: 'Source', value: record.leadSource ?? record.source, type: 'text', editable: true, onSave: (v) => onSave('leadSource', v) },
        { key: 'productInterests', label: 'Interests', value: record.productInterests, type: 'tags', editable: true, icon: Tag, onSave: (v) => onSave('productInterests', v) },
        { key: 'customerType', label: 'Type', value: record.customerType, type: 'text', editable: true, onSave: (v) => onSave('customerType', v) },
      ],
    },
    {
      id: 'metadata',
      title: 'Record Info',
      defaultCollapsed: true,
      fields: [
        { key: 'createdAt', label: 'Created', value: record.createdAt, type: 'date', editable: false },
        { key: 'updatedAt', label: 'Updated', value: record.updatedAt, type: 'date', editable: false },
        { key: 'assignedUserId', label: 'Assigned To', value: (record.assignedUser as Record<string, unknown>)?.firstName ? `${(record.assignedUser as Record<string, unknown>).firstName} ${(record.assignedUser as Record<string, unknown>).lastName}` : (record.assignedUserId ?? 'Unassigned'), type: 'text', editable: false, icon: User },
      ],
    },
  ],

  buildRelatedSections: (relationships): Omit<RelatedSectionConfig, 'onAdd'>[] => {
    const rel = relationships ?? {};
    const sections: Omit<RelatedSectionConfig, 'onAdd'>[] = [];

    // Deals
    const deals = (rel.deals as Array<Record<string, unknown>>) ?? [];
    sections.push({
      id: 'deals',
      title: 'Deals',
      icon: Trophy,
      entityType: 'deals',
      records: deals,
      columns: [],
      renderMode: 'card',
      canAdd: true,
      addLabel: 'Create Deal',
      addPermission: 'deals.create',
      emptyMessage: 'No deals associated with this contact.',
    });

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
      addPermission: 'contacts.create',
      emptyMessage: 'No tasks for this contact.',
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

    // Source Lead (single)
    const sourceLead = rel.sourceLead as Record<string, unknown> | null;
    if (sourceLead) {
      sections.push({
        id: 'source-lead',
        title: 'Source Lead',
        icon: User,
        entityType: 'leads',
        records: [sourceLead],
        columns: [
          { key: 'firstName', label: 'Name', render: (_v, rec) => <span className="text-sm font-semibold text-foreground">{`${rec.firstName ?? ''} ${rec.lastName ?? ''}`.trim()}</span> },
          { key: 'email', label: 'Email', render: (v) => <span className="text-xs text-muted-foreground">{String(v ?? '')}</span> },
        ],
        single: true,
        emptyMessage: 'No source lead.',
      });
    }

    return sections;
  },
};
