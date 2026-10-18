import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSED_WON_GROUP_ID, CUSTOM_FIELD_MODULES, DEFAULT_CLOSING_FIELDS, upgradeAssignmentLayout, defaultFieldLayout, getCrmFieldCatalog, getWorkflowConditionFields, getWorkflowUpdateFields, isClosedWonField, isSystemClosingField, type ClosingField } from '@leadcrm/shared';

const state = vi.hoisted(() => ({ definitions: [] as Array<{ tenantId: string; id: string; definition: unknown }>, preferences: [] as Array<{ tenantId: string; module: string; key: string; value: unknown }>, values: [] as Array<{ fieldId: string; value: unknown }>, workflows: [] as unknown[], forms: [] as unknown[], audiences: [] as unknown[], templates: [] as unknown[], campaigns: [] as unknown[], audits: [] as unknown[] }));
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => []),
  closingFieldDefinition: {
    findMany: vi.fn(async ({ where }: any) => structuredClone(state.definitions.filter(row => row.tenantId === where.tenantId))),
    createMany: vi.fn(async ({ data }: any) => { state.definitions.push(...data); }),
    create: vi.fn(async ({ data }: any) => { state.definitions.push(data); return data; }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => structuredClone(state.definitions.find(row => row.id === where.tenantId_id.id && row.tenantId === where.tenantId_id.tenantId)!)),
    update: vi.fn(async ({ where, data }: any) => { const row = state.definitions.find(row => row.id === where.tenantId_id.id && row.tenantId === where.tenantId_id.tenantId)!; Object.assign(row, data); return row; }),
  },
  tenantPreference: {
    findUnique: vi.fn(async ({ where }: any) => structuredClone(state.preferences.find(row => row.tenantId === where.tenantId_module_key.tenantId && row.module === where.tenantId_module_key.module && row.key === where.tenantId_module_key.key) ?? null)),
    upsert: vi.fn(async ({ where, create }: any) => { const row = state.preferences.find(row => row.tenantId === where.tenantId_module_key.tenantId && row.module === where.tenantId_module_key.module); if (row) return structuredClone(row); state.preferences.push(create); return structuredClone(create); }),
    update: vi.fn(async ({ where, data }: any) => { const row = state.preferences.find(row => row.tenantId === where.tenantId_module_key.tenantId && row.module === where.tenantId_module_key.module)!; Object.assign(row, data); return row; }),
  },
  customFieldValue: { count: vi.fn(async ({ where }: any) => state.values.filter(value => value.fieldId === where.fieldId && where.OR.some((condition: any) => condition.value.equals === value.value)).length) },
  workflow: { findMany: vi.fn(async () => state.workflows) }, marketingForm: { findMany: vi.fn(async () => state.forms) }, targetAudience: { findMany: vi.fn(async () => state.audiences) }, template: { findMany: vi.fn(async () => state.templates) }, campaign: { findMany: vi.fn(async () => state.campaigns) },
  auditLog: { create: vi.fn(async ({ data }: any) => { state.audits.push(data); return data; }) },
}));
vi.mock('../leads/lead-automation.service', () => ({ salesTransaction: (callback: (tx: unknown) => unknown) => callback(tx) }));
vi.mock('../../automation/triggers/triggers.service', () => ({ fireDealStageChanged: vi.fn(), fireDealUpdated: vi.fn() }));
vi.mock('../deals/deals.repository', () => ({ moveDealStage: vi.fn() }));
import { getFieldLayout, updateFieldLayout } from './field-layout.service';
import { deleteField, referencesCustomField, saveField } from './closing-requirements.service';
import { readFields, readFieldsForDisplay } from './closing-requirements.repository';
import { canonicalFieldValues } from './custom-field-values.repository';
import { customFieldAliasBase, resolveCustomFieldReference } from '@leadcrm/shared';

beforeEach(() => { for (const values of Object.values(state)) values.length = 0; state.definitions.push(...DEFAULT_CLOSING_FIELDS.map(definition => ({ tenantId: 'tenant', id: definition.id, definition }))); vi.clearAllMocks(); });
const createField = (extra = {}) => saveField('tenant', 'actor', { module: 'leads', group: 'Basic Information', type: 'Number', name: 'Budget', required: false, ...extra });

