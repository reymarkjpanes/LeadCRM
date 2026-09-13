import { Request, Response, NextFunction } from 'express';
import * as service from './contacts.service';

// Controller — HTTP handlers only. No business logic here.

export async function getContacts(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getContacts(
      req.user!.tenantId,
      req.query as Record<string, unknown>,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getContactById(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id);
    const contact = await service.getContactById(id, req.user!.tenantId);
    res.json({ success: true, data: contact });
  } catch (err) {
    next(err);
  }
}

export async function createContact(req: Request, res: Response, next: NextFunction) {
  try {
    const contact = await service.createContact(
      req.user!.tenantId,
      req.user!.userId,
      req.body,
    );
    res.status(201).json({ success: true, data: contact });
  } catch (err) {
    next(err);
  }
}

export async function updateContact(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id);
    const contact = await service.updateContact(
      id,
      req.user!.tenantId,
      req.user!.userId,
      req.body,
    );
    res.json({ success: true, data: contact });
  } catch (err) {
    next(err);
  }
}

export async function archiveContact(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id);
    await service.archiveContact(id, req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function convertContact(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id);
    const result = await service.convertContact(id, req.user!.tenantId, req.user!.userId, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
