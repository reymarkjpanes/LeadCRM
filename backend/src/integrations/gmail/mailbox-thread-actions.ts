import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { authorizedMailbox, mailboxChanged } from './mailbox-store';
import { mailboxAddress, scopedMessagesWhere } from './mailbox-scope';
import { getValidAccessToken } from './gmail.service';
import { writeGmailJson } from './gmail-read';
import { Prisma } from '@prisma/client';
import { correspondentCte, mailboxReadQuery } from './mailbox-conversations';
import { assertStoredMessages } from './mailbox-scope';

type Action = 'read' | 'unread' | 'archive' | 'trash';

/** Group toolbar/bulk actions cover all currently authorized non-draft messages
 * across its topics. No provider thread-wide mutation is ever issued. */
export async function mutateMailboxCorrespondents(tenantId: string, userId: string, conversationIds: string[], action: Action) {
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  const rows = await mailboxReadQuery<{ conversationId: string; providerMessageId: string }[]>(account, Prisma.sql`
    WITH ${correspondentCte(account, scope)} SELECT "conversationId", "providerMessageId" FROM eligible
    WHERE "conversationId" IN (${Prisma.join(conversationIds)}) LIMIT 1001`);
  if (rows.length > 1000) throw new AppError('This selection exceeds 1,000 messages. Open a topic and act on that Gmail conversation.', 400);
  if (new Set(rows.map(row => row.conversationId)).size !== new Set(conversationIds).size) throw new AppError('Conversation is no longer available in your assigned CRM mailbox scope.', 404);
  return mutateMailboxMessages(tenantId, userId, rows.map(row => row.providerMessageId), action);
}

export async function mutateMailboxMessages(tenantId: string, userId: string, messageIds: string[], action: Action) {
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  await assertStoredMessages(account, scope, messageIds, true);
  const rows = await prisma.mailboxMessage.findMany({ where: { AND: [scopedMessagesWhere(account, scope), { providerMessageId: { in: messageIds }, NOT: { labels: { has: 'DRAFT' } } }] }, select: { id: true, providerMessageId: true, labels: true, fromAddress: true } });
  return applyMessageAction(tenantId, userId, account.id, account.email, rows, action);
}

/** Resolve message IDs server-side. Never mutate the provider thread wholesale:
 * it can also contain drafts or correspondence outside current CRM scope. */
export async function mutateMailboxThread(tenantId: string, userId: string, threadId: string, action: 'read' | 'unread' | 'archive' | 'trash') {
  return mutateMailboxThreads(tenantId, userId, [threadId], action);
}

export async function mutateMailboxThreads(tenantId: string, userId: string, threadIds: string[], action: 'read' | 'unread' | 'archive' | 'trash') {
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  const rows = await prisma.mailboxMessage.findMany({ where: { AND: [scopedMessagesWhere(account, scope), { threadId: { in: threadIds }, NOT: { labels: { has: 'DRAFT' } } }] }, select: { id: true, threadId: true, providerMessageId: true, labels: true, fromAddress: true } });
  if (new Set(rows.map(row => row.threadId)).size !== new Set(threadIds).size) throw new AppError('Conversation is no longer available in your assigned CRM mailbox scope.', 404);
  return applyMessageAction(tenantId, userId, account.id, account.email, rows, action);
}

async function applyMessageAction(tenantId: string, userId: string, accountId: string, mailbox: string, rows: { id: string; providerMessageId: string; labels: string[]; fromAddress: string }[], action: Action) {
  // Trash outbound replies before their approved fixed-sender source disappears
  // from scope. Current authorization is still rechecked before every write.
  const changed = rows.filter(row => action === 'read' ? row.labels.includes('UNREAD') : action === 'unread' ? !row.labels.includes('UNREAD') : action === 'archive' ? row.labels.includes('INBOX') : true)
    .sort((a, b) => Number(b.fromAddress === mailboxAddress(mailbox)) - Number(a.fromAddress === mailboxAddress(mailbox)) || a.providerMessageId.localeCompare(b.providerMessageId));
  if (!changed.length) return { success: true, count: 0 };
  const token = await getValidAccessToken(tenantId, userId);
  let count = 0;
  try {
    for (const row of changed) {
      // Reassignment/revocation during a long bulk operation stops later writes.
      const current = await authorizedMailbox(tenantId, userId);
      if (current.account.id !== accountId) throw new AppError('Mailbox changed. Refresh your Inbox.', 409);
      await assertStoredMessages(current.account, current.scope, [row.providerMessageId], true);
      const removeLabelIds = action === 'read' ? ['UNREAD'] : action === 'archive' ? ['INBOX'] : [];
      const addLabelIds = action === 'unread' ? ['UNREAD'] : action === 'trash' ? ['TRASH'] : [];
      await writeGmailJson(token, `messages/${encodeURIComponent(row.providerMessageId)}/${action === 'trash' ? 'trash' : 'modify'}`, 'POST', action === 'trash' ? undefined : { removeLabelIds, addLabelIds });
      // Commit only after provider success, without creating/changing CRM activities.
      await prisma.mailboxMessage.update({ where: { id: row.id }, data: { labels: [...new Set([...row.labels.filter(label => !removeLabelIds.includes(label)), ...addLabelIds])] } });
      count++;
    }
  } finally {
    // Successful partial progress must also reach other tabs if a later write fails.
    if (count) await mailboxChanged(accountId);
  }
  return { success: true, count };
}
