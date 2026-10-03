import { assertPermissions } from '../../core/permissions/permission.service';
import * as taskService from '../../modules/operations/tasks/tasks.service';
import { ValidationError } from '../../shared/errors/http-error';
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import { authorize, authorizeArchivedQuery } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';

import * as taskController         from '../../modules/operations/tasks/tasks.controller';

import { CreateTaskSchema, UpdateTaskSchema, TaskBulkSchema, TaskOptionsQuerySchema } from '../../modules/operations/tasks/tasks.dto';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(workspaceReadyMiddleware);
router.use(authorizeArchivedQuery);

// -- Tasks ---------------------------------------------
// Tasks have independent action permissions, including generic updates and bulk operations.
router.get(   '/tasks',                 authorize('tasks.view'),   taskController.getTasks);
router.get('/tasks/summary', authorize('tasks.view'), taskController.getSummary);
router.get('/tasks/options', authorize('tasks.view'), (req, res, next) => {
  const parsed = TaskOptionsQuerySchema.safeParse(req.query);
  if (!parsed.success) { next(new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid task options query.')); return; }
  const permission = parsed.data.kind === 'account' ? 'accounts.view' : parsed.data.kind === 'lead' ? 'leads.view' : parsed.data.kind === 'contact' ? 'contacts.view' : parsed.data.kind === 'user' ? 'tasks.view' : 'deals.view';
  if (parsed.data.leadIds.length) return authorize('leads.view')(req, res, error => error ? next(error) : authorize(permission)(req,res,next));
  return authorize(permission)(req, res, next);
}, taskController.getOptions);
router.post('/tasks/bulk', validate(TaskBulkSchema), (req, res, next) =>
  authorize(req.body.operation === 'archive' ? 'tasks.archive' : req.body.operation === 'complete' ? 'tasks.complete' : req.body.operation === 'assign' ? 'tasks.assign' : 'tasks.edit')(req, res, next), taskController.bulkTasks);
router.get(   '/tasks/:id',             authorize('tasks.view'),   taskController.getTaskById);
router.post(  '/tasks',                 authorize('tasks.create'), validate(CreateTaskSchema), guardTaskChanges, taskController.createTask);
router.put('/tasks/:id', authorize('tasks.view'), validate(UpdateTaskSchema), authorizeTaskUpdate, guardTaskChanges, taskController.updateTask);
router.patch( '/tasks/:id/complete',    authorize('tasks.complete'),   taskController.completeTask);
router.patch( '/tasks/:id/archive',     authorize('tasks.archive'), taskController.archiveTask);

async function authorizeTaskUpdate(req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) {
  try {
    const fields = Object.keys(req.body);
    const actionOnly = fields.length > 0 && fields.every(field => field === 'assignedUserId' || (field === 'status' && req.body.status === 'completed'));
    if (!actionOnly) await assertPermissions(req.user!, ['tasks.edit']);
    else {
      if (req.body.assignedUserId !== undefined) await assertPermissions(req.user!, ['tasks.assign']);
      if (req.body.status !== undefined) await assertPermissions(req.user!, ['tasks.complete']);
    }
    next();
  } catch (error) { next(error); }
}

async function guardTaskChanges(req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) {
  try {
    const existing = req.params.id ? await taskService.getTaskById(String(req.params.id), req.user!.tenantId) : null;
    if (req.body.assignedUserId !== undefined && req.body.assignedUserId !== (existing?.assignedUserId ?? req.user!.userId)) await assertPermissions(req.user!, ['tasks.assign']);
    if (req.body.status === 'completed' && existing?.status !== 'completed') await assertPermissions(req.user!, ['tasks.complete']);
    next();
  } catch (error) { next(error); }
}

export default router;
