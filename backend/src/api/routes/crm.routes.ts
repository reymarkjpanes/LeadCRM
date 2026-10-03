import { assertPermissions } from '../../core/permissions/permission.service';
import * as activitiesService from '../../modules/crm/activities/activities.service';
import type { PermissionKey } from '@leadcrm/shared';
import { recordFilesRouter } from '../../modules/crm/record-files/record-files.routes';
import * as dealImportController from '../../modules/crm/deal-imports/deal-imports.controller';
import { CreateDealImportSchema } from '@leadcrm/shared';
import { Router } from 'express';
import * as closingRequirements from '../../modules/crm/closing-requirements/closing-requirements.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import { authorize, authorizeAll, authorizeArchivedQuery } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';

// Controllers
import * as contactController      from '../../modules/crm/contacts/contacts.controller';
import * as contactsV2Controller   from '../../modules/crm/contacts-v2/contacts-v2.controller';
import * as leadImportController   from '../../modules/crm/lead-imports/lead-imports.controller';
import * as contactImportController from '../../modules/crm/contact-imports/contact-imports.controller';
import * as accountImportController from '../../modules/crm/account-imports/account-imports.controller';
import * as companyController      from '../../modules/crm/companies/companies.controller';
import * as dealController         from '../../modules/crm/deals/deals.controller';
import * as bulkDealsController    from '../../modules/crm/deals/bulk-deals.controller';
import * as pipelineController     from '../../modules/crm/pipeline/pipeline.controller';
import * as activityController     from '../../modules/crm/activities/activities.controller';
import * as duplicateDetectionController from '../../modules/crm/duplicate-detection/duplicate-detection.controller';
import * as mergeController            from '../../modules/crm/merge/merge.controller';
import * as relationshipsController    from '../../modules/crm/relationships/relationships.controller';

// Schemas
import { CreateContactSchema, UpdateContactSchema, ConvertContactSchema } from '../../modules/crm/contacts/contacts.dto';
import { CreateLeadImportSchema } from '../../modules/crm/lead-imports/lead-imports.dto';
import { CreateContactImportSchema } from '../../modules/crm/contact-imports/contact-imports.dto';
import { CreateAccountImportSchema } from '../../modules/crm/account-imports/account-imports.dto';
import { CreateCompanySchema, UpdateCompanySchema }                       from '../../modules/crm/companies/companies.dto';
import { ManualCreateDealSchema, UpdateDealSchema, MoveDealStageSchema }        from '../../modules/crm/deals/deals.dto';
import {
  CreatePipelineSchema, UpdatePipelineSchema,
  CreateStageSchema, UpdateStageSchema, ReorderStagesSchema, ReorderDealsSchema,
} from '../../modules/crm/pipeline/pipeline.dto';
import { CreateActivitySchema, UpdateActivitySchema } from '../../modules/crm/activities/activities.dto';
import { DuplicateCheckSchema } from '../../modules/crm/duplicate-detection/duplicate-detection.dto';
import { MergePreviewSchema, MergeExecuteSchema } from '../../modules/crm/merge/merge.dto';

const router = Router();

// All CRM routes require authentication + tenant context
router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(workspaceReadyMiddleware);
router.use(authorizeArchivedQuery);
router.use(recordFilesRouter);

// ── Duplicate Detection ───────────────────────────────────────────────────
router.post(  '/duplicate-check',    validate(DuplicateCheckSchema), (req, res, next) => authorizeAll(...req.body.entityTypes.map((type: string) => `${type}s.view` as PermissionKey))(req, res, next), duplicateDetectionController.duplicateCheck);

// ── Merge ─────────────────────────────────────────────────────────────────
router.post(  '/merge/preview',      validate(MergePreviewSchema), (req, res, next) => authorize(`${req.body.entityType}s.edit` as PermissionKey)(req, res, next),  mergeController.mergePreview);
router.post(  '/merge',              validate(MergeExecuteSchema), (req, res, next) => authorizeAll(`${req.body.entityType}s.edit` as PermissionKey, `${req.body.entityType}s.archive` as PermissionKey)(req, res, next),  mergeController.mergeExecute);

