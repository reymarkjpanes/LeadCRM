import { getCrmFieldCatalog, type CrmFieldCatalogEntry, type FieldLayout } from './field-catalog';
import type { ClosingField, CustomFieldModule } from './closing-requirements';
import type { AudienceCondition } from './campaign-email';
import { conditionFieldKind, conditionOperators, validConditionScalar } from './condition-operators';
import { QUOTATION_CONTEXT_VARIABLES } from './quotation.contract';

export const CAMPAIGN_VARIABLE_CATEGORIES = ['Standard Fields', 'Custom Fields', 'Sender'] as const;
export interface CampaignVariableChoice {
  id: string; technicalKey: string; label: string;
  category: typeof CAMPAIGN_VARIABLE_CATEGORIES[number];
  origins: CrmFieldCatalogEntry[];
  personalizationAvailable: boolean; unavailableReason?: string;
}
export type GroupedCampaignVariableChoice = Omit<CampaignVariableChoice, 'category'> & { category: string };

/** Quotation grouping uses the same approved origins and tokens as Campaigns. */
export function quotationVariableChoices(fields: CrmFieldCatalogEntry[], source?: 'LEADS' | 'CONTACTS'): GroupedCampaignVariableChoice[] {
  const leads = campaignVariableChoices(fields, source ?? 'LEADS', { forInsertion: true });
  const contacts = campaignVariableChoices(fields, 'CONTACTS', { forInsertion: true });
  const recipient = leads.filter(choice => choice.origins.length && !choice.origins.some(origin => origin.type === 'products')).map(choice => {
    const alternative = contacts.find(other => other.id === choice.id);
    const selected = !source && !choice.personalizationAvailable && alternative?.personalizationAvailable ? alternative : choice;
    return { ...selected, category: 'Recipient (Lead / Contact)' };
  });
  const context = Object.entries(QUOTATION_CONTEXT_VARIABLES).map(([technicalKey, category]) => {
    const accountKey = technicalKey === 'accountName' ? 'name' : technicalKey === 'accountAddress' ? 'address' : undefined;
    const accountField = accountKey ? fields.find(field => field.module === 'accounts' && field.technicalKey === accountKey) : undefined;
    const available = !accountKey || !!accountField && campaignPersonalizationAvailable(accountField);
    return { id: `quotation:${technicalKey}`, technicalKey, label: technicalKey.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase()), category,
      origins: accountField ? [accountField] : [], personalizationAvailable: available, unavailableReason: available ? undefined : 'This Account field is unavailable.' };
  });
  return [...recipient, ...context];
}
function supportedModules(source?: 'LEADS' | 'CONTACTS'): CustomFieldModule[] {
  if (!source) return [];
  return [source === 'LEADS' ? 'leads' : 'contacts', 'accounts', 'deals'];
}
function originKey(field: CrmFieldCatalogEntry) {
  return field.customFieldId ? `${field.module}:${field.customFieldId}` : `${field.module}:${field.kind}:${field.technicalKey}`;
}
function originSupported(field: CrmFieldCatalogEntry, source?: 'LEADS' | 'CONTACTS') {
  return !!source && supportedModules(source).includes(field.module);
}
export function campaignPersonalizationAvailable(field: CrmFieldCatalogEntry) {
  return field.active && field.personalizationAvailable && (field.visibleInForm || field.visibleInDetails);
}
/** Same token is never a relationship binding. Custom definition identities stay separate. */
export function campaignVariableChoices(fields: CrmFieldCatalogEntry[], source?: 'LEADS' | 'CONTACTS', { forInsertion = false }: { forInsertion?: boolean } = {}): CampaignVariableChoice[] {
  // Limit new picker entries without narrowing validation of saved variables.
  if (forInsertion) fields = fields.filter(field => field.active && (field.module === 'leads' || field.module === 'contacts'));
  const module = source === 'LEADS' ? 'leads' : source === 'CONTACTS' ? 'contacts' : undefined;
  const choices = new Map<string, CampaignVariableChoice>();
  for (const field of fields) {
    const id = field.customFieldId ? `${field.module}:${field.customFieldId}` : JSON.stringify([field.kind, field.technicalKey, forInsertion ? undefined : field.label, field.type, field.reference]);
    const existing = choices.get(id);
    if (existing) {
      existing.origins.push(field);
      if (forInsertion && field.module === module) existing.label = field.label;
    }
    else choices.set(id, { id, technicalKey: field.technicalKey, label: field.label, category: field.kind === 'System' ? 'Standard Fields' : 'Custom Fields', origins: [field], personalizationAvailable: false });
  }
  const supportedByToken = new Map<string, CrmFieldCatalogEntry[]>();
  for (const field of fields) if (originSupported(field, source)) supportedByToken.set(field.technicalKey, [...(supportedByToken.get(field.technicalKey) ?? []), field]);
  for (const choice of choices.values()) {
    const tokenOrigins = supportedByToken.get(choice.technicalKey) ?? [];
    const direct = tokenOrigins.find(origin => origin.module === module && choice.origins.includes(origin));
    const related = tokenOrigins.filter(origin => origin.module !== module);
    // A direct field is the only unambiguous meaning for a colliding token. A
    // related token with two possible modules is disabled until a binding is
    // available; this prevents an Account value being taken for a Deal value.
    const field = direct ?? (related.length === 1 ? related[0] : undefined);
    const ambiguous = !direct && related.length > 1;
    choice.personalizationAvailable = !!field && campaignPersonalizationAvailable(field) && !ambiguous;
    if (!choice.personalizationAvailable) choice.unavailableReason = !module ? 'Select a Lead or Contact audience to use this field.' : ambiguous ? 'This related field is ambiguous for the selected audience. Resolve its relationship binding before sending.' : !field ? 'Unavailable for this audience. Related Account and Deal fields require an explicit supported binding.' : field.unavailableReason ?? (!field.active ? 'This field is disabled.' : !field.visibleInForm && !field.visibleInDetails ? 'This field is hidden.' : 'This field does not support personalization.');
  }
  return [...choices.values(), ...(['sender_name', 'sender_email'] as const).map(technicalKey => ({ id: technicalKey, technicalKey, label: technicalKey === 'sender_name' ? 'Sender Name' : 'Sender Email', category: 'Sender' as const, origins: [], personalizationAvailable: true }))];
}
/** Canonical IDs remain valid for saved content; legacy aliases are rendering compatibility only. */
export function campaignApprovedVariableKeys(fields: CrmFieldCatalogEntry[], source?: 'LEADS' | 'CONTACTS'): Set<string> {
  const selected = source ? campaignVariableChoices(fields, source).filter(choice => choice.personalizationAvailable).flatMap(choice => choice.origins.filter(origin => originSupported(origin, source))) : fields.filter(campaignPersonalizationAvailable);
  const keys = new Set(['sender_name', 'sender_email', ...selected.flatMap(field => [field.technicalKey, ...(field.canonicalTechnicalKey ? [field.canonicalTechnicalKey] : [])])]);
  const aliases = { first_name: ['firstName'], last_name: ['lastName'], company_name: ['companyName'], contact_number: ['phone'] };
  for (const [alias, nativeKeys] of Object.entries(aliases)) if (nativeKeys.some(key => keys.has(key))) keys.add(alias);
  return keys;
}

