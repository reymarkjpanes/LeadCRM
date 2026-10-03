import type { Request, Response, NextFunction } from 'express';
import { ProductInterestSchema, ProductInterestPatchSchema, ProductInterestIdSchema } from '@leadcrm/shared';
import { productConfiguration, salesTransaction } from '../../crm/leads/lead-automation.service';
import { AppError } from '../../../shared/errors/app-error';
import { writeAuditLog } from '../../../core/audit/audit.service';
import * as service from './product-interests.service';

export async function detail(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await service.getProduct(req.user!.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}
export async function wonDeals(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...await service.getWonDeals(req.user!.tenantId, req.params.id, req.query) }); }
  catch (error) { next(error); }
}

const fieldKey = (tenantId: string) => ({ tenantId, module: 'product-interests', key: 'enabled' });
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user!.tenantId;
    const result = await salesTransaction(async tx => ({
      data: await productConfiguration(tx, tenantId),
      meta: { enabled: (await tx.tenantPreference.findUnique({ where: { tenantId_module_key: fieldKey(tenantId) } }))?.value !== false },
    }));
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

async function mutate(req: Request, res: Response, next: NextFunction, action: 'create' | 'update' | 'remove' | 'removeField' | 'enableField') {
  try {
    const tenantId = req.user!.tenantId;
    const id = ['update', 'remove'].includes(action) ? ProductInterestIdSchema.parse(req.params.id) : undefined;
    const input = action === 'create' ? ProductInterestSchema.parse(req.body) : action === 'update' ? ProductInterestPatchSchema.parse(req.body) : undefined;
    const result = await salesTransaction(async tx => {
      if (id && !await tx.productInterest.findFirst({ where: { id, tenantId, active: true } })) throw new AppError('Product not found.', 404);
      if (input?.name && await tx.productInterest.findFirst({ where: { tenantId, active: true, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } })) throw new AppError('Product names must be unique.', 409);
      if (action === 'create') {
        if ((await tx.tenantPreference.findUnique({ where: { tenantId_module_key: fieldKey(tenantId) } }))?.value === false) throw new AppError('Add the Product Interest field first.', 409);
        if (await tx.productInterest.count({ where: { tenantId, active: true } }) >= 100) throw new AppError('Maximum 100 products.', 400);
        await tx.productInterest.create({ data: { tenantId, ...ProductInterestSchema.parse(input) } });
      }
      if (action === 'update') await tx.productInterest.update({ where: { id, tenantId }, data: input! });
      if (action === 'remove') await tx.productInterest.update({ where: { id, tenantId }, data: { active: false } });
      if (action === 'removeField' || action === 'enableField') {
        if (action === 'removeField') await tx.productInterest.updateMany({ where: { tenantId, active: true }, data: { active: false } });
        const key = fieldKey(tenantId), value = action === 'enableField';
        await tx.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value }, update: { value } });
      }
      return { data: await productConfiguration(tx, tenantId),
        meta: { enabled: (await tx.tenantPreference.findUnique({ where: { tenantId_module_key: fieldKey(tenantId) } }))?.value !== false } };
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
