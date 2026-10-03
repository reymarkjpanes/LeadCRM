import * as workflowService from '../../modules/automation/workflows/workflows.service';
import { assertPermissions } from '../../core/permissions/permission.service';
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import { authorize, authorizeArchivedQuery } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';
import * as workflowController from '../../modules/automation/workflows/workflows.controller';
import * as actionController   from '../../modules/automation/actions/actions.controller';
import * as triggerController  from '../../modules/automation/triggers/triggers.controller';
import { CreateWorkflowSchema, UpdateWorkflowSchema, TestWorkflowSchema, WorkflowStateSchema } from '../../modules/automation/workflows/workflows.dto';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(workspaceReadyMiddleware);
router.use(authorizeArchivedQuery);

// ── Workflows ─────────────────────────────────────────
router.get('/workflow-options', authorize('workflows.view'), workflowController.getOptions);
router.get('/workflow-name-availability', authorize('workflows.view'), workflowController.getWorkflowNameAvailability);
router.get(   '/workflows',                   authorize('workflows.view'),     workflowController.getWorkflows);
router.get(   '/workflows/:id',               authorize('workflows.view'),     workflowController.getWorkflowById);
router.post('/workflows/:id/duplicate', authorize('workflows.duplicate'), workflowController.duplicateWorkflow);
router.post(  '/workflows',                   authorize('workflows.create'),   validate(CreateWorkflowSchema), (req, res, next) => req.body.isActive ? authorize('workflows.activate')(req, res, next) : next(), workflowController.createWorkflow);
router.post('/workflows/validate', authorize('workflows.view'), validate(CreateWorkflowSchema), workflowController.validateDraft);
router.put(   '/workflows/:id',               authorize('workflows.edit'),     validate(UpdateWorkflowSchema), async (req, _res, next) => { try { if (req.body.isActive !== undefined && req.body.isActive !== (await workflowService.getWorkflowById(String(req.params.id), req.user!.tenantId)).isActive) await assertPermissions(req.user!, ['workflows.activate']); next(); } catch (error) { next(error); } }, workflowController.updateWorkflow);
router.patch( '/workflows/:id/toggle',        authorize('workflows.activate'), validate(WorkflowStateSchema), workflowController.toggleWorkflow);
router.patch( '/workflows/:id/archive',       authorize('workflows.archive'),   workflowController.archiveWorkflow);
router.get(   '/workflows/:id/executions',    authorize('workflows.view_runs'),     workflowController.getWorkflowExecutions);
router.get('/workflows/:id/executions/:executionId', authorize('workflows.view_runs'), workflowController.getExecution);
router.post(  '/workflows/:id/test',          authorize('workflows.view'),     validate(TestWorkflowSchema), workflowController.testWorkflow);

// ── Builder reference data ────────────────────────────
router.get( '/actions',  authorize('workflows.view'), actionController.getActions);
router.get( '/triggers', authorize('workflows.view'), triggerController.getTriggers);

export default router;
