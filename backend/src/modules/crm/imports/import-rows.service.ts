import { productRelationData } from '../leads/product-relations';
import type { Prisma } from '@prisma/client';
import { importIdentity, importRowSchemas, splitProductInterests, type CrmImportModule, type ImportReviewRow } from '@leadcrm/shared';
import { ValidationError } from '../../../shared/errors/http-error';
import { createAssignedLead, validateSalesOwner } from '../leads/lead-automation.service';
import { CreateDealSchema, type CreateDealDto } from '../deals/deals.dto';
import { createDeal } from '../deals/deals.repository';
import sanitizeHtml from 'sanitize-html';

type Tx = Prisma.TransactionClient;
export type MappedRow = { rowNumber: number; data: Record<string, string> };
type Product = { id: string; name: string; dealValue: Prisma.Decimal; active: boolean };
export interface ResolvedRow extends ImportReviewRow { products: Product[]; deal?: CreateDealDto }

function unique<T>(matches: T[], label: string, value: string): T {
  if (!matches.length) throw new ValidationError(`Unknown ${label}: "${value}".`);
  if (matches.length > 1) throw new ValidationError(`Ambiguous ${label}: "${value}". Use its ID.`);
  return matches[0];
}
export async function resolveImportProducts(tx: Tx, tenantId: string, input: string) {
  const values = splitProductInterests(input);
  if (!values.length) return [];
  const catalog = await tx.productInterest.findMany({ where: { tenantId } });
  return [...new Map(values.map(value => {
    const product = unique(catalog.filter(p => p.id === value || importIdentity(p.name) === importIdentity(value)), 'Product Interest', value);
    if (!product.active) throw new ValidationError(`Inactive Product Interest: "${product.name}".`);
    return [product.id, product] as const;
  })).values()];
}

/** File identities do not include Products for people/accounts; Deals compare every input. */
export function duplicateCsvRows(module: CrmImportModule, rows: MappedRow[]) {
  const seen = new Map<string, number>(), duplicates = new Map<number, string>();
  for (const row of rows) {
    const handler = importHandlers[module];
    const key = handler.identity(row.data);
    if (!key) continue;
    const first = seen.get(key);
    if (first !== undefined) duplicates.set(row.rowNumber, `Duplicate CSV ${handler.duplicateLabel} (first appears on row ${first}).`);
    else seen.set(key, row.rowNumber);
  }
  return duplicates;
}

async function resolveAccount(tx: Tx, tenantId: string, value: string) {
  const records = await tx.account.findMany({ where: { tenantId, isArchived: false, deletedAt: null } });
  return unique(records.filter(r => r.id === value || importIdentity(r.name) === importIdentity(value)), 'Account', value);
}
async function resolvePerson(tx: Tx, tenantId: string, value: string, kind: 'lead' | 'contact') {
  const where = { tenantId, isArchived: false, deletedAt: null, OR: [{ id: value }, { email: { contains: value.trim(), mode: 'insensitive' as const } }] };
  const records = kind === 'lead' ? await tx.lead.findMany({ where }) : await tx.contact.findMany({ where });
  return records.filter(r => r.id === value || importIdentity(r.email ?? '') === importIdentity(value));
}

