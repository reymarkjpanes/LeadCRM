import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CreateLeadSchema, UpdateLeadSchema, CreateDealBatchSchema } from '@leadcrm/shared';
import { CreateCompanySchema, UpdateCompanySchema } from './companies/companies.dto';
import { CreateClientContactSchema, UpdateClientContactSchema } from './contacts-v2/contacts-v2.dto';
import { ManualCreateDealSchema, UpdateDealSchema } from './deals/deals.dto';

const person = { firstName: 'Ada', lastName: 'Reyes', email: 'ada@example.test' };
const deal = { title: 'Camera installation', pipelineId: 'pipeline', stageId: 'stage', productInterestIds: [randomUUID()], leadIds: ['lead'] };
const cases = [
  { module: 'Lead', create: CreateLeadSchema, update: UpdateLeadSchema, input: person, patch: { firstName: 'Updated' } },
  { module: 'Contact', create: CreateClientContactSchema, update: UpdateClientContactSchema, input: { ...person, requestId: randomUUID() }, patch: { firstName: 'Updated' } },
  { module: 'Account', create: CreateCompanySchema, update: UpdateCompanySchema, input: { name: 'Example company' }, patch: { name: 'Updated' } },
  { module: 'Deal', create: ManualCreateDealSchema, update: UpdateDealSchema, input: deal, patch: { title: 'Updated' } },
];
it.each(cases)('$module creates and updates without an Owning Group or a default value', ({ create, update, input, patch }) => {
  expect(create.parse(input)).not.toHaveProperty('ownerGroupId');
  expect(update.parse(patch)).toEqual(patch);
});
it.each(cases)('$module rejects attempts to set or clear historical access scope', ({ create, update, input, patch }) => {
  for (const ownerGroupId of [randomUUID(), null, '']) {
    expect(create.safeParse({ ...input, ownerGroupId }).success).toBe(false);
    expect(update.safeParse({ ...patch, ownerGroupId }).success).toBe(false);
  }
});
it('creates Deal batches without Group metadata and rejects injected Group values', () => {
  const input = { ...deal, idempotencyKey: randomUUID() };
  expect(CreateDealBatchSchema.parse(input)).not.toHaveProperty('ownerGroupId');
  expect(CreateDealBatchSchema.safeParse({ ...input, ownerGroupId: randomUUID() }).success).toBe(false);
});
