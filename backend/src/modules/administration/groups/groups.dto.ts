import { z } from 'zod';
import { CreateGroupSchema, UpdateGroupSchema } from '@leadcrm/shared';
export { CreateGroupSchema, UpdateGroupSchema };

export const GroupMemberSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

export type CreateGroupDTO = z.infer<typeof CreateGroupSchema>;
export type UpdateGroupDTO = z.infer<typeof UpdateGroupSchema>;
export type GroupMemberDTO = z.infer<typeof GroupMemberSchema>;
