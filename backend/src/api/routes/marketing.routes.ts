import rateLimit from 'express-rate-limit';
import * as audienceController from '../../modules/marketing/campaigns/audiences.controller';
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import { authorize, authorizeArchivedQuery } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';
import * as campaignController from '../../modules/marketing/campaigns/campaigns.controller';
import * as templateController from '../../modules/marketing/templates/templates.controller';
import * as formController from '../../modules/marketing/forms/forms.controller';
import { CreateFormSchema, UpdateFormSchema } from '../../modules/marketing/forms/forms.dto';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(workspaceReadyMiddleware);
router.use(authorizeArchivedQuery);

const writeLimiter = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false });
const sendLimiter = rateLimit({ windowMs: 60000, limit: 5, standardHeaders: true, legacyHeaders: false });
router.get('/campaigns/metrics', authorize('campaigns.view_reports'), campaignController.getCampaignMetrics);
router.get('/audiences', authorize('campaigns.view'), audienceController.getAudiences);
router.post('/audiences/preview', authorize('campaigns.view'), writeLimiter, audienceController.previewAudience);
router.post('/audiences', authorize('campaigns.create'), writeLimiter, audienceController.createAudience);
// ── Campaigns ─────────────────────────────────────────
router.get(   '/campaigns',             authorize('campaigns.view'),   campaignController.getCampaigns);
router.get(   '/campaigns/:id',         authorize('campaigns.view'),   campaignController.getCampaignById);
router.post(  '/campaigns',             authorize('campaigns.create'), writeLimiter, campaignController.createCampaign);
router.put(   '/campaigns/:id',         authorize('campaigns.edit'), writeLimiter, campaignController.updateCampaign);
router.patch( '/campaigns/:id/send',    authorize('campaigns.send'), sendLimiter, campaignController.sendCampaign);
router.patch( '/campaigns/:id/archive', authorize('campaigns.archive'), campaignController.archiveCampaign);

// ── Templates ─────────────────────────────────────────
router.get('/campaigns/:id/report', authorize('campaigns.view_reports'), campaignController.getCampaignReport);
router.post('/campaigns/:id/duplicate', authorize('campaigns.duplicate'), writeLimiter, campaignController.duplicateCampaign);

router.get(   '/templates',             authorize('campaigns.view'),   templateController.getTemplates);
router.get(   '/templates/:id',         authorize('campaigns.view'),   templateController.getTemplateById);
router.post(  '/templates',             authorize('campaigns.create'), writeLimiter, templateController.createTemplate);
router.put(   '/templates/:id',         authorize('campaigns.edit'), writeLimiter, templateController.updateTemplate);
router.patch( '/templates/:id/archive', authorize('campaigns.archive'), templateController.archiveTemplate);

// ── Forms ──────────────────────────────────────────────
// Forms have independent permissions and retain permanent draft deletion.
router.get(   '/forms',                 authorize('forms.view'),   formController.getForms);
router.get('/forms/:id/submissions', authorize('forms.view_submissions'), formController.getSubmissions);
router.post('/forms/:id/duplicate', authorize('forms.duplicate'), writeLimiter, formController.duplicateForm);
router.get(   '/forms/:id',             authorize('forms.view'),   formController.getFormById);
router.post(  '/forms',                 authorize('forms.create'), validate(CreateFormSchema), formController.createForm);
router.put(   '/forms/:id',             authorize('forms.edit'),   validate(UpdateFormSchema), formController.updateForm);
router.patch( '/forms/:id/publish',     authorize('forms.publish'),   formController.publishForm);
router.delete('/forms/:id', authorize('forms.delete'), formController.deleteForm);
router.patch('/forms/:id/unpublish', authorize('forms.publish'), formController.unpublishForm);

export default router;
