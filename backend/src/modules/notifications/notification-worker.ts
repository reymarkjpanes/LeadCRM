import 'dotenv/config';
import prisma from '../../config/database.config';
import { startNotificationScheduler } from './notification-events.service';
import { validateEnvironment } from '../../config/validate-env';

// Dedicated worker entrypoint; the web process can disable its own worker.
validateEnvironment();
const stop = startNotificationScheduler();
const keepAlive = setInterval(() => {}, 60000);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  clearInterval(keepAlive);
  void stop().finally(() => prisma.$disconnect());
});
