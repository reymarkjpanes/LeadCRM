import { getWorkflowUpdateFields, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { UpdateContactSchema } from '../../crm/contacts/contacts.dto';
import { UpdateClientContactSchema } from '../../crm/contacts-v2/contacts-v2.dto';
import { UpdateCompanySchema } from '../../crm/companies/companies.dto';
import { UpdateDealSchema } from '../../crm/deals/deals.dto';
import { validateSalesOwner } from '../../crm/leads/lead-automation.service';

export async function fieldUpdatePatch(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, incomplete = false): Promise<Record<string, unknown>> {
  const config = action.config;
  for (const key of Object.keys(config)) if (!['field', 'value', 'clear', 'otherDetails'].includes(key)) throw new ValidationError(`Remove unsupported action setting: ${key}.`);
  if (config.clear !== undefined && typeof config.clear !== 'boolean') throw new ValidationError('Choose whether to clear the field.');
  const field = getWorkflowUpdateFields(entity).find(f => f.field === config.field);
  if (!field) {
    if (incomplete && !config.field) return {};
    throw new ValidationError('Choose an editable field for this record.');
  }
  let value = config.value;
  if (field.type === 'list' && Array.isArray(value)) value = value.filter(v => typeof v === 'string' && v.trim()).map(v => String(v).trim());
  if (config.clear === true) {
    if (field.required) throw new ValidationError(`${field.label} cannot be cleared.`);
    value = field.nullable ? null : ['products', 'list', 'contacts', 'leads'].includes(field.type) ? [] : '';
  } else if (value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)) {
    if (incomplete) return {};
    throw new ValidationError('Enter a new value or choose Clear this field.');
  }
  if (field.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new ValidationError('Choose a valid date.');
    value = `${value}T00:00:00.000Z`;
  }
  const input: Record<string, unknown> = { [field.field]: value };
  if (field.type === 'products') {
    if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) throw new ValidationError('Choose Product Interests from the list.');
    const useIds = entity === 'lead' || entity === 'deal';
    const products = await prisma.productInterest.findMany({ where: { tenantId, active: true, ...(useIds ? { id: { in: value } } : { name: { in: value } }) } });
    if (products.length !== new Set(value).size) throw new ValidationError('Choose available Product Interests.');
    const others = products.some(p => p.name.trim().toLowerCase() === 'others');
    if (config.otherDetails !== undefined && (typeof config.otherDetails !== 'string' || config.otherDetails.length > 1000)) throw new ValidationError('Product interest details must be at most 1000 characters.');
    if (!others && config.otherDetails && config.clear !== true) throw new ValidationError('Select Others before specifying another product interest.');
    input.productInterestOther = others ? String(config.otherDetails ?? '').trim() || null : null;
  } else if (config.otherDetails) throw new ValidationError('Additional interest details are only available for Product Interest.');
  const schema = entity === 'lead' ? UpdateContactSchema : entity === 'contact' ? UpdateClientContactSchema : entity === 'account' ? UpdateCompanySchema : UpdateDealSchema;
  const parsed = schema.strict().safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(issue => `${field.label}: ${issue.message}`).join(' '));
  if (field.type === 'user' && value) await validateSalesOwner(prisma, tenantId, String(value));
  if (field.type === 'account' && value && !await prisma.account.findFirst({ where: { id: String(value), tenantId, isArchived: false } })) throw new ValidationError('Account is unavailable in this workspace.');
  if (field.type === 'contacts' || field.type === 'leads') {
    const ids = Array.isArray(value) ? value as string[] : [];
    const count = field.type === 'contacts' ? await prisma.contact.count({ where: { id: { in: ids }, tenantId, isArchived: false } }) : await prisma.lead.count({ where: { id: { in: ids }, tenantId, isArchived: false } });
    if (count !== new Set(ids).size) throw new ValidationError('A selected related record is unavailable in this workspace.');
  }
  return parsed.data;
}
