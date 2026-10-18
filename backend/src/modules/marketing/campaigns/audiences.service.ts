import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AudienceSourceSchema, AudiencePreviewSchema, AudiencePreviewRequestSchema, CreateAudienceSchema, CRM_STATUSES, LeadCreatedFilterSchema, leadCreatedBounds, type AudienceInput, type AudienceBreakdown, type AudiencePreviewResult, type EmailVariables, campaignFields, campaignFieldsForSource, campaignConditionField, campaignConditionError, FieldLayoutSchema, type CrmFieldCatalogEntry, type AudienceCondition } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';
import { resolveProducts } from '../../crm/leads/lead-automation.service';
import { assertEligibleAssignedAgent, crmAssignmentRequirements } from '../../crm/access/assigned-agent-eligibility';
import { readConfiguredFields } from '../../crm/closing-requirements/closing-requirements.repository';
import { normalizeSmsPhone } from '../../../shared/services/sms.service';
import { CUSTOM_FIELD_MODULES, getCrmFieldCatalog, campaignPersonalizationAvailable, campaignApprovedVariableKeys } from '@leadcrm/shared';
import { retiredContactReferences } from '@leadcrm/shared';
import { mayReadContactAccount, presentContactAccount } from '../../crm/contacts-v2/contact-account-access';

export function campaignScope(tenantId: string) {
  const context = tenantContext.getStore();
  if (!context || context.tenantId !== tenantId) throw new AppError('CRM tenant context is required.', 403);
  return { tenantId };
}

