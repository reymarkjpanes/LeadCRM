import prisma from '../../../config/database.config';

export const findProduct = (tenantId: string, id: string) => prisma.productInterest.findFirst({ where: { tenantId, id } });

export function findWonDeals(tenantId: string, id: string, skip: number, take: number) {
  const scope = { tenantId };
  const person = { firstName: true, lastName: true, tenantId: true } as const;
  const where = { ...scope, stage: { ...scope, isWon: true }, OR: [{ productInterestId: id }, { productInterestIds: { has: id } }] };
  return Promise.all([
    prisma.deal.findMany({ where, skip, take, orderBy: [{ closedAt: 'desc' }, { id: 'asc' }], select: {
      id: true, title: true, value: true, currency: true, closedAt: true,
      leadDeals: { where: scope, select: { lead: { select: person } } },
      contactDeals: { where: scope, select: { contact: { select: person } } },
      organization: { select: { name: true, tenantId: true } },
      assignedUser: { select: { firstName: true, lastName: true, tenantId: true } },
    } }),
    prisma.deal.count({ where }),
  ]);
}
