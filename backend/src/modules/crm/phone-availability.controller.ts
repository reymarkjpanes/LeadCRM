import type { Request, Response, NextFunction } from 'express';
import { CrmPhoneAvailabilityQuerySchema, CUSTOMER_PHONE_CONFLICT, STAFF_PHONE_CONFLICT, type PhoneAvailability } from '@leadcrm/shared';
import { ZodError } from 'zod';
import prisma from '../../config/database.config';
import { assertInternalCustomerPhone } from './record-validation';
import { assertCrmRecordRead } from './access/crm-record-access.service';
import { NotFoundError } from '../../shared/errors/http-error';

export async function phoneAvailability(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone, module, excludeId } = CrmPhoneAvailabilityQuerySchema.parse(req.query);
    const tenantId = req.user!.tenantId;
    let current;
    if (excludeId) {
      await assertCrmRecordRead(prisma, module, excludeId);
      const query = { where: { tenantId, id: excludeId, isArchived: false, deletedAt: null }, select: { id: true, phone: true } } as const;
      current = await (module === 'leads' ? prisma.lead.findFirst(query) : prisma.contact.findFirst(query));
      if (!current) throw new NotFoundError('Record');
    }
    let data: PhoneAvailability = { available: true };
    try { await assertInternalCustomerPhone(prisma, tenantId, phone, current ? { ...current, module } : undefined); }
    catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const message = error.issues[0]?.message;
      if (message !== STAFF_PHONE_CONFLICT && message !== CUSTOMER_PHONE_CONFLICT) throw error;
      data = { available: false, reason: message === STAFF_PHONE_CONFLICT ? 'STAFF_PHONE_NOT_ALLOWED' : 'CUSTOMER_PHONE_CONFLICT' };
    }
    res.set('Cache-Control', 'no-store').json({ success: true, data });
  } catch (error) { next(error); }
}