/** CRM scalar fields used by audience matching; never a paginated UI cache. */
async function companyValues(tenantId: string, source: AudienceInput['source'], db: Prisma.TransactionClient = prisma) {
  const permitted = await mayReadContactAccount(db, tenantId);
  const where = { ...campaignScope(tenantId), isArchived: false, deletedAt: null };
  const [leads, contacts] = await Promise.all([
    source === 'CONTACTS' ? [] : db.lead.findMany({ where, distinct: ['companyName', 'companyFromAccount'], select: { companyName: true, companyFromAccount: true } }),
    source === 'LEADS' ? [] : db.contact.findMany({ where, distinct: ['companyName', 'accountId', 'companyFromAccount'], select: { companyName: true, companyFromAccount: true, account: { select: { name: true } } } }),
  ]);
  return [...leads.map(row => !permitted && row.companyFromAccount ? null : row.companyName), ...contacts.map(row => permitted ? row.account?.name || row.companyName : row.companyFromAccount ? null : row.companyName)].filter((value): value is string => !!value?.trim());
}
export async function audienceCompanies(tenantId: string, input: unknown) {
  const source = AudienceSourceSchema.parse(input);
  const names = new Map<string, string>();
  for (const value of (await companyValues(tenantId, source)).sort()) {
    const name = value.trim();
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

// Preserve the string column: scalars stay readable, structured values are JSON.
// Legacy product names resolve only through this tenant's catalog.
export async function audienceFields(tenantId: string, sourceInput: unknown, db: Prisma.TransactionClient = prisma) {
  const source = AudienceSourceSchema.parse(sourceInput), module = source === 'LEADS' ? 'leads' : 'contacts';
  const [definitions, preference] = await Promise.all([readConfiguredFields(db, tenantId), db.tenantPreference.findFirst({ where: { tenantId, module, key: 'field-layout' } })]);
  const layout = FieldLayoutSchema.safeParse(preference?.value);
  return campaignFields(source, definitions, layout.success ? layout.data : undefined);
}
export async function campaignVariableFields(tenantId: string, db: Prisma.TransactionClient = prisma) {
  campaignScope(tenantId);
  const [definitions, preferences] = await Promise.all([
    readConfiguredFields(db, tenantId),
    db.tenantPreference.findMany({ where: { tenantId, module: { in: [...CUSTOM_FIELD_MODULES] }, key: 'field-layout' } }),
  ]);
  return CUSTOM_FIELD_MODULES.flatMap(module => {
    const layout = FieldLayoutSchema.safeParse(preferences.find(row => row.module === module)?.value);
    return getCrmFieldCatalog(module, definitions, layout.success && layout.data.module === module ? layout.data : undefined);
  });
}
export async function campaignFieldsForAudienceSource(tenantId: string, source: AudienceInput['source'], db: Prisma.TransactionClient = prisma) {
  const fields = await campaignVariableFields(tenantId, db);
  return campaignFieldsForSource(fields, source);
}
async function readDefinition(tenantId: string, source: string, rows: { field: string; operator: string; value: string }[], db: Prisma.TransactionClient, matchMode: string = 'AND'): Promise<AudienceInput> {
  const conditions = await Promise.all(rows.map(async row => {
    let value: unknown = row.value;
    // Current writes serialize all values as JSON; tolerate prior scalar strings.
    if (/^[\[\{\"]/.test(row.value) || row.field.startsWith('customFieldValues.')) { try { value = JSON.parse(row.value); } catch { /* legacy scalar */ } }
    if (row.field === 'status' && typeof value === 'string') value = CRM_STATUSES.find(status => status.toLowerCase() === String(value).toLowerCase()) ?? value;
    if (['any', 'is_empty', 'is_not_empty'].includes(row.operator)) value = null;
    if (row.field === 'productInterest' && typeof value === 'string') {
      const product = await db.productInterest.findFirst({ where: { tenantId, active: true, name: value }, select: { id: true } });
      if (!product) throw new AppError('A saved audience Product Interest is no longer available.', 400);
      value = [product.id];
    }
    return { field: row.field, operator: row.operator, value };
  }));
  return AudiencePreviewSchema.parse({ source, matchMode, conditions });
}
export async function validateAudienceReferences(tenantId: string, dto: AudienceInput, db: Prisma.TransactionClient = prisma) {
  const fields = await audienceFields(tenantId, dto.source, db);
  const canReadAccount = await mayReadContactAccount(db, tenantId);
  const retired = retiredContactReferences(dto.conditions, dto.source === 'CONTACTS' ? 'contact' : 'lead');
  if (retired.length) throw new AppError(`Retired Contact field: ${retired.join(', ')}. Repair the saved audience before reuse.`, 400);
  for (const condition of dto.conditions) {
    const error = campaignConditionError(condition, fields);
    if (error) throw new AppError(error, 400);
    if (['any', 'is_empty', 'is_not_empty'].includes(condition.operator)) continue;
    const field = campaignConditionField(condition.field, fields)!;
    if (field.reference === 'account' && !canReadAccount) throw new AppError('Accounts View permission is required to select an Account.', 403);
    if (field.type === 'products') await resolveProducts(db, tenantId, condition.value as string[]);
    if (field.reference === 'user') await assertEligibleAssignedAgent(db, tenantId, String(condition.value), crmAssignmentRequirements(dto.source === 'LEADS' ? 'leads' : 'contacts'));
    if (field.reference === 'account' && !await db.account.findFirst({ where: { tenantId, id: String(condition.value), isArchived: false, deletedAt: null }, select: { id: true } })) throw new AppError('Select an available Account in this tenant.', 400);
  }
  return fields;
}
export async function getAudiences(tenantId: string) {
  const rows = await prisma.targetAudience.findMany({ where: { ...campaignScope(tenantId), isActive: true }, include: { conditions: { orderBy: { conditionOrder: 'asc' } } }, orderBy: { name: 'asc' } });
  return Promise.all(rows.map(async row => {
    try {
      const definition = await readDefinition(tenantId, row.source, row.conditions, prisma, row.matchMode);
      await validateAudienceReferences(tenantId, definition);
      return { id: row.id, name: row.name, ...definition };
    } catch { return { id: row.id, name: row.name, source: row.source, matchMode: row.matchMode, conditions: row.conditions.map(({ field, operator, value }) => { let parsed: unknown = value; try { parsed = JSON.parse(value); } catch {} return { field, operator, value: parsed }; }), repairReason: row.source === 'ALL' ? 'Legacy mixed audience. Create a Lead or Contact audience before reuse.' : 'Saved audience needs repair before reuse. Retired fields cannot execute.' }; }
  }));
}
export async function createAudience(tenantId: string, input: unknown) {
  const dto = CreateAudienceSchema.parse(input), scope = campaignScope(tenantId);
  return prisma.$transaction(async tx => {
    await validateAudienceReferences(tenantId, dto, tx);
    const row = await tx.targetAudience.create({ data: { ...scope, name: dto.name, source: dto.source, matchMode: dto.matchMode,
      conditions: { create: dto.conditions.map((condition, i) => ({ field: condition.field, operator: condition.operator, value: JSON.stringify(condition.value), conditionOrder: i })) } } });
    return { id: row.id, ...dto };
  });
}
export async function updateAudience(tenantId: string, id: string, input: unknown) {
  const dto = CreateAudienceSchema.parse(input), scope = campaignScope(tenantId);
  return prisma.$transaction(async tx => {
    await validateAudienceReferences(tenantId, dto, tx);
    if (!await tx.targetAudience.findFirst({ where: { id, ...scope, isActive: true }, select: { id: true } })) throw new AppError('Target audience not found.', 404);
    await tx.targetAudience.update({ where: { id }, data: { name: dto.name, source: dto.source, matchMode: dto.matchMode, conditions: { deleteMany: {}, create: dto.conditions.map((condition, index) => ({ field: condition.field, operator: condition.operator, value: JSON.stringify(condition.value), conditionOrder: index })) } } });
    return { id, ...dto };
  });
}
export async function audienceDefinition(tenantId: string, id?: string | null, source?: string | null, db: Prisma.TransactionClient = prisma): Promise<AudienceInput> {
  if (id) {
    const audience = await db.targetAudience.findFirst({ where: { ...campaignScope(tenantId), id, isActive: true }, include: { conditions: { orderBy: { conditionOrder: 'asc' } } } });
    if (!audience) throw new AppError('Target audience not found.', 404);
    if (audience.source === 'ALL') throw new AppError('This legacy mixed audience requires a new Lead or Contact audience before reuse.', 400);
    return readDefinition(tenantId, audience.source, audience.conditions, db, audience.matchMode);
  }
  if (source === 'ALL') throw new AppError('Select Leads or Contacts to repair this legacy mixed campaign.', 400);
  return AudiencePreviewSchema.parse({ source, conditions: [] });
}
function scalarPredicate(condition: AudienceCondition, date = false, insensitive = false): Record<string, unknown> {
  const { operator, value } = condition;
  if (operator === 'is_empty') return { equals: null };
  if (operator === 'is_not_empty') return { not: null };
  if (operator === 'any') return {};
  if (date) {
    const filter = LeadCreatedFilterSchema.parse(operator === 'between' ? { operator, ...(typeof value === 'object' ? value : {}) } : { operator, date: value });
    return leadCreatedBounds(filter);
  }
  const comparisons: Partial<Record<AudienceCondition['operator'], string>> = { equals: 'equals', not_equals: 'not', contains: 'contains', not_contains: 'not', starts_with: 'startsWith', ends_with: 'endsWith', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte' };
  const comparison = comparisons[operator];
  if (!comparison) throw new AppError('Unsupported audience operator.', 400);
  return { [comparison]: operator === 'not_contains' ? { contains: value, ...(insensitive ? { mode: 'insensitive' } : {}) } : value, ...(insensitive ? { mode: 'insensitive' } : {}) };
}
/** Only keys approved by the module catalog enter a Prisma predicate. */
export function conditionsFor(input: AudienceInput, lead: boolean, _companies?: string[], catalog = campaignFields(lead ? 'LEADS' : 'CONTACTS'), canReadAccount = true): Prisma.LeadWhereInput[] | Prisma.ContactWhereInput[] {
  return input.conditions.map(condition => {
    const error = campaignConditionError(condition, catalog);
    if (error) throw new AppError(error, 400);
    const field = campaignConditionField(condition.field, catalog)!;
    if (field.customFieldId) {
      const base = { fieldId: field.customFieldId, module: lead ? 'leads' : 'contacts' };
      const populated = { ...base, NOT: { OR: [{ value: { equals: Prisma.JsonNull } }, { value: { equals: '' } }] } };
      if (condition.operator === 'is_empty') return { customFieldValues: { none: populated } };
      if (condition.operator === 'is_not_empty') return { customFieldValues: { some: populated } };
      if (condition.operator === 'any') return {};
      const json = field.type === 'date' ? condition.operator === 'between' ? { gte: (condition.value as { from: string }).from, lte: (condition.value as { to: string }).to } : { [condition.operator]: condition.value } : scalarPredicate(condition);
      if (typeof json.contains === 'string') { json.string_contains = json.contains; delete json.contains; }
      if (typeof json.startsWith === 'string') { json.string_starts_with = json.startsWith; delete json.startsWith; }
      if (typeof json.endsWith === 'string') { json.string_ends_with = json.endsWith; delete json.endsWith; }
      if (['not_equals', 'not_contains'].includes(condition.operator)) {
        const positive = condition.operator === 'not_equals' ? { equals: condition.value } : { string_contains: condition.value };
        return { customFieldValues: { none: { ...base, value: positive } } };
      }
      return { customFieldValues: { some: { ...base, value: json } } };
    }
    if (field.type === 'products') {
      const active = field.technicalKey === 'activeProductIds';
      const relation = { ...(lead ? {} : { [active ? 'activeProduct' : 'interested']: true }), ...(!['is_empty', 'is_not_empty'].includes(condition.operator) ? { productInterestId: { in: condition.value } } : {}) };
      return { productLinks: { [['not_equals', 'is_empty'].includes(condition.operator) ? 'none' : 'some']: relation } };
    }
    const key = field.technicalKey;
    const value = !lead && key === 'status' && typeof condition.value === 'string' ? condition.value.toUpperCase() : condition.value;
    if (['is_empty', 'is_not_empty'].includes(condition.operator) && ['status', 'createdAt'].includes(key)) return condition.operator === 'is_empty' ? { id: { in: [] } } : {};
    if (['is_empty', 'is_not_empty'].includes(condition.operator) && ['firstName', 'lastName'].includes(key)) return { [key]: condition.operator === 'is_empty' ? '' : { not: '' } };
    let scalar = scalarPredicate({ ...condition, value }, field.type === 'date', ['text', 'longText'].includes(field.type) || key === 'status' && lead);
    const company = key === 'companyName';
    if (company && typeof condition.value === 'string' && ['equals', 'not_equals'].includes(condition.operator) && _companies) scalar = { [condition.operator === 'equals' ? 'in' : 'notIn']: [...new Set([condition.value, ..._companies.filter(company => company.trim().toLowerCase() === String(condition.value).trim().toLowerCase())])], mode: 'insensitive' };
    if (company && lead && !canReadAccount) return { companyFromAccount: false, companyName: scalar };
    if (company && !lead) return canReadAccount ? { OR: [{ account: { is: { name: scalar } } }, { account: { is: null }, companyName: scalar }, { account: { is: { name: '' } }, companyName: scalar }] } : { companyFromAccount: false, companyName: scalar };
    if (['is_empty', 'is_not_empty'].includes(condition.operator) && ['text', 'longText', 'dropdown'].includes(field.type)) return condition.operator === 'is_empty' ? { OR: [{ [key]: null }, { [key]: '' }] } : { AND: [{ [key]: { not: null } }, { [key]: { not: '' } }] };
    return { [key]: scalar };
  }) as Prisma.LeadWhereInput[] | Prisma.ContactWhereInput[];
}
export function audiencePredicate(input: AudienceInput, lead: boolean, fields?: CrmFieldCatalogEntry[], companies?: string[], canReadAccount = true) {
  const conditions = conditionsFor(input, lead, companies, fields, canReadAccount);
  return conditions.length ? { [input.matchMode]: conditions } : {};
}
const relatedAccountProjection = { id: true, tenantId: true, name: true, industry: true, size: true, website: true, address: true, isArchived: true, deletedAt: true, customFieldValues: { where: { module: 'accounts' }, select: { fieldId: true, value: true } } } as const;
const relatedDealProjection = { id: true, tenantId: true, title: true, value: true, pipelineId: true, stageId: true, priority: true, expectedCloseDate: true, assignedUserId: true, accountId: true, leadSource: true, industry: true, address: true, productInterestIds: true, isArchived: true, deletedAt: true, createdAt: true, pipeline: { select: { name: true } }, stage: { select: { name: true, isWon: true, isLost: true } }, organization: { select: { id: true, tenantId: true, name: true, isArchived: true, deletedAt: true } }, assignedUser: { select: { firstName: true, lastName: true } }, productInterestRecord: { select: { name: true } }, customFieldValues: { where: { module: 'deals' }, select: { fieldId: true, value: true } } } as const;
const recipientProjectionBase = { id: true, email: true, firstName: true, lastName: true, phone: true, status: true, source: true, address: true, createdAt: true, assignedUserId: true, accountId: true, assignedUser: { select: { firstName: true, lastName: true } }, account: { select: relatedAccountProjection }, customFieldValues: { select: { fieldId: true, value: true } }, productLinks: { orderBy: [{ position: 'asc' }, { productInterestId: 'asc' }] as Prisma.LeadProductInterestOrderByWithRelationInput[], select: { productInterestId: true, product: { select: { name: true } } } }, isArchived: true, deletedAt: true } as const;
const leadRecipientProjection = { ...recipientProjectionBase, companyFromAccount: true, leadDeals: { orderBy: [{ position: 'asc' }, { id: 'asc' }] as Prisma.LeadDealOrderByWithRelationInput[], select: { deal: { select: relatedDealProjection } } } } as const;
const contactRecipientProjection = { ...recipientProjectionBase, companyFromAccount: true, contactDeals: { orderBy: [{ position: 'asc' }, { id: 'asc' }] as Prisma.ContactDealOrderByWithRelationInput[], select: { deal: { select: relatedDealProjection } } } } as const;
type RequiredCampaignVariables = ReadonlySet<string> | undefined;
export function personalized(row: Record<string, unknown>, fields: CrmFieldCatalogEntry[], tenantId: string, requiredVariables?: RequiredCampaignVariables): { values: EmailVariables; unresolved: string[] } {
  const values: EmailVariables = {};
  const scalar = (value: unknown, date = false): string => value == null ? '' : date ? value instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value) : String(value).slice(0, 10) : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
  const custom = new Map((row.customFieldValues as { fieldId: string; value: unknown }[] ?? []).map(value => [value.fieldId, value.value]));
  const account = row.account as Record<string, unknown> | null;
  const accountValid = !!account && account.tenantId === tenantId && !account.isArchived && !account.deletedAt;
  const linkedDeals = ((row.leadDeals ?? row.contactDeals) as { deal: Record<string, unknown> }[] ?? []).map(link => link.deal).filter(deal => deal?.tenantId === tenantId && !deal.isArchived && !deal.deletedAt);
  const deal = linkedDeals.length === 1 ? linkedDeals[0] : null;
  const unresolved: string[] = [];
  const products = row.productLinks as { product: { name: string }; interested?: boolean; activeProduct?: boolean }[] ?? [];
  const entityFor = (field: CrmFieldCatalogEntry) => field.module === 'accounts' ? accountValid ? account : null : field.module === 'deals' ? deal : row;
  const customFor = (entity: Record<string, unknown> | null, field: CrmFieldCatalogEntry) => new Map((entity?.customFieldValues as { fieldId: string; value: unknown }[] ?? []).map(value => [value.fieldId, value.value]));
  for (const field of fields.filter(campaignPersonalizationAvailable)) {
    const entity = entityFor(field);
    const entityCustom = field.module === 'leads' || field.module === 'contacts' ? custom : customFor(entity, field);
    let value: unknown = field.customFieldId ? entityCustom.get(field.customFieldId) : entity?.[field.technicalKey];
    if (field.reference === 'user') { const user = entity?.assignedUser as { firstName: string; lastName: string } | null; value = user ? `${user.firstName} ${user.lastName}`.trim() : ''; }
    if (field.reference === 'account') {
      const organization = entity?.organization as { tenantId?: string; name: string; isArchived?: boolean; deletedAt?: Date | null } | null;
      value = field.module === 'deals' ? organization && organization.tenantId === tenantId && !organization.isArchived && !organization.deletedAt ? organization.name : '' : accountValid ? account?.name : '';
    }
    if (field.reference === 'pipeline') value = (entity?.pipeline as { name: string } | null)?.name;
    if (field.reference === 'stage') value = (entity?.stage as { name: string } | null)?.name;
    const entityProducts = entity?.productLinks as { product: { name: string }; activeProduct?: boolean; interested?: boolean }[] | undefined;
    if (field.type === 'products') value = entityProducts ? entityProducts.filter(product => field.technicalKey === 'activeProductIds' ? product.activeProduct : product.interested !== false).map(product => product.product.name).join(', ') : (entity?.productInterestRecord as { name: string } | null)?.name || (Array.isArray(entity?.[field.technicalKey]) ? (entity?.[field.technicalKey] as unknown[]).join(', ') : '');
    const rendered = scalar(value, field.type === 'date');
    values[field.technicalKey] = values[field.technicalKey] ?? rendered;
    if (field.canonicalTechnicalKey) values[field.canonicalTechnicalKey] = rendered;
    if (requiredVariables?.has(field.technicalKey) || requiredVariables?.has(field.canonicalTechnicalKey ?? '')) {
      if (field.module === 'accounts' && !accountValid) unresolved.push(`${field.technicalKey}:missing-account`);
      if (field.module === 'deals' && !deal) unresolved.push(`${field.technicalKey}:${linkedDeals.length > 1 ? 'multiple-deals' : 'missing-deal'}`);
    }
  }
  const legacy = { first_name: scalar(row.firstName), last_name: scalar(row.lastName), company_name: (row.account as { name: string } | null)?.name || scalar(row.companyName), contact_number: scalar(row.phone) };
  const approved = campaignApprovedVariableKeys(fields);
  return { values: { ...values, ...Object.fromEntries(Object.entries(legacy).filter(([key]) => approved.has(key))) }, unresolved };
}
/** Workflows reuse the Campaign catalog and exact tenant-scoped relationship resolver. */
export async function workflowRecipientValues(tenantId: string, entity: 'lead' | 'contact', id: string, requiredVariables: ReadonlySet<string>, context?: Record<string, unknown>) {
  const fields = await campaignFieldsForAudienceSource(tenantId, entity === 'lead' ? 'LEADS' : 'CONTACTS');
  const where = { tenantId, id, isArchived: false, deletedAt: null };
  const row = entity === 'lead' ? await prisma.lead.findFirst({ where, select: { ...leadRecipientProjection, companyName: true } })
    : await prisma.contact.findFirst({ where, select: { ...contactRecipientProjection, companyName: true, notes: true } });
  if (!row) throw new AppError('The message recipient is unavailable.', 404);
  // Run Check projects validated earlier actions in memory. Reuse the Campaign
  // renderer against that projection without writing any record or relationship.
  const projected: Record<string, unknown> = { ...row };
  if (context) {
    const custom = new Map(row.customFieldValues.map(value => [value.fieldId, value.value as unknown]));
    for (const field of fields.filter(field => field.module === (entity === 'lead' ? 'leads' : 'contacts'))) {
      const key = `${entity}.${field.canonicalTechnicalKey ?? field.technicalKey}`;
      const alias = `${entity}.${field.technicalKey}`;
      const projectedKey = Object.prototype.hasOwnProperty.call(context, key) ? key : alias;
      if (!Object.prototype.hasOwnProperty.call(context, projectedKey) || context[projectedKey] === undefined) continue;
      if (field.customFieldId) custom.set(field.customFieldId, context[projectedKey]);
      else projected[field.technicalKey] = context[projectedKey];
    }
    projected.customFieldValues = [...custom].map(([fieldId, value]) => ({ fieldId, value }));
    if (projected.assignedUserId !== row.assignedUserId) projected.assignedUser = typeof projected.assignedUserId === 'string'
      ? await prisma.user.findFirst({ where: { tenantId, id: projected.assignedUserId }, select: { firstName: true, lastName: true } }) : null;
    if (projected.accountId !== row.accountId) projected.account = typeof projected.accountId === 'string'
      ? await prisma.account.findFirst({ where: { tenantId, id: projected.accountId, isArchived: false, deletedAt: null }, select: relatedAccountProjection }) : null;
    if (Array.isArray(projected.productInterestIds)) {
      const ids = projected.productInterestIds.filter((value): value is string => typeof value === 'string');
      const products = await prisma.productInterest.findMany({ where: { tenantId, id: { in: ids }, active: true }, select: { id: true, name: true } });
      projected.productLinks = ids.flatMap(id => { const product = products.find(value => value.id === id); return product ? [{ product, interested: true }] : []; });
    }
  }
  const result = personalized(projected, fields, tenantId, requiredVariables);
  if (result.unresolved.length) throw new AppError(`Resolve message variable relationships: ${result.unresolved.join(', ')}. Select one eligible related Deal or repair the Account link.`, 400);
  return result.values;
}
export interface ResolvedRecipient { leadId?: string; contactId?: string; email: string | null; phone?: string | null; personalization: EmailVariables; reason: string | null; unresolvedVariables?: string[] }
const emptyBreakdown = (): AudienceBreakdown => ({ matched: 0, eligible: 0, missingEmail: 0, invalidEmail: 0, duplicateEmail: 0, staffEmail: 0, unsubscribed: 0, blocked: 0, inactive: 0, recipientNotAllowed: 0, missingPhone: 0, invalidPhone: 0, duplicatePhone: 0, doNotContact: 0 });
const reasonCounts = { MISSING_EMAIL: 'missingEmail', INVALID_EMAIL: 'invalidEmail', DUPLICATE_EMAIL: 'duplicateEmail', STAFF_EMAIL: 'staffEmail', UNSUBSCRIBED: 'unsubscribed', BLOCKED: 'blocked', INACTIVE: 'inactive', RECIPIENT_NOT_ALLOWED: 'recipientNotAllowed', MISSING_PHONE: 'missingPhone', INVALID_PHONE: 'invalidPhone', DUPLICATE_PHONE: 'duplicatePhone', DO_NOT_CONTACT: 'doNotContact' } as const;
function classify(row: ResolvedRecipient, channel: 'EMAIL' | 'SMS', staff: Set<string>, suppressed: Map<string, string>, allowlist: Set<string> | null, seen: Set<string>, breakdown: AudienceBreakdown) {
  breakdown.matched++;
  row.email = row.email?.trim().toLowerCase() || null;
  if (channel === 'SMS') {
    if (!row.phone?.trim()) row.reason ||= 'MISSING_PHONE';
    else { try { row.phone = normalizeSmsPhone(row.phone); } catch { row.reason ||= 'INVALID_PHONE'; } }
    row.reason ||= suppressed.get(row.phone || '') || (seen.has(row.phone || '') ? 'DUPLICATE_PHONE' : null);
  } else {
    row.reason ||= !row.email ? 'MISSING_EMAIL' : !z.string().email().safeParse(row.email).success ? 'INVALID_EMAIL' : staff.has(row.email) ? 'STAFF_EMAIL' : suppressed.get(row.email) || (seen.has(row.email) ? 'DUPLICATE_EMAIL' : allowlist && !allowlist.has(row.email) ? 'RECIPIENT_NOT_ALLOWED' : null);
  }
  if (row.reason) {
    const key = reasonCounts[row.reason as keyof typeof reasonCounts];
    if (key) breakdown[key] = (breakdown[key] ?? 0) + 1;
  } else { seen.add((channel === 'SMS' ? row.phone : row.email)!); breakdown.eligible++; }
}
export function classifyRecipients(records: ResolvedRecipient[], staff: Set<string>, suppressed: Map<string, string>, allowlist: Set<string> | null, channel: 'EMAIL' | 'SMS' = 'EMAIL') {
  const breakdown = emptyBreakdown(), seen = new Set<string>();
  for (const row of records) classify(row, channel, staff, suppressed, allowlist, seen, breakdown);
  return { records, breakdown };
}

async function visitBatches<T extends { id: string }>(read: (cursor?: string) => Promise<T[]>, visit: (row: T) => void) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await read(cursor);
    rows.forEach(visit);
    if (rows.length < 250) return;
    cursor = rows[rows.length - 1].id;
  }
}

export async function resolveAudience(tenantId: string, input: unknown, db: Prisma.TransactionClient = prisma, channel: 'EMAIL' | 'SMS' = 'EMAIL', page?: { page: number; limit: number }, requiredVariables?: RequiredCampaignVariables) {
  const dto = AudiencePreviewSchema.parse(input), scope = campaignScope(tenantId);
  const canReadAccount = await mayReadContactAccount(db, tenantId);
  const fields = await validateAudienceReferences(tenantId, dto, db);
  const campaignFields = await campaignFieldsForAudienceSource(tenantId, dto.source, db);
  const companyKey = 'companyName';
  const companies = dto.conditions.some(condition => campaignConditionField(condition.field, fields)?.technicalKey === companyKey) ? await companyValues(tenantId, dto.source, db) : undefined;
  const staff = new Set<string>(), suppressed = new Map<string, string>();
  const batch = (cursor?: string) => ({ take: 250, orderBy: { id: 'asc' as const }, where: { ...scope, ...(cursor ? { id: { gt: cursor } } : {}) } });
  if (channel === 'EMAIL') {
    await visitBatches(cursor => db.user.findMany({ ...batch(cursor), select: { id: true, email: true } }), u => { staff.add(u.email.trim().toLowerCase()); });
    await visitBatches(cursor => db.emailDeliveryLog.findMany({ ...batch(cursor), where: { ...batch(cursor).where, OR: [{ status: { in: ['hard_bounce', 'blocked', 'spam', 'invalid_email', 'unsubscribed'] } }, { EmailEvent: { some: { eventType: { in: ['hard_bounce', 'blocked', 'spam', 'invalid_email', 'unsubscribe'] } } } }] }, select: { id: true, toEmail: true, status: true } }), log => { suppressed.set(log.toEmail.trim().toLowerCase(), log.status === 'unsubscribed' ? 'UNSUBSCRIBED' : 'BLOCKED'); });
  }
  await visitBatches(cursor => db.contact.findMany({ ...batch(cursor), where: { ...batch(cursor).where, doNotContact: true }, select: { id: true, email: true, phone: true } }), c => {
    if (channel === 'SMS' && c.phone) { try { suppressed.set(normalizeSmsPhone(c.phone), 'DO_NOT_CONTACT'); } catch { /* Invalid numbers cannot be sent. */ } }
    else if (c.email) suppressed.set(c.email.trim().toLowerCase(), 'UNSUBSCRIBED');
  });
  if (channel === 'EMAIL') await visitBatches(cursor => db.campaignContact.findMany({ ...batch(cursor), where: { ...batch(cursor).where, unsubscribed: true }, select: { id: true, email: true, lead: { select: { email: true } }, contact: { select: { email: true } } } }), c => {
    for (const email of [c.email, c.lead?.email, c.contact?.email]) if (email) suppressed.set(email.trim().toLowerCase(), 'UNSUBSCRIBED');
  });
  const rawAllowlist = process.env.BREVO_SANDBOX_EMAILS?.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const allowlist = process.env.NODE_ENV !== 'production' && rawAllowlist?.length ? new Set(rawAllowlist) : null;
  const breakdown = emptyBreakdown(), seen = new Set<string>(), records: ResolvedRecipient[] = [];
  const retain = (row: ResolvedRecipient) => {
    classify(row, channel, staff, suppressed, allowlist, seen, breakdown);
    if (!page || (!row.reason && breakdown.eligible > (page.page - 1) * page.limit && records.length < page.limit)) records.push(row);
  };
  // Contacts win. Preview reads bounded, stable batches and retains only its page.
  if (dto.source !== 'LEADS') {
    let cursor: string | undefined;
    for (;;) {
      const rows = await db.contact.findMany({ where: { ...scope, ...audiencePredicate(dto, false, fields, companies, canReadAccount), ...(cursor ? { id: { gt: cursor } } : {}) }, take: 250, orderBy: { id: 'asc' }, select: { ...contactRecipientProjection, customFieldValues: { ...contactRecipientProjection.customFieldValues, where: { tenantId, module: 'contacts' } }, companyName: true, notes: true, doNotContact: true, productLinks: { ...contactRecipientProjection.productLinks, select: { ...contactRecipientProjection.productLinks.select, interested: true, activeProduct: true } } } });
      for (const c of rows) { const resolved = personalized(presentContactAccount(c, canReadAccount), campaignFields, tenantId, requiredVariables); retain({ contactId: c.id, email: c.email, phone: c.phone, reason: c.doNotContact ? (channel === 'SMS' ? 'DO_NOT_CONTACT' : 'UNSUBSCRIBED') : c.isArchived || c.deletedAt || c.status === 'CANCELLED' ? 'INACTIVE' : null, personalization: resolved.values, unresolvedVariables: resolved.unresolved }); }
      if (rows.length < 250) break;
      cursor = rows[rows.length - 1].id;
    }
  }
  if (dto.source !== 'CONTACTS') {
    let cursor: string | undefined;
    for (;;) {
      const rows = await db.lead.findMany({ where: { ...scope, ...audiencePredicate(dto, true, fields, companies, canReadAccount), ...(cursor ? { id: { gt: cursor } } : {}) }, take: 250, orderBy: { id: 'asc' }, select: { ...leadRecipientProjection, customFieldValues: { ...leadRecipientProjection.customFieldValues, where: { tenantId, module: 'leads' } }, companyName: true, convertedAt: true } });
      for (const l of rows) { const resolved = personalized(presentContactAccount(l, canReadAccount), campaignFields, tenantId, requiredVariables); retain({ leadId: l.id, email: l.email, phone: l.phone, reason: l.isArchived || l.deletedAt || l.convertedAt || ['archived', 'converted', 'cancelled'].includes(l.status.toLowerCase()) ? 'INACTIVE' : null, personalization: resolved.values, unresolvedVariables: resolved.unresolved }); }
      if (rows.length < 250) break;
      cursor = rows[rows.length - 1].id;
    }
  }
  return { records, breakdown };
}
export async function previewAudience(tenantId: string, input: unknown): Promise<AudiencePreviewResult> {
  const { channel, page, limit, ...definition } = AudiencePreviewRequestSchema.parse(input);
  const { records, breakdown } = await resolveAudience(tenantId, definition, prisma, channel, { page, limit });
  return { ...breakdown, recipients: records.map(r => ({ id: (r.contactId || r.leadId)!, recordType: r.contactId ? 'Contact' : 'Lead', name: `${r.personalization.first_name || ''} ${r.personalization.last_name || ''}`.trim(), companyName: r.personalization.company_name || '', email: r.email, phone: r.phone ?? null })), meta: { page, limit, total: breakdown.eligible, hasMore: page * limit < breakdown.eligible } };
}
