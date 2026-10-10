import { fireDealCreated } from '../../automation/triggers/triggers.service';
import { productRelationData } from '../../crm/leads/product-relations';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { convertClosedLead } from '../../crm/leads/lead-conversion.service';
import { changeCustomerStatus } from '../../crm/engagement.service';
import { FormDefinitionSchema, PublicSubmissionSchema, validateFormValues, withProductOptions } from '@leadcrm/shared';
import type { PublicFormDefinition } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { sendMail } from '../../../shared/services/email.service';
import { normalizePhone } from '../../crm/duplicate-detection/duplicate-detection.service';
import { afterSalesCommit, createAssignedLead, createProductDeals, productConfiguration, salesTransaction, resolveProducts, salesPipeline } from '../../crm/leads/lead-automation.service';

export class SubmissionValidationError extends ValidationError {
  constructor(public fieldErrors: Record<string, string>) { super('Please check the highlighted fields.'); }
}
const publicWhere = (publicId: string) => ({ publicId, isArchived: false, status: 'published', publishedVersion: { gt: 0 }, tenant: { status: { in: ['ACTIVE', 'SANDBOX'] as ('ACTIVE' | 'SANDBOX')[] } } });
export async function getPublicForm(publicId: string): Promise<PublicFormDefinition> {
  const form = await prisma.marketingForm.findFirst({ where: publicWhere(publicId) });
  if (!form?.publishedConfig) throw new NotFoundError('Form');
  const config = FormDefinitionSchema.parse(form.publishedConfig);
  const products = await salesTransaction(tx => productConfiguration(tx, form.tenantId));
  return { name: config.name, fields: withProductOptions(config.fields, products), design: config.design, version: form.publishedVersion, trackUrlParams: config.settings.trackUrlParams };
}

