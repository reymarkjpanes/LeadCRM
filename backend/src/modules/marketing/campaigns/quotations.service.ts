import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { campaignVariableKeys, renderEmailVariables, escapeEmailHtml, formatMoney, parseQuotationTemplate, quotationNumber, quotationVariableChoices,
  QuotationDraftSchema, QuotationSendSchema, type QuotationDraft, type QuotationDocument, type QuotationPreview } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { assertPermissions } from '../../../core/permissions/permission.service';
import { AppError } from '../../../shared/errors/app-error';
import { campaignFieldsForAudienceSource, campaignVariableFields, campaignScope, personalized } from './audiences.service';
import { presentContactAccount } from '../../crm/contacts-v2/contact-account-access';
import { assertProductCatalogEnabled } from '../../administration/product-interests/product-interests.service';
import { getOrganizationSettings } from '../../administration/organization-settings/organization-settings.service';
import { getTemplateById, validateQuotationVariables } from '../templates/templates.service';
import { renderQuotationPdf } from './quotation-pdf';
import { authorizedMailbox } from '../../../integrations/gmail/mailbox-store';
import { sendMailboxEmail } from '../../../integrations/gmail/mailbox-send.service';
import type { MailboxQuotationContext } from '../../../integrations/gmail/mailbox-operations';

