import { Router, raw } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware } from '../middleware/tenant.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';
import { billingMutationRateLimiter } from '../middleware/rate-limit.middleware';
import { verificationGate } from '../middleware/verification-gate.middleware';
import { uploadSingleDocument } from '../middleware/upload.middleware';

import * as invoiceController      from '../../modules/billing/invoices/invoices.controller';
import * as paymentController      from '../../modules/billing/payments/payments.controller';
import * as subscriptionController from '../../modules/billing/subscriptions/subscriptions.controller';
import * as verificationController from '../../modules/billing/verification/verification.controller';

import {
  CreateInvoiceSchema, UpdateInvoiceSchema, MarkPaidSchema,
} from '../../modules/billing/invoices/invoices.dto';

const router = Router();

// ── PayMongo Webhook — NO auth, raw body for HMAC validation ──
// Must be registered BEFORE the json middleware is applied
router.post(
  '/webhooks/paymongo',
  raw({ type: 'application/json' }),
  paymentController.paymongoWebhook,
);

// ── All other billing routes require auth + tenant ─────
router.use(authMiddleware);
router.use(tenantMiddleware);

// ── Business Verification ─────────────────────────────────────────────────────
// Must be accessible to SANDBOX tenants before subscribing.
// billing paths are whitelisted from subscriptionGate — no additional gate needed here.
router.get(  '/verification',                                          authorize('billing.view'),   verificationController.getVerificationStatus);
router.post( '/verification/documents',                               authorize('billing.manage'), uploadSingleDocument, verificationController.uploadVerificationDocument);
router.delete('/verification/documents/:documentKey',                  authorize('billing.manage'), verificationController.removeVerificationDocument);
router.post( '/verification/submit',                                   authorize('billing.manage'), billingMutationRateLimiter, verificationController.submitVerification);
router.get(  '/verification/documents/:documentKey/file',             authorize('billing.view'),   verificationController.downloadVerificationDocument);

// ── Subscription Management (tenant self-service) ─────────────────────────────
router.get(   '/subscription',           authorize('billing.view'),   subscriptionController.getSubscription);
router.get(   '/plans',                  authorize('billing.view'),   subscriptionController.getPlans);
router.post(  '/subscription/checkout',  authorize('billing.manage'), billingMutationRateLimiter, verificationGate, subscriptionController.createCheckoutSession);
router.patch( '/subscription/upgrade',   authorize('billing.manage'), billingMutationRateLimiter, subscriptionController.upgradeSubscriptionEndpoint);
router.patch( '/subscription/downgrade', authorize('billing.manage'), billingMutationRateLimiter, subscriptionController.downgradeSubscriptionEndpoint);
router.patch( '/subscription/cancel',    authorize('billing.manage'), billingMutationRateLimiter, subscriptionController.cancelSubscription);
router.post(  '/portal-session',         authorize('billing.manage'), subscriptionController.createPortalSession);

// ── Seat Management ───────────────────────────────────────────────────────────
router.get(   '/seats',                  authorize('billing.view'),   subscriptionController.getSeats);
router.patch( '/seats',                  authorize('billing.manage'), billingMutationRateLimiter, subscriptionController.updateSeats);

// ── Invoice CRUD ──────────────────────────────────────────────────────────────
router.get(   '/invoices',               authorize('billing.view'),   invoiceController.getInvoices);
router.get(   '/invoices/:id',           authorize('billing.view'),   invoiceController.getInvoiceById);
router.post(  '/invoices',               authorize('billing.manage'), validate(CreateInvoiceSchema), invoiceController.createInvoice);
router.put(   '/invoices/:id',           authorize('billing.manage'), validate(UpdateInvoiceSchema), invoiceController.updateInvoice);
router.patch( '/invoices/:id/pay',       authorize('billing.manage'), validate(MarkPaidSchema),      invoiceController.markInvoicePaid);
router.patch( '/invoices/:id/archive',   authorize('billing.manage'), invoiceController.archiveInvoice);

export default router;
