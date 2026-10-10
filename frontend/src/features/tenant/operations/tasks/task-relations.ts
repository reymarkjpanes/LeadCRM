import type { TaskLinkKind, TaskOption, TaskRecord } from '@leadcrm/shared';

/** Response hydration can be partial; merge legacy and plural display records by ID. */
export function taskRecordOptions(task: TaskRecord | undefined, kind: TaskLinkKind): TaskOption[] {
  if (!task) return [];
  const records = kind === 'lead' ? [...(task.leads ?? []), task.lead]
    : kind === 'contact' ? [...(task.contacts ?? []), task.contact]
      : kind === 'deal' ? [...(task.deals ?? []), task.deal]
        : [...(task.accounts ?? []), task.account];
  const options = new Map<string, TaskOption>();
  for (const record of records) {
    if (!record || options.has(record.id)) continue;
    const label = 'firstName' in record ? `${record.firstName} ${record.lastName}`.trim()
      : 'title' in record ? record.title : record.name;
    options.set(record.id, { id: record.id, label: label || 'Unnamed record' });
  }
  return [...options.values()];
}
