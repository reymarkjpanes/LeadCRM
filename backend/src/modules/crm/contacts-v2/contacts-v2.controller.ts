import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from './contacts-v2.service';

/**
 * Contacts V2 Controller — serves data from the Contact table (formerly Customer).
 * Replaces the backward-compat alias that served Lead data on /crm/contacts.
 */

export async function getContacts(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getContacts(req.user!.tenantId, { ...req.query, currentUserId: req.user!.userId });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function getContactById(req: Request, res: Response, next: NextFunction) {
  try {
    const contact = await service.getContactById(String(req.params.id), req.user!.tenantId);
    res.json({ success: true, data: contact });
  } catch (err) { next(err); }
}

export async function createContact(req: Request, res: Response, next: NextFunction) {
  try {
    const contact = await service.createContact(req.user!.tenantId, req.body, req.user!.userId);
    res.status(201).json({ success: true, data: contact });
  } catch (err) { next(err); }
}

export async function updateContact(req: Request, res: Response, next: NextFunction) {
  try {
    const contact = await service.updateContact(String(req.params.id), req.user!.tenantId, req.body, req.user!.userId);
    res.json({ success: true, data: contact });
  } catch (err) { next(err); }
}

export async function archiveContact(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await service.archiveContact(id, req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function restoreContact(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await service.restoreContact(id, req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}
