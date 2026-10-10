import { Request, Response, NextFunction } from "express";
import * as service from "./tasks.service";
import { hasModulePermission, type TaskRecord } from "@leadcrm/shared";
import { findUserEffectivePermissions } from "../../administration/roles/roles.repository";

async function visibleTaskContext(req: Request, tasks: TaskRecord[]): Promise<TaskRecord[]> {
  if (req.user!.role === "Client Admin" || !tasks.some(task => task.relatedRecords?.length)) return tasks;
  const permissions = await findUserEffectivePermissions(req.user!.userId, req.user!.tenantId);
  return tasks.map(task => ({
    ...task,
    relatedRecords: task.relatedRecords?.filter(record =>
      hasModulePermission(permissions, `${record.kind}s`, "canView")),
  }));
}

async function serializeTaskResponse(req: Request, task: Parameters<typeof service.serializeTaskResponse>[0]) {
  return (await visibleTaskContext(req, [await service.serializeTaskResponse(task)]))[0];
}

export async function getTasks(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.getTasks(
      req.user!.tenantId,
      req.query as Record<string, unknown>,
    );
    res.json({ success: true, ...result, data: await visibleTaskContext(req, result.data) });
  } catch (err) {
    next(err);
  }
}

export async function getTaskById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({
      success: true,
      data: await serializeTaskResponse(req,
        await service.getTaskById(String(req.params.id), req.user!.tenantId),
      ),
    });
  } catch (err) {
    next(err);
  }
}

export async function createTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.createTask(
      req.user!.tenantId,
      req.user!.userId,
      req.body,
    );
    res.status(201).json({ success: true, data: await serializeTaskResponse(req, task) });
  } catch (err) {
    next(err);
  }
}

export async function updateTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({
      success: true,
      data: await serializeTaskResponse(req,
        await service.updateTask(
          String(req.params.id),
          req.user!.tenantId,
          req.user!.userId,
          req.body,
        ),
      ),
    });
  } catch (err) {
    next(err);
  }
}

export async function completeTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({
      success: true,
      data: await serializeTaskResponse(req,
        await service.completeTask(
          String(req.params.id),
          req.user!.tenantId,
          req.user!.userId,
        ),
      ),
    });
  } catch (err) {
    next(err);
  }
}

export async function archiveTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await service.archiveTask(
      String(req.params.id),
      req.user!.tenantId,
      req.user!.userId,
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function getSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({
      success: true,
      data: await service.getTaskSummary(
        req.user!.tenantId,
        req.query as Record<string, unknown>,
      ),
    });
  } catch (error) {
    next(error);
  }
}
export async function getOptions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({
      success: true,
      data: await service.getTaskOptions(
        req.user!.tenantId,
        req.query as Record<string, unknown>,
      ),
    });
  } catch (error) {
    next(error);
  }
}
export async function bulkTasks(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({
      success: true,
      data: await service.bulkTasks(
        req.user!.tenantId,
        req.user!.userId,
        req.body,
      ),
    });
  } catch (error) {
    next(error);
  }
}
