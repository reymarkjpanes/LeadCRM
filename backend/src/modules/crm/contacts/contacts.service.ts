import { Prisma } from '@prisma/client';
import * as repo from './contacts.repository';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { enforcePlanLimit } from '../../../config/database.config';
import { CreateContactDto, UpdateContactDto, ConvertContactDto } from './contacts.dto';
import { paginate } from '../../../shared/helpers/pagination';
import { fireContactCreated, fireContactStatusChanged, fireLeadCreated, fireLeadStatusChanged } from '../../automation/triggers/triggers.service';
import { createNotification } from '../../notifications/notifications.service';
import prisma from '../../../config/database.config';

export async function getContacts(tenantId: string, query: Record<string, unknown>) {
  const result = await repo.findAllContacts(tenantId, query);
  return paginate(result.data, result.total, { page: result.page, limit: result.limit });
}

export async function getContactById(id: string, tenantId: string) {
  const contact = await repo.findContactById(id, tenantId);
  if (!contact) throw new NotFoundError('Contact');
  return contact;
}

export async function createContact(tenantId: string, userId: string, dto: CreateContactDto) {
  await enforcePlanLimit(tenantId, 'contacts');
  const contact = await repo.createContact(tenantId, dto, userId);

  await writeAuditLog({
    tenantId, userId,
    action:     'contact.created',
    entityType: 'Contact',
    entityId:   contact.id,
    after:      { firstName: dto.firstName, lastName: dto.lastName },
  });

  // Fire workflow triggers (both lead.created and contact.created — non-blocking)
  // contact.created: retained for backward compatibility with existing workflows
  // lead.created:    new — allows workflows that specifically target Lead entities
  fireContactCreated({
    tenantId,
    contact: contact as never,
  }).catch(() => {});

  fireLeadCreated({
    tenantId,
    lead: {
      id:             contact.id,
      status:         String((contact as Record<string, unknown>).status ?? ''),
      source:         (contact as Record<string, unknown>).source as string | null ?? null,
      score:          Number((contact as Record<string, unknown>).score ?? 0),
      assignedUserId: (contact as Record<string, unknown>).assignedUserId as string | null ?? null,
      companyName:    (contact as Record<string, unknown>).companyName as string | null ?? null,
    },
  }).catch(() => {});

  // Notify the assigned user when a lead is directly assigned to them on creation.
  // Only fires when the creator is NOT the assignee (no self-notification).
  if ((contact as Record<string, unknown>).assignedUserId &&
      (contact as Record<string, unknown>).assignedUserId !== userId) {
    createNotification({
      tenantId,
      userId:     String((contact as Record<string, unknown>).assignedUserId),
      type:       'lead_assigned',
      title:      `New lead assigned to you`,
      body:       `${(contact as Record<string, unknown>).firstName ?? ''} ${(contact as Record<string, unknown>).lastName ?? ''}`.trim() ||
                  'A new lead has been assigned to you.',
      entityType: 'Lead',
      entityId:   contact.id,
    }).catch(() => {});
  }

  return contact;
}

export async function updateContact(
  id: string, tenantId: string, userId: string, dto: UpdateContactDto,
) {
  const before = await repo.findContactById(id, tenantId);
  if (!before) throw new NotFoundError('Contact');

  const contact = await repo.updateContact(id, tenantId, dto, userId, before.status);
  if (!contact) throw new NotFoundError('Contact');

  await writeAuditLog({
    tenantId, userId,
    action:     'contact.updated',
    entityType: 'Contact',
    entityId:   id,
  });

  // Fire status-change triggers if status changed (both lead.* and contact.* — non-blocking)
  // contact.status_changed: retained for backward compatibility
  // lead.status_changed:    new — targets Lead entity workflows specifically
  if (dto.status && dto.status !== before.status) {
    fireContactStatusChanged({
      tenantId,
      contact: contact as never,
      prevStatus: before.status,
    }).catch(() => {});

    fireLeadStatusChanged({
      tenantId,
      lead: {
        id:             id,
        status:         dto.status,
        score:          Number((contact as Record<string, unknown>).score ?? 0),
        assignedUserId: (contact as Record<string, unknown>).assignedUserId as string | null ?? null,
      },
      prevStatus: before.status,
    }).catch(() => {});
  }

  // Notify the newly assigned user when a lead is reassigned to someone else.
  // Guards: new assignee differs from previous, and is not the actor making the change.
  const newAssignee = (dto as Record<string, unknown>).assignedUserId as string | undefined;
  const prevAssignee = (before as Record<string, unknown>).assignedUserId as string | undefined;
  if (newAssignee && newAssignee !== prevAssignee && newAssignee !== userId) {
    const leadName = `${(contact as Record<string, unknown>).firstName ?? ''} ${(contact as Record<string, unknown>).lastName ?? ''}`.trim();
    createNotification({
      tenantId,
      userId:     newAssignee,
      type:       'lead_assigned',
      title:      `Lead assigned to you`,
      body:       leadName ? `"${leadName}" has been assigned to you.` : 'A lead has been assigned to you.',
      entityType: 'Lead',
      entityId:   id,
    }).catch(() => {});
  }

  return contact;
}

