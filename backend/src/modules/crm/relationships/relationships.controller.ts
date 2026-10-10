import { assertPermissions } from '../../../core/permissions/permission.service';
import { AppError } from '../../../shared/errors/app-error';
import { Request, Response, NextFunction } from 'express';
import * as relationshipsService from './relationships.service';

async function mayReadTasks(req: Request): Promise<boolean> {
  try { await assertPermissions(req.user!, ['tasks.view']); return true; }
  catch (error) { if (error instanceof AppError && error.statusCode === 403) return false; throw error; }
}

/**
 * GET /api/v1/crm/leads/:id/relationships
 */
export async function getLeadRelationships(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const tenantId = req.user!.tenantId;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

    const data = await relationshipsService.getLeadRelationships(id, tenantId, limit, await mayReadTasks(req));
    res.json({ success: true, data: await filterRelationships(req, data) });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/crm/contacts/:id/relationships
 */
export async function getContactRelationships(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const tenantId = req.user!.tenantId;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

    const data = await relationshipsService.getContactRelationships(id, tenantId, limit, await mayReadTasks(req));
    res.json({ success: true, data: await filterRelationships(req, data) });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/crm/accounts/:id/relationships
 */
export async function getAccountRelationships(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const tenantId = req.user!.tenantId;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

    const data = await relationshipsService.getAccountRelationships(id, tenantId, limit);
    res.json({ success: true, data: await filterRelationships(req, data) });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/crm/deals/:id/relationships
 */
export async function getDealRelationships(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const tenantId = req.user!.tenantId;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

    const data = await relationshipsService.getDealRelationships(id, tenantId, limit, await mayReadTasks(req));
    res.json({ success: true, data: await filterRelationships(req, data) });
  } catch (err) {
    next(err);
  }
}

async function filterRelationships(req: Request, data: object) {
  const result = { ...data } as Record<string, unknown>;
  const modules = { contact: 'contacts', contacts: 'contacts', account: 'accounts', leads: 'leads', sourceLead: 'leads', deals: 'deals', tasks: 'tasks' } as const;
  for (const [key, module] of Object.entries(modules)) {
    if (!(key in result)) continue;
    try { await assertPermissions(req.user!, [`${module}.view`]); }
    catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; result[key] = Array.isArray(result[key]) ? [] : null; }
  }
  return result;
}