// ── Leads (canonical name; /contacts kept as alias for backward compat) ──
router.get(   '/leads',              authorize('leads.view'),   contactController.getContacts);
router.get(   '/leads/imports',      authorize('leads.view'),   leadImportController.listImports);
router.get(   '/leads/imports/:importId',         authorize('leads.view'),   leadImportController.getImport);
router.get(   '/leads/imports/:importId/results', authorize('leads.view'),   leadImportController.getImportResults);
router.post(  '/leads/imports',      authorize('leads.import'), validate(CreateLeadImportSchema), leadImportController.createImport);
router.get(   '/leads/:id',          authorize('leads.view'),   contactController.getContactById);
router.post(  '/leads',              authorize('leads.create'), validate(CreateContactSchema),  contactController.createContact);
router.put(   '/leads/:id',          authorize('leads.edit'),   validate(UpdateContactSchema),  contactController.updateContact);
router.patch( '/leads/:id/archive',  authorize('leads.archive'), contactController.archiveContact);
router.patch( '/leads/:id/restore',  authorizeAll('archived_data.restore', 'leads.view'), contactController.restoreContact);
router.post(  '/leads/:id/convert',  authorize('leads.edit'), validate(ConvertContactSchema), (req, res, next) => { const keys: import('../../shared/constants/permissions').PermissionKey[] = []; if (req.body.createContact && !req.body.contactId) keys.push('contacts.create'); if (req.body.contactId) keys.push('contacts.view'); if (req.body.accountName && !req.body.accountId) keys.push('accounts.create'); if (req.body.accountId) keys.push('accounts.view'); if (req.body.createDeal && !req.body.dealId) keys.push('deals.create'); if (req.body.dealId) keys.push('deals.view'); return authorizeAll(...keys)(req,res,next); }, contactController.convertContact);
router.get(   '/leads/:id/relationships', authorize('leads.view'), relationshipsController.getLeadRelationships);

// ── Contacts (reads from Contact table, separate from Leads) ─────────────────
router.get(   '/contacts',              authorize('contacts.view'),   contactsV2Controller.getContacts);
router.get(   '/contacts/imports',      authorize('contacts.view'),   contactImportController.listImports);
router.get(   '/contacts/imports/:importId',         authorize('contacts.view'),   contactImportController.getImport);
router.get(   '/contacts/imports/:importId/results', authorize('contacts.view'),   contactImportController.getImportResults);
router.post(  '/contacts/imports',      authorize('contacts.import'), validate(CreateContactImportSchema), contactImportController.createImport);
router.get(   '/contacts/:id',          authorize('contacts.view'),   contactsV2Controller.getContactById);
router.post(  '/contacts',              authorize('contacts.create'), contactsV2Controller.createContact);
router.put(   '/contacts/:id',          authorize('contacts.edit'),   contactsV2Controller.updateContact);
router.patch( '/contacts/:id/archive',  authorize('contacts.archive'), contactsV2Controller.archiveContact);
router.patch( '/contacts/:id/restore',  authorizeAll('archived_data.restore', 'contacts.view'), contactsV2Controller.restoreContact);
router.get(   '/contacts/:id/relationships', authorize('contacts.view'), relationshipsController.getContactRelationships);

// ── Accounts (canonical name; /companies kept as alias) ──────────────────
router.get(   '/accounts',              authorize('accounts.view'),   companyController.getCompanies);
router.get(   '/accounts/imports',      authorize('accounts.view'),   accountImportController.listImports);
router.get(   '/accounts/imports/:importId',         authorize('accounts.view'),   accountImportController.getImport);
router.get(   '/accounts/imports/:importId/results', authorize('accounts.view'),   accountImportController.getImportResults);
router.post(  '/accounts/imports',      authorize('accounts.import'), validate(CreateAccountImportSchema), accountImportController.createImport);
router.get(   '/accounts/:id',          authorize('accounts.view'),   companyController.getCompanyById);
router.post(  '/accounts',              authorize('accounts.create'), validate(CreateCompanySchema), companyController.createCompany);
router.put(   '/accounts/:id',          authorize('accounts.edit'),   validate(UpdateCompanySchema), companyController.updateCompany);
router.patch( '/accounts/:id/archive',  authorize('accounts.archive'), companyController.archiveCompany);
router.patch( '/accounts/:id/restore',  authorizeAll('archived_data.restore', 'accounts.view'), companyController.restoreCompany);
router.get(   '/accounts/:id/relationships', authorize('accounts.view'), relationshipsController.getAccountRelationships);

// Backward-compat aliases
router.get(   '/companies',             authorize('accounts.view'),   companyController.getCompanies);
router.get(   '/companies/:id',         authorize('accounts.view'),   companyController.getCompanyById);
router.post(  '/companies',             authorize('accounts.create'), validate(CreateCompanySchema), companyController.createCompany);
router.put(   '/companies/:id',         authorize('accounts.edit'),   validate(UpdateCompanySchema), companyController.updateCompany);
router.patch( '/companies/:id/archive', authorize('accounts.archive'), companyController.archiveCompany);
router.patch( '/companies/:id/restore', authorizeAll('archived_data.restore', 'accounts.view'), companyController.restoreCompany);

