import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { buildFinalSms, isValidPhMobile, toE164, SMS_MAX_LENGTH } from '@leadcrm/shared';
import { ValidationError } from '../errors/http-error';
import prisma from '../../config/database.config';
import { tenantContext } from '../../core/tenant/tenant-context';

export function isSmsConfigured(): boolean {
  return !!process.env.TEXTBEE_API_KEY?.trim() && (!process.env.TEXTBEE_DEVICE_ID?.trim() || /^[a-f\d]{24}$/i.test(process.env.TEXTBEE_DEVICE_ID.trim()));
}
export function assertSmsConfigured() {
  if (!isSmsConfigured()) throw new ValidationError('Configure the TextBee API key and a valid optional Device ID before sending SMS. Keep an enabled Android gateway with an active SIM online.');
}
export function normalizeSmsPhone(value: unknown): string {
  let number = typeof value === 'string' ? value.trim().replace(/[\s().-]/g, '') : '';
  const local = number.startsWith('0') ? number.slice(1) : number;
  if (isValidPhMobile(local)) number = toE164(local);
  if (!/^\+[1-9]\d{7,14}$/.test(number) || (number.startsWith('+63') && !isValidPhMobile(number.slice(3)))) {
    throw new ValidationError('A valid phone number with country code is required for SMS (for example, +639171234567).');
  }
  return number;
}
export async function getSmsSenderEmail(tenantId: string, db: Prisma.TransactionClient = prisma): Promise<string | null> {
  if (tenantContext.getStore()?.tenantId !== tenantId) throw new ValidationError('CRM tenant context is required for SMS.');
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { email: true } });
  const parsed = z.string().trim().email().safeParse(tenant?.email);
  return parsed.success ? parsed.data : null;
}
export class SmsSubmissionError extends ValidationError {
  constructor(readonly outcome: 'rejected' | 'unconfirmed', readonly httpStatus?: number) {
    super(outcome === 'rejected' ? `SMS provider rejected the message${httpStatus ? ` (HTTP ${httpStatus})` : ''}. Check the TextBee API key, enabled Android device, SMS permission and plan allowance.` : 'SMS submission could not be confirmed. Review the provider history before sending again.');
  }
}
const receiptSchema = z.object({ data: z.object({ success: z.literal(true), smsBatchId: z.string().regex(/^[a-f\d]{24}$/i), recipientCount: z.literal(1) }) });
/** Every caller, including Workflows, gets the shared Camxian contact footer. */
export async function sendSms(recipient: string, content: string): Promise<{ submitted: true; messageId: string; status: 'pending' }> {
  assertSmsConfigured();
  const phone = normalizeSmsPhone(recipient);
  const tenantId = tenantContext.getStore()?.tenantId;
  if (!tenantId) throw new ValidationError('CRM tenant context is required for SMS.');
  if (!content.trim()) throw new ValidationError('SMS message content is required.');
  const finalContent = buildFinalSms({ body: content });
  if (finalContent.length > SMS_MAX_LENGTH) throw new ValidationError(`SMS exceeds the ${SMS_MAX_LENGTH}-character limit including the contact footer.`);
  let response: Response;
  try {
    response = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', { method: 'POST', signal: AbortSignal.timeout(15000), redirect: 'error',
      headers: { 'x-api-key': process.env.TEXTBEE_API_KEY!.trim(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ recipients: [phone], message: finalContent, ...(process.env.TEXTBEE_DEVICE_ID?.trim() ? { deviceId: process.env.TEXTBEE_DEVICE_ID.trim() } : {}) }),
    });
  } catch { throw new SmsSubmissionError('unconfirmed'); }
  if (!response.ok) throw new SmsSubmissionError(response.status >= 500 || response.status === 408 ? 'unconfirmed' : 'rejected', response.status);
  const receipt = receiptSchema.safeParse(await response.json().catch(() => null));
  if (!receipt.success) throw new SmsSubmissionError('unconfirmed');
  // One recipient per batch makes this the authoritative correlation identity.
  return { submitted: true, messageId: receipt.data.data.smsBatchId, status: 'pending' };
}
