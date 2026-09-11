import { Request, Response, NextFunction } from 'express';
import * as service from './roles.service';
import type { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './roles.dto';

export async function getRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.getRoles(req.user!.tenantId) });
  } catch (err) { next(err); }
}

export async function getRoleById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.getRoleById(String(req.params.id), req.user!.tenantId) });
  } catch (err) { next(err); }
}

export async function createRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await service.createRole(req.user!.tenantId, req.user!.userId, req.body as CreateRoleDto);
    res.status(201).json({ success: true, data: role });
  } catch (err) { next(err); }
}

export async function updateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      success: true,
      data: await service.updateRole(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body as UpdateRoleDto),
    });
  } catch (err) { next(err); }
}

export async function archiveRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.archiveRole(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function assignRoleToUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, roleId } = req.body as AssignRoleDto;
    res.json({ success: true, data: await service.assignRoleToUser(userId, roleId, req.user!.tenantId, req.user!.userId) });
  } catch (err) { next(err); }
}

export async function removeRoleFromUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, roleId } = req.body as AssignRoleDto;
    await service.removeRoleFromUser(userId, roleId, req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getUserPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const targetUserId = String(req.params.id);
    const { userId, tenantId, role } = req.user!;

    const SUPER_ROLES = ['Admin', 'Super User', 'Client Admin', 'System Admin'];
    const isAdmin = SUPER_ROLES.some(r => r.toLowerCase() === (role ?? '').toLowerCase().trim());

    if (!isAdmin && targetUserId !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    const permissions = await service.getUserPermissions(targetUserId, tenantId, role);
    res.json({ success: true, data: permissions });
  } catch (err) { next(err); }
}
