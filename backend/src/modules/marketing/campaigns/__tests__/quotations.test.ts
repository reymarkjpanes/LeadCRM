import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { campaignFields, campaignVariableChoices, defaultQuotationContent, MarketingTemplateSchema, QuotationDraftSchema, quotationVariableChoices, renderEmailVariables } from '@leadcrm/shared';
import { DEFAULT_QUOTATION_TEMPLATES } from '../../templates/default-templates';

const draft = () => ({ quotationId: randomUUID(), templateId: randomUUID(), recipientType: 'Lead', recipientId: randomUUID(), products: [{ productId: randomUUID(), quantity: 2 }], quotationDate: '2026-10-18', validUntil: '2026-11-18', notes: '' });
it('validates all six starters without changing Email/SMS requirements', () => {
  expect(DEFAULT_QUOTATION_TEMPLATES).toHaveLength(6);
  for (const template of DEFAULT_QUOTATION_TEMPLATES) expect(MarketingTemplateSchema.safeParse(template).success).toBe(true);
  expect(MarketingTemplateSchema.safeParse({ name: 'Email', type: 'Email', content: 'Hello' }).success).toBe(false);
  expect(MarketingTemplateSchema.safeParse({ name: 'SMS', type: 'SMS', content: 'Hello' }).success).toBe(true);
  expect(MarketingTemplateSchema.safeParse({ name: 'Quote', type: 'Quotation', content: '{}' }).success).toBe(false);
  expect(MarketingTemplateSchema.safeParse({ name: 'Quote', type: 'Quotation', category: 'Sales', content: JSON.stringify({ ...defaultQuotationContent(), tableLayout: 'builder' }) }).success).toBe(false);
});
it.each([0, -1, 1.5, Infinity, 1000001])('rejects invalid quantity %s and client prices', quantity => {
  expect(QuotationDraftSchema.safeParse({ ...draft(), products: [{ productId: randomUUID(), quantity }] }).success).toBe(false);
  expect(QuotationDraftSchema.safeParse({ ...draft(), total: 1 }).success).toBe(false);
});
it('rejects invalid dates, reversed validity, and duplicate products', () => {
  expect(QuotationDraftSchema.safeParse({ ...draft(), quotationDate: '2026-02-30' }).success).toBe(false);
  expect(QuotationDraftSchema.safeParse({ ...draft(), validUntil: '2026-10-17' }).success).toBe(false);
  const value = draft(); value.products.push(value.products[0]); expect(QuotationDraftSchema.safeParse(value).success).toBe(false);
});
it('preserves placeholders only when explicitly requested', () => {
  expect(renderEmailVariables('Dear {{firstName}}, {{organizationName}}', { organizationName: 'Issuer' }, false, true)).toBe('Dear {{firstName}}, Issuer');
  expect(renderEmailVariables('Dear {{firstName}}', {})).toBe('Dear ');
});
describe.each(['LEADS', 'CONTACTS'] as const)('%s quotation choices', source => {
  it('retains the canonical companyName and isolates context groups', () => {
    const fields = [...campaignFields('LEADS'), ...campaignFields('CONTACTS'), ...campaignFields('LEADS').map(field => ({ ...field, module: 'accounts' as const }))];
    const quotation = quotationVariableChoices(fields, source);
    expect(quotation.filter(choice => choice.technicalKey === 'companyName')).toHaveLength(1);
    expect(quotation.some(choice => choice.technicalKey === 'company' || choice.technicalKey === 'accountPhone' || choice.origins.some(origin => origin.type === 'products'))).toBe(false);
    expect(quotation.find(choice => choice.technicalKey === 'sender_name')?.category).toBe('Sender');
    expect(quotation.find(choice => choice.technicalKey === 'organizationName')?.category).toBe('Organization');
    expect(new Set(campaignVariableChoices(fields, source).map(choice => choice.category))).toEqual(new Set(['Standard Fields', 'Sender']));
  });
});
