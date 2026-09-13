import { Request, Response, NextFunction } from 'express';
import * as service from './forms.service';

// ─── Controllers ─────────────────────────────────────────────────────────────
// Each controller:
//   1. Extracts inputs from the request (parsed by validate middleware upstream)
//   2. Delegates all business logic to the service layer
//   3. Returns the response envelope — never touches Prisma directly
// ─────────────────────────────────────────────────────────────────────────────

export async function getForms(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.getForms(
      req.user!.tenantId,
      req.query as Record<string, unknown>,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getFormById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const form = await service.getFormById(
      String(req.params.id),
      req.user!.tenantId,
    );
    res.json({ success: true, data: form });
  } catch (err) {
    next(err);
  }
}

export async function createForm(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // req.body already validated + parsed by validate(CreateFormSchema) middleware
    const form = await service.createForm(
      req.user!.tenantId,
      req.user!.userId,
      req.body,
    );
    res.status(201).json({ success: true, data: form });
  } catch (err) {
    next(err);
  }
}

export async function updateForm(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // req.body already validated + parsed by validate(UpdateFormSchema) middleware
    const form = await service.updateForm(
      String(req.params.id),
      req.user!.tenantId,
      req.user!.userId,
      req.body,
    );
    res.json({ success: true, data: form });
  } catch (err) {
    next(err);
  }
}

export async function publishForm(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const form = await service.publishForm(
      String(req.params.id),
      req.user!.tenantId,
      req.user!.userId,
    );
    res.json({ success: true, data: form });
  } catch (err) {
    next(err);
  }
}

export async function archiveForm(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await service.archiveForm(
      String(req.params.id),
      req.user!.tenantId,
      req.user!.userId,
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
