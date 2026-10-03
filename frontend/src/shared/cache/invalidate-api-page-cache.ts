import { clearPageCache, invalidatePageCache } from './page-cache';

/** Successful writes invalidate every cached view of the affected data, including imports and drawers. */
export function invalidateApiPageCache(path: string): void {
  const [area, resource] = path.split('?')[0].split('/').filter(Boolean);
  if (area === 'auth') {
    clearPageCache();
    return;
  }
  const modules = new Set<string>();
  if (['crm', 'marketing', 'automation', 'administration'].includes(area)) modules.add('archived-crm');
  if (area === 'administration' && resource === 'archived-data') {
    const type = path.split('/')[3];
    if (type === 'Role') { clearPageCache(); return; }
    if (type === 'Pipeline') { modules.add('pipeline'); modules.add('pipelines'); }
    if (type === 'Workflow') modules.add('workflows');
    if (type === 'Campaign' || type === 'Template') { modules.add('campaigns'); modules.add('templates'); }
  }
  if (area === 'crm') {
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
    if (resource === 'leads') { modules.add('deals'); modules.add('counts-deals'); }
    if (resource === 'deals') {
      modules.add('deals');
      if (/\/(stage|closing-requirements)$/.test(path.split('?')[0])) {
        ['leads', 'contacts', 'accounts', 'counts-leads', 'counts-contacts', 'counts-accounts'].forEach(module => modules.add(module));
      }
    }
    if (resource === 'accounts' || resource === 'organizations') modules.add('accounts');
    if (resource === 'deals' || resource === 'pipelines') modules.add('pipeline');
  }
  if (area === 'marketing') modules.add('campaigns');
  if (area === 'automation' && resource === 'workflows') modules.add('workflows');

  if (area === 'notifications') modules.add('notifications');
  if (area === 'operations') {
    modules.add('activities');
    modules.add('reports');
  }
  if (area === 'administration' && (resource === 'roles' || resource === 'users')) {
    clearPageCache();
    return;
  }
  modules.forEach((module) => invalidatePageCache(module));
}
