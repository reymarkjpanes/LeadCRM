/**
 * Bidirectional route map — App Router pathname ↔ legacy path string.
 * Single source of truth used by CrmLayout, auth pages, and route guards.
 */

export const PATHNAME_TO_PATH: Record<string, string> = {
  '/onboarding':                   'onboarding',
  '/dashboard':                    'dashboard',
  '/crm/leads':                    'leads',
  '/crm/leads/import':             'leads',
  '/crm/contacts':                 'contacts',
  '/crm/contacts/import':          'contacts',
  '/crm/accounts':                 'accounts',
  '/crm/accounts/import':          'accounts',
  '/crm/deals':                    'deals',
  '/crm/pipeline':                 'pipeline',
  '/automation/workflows':         'workflows',
  '/marketing/campaigns':          'campaigns',
  '/reporting':                    'reports',
  // Legacy routes — these now redirect to Settings tabs
  '/administration/users':         'users',
  '/administration/roles':         'roles',
  '/administration/audit':         'audit-log',
  // Settings
  '/settings':                     'settings',
  '/settings/account':             'account-details',
  '/settings/profile':             'profile-settings',
  '/billing':                      'billing',
  '/billing/client':               'client-billing',
  '/operations/taskboard':         'tasks',
  '/inbox':                        'inbox',
  '/notifications':                'notifications',
  '/admin/dashboard':              'admin-dashboard',
  '/admin/clients':                'admin-clients',
  '/admin/pricing':                'admin-pricing',
  '/admin/billing':                'admin-billing',
  '/admin/audit':                  'admin-audit-log',
};

// Reverse map — canonical pathname for each path (first match wins)
export const PATH_TO_PATHNAME: Record<string, string> = {
  'onboarding':          '/onboarding',
  'dashboard':           '/dashboard',
  'contacts':            '/crm/contacts',
  'leads':               '/crm/leads',
  'accounts':            '/crm/accounts',
  'deals':               '/crm/deals',
  'pipeline':            '/crm/pipeline',
  'workflows':           '/automation/workflows',
  'campaigns':           '/marketing/campaigns',
  'reports':             '/reporting',
  // Legacy paths — resolve to redirect shells which bounce to Settings
  'users':               '/administration/users',
  'roles':               '/administration/roles',
  'audit-log':           '/administration/audit',
  // Direct Settings tab entries (preferred for new navigation)
  'settings-users':      '/settings?tab=users',
  'settings-audit':      '/settings?tab=audit',
  'settings-roles':      '/settings?tab=roles',
  // Settings
  'settings':            '/settings',
  'account-details':     '/settings/account',
  'profile-settings':    '/settings/profile',
  'billing':             '/billing',
  'client-billing':      '/billing/client',
  'tasks':               '/operations/taskboard',
  'inbox':               '/inbox',
  'notifications':       '/notifications',
  'admin-dashboard':     '/admin/dashboard',
  'admin-clients':       '/admin/clients',
  'admin-pricing':       '/admin/pricing',
  'admin-billing':       '/admin/billing',
  'admin-audit-log':     '/admin/audit',
};