async function resolveDeal(tx: Tx, tenantId: string, data: Record<string, string>, product: Product) {
  const pipelines = await tx.pipeline.findMany({ where: { tenantId, isArchived: false } });
  const pipeline = unique(pipelines.filter(p => p.id === data.pipeline || importIdentity(p.name) === importIdentity(data.pipeline)), 'Pipeline', data.pipeline);
  const stages = await tx.stage.findMany({ where: { tenantId, pipelineId: pipeline.id } });
  const stage = unique(stages.filter(s => s.id === data.stage || importIdentity(s.name) === importIdentity(data.stage)), 'Stage', data.stage);
  if (stage.isWon || stage.isLost) throw new ValidationError('Import into an open stage, then complete the normal closing action.');
  if ([data.customer, data.contact, data.lead].filter(Boolean).length > 1) throw new ValidationError('Use only one customer column: Customer Email, Lead, or Contact.');
  let lead, contact;
  if (data.lead) lead = unique(await resolvePerson(tx, tenantId, data.lead, 'lead'), 'Lead', data.lead);
  if (data.contact) contact = unique(await resolvePerson(tx, tenantId, data.contact, 'contact'), 'Contact', data.contact);
  if (data.customer) {
    const leads = await resolvePerson(tx, tenantId, data.customer, 'lead');
    const contacts = await resolvePerson(tx, tenantId, data.customer, 'contact');
    // A converted Lead and its Contact are one identity; retain the canonical Contact.
    const activeLeads = leads.filter(l => !('contactId' in l && contacts.some(c => c.id === l.contactId)));
    const customer = unique([...activeLeads.map(record => ({ kind: 'lead', record })), ...contacts.map(record => ({ kind: 'contact', record }))], 'Customer', data.customer);
    if (customer.kind === 'lead') lead = customer.record; else contact = customer.record;
  }
  if (lead && 'contactId' in lead && lead.contactId) {
    contact = unique(await resolvePerson(tx, tenantId, String(lead.contactId), 'contact'), 'converted Contact', String(lead.contactId));
    lead = undefined;
  }
  const personAccountId = lead?.accountId ?? contact?.accountId;
  const account = data.account ? await resolveAccount(tx, tenantId, data.account) : personAccountId ? await resolveAccount(tx, tenantId, personAccountId) : undefined;
  if (account && personAccountId && account.id !== personAccountId) throw new ValidationError('Account conflicts with the selected customer relationship.');
  if (!lead && !contact && !account) throw new ValidationError('Provide a Customer Email, Lead, Contact, or Account for this Deal.');
  let assignee;
  if (data.assignedUser) {
    const users = await tx.user.findMany({ where: { tenantId, status: 'ACTIVE', OR: [{ id: data.assignedUser }, { email: { equals: data.assignedUser, mode: 'insensitive' } }] } });
    assignee = unique(users, 'Assigned Agent', data.assignedUser);
    await validateSalesOwner(tx, tenantId, assignee.id);
  }
  const dto = CreateDealSchema.parse({ title: data.title, pipelineId: pipeline.id, stageId: stage.id,
    productInterestId: product.id, productInterestIds: [product.id], value: Number(product.dealValue), priority: data.priority,
    expectedCloseDate: data.expectedCloseDate ? `${data.expectedCloseDate}T00:00:00.000Z` : undefined,
    accountId: account?.id, contactIds: contact ? [contact.id] : undefined, leadIds: lead ? [lead.id] : undefined,
    assignedUserId: assignee?.id,
  });
  for (const field of stage.requiredFields) {
    const value = (dto as Record<string, unknown>)[field];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) throw new ValidationError(`Stage requires ${field}.`);
  }
  return dto;
}

export async function validateImportRow(tx: Tx, module: CrmImportModule, tenantId: string, raw: MappedRow, duplicate?: string): Promise<ResolvedRow> {
  const plainTextFields = new Set(['firstName', 'lastName', 'title', 'name', 'companyName', 'address', 'description', 'city', 'province', 'country', 'source', 'industry']);
  const plain = Object.fromEntries(Object.entries(raw.data).map(([key, value]) => [key,
    plainTextFields.has(key) ? sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }) : value,
  ]));
  const parsed = importRowSchemas[module].safeParse(plain);
  const result: ResolvedRow = { ...raw, data: parsed.success ? parsed.data : raw.data, products: [], isValid: false, status: 'invalid', errors: [] };
  if (!parsed.success) result.errors = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
  if (duplicate) { result.status = 'duplicate'; result.errors.push(duplicate); return result; }
  if (!parsed.success) return result;
  try {
    const handler = importHandlers[module];
    result.errors.push(...await handler.duplicates(tx, tenantId, result.data));
    if (result.errors.length) { result.status = 'duplicate'; return result; }
    result.products = await resolveImportProducts(tx, tenantId, result.data.productInterest);
    result.data.productInterest = result.products.map(p => p.name).join('; ');
    if (handler.resolve) await handler.resolve(tx, tenantId, result);
    result.isValid = true; result.status = 'valid';
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    result.errors.push(error.message);
  }
  return result;
}

