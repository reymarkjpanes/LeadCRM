import { z } from 'zod';
import { CustomFieldValuesSchema } from '@leadcrm/shared';
import { recordName, recordText } from '../record-validation';
import { ProductInterestIdSchema, ClosedWonConfirmationSchema, DealIndustrySchema } from '@leadcrm/shared';

// ID field helper — accepts any non-empty string (UUID, CUID, or custom).
// Format validation is not a business rule; referential integrity is enforced by the DB.
const id = () => z.string().min(1);

export const CreateDealSchema = z.object({
  customFieldValues: CustomFieldValuesSchema.optional(),
  productInterestOther: recordText(1000).nullable().optional(),
  productInterestIds: z.array(ProductInterestIdSchema).min(1).max(100).transform(ids => [...new Set(ids)]).optional(),
  productInterestId: ProductInterestIdSchema.optional(),
  pipelineId:        id(),
  stageId:           id(),
  title:             recordName(255),
  value:             z.number().finite().nonnegative().max(999_999_999_999).optional(),
  currency:          z.string().default('PHP'),
  priority:          z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  expectedCloseDate: z.string().datetime().optional(),
  leadSource:        recordText(255).optional(),
  accountId:         id().optional(),
  assignedUserId:    id().optional(),
  contactIds:        z.array(id()).optional(),
  leadIds:           z.array(id()).optional(),
  industry:          recordText(255).optional(),
  address:           recordText().optional(),
  productInterests:  z.array(z.string().trim().min(1).max(200)).max(100).optional(),
}).strict();

// Manual creation accepts catalog IDs; the singular ID remains supported for existing clients.
export const ManualCreateDealSchema = CreateDealSchema.extend({ productInterests: z.never().optional(), industry: DealIndustrySchema.optional() }).refine(data => {
  const ids = [...new Set(data.productInterestIds ?? (data.productInterestId ? [data.productInterestId] : []))];
  return ids.length === 1 && (!data.productInterestId || data.productInterestId === ids[0]);
}, { path: ['productInterestIds'], message: 'Select exactly one Product Interest per Deal.' });

// DI-2 fix: stageId is explicitly excluded from updates.
// Stage changes MUST go through PATCH /deals/:id/stage (moveDealStage) to ensure
// history, audit, activity, and workflow triggers fire on every transition.
export const UpdateDealSchema = CreateDealSchema.omit({ stageId: true, pipelineId: true, productInterestId: true }).partial().extend({
  accountId: id().nullable().optional(),
  assignedUserId: id().nullable().optional(),
  expectedCloseDate: z.string().datetime().nullable().optional(),
});

export const DealHandoffSchema = z.object({
  assignOwnerId:      id().optional(),
  kickoffDate:        z.string().datetime().optional(),
  notes:              z.string().optional(),
});

export const MoveDealStageSchema = z.object({
  confirmation: ClosedWonConfirmationSchema.optional(),
  stageId:    id(),
  note:       z.string().optional(),
  lostReason: z.string().trim().max(2000).optional(),
  handoff:    DealHandoffSchema.optional(),
});

// --- Bulk Operation Schemas ---

export const BulkArchiveSchema = z.object({
  dealIds:       z.array(z.string().min(1)).min(1).max(50),
  archiveReason: z.string().optional(),
});

export const BulkReassignSchema = z.object({
  dealIds:        z.array(z.string().min(1)).min(1).max(50),
  assignedUserId: z.string().min(1),
});

export const BulkStageChangeSchema = z.object({
  dealIds:    z.array(z.string().min(1)).min(1).max(50),
  stageId:    z.string().min(1),
  note:       z.string().optional(),
  lostReason: z.string().trim().max(2000).optional(),
});

// --- Inferred Types ---

export const DealsQuerySchema = z.object({
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(25),
  sortBy:         z.enum(['title', 'value', 'priority', 'expectedCloseDate', 'createdAt', 'updatedAt', 'stageId']).optional(),
  sortOrder:      z.enum(['asc', 'desc']).default('desc'),
  search:         z.string().optional(),
  stageId:        z.string().min(1).optional(),
  pipelineId:     z.string().min(1).optional(),
  priority:       z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  assignedUserId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(), // deprecated alias — maps to accountId in repository
  accountId:      z.string().min(1).optional(),
  contactId:      z.string().min(1).optional(),
  leadId:         z.string().min(1).optional(),
  dateFrom:       z.string().datetime().optional(),
  dateTo:         z.string().datetime().optional(),
  archived:       z.enum(['true', 'false']).default('false'),
  groupByStage:   z.enum(['true', 'false']).optional(),
}).superRefine((query, context) => {
  if (query.accountId && query.organizationId && query.accountId !== query.organizationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['accountId'], message: 'Account and legacy organization filters must identify the same Account.' });
  }
});

export type DealsQueryParams = z.infer<typeof DealsQuerySchema>;

export type CreateDealDto    = z.infer<typeof CreateDealSchema>;
export type UpdateDealDto    = z.infer<typeof UpdateDealSchema>;
export type MoveDealStageDto = z.infer<typeof MoveDealStageSchema>;
export type BulkArchiveDto      = z.infer<typeof BulkArchiveSchema>;
export type BulkReassignDto     = z.infer<typeof BulkReassignSchema>;
export type BulkStageChangeDto  = z.infer<typeof BulkStageChangeSchema>;
