import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { buildFinalSms, isValidPhMobile, toE164, SMS_MAX_LENGTH } from '@leadcrm/shared';
import { ValidationError } from '../errors/http-error';
import prisma from '../../config/database.config';
import { tenantContext } from '../../core/tenant/tenant-context';
import { providerRetryAt } from './provider-retry';

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
export async function getSmsSenderIdentity(tenantId: string, db: Prisma.TransactionClient = prisma) {
  if (tenantContext.getStore()?.tenantId !== tenantId) throw new ValidationError('CRM tenant context is required for SMS.');
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, email: true } });
  const parsed = z.string().trim().email().safeParse(tenant?.email);
  return { organizationName: tenant?.name?.trim() || null, organizationEmail: parsed.success ? parsed.data : null };
}
export async function getSmsSenderEmail(tenantId: string, db: Prisma.TransactionClient = prisma): Promise<string | null> {
  return (await getSmsSenderIdentity(tenantId, db)).organizationEmail;
}
export class SmsSubmissionError extends ValidationError {
  constructor(readonly outcome: 'rejected' | 'unconfirmed', readonly httpStatus?: number, readonly retryAfterAt?: number) {
    super(outcome === 'rejected' ? `SMS provider rejected the message${httpStatus ? ` (HTTP ${httpStatus})` : ''}. Check the TextBee API key, enabled Android device, SMS permission and plan allowance.` : 'SMS submission could not be confirmed. Review the provider history before sending again.');
  }
}

async function textBeeRead(path: string) {
  assertSmsConfigured();
  const response = await fetch(`https://api.textbee.dev/api/v1${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'x-api-key': process.env.TEXTBEE_API_KEY!.trim(), Accept: 'application/json' } });
  if (!response.ok) throw new SmsSubmissionError(response.status >= 500 || [408, 429].includes(response.status) ? 'unconfirmed' : 'rejected', response.status);
  return response.json() as Promise<unknown>;
}
/** Resolve the optional provider default once, before the campaign transaction. */
export async function getSmsDeviceId(): Promise<string> {
  assertSmsConfigured();
  if (process.env.TEXTBEE_DEVICE_ID?.trim()) return process.env.TEXTBEE_DEVICE_ID.trim();
  const devices = z.object({ data: z.array(z.object({ _id: z.string().regex(/^[a-f\d]{24}$/i), enabled: z.boolean(), isDefault: z.boolean(), lastHeartbeat: z.string().optional().nullable() })) }).safeParse(await textBeeRead('/gateway/devices'));
  if (!devices.success) throw new SmsSubmissionError('unconfirmed');
  const enabled = devices.data.data.filter(device => device.enabled);
  const device = enabled.find(item => item.isDefault) ?? enabled.sort((a, b) => (b.lastHeartbeat ?? '').localeCompare(a.lastHeartbeat ?? ''))[0];
  if (!device) throw new ValidationError('No enabled TextBee Android gateway is available.');
  return device._id;
}
const providerDate = z.string().datetime({ offset: true }).optional().nullable();
/** Persist our own explanations, never arbitrary provider content or credentials. */
export function smsProviderDiagnostic(errorCode: unknown, errorMessage: unknown) {
  const code = typeof errorCode === 'string' && /^\d{1,5}$/.test(errorCode) ? errorCode : null;
  const message = typeof errorMessage === 'string' ? errorMessage.slice(0, 2000).toLowerCase() : '';
  const explanations: Array<[RegExp, string]> = [
    [/timeout|timed out|no response from device/, 'No status response from the Android device. Check its connection, battery restrictions and TextBee app.'],
    [/no cellular service|no service|signal/, 'The Android device has no cellular service. Check its SIM and signal.'],
    [/permission/, 'SMS permission is unavailable on the Android device. Check TextBee app permissions.'],
    [/quota|allowance|limit exceeded/, 'The provider or device allowance was reached. Check the TextBee plan and Android SMS limits.'],
    [/offline|not connected|push.*fail/, 'The Android gateway could not be reached. Check its connection and TextBee app.'],
  ];
  return { code, message: explanations.find(([pattern]) => pattern.test(message))?.[1] ?? (code ? `Android reported SMS error ${code}. Check the device and provider history.` : null) };
}
export async function getSmsBatch(deviceId: string, batchId: string) {
  if (!/^[a-f\d]{24}$/i.test(deviceId) || !/^[a-f\d]{24}$/i.test(batchId)) throw new ValidationError('Invalid SMS provider identity.');
  const message = z.object({ _id: z.string().min(1), device: z.object({ _id: z.string() }), smsBatch: z.string().optional(), recipient: z.string(), status: z.string().default('unknown'),
    requestedAt: providerDate, dispatchedAt: providerDate, pushReceivedAt: providerDate, sendAttemptedAt: providerDate,
    sentAt: providerDate, deliveredAt: providerDate, failedAt: providerDate, updatedAt: providerDate,
    errorCode: z.unknown().optional(), errorMessage: z.unknown().optional() });
  // Strip message content and other provider fields at this boundary.
  return z.object({ data: z.object({ batch: z.object({ _id: z.string(), recipientCount: z.number().int() }), messages: z.array(message) }) })
    .parse(await textBeeRead(`/gateway/devices/${deviceId}/sms-batch/${batchId}`)).data;
}
const receiptSchema = z.object({ data: z.object({ success: z.literal(true), smsBatchId: z.string().regex(/^[a-f\d]{24}$/i), recipientCount: z.literal(1) }) });
/** Every caller uses the same message formatting and size validation. */
export async function sendSms(recipient: string, content: string, options: { beforeProviderWrite?: () => Promise<void>; deviceId?: string } = {}): Promise<{ submitted: true; messageId: string; status: 'pending' }> {
  assertSmsConfigured();
  const phone = normalizeSmsPhone(recipient);
  const tenantId = tenantContext.getStore()?.tenantId;
  if (!tenantId) throw new ValidationError('CRM tenant context is required for SMS.');
  if (!content.trim()) throw new ValidationError('SMS message content is required.');
  const finalContent = buildFinalSms({ body: content });
  const deviceId = options.deviceId ?? process.env.TEXTBEE_DEVICE_ID?.trim();
  if (deviceId && !/^[a-f\d]{24}$/i.test(deviceId)) throw new ValidationError('Invalid SMS gateway Device ID.');
  if (finalContent.length > SMS_MAX_LENGTH) throw new ValidationError(`SMS exceeds the ${SMS_MAX_LENGTH}-character limit after personalization.`);
  await options.beforeProviderWrite?.();
  let response: Response;
  try {
    response = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', { method: 'POST', signal: AbortSignal.timeout(15000), redirect: 'error',
      headers: { 'x-api-key': process.env.TEXTBEE_API_KEY!.trim(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ recipients: [phone], message: finalContent, ...(deviceId ? { deviceId } : {}) }),
    });
  } catch { throw new SmsSubmissionError('unconfirmed'); }
  if (!response.ok) throw new SmsSubmissionError(response.status >= 500 || response.status === 408 ? 'unconfirmed' : 'rejected', response.status, response.headers ? providerRetryAt(response.headers) : undefined);
  const receipt = receiptSchema.safeParse(await response.json().catch(() => null));
  if (!receipt.success) throw new SmsSubmissionError('unconfirmed');
  // One recipient per batch makes this the authoritative correlation identity.
  return { submitted: true, messageId: receipt.data.data.smsBatchId, status: 'pending' };
}
