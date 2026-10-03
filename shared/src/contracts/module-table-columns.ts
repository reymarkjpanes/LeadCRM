import type { ColumnDefinition } from '../types/preferences';

function defineColumns(group: string, entries: [string, string][]): ColumnDefinition[] {
  return entries.map(([id, label], defaultOrder) => ({ id, label, defaultOrder, group,
    required: id === 'name', defaultVisible: true, priority: id === 'name' ? 'required' : 'low' }));
}

export const CAMPAIGNS_TABLE_COLUMNS = defineColumns('Campaigns', [
  ['name', 'Campaign'], ['type', 'Type'], ['status', 'Status'], ['target', 'Target'],
  ['submitted', 'Submitted'], ['opened', 'Opened'], ['clicked', 'Clicked'], ['engagement', 'Engagement'], ['createdAt', 'Created'],
]);
export const WORKFLOWS_TABLE_COLUMNS = defineColumns('Workflows', [
  ['name', 'Name'], ['trigger', 'Trigger'], ['status', 'Status'], ['lastRun', 'Last run'], ['runs', 'Runs'], ['actions', 'Actions'],
]);
export const USERS_TABLE_COLUMNS = defineColumns('Users', [
  ['name', 'User'], ['role', 'Role'], ['email', 'Contact'], ['status', 'Status'], ['department', 'Department'], ['activity', 'Actions'],
]);
