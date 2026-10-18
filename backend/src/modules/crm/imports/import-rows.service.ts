import type { Prisma } from '@prisma/client';
import { importIdentity, importRowSchemas, normalizeAccountImportRow, splitProductInterests, type CrmImportModule, type ImportReviewRow } from '@leadcrm/shared';
import { ValidationError } from '../../../shared/errors/http-error';
import { createAssignedLead } from '../leads/lead-automation.service';
import sanitizeHtml from 'sanitize-html';
import { ZodError, type ZodIssue } from 'zod';
import { createAssignedContact } from '../contacts-v2/contact-creation';

type Tx = Prisma.TransactionClient;
export type MappedRow = { rowNumber: number; data: Record<string, string> };
type Product = { id: string; name: string; dealValue: Prisma.Decimal; active: boolean };
export interface ResolvedRow extends ImportReviewRow { products: Product[] }
const plainTextFields = new Set(['firstName', 'lastName', 'name', 'companyName', 'address', 'city', 'province', 'country', 'source', 'industry']);
const parseRow = (module: CrmImportModule, data: Record<string, string>) => importRowSchemas[module].safeParse(
  Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    plainTextFields.has(key) ? sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }) : value])),
);
export function importValidationErrors(error: unknown): string[] | null {
  if (error instanceof ValidationError) return [error.message];
  if (error instanceof ZodError) {
    // Optional phone validation is a union; expose its real phone rule, not "Invalid input".
    const issues = error.issues.flatMap<ZodIssue>(issue => issue.code === 'invalid_union'
      ? issue.unionErrors.flatMap(branch => branch.issues).filter(detail => detail.code !== 'invalid_literal') : [issue]);
    const labels: Record<string, string> = { firstName: 'First Name', lastName: 'Last Name', email: 'Email', phone: 'Phone Number',
      companyName: 'Company Name', address: 'Full Address', productInterest: 'Product Interest', name: 'Company Name' };
    return [...new Set(issues.map(issue => `${labels[String(issue.path[0])] ?? issue.path.join('.')}: ${issue.message}`))];
  }
  return null;
}

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

export async function validateImportRow(tx: Tx, module: CrmImportModule, tenantId: string, raw: MappedRow, duplicate?: string): Promise<ResolvedRow> {
  const parsed = parseRow(module, raw.data);
  const result: ResolvedRow = { ...raw, data: parsed.success ? (module === 'accounts' ? normalizeAccountImportRow(parsed.data) : parsed.data) : raw.data, products: [], isValid: false, status: 'invalid', errors: [] };
  if (!parsed.success) result.errors = importValidationErrors(parsed.error)!;
  if (!parsed.success) return result;
  if (duplicate) { result.status = 'duplicate'; result.errors.push(duplicate); return result; }
  try {
    const handler = importHandlers[module];
    result.errors.push(...await handler.duplicates(tx, tenantId, result.data));
    if (result.errors.length) { result.status = 'duplicate'; return result; }
    if (module !== 'accounts') {
      result.products = await resolveImportProducts(tx, tenantId, result.data.productInterest);
      result.data.productInterest = result.products.map(p => p.name).join('; ');
    }
    result.isValid = true; result.status = 'valid';
  } catch (error) {
    const errors = importValidationErrors(error);
    if (!errors) throw error;
    result.errors.push(...errors);
  }
  return result;
}

