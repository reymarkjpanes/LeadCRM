import { expect, it } from 'vitest';
import { CreateClientContactSchema, UpdateClientContactSchema } from '../contacts-v2/contacts-v2.dto';
import { CreateCompanySchema, UpdateCompanySchema } from '../companies/companies.dto';

it.each(['firstName', 'lastName'])('requires trimmed Contact %s on create and update', field => {
  for (const value of ['', '   ', '<b> </b>']) {
    expect(CreateClientContactSchema.safeParse({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', [field]: value }).success).toBe(false);
    expect(UpdateClientContactSchema.safeParse({ [field]: value }).success).toBe(false);
  }
  expect(UpdateClientContactSchema.parse({ [field]: '  Ada  ' })).toEqual({ [field]: 'Ada' });
  expect(UpdateClientContactSchema.safeParse({ notes: 'Unrelated edit' }).success).toBe(true);
});

it('requires trimmed Account Name while retaining 255 characters and partial edits', () => {
  for (const value of ['', '   ', '<b> </b>']) {
    expect(CreateCompanySchema.safeParse({ name: value }).success).toBe(false);
    expect(UpdateCompanySchema.safeParse({ name: value }).success).toBe(false);
  }
  expect(CreateCompanySchema.parse({ name: '  Camxian  ' }).name).toBe('Camxian');
  expect(UpdateCompanySchema.parse({ name: '  Camxian  ' }).name).toBe('Camxian');
  expect(UpdateCompanySchema.safeParse({ name: 'A'.repeat(255) }).success).toBe(true);
  expect(UpdateCompanySchema.safeParse({ name: 'A'.repeat(256) }).success).toBe(false);
  expect(UpdateCompanySchema.safeParse({ notes: 'Unrelated edit' }).success).toBe(true);
});

it('does not weaken the existing Contact email requirement', () => {
  expect(CreateClientContactSchema.safeParse({ firstName: 'Ada', lastName: 'Lovelace' }).success).toBe(false);
  expect(UpdateClientContactSchema.safeParse({ email: '' }).success).toBe(false);
});
