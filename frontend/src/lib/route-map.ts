/**
 * Bidirectional route map — App Router pathname ↔ legacy path string.
 * Single source of truth used by CrmLayout, auth pages, and route guards.
 */

export const PATHNAME_TO_PATH: Record<string, string> = {
  '/help':                         'help',
  '/onboarding':                   'onboarding',
  '/dashboard':                    'dashboard',
  '/crm/leads':                    'leads',
  '/crm/leads/import':             'leads',
  '/crm/contacts':                 'contacts',
  '/crm/contacts/import':          'contacts',
  '/crm/accounts':                 'accounts',
  '/crm/accounts/import':          'accounts',
  '/crm/deals/import':             'deals',
  '/crm/deals/imports':            'deals',
  '/crm/deals':                    'deals',
  '/crm/pipeline':                 'pipeline',
  '/automation/workflows':         'workflows',
  '/campaigns':                    'campaigns',
  '/marketing/forms':              'forms',
  '/crm/companies':                'accounts',
  '/card-showcase':                'card-showcase',
  '/marketing/campaigns':          'campaigns',
  '/reporting':                    'reports',
  // Legacy routes — these now redirect to Settings tabs
  '/administration/users':         'users',
  '/administration/roles':         'roles',
  // Settings
  '/settings':                     'settings',
  '/settings/account':             'settings',
  '/settings/profile':             'profile-settings',
  '/operations/taskboard':         'tasks',
  '/inbox':                        'inbox',
  '/notifications':                'notifications',
};

// Reverse map — canonical pathname for each path (first match wins)
export const PATH_TO_PATHNAME: Record<string, string> = {
  'help':                '/help',
  'onboarding':          '/onboarding',
  'dashboard':           '/dashboard',
  'contacts':            '/crm/contacts',
  'leads':               '/crm/leads',
  'accounts':            '/crm/accounts',
  'deals':               '/crm/deals',
  'pipeline':            '/crm/pipeline',
  'workflows':           '/automation/workflows',
  'forms':               '/marketing/forms',
  'campaigns':           '/marketing/campaigns',
  'reports':             '/reporting',
  // Legacy paths — resolve to redirect shells which bounce to Settings
  'users':               '/administration/users',
  'roles':               '/administration/roles',
  // Direct Settings tab entries (preferred for new navigation)
  'settings-users':      '/settings?tab=users',
  'settings-roles':      '/settings?tab=roles',
  // Settings
  'settings':            '/settings',
  'account-details':     '/settings?tab=org-general', // Legacy navigation alias
  'profile-settings':    '/settings/profile',
  'tasks':               '/operations/taskboard',
  'inbox':               '/inbox',
  'notifications':       '/notifications',
};

export function resolveModulePath(pathname: string): string {
  if (PATHNAME_TO_PATH[pathname]) return PATHNAME_TO_PATH[pathname];
  const parent = Object.keys(PATHNAME_TO_PATH)
    .sort((a, b) => b.length - a.length)
    .find((path) => pathname.startsWith(`${path}/`));
  return parent ? PATHNAME_TO_PATH[parent] : 'dashboard';
}
