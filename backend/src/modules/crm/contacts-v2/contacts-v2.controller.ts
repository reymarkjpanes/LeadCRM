import { Request, Response, NextFunction } from 'express';
import * as service from './contacts-v2.service';

/**
 * Contacts V2 Controller — serves data from the Contact table (formerly Customer).
 * Replaces the backward-compat alias that served Lead data on /crm/contacts.
 */

export async function getContacts(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getContacts(req.user!.tenantId, req.query as Record<string, unknown>);
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
    const contact = await service.createContact(req.user!.tenantId, req.body);
    res.status(201).json({ success: true, data: contact });
  } catch (err) { next(err); }
}

export async function updateContact(req: Request, res: Response, next: NextFunction) {
  try {
    const contact = await service.updateContact(String(req.params.id), req.user!.tenantId, req.body);
    res.json({ success: true, data: contact });
  } catch (err) { next(err); }
}

export async function archiveContact(req: Request, res: Response, next: NextFunction) {
  try {
    await service.archiveContact(String(req.params.id), req.user!.tenantId);
    res.json({ success: true });
  } catch (err) { next(err); }
}
