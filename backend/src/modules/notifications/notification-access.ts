import type { Notification } from '@prisma/client';
import prisma from '../../config/database.config';
import { findUserEffectivePermissions } from '../administration/roles/roles.repository';
import { mailboxPermissions } from '../../integrations/gmail/mailbox-sync.service';
import { resolveMailboxScope, scopedMessagesWhere } from '../../integrations/gmail/mailbox-scope';
import { AppError } from '../../shared/errors/app-error';
import { requireEmployeeAccount } from '../../core/auth/account-access';

export const activeAdminWhere = (tenantId: string) => ({
  tenantId, status: 'ACTIVE' as const,
  userRoles: { some: { tenantId, role: { tenantId, name: 'Client Admin', isArchived: false } } },
});
const modules: Record<string, string> = { Lead: 'leads', Contact: 'contacts', Account: 'accounts', Deal: 'deals',
  Task: 'tasks', Campaign: 'campaigns', Workflow: 'workflows', User: 'users', Form: 'forms' };

/** Current role and ownership checks are shared by delivery, presentation and navigation. */
export async function notificationAccess(tenantId: string, userId: string) {
  const user = await prisma.user.findFirst({ where: { tenantId, id: userId, status: 'ACTIVE', tenant: { status: { notIn: ['SUSPENDED', 'CANCELLED', 'DELETED'] } } } });
  let active = !!user;
  if (user) {
    try { requireEmployeeAccount(user); } catch (error) { if (error instanceof AppError) active = false; else throw error; }
  }
  const admin = active && !!await prisma.user.findFirst({ where: { ...activeAdminWhere(tenantId), id: userId }, select: { id: true } });
  const permissions = active && !admin ? await findUserEffectivePermissions(userId, tenantId) : {};
  const can = (module: string) => active && (admin || permissions[module]?.canView === true);
  const cache = new Map<string, Promise<{ entityType: string; entityId: string; destination: string } | null>>();
  const resolve = async (entityType?: string | null, entityId?: string | null): Promise<{ entityType: string; entityId: string; destination: string } | null> => {
    if (!active || !entityType || !entityId) return null;
    const key = entityType + ':' + entityId;
    if (cache.has(key)) return cache.get(key)!;
    const load = async (): Promise<{ entityType: string; entityId: string; destination: string } | null> => {
      const id = encodeURIComponent(entityId);
      const scope = { tenantId, id: entityId };
      if (entityType === 'MailboxMessage') {
        try {
          const message = await prisma.mailboxMessage.findFirst({ where: { ...scope, account: { tenantId, userId, isActive: true }, direction: 'inbound' }, include: { account: true } });
          if (!message) return null;
          const mailbox = await mailboxPermissions(tenantId, userId);
          const mailboxScope = await resolveMailboxScope(message.account, mailbox);
          if (!await prisma.mailboxMessage.findFirst({ where: { AND: [scopedMessagesWhere(message.account, mailboxScope), { id: entityId }] }, select: { id: true } })) return null;
          // Customer-reply events also require current CRM association, not just an approved sender.
          const linked = message.contactId ? await resolve('Contact', message.contactId) : message.leadId ? await resolve('Lead', message.leadId) : null;
          if (!linked) return null;
          return { entityType, entityId, destination: '/inbox?threadId=' + encodeURIComponent(message.threadId) };
        } catch (error) { if (error instanceof AppError && [403, 404].includes(error.statusCode)) return null; throw error; }
      }
      if (entityType === 'Mailbox') {
        const account = await prisma.emailAccount.findFirst({ where: scope, select: { userId: true } });
        return account && (admin || account.userId === userId) ? { entityType, entityId, destination: account.userId === userId ? '/inbox' : '/settings?tab=users' } : null;
      }
      if (!can(modules[entityType])) return null;
      const owned = { ...scope, isArchived: false, deletedAt: null, ...(!admin ? { assignedUserId: userId } : {}) };
      let exists: unknown = false;
      let destination = '';
      if (entityType === 'Lead') {
        const lead = await prisma.lead.findFirst({ where: owned, select: { contactId: true, convertedAt: true } });
        if (lead?.convertedAt) return lead.contactId ? resolve('Contact', lead.contactId) : null;
        exists = lead; destination = '/crm/leads/' + id;
      } else if (entityType === 'Contact') { exists = await prisma.contact.findFirst({ where: owned, select: { id: true } }); destination = '/crm/contacts/' + id; }
      else if (entityType === 'Account') { exists = await prisma.account.findFirst({ where: owned, select: { id: true } }); destination = '/crm/accounts/' + id; }
      else if (entityType === 'Deal') { exists = await prisma.deal.findFirst({ where: owned, select: { id: true } }); destination = '/crm/deals/' + id; }
      else if (entityType === 'Task') { exists = await prisma.task.findFirst({ where: { ...scope, isArchived: false, ...(!admin ? { assignedUserId: userId } : {}) }, select: { id: true } }); destination = '/operations/taskboard?taskId=' + id; }
      else if (entityType === 'Campaign') { exists = await prisma.campaign.findFirst({ where: { ...scope, isArchived: false, ...(!admin ? { createdById: userId } : {}) }, select: { id: true } }); destination = '/marketing/campaigns?campaignId=' + id; }
      else if (entityType === 'Workflow') { exists = admin && await prisma.workflow.findFirst({ where: { ...scope, isArchived: false }, select: { id: true } }); destination = '/automation/workflows?workflowId=' + id; }
      else if (entityType === 'User') { exists = admin && await prisma.user.findFirst({ where: scope, select: { id: true } }); destination = '/settings?tab=users'; }
      else if (entityType === 'Form') { exists = admin && await prisma.marketingForm.findFirst({ where: { ...scope, isArchived: false }, select: { id: true } }); destination = '/marketing/forms?formId=' + id; }
      return exists ? { entityType, entityId, destination } : null;
    };
    const result = load(); cache.set(key, result); return result;
  };
  return { active, admin, resolve };
}

export async function presentNotifications(tenantId: string, userId: string, rows: Notification[]) {
  const access = await notificationAccess(tenantId, userId);
  return Promise.all(rows.map(async row => {
    const target = await access.resolve(row.entityType, row.entityId);
    // Preserve management of historical notifications without exposing a former owner's data.
    return target ? { ...row, entityType: target.entityType, entityId: target.entityId, available: true }
      : { ...row, title: 'Notification no longer available', body: 'The related record is unavailable or your access has changed.',
        entityType: null, entityId: null, eventKey: undefined, available: false };
  }));
}