/** Validate earlier matching candidates so an invalid Product/relationship cannot hide a valid row. */
export function csvRowValidator(module: CrmImportModule, tenantId: string, rows: MappedRow[],
  failedRow?: (tx: Tx, rowNumber: number) => Promise<boolean>) {
  const candidates = new Map<string, MappedRow[]>();
  for (const row of rows) {
    const parsed = parseRow(module, row.data);
    if (!parsed.success) continue;
    const key = importHandlers[module].identity(parsed.data);
    if (key) {
      const matches = candidates.get(key) ?? [];
      matches.push(row); candidates.set(key, matches);
    }
  }
  const reviews = new WeakMap<Tx, Map<number, Promise<ResolvedRow>>>();
  const candidateReview = (tx: Tx, row: MappedRow) => {
    let cache = reviews.get(tx);
    if (!cache) { cache = new Map(); reviews.set(tx, cache); }
    let review = cache.get(row.rowNumber);
    if (!review) { review = validateImportRow(tx, module, tenantId, row); cache.set(row.rowNumber, review); }
    return review;
  };
  return async (tx: Tx, raw: MappedRow): Promise<ResolvedRow> => {
    const parsed = parseRow(module, raw.data);
    if (parsed.success) {
      const earlier = candidates.get(importHandlers[module].identity(parsed.data)) ?? [];
      for (const first of earlier) {
        if (first.rowNumber >= raw.rowNumber) break;
        // A creation rejected after validation rolled back and must not reserve this identity.
        if (failedRow && await failedRow(tx, first.rowNumber)) continue;
        const review = await candidateReview(tx, first);
        if (review.isValid || review.status === 'duplicate') return validateImportRow(tx, module, tenantId, raw,
          `Duplicate ${importHandlers[module].duplicateLabel}. First occurrence: Row ${first.rowNumber}.`);
      }
    }
    return validateImportRow(tx, module, tenantId, raw);
  };
}

async function createLead(tx: Tx, tenantId: string, actorId: string, jobId: string, row: ResolvedRow) {
  const d = row.data, names = row.products.map(p => p.name);
  return (await createAssignedLead(tx, { tenantId, firstName: d.firstName, lastName: d.lastName,
    email: d.email, phone: d.phone, companyName: d.companyName, address: d.address, source: d.source,
    status: d.status, productInterestIds: row.products.map(p => p.id), productInterest: names,
    createdById: actorId, updatedById: actorId, creationKey: `${jobId}:${row.rowNumber}`,
  }, actorId)).id;
}
async function createContact(tx: Tx, tenantId: string, actorId: string, jobId: string, row: ResolvedRow) {
  const d = row.data;
  return (await createAssignedContact(tx, tenantId, { firstName: d.firstName, lastName: d.lastName,
    email: d.email, phone: d.phone, companyName: d.companyName, address: d.address, status: 'Warm', productInterestIds: row.products.map(p => p.id),
  }, actorId, `import:${jobId}:${row.rowNumber}`)).contact.id;
}
async function createAccount(tx: Tx, tenantId: string, _actorId: string, _jobId: string, row: ResolvedRow) {
  const d = row.data;
  return (await tx.account.create({ data: { tenantId, name: d.name, industry: d.industry, website: d.website,
    address: normalizeAccountImportRow(d).address, size: d.size || null,
    tags: [],
  } })).id;
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
  create: typeof createLead;
}
const personIdentity = (data: Record<string, string>) => importIdentity(data.email || '');
/** Business strategies are independent of jobs, result storage, uploads and history. */
export const importHandlers: Record<CrmImportModule, ImportHandler> = {
  leads: { identity: personIdentity, duplicateLabel: 'email address', duplicates: personDuplicates, create: createLead },
  contacts: { identity: personIdentity, duplicateLabel: 'email address', duplicates: personDuplicates, create: createContact },
  accounts: {
    identity: data => importIdentity(data.name || ''), duplicateLabel: 'Account Name', create: createAccount,
    duplicates: async (tx, tenantId, data) => {
      const accounts = await tx.account.findMany({ where: { tenantId }, select: { name: true } });
      return accounts.some(a => importIdentity(a.name) === importIdentity(data.name)) ? ['Existing Account: an Account with this name already exists.'] : [];
    },
  },
};
export const createImportRow = (tx: Tx, module: CrmImportModule, tenantId: string, actorId: string, jobId: string, row: ResolvedRow) =>
  importHandlers[module].create(tx, tenantId, actorId, jobId, row);
