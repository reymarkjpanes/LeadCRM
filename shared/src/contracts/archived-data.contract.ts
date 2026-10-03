import { z } from 'zod';

export const ARCHIVE_TYPES = ['Lead', 'Contact', 'Account', 'Deal', 'User', 'Task', 'Campaign', 'Workflow'] as const;
export const ArchiveTypeSchema = z.enum(ARCHIVE_TYPES);
export type ArchiveType = z.infer<typeof ArchiveTypeSchema>;
export const ArchiveQuerySchema = z.object({
  type: ArchiveTypeSchema.optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(['archivedAt', 'name', 'type', 'detail']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();
// Types with no existing restore route. Other types keep their established APIs.
export const ArchiveRestoreParamsSchema = z.object({
  type: z.enum(['Pipeline', 'Role', 'Workflow', 'Campaign', 'Template', 'Task']),
  id: z.string().uuid(),
}).strict();
export interface ArchivedRecord {
  type: ArchiveType;
  id: string;
  name: string;
  detail: string;
  archivedAt: string | null;
  canRestore: boolean;
}
