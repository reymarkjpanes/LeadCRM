import type { Prisma } from '@prisma/client';

/** Reuse the tenant's default pipeline; repair never inserts demo CRM records. */
export async function seedDefaultPipeline(tenantId: string, tx: Prisma.TransactionClient) {
  const existing = await tx.pipeline.findFirst({
    where: { tenantId, isDefault: true, isArchived: false },
  });
  if (existing) return existing;
  return tx.pipeline.create({
    data: {
      tenantId,
      name: 'Sales Pipeline',
      isDefault: true,
      stages: {
        create: [
          { name: 'Lead', order: 1, isDefault: true },
          { name: 'Contacted', order: 2 },
          { name: 'Qualified', order: 3 },
          { name: 'Won', order: 4, isWon: true },
          { name: 'Lost', order: 5, isLost: true },
        ],
      },
    },
  });
}
