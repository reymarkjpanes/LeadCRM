// Uses a new native PostgreSQL instance with no deployment credentials or real email transport.
import { notificationTestPostgres, runNotificationTestFile } from './notification-test-postgres.mjs';
const pg = await notificationTestPostgres();
try {
  for (const [file, database] of [
    ['src/core/auth/__tests__/password-recovery.integration.test.ts', 'leadcrm_forms_test_2'],
    ['src/modules/administration/users/users-import.integration.test.ts', 'leadcrm_account_test_1'],
  ]) {
    const code = await runNotificationTestFile(file, await pg.database(database));
    if (code) process.exitCode = code;
  }
} finally { pg.stop(); }
