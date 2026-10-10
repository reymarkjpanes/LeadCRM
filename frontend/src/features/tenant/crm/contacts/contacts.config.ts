/**
 * Contacts Module_Config — declarative configuration for the Data_View_System.
 * References the column registry directly (same array instance, not a copy).
 */

import { CRM_STATUSES } from '@leadcrm/shared';
import type { ModuleConfig } from '@leadcrm/shared';
import { CONTACTS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';

export const CONTACTS_MODULE_CONFIG: ModuleConfig = {
  moduleId: 'contacts',
  columnRegistry: CONTACTS_COLUMN_REGISTRY,
  availableViews: ['table'],
  sortableFields: [
    { id: 'firstName', label: 'Name' },
    { id: 'email', label: 'Email' },
    { id: 'companyName', label: 'Company' },
    { id: 'status', label: 'Status' },
    { id: 'createdAt', label: 'Created Date' },
  ],
  filterGroups: [
    {
      id: 'status',
      label: 'Status',
      items: CRM_STATUSES.map(status => ({ id: status, label: status })),
    },
    {
      id: 'source',
      label: 'Source',
      items: [
        { id: 'website', label: 'Website' },
        { id: 'referral', label: 'Referral' },
        { id: 'social', label: 'Social Media' },
        { id: 'import', label: 'Import' },
        { id: 'other', label: 'Other' },
      ],
    },
  ],
  rowActions: [
    { id: 'view', label: 'View' },
    { id: 'edit', label: 'Edit' },
    { id: 'archive', label: 'Archive' },
  ],
  bulkActions: [
    { id: 'archive', label: 'Archive', destructive: false },
    { id: 'export', label: 'Export', destructive: false },
  ],
};