export async function submitPublicForm(publicId: string, body: unknown) {
  const input = PublicSubmissionSchema.parse(body);
  if (input.website) throw new ValidationError('Unable to accept submission.');
  const form = await prisma.marketingForm.findFirst({ where: publicWhere(publicId) });
  if (!form) throw new NotFoundError('Form');
  const scope = { tenantId: form.tenantId };
  // Serializable predicate reads prevent simultaneous inquiries creating duplicate people,
  // including submissions arriving through different forms in this dataset.
  return tenantContext.run(scope, async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const accepted = await salesTransaction(async tx => {
          const live = await tx.marketingForm.findFirst({ where: { ...publicWhere(publicId), ...scope } });
          if (!live?.publishedConfig) throw new NotFoundError('Form');
          if (live.publishedVersion !== input.version) throw new ConflictError('This form has changed. Reload it before submitting.');
          if (input.requestId) {
            const previous = await tx.formSubmission.findFirst({ where: { ...scope, formId: live.id, requestKey: input.requestId } });
            if (previous) return { submission: previous, notificationEmail: '' };
          }
          const config = FormDefinitionSchema.parse(live.publishedConfig);
          config.fields = withProductOptions(config.fields, await productConfiguration(tx, scope.tenantId));
          const validated = validateFormValues(config.fields, input.values);
          if (Object.keys(validated.errors).length) throw new SubmissionValidationError(validated.errors);
          const mapped: Record<string, string> = {};
          for (const field of config.fields) if (field.mapToField && typeof validated.values[field.id] === 'string') mapped[field.mapToField] = validated.values[field.id] as string;
          const productField = config.fields.find(field => field.mapToField === 'productInterest');
          const productValue = productField ? validated.values[productField.id] : undefined;
          const selectedProducts = Array.isArray(productValue) ? productValue : typeof productValue === 'string' && productValue ? [productValue] : [];
          const resolvedProducts = await resolveProducts(tx, scope.tenantId, selectedProducts);
          const email = mapped.email || undefined, phone = mapped.phone || undefined;
          if (!email && !phone) throw new ValidationError('An email address or phone number is required.');
          const identity: Prisma.LeadWhereInput[] = [];
          if (email) identity.push({ email: { contains: email, mode: 'insensitive' } });
          // Narrow legacy formatted numbers before comparing their normalized identity.
          if (phone) identity.push({ phone: { contains: phone.slice(-4) } });
          const leadCandidates = await tx.lead.findMany({ where: { ...scope, OR: identity }, take: 101 });
          const contactCandidates = await tx.contact.findMany({ where: { ...scope, OR: identity as Prisma.ContactWhereInput[] }, take: 101 });
          // Include archived people in matching; never revive or duplicate them silently.
          const conflict = () => new ConflictError('We could not safely match this inquiry. Please contact the company directly.');
          if (leadCandidates.length > 100 || contactCandidates.length > 100) throw conflict();
          const matches = (p: { email: string | null; phone: string | null }) =>
            !!((email && p.email?.trim().toLowerCase() === email) || (phone && p.phone && normalizePhone(p.phone) === normalizePhone(phone)));
          const leads = leadCandidates.filter(matches), contacts = contactCandidates.filter(matches);
          if (leads.length > 1 || contacts.length > 1) throw conflict();
          const lead = leads[0]; let contact = contacts[0];
          if (lead?.contactId) {
            const linked = await tx.contact.findFirst({ where: { ...scope, id: lead.contactId } });
            if (!linked || (contact && linked.id !== contact.id)) throw conflict();
            contact = linked;
          }
          if (lead && contact && lead.contactId !== contact.id) {
            const sameEmail = email && lead.email?.trim().toLowerCase() === email && contact.email?.trim().toLowerCase() === email;
            const samePhone = phone && lead.phone && contact.phone && normalizePhone(lead.phone) === normalizePhone(phone) && normalizePhone(contact.phone) === normalizePhone(phone);
            if (!sameEmail && !samePhone) throw conflict();
          }
          if (lead?.isArchived || contact?.isArchived) throw conflict();
          let leadId: string | null = lead?.id ?? null, contactId: string | null = contact?.id ?? null;
          if (lead && !lead.convertedAt) {
            const won = await tx.deal.findFirst({ where: { ...scope, AND: [
              { leadDeals: { some: { ...scope, leadId: lead.id } } },
              { OR: [{ stage: { isWon: true } }, { stageHistories: { some: { ...scope, newStage: { isWon: true } } } }] },
            ],
            } });
            if (won) {
              // Existing historical sales links may identify a customer whose email has changed.
              if (!contactId) {
                const links = await tx.contactDeal.findMany({ where: { ...scope, dealId: won.id }, select: { contactId: true } });
                const ids = [...new Set(links.map(row => row.contactId))];
                if (ids.length > 1) throw conflict();
                contactId = ids[0] ?? null;
              }
              if (contactId) await tx.lead.update({ where: { ...scope, id: lead.id }, data: { contactId } });
              await changeCustomerStatus(tx, scope.tenantId, live.createdById, { leadId: lead.id }, 'Closed', 'Completed sales conversion resolved during a returning inquiry.', new Date());
              const converted = await convertClosedLead(tx, scope.tenantId, lead.id, live.createdById);
              contact = converted.contact;
              contactId = contact.id;
            }
          }
          if (contactId) leadId = null;
          if (leadId && lead && !contactId) {
            // A repeat inquiry can add interests, but must never replace historical Deals or owners.
            await tx.lead.update({ where: { id: leadId, ...scope }, data: {
              ...await productRelationData(tx, 'lead', scope.tenantId, { names: [...new Set([...lead.productInterest, ...resolvedProducts.map(p => p.name)])] }, lead, true),
            } });
            await createProductDeals(tx, scope.tenantId, leadId, live.createdById);
          }
          if (!leadId && !contactId) {
            const names = (mapped.fullName || '').split(/\s+/);
            const created = await createAssignedLead(tx, { ...scope, firstName: mapped.firstName || names[0] || 'Website', lastName: mapped.lastName || names.slice(1).join(' ') || 'Inquiry',
              email, phone, companyName: mapped.companyName || null, address: mapped.address || null,
              productInterestIds: selectedProducts, source: 'Website' }, live.createdById);
            leadId = created.id;
          }
          const submission = await tx.formSubmission.create({ data: { ...scope, formId: live.id, requestKey: input.requestId, publishedVersion: live.publishedVersion,
            publishedConfig: { name: config.name, fields: config.fields, design: config.design }, leadId, contactId, email, phone,
            values: validated.values, tracking: config.settings.trackUrlParams ? input.tracking : {}, notificationStatus: config.settings.notificationEmail ? 'pending' : 'not_requested' } });
          if (contactId && resolvedProducts.length) {
            const customer = await tx.contact.findFirstOrThrow({ where: { ...scope, id: contactId } });
            await tx.contact.update({ where: { ...scope, id: customer.id }, data: await productRelationData(tx, 'contact', scope.tenantId,
              { names: [...new Set([...customer.productInterests, ...resolvedProducts.map(p => p.name)])] }, customer, true) });
            const { pipeline, initial } = await salesPipeline(tx, scope.tenantId);
            // Each accepted inquiry is a new opportunity. requestId retries return above,
            // while later purchases of the same Product remain legitimate separate Deals.
            for (const product of resolvedProducts) {
              const deal = await tx.deal.create({ data: { ...scope, accountId: customer.accountId,
                title: `${customer.firstName} ${customer.lastName} – ${product.name}`.slice(0, 255),
                pipelineId: pipeline.id, stageId: initial.id, productInterestId: product.id, productsNormalized: true,
                value: Number(product.dealValue), currency: 'PHP', assignedUserId: customer.assignedUserId, ownerId: customer.assignedUserId,
                automationKey: `form:${submission.id}:${product.id}`, leadSource: 'Website', tags: [] } });
              afterSalesCommit(() => fireDealCreated({ tenantId: scope.tenantId, actorId: live.createdById, deal }));
              await tx.contactDeal.create({ data: { ...scope, contactId, dealId: deal.id, addedById: live.createdById } });
              await tx.activity.create({ data: { ...scope, contactId, dealId: deal.id, createdById: live.createdById,
                type: 'deal_action', title: `Deal created for ${product.name}`, description: 'New website inquiry from an existing Contact.' } });
            }
          }
          return { submission, notificationEmail: config.settings.notificationEmail };
        });
        // Notification cannot roll back accepted data. Do not include visitor HTML or identity in mail/logs.
        if (accepted.notificationEmail) {
          let status = 'failed';
          try { const result = await sendMail({ to: accepted.notificationEmail, subject: 'New LeadCRM form submission', html: '<p>A new website inquiry has been recorded. Open Forms in LeadCRM to view submission history.</p>' }); status = result.submitted ? 'sent' : 'failed'; }
          catch { console.error('[Forms] Notification failed', { submissionId: accepted.submission.id }); }
          try { await prisma.formSubmission.update({ where: { id: accepted.submission.id, ...scope }, data: { notificationStatus: status } }); }
          catch { console.error('[Forms] Notification status update failed', { submissionId: accepted.submission.id }); }
        }
        return { accepted: true };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) {
          if (attempt < 3) continue;
          error = new ConflictError('Another inquiry is being processed. Please try again.');
        }
        if (!(error instanceof ValidationError) && !(error instanceof NotFoundError)) {
          const hash = createHash('sha256').update(`form-failure:${form.id}:${input.requestId ?? JSON.stringify(input.values)}`).digest('hex');
          const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
          try { await prisma.auditLog.upsert({ where: { id }, update: {}, create: { id, tenantId: form.tenantId, userId: form.createdById,
            action: 'form.processing_failed', entityType: 'Form', entityId: form.id, severity: 'WARNING' } }); }
          catch { console.warn('[Forms] Unable to record submission processing failure', { formId: form.id }); }
        }
        throw error;
      }
    }
    throw new ConflictError('Please try again.');
  });
}
