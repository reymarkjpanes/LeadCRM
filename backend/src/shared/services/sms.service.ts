import { ValidationError } from '../errors/http-error';

export function isSmsConfigured(): boolean {
  return !!process.env.BREVO_API_KEY?.trim() && /^[A-Za-z0-9 ]{1,15}$/.test(process.env.BREVO_SMS_SENDER ?? '');
}
export function normalizeSmsPhone(value: unknown): string {
  const number = typeof value === 'string' ? value.replace(/[\s().-]/g, '') : '';
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new ValidationError('A phone number with country code is required for SMS (for example, +639171234567).');
  return number;
}
/** Provider acceptance is recorded; no retry is safe after an uncertain submission. */
export async function sendSms(recipient: string, content: string): Promise<{ submitted: true; messageId: string | null }> {
  if (!isSmsConfigured()) throw new ValidationError('Configure the SMS sender and API key before activating SMS workflows.');
  const phone = normalizeSmsPhone(recipient);
  if (!content.trim() || content.length > 1600) throw new ValidationError('Enter an SMS message from 1 to 1600 characters.');
  let response: Response;
  try {
    response = await fetch('https://api.brevo.com/v3/transactionalSMS/send', { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'api-key': process.env.BREVO_API_KEY!, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: process.env.BREVO_SMS_SENDER, recipient: phone, content, type: 'transactional' }),
    });
  } catch { throw new ValidationError('SMS submission could not be confirmed. Check SMS delivery history before sending again.'); }
  if (!response.ok) throw new ValidationError('SMS provider rejected the message. Check the sender configuration and SMS balance.');
  const receipt: unknown = await response.json().catch(() => null);
  const messageId = receipt && typeof receipt === 'object' && 'messageId' in receipt && ['string', 'number'].includes(typeof receipt.messageId) ? String(receipt.messageId) : null;
  return { submitted: true, messageId };
}
