import { ProductInterestIdSchema, type ProductInterest, type ProductWonDeal } from '@leadcrm/shared';
import { z } from 'zod';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';
import * as repository from './product-interests.repository';

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
    customers: [...new Set([deal.lead, deal.contact, ...deal.leadDeals.map(row => row.lead), ...deal.contactDeals.map(row => row.contact)].flatMap(row => row && sameScope(row) ? [name(row)] : []))],
    company: sameScope(deal.organization) ? deal.organization!.name : null,
    assignedAgent: deal.assignedUser?.tenantId === tenantId ? name(deal.assignedUser) : null,
  }));
  return { data, meta: { total, page, limit, hasMore: page * limit < total } };
}
