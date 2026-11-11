import { clearPageCache, invalidatePageCache } from './page-cache';

/** Successful writes invalidate every cached view of the affected data, including imports and drawers. */
export function invalidateApiPageCache(path: string): void {
  const [area, resource] = path.split('?')[0].split('/').filter(Boolean);
  if (area === 'crm' && resource === 'merge' && path.split('?')[0].endsWith('/preview')) return;
  if (area === 'automation' && /^\/automation\/workflows\/(?:validate|[^/]+\/test)$/.test(path.split('?')[0])) return;
  if (area === 'auth') {
    if (resource === 'activity') return;
    clearPageCache(true);
    return;
  }
  const modules = new Set<string>();
  if (area === 'administration' && resource === 'closing-requirements') {
    ['settings', 'leads', 'contacts', 'accounts', 'deals'].forEach(module => modules.add(module));
  }
  if (area === 'administration' && resource === 'organization-settings') modules.add('settings');
  if (['crm', 'marketing', 'automation', 'administration'].includes(area)) modules.add('archived-crm');
  if (area === 'administration' && resource === 'archived-data') {
    const type = path.split('/')[3];
    if (type === 'Role') { clearPageCache(true); return; }
    if (type === 'Pipeline') { modules.add('pipeline'); modules.add('pipelines'); }
    if (type === 'Task') { modules.add('tasks'); modules.add('activities'); modules.add('reports'); }
    if (type === 'Workflow') modules.add('workflows');
    if (type === 'Campaign' || type === 'Template') { modules.add('campaigns'); modules.add('templates'); }
  }
  if (area === 'crm') {
    if (resource === 'merge') ['leads', 'contacts', 'accounts', 'deals', 'tasks', 'campaigns', 'counts-leads', 'counts-contacts', 'counts-accounts', 'counts-deals'].forEach(module => modules.add(module));
    if (['leads', 'contacts', 'accounts', 'companies'].includes(resource)) modules.add('archived-crm');
    if (resource === 'leads' || resource === 'contacts') modules.add(`counts-${resource}`);
    if (resource === 'accounts' || resource === 'organizations') modules.add('counts-accounts');
    if (resource === 'deals' || resource === 'pipelines') modules.add('counts-deals');
    if (resource === 'leads' && path.split('?')[0].endsWith('/convert')) {
      ['counts-leads', 'counts-contacts', 'counts-accounts', 'counts-deals'].forEach(module => modules.add(module));
    }
    modules.add('activities');
    modules.add('reports');
    if (resource === 'leads' || resource === 'contacts') {
      // Conversion can update all three entity lists.
      ['leads', 'contacts', 'accounts', 'counts-leads', 'counts-contacts', 'counts-accounts'].forEach((module) => modules.add(module));
    }
    if (resource === 'leads' || resource === 'contacts') { modules.add('deals'); modules.add('counts-deals'); modules.add('pipeline'); }
    if (resource === 'deals') {
      modules.add('deals');
      if (/\/(stage|closing-requirements)$/.test(path.split('?')[0])) {
        ['leads', 'contacts', 'accounts', 'counts-leads', 'counts-contacts', 'counts-accounts'].forEach(module => modules.add(module));
      }
    }
    if (resource === 'accounts' || resource === 'organizations') ['accounts', 'leads', 'contacts', 'deals'].forEach(module => modules.add(module));
    if (resource === 'deals' || resource === 'pipelines') modules.add('pipeline');
  }
  if (area === 'marketing') modules.add('campaigns');
  if (area === 'automation' && resource === 'workflows') modules.add('workflows');

  if (area === 'notifications') modules.add('notifications');
  if (area === 'operations') {
    modules.add('activities');
    modules.add('reports');
    if (resource === 'tasks') { modules.add('tasks'); modules.add('archived-crm'); }
  }
  if (area === 'administration' && resource === 'groups') {
    ['users', 'groups', 'workflows'].forEach(module => modules.add(module));
  }
  if (area === 'administration' && (resource === 'roles' || resource === 'users')) {
    clearPageCache(true);
    return;
  }
  modules.forEach((module) => invalidatePageCache(module, undefined, true, area === 'administration' && resource === 'groups' && module === 'workflows'));
}