type Actor = { tenantId: string; userId: string; role: string };
// JSONB receipts reorder keys. Normalize before hashing and before entering the
// existing mailbox intent hash so a retry keeps exactly the same operation.
function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonical) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) as T;
  return value;
}
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const filename = (number: string) => `${number.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
const recipientSelect = { id: true, firstName: true, lastName: true, companyName: true, companyFromAccount: true, email: true, phone: true, address: true,
  accountId: true, assignedUserId: true, status: true, source: true, createdAt: true,
  assignedUser: { select: { firstName: true, lastName: true } },
  customFieldValues: { select: { fieldId: true, value: true } } } as const;

async function readRecipient(actor: Actor, draft: Pick<QuotationDraft, 'recipientType' | 'recipientId' | 'dealId'>) {
  const module = draft.recipientType === 'Lead' ? 'leads' : 'contacts';
  await assertPermissions(actor, [`${module}.view`]);
  const where = { ...campaignScope(actor.tenantId), id: draft.recipientId, isArchived: false, deletedAt: null };
  const row = draft.recipientType === 'Lead' ? await prisma.lead.findFirst({ where: { ...where, convertedAt: null }, select: recipientSelect })
    : await prisma.contact.findFirst({ where, select: { ...recipientSelect, notes: true } });
  if (!row) throw new AppError('The selected recipient is unavailable.', 404);
  if (draft.dealId) {
    await assertPermissions(actor, ['deals.view']);
    const relationship = draft.recipientType === 'Lead' ? { leadDeals: { some: { leadId: row.id, tenantId: actor.tenantId } } } : { OR: [
      { contactDeals: { some: { contactId: row.id, tenantId: actor.tenantId } } },
      { leadDeals: { some: { tenantId: actor.tenantId, lead: { tenantId: actor.tenantId, contactId: row.id, convertedAt: { not: null } } } } },
    ] };
    if (!await prisma.deal.findFirst({ where: { id: draft.dealId, tenantId: actor.tenantId, isArchived: false, deletedAt: null, ...relationship }, select: { id: true } })) throw new AppError('Choose a visible Deal linked to this recipient.', 400);
  }
  let canReadAccount = false;
  try { await assertPermissions(actor, ['accounts.view']); canReadAccount = true; }
  catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; }
  const account = canReadAccount && row.accountId ? await prisma.account.findFirst({ where: { id: row.accountId, tenantId: actor.tenantId, isArchived: false, deletedAt: null },
    select: { id: true, tenantId: true, name: true, address: true } }) : null;
  return { ...presentContactAccount({ ...row, account }, canReadAccount), account };
}

export async function buildQuotationDocument(actor: Actor, input: unknown): Promise<{ draft: QuotationDraft; document: QuotationDocument; fingerprint: string }> {
  await assertPermissions(actor, ['campaigns.view', 'products.view']);
  const draft = QuotationDraftSchema.parse(input);
  const template = await getTemplateById(draft.templateId, actor.tenantId);
  if (template.type !== 'Quotation' || template.isArchived) throw new AppError('Quotation template is unavailable.', 404);
  const layout = parseQuotationTemplate(template.content);
  await validateQuotationVariables(actor.tenantId, template.content);
  const recipient = await readRecipient(actor, draft);
  await assertProductCatalogEnabled(prisma, actor.tenantId);
  const products = await prisma.productInterest.findMany({ where: { tenantId: actor.tenantId, active: true, id: { in: draft.products.map(row => row.productId) } } });
  if (products.length !== draft.products.length) throw new AppError('A selected Product is unavailable. Review the Products step.', 400);
  const lines = draft.products.map(row => {
    const product = products.find(product => product.id === row.productId)!;
    const unit = new Prisma.Decimal(product.dealValue);
    if (unit.isNegative()) throw new AppError('Product values must not be negative.', 400);
    return { name: product.name, description: product.description, quantity: row.quantity, unitPrice: unit.toFixed(2), total: unit.mul(row.quantity).toFixed(2) };
  });
  const total = lines.reduce((sum, row) => sum.add(row.total), new Prisma.Decimal(0));
  if (total.greaterThan(Number.MAX_SAFE_INTEGER / 100)) throw new AppError('The quotation total is too large.', 400);
  const [organization, sender, catalog] = await Promise.all([getOrganizationSettings(actor.tenantId),
    prisma.user.findFirst({ where: { id: actor.userId, tenantId: actor.tenantId, status: 'ACTIVE' }, select: { firstName: true, lastName: true, email: true, jobTitle: true } }),
    campaignFieldsForAudienceSource(actor.tenantId, draft.recipientType === 'Lead' ? 'LEADS' : 'CONTACTS')]);
  if (!sender) throw new AppError('The current sender is unavailable.', 403);
  const required = new Set(campaignVariableKeys([layout.header, layout.introduction, layout.footer, draft.notes].join('\n')));
  const directFields = catalog.filter(field => field.module === (draft.recipientType === 'Lead' ? 'leads' : 'contacts'));
  const values = { ...personalized(recipient, directFields, actor.tenantId, required).values,
    fullName: `${recipient.firstName} ${recipient.lastName}`.trim(), accountName: recipient.account?.name ?? '', accountAddress: recipient.account?.address ?? '',
    sender_name: `${sender.firstName} ${sender.lastName}`.trim(), sender_email: sender.email, sender_job_title: sender.jobTitle ?? '',
    organizationName: organization.name, organizationAddress: organization.address ?? '', organizationEmail: organization.email ?? '', organizationPhone: organization.phone ?? '',
    quotationNumber: quotationNumber(draft.quotationId, draft.quotationDate), quotationDate: draft.quotationDate, validUntil: draft.validUntil, total: formatMoney(total.toFixed(2), '₱', 2) };
  const choices = quotationVariableChoices(await campaignVariableFields(actor.tenantId), draft.recipientType === 'Lead' ? 'LEADS' : 'CONTACTS');
  const approved = new Set(choices.filter(choice => choice.personalizationAvailable).map(choice => choice.technicalKey));
  const unknown = [...required].filter(key => !approved.has(key));
  if (unknown.length) throw new AppError(`Unavailable quotation variables: ${unknown.join(', ')}.`, 400);
  if ([...required].some(key => key === 'accountName' || key === 'accountAddress') && !recipient.account) throw new AppError('This quotation requires a visible linked Account. Repair the relationship or remove its variables.', 400);
  const document: QuotationDocument = { quotationTitle: layout.quotationTitle, header: renderEmailVariables(layout.header, values), introduction: renderEmailVariables(layout.introduction, values),
    footer: renderEmailVariables(layout.footer, values), notes: renderEmailVariables(draft.notes, values), number: values.quotationNumber, date: draft.quotationDate, validUntil: draft.validUntil,
    recipient: { name: values.fullName, companyName: recipient.companyName ?? '', email: recipient.email ?? '', address: recipient.address ?? '' }, products: lines, total: total.toFixed(2) };
  return { draft, document, fingerprint: fingerprint({ draft, document, templateUpdatedAt: template.updatedAt, assignedUserId: recipient.assignedUserId }) };
}

export async function previewQuotation(actor: Actor, input: unknown): Promise<QuotationPreview> {
  const prepared = await buildQuotationDocument(actor, input);
  const pdf = await renderQuotationPdf(prepared.document);
  return { document: prepared.document, fingerprint: prepared.fingerprint, filename: filename(prepared.document.number), pdfBase64: pdf.toString('base64') };
}

export async function quotationTemplatePdf(tenantId: string, id: string) {
  const template = await getTemplateById(id, tenantId);
  if (template.type !== 'Quotation' || template.isArchived) throw new AppError('Quotation template is unavailable.', 404);
  const layout = parseQuotationTemplate(template.content);
  const organization = await getOrganizationSettings(tenantId);
  const values = { organizationName: organization.name, organizationAddress: organization.address ?? '', organizationEmail: organization.email ?? '', organizationPhone: organization.phone ?? '' };
  const document: QuotationDocument = { quotationTitle: layout.quotationTitle, header: renderEmailVariables(layout.header, values, false, true),
    introduction: renderEmailVariables(layout.introduction, values, false, true), footer: renderEmailVariables(layout.footer, values, false, true), notes: '',
    number: '{{quotationNumber}}', date: '', validUntil: '', recipient: { name: '{{fullName}}', companyName: '{{companyName}}', email: '{{email}}', address: '' }, products: [], total: '0.00' };
  return { data: await renderQuotationPdf(document), filename: `${template.name.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf` };
}

export async function sendQuotation(actor: Actor, input: unknown) {
  await assertPermissions(actor, ['campaigns.view', 'campaigns.send', 'products.view']);
  const data = QuotationSendSchema.parse(input);
  const { account } = await authorizedMailbox(actor.tenantId, actor.userId);
  const previous = await prisma.mailboxSendReceipt.findUnique({ where: { accountId_requestId: { accountId: account.id, requestId: data.requestId } } });
  const saved = (previous?.authorizationContext as { quotation?: MailboxQuotationContext } | null)?.quotation;
  let quotation: MailboxQuotationContext;
  if (saved) {
    if (fingerprint(saved.draft) !== fingerprint(data.draft) || saved.fingerprint !== data.fingerprint) throw new AppError('This send request belongs to different quotation content.', 409);
    await readRecipient(actor, saved.draft);
    quotation = saved;
  } else {
    const prepared = await buildQuotationDocument(actor, data.draft);
    if (prepared.fingerprint !== data.fingerprint) throw new AppError('Quotation data changed. Refresh the preview before sending.', 409, 'QUOTATION_PREVIEW_CHANGED');
    const document = prepared.document;
    if (!document.recipient.email) throw new AppError('The selected recipient needs a valid email address before sending.', 400);
    const subject = `${document.quotationTitle} ${document.number}`;
    const body = `<p>Dear ${escapeEmailHtml(document.recipient.name)},</p><p>Please find your quotation ${escapeEmailHtml(document.number)} attached.</p>`;
    quotation = { ...prepared, subject, body };
  }
  quotation = canonical(quotation);
  const pdf = await renderQuotationPdf(quotation.document);
  return sendMailboxEmail(actor.tenantId, actor.userId, { requestId: data.requestId, to: quotation.document.recipient.email, subject: quotation.subject, body: quotation.body },
    { quotation, attachments: [{ filename: filename(quotation.document.number), mimeType: 'application/pdf', data: pdf }] });
}
