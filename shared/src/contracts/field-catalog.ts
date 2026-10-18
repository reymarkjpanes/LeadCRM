import { ACCOUNT_ADDITIONAL_GROUP_ID, accountAdditionalGroupId, upgradeAccountFieldLayout, ACCOUNT_RETIRED_GROUP_IDS } from './account-retirement';
import { z } from 'zod';
import { customFieldTechnicalKey } from './custom-field-identity';
import { COMPANY_INDUSTRIES } from '../constants/company-industries';
import { CRM_STATUSES, LEAD_SOURCES, COMPANY_SIZE_OPTIONS } from './record-experience';
import { CLOSED_WON_GROUP_ID, CUSTOM_FIELD_BUILT_IN_GROUPS, CUSTOM_FIELD_MODULES, customFieldNameKey, isClosedWonField, isSystemClosingField, normalizeCustomField, type ClosingField, type CustomFieldModule } from './closing-requirements';

export const FieldGroupSchema = z.object({ id: z.string().min(1).max(100), label: z.string().trim().min(1).max(100), order: z.number().int().min(0).max(100000), protected: z.boolean().optional() }).strict();
export const NativeFieldOverrideSchema = z.object({ label: z.string().trim().min(1).max(100), groupId: z.string().min(1).max(100), order: z.number().int().min(0).max(100000), visibleInForm: z.boolean(), visibleInDetails: z.boolean() }).strict();
export const FieldLayoutSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative().optional(), module: z.enum(CUSTOM_FIELD_MODULES), groups: z.array(FieldGroupSchema).min(1).max(100), fields: z.record(z.string(), NativeFieldOverrideSchema) }).strict();
export type FieldGroup = z.infer<typeof FieldGroupSchema>;
export type FieldLayout = z.infer<typeof FieldLayoutSchema>;
const layoutRevision = z.number().int().nonnegative();
export const FieldLayoutActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), label: z.string().trim().min(1).max(100), expectedRevision: layoutRevision.optional() }).strict(),
  z.object({ action: z.literal('rename'), groupId: z.string(), label: z.string().trim().min(1).max(100), expectedRevision: layoutRevision.optional() }).strict(),
  z.object({ action: z.literal('moveGroup'), groupId: z.string(), direction: z.enum(['up', 'down']), expectedRevision: layoutRevision.optional() }).strict(),
  z.object({ action: z.literal('delete'), groupId: z.string(), moveToGroupId: z.string().optional(), expectedRevision: layoutRevision.optional() }).strict(),
  z.object({ action: z.literal('field'), technicalKey: z.string(), label: z.string().trim().min(1).max(100).optional(), groupId: z.string().optional(), visibleInForm: z.boolean().optional(), visibleInDetails: z.boolean().optional(), direction: z.enum(['up', 'down']).optional(), expectedRevision: layoutRevision.optional() }).strict(),
  z.object({ action: z.literal('reorderGroups'), groupIds: z.array(z.string().min(1)).min(1).max(100), expectedRevision: layoutRevision }).strict(),
  z.object({ action: z.literal('reorderFields'), groupId: z.string().min(1), technicalKeys: z.array(z.string().min(1)).min(1).max(200), expectedRevision: layoutRevision }).strict(),
]);
export type FieldLayoutAction = z.infer<typeof FieldLayoutActionSchema>;
export type CrmFieldType = 'text' | 'longText' | 'number' | 'date' | 'dropdown' | 'reference' | 'products' | 'file' | 'boolean';
export interface CrmFieldCatalogEntry {
  technicalKey: string; canonicalTechnicalKey?: string; label: string; module: CustomFieldModule; kind: 'System' | 'Custom'; type: CrmFieldType;
  groupId: string; group: string; order: number; required: boolean; mandatory: boolean; active: boolean;
  visibleInForm: boolean; visibleInDetails: boolean; conditionAvailable: boolean; personalizationAvailable: boolean;
  unavailableReason?: string; options?: readonly string[]; customFieldId?: string; reference?: 'account' | 'user' | 'stage' | 'pipeline';
}
export const defaultFieldGroupId = (module: CustomFieldModule, label: string) => {
  if (module === 'accounts') return ({ 'basic information': 'accounts:section:0', address: 'accounts:section:1', notes: 'accounts:section:4', 'additional information': ACCOUNT_ADDITIONAL_GROUP_ID } as Record<string, string>)[customFieldNameKey(label)] ?? 'accounts:additional-information';
  const legacyContactGroup = module === 'contacts' ? ({ 'status & classification': 1, relationships: 2 } as Record<string, number>)[customFieldNameKey(label)] : undefined;
  return module === 'deals' && customFieldNameKey(label) === 'closed won requirements' ? CLOSED_WON_GROUP_ID : `${module}:section:${legacyContactGroup ?? CUSTOM_FIELD_BUILT_IN_GROUPS[module].findIndex(group => customFieldNameKey(group) === customFieldNameKey(label))}`;
};
type NativeInput = [key: string, label: string, type: CrmFieldType, group: number, mandatory?: boolean, options?: readonly string[], reference?: CrmFieldCatalogEntry['reference']];
const person: NativeInput[] = [['firstName', 'First Name', 'text', 0, true], ['lastName', 'Last Name', 'text', 0, true], ['email', 'Email', 'text', 0, true], ['phone', 'Phone', 'text', 0], ['status', 'Status', 'dropdown', 1, false, CRM_STATUSES], ['productInterestIds', 'Product Interest', 'products', 1], ['source', 'Lead Source', 'dropdown', 3, false, LEAD_SOURCES], ['assignedUserId', 'Assigned Agent', 'reference', 4, false, undefined, 'user'], ['address', 'Full Address', 'longText', 3]];
const native: Record<CustomFieldModule, NativeInput[]> = {
  leads: [...person, ['companyName', 'Company Name', 'text', 2], ['accountId', 'Account', 'reference', 2, false, undefined, 'account']],
  contacts: [...person, ['companyName', 'Company', 'text', 2], ['accountId', 'Account', 'reference', 2, false, undefined, 'account'], ['notes', 'Notes', 'longText', 3]],
  accounts: [['name', 'Account Name', 'text', 0, true], ['industry', 'Industry', 'dropdown', 0, false, COMPANY_INDUSTRIES], ['size', 'Company Size', 'dropdown', 0, false, COMPANY_SIZE_OPTIONS], ['website', 'Website', 'text', 0], ['address', 'Full Address', 'longText', 1]],
  deals: [['title', 'Title', 'text', 0, true], ['value', 'Deal Value', 'number', 0], ['productInterestIds', 'Product Interest', 'products', 0, true], ['pipelineId', 'Pipeline', 'reference', 0, true, undefined, 'pipeline'], ['stageId', 'Stage', 'reference', 0, true, undefined, 'stage'], ['priority', 'Priority', 'dropdown', 0, false, ['LOW', 'MEDIUM', 'HIGH']], ['expectedCloseDate', 'Expected Close Date', 'date', 2], ['assignedUserId', 'Assigned Agent', 'reference', 4, false, undefined, 'user'], ['accountId', 'Account', 'reference', 1, false, undefined, 'account'], ['leadSource', 'Lead Source', 'dropdown', 2, false, LEAD_SOURCES], ['industry', 'Industry', 'dropdown', 2, false, COMPANY_INDUSTRIES], ['address', 'Address', 'longText', 2]],
};
export const CRM_SYSTEM_FIELDS = Object.fromEntries(CUSTOM_FIELD_MODULES.map(module => [module, [...native[module], ['createdAt', 'Created', 'date', 0] as NativeInput].map(([technicalKey, label, type, groupIndex, mandatory = false, options, reference], order): CrmFieldCatalogEntry => ({ technicalKey, label: module === 'contacts' && technicalKey === 'source' ? 'Source' : label, module, kind: 'System', type, groupId: defaultFieldGroupId(module, CUSTOM_FIELD_BUILT_IN_GROUPS[module][groupIndex]), group: CUSTOM_FIELD_BUILT_IN_GROUPS[module][groupIndex], order, required: mandatory, mandatory, active: true, visibleInForm: !['value', 'createdAt'].includes(technicalKey), visibleInDetails: true, conditionAvailable: true, personalizationAvailable: true, ...(options ? { options } : {}), ...(reference ? { reference } : {}) }))])) as Record<CustomFieldModule, CrmFieldCatalogEntry[]>;