it('initializes display metadata once and keeps subsequent display reads free of configuration writes', async () => {
  await getFieldLayout('tenant', 'leads');
  vi.clearAllMocks();
  await Promise.all([readFieldsForDisplay(tx as any, 'tenant'), getFieldLayout('tenant', 'leads'), readFieldsForDisplay(tx as any, 'tenant', true)]);
  expect(tx.tenantPreference.upsert).not.toHaveBeenCalled(); expect(tx.tenantPreference.update).not.toHaveBeenCalled();
  expect(tx.closingFieldDefinition.update).not.toHaveBeenCalled(); expect(tx.closingFieldDefinition.createMany).not.toHaveBeenCalled();
});

describe('field configuration identity and preservation', () => {
  it('keeps native technical keys and custom IDs stable across labels, hiding and saved section ordering', async () => {
    const first = await getFieldLayout('tenant', 'leads');
    const added = await updateFieldLayout('tenant', 'actor', 'leads', { action: 'add', label: ' Technical details ' });
    const group = added.layout.groups.find(group => group.label === 'Technical details')!;
    const budget = await createField({ group: group.label, groupId: group.id });
    state.values.push({ fieldId: budget.id, value: 0 });
    await updateFieldLayout('tenant', 'actor', 'leads', { action: 'rename', groupId: group.id, label: 'Project information' });
    await updateFieldLayout('tenant', 'actor', 'leads', { action: 'moveGroup', groupId: group.id, direction: 'up' });
    await saveField('tenant', 'actor', { name: 'Project value', visibleInDetails: false }, budget.id);
    const next = await getFieldLayout('tenant', 'leads'), entry = next.fields.find(field => field.customFieldId === budget.id)!;
    expect(entry).toMatchObject({ label: 'Project value', technicalKey: 'customFieldValues.budget', canonicalTechnicalKey: `customFieldValues.${budget.id}`, groupId: group.id, group: 'Project information', visibleInDetails: false });
    expect(state.values).toEqual([{ fieldId: budget.id, value: 0 }]);
    expect(next.layout.groups.find(item => item.id === group.id)?.order).toBe(first.layout.groups.length - 1);
    await updateFieldLayout('tenant', 'actor', 'leads', { action: 'field', technicalKey: 'email', label: 'Work email' });
    expect((await getFieldLayout('tenant', 'leads')).fields.find(field => field.technicalKey === 'email')?.label).toBe('Work email');
  });
  it('rejects prohibited type/module/key changes, mandatory hiding and required custom hiding', async () => {
    const budget = await createField({ required: true });
    for (const patch of [{ type: 'Text' }, { module: 'contacts' }, { technicalKey: 'changed' }, { id: 'spoofed' }, { visibleInForm: false }]) await expect(saveField('tenant', 'actor', patch, budget.id)).rejects.toThrow();
    await expect(updateFieldLayout('tenant', 'actor', 'leads', { action: 'field', technicalKey: 'email', visibleInForm: false })).rejects.toThrow('mandatory');
    await saveField('tenant', 'actor', { required: false, visibleInForm: false }, budget.id);
    const hidden = (await readFields(tx as any, 'tenant')).find(field => field.id === budget.id)!;
    expect(getWorkflowConditionFields('lead', undefined, [hidden]).some(field => field.field === `lead.customFieldValues.${budget.id}`)).toBe(true);
    expect(getWorkflowUpdateFields('lead', [hidden]).some(field => field.field === `customFieldValues.${budget.id}`)).toBe(false);
  });
  it.each(['leads', 'contacts'] as const)('rejects ignored native %s section moves while retaining labels and custom field placement', async module => {
    const original = await getFieldLayout('tenant', module);
    const email = original.fields.find(field => field.technicalKey === 'email')!;
    const target = original.layout.groups.find(group => group.id !== email.groupId)!;
    const snapshot = structuredClone(state);
    await expect(updateFieldLayout('tenant', 'actor', module, { action: 'field', technicalKey: 'email', groupId: target.id })).rejects.toThrow('fixed section');
    expect(state).toEqual(snapshot);
    const renamed = await updateFieldLayout('tenant', 'actor', module, { action: 'field', technicalKey: 'email', groupId: email.groupId, label: 'Work email' });
    expect(renamed.fields.find(field => field.technicalKey === 'email')).toMatchObject({ label: 'Work email', groupId: email.groupId });
    const stored = state.preferences.find(row => row.module === module)!;
    (stored.value as import('@leadcrm/shared').FieldLayout).fields.email.groupId = target.id;
    const visibility = await updateFieldLayout('tenant', 'actor', module, { action: 'field', technicalKey: 'email', visibleInDetails: false });
    expect(visibility.fields.find(field => field.technicalKey === 'email')).toMatchObject({ groupId: email.groupId, visibleInDetails: false });
  });
  it('uses exact seeded IDs and a protected context, preserving renamed closing validation', async () => {
    const original = DEFAULT_CLOSING_FIELDS[0];
    expect(isSystemClosingField(original)).toBe(true);
    expect(isSystemClosingField({ ...original, id: 'user-id' })).toBe(false);
    await updateFieldLayout('tenant', 'actor', 'deals', { action: 'rename', groupId: CLOSED_WON_GROUP_ID, label: 'Approval evidence' });
    const renamed = (await readFields(tx as any, 'tenant')).find(field => field.id === original.id)!;
    expect(renamed.group).toBe('Approval evidence'); expect(isClosedWonField(renamed)).toBe(true);
    await expect(deleteField('tenant', 'actor', original.id)).rejects.toThrow('System fields');
    await expect(updateFieldLayout('tenant', 'actor', 'deals', { action: 'delete', groupId: CLOSED_WON_GROUP_ID })).rejects.toThrow('protected');
    await expect(updateFieldLayout('tenant', 'actor', 'deals', { action: 'field', technicalKey: `customFieldValues.${original.id}`, groupId: defaultFieldLayout('deals').groups[0].id })).rejects.toThrow('closing evidence');
  });
  it('deletes ordinary sections only through an explicit same-module move and preserves field/value identities', async () => {
    const added = await updateFieldLayout('tenant', 'actor', 'leads', { action: 'add', label: 'Custom-only section' });
    const group = added.layout.groups.find(group => group.label === 'Custom-only section')!, groupId = group.id;
    const field = await createField({ groupId, group: group.label }), before = await getFieldLayout('tenant', 'leads');
    state.values.push({ fieldId: field.id, value: 42 });
    await expect(updateFieldLayout('tenant', 'actor', 'leads', { action: 'delete', groupId })).rejects.toThrow('Choose another');
    const moved = await updateFieldLayout('tenant', 'actor', 'leads', { action: 'delete', groupId, moveToGroupId: before.layout.groups[1].id });
    expect(moved.layout.groups.some(group => group.id === groupId)).toBe(false);
    expect(moved.fields.find(item => item.customFieldId === field.id)?.groupId).toBe(before.layout.groups[1].id);
    expect(state.values).toEqual([{ fieldId: field.id, value: 42 }]);
    await expect(updateFieldLayout('tenant', 'actor', 'leads', { action: 'add', label: ' status & INTEREST ' })).rejects.toThrow('unique');
  });
  it.each(CUSTOM_FIELD_MODULES)('rejects deleting System-containing %s groups before any relocation or configuration write', async module => {
    const before = await getFieldLayout('tenant', module), groupId = before.layout.groups[0].id;
    const snapshot = structuredClone(state);
    vi.clearAllMocks();
    for (const moveToGroupId of [undefined, before.layout.groups[1].id]) {
      await expect(updateFieldLayout('tenant', 'actor', module, { action: 'delete', groupId, ...(moveToGroupId ? { moveToGroupId } : {}), expectedRevision: before.layout.revision ?? 0 })).rejects.toMatchObject({ name: 'ValidationError', statusCode: 400, message: 'Groups containing system fields cannot be deleted.' });
    }
    expect(state).toEqual(snapshot);
    expect(tx.tenantPreference.update).not.toHaveBeenCalled();
    expect(tx.closingFieldDefinition.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('protects mixed Account groups after a System field moves there, retaining rename, reorder and presentation editing', async () => {
    const added = await updateFieldLayout('tenant', 'actor', 'accounts', { action: 'add', label: 'Mixed section' });
    const group = added.layout.groups.find(group => group.label === 'Mixed section')!;
    const custom = await createField({ module: 'accounts', groupId: group.id, group: group.label });
    state.values.push({ fieldId: custom.id, value: 0 });
    await updateFieldLayout('tenant', 'actor', 'accounts', { action: 'field', technicalKey: 'website', groupId: group.id, label: 'Work website', visibleInDetails: false });
    await updateFieldLayout('tenant', 'actor', 'accounts', { action: 'rename', groupId: group.id, label: 'Renamed mixed section' });
    await updateFieldLayout('tenant', 'actor', 'accounts', { action: 'moveGroup', groupId: group.id, direction: 'up' });
    const before = await getFieldLayout('tenant', 'accounts');
    expect(before.fields.find(field => field.technicalKey === 'website')).toMatchObject({ kind: 'System', groupId: group.id, label: 'Work website', visibleInDetails: false });
    expect(before.layout.groups.find(item => item.id === group.id)?.label).toBe('Renamed mixed section');
    const snapshot = structuredClone(state);
    vi.clearAllMocks();
    await expect(updateFieldLayout('tenant', 'actor', 'accounts', { action: 'delete', groupId: group.id, moveToGroupId: before.layout.groups[0].id })).rejects.toThrow('Groups containing system fields cannot be deleted.');
    expect(state).toEqual(snapshot);
    expect(tx.tenantPreference.update).not.toHaveBeenCalled();
    expect(tx.closingFieldDefinition.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('still deletes empty custom-only groups without a relocation destination', async () => {
    const added = await updateFieldLayout('tenant', 'actor', 'leads', { action: 'add', label: 'Empty custom section' });
    const groupId = added.layout.groups.find(group => group.label === 'Empty custom section')!.id;
    const saved = await updateFieldLayout('tenant', 'actor', 'leads', { action: 'delete', groupId });
    expect(saved.layout.groups.some(group => group.id === groupId)).toBe(false);
  });
  it('blocks saved dependencies and used option removal, then retires unreferenced custom fields without purging evidence', async () => {
    const field = await createField({ type: 'Dropdown', options: ['Gold', 'Silver'] });
    state.values.push({ fieldId: field.id, value: 'Gold' });
    await expect(saveField('tenant', 'actor', { options: ['Silver'] }, field.id)).rejects.toThrow('saved records');
    state.workflows.push({ id: 'workflow', name: 'Qualify', conditions: { conditions: [{ field: `lead.customFieldValues.${field.id}`, value: 'Gold' }] } });
    await expect(deleteField('tenant', 'actor', field.id)).rejects.toThrow('Qualify'); state.workflows.length = 0;
    state.templates.push({ id: 'template', name: 'Welcome', content: `Budget {{customFieldValues.${field.id}}}` });
    await expect(deleteField('tenant', 'actor', field.id)).rejects.toThrow('Welcome'); state.templates.length = 0;
    await deleteField('tenant', 'actor', field.id);
    expect((await readFields(tx as any, 'tenant')).some(item => item.id === field.id)).toBe(false);
    expect((await readFields(tx as any, 'tenant', true)).find(item => item.id === field.id)?.deletedAt).toBeTruthy();
    expect(state.values).toEqual([{ fieldId: field.id, value: 'Gold' }]);
  });
  it('does not confuse mutable labels or ID prefixes with immutable tokens', () => {
    expect(referencesCustomField('Budget', 'field-id')).toBe(false);
    expect(referencesCustomField('{{customFieldValues.field-id-other}}', 'field-id')).toBe(false);
    expect(referencesCustomField('Budget {{ \n  customFieldValues.field-id\t }}', 'field-id')).toBe(true);
    expect(referencesCustomField({ fieldId: 'field-id' }, 'field-id')).toBe(true);
    const custom = { id: 'field-id', name: 'Budget', module: 'leads', group: 'Basic Information', type: 'Number', active: true, visibleInForm: false } as ClosingField;
    expect(getCrmFieldCatalog('leads', [custom]).find(field => field.customFieldId === custom.id)).toMatchObject({ conditionAvailable: true, personalizationAvailable: true, visibleInForm: false });
  });
  it('rejects another group at the layout limit without making the saved layout unreadable', async () => {
    const initial = await getFieldLayout('tenant', 'leads');
    const layout = structuredClone(initial.layout);
    while (layout.groups.length < 100) layout.groups.push({ id: `group-${layout.groups.length}`, label: `Group ${layout.groups.length}`, order: layout.groups.length });
    state.preferences.find(preference => preference.module === 'leads')!.value = layout;
    await expect(updateFieldLayout('tenant', 'actor', 'leads', { action: 'add', label: 'Overflow' })).rejects.toThrow('at most 100');
    expect((await getFieldLayout('tenant', 'leads')).layout.groups).toHaveLength(100);
    expect(tx.tenantPreference.update).not.toHaveBeenCalled();
  });
});

it('upgrades untouched legacy assignment defaults using stable IDs while retaining real relationship fields', async () => {
  const layout = defaultFieldLayout('deals'); layout.groups = layout.groups.filter(group => group.id !== 'deals:section:4');
  state.preferences.push({ tenantId: 'tenant', module: 'deals', key: 'field-layout', value: layout });
  const result = await getFieldLayout('tenant', 'deals');
  expect(result.fields.find(field => field.technicalKey === 'assignedUserId')).toMatchObject({ groupId: 'deals:section:4', group: 'Assigned Agent' });
  expect(result.fields.find(field => field.technicalKey === 'accountId')).toMatchObject({ groupId: 'deals:section:1', group: 'Relationships' });
  const saved = structuredClone(result.layout); saved.groups.find(group => group.id === 'deals:section:4')!.label = 'My staff';
  state.preferences.find(row => row.module === 'deals')!.value = saved;
  expect((await getFieldLayout('tenant', 'deals')).fields.find(field => field.technicalKey === 'assignedUserId')?.group).toBe('My staff');
});
it('preserves administrator assignment labels, visibility, order, and group placement in legacy layouts', async () => {
  const layout = defaultFieldLayout('contacts'); layout.groups = layout.groups.filter(group => group.id !== 'contacts:section:4');
  layout.groups[2].label = 'Client team';
  layout.fields.assignedUserId = { label: 'Case manager', groupId: 'contacts:section:2', order: 42, visibleInForm: false, visibleInDetails: true };
  state.preferences.push({ tenantId: 'tenant', module: 'contacts', key: 'field-layout', value: layout });
  const result = await getFieldLayout('tenant', 'contacts');
  expect(result.layout).toEqual(layout);
  expect(result.fields.find(field => field.technicalKey === 'assignedUserId')).toMatchObject({ label: 'Case manager', group: 'Client team', order: 42, visibleInForm: false });
});

it('backfills the legacy Age ID once, preserves values and keeps its alias after renaming', async () => {
  const id = '2857e8ec-456d-4503-b955-46db45560974';
  const legacy = { ...DEFAULT_CLOSING_FIELDS[2], id, module: 'leads', group: 'Basic Information', groupId: 'leads:section:0', name: 'Age', type: 'Number', version: 7 } as ClosingField;
  state.definitions.push({ tenantId: 'tenant', id, definition: legacy }); state.values.push({ fieldId: id, value: 37 });
  const first = await readFields(tx as any, 'tenant');
  expect(first.find(field => field.id === id)).toMatchObject({ id, technicalAlias: 'age', version: 7 });
  const writes = tx.closingFieldDefinition.update.mock.calls.length;
  await readFields(tx as any, 'tenant'); expect(tx.closingFieldDefinition.update.mock.calls).toHaveLength(writes);
  await saveField('tenant', 'actor', { name: 'Customer Age' }, id);
  const next = await readFields(tx as any, 'tenant');
  expect(resolveCustomFieldReference('leads', 'customFieldValues.age', next)?.id).toBe(id);
  expect(resolveCustomFieldReference('leads', `customFieldValues.${id}`, next)?.id).toBe(id);
  expect(resolveCustomFieldReference('contacts', 'customFieldValues.age', next)).toBeUndefined();
  expect(state.values).toEqual([{ fieldId: id, value: 37 }]);
  await expect(saveField('tenant', 'actor', { technicalAlias: 'customer-age' }, id)).rejects.toThrow();
});

it('normalizes readable aliases and reserves collisions, canonical identifiers and retired aliases', async () => {
  expect(customFieldAliasBase('  Fávöríte  Number!? ')).toBe('favorite-number');
  const one = await createField({ name: 'Favorite Number!' }), two = await createField({ name: 'Favorite Number?' });
  expect(one.technicalAlias).toBe('favorite-number'); expect(two.technicalAlias).toBe('favorite-number-2');
  await deleteField('tenant', 'actor', one.id);
  expect((await createField({ name: 'Favorite Number#' })).technicalAlias).toBe('favorite-number-3');
  for (const name of ['!!!', 'constructor']) await expect(createField({ name })).rejects.toThrow('technical alias');
});

it('canonicalizes alias values without mixing duplicate identities or modules', async () => {
  const field = await createField();
  expect(canonicalFieldValues('leads', { 'customFieldValues.budget': 42 }, [field])).toEqual({ [field.id]: 42 });
  expect(() => canonicalFieldValues('leads', { [field.id]: 42, budget: 43 }, [field])).toThrow('once');
  expect(() => canonicalFieldValues('contacts', { budget: 42 }, [field])).toThrow('this module');
});

it('atomically reorders a complete group and rejects stale, duplicate, incomplete and cross-group orders', async () => {
  const field = await createField(), original = await getFieldLayout('tenant', 'leads');
  const contained = original.fields.filter(item => item.groupId === field.groupId).map(item => item.canonicalTechnicalKey ?? item.technicalKey);
  const input = { action: 'reorderFields', groupId: field.groupId, technicalKeys: [...contained].reverse(), expectedRevision: original.layout.revision ?? 0 };
  const saved = await updateFieldLayout('tenant', 'actor', 'leads', input);
  expect(saved.fields.filter(item => item.groupId === field.groupId).map(item => item.canonicalTechnicalKey ?? item.technicalKey)).toEqual(input.technicalKeys);
  expect(saved.layout.revision).toBe((original.layout.revision ?? 0) + 1);
  await expect(updateFieldLayout('tenant', 'actor', 'leads', input)).rejects.toThrow('changed');
  for (const technicalKeys of [contained.slice(1), [...contained, contained[0]], [...contained.slice(1), 'status']]) {
    await expect(updateFieldLayout('tenant', 'actor', 'leads', { ...input, technicalKeys, expectedRevision: saved.layout.revision })).rejects.toThrow('every field');
  }
  expect((await readFields(tx as any, 'tenant')).find(item => item.id === field.id)?.technicalAlias).toBe('budget');
});

it('validates complete module group orders and keeps stable IDs on reload', async () => {
  const original = await getFieldLayout('tenant', 'leads');
  const groupIds = [...original.layout.groups].reverse().map(group => group.id);
  const saved = await updateFieldLayout('tenant', 'actor', 'leads', { action: 'reorderGroups', groupIds, expectedRevision: original.layout.revision ?? 0 });
  expect((await getFieldLayout('tenant', 'leads')).layout.groups.sort((a, b) => a.order - b.order).map(group => group.id)).toEqual(groupIds);
  for (const ids of [groupIds.slice(1), [...groupIds.slice(1), groupIds[1]], [...groupIds.slice(1), 'contacts:section:0']]) await expect(updateFieldLayout('tenant', 'actor', 'leads', { action: 'reorderGroups', groupIds: ids, expectedRevision: saved.layout.revision })).rejects.toThrow('exactly once');
});

it('protects saved readable references from deletion and rejects stale field edits', async () => {
  const field = await createField();
  state.templates.push({ id: 'template', name: 'Readable budget', content: '{{customFieldValues.budget}}' });
  await expect(deleteField('tenant', 'actor', field.id)).rejects.toThrow('Readable budget');
  await saveField('tenant', 'actor', { name: 'Budget revised', expectedVersion: field.version }, field.id);
  await expect(saveField('tenant', 'actor', { name: 'Stale label', expectedVersion: field.version }, field.id)).rejects.toThrow('changed');
});


it.each(['leads', 'contacts'] as const)('moves the old %s company placement without losing label or visibility', module => {
  const key = 'companyName';
  const layout = defaultFieldLayout(module);
  layout.fields[key] = { label: 'Corporate name', groupId: `${module}:section:0`, order: 8, visibleInForm: false, visibleInDetails: true };
  expect(upgradeAssignmentLayout(layout).fields[key]).toEqual({ ...layout.fields[key], groupId: `${module}:section:2` });
  layout.fields[key].groupId = 'custom-group';
  expect(upgradeAssignmentLayout(layout).fields[key].groupId).toBe('custom-group');
});
