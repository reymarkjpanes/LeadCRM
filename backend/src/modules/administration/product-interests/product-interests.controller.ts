import type { Request, Response, NextFunction } from 'express';
import { ProductCategoryMutationSchema, ProductInterestCreateSchema, ProductInterestPatchSchema, ProductInterestIdSchema } from '@leadcrm/shared';
import { productConfiguration, salesTransaction } from '../../crm/leads/lead-automation.service';
import { AppError } from '../../../shared/errors/app-error';
import { writeAuditLog } from '../../../core/audit/audit.service';
import * as service from './product-interests.service';
import { Prisma } from '@prisma/client';

export async function detail(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await service.getProduct(req.user!.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}
export async function wonDeals(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...await service.getWonDeals(req.user!.tenantId, req.params.id, req.query) }); }
  catch (error) { next(error); }
}

const fieldKey = service.productFieldKey;
const categories = service.productCategories;
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user!.tenantId;
    const result = await salesTransaction(async tx => ({
      data: await productConfiguration(tx, tenantId),
      meta: { categories: await categories(tx, tenantId), enabled: (await tx.tenantPreference.findUnique({ where: { tenantId_module_key: fieldKey(tenantId) } }))?.value !== false },
    }));
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

export async function manageCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user!.tenantId;
    const input = ProductCategoryMutationSchema.parse(req.body);
    const result = await salesTransaction(async tx => {
      const before = await categories(tx, tenantId);
      await service.mutateProductCategory(tx, tenantId, input);
      const after = await categories(tx, tenantId);
      await writeAuditLog({ tenantId, userId: req.user!.userId, action: 'product_categories.' + input.action, entityType: 'TenantPreference', entityId: tenantId, before: { categories: before }, after: { categories: after } });
      return { data: await productConfiguration(tx, tenantId), meta: { categories: after, enabled: (await tx.tenantPreference.findUnique({ where: { tenantId_module_key: fieldKey(tenantId) } }))?.value !== false } };
    });
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

async function mutate(req: Request, res: Response, next: NextFunction, action: 'create' | 'update' | 'remove' | 'removeField' | 'enableField') {
  try {
    const tenantId = req.user!.tenantId;
    const id = ['update', 'remove'].includes(action) ? ProductInterestIdSchema.parse(req.params.id) : undefined;
    const input = action === 'create' ? ProductInterestCreateSchema.parse(req.body) : action === 'update' ? ProductInterestPatchSchema.parse(req.body) : undefined;
    const result = await salesTransaction(async tx => {
      const existing = id ? await tx.productInterest.findFirst({ where: { id, tenantId, active: true } }) : null;
      if (id && !existing) throw new AppError('Product not found.', 404);
      const resolvedCategory = input ? await service.resolveProductCategory(tx, tenantId, input.category ?? existing?.category ?? '') : undefined;
      const category = input?.category !== undefined ? resolvedCategory : undefined;
      if (input?.name && await tx.productInterest.findFirst({ where: { tenantId, active: true, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } })) throw new AppError('Product names must be unique.', 409);
      if (action === 'create') {
        await service.assertProductCatalogEnabled(tx, tenantId);
        await service.assertProductCatalogCapacity(tx, tenantId);
        await tx.productInterest.create({ data: { tenantId, ...ProductInterestCreateSchema.parse(input), category } });
      }
      if (action === 'update') {
        const updated = await tx.productInterest.update({ where: { id, tenantId }, data: {
          ...input!, category, ...(input!.dealValue === undefined ? {} : { dealValue: new Prisma.Decimal(input!.dealValue.toFixed(2)) }),
        } });
        if (input!.dealValue !== undefined && !updated.dealValue.equals(input!.dealValue)) throw new AppError('Product value was not saved. Retry the update.', 409);
      }
      if (action === 'remove') await tx.productInterest.update({ where: { id, tenantId }, data: { active: false } });
      if (action === 'removeField' || action === 'enableField') {
        if (action === 'removeField') await tx.productInterest.updateMany({ where: { tenantId, active: true }, data: { active: false } });
        const key = fieldKey(tenantId), value = action === 'enableField';
        await tx.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value }, update: { value } });
      }
      return { data: await productConfiguration(tx, tenantId),
        meta: { categories: await categories(tx, tenantId), enabled: (await tx.tenantPreference.findUnique({ where: { tenantId_module_key: fieldKey(tenantId) } }))?.value !== false } };
    });
    await writeAuditLog({ tenantId, userId: req.user!.userId, action: 'product_interests.' + action, entityType: 'ProductInterest', entityId: id ?? tenantId, after: input });
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}
export const create = (req: Request, res: Response, next: NextFunction) => mutate(req, res, next, 'create');
export const update = (req: Request, res: Response, next: NextFunction) => mutate(req, res, next, 'update');
export const remove = (req: Request, res: Response, next: NextFunction) => mutate(req, res, next, 'remove');
export const removeField = (req: Request, res: Response, next: NextFunction) => mutate(req, res, next, 'removeField');
export const enableField = (req: Request, res: Response, next: NextFunction) => mutate(req, res, next, 'enableField');