async function createLead(tx: Tx, tenantId: string, actorId: string, jobId: string, row: ResolvedRow) {
  const d = row.data, names = row.products.map(p => p.name);
  return (await createAssignedLead(tx, { tenantId, firstName: d.firstName, lastName: d.lastName,
    email: d.email, phone: d.phone, companyName: d.companyName, address: d.address, source: d.source,
    status: d.status, productInterestIds: row.products.map(p => p.id), productInterest: names,
    createdById: actorId, updatedById: actorId, creationKey: `${jobId}:${row.rowNumber}`,
  }, actorId)).id;
}
async function createContact(tx: Tx, tenantId: string, _actorId: string, _jobId: string, row: ResolvedRow) {
  const d = row.data, names = row.products.map(p => p.name);
  return (await tx.contact.create({ data: { tenantId, firstName: d.firstName, lastName: d.lastName,
    email: d.email, phone: d.phone, company: d.companyName, address: d.address, status: 'WARM', ...await productRelationData(tx, 'contact', tenantId, { ids: row.products.map(p => p.id) }),
  } })).id;
}
async function createAccount(tx: Tx, tenantId: string, _actorId: string, _jobId: string, row: ResolvedRow) {
  const d = row.data, names = row.products.map(p => p.name);
  return (await tx.account.create({ data: { tenantId, name: d.name, industry: d.industry, website: d.website,
    address: d.address, city: d.city, province: d.province, country: d.country || 'Philippines', size: d.size || null,
    ...await productRelationData(tx, 'account', tenantId, { ids: row.products.map(p => p.id) }), tags: [],
  } })).id;
}
async function createImportedDeal(tx: Tx, tenantId: string, actorId: string, _jobId: string, row: ResolvedRow) {
  const names = row.products.map(p => p.name);
  // The existing repository resolves the Product price again inside this transaction.
  const deal = await createDeal(tenantId, actorId, row.deal!, tx);
  const leadId = row.deal!.leadIds?.[0], contactId = row.deal!.contactIds?.[0], accountId = row.deal!.accountId;
  if (leadId) {
    const lead = await tx.lead.findFirstOrThrow({ where: { tenantId, id: leadId } });
    await tx.lead.update({ where: { tenantId, id: leadId }, data: {
      ...await productRelationData(tx, 'lead', tenantId, { names: [...new Set([...lead.productInterest, ...names])] }, lead, true),
    } });
  }
  if (contactId) {
    const contact = await tx.contact.findFirstOrThrow({ where: { tenantId, id: contactId } });
    await tx.contact.update({ where: { tenantId, id: contactId }, data: await productRelationData(tx, 'contact', tenantId, { names: [...new Set([...contact.productInterests, ...names])] }, contact, true) });
  }
  if (accountId) {
    const account = await tx.account.findFirstOrThrow({ where: { tenantId, id: accountId } });
    await tx.account.update({ where: { tenantId, id: accountId }, data: await productRelationData(tx, 'account', tenantId, { names: [...new Set([...account.productInterests, ...names])] }, account, true) });
  }
  return deal.id;
}

async function personDuplicates(tx: Tx, tenantId: string, data: Record<string, string>) {
  const where = { tenantId, email: { contains: data.email, mode: 'insensitive' as const } };
  const leads = await tx.lead.findMany({ where, select: { email: true } });
  const contacts = await tx.contact.findMany({ where, select: { email: true } });
  const errors: string[] = [];
  if (contacts.some(r => importIdentity(r.email ?? '') === data.email)) errors.push('Existing Contact: a Contact with this email already exists.');
  if (leads.some(r => importIdentity(r.email ?? '') === data.email)) errors.push('Existing Lead: a Lead with this email already exists. Use the normal conversion flow to create its Contact.');
  return errors;
}
interface ImportHandler {
  identity(data: Record<string, string>): string;
  duplicateLabel: string;
  duplicates(tx: Tx, tenantId: string, data: Record<string, string>): Promise<string[]>;
  resolve?(tx: Tx, tenantId: string, row: ResolvedRow): Promise<void>;
  create: typeof createLead;
}
const personIdentity = (data: Record<string, string>) => importIdentity(data.email || '');
/** Business strategies are independent of jobs, result storage, uploads and history. */
export const importHandlers: Record<CrmImportModule, ImportHandler> = {
  leads: { identity: personIdentity, duplicateLabel: 'email', duplicates: personDuplicates, create: createLead },
  contacts: { identity: personIdentity, duplicateLabel: 'email', duplicates: personDuplicates, create: createContact },
  accounts: {
    identity: data => importIdentity(data.name || ''), duplicateLabel: 'Account Name', create: createAccount,
    duplicates: async (tx, tenantId, data) => {
      const accounts = await tx.account.findMany({ where: { tenantId }, select: { name: true } });
      return accounts.some(a => importIdentity(a.name) === importIdentity(data.name)) ? ['Existing Account: an Account with this name already exists.'] : [];
    },
  },
  deals: {
    identity: data => JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, importIdentity(v)])),
    duplicateLabel: 'row', duplicates: async () => [], create: createImportedDeal,
    resolve: async (tx, tenantId, row) => {
      row.deal = await resolveDeal(tx, tenantId, row.data, row.products[0]);
      row.resolvedValue = Number(row.products[0].dealValue);
    },
  },
};
export const createImportRow = (tx: Tx, module: CrmImportModule, tenantId: string, actorId: string, jobId: string, row: ResolvedRow) =>
  importHandlers[module].create(tx, tenantId, actorId, jobId, row);
