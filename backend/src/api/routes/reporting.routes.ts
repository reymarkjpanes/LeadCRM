import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import { authorize } from '../middleware/rbac.middleware';
import * as reportController from '../../modules/reporting/reports/reports.controller';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(workspaceReadyMiddleware);

// Dashboard aggregates and campaign reporting have separate permissions.
router.get('/pipeline-summary',  authorize('dashboard.view'), reportController.getPipelineSummary);
router.get('/deal-velocity',     authorize('dashboard.view'), reportController.getDealVelocity);
router.get('/contact-status',    authorize('dashboard.view'), reportController.getContactStatusBreakdown);
router.get('/task-completion',   authorize('dashboard.view'), reportController.getTaskCompletion);
router.get('/campaign-summary',  authorize('campaigns.view_reports'), reportController.getCampaignSummary);

export default router;
