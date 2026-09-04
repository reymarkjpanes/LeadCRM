import { z } from 'zod';

const id = () => z.string().min(1);

export const CreateActivitySchema = z.object({
  type:           z.enum(['call', 'meeting', 'email', 'sms', 'note', 'task', 'workflow', 'stage_change', 'deal_action', 'file_upload']),
  title:          z.string().min(1).max(255),
  description:    z.string().optional(),
  metadata:       z.any().optional(),
  contactId:      id().optional(),
  dealId:         id().optional(),
  accountId:      id().optional(),
  taskId:         id().optional(),
  invoiceId:      id().optional(),
});

export const UpdateActivitySchema = CreateActivitySchema.partial();

export type CreateActivityDto = z.infer<typeof CreateActivitySchema>;
export type UpdateActivityDto = z.infer<typeof UpdateActivitySchema>;
