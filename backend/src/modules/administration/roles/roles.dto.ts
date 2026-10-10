import { z } from 'zod';
import { PERMISSION_MODULES, PERMISSION_ACTIONS } from '@leadcrm/shared';

const permissionRowSchema = z.object({
  module:    z.string().refine(value => PERMISSION_MODULES.some(module => module.key === value), 'Invalid permission module'),
  canView:   z.boolean(),
  canCreate: z.boolean(),
  canEdit:   z.boolean(),
  canDelete: z.boolean(),
  canArchive: z.boolean().default(false),
  canImport: z.boolean().default(false),
  canManageStages: z.boolean().default(false),
  canComplete: z.boolean().default(false),
  canAssign: z.boolean().default(false),
  canSend: z.boolean().default(false),
  canDuplicate: z.boolean().default(false),
  canViewReports: z.boolean().default(false),
  canActivate: z.boolean().default(false),
  canViewRuns: z.boolean().default(false),
  canPublish: z.boolean().default(false),
  canViewSubmissions: z.boolean().default(false),
  canViewClosedWon: z.boolean().default(false),
  canDisable: z.boolean().default(false),
  canRestore: z.boolean().default(false),
}).strict().superRefine((row, ctx) => {
  const module = PERMISSION_MODULES.find(module => module.key === row.module);
  if (!row.canView && PERMISSION_ACTIONS.some(action => action !== 'canView' && row[action])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['canView'], message: 'View permission is required for this module' });
  }
  for (const action of PERMISSION_ACTIONS) {
    if (row[action] && module && !module.actions.includes(action)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [action], message: 'Invalid permission action for this module' });
    }
  }
});

const permissionsSchema = z.array(permissionRowSchema).refine(
  rows => new Set(rows.map(row => row.module)).size === rows.length,
  'Duplicate permission modules are not allowed',
);
const roleNameSchema = z.string().trim().min(1, 'Role name is required.').min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters');

export const CreateRoleSchema = z.object({
  name:        roleNameSchema,
  description: z.string().max(200, 'Description must be at most 200 characters').optional(),
  permissions: permissionsSchema.default([]),
}).strict();

export const UpdateRoleSchema = z.object({
  name:        roleNameSchema.optional(),
  description: z.string().max(200).optional(),
  permissions: permissionsSchema.optional(),
}).strict().refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one field must be provided' },
);

export const AssignRoleSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
  roleId: z.string().uuid('roleId must be a valid UUID'),
});

export type CreateRoleDto  = z.infer<typeof CreateRoleSchema>;
export type UpdateRoleDto  = z.infer<typeof UpdateRoleSchema>;
export type AssignRoleDto  = z.infer<typeof AssignRoleSchema>;
export type PermissionRowDto = z.infer<typeof permissionRowSchema>;
