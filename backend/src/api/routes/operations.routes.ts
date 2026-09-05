import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware } from '../middleware/tenant.middleware';
import { subscriptionGate } from '../middleware/subscription-gate.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';

import * as taskController         from '../../modules/operations/tasks/tasks.controller';

import { CreateTaskSchema, UpdateTaskSchema }       from '../../modules/operations/tasks/tasks.dto';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(subscriptionGate);

// -- Tasks ---------------------------------------------
// Note: tasks use deals.* permissions since they are tightly coupled to deals
router.get(   '/tasks',                 authorize('deals.view'),   taskController.getTasks);
router.get(   '/tasks/:id',             authorize('deals.view'),   taskController.getTaskById);
router.post(  '/tasks',                 authorize('deals.create'), validate(CreateTaskSchema), taskController.createTask);
router.put(   '/tasks/:id',             authorize('deals.edit'),   validate(UpdateTaskSchema), taskController.updateTask);
router.patch( '/tasks/:id/complete',    authorize('deals.edit'),   taskController.completeTask);
router.patch( '/tasks/:id/archive',     authorize('deals.delete'), taskController.archiveTask);

export default router;
