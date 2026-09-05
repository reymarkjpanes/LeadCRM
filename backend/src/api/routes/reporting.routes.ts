import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware } from '../middleware/tenant.middleware';
import { subscriptionGate } from '../middleware/subscription-gate.middleware';
import { authorize } from '../middleware/rbac.middleware';
import * as reportController from '../../modules/reporting/reports/reports.controller';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(subscriptionGate);

// All reporting endpoints require reports.view permission
router.get('/pipeline-summary',  authorize('reports.view'), reportController.getPipelineSummary);
router.get('/deal-velocity',     authorize('reports.view'), reportController.getDealVelocity);
router.get('/contact-status',    authorize('reports.view'), reportController.getContactStatusBreakdown);
router.get('/task-completion',   authorize('reports.view'), reportController.getTaskCompletion);
router.get('/campaign-summary',  authorize('reports.view'), reportController.getCampaignSummary);

export default router;
