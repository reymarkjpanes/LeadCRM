import type { MailboxAttachment } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { authorizedMailbox } from './mailbox-store';
import { assertStoredMessages } from './mailbox-scope';
import { getValidAccessToken } from './gmail.service';
import { readGmailJson } from './gmail-read';

export async function readMailboxAttachment(tenantId: string, userId: string, messageId: string, attachmentId: string) {
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  await assertStoredMessages(account, scope, [messageId], true);
  const row = await prisma.mailboxMessage.findUniqueOrThrow({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: messageId } }, select: { attachments: true } });
  const attachment = (Array.isArray(row.attachments) ? row.attachments as unknown as MailboxAttachment[] : []).find(file => file.id === attachmentId);
  if (!attachment) throw new AppError('Attachment is not available for this message.', 404);
  const maximum = 35 * 1024 * 1024;
  if (attachment.size > maximum) throw new AppError('This attachment exceeds the download limit.', 413);
  const result = await readGmailJson<{ data: string; size: number }>(await getValidAccessToken(tenantId, userId), `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  if (typeof result.data !== 'string' || !/^[a-zA-Z0-9_-]*={0,2}$/.test(result.data) || result.data.length > Math.ceil(maximum * 4 / 3) + 4) throw new AppError('Gmail returned an invalid attachment.', 502);
  const data = Buffer.from(result.data, 'base64url');
  if (data.length > maximum || data.length !== result.size) throw new AppError('Gmail returned an incomplete attachment.', 502);
  // Recheck after the network request so a reassignment during download revokes it.
  const current = await authorizedMailbox(tenantId, userId);
  if (current.account.id !== account.id) throw new AppError('Mailbox changed during download.', 409);
  await assertStoredMessages(current.account, current.scope, [messageId], true);
  return { data, filename: attachment.filename };
}
