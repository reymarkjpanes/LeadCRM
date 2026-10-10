import { assertPermissions } from '../../../core/permissions/permission.service';
import { AppError } from '../../../shared/errors/app-error';
﻿import { Request, Response, NextFunction } from 'express';
import * as service from './workflows.service';
export async function getWorkflowNameAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.getWorkflowNameAvailability(req.user!.tenantId, req.query.name, req.query.excludeId) }); }
  catch (err) { next(err); }
}
export async function getOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.getOptions(req.user!.tenantId, req.user!.userId) }); }
  catch (err) { next(err); }
}

export async function validateDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.validateDraft(req.user!.tenantId, req.user!.userId, req.body) }); }
  catch (err) { next(err); }
}
export async function getExecution(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.getExecution(String(req.params.executionId), String(req.params.id), req.user!.tenantId) }); }
  catch (err) { next(err); }
}

export async function getWorkflows(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, ...await presentWorkflows(req, await service.getWorkflows(req.user!.tenantId, req.query as Record<string, unknown>)) });
  } catch (err) { next(err); }
}

export async function getWorkflowById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await presentWorkflow(req, await service.getWorkflowById(String(req.params.id), req.user!.tenantId)) });
  } catch (err) { next(err); }
}

export async function createWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const w = await service.createWorkflow(req.user!.tenantId, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: w });
  } catch (err) { next(err); }
}

export async function updateWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await presentWorkflow(req, await service.updateWorkflow(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body)) });
  } catch (err) { next(err); }
}

export async function toggleWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await presentWorkflow(req, await service.toggleWorkflow(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body.isActive)) });
  } catch (err) { next(err); }
}

export async function archiveWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.archiveWorkflow(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getWorkflowExecutions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedPage = Number(req.query.page);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 25;
    res.json({ success: true, ...await service.getWorkflowExecutionPage(String(req.params.id), req.user!.tenantId, page, limit) });
  } catch (err) { next(err); }
}

export async function testWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const workflow = await service.getWorkflowById(String(req.params.id), req.user!.tenantId);
    if (/^(lead|contact)\./.test(workflow.trigger) && Array.isArray(workflow.actions) && workflow.actions.some(action =>
      action && typeof action === 'object' && !Array.isArray(action) && action.type === 'move_deal_stage' && action.enabled !== false)) {
      await assertPermissions(req.user!, [workflow.trigger.startsWith('lead.') ? 'leads.view' : 'contacts.view', 'deals.view', 'deals.edit']);
    }
    res.json({ success: true, data: await service.testWorkflow(String(req.params.id), req.user!.tenantId, req.body.entityId, req.user!.userId) });
  } catch (err) { next(err); }
}

export async function duplicateWorkflow(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, data: await service.duplicateWorkflow(String(req.params.id), req.user!.tenantId, req.user!.userId) }); } catch (error) { next(error); }
}

async function presentWorkflow<T extends object>(req: Request, workflow: T): Promise<T> {
  try { await assertPermissions(req.user!, ['workflows.view_runs']); return workflow; }
  catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; }
  const result = { ...workflow } as Record<string, unknown>;
  for (const key of ['totalRuns','successfulRuns','failedRuns','lastRunAt','executions','_count']) delete result[key];
  return result as T;
}
async function presentWorkflows<T extends { data: object[] }>(req: Request, page: T): Promise<T> {
  return { ...page, data: await Promise.all(page.data.map(row => presentWorkflow(req, row))) };
}
