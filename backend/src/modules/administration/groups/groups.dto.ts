import { z } from 'zod';

export const CreateGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer').trim(),
});

export const UpdateGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer').trim(),
});

export const GroupMemberSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

export type CreateGroupDTO = z.infer<typeof CreateGroupSchema>;
export type UpdateGroupDTO = z.infer<typeof UpdateGroupSchema>;
export type GroupMemberDTO = z.infer<typeof GroupMemberSchema>;
