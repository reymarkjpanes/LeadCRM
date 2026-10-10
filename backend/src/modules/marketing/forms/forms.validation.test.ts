import { describe, expect, it } from 'vitest';
import { defaultContactForm, FormDefinitionSchema, PublicSubmissionSchema, validateFormValues, withProductOptions } from '@leadcrm/shared';
const products = [{ id: 'b2855ea0-ae4f-4e7b-97fa-5d68f2a9c550', name: 'Smart Lock', dealValue: 10, active: true, createdAt: '', updatedAt: '' }];
const fields = () => withProductOptions(defaultContactForm().fields, products);
const valid = { firstName: "  Anne-Marie  ", lastName: "O'Connor", email: ' ANNE@example.com ', phone: '9123456789', productInterest: products[0].id };
describe('Forms authoritative validation', () => {
  it('creates independent default copies in the exact order', () => {
    const a = defaultContactForm(), b = defaultContactForm(); a.fields[0].label = 'Changed';
    expect(b.fields.map(f => f.label)).toEqual(['First Name','Last Name','Company','Contact Number','Email Address','Product Interest','Full Address']);
    expect(b.fields[5].options).toEqual([]);
  });
  it('normalizes identity without destroying names', () => { const r = validateFormValues(fields(), valid); expect(r.errors).toEqual({}); expect(r.values).toMatchObject({ firstName: 'Anne-Marie', lastName: "O'Connor", email: 'anne@example.com', phone: '+639123456789' }); });
  it.each(['', '   '])('rejects empty required fields (%j)', firstName => expect(validateFormValues(fields(), { ...valid, firstName }).errors.firstName).toBeTruthy());
  it.each(['8123456789', '09123456789', '+19123456789', '9123 456789', '91234567890'])('rejects invalid phone %s', phone => expect(validateFormValues(fields(), { ...valid, phone }).errors.phone).toBeTruthy());
  it('rejects unknown options, invalid email and unknown fields', () => { const r = validateFormValues(fields(), { ...valid, email: 'invalid', productInterest: 'Injected', tenantId: 'other' }); expect(Object.keys(r.errors).sort()).toEqual(['email','productInterest','tenantId']); });
  it('bounds values and rejects control characters', () => { expect(validateFormValues(fields(), { ...valid, firstName: 'a'.repeat(101), address: '\u0000' }).errors).toHaveProperty('firstName'); });
  it('rejects CSS, unsupported uploads, duplicate mappings and IDs', () => {
    const f = defaultContactForm(); f.design.generalBg = 'red; background:url(https://evil.test)'; expect(FormDefinitionSchema.safeParse(f).success).toBe(false);
    expect(FormDefinitionSchema.safeParse({ ...defaultContactForm(), fields: [{ id: 'file1', label: 'Upload', type: 'file' }] }).success).toBe(false);
    const g = defaultContactForm(); g.fields.push(g.fields[0]); expect(FormDefinitionSchema.safeParse(g).success).toBe(false);
  });
  it('whitelists envelope and UTM keys with bounded lengths', () => {
    const body = { version: 1, values: valid };
    expect(PublicSubmissionSchema.safeParse({ ...body, tenantId: 'evil' }).success).toBe(false);
    expect(PublicSubmissionSchema.safeParse({ ...body, tracking: { arbitrary: 'x' } }).success).toBe(false);
    expect(PublicSubmissionSchema.safeParse({ ...body, tracking: { utm_source: 'x'.repeat(201) } }).success).toBe(false);
  });
});
