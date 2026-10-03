import { expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { CreateDealSchema, ManualCreateDealSchema, UpdateDealSchema } from '../deals.dto';
import { ImportDealRowSchema } from '@leadcrm/shared';

const create = { title: 'CCTV installation', pipelineId: 'sales', stageId: 'lead', productInterestIds: ['11111111-1111-4111-8111-111111111111'] };
it('accepts create and update without retired fields', () => {
  expect(ManualCreateDealSchema.parse(create).priority).toBe('MEDIUM');
  expect(UpdateDealSchema.parse({ title: 'Updated installation', priority: 'HIGH' })).toEqual({ title: 'Updated installation', priority: 'HIGH' });
});
it.each(['confidence', 'description'])('rejects %s on create, update and import', field => {
  const value = field === 'confidence' ? 50 : 'Old field';
  expect(CreateDealSchema.safeParse({ ...create, [field]: value }).success).toBe(false);
  expect(ManualCreateDealSchema.safeParse({ ...create, [field]: value }).success).toBe(false);
  expect(UpdateDealSchema.safeParse({ [field]: value }).success).toBe(false);
  expect(ImportDealRowSchema.safeParse({ title: create.title, pipeline: 'Sales Pipeline', stage: 'Lead', [field]: String(value) }).success).toBe(false);
});
it('generated ORM models contain neither retired Deal fields nor an invitation model', () => {
  const deal = Prisma.dmmf.datamodel.models.find(model => model.name === 'Deal')!;
  expect(deal.fields.map(field => field.name)).not.toContain('description');
  expect(deal.fields.map(field => field.name)).not.toContain('confidence');
  expect(Prisma.dmmf.datamodel.models.map(model => model.name)).not.toContain('TenantInvitation');
});