/** Explicit supported business keys only: never infer fields from database properties. */
export function getCrmFieldCatalog(module: CustomFieldModule, definitions: ClosingField[] = [], layout?: FieldLayout): CrmFieldCatalogEntry[] {
  const groups = layout?.groups ?? defaultFieldLayout(module).groups;
  const standard = CRM_SYSTEM_FIELDS[module].map(field => {
    const override = layout?.fields[field.technicalKey];
    const resolved = { ...field, ...(override ? { ...override, label: override.label } : {}) };
    if (module === 'accounts' && field.technicalKey === 'address' && resolved.label === 'Street Address') resolved.label = 'Full Address';
    return { ...resolved, group: groups.find(group => group.id === resolved.groupId)?.label ?? field.group };
  });
  const custom = definitions.map(normalizeCustomField).filter(field => field.module === module && !field.deletedAt).map((field): CrmFieldCatalogEntry => {
    const groupId = module === 'accounts' && (ACCOUNT_RETIRED_GROUP_IDS.includes(field.groupId ?? '') || !field.groupId && ['Assigned Agent', 'Relationships', 'Products & Interests', 'Notes'].includes(field.group)) ? accountAdditionalGroupId(groups) : field.groupId ?? groups.find(group => customFieldNameKey(group.label) === customFieldNameKey(field.group))?.id ?? defaultFieldGroupId(module, field.group);
    return { technicalKey: customFieldTechnicalKey(field), canonicalTechnicalKey: `customFieldValues.${field.id}`, customFieldId: field.id, label: field.name, module, kind: isSystemClosingField(field) ? 'System' : 'Custom', type: field.type === 'Text' ? 'text' : field.type === 'Long Text' ? 'longText' : field.type === 'Number' ? 'number' : field.type === 'Date' ? 'date' : field.type === 'Dropdown' ? 'dropdown' : 'file', groupId, group: groups.find(group => group.id === groupId)?.label ?? field.group, order: field.order, required: field.required, mandatory: false, active: field.active, visibleInForm: field.visibleInForm, visibleInDetails: field.visibleInDetails, conditionAvailable: field.active && !isClosedWonField(field), personalizationAvailable: field.active && field.type !== 'File Upload' && !isClosedWonField(field), options: field.options, ...(field.type === 'File Upload' ? { unavailableReason: 'Private files support presence conditions only; file links cannot be personalized.' } : {}) };
  });
  return [...standard, ...custom].sort((a, b) => (groups.find(group => group.id === a.groupId)?.order ?? 100000) - (groups.find(group => group.id === b.groupId)?.order ?? 100000) || a.order - b.order || a.technicalKey.localeCompare(b.technicalKey));
}
export function defaultFieldLayout(module: CustomFieldModule): FieldLayout {
  return { version: 1, module, groups: CUSTOM_FIELD_BUILT_IN_GROUPS[module].map((label, order) => ({ id: defaultFieldGroupId(module, label), label, order, ...(module === 'deals' && order === 3 ? { protected: true } : {}) })), fields: {} };
}
/** Upgrade only untouched built-in assignment defaults, identified by stable IDs. */
export function upgradeAssignmentLayout(layout: FieldLayout, definitions: ClosingField[] = []): FieldLayout {
  const next = structuredClone(upgradeAccountFieldLayout(layout));
  const module = layout.module;
  if (module === 'leads' || module === 'contacts') {
    const company = next.fields.companyName;
    if (company?.groupId === `${module}:section:0`) company.groupId = `${module}:section:2`;
  }
  if (module === 'accounts') for (const key of ['city', 'province', 'country']) delete next.fields[key];
  if (layout.fields.assignedUserId || layout.module !== 'accounts' && layout.groups.some(group => group.id === layout.module + ':section:4')) return next;
  const sourceIndex = module === 'deals' ? 1 : module === 'leads' ? 3 : 2;
  const sourceLabel = module === 'leads' ? 'Additional Information' : 'Relationships';
  const source = next.groups.find(group => group.id === module + ':section:' + sourceIndex);
  const preservePlacement = () => {
    const field = CRM_SYSTEM_FIELDS[module].find(field => field.technicalKey === 'assignedUserId')!;
    if (source && module !== 'accounts') next.fields.assignedUserId = { label: field.label, groupId: source.id, order: field.order, visibleInForm: true, visibleInDetails: true };
    return next;
  };
  if (!source || source.label !== sourceLabel || source.order !== sourceIndex) return preservePlacement();
  if (module === 'accounts') {
    // Custom fields keep their administrator's section title and placement.
    if (definitions.some(field => field.module === module && (field.groupId === source.id || !field.groupId && field.group === sourceLabel))) return next;
    source.label = 'Assigned Agent';
  } else {
    const targetId = module + ':section:4';
    if (!next.groups.some(group => group.id === targetId)) {
      if (next.groups.length >= 100 || next.groups.some(group => group.label === 'Assigned Agent')) return preservePlacement();
      next.groups.push({ id: targetId, label: 'Assigned Agent', order: Math.max(...next.groups.map(group => group.order)) + 1 });
    }
  }
  return next;
}
export function resolveCrmField(module: CustomFieldModule, key: string, layout?: FieldLayout) { return getCrmFieldCatalog(module, [], layout).find(field => field.technicalKey === key); }
