import { randomUUID, createHash } from 'node:crypto';
import { SendMailboxEmailSchema, SaveMailboxDraftSchema } from '@leadcrm/shared';
import { z } from 'zod';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { authorizedMailbox, mailboxChanged } from './mailbox-store';
import { sendEmail, saveDraft, deleteDraft, assertDraftAccess, getValidAccessToken, ingestConfirmedMailboxSend } from './gmail.service';
import { authorizeMailboxOperation, normalizedRecipients, reserveMailboxOperation, markMailboxOperationAttempt, finishMailboxOperation, failMailboxOperation } from './mailbox-operations';
import { recoverMailboxProviderResult, persistRecoveredDraft, requestMailboxIngestion } from './mailbox-recovery';
import { readGmailJson } from './gmail-read';
import { assertStoredMessages } from './mailbox-scope';
import { resolveDraftOperationContext } from './mailbox-draft-context';
import type { MailboxQuotationContext } from './mailbox-operations';
import type { GeneratedMailboxAttachment } from './gmail.service';

export async function sendMailboxEmail(tenantId: string, userId: string, input: z.infer<typeof SendMailboxEmailSchema>, generated?: { attachments: GeneratedMailboxAttachment[]; quotation: MailboxQuotationContext }) {
  const data = SendMailboxEmailSchema.parse(input);
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  const recipients = normalizedRecipients(Array.isArray(data.to) ? data.to : [data.to]);
  const source = await resolveDraftOperationContext(account, data, { account, scope });
  const context = { recipients, ...source, draftId: data.draftId, ...(generated ? { quotation: generated.quotation } : {}) };
  await authorizeMailboxOperation(account, context);
  const intent = { ...context, subject: data.subject, body: data.body, ...(generated ? { attachments: generated.attachments.map(file => ({ filename: file.filename, mimeType: file.mimeType, sha256: createHash('sha256').update(file.data).digest('hex') })) } : {}) };
  const claim = await reserveMailboxOperation(account, data.requestId, 'send', intent, context);
  if (claim.terminal) {
    if (claim.receipt.status !== 'sent' || !claim.receipt.providerMessageId || !claim.receipt.providerThreadId) throw new AppError('This operation is not a completed send.', 409);
    await ingestConfirmedMailboxSend(account, claim.receipt.providerMessageId, context);
    await authorizeMailboxOperation(account, context);
    return { messageId: claim.receipt.providerMessageId, threadId: claim.receipt.providerThreadId };
  }
  let attempted = false;
  try {
    const result = claim.recover
      ? await recoverMailboxProviderResult(account, claim.receipt, context, 'sent')
      : await sendEmail(tenantId, userId, recipients, data.subject, data.body, source.replyToMessageId, data.draftId, source.forwardSourceMessageId,
        { messageId: claim.receipt.rfcMessageId!, receiptId: claim.receipt.id, attachments: generated?.attachments, quotation: generated?.quotation, beforeProviderWrite: async () => { await markMailboxOperationAttempt(claim); attempted = true; } });
    await finishMailboxOperation(claim, { status: 'sent', providerMessageId: result.messageId, providerThreadId: result.threadId });
    if (claim.recover) await ingestConfirmedMailboxSend(account, result.messageId, context);
    await requestMailboxIngestion(account).catch(() => undefined);
    // Do not disclose a recovered result after a reassignment that occurred during provider I/O.
    await authorizeMailboxOperation(account, context);
    return { messageId: result.messageId, threadId: result.threadId };
  } catch (error) {
    await failMailboxOperation(claim, error, attempted);
    throw error;
  }
}

