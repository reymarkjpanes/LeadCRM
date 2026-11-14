import { expect, it } from 'vitest';
import { CreateClientContactSchema, UpdateClientContactSchema } from '../contacts-v2/contacts-v2.dto';
import { CreateCompanySchema, UpdateCompanySchema } from '../companies/companies.dto';
import { CreateLeadSchema, UpdateLeadSchema, CreateAdministrationUserSchema, UpdateAdministrationUserSchema, UpdateSelfProfileSchema, importRowSchemas, validateFormValues } from '@leadcrm/shared';

const invalidName = 'must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().';

it.each(['firstName', 'lastName'])('requires trimmed Contact %s on create and update', field => {
  for (const value of ['', '   ']) {
    expect(CreateClientContactSchema.safeParse({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', [field]: value }).success).toBe(false);
    expect(UpdateClientContactSchema.safeParse({ [field]: value }).success).toBe(false);
  }
  expect(UpdateClientContactSchema.parse({ [field]: '  Ada  ' })).toEqual({ [field]: 'Ada' });
  expect(UpdateClientContactSchema.safeParse({ [field]: '<b> </b>' }).success).toBe(false);
  expect(UpdateClientContactSchema.safeParse({ notes: 'Unrelated edit' }).success).toBe(true);
});

it.each(['firstName', 'lastName'] as const)('applies the shared rules to submitted %s across active schemas', field => {
  const label = field === 'firstName' ? 'First name' : 'Last name';
  const schemas = [UpdateLeadSchema, UpdateClientContactSchema, UpdateAdministrationUserSchema, UpdateSelfProfileSchema];
  for (const schema of schemas) {
    for (const value of ['John123', 'John@', 'John123@', '\tJohn', 'John\n']) {
      const result = schema.safeParse({ [field]: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]).toMatchObject({ path: [field], message: `${label} ${invalidName}` });
    }
    for (const value of ['John', 'Dela Cruz', "O'Connor", 'Anne-Marie', 'María', 'Mari\u0301a', '李', 'अर्जुन', 'O‘Connor', 'O’Connor', 'Anne‐Marie', 'Anne‑Marie']) {
      expect(schema.safeParse({ [field]: value }).success, value).toBe(true);
    }
    expect(schema.safeParse({ [field]: 'A'.repeat(100) }).success).toBe(true);
    expect(schema.safeParse({ [field]: 'A'.repeat(101) }).success).toBe(false);
  }
  const person = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '9171234567', companyName: 'Acme@123', address: '123 Main St' };
  for (const schema of [CreateLeadSchema, CreateClientContactSchema, CreateAdministrationUserSchema, importRowSchemas.leads, importRowSchemas.contacts]) {
    const input = schema === CreateAdministrationUserSchema ? { ...person, role: 'Sales', jobTitle: 'R&D 2' }
      : schema === CreateClientContactSchema ? { ...person, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } : person;
    const valid = schema === CreateAdministrationUserSchema ? { firstName: input.firstName, lastName: input.lastName, email: 'ada@camxian.com', phone: input.phone, role: 'Sales', jobTitle: 'R&D 2' } : input;
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, [field]: 'John@123' }).success).toBe(false);
  }
});

it('validates only mapped person fields in Forms and preserves unrelated text and existing limits', () => {
  for (const [mapToField, label] of [['firstName', 'First name'], ['lastName', 'Last name'], ['fullName', 'Full name']] as const) {
    const fields = [{ id: 'renamed', label: 'Your name', type: 'single-line' as const, mapToField }];
    expect(validateFormValues(fields, { renamed: 'John@1' }).errors.renamed).toBe(`${label} ${invalidName}`);
    expect(validateFormValues(fields, { renamed: 'John@' }).errors.renamed).toBe(`${label} ${invalidName}`);
    expect(validateFormValues(fields, { renamed: 'Anne-Marie O’Connor' }).errors).toEqual({});
    expect(validateFormValues(fields, { renamed: 'A'.repeat(100) }).errors).toEqual({});
    expect(validateFormValues(fields, { renamed: 'A'.repeat(101) }).errors.renamed).toBeTruthy();
  }
  for (const mapToField of [undefined, 'companyName', 'address'] as const) {
    expect(validateFormValues([{ id: 'text', label: 'Text', type: 'single-line', mapToField }], { text: 'Acme@123 & Co.' }).errors).toEqual({});
  }
  expect(UpdateClientContactSchema.safeParse({ productInterests: ['Product@123'], companyName: 'Acme@123', address: '123 Main St' }).success).toBe(true);
  expect(UpdateLeadSchema.safeParse({ companyName: 'Acme@123', address: '123 Main St' }).success).toBe(true);
});

it('requires trimmed Account Name while retaining 255 characters and partial edits', () => {
  for (const value of ['', '   ']) {
    expect(CreateCompanySchema.safeParse({ name: value }).success).toBe(false);
    expect(UpdateCompanySchema.safeParse({ name: value }).success).toBe(false);
  }
  expect(CreateCompanySchema.parse({ name: '  Camxian  ' }).name).toBe('Camxian');
  expect(UpdateCompanySchema.parse({ name: '  Camxian  ' }).name).toBe('Camxian');
  expect(UpdateCompanySchema.parse({ name: '<b> </b>' }).name).toBe('<b> </b>');
  expect(UpdateCompanySchema.safeParse({ name: 'A'.repeat(255) }).success).toBe(true);
  expect(UpdateCompanySchema.safeParse({ name: 'A'.repeat(256) }).success).toBe(false);
  expect(UpdateCompanySchema.safeParse({ notes: 'Unrelated edit' }).success).toBe(true);
});

it('does not weaken the existing Contact email requirement', () => {
  expect(CreateClientContactSchema.safeParse({ firstName: 'Ada', lastName: 'Lovelace' }).success).toBe(false);
  expect(UpdateClientContactSchema.safeParse({ email: '' }).success).toBe(false);
});
