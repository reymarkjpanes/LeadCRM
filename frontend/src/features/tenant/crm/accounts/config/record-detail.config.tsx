import {
  Pencil, Archive, Building, Globe, MapPin,
  User, UserPlus, Trophy, Tag,
} from 'lucide-react';
import type { RecordDetailConfig } from '@/shared/components/crm/record-detail.types';
import type { FieldSection } from '@/shared/components/crm/record-overview-tab';
import type { RelatedSectionConfig } from '@/shared/components/crm/record-related-tab';


export const accountDetailConfig: RecordDetailConfig = {
  module: 'accounts',
  permissionModule: 'accounts',
  editPermission: 'accounts.edit',
  deletePermission: 'accounts.archive',
  statuses: [],
  activityFilterKey: 'organizationId',

  actionTemplates: [
    { id: 'edit', label: 'Edit', icon: Pencil, primary: true, permission: 'accounts.edit' },
    { id: 'archive', label: 'Archive', icon: Archive, permission: 'accounts.archive' },
  ],

  buildFieldSections: (record, onSave): FieldSection[] => [
    {
      id: 'company-info',
      title: 'Company Information',
      fields: [
        { key: 'name', label: 'Company Name', value: record.name, type: 'text', editable: true, icon: Building, onSave: (v) => onSave('name', v) },
        { key: 'industry', label: 'Industry', value: record.industry, type: 'text', editable: true, onSave: (v) => onSave('industry', v) },
        { key: 'size', label: 'Company Size', value: record.size, type: 'select', editable: true, options: [{ value: '1-10', label: '1-10' }, { value: '11-50', label: '11-50' }, { value: '51-200', label: '51-200' }, { value: '200+', label: '200+' }], onSave: (v) => onSave('size', v) },
        { key: 'website', label: 'Website', value: record.website, type: 'url', editable: true, icon: Globe, onSave: (v) => onSave('website', v) },
      ],
    },
    {
      id: 'location',
      title: 'Location',
      fields: [
        { key: 'address', label: 'Address', value: record.address, type: 'text', editable: true, icon: MapPin, onSave: (v) => onSave('address', v) },
        { key: 'city', label: 'City', value: record.city, type: 'text', editable: true, onSave: (v) => onSave('city', v) },
        { key: 'province', label: 'Province', value: record.province, type: 'text', editable: true, onSave: (v) => onSave('province', v) },
        { key: 'country', label: 'Country', value: record.country, type: 'text', editable: false },
      ],
    },
    {
      id: 'account-details',
      title: 'Account Details',
      fields: [
        { key: 'productInterests', label: 'Interests', value: record.productInterests, type: 'tags', editable: true, icon: Tag, onSave: (v) => onSave('productInterests', v) },
        { key: 'notes', label: 'Notes', value: record.notes, type: 'textarea', editable: true, onSave: (v) => onSave('notes', v) },
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

    // Contacts
    const contacts = (rel.contacts as Array<Record<string, unknown>>) ?? [];
    sections.push({
      id: 'contacts',
      title: 'Contacts',
      icon: User,
      entityType: 'contacts',
      records: contacts,
      columns: [
        { key: 'firstName', label: 'Name', render: (_v, rec) => <span className="text-sm font-medium text-foreground">{`${rec.firstName ?? ''} ${rec.lastName ?? ''}`.trim()}</span> },
        { key: 'email', label: 'Email', render: (v) => <span className="text-xs text-muted-foreground">{String(v ?? '—')}</span> },
        { key: 'status', label: 'Status', render: (v) => <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{String(v ?? 'Active')}</span> },
      ],
      canAdd: true,
      addLabel: 'Add Contact',
      addPermission: 'contacts.create',
      emptyMessage: 'No contacts under this account.',
    });

    // Leads
    const leads = (rel.leads as Array<Record<string, unknown>>) ?? [];
    sections.push({
      id: 'leads',
      title: 'Leads',
      icon: UserPlus,
      entityType: 'leads',
      records: leads,
      columns: [
        { key: 'firstName', label: 'Name', render: (_v, rec) => <span className="text-sm font-medium text-foreground">{`${rec.firstName ?? ''} ${rec.lastName ?? ''}`.trim()}</span> },
        { key: 'email', label: 'Email', render: (v) => <span className="text-xs text-muted-foreground">{String(v ?? '—')}</span> },
        { key: 'status', label: 'Status', render: (v) => <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{String(v ?? 'Inquiry')}</span> },
      ],
      canAdd: true,
      addLabel: 'Add Lead',
      addPermission: 'contacts.create',
      emptyMessage: 'No leads under this account.',
    });

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
      emptyMessage: 'No deals for this account.',
    });

    return sections;
  },
};
