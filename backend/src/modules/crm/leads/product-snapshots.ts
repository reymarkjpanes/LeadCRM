import { z } from 'zod';
import { ProductInterestSchema } from '@leadcrm/shared';
import type { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';

/** Contact/Account/standalone Deal names are historical snapshots; new choices must come from the catalog. */
export async function validateProductSnapshots(tenantId: string, input: unknown, previous: string[] = [], db: Prisma.TransactionClient = prisma) {
  if (input === undefined) return;
  const names = z.array(ProductInterestSchema.shape.name).max(100).parse(input);
  const added = [...new Set(names.filter(name => !previous.includes(name)))];
  const products = await db.productInterest.findMany({ where: { tenantId, active: true, name: { in: added } } });
  if (products.length !== added.length) throw new ValidationError('Select available Product Interests from the product catalog.');
  return [...new Set(names)];
}

/** Clearing or replacing Others also clears its dependent free-text explanation. */
export function normalizeProductOther(data: Record<string, unknown>, names: string[], previous: string | null = null) {
  const others = names.some(name => name.trim().toLowerCase() === 'others');
  if (!others && data.productInterestOther) throw new ValidationError('Select Others before specifying another product interest.');
  data.productInterestOther = others ? (data.productInterestOther === undefined ? previous : data.productInterestOther) : null;
}
