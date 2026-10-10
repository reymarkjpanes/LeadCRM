// Disposable verification child; never invoked by the application.
const path = require('node:path'), Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  return request === '@leadcrm/shared' ? path.resolve(__dirname, '../dist/shared/src/index.js') : resolve.call(this, request, parent, isMain, options);
};
const prisma = require('../dist/backend/src/config/database.config.js').default;
const { dispatchTenantNotifications } = require('../dist/backend/src/modules/notifications/notification-events.service.js');
if (process.env.PAUSE_DELIVERY === 'true') prisma.$use(async (params, next) => {
  if (params.model === 'NotificationDelivery' && params.action === 'createMany') {
    process.send?.('delivery_paused');
    await new Promise(() => { setInterval(() => {}, 1000); });
  }
  return next(params);
});
(async () => {
  try { for(let n=0;n<100;n++) { const result=await dispatchTenantNotifications(process.env.TEST_TENANT_ID,new Date(),100); if(!result.claimed)break; } }
  finally { await prisma.$disconnect(); }
})().catch(()=>{process.exitCode=1;});
