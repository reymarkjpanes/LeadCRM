import { fireDealCreated } from '../../automation/triggers/triggers.service';
import { ZodError } from 'zod';
import { assertExternalCustomerEmail } from '../../crm/record-validation';
import { classifyCustomerRecord } from '../../crm/customer-classification.service';
import { customerEmailAvailability } from '../../administration/users/user-email';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { convertClosedLead } from '../../crm/leads/lead-conversion.service';
import { EMAIL_AVAILABILITY_MESSAGES, FormDefinitionSchema, FormFieldSchema, PublicSubmissionSchema, publicSubmissionContent, validateFormValues, withProductOptions, withoutRetiredFormSources, sourceAttribution } from '@leadcrm/shared';
import type { PublicFormDefinition } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { sendMail } from '../../../shared/services/email.service';
import { normalizePhone } from '../../crm/duplicate-detection/duplicate-detection.service';
import { createAssignedLead, productConfiguration, salesTransaction, resolveProducts, salesPipeline } from '../../crm/leads/lead-automation.service';
import { normalizeFormDefinitionForTenant } from './forms.repository';
import { saveRecordValues } from '../../crm/closing-requirements/custom-field-values.repository';
import { productCategories } from '../../administration/product-interests/product-interests.service';

export class SubmissionValidationError extends ValidationError {
  constructor(public fieldErrors: Record<string, string>, message = 'Please check the highlighted fields.') { super(message); }
}
const publicWhere = (publicId: string) => ({ publicId, isArchived: false, status: 'published', publishedVersion: { gt: 0 }, tenant: { status: { in: ['ACTIVE', 'SANDBOX'] as ('ACTIVE' | 'SANDBOX')[] } } });
export async function publicFormEmailAvailability(publicId: string, email: string) {
  const form = await prisma.marketingForm.findFirst({ where: publicWhere(publicId), select: { tenantId: true, publishedConfig: true } });
  if (!form?.publishedConfig) throw new NotFoundError('Form');
  return tenantContext.run({ tenantId: form.tenantId }, () => customerEmailAvailability(form.tenantId, email));
}
export async function getPublicForm(publicId: string): Promise<PublicFormDefinition> {
  const form = await prisma.marketingForm.findFirst({ where: publicWhere(publicId) });
  if (!form?.publishedConfig) throw new NotFoundError('Form');
  return tenantContext.run({ tenantId: form.tenantId }, () => salesTransaction(async tx => {
    const config = await normalizeFormDefinitionForTenant(tx, form.tenantId, FormDefinitionSchema.parse(form.publishedConfig));
    const products = await productConfiguration(tx, form.tenantId);
    const productCatalog = config.fields.some(field => field.mapToField === 'productInterest') ? {
      categories: await productCategories(tx, form.tenantId, { readOnly: true }),
      products: products.map(({ id, name, category }) => ({ id, name, category })),
    } : undefined;
    return { name: config.name, fields: withProductOptions(withoutRetiredFormSources(config.fields), products), design: config.design, version: form.publishedVersion, trackUrlParams: config.settings.trackUrlParams, allowedEmbedOrigins: config.settings.allowedEmbedOrigins, ...(productCatalog ? { productCatalog } : {}) };
  }));
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
          const previous = await tx.formSubmission.findFirst({ where: { ...scope, formId: live.id, requestKey: input.requestId } });
          if (previous) {
            const snapshot = previous.publishedConfig as { fields: unknown; trackUrlParams?: boolean };
            const checked = validateFormValues(FormFieldSchema.array().parse(snapshot.fields), input.values);
            const tracking = snapshot.trackUrlParams === false ? {} : input.tracking;
            if (Object.keys(checked.errors).length || publicSubmissionContent(input.version, checked.values, tracking, snapshot.trackUrlParams === false ? undefined : input.attribution) !==
              publicSubmissionContent(previous.publishedVersion, previous.values as Record<string, unknown>, previous.tracking as Record<string, unknown>, previous.attributionInput ?? undefined)) {
              throw new ConflictError('This submission request was already used for different content.');
            }
            return { submission: previous, notificationEmail: '' };
          }
          if (live.publishedVersion !== input.version) throw new ConflictError('This form has changed. Reload it before submitting.');
          const config = await normalizeFormDefinitionForTenant(tx, scope.tenantId, FormDefinitionSchema.parse(live.publishedConfig));
          config.fields = withProductOptions(withoutRetiredFormSources(config.fields), await productConfiguration(tx, scope.tenantId));
          const validated = validateFormValues(config.fields, input.values);
          if (Object.keys(validated.errors).length) throw new SubmissionValidationError(validated.errors);
          const emailField = config.fields.find(field => field.mapToField === 'email');
          const customerEmail = emailField && validated.values[emailField.id];
          if (emailField && typeof customerEmail === 'string' && customerEmail) {
            const availability = await customerEmailAvailability(scope.tenantId, customerEmail, tx);
            if (!availability.available) throw new SubmissionValidationError({ [emailField.id]: EMAIL_AVAILABILITY_MESSAGES[availability.reason] });
          }
          const mapped: Record<string, string> = {};
          for (const field of config.fields) if (field.mapToField && typeof validated.values[field.id] === 'string') mapped[field.mapToField] = validated.values[field.id] as string;
          const attribution = sourceAttribution(config.settings.trackUrlParams ? input.attribution ?? {
            first: { params: input.tracking, observedAt: new Date().toISOString() },
            last: { params: input.tracking, observedAt: new Date().toISOString() }, storage: 'session',
          } : undefined);
          const captureSource = attribution.last.method === 'unattributed' ? mapped.source || attribution.last.category : attribution.last.category;
          const attributionJson = attribution as unknown as Prisma.InputJsonObject;
          const productField = config.fields.find(field => field.mapToField === 'productInterest');
          const productValue = productField ? validated.values[productField.id] : undefined;
          const selectedProducts = Array.isArray(productValue) ? productValue : typeof productValue === 'string' && productValue ? [productValue] : [];
          const resolvedProducts = await resolveProducts(tx, scope.tenantId, selectedProducts);
          const email = mapped.email || undefined, phone = mapped.phone || undefined;
          const assertCustomer = async (customerEmail: string | null | undefined) => {
            try { await assertExternalCustomerEmail(tx, scope.tenantId, customerEmail); }
            catch (error) {
              if (!(error instanceof ZodError)) throw error;
              const message = EMAIL_AVAILABILITY_MESSAGES.STAFF_EMAIL_NOT_ALLOWED;
              const field = config.fields.find(field => field.mapToField === 'email') ?? config.fields.find(field => field.mapToField === 'phone');
              throw new SubmissionValidationError(field ? { [field.id]: message } : {});
            }
          };
          await assertCustomer(email);
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
          await assertCustomer(lead?.email);
          await assertCustomer(contact?.email);
          let leadId: string | null = lead?.id ?? null, contactId: string | null = contact?.id ?? null;
          let newWebsiteLead = false;
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
              if (contactId) {
                const recovered = await tx.contact.findFirst({ where: { ...scope, id: contactId }, select: { email: true } });
                await assertCustomer(recovered?.email);
                await tx.lead.update({ where: { ...scope, id: lead.id }, data: { contactId } });
              }
              const converted = await convertClosedLead(tx, scope.tenantId, lead.id, live.createdById, { previousLead: lead });
              contact = converted.contact;
              contactId = contact.id;
            }
          }
          if (contactId) leadId = null;
          if (!leadId && !contactId) {
            const names = (mapped.fullName || '').split(/\s+/);
            const created = await createAssignedLead(tx, { ...scope, firstName: mapped.firstName || names[0] || 'Website', lastName: mapped.lastName || names.slice(1).join(' ') || 'Inquiry',
              email, phone, companyName: mapped.companyName || null, address: mapped.address || null,
              productInterestIds: selectedProducts, source: captureSource, attribution: attributionJson }, live.createdById, 'public-form');
            leadId = created.id;
            newWebsiteLead = true;
          }
          // Repeat inquiries keep the original first touch and record the latest qualifying touch.
          const existingAttribution = (contact?.attribution ?? lead?.attribution) as unknown as import('@leadcrm/shared').SourceAttribution | null | undefined;
          const aggregate = { ...attribution, first: existingAttribution?.first ?? attribution.first,
            last: attribution.last.method === 'unattributed' && existingAttribution?.last ? existingAttribution.last : attribution.last } as unknown as Prisma.InputJsonObject;
          if (contactId) await tx.contact.update({ where: { id: contactId, ...scope }, data: { attribution: aggregate } });
          else if (leadId && !newWebsiteLead) await tx.lead.update({ where: { id: leadId, ...scope }, data: { attribution: aggregate } });
          const customFields = config.fields.filter(field => field.customFieldId);
          if (customFields.length && leadId && newWebsiteLead) {
            // Returning customers retain new answers only in the inquiry snapshot.
            const customValues = Object.fromEntries(customFields.map(field => {
              const answer = validated.values[field.id];
              return [field.customFieldId!, field.type === 'number' && typeof answer === 'string' && answer ? Number(answer) : answer || null];
            }));
            await saveRecordValues(tx, scope.tenantId, 'leads', leadId, customValues, live.createdById);
          }
          const submission = await tx.formSubmission.create({ data: { ...scope, formId: live.id, requestKey: input.requestId, publishedVersion: live.publishedVersion,
            publishedConfig: { name: config.name, fields: config.fields, design: config.design, trackUrlParams: config.settings.trackUrlParams }, leadId, contactId, email, phone,
            values: validated.values, tracking: config.settings.trackUrlParams ? input.tracking : {}, attribution: attributionJson,
            ...(config.settings.trackUrlParams && input.attribution ? { attributionInput: input.attribution as unknown as Prisma.InputJsonObject } : {}),
            notificationStatus: config.settings.notificationEmail ? 'pending' : 'not_requested' } });
          // Only committed new captures through this published form qualify. Source
          // labels are editable CRM data and do not establish inbound provenance.
          if (newWebsiteLead && leadId) {
            const captured = await tx.lead.findFirstOrThrow({ where: { ...scope, id: leadId },
              select: { firstName: true, lastName: true, assignedUserId: true, assignedUser: { select: { firstName: true, lastName: true } } } });
            await tx.notificationEvent.createMany({ data: [{ ...scope, eventKey: `website-lead:${leadId}`, type: 'website_lead',
              entityType: 'Lead', entityId: leadId, admins: true, actorId: live.createdById,
              payload: { name: `${captured.firstName} ${captured.lastName}`.trim(), formId: live.id, submissionId: submission.id,
                assignedName: captured.assignedUser ? `${captured.assignedUser.firstName} ${captured.assignedUser.lastName}`.trim() : null } }], skipDuplicates: true });
          }
          if ((contactId || leadId && !newWebsiteLead) && resolvedProducts.length) {
            const customer = contactId ? await tx.contact.findFirstOrThrow({ where: { ...scope, id: contactId } })
              : await tx.lead.findFirstOrThrow({ where: { ...scope, id: leadId! } });
            const { pipeline, initial } = await salesPipeline(tx, scope.tenantId);
            // Each accepted inquiry is a new opportunity. requestId retries return above,
            // while later purchases of the same Product remain legitimate separate Deals.
            for (const product of resolvedProducts) {
              const deal = await tx.deal.create({ data: { ...scope, accountId: customer.accountId,
                title: `${customer.firstName} ${customer.lastName} – ${product.name}`.slice(0, 255),
                pipelineId: pipeline.id, stageId: initial.id, productInterestId: product.id, productsNormalized: true,
                value: Number(product.dealValue), currency: 'PHP', assignedUserId: customer.assignedUserId, ownerId: customer.assignedUserId,
                automationKey: `form:${submission.id}:${product.id}`, leadSource: captureSource, attribution: attributionJson, tags: [] } });
              if (contactId) await tx.contactDeal.create({ data: { ...scope, contactId, dealId: deal.id, addedById: live.createdById } });
              else await tx.leadDeal.create({ data: { ...scope, leadId: leadId!, dealId: deal.id, addedById: live.createdById } });
              await tx.activity.create({ data: { ...scope, leadId, contactId, dealId: deal.id, createdById: live.createdById,
                type: 'deal_action', title: `Deal created for ${product.name}`, description: `New website inquiry from an existing ${contactId ? 'Contact' : 'Lead'}.` } });
              await tx.auditLog.create({ data: { ...scope, userId: live.createdById, action: 'deal.created', entityType: 'Deal', entityId: deal.id } });
              await fireDealCreated({ tenantId: scope.tenantId, actorId: live.createdById, deal });
            }
            await classifyCustomerRecord(tx, scope.tenantId, contactId ? { contactId } : { leadId: leadId! }, live.createdById);
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
        if (!(error instanceof ValidationError) && !(error instanceof NotFoundError) && !(error instanceof ConflictError)) {
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
