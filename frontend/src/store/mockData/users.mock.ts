import { PERMISSION_MODULES, permissionLabel } from '@leadcrm/shared';
import type { Tenant, User, Permission, RoleDefinition } from '../types';

// ─── Tenants ─────────────────────────────────────────────────────────────────

export const MOCK_TENANTS: Tenant[] = [
  {
    id: 'tenant_demo',
    name: 'Demo Corp Solutions',
    industry: 'IT Solutions',
    size: '50-200',
    email: 'contact@camxian.com',
    phone: '+1 (555) 123-4567',
    address: '123 Tech Lane, Silicon Valley, CA',
    status: 'active',
    createdAt: '2025-01-15T08:00:00.000Z',
  },
  {
    id: 'tenant_2',
    name: 'Global Logistics Inc.',
    industry: 'Logistics',
    size: '500+',
    email: 'info@globallogistics.com',
    phone: '+1 (555) 987-6543',
    address: '456 Freight Blvd, Chicago, IL',
    status: 'active',
    createdAt: '2025-02-20T10:30:00.000Z',
  },
  {
    id: 'tenant_3',
    name: 'NextGen Healthcare',
    industry: 'Healthcare',
    size: '200-500',
    email: 'partners@nextgenhealth.com',
    phone: '+1 (555) 456-7890',
    address: '789 Medical Parkway, Boston, MA',
    status: 'pending',
    createdAt: '2026-03-28T14:15:00.000Z',
  },
  {
    id: 'tenant_4',
    name: 'Starlight Media',
    industry: 'Media & Entertainment',
    size: '10-50',
    email: 'hello@starlightmedia.net',
    phone: '+1 (555) 234-5678',
    address: '321 Creative Studio, Austin, TX',
    status: 'suspended',
    createdAt: '2025-06-10T09:45:00.000Z',
  },
];

// ─── Users ────────────────────────────────────────────────────────────────────

export const MOCK_USERS: User[] = [
  {
    id: 'user_client_admin',
    tenantId: 'tenant_demo',
    firstName: 'Alice',
    lastName: 'Admin',
    email: 'admin@camxian.com',
    role: 'Client Admin',
    status: 'active',
    team: 'Management',
  },
  {
    id: 'user_sales_1',
    tenantId: 'tenant_demo',
    firstName: 'Bob',
    lastName: 'Sales',
    email: 'bob@camxian.com',
    role: 'Sales',
    status: 'active',
    team: 'Sales Team A',
  },
  {
    id: 'user_sales_2',
    tenantId: 'tenant_demo',
    firstName: 'Sarah',
    lastName: 'Jenkins',
    email: 'sarah.j@camxian.com',
    role: 'Sales',
    status: 'active',
    team: 'Sales Team A',
  },
  {
    id: 'user_sales_3',
    tenantId: 'tenant_demo',
    firstName: 'Michael',
    lastName: 'Chen',
    email: 'm.chen@camxian.com',
    role: 'Sales',
    status: 'active',
    team: 'Sales Team B',
  },
];

// ─── Permissions ─────────────────────────────────────────────────────────────

export const MOCK_PERMISSIONS: Permission[] = PERMISSION_MODULES.flatMap(module => module.actions.map(action => ({
  id: module.key + '.' + action, name: permissionLabel(module, action), category: module.key, description: '',
})));

// ─── Roles ────────────────────────────────────────────────────────────────────

export const MOCK_ROLES: RoleDefinition[] = [
  {
    id: 'r1',
    tenantId: 'tenant_demo',
    name: 'Client Admin',
    description: 'Full tenant ownership. Manages users, roles and all CRM data.',
    isSystemRole: true,
    userCount: 1,
    permissions: MOCK_PERMISSIONS.map(p => p.id),
    updatedAt: '1/1/2026',
  },
  {
    id: 'r3',
    tenantId: 'tenant_demo',
    name: 'Sales',
    description: 'Standard access for everyday operations, sales, and reporting.',
    isSystemRole: false,
    userCount: 3,
    permissions: ['dashboard.canView', 'leads.canView', 'contacts.canView', 'deals.canView', 'tasks.canView'],
    updatedAt: '1/1/2026',
  },
  {
    id: 'rc1',
    tenantId: 'tenant_demo',
    name: 'Intern',
    description: 'Limited access for learning and basic tasks',
    isSystemRole: false,
    userCount: 2,
    permissions: ['dashboard.canView', 'leads.canView', 'contacts.canView', 'deals.canView', 'tasks.canView'],
    updatedAt: '4/10/2026',
  },
  {
    id: 'rc2',
    tenantId: 'tenant_demo',
    name: 'External Contractor',
    description: 'Restricted CRM access for external consultants',
    isSystemRole: false,
    userCount: 1,
    permissions: ['dashboard.canView', 'leads.canView', 'contacts.canView', 'deals.canView', 'tasks.canView'],
    updatedAt: '4/12/2026',
  },
];
