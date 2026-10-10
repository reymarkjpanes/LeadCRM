import { expect, it } from 'vitest';
import { resolveModulePath } from './route-map';

it.each(['leads', 'contacts', 'accounts'])('keeps %s context for copied detail URLs and imports', module => {
  for (const suffix of ['', '/record-id', '/import', '/imports/run-id']) {
    expect(resolveModulePath(`/crm/${module}${suffix}`)).toBe(module);
  }
  expect(resolveModulePath(`/crm/${module}-unrelated`)).toBe('dashboard');
});
it('preserves exact route precedence and existing nested help/workflow routes', () => {
  expect(resolveModulePath('/settings/profile')).toBe('profile-settings');
  expect(resolveModulePath('/help/leads')).toBe('help');
  expect(resolveModulePath('/automation/workflows/id')).toBe('workflows');
});
it.each([
  ['/campaigns/create', 'campaigns'], ['/marketing/forms/id', 'forms'],
  ['/crm/companies/id', 'accounts'], ['/settings/profile', 'profile-settings'],
])('preserves the module context for %s', (path, module) => {
  expect(resolveModulePath(path)).toBe(module);
});
