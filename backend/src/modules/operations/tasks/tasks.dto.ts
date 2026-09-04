import { z } from 'zod';

const id = () => z.string().min(1);

export const CreateTaskSchema = z.object({
  title:          z.string().min(1).max(255),
  description:    z.string().optional(),
  status:         z.enum(['pending', 'in_progress', 'blocked', 'completed', 'cancelled']).default('pending'),
  priority:       z.enum(['Low', 'Medium', 'High']).default('Medium'),
  dueDate:        z.string().datetime(),
  reminderAt:     z.string().datetime().optional(),
  dealId:         id().optional(),
  leadId:         id().optional(),
  assignedUserId: id(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial();

export const CompleteTaskSchema = z.object({
  completedAt: z.string().datetime().optional(),
});

export type CreateTaskDto   = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskDto   = z.infer<typeof UpdateTaskSchema>;
export type CompleteTaskDto = z.infer<typeof CompleteTaskSchema>;
