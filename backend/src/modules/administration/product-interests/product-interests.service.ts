import { MAX_ACTIVE_PRODUCTS, StoredProductCategoryNameSchema, ProductInterestIdSchema, type ProductCategoryMutation, type ProductInterest, type ProductWonDeal } from '@leadcrm/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';
import * as repository from './product-interests.repository';

export const productFieldKey = (tenantId: string) => ({ tenantId, module: 'product-interests', key: 'enabled' });
const categoryKey = (tenantId: string) => ({ tenantId, module: 'product-interests', key: 'categories' });
const categoryIdentity = (name: string) => name.trim().toLowerCase();

export async function productCategories(tx: Prisma.TransactionClient, tenantId: string, { readOnly = false } = {}): Promise<string[]> {
  const key = categoryKey(tenantId);
  const saved = await tx.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
  if (saved) return z.array(StoredProductCategoryNameSchema).parse(saved.value);
  // Bootstrap once from assignments, including archived Products. An empty saved
  // list remains authoritative so deleted categories cannot reappear.
  const rows = await tx.productInterest.findMany({ where: { tenantId, category: { not: '' } }, select: { category: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const categories = [...new Map(rows.filter(row => row.category.trim()).map(row => [categoryIdentity(row.category), row.category.trim()])).values()].sort((a, b) => a.localeCompare(b));
  if (!readOnly) await tx.tenantPreference.create({ data: { ...key, value: categories } });
  return categories;
}

export async function resolveProductCategory(tx: Prisma.TransactionClient, tenantId: string, name: string) {
  const parsed = StoredProductCategoryNameSchema.parse(name);
  const category = (await productCategories(tx, tenantId)).find(value => categoryIdentity(value) === categoryIdentity(parsed));
  if (!category) throw new AppError('Select an available Product Category.', 400);
  return category;
}

export async function mutateProductCategory(tx: Prisma.TransactionClient, tenantId: string, input: ProductCategoryMutation) {
  const categories = await productCategories(tx, tenantId);
  const index = categories.findIndex(name => categoryIdentity(name) === categoryIdentity(input.name));
  if (input.action === 'add') {
    if (index !== -1) throw new AppError('Category names must be unique.', 409);
    categories.push(input.name);
  } else {
    if (index === -1) throw new AppError('Category not found.', 404);
    const rows = await tx.productInterest.findMany({ where: { tenantId, category: { not: '' } }, select: { id: true, category: true } });
    const assignedIds = rows.filter(row => categoryIdentity(row.category) === categoryIdentity(input.name)).map(row => row.id);
    if (input.action === 'delete') {
      if (assignedIds.length) throw new AppError('This category cannot be deleted because it is currently assigned to one or more products.', 409);
      categories.splice(index, 1);
    } else {
      if (categories.some((name, position) => position !== index && categoryIdentity(name) === categoryIdentity(input.newName))) throw new AppError('Category names must be unique.', 409);
      categories[index] = input.newName;
      if (assignedIds.length) await tx.productInterest.updateMany({ where: { tenantId, id: { in: assignedIds } }, data: { category: input.newName } });
    }
  }
  categories.sort((a, b) => a.localeCompare(b));
  await tx.tenantPreference.update({ where: { tenantId_module_key: categoryKey(tenantId) }, data: { value: categories } });
}

export async function assertProductCatalogEnabled(tx: Prisma.TransactionClient, tenantId: string, message = 'Add the Product Interest field first.') {
  if ((await tx.tenantPreference.findUnique({ where: { tenantId_module_key: productFieldKey(tenantId) } }))?.value === false) {
    throw new AppError(message, 409);
  }
}

export async function assertProductCatalogCapacity(tx: Prisma.TransactionClient, tenantId: string) {
  if (await tx.productInterest.count({ where: { tenantId, active: true } }) >= MAX_ACTIVE_PRODUCTS) {
    throw new AppError(`Maximum ${MAX_ACTIVE_PRODUCTS} products.`, 400);
  }
}

export async function getProduct(tenantId: string, input: unknown): Promise<ProductInterest> {
  const product = await repository.findProduct(tenantId, ProductInterestIdSchema.parse(input));
  if (!product) throw new AppError('Product not found.', 404);
  return { ...product, dealValue: Number(product.dealValue), createdAt: product.createdAt.toISOString(), updatedAt: product.updatedAt.toISOString() };
}

const querySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export async function getWonDeals(tenantId: string, input: unknown, query: unknown) {
  const product = await getProduct(tenantId, input);
  const context = tenantContext.getStore();
  if (!context || context.tenantId !== tenantId) throw new AppError('Workspace context required.', 403);
  const { page, limit } = querySchema.parse(query);
  const [deals, total] = await repository.findWonDeals(tenantId, product.id, (page - 1) * limit, limit);
  const sameScope = (row: { tenantId: string } | null) => row?.tenantId === tenantId;
  const name = (row: { firstName: string; lastName: string }) => `${row.firstName} ${row.lastName}`.trim();
  const data: ProductWonDeal[] = deals.map(deal => ({
    id: deal.id, title: deal.title, value: deal.value, currency: deal.currency ?? 'PHP', closedAt: deal.closedAt?.toISOString() ?? null,
    customers: [...new Set([...deal.leadDeals.map(row => row.lead), ...deal.contactDeals.map(row => row.contact)].flatMap(row => row && sameScope(row) ? [name(row)] : []))],
    company: sameScope(deal.organization) ? deal.organization!.name : null,
    assignedAgent: deal.assignedUser?.tenantId === tenantId ? name(deal.assignedUser) : null,
  }));
  return { data, meta: { total, page, limit, hasMore: page * limit < total } };
}
