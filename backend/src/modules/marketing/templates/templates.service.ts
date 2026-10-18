import { MarketingTemplateSchema, quotationVariableChoices, campaignVariableKeys } from '@leadcrm/shared';
import { sanitizeCampaignHtml } from '../campaigns/campaign-content';
import { campaignScope, campaignVariableFields } from '../campaigns/audiences.service';
import prisma from '../../../config/database.config';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError } from '../../../shared/errors/http-error';
import { AppError } from '../../../shared/errors/app-error';
import { getPaginationParams, paginate } from '../../../shared/helpers/pagination';
import { buildSearchClauses } from '../../../shared/helpers/search';

export async function getTemplates(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;
  const where = { ...campaignScope(tenantId), isArchived: query.archived === 'true',
    ...(query.type   ? { type:   String(query.type) }   : {}),
    ...(query.category ? { category: String(query.category) } : {}),
    AND: buildSearchClauses(query.search, query.type === 'Quotation' ? ['name', 'category'] : ['name']),
  };
  const [data, total] = await Promise.all([
    prisma.template.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.template.count({ where }),
  ]);
  return paginate(data, total, { page, limit });
}

export async function getTemplateById(id: string, tenantId: string) {
  const t = await prisma.template.findFirst({ where: { id, ...campaignScope(tenantId) } });
  if (!t) throw new NotFoundError('Template');
  return t;
}

export async function createTemplate(tenantId: string, userId: string, dto: Record<string, unknown>) {
  const parsed = MarketingTemplateSchema.parse(dto);
  if (parsed.type === 'Quotation') await validateQuotationVariables(tenantId, parsed.content);
  const template = await prisma.template.create({ data: { ...parsed, content: MarketingTemplateSchema.parse({ ...parsed, content: parsed.type === 'Email' ? sanitizeCampaignHtml(parsed.content) : parsed.content }).content, ...campaignScope(tenantId) } });
  await writeAuditLog({ tenantId, userId, action: 'template.created', entityType: 'Template', entityId: template.id });
  return template;
}

export async function updateTemplate(id: string, tenantId: string, userId: string, dto: Record<string, unknown>) {
  const existing = await prisma.template.findFirst({ where: { id, ...campaignScope(tenantId) } });
  if (!existing) throw new NotFoundError('Template');
  const patch = MarketingTemplateSchema.innerType().partial().parse(dto);
  const parsed = MarketingTemplateSchema.parse({ name: existing.name, type: existing.type, category: existing.category || undefined, subject: existing.subject || undefined, content: existing.content, ...patch });
  if ((existing.type === 'Quotation') !== (parsed.type === 'Quotation')) throw new AppError('Create a new template to change between quotation and messaging formats.', 400);
  if (parsed.type === 'Quotation') await validateQuotationVariables(tenantId, parsed.content);
  const template = await prisma.template.update({ where: { id, ...campaignScope(tenantId) }, data: { ...parsed, content: MarketingTemplateSchema.parse({ ...parsed, content: parsed.type === 'Email' ? sanitizeCampaignHtml(parsed.content) : parsed.content }).content } });
  await writeAuditLog({ tenantId, userId, action: 'template.updated', entityType: 'Template', entityId: id });
  return template;
}

export async function validateQuotationVariables(tenantId: string, content: string) {
  const approved = new Set(quotationVariableChoices(await campaignVariableFields(tenantId)).filter(choice => choice.personalizationAvailable).map(choice => choice.technicalKey));
  const invalid = campaignVariableKeys(content).filter(key => !approved.has(key));
  if (invalid.length) throw new AppError(`Unavailable quotation variables: ${invalid.join(', ')}.`, 400);
}

export async function archiveTemplate(id: string, tenantId: string, userId: string) {
  const existing = await prisma.template.findFirst({ where: { id, ...campaignScope(tenantId) } });
  if (!existing) throw new NotFoundError('Template');
  await prisma.template.update({ where: { id }, data: { isArchived: true } });
  await writeAuditLog({ tenantId, userId, action: 'template.archived', entityType: 'Template', entityId: id });
}