export async function archiveContact(id: string, tenantId: string, userId: string) {
  const contact = await repo.archiveContact(id, tenantId, userId);
  if (!contact) throw new NotFoundError('Contact');

  await writeAuditLog({
    tenantId, userId,
    action:     'contact.archived',
    entityType: 'Contact',
    entityId:   id,
    after:      { status: 'Archived' },
  });

  return contact;
}

/**
 * Convert a Lead into a full CRM record chain:
 * Lead → Contact (create/link) + Account (create/link) + optional Deal (create/link).
 *
 * After conversion:
 * - Lead.status = 'Converted'
 * - Lead.contactId = created/linked Contact ID
 * - Lead.convertedAt = now
 * - Lead.convertedById = userId
 * - Lead.accountId = resolved Account ID
 */
export async function convertContact(
  id: string, tenantId: string, userId: string, dto: ConvertContactDto,
) {
  const lead = await repo.findContactById(id, tenantId);
  if (!lead) throw new NotFoundError('Contact');

  // Prevent re-conversion
  if (lead.status === 'Converted') {
    throw new ValidationError('This lead has already been converted');
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // ─── 1. Resolve or create the Account ─────────────────────────────────
    let accountId = dto.accountId;
    let account: { id: string; name: string } | null = null;

    if (accountId) {
      account = await tx.account.findFirst({ where: { id: accountId, tenantId } });
      if (!account) throw new NotFoundError('Account');
    } else if (dto.accountName) {
      account = await tx.account.create({
        data: { tenantId, name: dto.accountName } as never,
      });
      accountId = account.id;
    }

    // ─── 2. Resolve or create the Contact ─────────────────────────────────
    let contactId: string | null = null;
    let contact: { id: string; firstName: string; lastName: string } | null = null;

    if (dto.contactId) {
      // Link to existing contact
      contact = await tx.contact.findFirst({ where: { id: dto.contactId, tenantId } });
      if (!contact) throw new NotFoundError('Contact');
      contactId = contact.id;

      // Update existing contact's accountId if not already set
      if (accountId) {
        await tx.contact.update({
          where: { id: contactId } as never,
          data: { accountId } as never,
        });
      }
    } else if (dto.createContact !== false) {
      // Create new Contact from Lead data.
      //
      // ── Field mapping (Lead → Contact) ───────────────────────────────────
      // Lead.companyName     → Contact.company          (plain text; NOT a FK)
      // Lead.productInterest → Contact.productInterests (String[] → String[])
      // Lead.firstName/etc   → Contact.firstName/etc    (direct copy)
      // accountId (resolved) → Contact.accountId        (FK → Account; canonical company link per ADR-001)
      // lifecycleStage       → 'CUSTOMER'               (ContactLifecycleStage enum — requires migration 20260807110000)
      // status               → 'WARM'                   (ContactStatus enum; indicates active lead-converted contact)
      //
      // The Prisma.ContactUncheckedCreateInput type annotation provides compile-time safety:
      // any field-name drift (e.g. renaming productInterests) will be caught by tsc --noEmit.
      const contactData: Prisma.ContactUncheckedCreateInput = {
        tenantId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        company: lead.companyName ?? null,         // Lead.companyName → Contact.company ✓
        address: lead.address,
        source: lead.source,
        productInterests: lead.productInterest ?? [],  // Lead.productInterest → Contact.productInterests ✓
        assignedUserId: lead.assignedUserId,
        accountId: accountId ?? null,              // resolved Account ID or null ✓
        status: 'WARM',
        lifecycleStage: 'CUSTOMER',                // requires ContactLifecycleStage enum in DB ✓
        convertedAt: now,
      };
      contact = await tx.contact.create({ data: contactData });
      contactId = contact.id;
    }

    // ─── 3. Resolve or create the Deal ────────────────────────────────────
    let deal: { id: string; title: string } | null = null;

    if (dto.dealId) {
      // Link to existing deal
      deal = await tx.deal.findFirst({
        where: { id: dto.dealId, tenantId },
        select: { id: true, title: true },
      });
      if (!deal) throw new NotFoundError('Deal');

      // Create LeadDeal junction
      await tx.leadDeal.create({
        data: { tenantId, dealId: deal.id, leadId: id, addedById: userId } as never,
      });

      // Create ContactDeal junction if contact exists
      if (contactId) {
        await tx.contactDeal.create({
          data: { tenantId, dealId: deal.id, contactId, addedById: userId } as never,
        }).catch(() => {
          // Ignore if junction already exists (unique constraint)
        });
      }

      // Update deal accountId if not set
      if (accountId) {
        await tx.deal.update({
          where: { id: deal.id } as never,
          data: { accountId } as never,
        });
      }
    } else if (dto.createDeal && dto.dealTitle) {
      // Create new deal
      const pipeline = dto.dealPipelineId
        ? await tx.pipeline.findFirst({ where: { id: dto.dealPipelineId, tenantId, isArchived: false }, include: { stages: { orderBy: { order: 'asc' } } } })
        : await tx.pipeline.findFirst({ where: { tenantId, isDefault: true, isArchived: false }, include: { stages: { orderBy: { order: 'asc' } } } });

      if (!pipeline || pipeline.stages.length === 0) {
        throw new ValidationError('No pipeline with stages available for deal creation');
      }

      const entryStage = pipeline.stages.find((s: { isDefault: boolean }) => s.isDefault) || pipeline.stages[0];

      deal = await tx.deal.create({
        data: {
          tenantId,
          pipelineId: pipeline.id,
          stageId: entryStage.id,
          accountId: accountId,
          ownerId: userId,
          assignedUserId: lead.assignedUserId || userId,
          title: dto.dealTitle,
          value: dto.dealValue,
          priority: dto.dealPriority || 'MEDIUM',
        } as never,
      });

      // LeadDeal junction
      await tx.leadDeal.create({
        data: { tenantId, dealId: deal.id, leadId: id, addedById: userId } as never,
      });

      // ContactDeal junction (if contact was created/linked)
      if (contactId) {
        await tx.contactDeal.create({
          data: { tenantId, dealId: deal.id, contactId, addedById: userId } as never,
        });
      }

      // Activity for deal creation — link to the deal only (exactly-one-FK rule).
      const dealActivity: Prisma.ActivityUncheckedCreateInput = {
        tenantId,
        createdById: userId,
        type: 'deal_created',
        title: `Deal "${dto.dealTitle}" created via conversion`,
        dealId: deal.id,
      };
      await tx.activity.create({ data: dealActivity });
    }

    // ─── 4. Update the Lead record ────────────────────────────────────────
    await tx.lead.update({
      where: { id } as never,
      data: {
        status: 'Converted',
        accountId: accountId,
        contactId: contactId,
        convertedAt: now,
        convertedById: userId,
      } as never,
    });

    // ─── 5. Activity for conversion ───────────────────────────────────────
    // Activity uses typed FKs with the "exactly one non-null" rule (see Activity model).
    // Link to the source Lead only; the account/contact names are captured in the title.
    // (Matches the moveDealStage precedent that trims extra FKs to avoid P2003.)
    const conversionActivity: Prisma.ActivityUncheckedCreateInput = {
      tenantId,
      createdById: userId,
      type: 'conversion',
      title: `Lead converted — linked to ${account?.name || 'Account'}${contact ? `, Contact ${contact.firstName} ${contact.lastName}` : ''}`,
      leadId: id,
    };
    await tx.activity.create({ data: conversionActivity });

    return { lead, contact, account, deal };
  });

  await writeAuditLog({
    tenantId, userId,
    action: 'contact.converted',
    entityType: 'Contact',
    entityId: id,
    after: {
      accountId: result.account?.id,
      contactId: result.contact?.id,
      dealId: result.deal?.id,
      convertedAt: now.toISOString(),
    },
  });

  return result;
}