// ── Deals ─────────────────────────────────────────────────────────────────
router.get(   '/deals',              authorize('deals.view'),   dealController.getDeals);
router.get(   '/deals/forecast',     authorize('deals.view'),   dealController.getForecast);
// Bulk operations (must be before :id routes to avoid param capture)
router.post(  '/deals/bulk/archive',  authorize('deals.archive'), bulkDealsController.bulkArchive);
router.post(  '/deals/bulk/reassign', authorize('deals.edit'),   bulkDealsController.bulkReassign);
router.post(  '/deals/bulk/stage',    authorize('deals.edit'),   bulkDealsController.bulkStageChange);
router.get('/deals/imports', authorize('deals.view'), dealImportController.listImports);
router.get('/deals/imports/:importId', authorize('deals.view'), dealImportController.getImport);
router.get('/deals/imports/:importId/results', authorize('deals.view'), dealImportController.getImportResults);
router.post('/deals/imports', authorize('deals.create'), validate(CreateDealImportSchema), dealImportController.createImport);
router.get(   '/deals/:id',          authorize('deals.view'),   dealController.getDealById);
router.get('/deals/:id/closing-requirements', authorize('deals.view'), closingRequirements.readValues);
router.patch('/deals/:id/closing-requirements', authorize('deals.edit'), closingRequirements.saveValues);
router.post(  '/deals',              authorize('deals.create'), validate(ManualCreateDealSchema),    dealController.createDeal);
router.put(   '/deals/:id',          authorize('deals.edit'),   validate(UpdateDealSchema),    dealController.updateDeal);
router.patch( '/deals/:id/stage',    authorize('deals.edit'),   validate(MoveDealStageSchema), dealController.moveDealStage);
router.patch( '/deals/:id/archive',  authorize('deals.archive'), dealController.archiveDeal);
router.patch( '/deals/:id/restore',  authorizeAll('archived_data.restore', 'deals.view'),   dealController.restoreDeal);
router.post(  '/deals/:id/duplicate', authorize('deals.create'), dealController.duplicateDeal);
router.get(   '/deals/:id/relationships', authorize('deals.view'), relationshipsController.getDealRelationships);

// ── Pipelines ─────────────────────────────────────────────────────────────
router.get(    '/pipeline-templates',              authorize('deals.view'),   pipelineController.getPipelineTemplates);
router.get(    '/pipelines',                       authorize('deals.view'),   pipelineController.getPipelines);
router.get(    '/pipelines/:id',                   authorize('deals.view'),   pipelineController.getPipelineById);
router.post(   '/pipelines',                       authorize('deals.manage_stages'), validate(CreatePipelineSchema), pipelineController.createPipeline);
router.put(    '/pipelines/:id',                   authorize('deals.manage_stages'),   validate(UpdatePipelineSchema), pipelineController.updatePipeline);
router.patch(  '/pipelines/:id/archive',           authorize('deals.manage_stages'), pipelineController.archivePipeline);
router.delete( '/pipelines/:id',                   authorize('deals.manage_stages'), pipelineController.deletePipeline);
router.post(   '/stages',                          authorize('deals.manage_stages'), validate(CreateStageSchema),    pipelineController.createStage);
router.put(    '/stages/:id',                      authorize('deals.manage_stages'),   validate(UpdateStageSchema),    pipelineController.updateStage);
router.delete( '/stages/:id',                      authorize('deals.manage_stages'), pipelineController.deleteStage);
router.patch(  '/pipelines/:id/stages/reorder',    authorize('deals.manage_stages'),   validate(ReorderStagesSchema),  pipelineController.reorderStages);
router.patch(  '/pipelines/:id/deals/reorder',     authorize('deals.edit'),   validate(ReorderDealsSchema),   pipelineController.reorderDeals);

// ── Activities ─────────────────────────────────────────────────────────────
router.get(   '/activities',     authorizeActivity,   activityController.getActivities);
router.get(   '/activities/:id', authorizeActivity,   activityController.getActivity);
router.post(  '/activities',     authorizeActivity, validate(CreateActivitySchema), activityController.createActivity);
router.put(   '/activities/:id', authorizeActivity,   validate(UpdateActivitySchema), activityController.updateActivity);
router.delete('/activities/:id', authorizeActivity, activityController.deleteActivity);

async function authorizeActivity(req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) {
  try {
    const keys = { leadId: 'leads', contactId: 'contacts', accountId: 'accounts', dealId: 'deals', taskId: 'tasks' };
    const existing = req.params.id ? await activitiesService.getActivity(String(req.params.id), req.user!.tenantId) : {};
    const input = req.method === 'GET' ? req.query : req.body;
    const modules = Object.entries(keys).filter(([key]) => (existing as Record<string, unknown>)[key] || input[key]).map(([,module]) => module);
    const required = (modules.length ? modules : Object.values(keys)).map(module => (module + (req.method === 'GET' ? '.view' : '.edit')) as PermissionKey);
    await assertPermissions(req.user!, required);
    next();
  } catch (error) { next(error); }
}

export default router;
