import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../../shared/errors/app-error';
import * as service from './tenants.service';
import { ActivateSubscriptionSchema } from './tenants.dto';

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.listTenants() });
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.deactivateTenant(String(req.params.id), req.user!.userId) });
  } catch (err) {
    next(err);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.activateTenant(String(req.params.id), req.user!.userId) });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.createTenant(req.body, req.user!.userId);
    res.status(201).json({
      success: true,
      data: {
        tenant: result.tenant,
        adminUser: result.user,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function activateSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ActivateSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0]?.message ?? 'Invalid input', 400);
    }
    const result = await service.manuallyActivateTenantSubscription(
      String(req.params.id),
      parsed.data.planType,
      req.user!.userId,
    );
    res.json({
      success: true,
      data: {
        message: `Tenant activated to ${result.planType} plan via System Admin bypass`,
        tenantId: result.tenantId,
        planType: result.planType,
      },
    });
  } catch (err) {
    next(err);
  }
}
