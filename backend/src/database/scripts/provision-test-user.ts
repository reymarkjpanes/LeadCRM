import 'dotenv/config';
import { parseArgs } from 'node:util';
import prisma from '../../config/database.config';
import { provisionTestUser } from '../../core/auth/provision-test-user.service';
import { AppError } from '../../shared/errors/app-error';

async function main() {
  const { values } = parseArgs({ options: {
    'tenant-id': { type: 'string' }, email: { type: 'string' },
    'first-name': { type: 'string' }, 'last-name': { type: 'string' }, reissue: { type: 'boolean' },
    production: { type: 'boolean' },
  } });
  const result = await provisionTestUser({
    tenantId: values['tenant-id'] ?? '', email: values.email ?? '',
    firstName: values['first-name'] ?? '', lastName: values['last-name'] ?? '', reissue: values.reissue, production: values.production,
  });
  // Only status metadata: never print credentials, hashes, or provider payloads.
  console.log(JSON.stringify(result));
  if (result.status !== 'preserved' && !result.submitted) process.exitCode = 1;
}
main().catch(error => {
  console.error(error instanceof AppError ? error.message : 'Account provisioning failed. Check the arguments and database configuration.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
