import { campaignApprovedVariableKeys, campaignVariableKeys, renderEmailVariables, workflowMessageVariableError, WORKFLOW_MODULES, type EmailVariables, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { campaignVariableFields, workflowRecipientValues } from '../../marketing/campaigns/audiences.service';

export async function validateMessageVariables(content: string, entity: WorkflowEntity, tenantId: string) {
  if (!campaignVariableKeys(content).length) return;
  const fields = await campaignVariableFields(tenantId);
  const keys = campaignApprovedVariableKeys(entity === 'lead' || entity === 'contact' ? fields : fields.filter(field => field.module === WORKFLOW_MODULES[entity]), entity === 'lead' ? 'LEADS' : entity === 'contact' ? 'CONTACTS' : undefined);
  const error = workflowMessageVariableError(content, keys);
  if (error) throw new ValidationError(error);
}

export async function messageValues(tenantId: string, entity: WorkflowEntity, context: Record<string, unknown>) {
  if (entity === 'lead' || entity === 'contact') return workflowRecipientValues(tenantId, entity, String(context[`${entity}.id`]), new Set(), context);
  const fields = (await campaignVariableFields(tenantId)).filter(field => field.module === WORKFLOW_MODULES[entity]);
  const values: Record<string, string> = Object.create(null);
  for (const field of fields) {
    const value = context[`${entity}.${field.canonicalTechnicalKey ?? field.technicalKey}`];
    let rendered = value == null ? '' : String(value);
    if (field.reference === 'user' && value) {
      const user = await prisma.user.findFirst({ where: { tenantId, id: String(value) }, select: { firstName: true, lastName: true } });
      rendered = user ? `${user.firstName} ${user.lastName}`.trim() : '';
    } else if (field.reference && value) {
      const record = field.reference === 'account' ? await prisma.account.findFirst({ where: { tenantId, id: String(value) }, select: { name: true } })
        : field.reference === 'stage' ? await prisma.stage.findFirst({ where: { tenantId, id: String(value) }, select: { name: true } })
        : await prisma.pipeline.findFirst({ where: { tenantId, id: String(value) }, select: { name: true } });
      rendered = record?.name ?? '';
    } else if (field.type === 'products' && Array.isArray(value)) {
      const products = await prisma.productInterest.findMany({ where: { tenantId, id: { in: value as string[] } }, select: { id: true, name: true } });
      rendered = value.map(id => products.find(product => product.id === id)?.name ?? '').filter(Boolean).join(', ');
    }
    values[field.technicalKey] = rendered;
    if (field.canonicalTechnicalKey) values[field.canonicalTechnicalKey] = rendered;
  }
  return values;
}

export async function resolveMessageValues(content: string, tenantId: string, entity: WorkflowEntity, context: Record<string, unknown>, senderUserId?: string) {
  const values = entity === 'lead' || entity === 'contact' ? await workflowRecipientValues(tenantId, entity, String(context[`${entity}.id`]), new Set(campaignVariableKeys(content)), context) : await messageValues(tenantId, entity, context);
  if (senderUserId) {
    const [user, sender] = await Promise.all([
      prisma.user.findFirst({ where: { tenantId, id: senderUserId }, select: { firstName: true, lastName: true } }),
      prisma.emailAccount.findFirst({ where: { tenantId, userId: senderUserId, isActive: true, provider: 'gmail' }, select: { email: true } }),
    ]);
    values.sender_name = user ? `${user.firstName} ${user.lastName}`.trim() : '';
    values.sender_email = sender?.email ?? '';
  } else {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, email: true } });
    values.sender_name = tenant?.name ?? ''; values.sender_email = tenant?.email ?? '';
  }
  return values;
}

export function renderMessage(content: string, values: EmailVariables, html = true) {
  return renderEmailVariables(content, values, html).replace(html ? /\u0000/g : /[\x00-\x1f\x7f]/g, ' ');
}
