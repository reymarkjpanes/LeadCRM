import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import * as notificationController from '../../modules/notifications/notifications.controller';
import { DeleteNotificationsSchema, NotificationPreferencesSchema } from '@leadcrm/shared';
import { validate } from '../middleware/validate.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(workspaceReadyMiddleware);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

router.get(   '/',          notificationController.getNotifications);
router.get('/counts', notificationController.getCounts);
router.get('/operations', notificationController.getOperations);
router.get('/preferences', notificationController.getPreferences);
router.put('/preferences', validate(NotificationPreferencesSchema), notificationController.savePreferences);
router.get('/:id/destination', notificationController.getDestination);
router.patch( '/read-all',  notificationController.markAllRead);
router.patch( '/:id/read',  notificationController.markRead);
router.delete('/', validate(DeleteNotificationsSchema), notificationController.deleteNotifications);

export default router;
