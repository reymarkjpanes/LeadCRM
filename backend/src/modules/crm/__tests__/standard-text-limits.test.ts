import { expect, it } from 'vitest';
import {
  CampaignDraftSchema, CreateAdministrationUserSchema, CrmAddressSchema, CrmCompanyNameSchema,
  ImportAccountRowSchema, ImportContactRowSchema, ImportLeadRowSchema, ProductInterestSchema,
  StaffCreationEmailSchema, StaffEmailSchema, StoredWorkflowDraftSchema, TaskDescriptionSchema,
  TaskTitleSchema, WorkflowDraftSchema,
} from '@leadcrm/shared';
import { CreateCompanySchema } from '../companies/companies.dto';

it.each([
  ['Job title', CreateAdministrationUserSchema.shape.jobTitle, 100],
  ['Company name', CrmCompanyNameSchema, 255],
  ['Address', CrmAddressSchema, 500],
  ['Product name', ProductInterestSchema.shape.name, 200],
  ['Category name', ProductInterestSchema.shape.category, 100],
  ['Product description', ProductInterestSchema.shape.description, 1000],
  ['Task title', TaskTitleSchema, 255],
  ['Task description', TaskDescriptionSchema, 1000],
  ['Campaign name', CampaignDraftSchema.shape.name, 150],
  ['Email subject', CampaignDraftSchema.shape.subject, 200],
  ['Email body', CampaignDraftSchema.shape.body, 50000],
  ['Workflow name', WorkflowDraftSchema.shape.name, 255],
  ['Workflow description', WorkflowDraftSchema.shape.description, 1000],
] as const)('accepts the limit and rejects one extra character for %s', (label, schema, max) => {
  expect(schema.safeParse('A'.repeat(max)).success).toBe(true);
  const over = schema.safeParse('A'.repeat(max + 1));
  expect(over.success).toBe(false);
  if (!over.success) expect(over.error.issues[0].message).toBe(label + ' must not exceed ' + max + ' characters.');
});

it('checks final CRM import and Account addresses after consolidation', () => {
  const person = { firstName: 'Ana', lastName: 'Reyes', email: 'ana@example.com', phone: '9171234567', productInterest: '' };
  for (const schema of [ImportLeadRowSchema, ImportContactRowSchema]) {
    const row = { ...person, companyName: 'C'.repeat(255), address: 'A'.repeat(500) };
    expect(schema.safeParse(row).success).toBe(true);
    expect(schema.safeParse({ ...row, companyName: row.companyName + 'C' }).success).toBe(false);
    expect(schema.safeParse({ ...row, address: row.address + 'A' }).success).toBe(false);
  }
  for (const schema of [ImportAccountRowSchema, CreateCompanySchema]) {
    expect(schema.safeParse({ name: 'Company', address: 'A'.repeat(500) }).success).toBe(true);
    expect(schema.safeParse({ name: 'Company', address: 'A'.repeat(500), city: 'Manila' }).success).toBe(false);
  }
});

it('keeps stored workflow descriptions and general staff addresses readable', () => {
  const description = ' ' + 'A'.repeat(1001) + ' ';
  expect(StoredWorkflowDraftSchema.shape.description.parse(description)).toBe(description);
  expect(StaffEmailSchema.parse('historical@example.com')).toBe('historical@example.com');
  expect(StaffCreationEmailSchema.parse(' NEW.STAFF@GMAIL.COM ')).toBe('new.staff@gmail.com');
  expect(StaffCreationEmailSchema.parse('staff@camxian.com')).toBe('staff@camxian.com');
  expect(StaffCreationEmailSchema.safeParse('staff@sub.camxian.com').success).toBe(false);
});
