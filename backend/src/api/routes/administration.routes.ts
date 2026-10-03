import { assertPermissions } from '../../core/permissions/permission.service';
import { CreateUsersSchema, UpdateUsersSchema } from '../../modules/administration/users/users.dto';
import { passwordResetRateLimiter } from '../middleware/rate-limit.middleware';
import { Router } from 'express';
import * as dealStageAutomation from '../../modules/crm/deal-stage-automation.controller';
import * as closingRequirements from '../../modules/crm/closing-requirements/closing-requirements.controller';
import { listFields } from '../../modules/crm/closing-requirements/closing-requirements.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import { authorize, authorizeAll, authorizeAny } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';
import { UpdateOrganizationSettingsSchema } from '@leadcrm/shared';
import * as organizationSettings from '../../modules/administration/organization-settings/organization-settings.controller';
import * as productInterests from '../../modules/administration/product-interests/product-interests.controller';
import * as archivedData from '../../modules/administration/archived-data/archived-data.controller';
import * as userController       from '../../modules/administration/users/users.controller';
import * as roleController       from '../../modules/administration/roles/roles.controller';
import { CreateRoleSchema, UpdateRoleSchema, AssignRoleSchema } from '../../modules/administration/roles/roles.dto';
import * as permController       from '../../modules/administration/permissions/permissions.controller';
import * as auditController      from '../../modules/administration/audit/audit.controller';
import * as groupController      from '../../modules/administration/groups/groups.controller';
import { CreateGroupSchema, UpdateGroupSchema, GroupMemberSchema } from '../../modules/administration/groups/groups.dto';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.get('/users/:id/permissions', (req, res, next) => {
  if (req.params.id === req.user!.userId) return next();
  return workspaceReadyMiddleware(req, res, next);
}, roleController.getUserPermissions);
router.use(workspaceReadyMiddleware);
router.get('/deal-stage-automation', authorize('custom_fields.view'), dealStageAutomation.get);
router.patch('/deal-stage-automation', authorize('custom_fields.edit'), dealStageAutomation.update);
router.get('/closing-requirements', authorize('custom_fields.view'), closingRequirements.list);
router.post('/closing-requirements', authorize('custom_fields.create'), closingRequirements.create);
router.patch('/closing-requirements/:id', authorizeFieldChanges, closingRequirements.edit);

// Per-type RBAC is enforced by the archive service before querying or restoring.
router.get('/archived-data', authorize('archived_data.view'), archivedData.list);
router.patch('/archived-data/:type/:id/restore', authorize('archived_data.restore'), archivedData.restore);

router.get('/organization-settings', authorize('settings.view'), organizationSettings.get);
router.get('/product-interests', authorizeAny('products.view', 'leads.view', 'contacts.view', 'deals.view', 'forms.view'), productInterests.get);
router.get('/product-interests/:id', authorize('products.view'), productInterests.detail);
router.get('/product-interests/:id/closed-won', authorize('products.view_closed_won'), productInterests.wonDeals);
router.post('/product-interests', authorize('products.create'), productInterests.create);
router.post('/product-interests/field', authorize('products.create'), productInterests.enableField);
router.delete('/product-interests', authorize('products.archive'), productInterests.removeField);
router.patch('/product-interests/:id', authorize('products.edit'), productInterests.update);
router.delete('/product-interests/:id', authorize('products.archive'), productInterests.remove);
router.patch('/organization-settings', authorize('settings.edit'), validate(UpdateOrganizationSettingsSchema), organizationSettings.update);

// -- Users ---------------------------------------------
router.get(   '/users',                  authorize('users.view'),   userController.getAll);
router.get(   '/users/:id',              authorize('users.view'),   userController.getById);
router.get(   '/users/:id/avatar/:avatarId', authorize('users.view'), userController.getAvatar);
router.post(  '/users',                  authorize('users.create'), validate(CreateUsersSchema), authorizeUserChanges, userController.create);
router.put(   '/users/:id',              validate(UpdateUsersSchema), authorizeUserChanges, userController.update);
router.patch( '/users/:id/archive',      authorize('users.archive'), userController.archive);
router.patch( '/users/:id/restore',      authorizeAll('archived_data.restore', 'users.view'), userController.restore);
router.post(  '/users/bulk-update',      authorizeUserChanges, userController.bulkUpdate);

router.post('/users/:id/password-reset', authorize('users.edit'), passwordResetRateLimiter, userController.sendPasswordReset);

// -- Roles (RoleDefinition) ----------------------------
router.get(   '/roles',                authorize('roles.view'), roleController.getRoles);
router.get(   '/roles/:id',            authorize('roles.view'), roleController.getRoleById);
router.post(  '/roles',                authorize('roles.create'), validate(CreateRoleSchema), roleController.createRole);
router.put(   '/roles/:id',            authorize('roles.edit'), validate(UpdateRoleSchema), roleController.updateRole);
router.patch( '/roles/:id/archive',    authorize('roles.archive'), roleController.archiveRole);
router.post(  '/roles/assign',         authorize('roles.assign'), validate(AssignRoleSchema), roleController.assignRoleToUser);
router.delete('/roles/unassign',       authorize('roles.assign'), validate(AssignRoleSchema), roleController.removeRoleFromUser);

// -- Permissions (read-only reference for role builder) -
router.get(   '/permissions',          authorize('roles.view'), permController.getPermissions);

// -- Audit Log -----------------------------------------
router.get(   '/audit',                authorize('users.view'),   auditController.getAuditLogs);

// -- Groups ---------------------------------------------
router.get(   '/groups',                     authorize('groups.view'), groupController.getAll);
router.post(  '/groups',                     authorize('groups.create'), validate(CreateGroupSchema), groupController.create);
router.put(   '/groups/:id',                 authorize('groups.edit'), validate(UpdateGroupSchema), groupController.update);
router.delete('/groups/:id',                 authorize('groups.delete'), groupController.remove);
router.post(  '/groups/:id/members',         authorize('groups.edit'), validate(GroupMemberSchema), groupController.addMember);
router.delete('/groups/:id/members/:userId', authorize('groups.edit'), groupController.removeMember);


async function authorizeUserChanges(req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) {
  try {
    if (req.method !== 'POST' || req.path.endsWith('/bulk-update')) {
      const fields = Object.keys(req.body).filter(key => key !== 'ids' && key !== 'role' && key !== 'status');
      if (fields.length || (req.body.role === undefined && req.body.status === undefined)) await assertPermissions(req.user!, ['users.edit']);
    }
    if (req.body.role !== undefined) await assertPermissions(req.user!, ['roles.assign']);
    if (req.body.status !== undefined) await assertPermissions(req.user!, ['users.activate']);
    next();
  } catch (error) { next(error); }
}
async function authorizeFieldChanges(req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) {
  try {
    const onlyDisable = Object.keys(req.body).length === 1 && req.body.active === false;
    await assertPermissions(req.user!, [onlyDisable ? 'custom_fields.disable' : 'custom_fields.edit']);
    if (!onlyDisable && req.body.active === false) {
      const current = (await listFields(req.user!.tenantId)).find(field => field.id === req.params.id);
      if (current?.active) await assertPermissions(req.user!, ['custom_fields.disable']);
    }
    next();
  } catch (error) { next(error); }
}

export default router;
