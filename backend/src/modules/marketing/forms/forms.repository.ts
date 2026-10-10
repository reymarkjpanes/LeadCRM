import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { defaultContactForm, FormDefinitionSchema, FormFieldSchema, getFormProductValues, ProductInterestIdSchema } from '@leadcrm/shared';
import type { CreateFormDto, UpdateFormDto } from './forms.dto';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/http-error';

export async function findAll(tenantId: string, page: number, limit: number) {
  const where = { tenantId, isArchived: false };
  const [data, total] = await Promise.all([prisma.marketingForm.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }), prisma.marketingForm.count({ where })]);
  return { data, total };
}
export function findById(id: string, tenantId: string) { return prisma.marketingForm.findFirst({ where: { id, tenantId, isArchived: false } }); }
export function create(tenantId: string, createdById: string, dto: CreateFormDto) {
  return prisma.marketingForm.create({ data: { tenantId, createdById, ...defaultContactForm(dto.name) } });
}
export async function update(id: string, tenantId: string, dto: UpdateFormDto) {
  return prisma.$transaction(async tx => {
    const current = await tx.marketingForm.findFirst({ where: { id, tenantId, isArchived: false } });
    if (!current) throw new NotFoundError('Form');
    const definition = FormDefinitionSchema.parse({ name: dto.name ?? current.name, fields: dto.fields ?? current.fields, design: dto.design ?? current.design, settings: dto.settings ?? current.settings });
    const changed = await tx.marketingForm.updateMany({ where: { id, tenantId, isArchived: false, revision: dto.revision }, data: { ...definition, revision: { increment: 1 } } });
    if (!changed.count) throw new ConflictError('This form was changed elsewhere. Reload before saving.');
    return tx.marketingForm.findFirstOrThrow({ where: { id, tenantId } });
  });
}
export async function publish(id: string, tenantId: string) {
  return prisma.$transaction(async tx => {
    const current = await tx.marketingForm.findFirst({ where: { id, tenantId, isArchived: false } });
    if (!current) throw new NotFoundError('Form');
    const config = FormDefinitionSchema.parse({ name: current.name, fields: current.fields, design: current.design, settings: current.settings });
    if (!config.fields.some(f => f.required && ['email', 'phone'].includes(f.mapToField ?? ''))) throw new ValidationError('Add a required CRM email or phone field before publishing.');
    const changed = await tx.marketingForm.updateMany({ where: { id, tenantId, isArchived: false, revision: current.revision }, data: { status: 'published', publishedConfig: config, publishedAt: new Date(), publishedRevision: current.revision, publishedVersion: { increment: 1 } } });
    if (!changed.count) throw new ConflictError('Form changed while publishing. Please retry.');
    return tx.marketingForm.findFirstOrThrow({ where: { id, tenantId } });
  });
}
/** Lock the scoped draft before deleting dependents; publishing uses the same revision guard. */
export async function remove(id: string, tenantId: string) {
  return prisma.$transaction(async tx => {
    const current = await tx.marketingForm.findFirst({ where: { id, tenantId, isArchived: false } });
    if (!current) throw new NotFoundError('Form');
    const publishedError = 'Published forms must be unpublished before they can be deleted.';
    if (current.status.toLowerCase() === 'published') throw new ConflictError(publishedError);
    const locked = await tx.marketingForm.updateMany({
      where: { id, tenantId, isArchived: false, revision: current.revision, status: { not: 'published', mode: 'insensitive' } },
      data: { revision: { increment: 1 } },
    });
    if (!locked.count) throw new ConflictError('This form changed. Reload it and unpublish it before deleting.');
    // Submission snapshots belong to the form. CRM leads/contacts are independent and remain intact.
    const submissions = await tx.formSubmission.deleteMany({ where: { formId: id, tenantId } });
    await tx.marketingForm.deleteMany({ where: { id, tenantId } });
    return { name: current.name, deletedSubmissions: submissions.count };
  });
}
export async function unpublish(id: string, tenantId: string) {
  return prisma.$transaction(async tx => {
    const changed = await tx.marketingForm.updateMany({ where: { id, tenantId, isArchived: false }, data: { status: 'draft', revision: { increment: 1 } } });
    if (!changed.count) throw new NotFoundError('Form');
    return tx.marketingForm.findFirstOrThrow({ where: { id, tenantId } });
  });
}
export async function duplicate(id: string, tenantId: string, createdById: string) {
  const source = await findById(id, tenantId);
  if (!source) throw new NotFoundError('Form');
  return prisma.marketingForm.create({ data: { tenantId, createdById, name: source.name.slice(0, 193) + ' (copy)', fields: source.fields as Prisma.InputJsonValue, design: source.design as Prisma.InputJsonValue, settings: source.settings as Prisma.InputJsonValue } });
}
export async function submissions(id: string, tenantId: string, page: number, limit: number) {
  if (!await prisma.marketingForm.findFirst({ where: { id, tenantId } })) throw new NotFoundError('Form');
  const where = { formId: id, tenantId };
  const [data, total] = await Promise.all([prisma.formSubmission.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { submittedAt: 'desc' } }), prisma.formSubmission.count({ where })]);
  const productIdsFor = (submission: typeof data[number]) => {
    const config = submission.publishedConfig as { fields?: unknown } | null;
    const fields = FormFieldSchema.array().safeParse(config?.fields);
    const values = submission.values as Record<string, unknown>;
    return fields.success ? fields.data.filter(field => field.mapToField === 'productInterest')
      .flatMap(field => getFormProductValues(values[field.id])).filter(value => ProductInterestIdSchema.safeParse(value).success) : [];
  };
  const ids = [...new Set(data.flatMap(productIdsFor))];
  // Historical submissions also retain labels for archived Products. Never rewrite values.
  const products = ids.length ? await prisma.productInterest.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  const labels = new Map(products.map(product => [product.id, product.name]));
  return { data: data.map(submission => ({ ...submission, productLabels: Object.fromEntries(productIdsFor(submission).filter(id => labels.has(id)).map(id => [id, labels.get(id)!])) })), total };
}
