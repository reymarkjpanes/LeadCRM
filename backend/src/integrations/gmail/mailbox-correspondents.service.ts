import { Prisma } from '@prisma/client';
import { MailboxConversationDetail, MailboxConversationPageSchema } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { authorizedMailbox, storedEmail } from './mailbox-store';
import { conversationContext, correspondentCte, mailboxReadQuery } from './mailbox-conversations';
import { decorateEmails } from './mailbox-sync.service';
import { scopedMessagesWhere } from './mailbox-scope';
import { customerDealWhere, CustomerLink } from '../../modules/crm/engagement.service';

type DetailRow = { id: string; threadId: string; providerMessageId: string; sentAt: Date; threadStart: Date;
  messageCount: number; leadIds: string[]; contactIds: string[] };

/** Thread blocks are ordered by first authorized activity, then provider ID;
 * messages inside each block are oldest first. Cursor pages can split a block. */
export async function readMailboxCorrespondent(tenantId: string, userId: string, conversationId: string, input: unknown) : Promise<MailboxConversationDetail> {
  const options = MailboxConversationPageSchema.parse(input);
  const { account, scope, permissions } = await authorizedMailbox(tenantId, userId);
  const context = conversationContext(account, scope, ['detail', conversationId]);
  let cursor: { context: string; threadStart: string; threadId: string; date: string; id: string } | undefined;
  if (options.pageToken) {
    try {
      cursor = JSON.parse(Buffer.from(options.pageToken, 'base64url').toString('utf8'));
      if (!cursor || !Number.isFinite(Date.parse(cursor.threadStart)) || !Number.isFinite(Date.parse(cursor.date)) ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(cursor.threadId) || !/^[a-zA-Z0-9_-]{1,200}$/.test(cursor.id)) throw new Error();
    } catch { throw new AppError('Invalid conversation history page.', 400); }
    if (cursor.context !== context) throw new AppError('Conversation changed. Reload its history.', 400, 'MAILBOX_PAGE_CHANGED');
  }
  const after = cursor ? Prisma.sql`(t."threadStart", e."threadId", e."sentAt", e."providerMessageId") >
    ((${cursor.threadStart}::timestamptz AT TIME ZONE 'UTC'), ${cursor.threadId}, (${cursor.date}::timestamptz AT TIME ZONE 'UTC'), ${cursor.id})` : Prisma.sql`TRUE`;
  const rows = await mailboxReadQuery<DetailRow[]>(account, Prisma.sql`
    WITH ${correspondentCte(account, scope)}, history AS (
      SELECT * FROM eligible WHERE "conversationId" = ${conversationId}
    ), topics AS (
      SELECT "threadId", min("sentAt") AS "threadStart",
        array_remove(array_agg(DISTINCT "leadId"), NULL) AS "leadIds",
        array_remove(array_agg(DISTINCT "contactId"), NULL) AS "contactIds" FROM history GROUP BY "threadId"
    )
    SELECT e.id, e."threadId", e."providerMessageId", e."sentAt", t.*, (SELECT count(*)::int FROM history) AS "messageCount"
    FROM history e JOIN topics t ON t."threadId" = e."threadId" WHERE ${after}
    ORDER BY t."threadStart", e."threadId", e."sentAt", e."providerMessageId" LIMIT ${options.maxResults + 1}`);
  if (!rows.length) throw new AppError('Conversation is outside your assigned CRM mailbox scope.', 404);
  const page = rows.slice(0, options.maxResults);
  // Recheck ORM scope before materializing bodies; no provider reads or N+1 queries.
  const saved = await prisma.mailboxMessage.findMany({ where: { AND: [scopedMessagesWhere(account, scope), { id: { in: page.map(row => row.id) } }] } });
  if (saved.length !== page.length) throw new AppError('Mailbox assignments changed. Refresh your Inbox.', 409, 'MAILBOX_SCOPE_CHANGED');
  const byId = new Map(saved.map(row => [row.id, row]));
  const emails = await decorateEmails(tenantId, userId, page.map(row => storedEmail(byId.get(row.id)!)), permissions, scope.hash);
  const topics = [...new Map(page.map(row => [row.threadId, row])).values()];
  const links = new Map<string, CustomerLink>();
  for (const topic of topics) {
    const leads = topic.leadIds.filter(id => scope.leadIds.includes(id)), contacts = topic.contactIds.filter(id => scope.contactIds.includes(id));
    if (leads.length + contacts.length === 1) links.set(topic.threadId, leads.length ? { leadId: leads[0] } : { contactId: contacts[0] });
  }
  const messageLinks = emails.flatMap<CustomerLink>(email => email.leadId ? [{ leadId: email.leadId }] : email.contactId ? [{ contactId: email.contactId }] : []);
  const allLinks = [...new Map([...links.values(), ...messageLinks].map(link => [link.leadId ?? link.contactId, link])).values()];
  const deals = permissions.dealsView && allLinks.length ? await prisma.deal.findMany({
    where: { tenantId, OR: allLinks.map(link => customerDealWhere(tenantId, link)) },
    select: { id: true, title: true, stage: { select: { name: true, isWon: true, isLost: true } },
      leadDeals: { select: { leadId: true } }, contactDeals: { select: { contactId: true } } },
  }) : [];
  const belongs = (deal: typeof deals[number], link: CustomerLink) => link.leadId ? deal.leadDeals.some(item => item.leadId === link.leadId) : deal.contactDeals.some(item => item.contactId === link.contactId);
  const associations = permissions.dealsView ? await prisma.mailboxThreadAssociation.findMany({ where: { tenantId, accountId: account.id, threadId: { in: topics.map(row => row.threadId) } } }) : [];
  for (const email of emails) {
    const link: CustomerLink | undefined = email.leadId ? { leadId: email.leadId } : email.contactId ? { contactId: email.contactId } : undefined;
    if (email.dealId && (!link || !deals.some(deal => deal.id === email.dealId && belongs(deal, link)))) email.dealId = undefined;
    const association = associations.find(row => row.threadId === email.threadId);
    if (link && !email.dealId && association && deals.some(deal => deal.id === association.dealId && belongs(deal, link))) {
      email.dealId = association.dealId; email.needsDealAssociation = false;
    }
  }
  const current = await authorizedMailbox(tenantId, userId);
  if (current.account.id !== account.id || current.scope.hash !== scope.hash) throw new AppError('Mailbox assignments changed. Refresh your Inbox.', 409, 'MAILBOX_SCOPE_CHANGED');
  const last = page[page.length - 1];
  return { emails, messageCount: rows[0].messageCount,
    threads: topics.map(topic => {
      const link = links.get(topic.threadId);
      return { threadId: topic.threadId, canAssociateDeal: !!link && permissions.dealsEdit && permissions.dealsView,
        dealOptions: link ? deals.filter(deal => belongs(deal, link) && !deal.stage.isWon && !deal.stage.isLost).map(deal => ({ id: deal.id, title: deal.title, stage: deal.stage.name })) : [] };
    }),
    nextPageToken: rows.length > options.maxResults ? Buffer.from(JSON.stringify({ context, threadStart: last.threadStart.toISOString(), threadId: last.threadId, date: last.sentAt.toISOString(), id: last.providerMessageId })).toString('base64url') : undefined };
}
