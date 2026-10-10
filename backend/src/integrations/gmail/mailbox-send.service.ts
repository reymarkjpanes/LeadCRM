import { createHash, randomUUID } from 'node:crypto';
import { SendMailboxEmailSchema } from '@leadcrm/shared';
import { z } from 'zod';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { authorizedMailbox } from './mailbox-store';
import { sendEmail } from './gmail.service';

/** A durable claim covers browser retries and separate backend replicas.
 * Unknown provider outcomes are never automatically sent again. */
export async function sendMailboxEmail(tenantId: string, userId: string, input: z.infer<typeof SendMailboxEmailSchema>) {
  const data = SendMailboxEmailSchema.parse(input);
  const { account } = await authorizedMailbox(tenantId, userId);
  // Existing API clients remain compatible; the shared composer always supplies a stable key.
  const requestId = data.requestId ?? randomUUID();
  const payloadHash = createHash('sha256').update(JSON.stringify([data.to, data.subject, data.body, data.replyToMessageId, data.draftId, data.forwardSourceMessageId])).digest('hex');
  const key = { accountId: account.id, requestId };
  const created = await prisma.mailboxSendReceipt.createMany({ data: [{ ...key, tenantId, payloadHash }], skipDuplicates: true });
  if (!created.count) {
    const previous = await prisma.mailboxSendReceipt.findUniqueOrThrow({ where: { accountId_requestId: key } });
    if (previous.payloadHash !== payloadHash) throw new AppError('This send request belongs to different content. Start a new message.', 409);
    if (previous.status === 'sent' && previous.providerMessageId && previous.providerThreadId) return { messageId: previous.providerMessageId, threadId: previous.providerThreadId };
    if (previous.status !== 'failed' || !(await prisma.mailboxSendReceipt.updateMany({ where: { id: previous.id, status: 'failed' }, data: { status: 'sending' } })).count) {
      throw new AppError('This email is being sent or its delivery needs verification. Check Gmail Sent before starting another send.', 409, 'GMAIL_OUTCOME_UNKNOWN');
    }
  }
  try {
    const result = await sendEmail(tenantId, userId, data.to, data.subject, data.body, data.replyToMessageId, data.draftId, data.forwardSourceMessageId);
    await prisma.mailboxSendReceipt.update({ where: { accountId_requestId: key }, data: { status: 'sent', providerMessageId: result.messageId, providerThreadId: result.threadId } });
    return result;
  } catch (error) {
    const uncertain = !(error instanceof AppError) || error.code === 'GMAIL_OUTCOME_UNKNOWN';
    await prisma.mailboxSendReceipt.updateMany({ where: { ...key, status: 'sending' }, data: { status: uncertain ? 'uncertain' : 'failed' } }).catch(() => undefined);
    throw error;
  }
}
