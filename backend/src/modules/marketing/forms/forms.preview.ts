// Manual UI verification only; refuses any non-disposable database.
import prisma from '../../../config/database.config';
import app from '../../../app';
import { hash } from 'bcryptjs';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { createForm, publishForm } from './forms.service';
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== '127.0.0.1' || !/^\/leadcrm_forms_test_\d+$/.test(url.pathname)) throw new Error('Disposable database required');
  const tenant = await prisma.tenant.create({ data: { name: 'Forms UI test', slug: 'forms-ui-test', onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, email: 'forms-ui@camxian.com', firstName: 'Forms', lastName: 'Tester', role: 'Client Admin', emailVerified: new Date(), mustChangePassword: false, passwordHash: await hash('FormsPreview!2026', 10) } });
  const form = await tenantContext.run({ tenantId: tenant.id, }, async () => publishForm((await createForm(tenant.id, user.id, { name: 'Contact Us' })).id, tenant.id, user.id));
  app.listen(4100, '127.0.0.1', () => console.log(`UI preview API :4100; public page /forms/${form.publicId}`));
}
void main().catch(e => { console.error(e.message); process.exit(1); });