/** Selects direct and safely resolvable related fields for one audience source. */
export function campaignFieldsForSource(fields: CrmFieldCatalogEntry[], source: 'LEADS' | 'CONTACTS') {
  const choices = campaignVariableChoices(fields, source);
  const allowed = new Set(choices.filter(choice => choice.personalizationAvailable).flatMap(choice => choice.origins.filter(origin => originSupported(origin, source)).map(originKey)));
  return fields.filter(field => allowed.has(originKey(field)));
}

export function campaignFields(source: 'LEADS' | 'CONTACTS', definitions: ClosingField[] = [], layout?: FieldLayout): CrmFieldCatalogEntry[] {
  const module = source === 'LEADS' ? 'leads' : 'contacts';
  const fields = getCrmFieldCatalog(module, definitions, layout).filter(field => field.active);
  if (!fields.some(field => field.technicalKey === 'createdAt')) fields.push({ technicalKey: 'createdAt', label: 'Created Date', module, kind: 'System', type: 'date', groupId: 'metadata', group: 'Record', order: 10000, required: false, mandatory: false, active: true, visibleInForm: false, visibleInDetails: true, conditionAvailable: true, personalizationAvailable: true });
  return fields;
}
export function campaignConditionField(key: string, fields: CrmFieldCatalogEntry[]) {
  const native = key === 'productInterest' ? 'productInterestIds' : key;
  return fields.find(field => field.technicalKey === native || field.canonicalTechnicalKey === native);
}
export function campaignFieldOperators(field?: CrmFieldCatalogEntry): AudienceCondition['operator'][] {
  return conditionOperators('audience', conditionFieldKind(field?.type)) as AudienceCondition['operator'][];
}
export function campaignConditionError(condition: AudienceCondition, fields: CrmFieldCatalogEntry[]): string | undefined {
  const field = campaignConditionField(condition.field, fields);
  if (!field?.conditionAvailable) return 'This field is unavailable for the selected source. Repair the condition.';
  if (!campaignFieldOperators(field).includes(condition.operator)) return `Choose a supported operator for ${field.label}.`;
  if (['is_empty', 'is_not_empty', 'any'].includes(condition.operator)) return condition.value === null ? undefined : 'This operator has no value.';
  const value = condition.value;
  if (field.type === 'number') return validConditionScalar('number', value) ? undefined : `Enter a number for ${field.label}.`;
  if (field.type === 'boolean') return validConditionScalar('boolean', value) ? undefined : `Select Yes or No for ${field.label}.`;
  if (field.type === 'products') return Array.isArray(value) && value.length && value.every(id => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) ? undefined : 'Select at least one product.';
  if (field.type === 'reference') return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? undefined : `Select ${field.label}.`;
  if (field.type === 'date') {
    const valid = (date: unknown) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
    return condition.operator === 'between' ? value && typeof value === 'object' && !Array.isArray(value) && valid(value.from) && valid(value.to) && value.from <= value.to ? undefined : 'Enter valid From and To dates.' : valid(value) ? undefined : 'Select a valid calendar date.';
  }
  if (typeof value !== 'string' || !value.trim()) return `Enter a value for ${field.label}.`;
  if (field.type === 'dropdown' && !field.options?.includes(value)) return `Select a current ${field.label} option.`;
  return undefined;
}