export async function saveMailboxDraft(tenantId: string, userId: string, input: z.infer<typeof SaveMailboxDraftSchema>) {
  const data = SaveMailboxDraftSchema.parse(input);
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  const recipients = data.to.trim() ? normalizedRecipients(data.to.split(',').map(value => value.trim())) : [];
  const source = await resolveDraftOperationContext(account, data, { account, scope });
  const context = { recipients, ...source, draftId: data.draftId };
  await authorizeMailboxOperation(account, context);
  const claim = await reserveMailboxOperation(account, data.requestId, 'draft', { ...context, subject: data.subject, body: data.body }, context);
  if (claim.terminal) {
    if (claim.receipt.status !== 'saved' || !claim.receipt.providerDraftId || !claim.receipt.providerMessageId) throw new AppError('This operation is not a saved draft.', 409);
    await assertDraftAccess(tenantId, userId, claim.receipt.providerDraftId, claim.receipt.id);
    return { draftId: claim.receipt.providerDraftId, messageId: claim.receipt.providerMessageId };
  }
  let attempted = false;
  try {
    let result: { draftId: string; messageId: string };
    if (claim.recover) {
      const recovered = await recoverMailboxProviderResult(account, claim.receipt, context, 'draft');
      if (!recovered.draftId) throw new AppError('Draft outcome remains unconfirmed.', 409, 'GMAIL_OUTCOME_UNKNOWN');
      await persistRecoveredDraft(account, { ...recovered, draftId: recovered.draftId }, context);
      result = { draftId: recovered.draftId, messageId: recovered.messageId };
    } else {
      result = await saveDraft(tenantId, userId, recipients.join(', '), data.subject, data.body, data.draftId,
        { replyToMessageId: source.replyToMessageId, forwardSourceMessageId: source.forwardSourceMessageId, messageId: claim.receipt.rfcMessageId!, operationReceiptId: claim.receipt.id,
          beforeProviderWrite: async () => { await markMailboxOperationAttempt(claim); attempted = true; } });
    }
    await finishMailboxOperation(claim, { status: 'saved', providerDraftId: result.draftId, providerMessageId: result.messageId });
    await authorizeMailboxOperation(account, context);
    return result;
  } catch (error) {
    await failMailboxOperation(claim, error, attempted);
    throw error;
  }
}

/** Deletion shares the draft claim. An uncertain delete is verified with a read, never raced against send. */
export async function deleteMailboxDraft(tenantId: string, userId: string, draftId: string) {
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  const row = await prisma.mailboxMessage.findFirst({ where: { accountId: account.id, tenantId, draftId } });
  if (!row) throw new AppError('Draft is not available.', 404);
  await assertStoredMessages(account, scope, [row.providerMessageId]);
  const activeDelete = await prisma.mailboxSendReceipt.findFirst({ where: { accountId: account.id, operation: 'delete', targetDraftId: draftId, status: { in: ['reserved', 'sending', 'uncertain'] } } });
  const context = { recipients: row.recipientAddresses, draftId, ...(row.sourceMessageId ? { replyToMessageId: row.sourceMessageId } : {}) };
  const claim = await reserveMailboxOperation(account, activeDelete?.requestId ?? randomUUID(), 'delete', { draftId }, context);
  let attempted = false;
  try {
    if (claim.recover) {
      let absent = false;
      try { await readGmailJson(await getValidAccessToken(tenantId, userId), 'drafts/' + encodeURIComponent(draftId) + '?format=metadata'); }
      catch (error) { if (error instanceof AppError && error.statusCode === 404) absent = true; else throw error; }
      if (!absent) throw new AppError('Draft deletion is unconfirmed. Review Gmail before changing this draft.', 409, 'GMAIL_OUTCOME_UNKNOWN');
      const current = await authorizedMailbox(tenantId, userId);
      await assertStoredMessages(current.account, current.scope, [row.providerMessageId]);
      await prisma.mailboxMessage.updateMany({ where: { accountId: account.id, draftId }, data: { labels: ['DELETED'] } });
      await mailboxChanged(account.id);
    } else await deleteDraft(tenantId, userId, draftId, { receiptId: claim.receipt.id, beforeProviderWrite: async () => { await markMailboxOperationAttempt(claim); attempted = true; } });
    await finishMailboxOperation(claim, { status: 'deleted', providerDraftId: draftId });
  } catch (error) { await failMailboxOperation(claim, error, attempted); throw error; }
}
