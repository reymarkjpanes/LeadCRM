import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import { authorize, authorizeAll } from '../middleware/rbac.middleware';
import * as reportController from '../../modules/reporting/reports/reports.controller';
import { dashboard, exportDashboard } from '../../modules/reporting/reports/dashboard.controller';
import { dashboardEvents } from '../../modules/reporting/reports/dashboard.events';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(workspaceReadyMiddleware);

// Dashboard aggregates and campaign reporting have separate permissions.
router.get('/dashboard', authorize('dashboard.view'), dashboard);
router.get('/dashboard/export', authorize('dashboard.view'), exportDashboard);
router.get('/dashboard/events', authorize('dashboard.view'), dashboardEvents);
router.get('/pipeline-summary',  authorizeAll('dashboard.view', 'deals.view'), reportController.getPipelineSummary);
router.get('/deal-velocity',     authorizeAll('dashboard.view', 'deals.view'), reportController.getDealVelocity);
router.get('/contact-status',    authorizeAll('dashboard.view', 'leads.view'), reportController.getContactStatusBreakdown);
router.get('/task-completion',   authorizeAll('dashboard.view', 'tasks.view'), reportController.getTaskCompletion);
router.get('/campaign-summary',  authorize('campaigns.view_reports'), reportController.getCampaignSummary);

export default router;
