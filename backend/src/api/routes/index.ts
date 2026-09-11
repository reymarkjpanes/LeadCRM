import { Router } from 'express';
import authRoutes from './auth.routes';
import crmRoutes from './crm.routes';
import marketingRoutes from './marketing.routes';
import operationsRoutes from './operations.routes';
import automationRoutes from './automation.routes';
import administrationRoutes from './administration.routes';
import billingRoutes from './billing.routes';
import reportingRoutes from './reporting.routes';
import integrationsRoutes from './integrations.routes';
import notificationsRoutes from './notifications.routes';
import preferencesRoutes from '../../modules/preferences/preferences.routes';
import tablePreferencesRoutes from '../../modules/preferences/table-preferences.routes';
import invitationsRoutes from '../../modules/administration/invitations/invitations.routes';
import adminRoutes from './admin.routes';

const router = Router();

// ── Health / version check ────────────────────────────────────────────────────
// Unauthenticated — used to confirm which build is running on Render.
// GET /api/v1/health  →  { status, commit, env, seedEmail }
router.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    commit:    process.env.RENDER_GIT_COMMIT ?? 'unknown',
    env:       process.env.NODE_ENV ?? 'development',
    seedEmail: process.env.SYSTEM_ADMIN_EMAIL ?? 'not-set',
  });
});

router.use('/auth', authRoutes);
router.use('/crm', crmRoutes);
router.use('/marketing', marketingRoutes);
router.use('/operations', operationsRoutes);
router.use('/automation', automationRoutes);
router.use('/administration', administrationRoutes);
router.use('/billing', billingRoutes);
router.use('/reporting', reportingRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/preferences/columns', preferencesRoutes);
router.use('/preferences/table', tablePreferencesRoutes);
router.use('/invitations', invitationsRoutes);

// ── System Admin routes (protected by systemAdminMiddleware) ──────────────────
// /api/v1/admin/*   — all billing, subscription, and plan management
// /api/v1/webhooks/* — Stripe webhook (no auth, raw body)
router.use('/admin', adminRoutes);
router.use('/webhooks', adminRoutes);

export default router;
