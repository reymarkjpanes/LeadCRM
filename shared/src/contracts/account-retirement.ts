import type { FieldLayout } from './field-catalog';

export const RETIRED_ACCOUNT_FIELDS = ['assignedUserId', 'assignedUser', 'productInterest', 'productInterests', 'productInterestId', 'productInterestIds', 'activeProducts', 'activeProductIds', 'productInterestOther', 'productsNormalized', 'productLinks', 'internalNotes', 'tags'] as const;
export const ACCOUNT_ADDITIONAL_GROUP_ID = 'accounts:additional-information';
export const ACCOUNT_RETIRED_GROUP_IDS = ['accounts:section:2', 'accounts:section:3', 'accounts:section:4'];
export const ACCOUNT_RETIREMENT_REASON = 'Account assignment, product fields, internal notes and tags are retired. Repair the referenced fields before activating this workflow.';

export function accountAdditionalGroupId(groups: FieldLayout['groups']): string {
  return groups.find(group => group.id === ACCOUNT_ADDITIONAL_GROUP_ID)?.id
    ?? [...groups].filter(group => !ACCOUNT_RETIRED_GROUP_IDS.includes(group.id) && group.label.trim().toLowerCase() === 'additional information').sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))[0]?.id
    ?? ACCOUNT_ADDITIONAL_GROUP_ID;
}

export function isRetiredAccountField(field: string, entity?: string): boolean {
  const parts = field.split('.');
  if (parts[0] === 'account' || parts[0] === 'accounts') return RETIRED_ACCOUNT_FIELDS.some(key => key === parts[1]);
  if (entity !== 'account' && entity !== 'accounts') return false;
  return RETIRED_ACCOUNT_FIELDS.some(key => key === (parts[0] === 'record' ? parts[1] : parts[0]));
}

/** Inspect structured references and template tokens, never ordinary text labels. */
export function retiredAccountWorkflowReferences(draft: { trigger: string; conditions?: unknown; actions?: unknown }): string[] {
  const entity = draft.trigger.split('.')[0], found = new Set<string>();
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (typeof object.field === 'string' && isRetiredAccountField(object.field, entity)) found.add(object.field);
    if (object.field === 'event.changedFields') for (const field of Array.isArray(object.value) ? object.value : [object.value]) {
      if (typeof field === 'string' && isRetiredAccountField(field, entity)) found.add(field);
    }
    if (Array.isArray(object.changedFields)) for (const field of object.changedFields) {
      if (typeof field === 'string' && isRetiredAccountField(field, entity)) found.add(field);
    }
    if (entity === 'account' && (object.type === 'assign_owner' || object.type === 'assign_record')) found.add('assignedUserId');
    if (entity === 'account' && object.type === 'create_task') {
      const config = object.config as Record<string, unknown> | undefined;
      const target = config?.assignmentTarget as { type?: string } | undefined;
      if (target?.type === 'record_owner' || target === undefined && !config?.assignedUserId) found.add('assignedUserId');
    }
    Object.values(object).forEach(inspect);
  };
  inspect(draft.conditions); inspect(draft.actions);
  for (const action of Array.isArray(draft.actions) ? draft.actions : []) {
    if (!action || typeof action !== 'object') continue;
    const config = action.config as Record<string, unknown> | undefined;
    const messageEntity = action.type === 'send_sms' && ['account', 'deal'].includes(entity) && config?.recipient
      ? config.recipient === 'primary_lead' ? 'lead' : 'contact' : entity;
    for (const key of ['title', 'description', 'subject', 'body', 'message']) {
      const value = config?.[key];
      if (typeof value === 'string') for (const token of value.matchAll(/{{\s*([\w.]+)\s*}}/g)) if (isRetiredAccountField(token[1], messageEntity)) found.add(token[1]);
    }
  }
  return [...found];
}

/** Preserve surviving built-in IDs and all custom controls when removing sections. */
export function upgradeAccountFieldLayout(layout: FieldLayout): FieldLayout {
  if (layout.module !== 'accounts') return layout;
  const next = structuredClone(layout);
  const removed = new Set(ACCOUNT_RETIRED_GROUP_IDS);
  next.groups = next.groups.filter(group => !removed.has(group.id));
  const target = accountAdditionalGroupId(next.groups);
  if (!next.groups.some(group => group.id === target)) next.groups.push({ id: target, label: 'Additional Information', order: Math.max(0, ...next.groups.map(group => group.order)) + 1 });
  if (Object.values(next.fields).some(field => removed.has(field.groupId))) {
    const groups = new Map(layout.groups.map(group => [group.id, group.order]));
    Object.entries(next.fields).filter(([key, field]) => !isRetiredAccountField(key, 'account') && (removed.has(field.groupId) || field.groupId === target))
      .sort(([ak, a], [bk, b]) => (groups.get(a.groupId) ?? Number.MAX_SAFE_INTEGER) - (groups.get(b.groupId) ?? Number.MAX_SAFE_INTEGER) || a.order - b.order || ak.localeCompare(bk))
      .forEach(([, field], index) => { field.order = index; });
  }
  for (const [key, field] of Object.entries(next.fields)) {
    if (key === 'notes' || isRetiredAccountField(key, 'account')) delete next.fields[key];
    else if (removed.has(field.groupId)) field.groupId = target;
  }
  return next;
}
