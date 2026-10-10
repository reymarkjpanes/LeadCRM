import { taskAssociationIds, type TaskRecord, type TaskRelatedRecord, type TaskLinkKind } from '@leadcrm/shared';
import { findTaskRecordContext } from './tasks.repository';

type Context = Awaited<ReturnType<typeof findTaskRecordContext>>;
type NamedRecord = { id: string; tenantId: string } & ({ firstName: string; lastName: string } | { title: string } | { name: string });
const label = (row: NamedRecord) => 'firstName' in row ? `${row.firstName} ${row.lastName}`.trim() : 'title' in row ? row.title : row.name;

export function withTaskContext(task: TaskRecord, context: Context): TaskRecord {
  const linked = (kind: TaskLinkKind, id: string) => taskAssociationIds(task, kind).includes(id);
  const related = new Map<string, TaskRelatedRecord>();
  const add = (kind: TaskLinkKind, row: NamedRecord | null, via: string) => {
    if (!row || row.tenantId !== task.tenantId || linked(kind, row.id)) return;
    const key = `${kind}:${row.id}`;
    if (!related.has(key)) related.set(key, { kind, id: row.id, label: label(row), via });
  };
  for (const row of context.leads.filter(row => row.tenantId === task.tenantId && linked('lead', row.id))) {
    const via = `Lead: ${label(row)}`;
    add('contact', row.convertedContact, via);
    add('account', row.account, via);
    for (const { deal } of row.leadDeals) add('deal', deal, via);
  }
  for (const row of context.contacts.filter(row => row.tenantId === task.tenantId && linked('contact', row.id))) {
    const via = `Contact: ${label(row)}`;
    add('account', row.account, via);
    for (const lead of row.convertedFromLeads) add('lead', lead, via);
    for (const { deal } of row.contactDeals) add('deal', deal, via);
  }
  for (const row of context.deals.filter(row => row.tenantId === task.tenantId && linked('deal', row.id))) {
    const via = `Deal: ${row.title}`;
    add('account', row.organization, via);
    for (const { lead } of row.leadDeals) add('lead', lead, via);
    for (const { contact } of row.contactDeals) add('contact', contact, via);
  }
  const accounts = context.accounts.filter(row => row.tenantId === task.tenantId && linked('account', row.id)).map(({ id, name }) => ({ id, name }));
  return { ...task, accounts, account: accounts.find(row => row.id === task.accountId) ?? null, relatedRecords: [...related.values()] };
}

export async function hydrateTaskRecords(tasks: TaskRecord[], tenantId: string): Promise<TaskRecord[]> {
  if (!tasks.length) return [];
  const ids = (kind: TaskLinkKind) => [...new Set(tasks.flatMap(task => taskAssociationIds(task, kind)))];
  const context = await findTaskRecordContext(tenantId, { leadIds: ids('lead'), contactIds: ids('contact'), dealIds: ids('deal'), accountIds: ids('account') });
  return tasks.map(task => withTaskContext(task, context));
}
