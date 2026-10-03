// Local visual verification against scripts/test-sales-db.mjs --preview only.
import { FORM_PRODUCT_INTERESTS } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import app from '../../../app';
import { hash } from 'bcryptjs';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { createAssignedLead, productConfiguration, salesTransaction } from './lead-automation.service';
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/leadcrm_forms_test_2') throw new Error('Disposable database required');
  const tenant = await prisma.tenant.create({ data: { name: 'Sales UI test', slug: 'sales-ui-test', onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, email: 'sales-ui@camxian.com', firstName: 'Sales', lastName: 'Tester', role: 'Client Admin', emailVerified: new Date(), mustChangePassword: false, passwordHash: await hash('SalesPreview!2026', 10) } });
  const role = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Sales Agent' } });
  for (const module of ['leads', 'contacts', 'deals']) await prisma.rolePermission.create({ data: { tenantId: tenant.id, roleId: role.id, module, canView: true, canCreate: true, canEdit: true } });
  const agent = await prisma.user.create({ data: { tenantId: tenant.id, email: 'agent-ui@camxian.com', firstName: 'Alex', lastName: 'Santos', role: role.name } });
  await prisma.userRole.create({ data: { tenantId: tenant.id, userId: agent.id, roleId: role.id } });
  await tenantContext.run({ tenantId: tenant.id, }, () => salesTransaction(async tx => {
    await tx.productInterest.createMany({ data: FORM_PRODUCT_INTERESTS.map(name => ({ tenantId: tenant.id, name, dealValue: 1250.75 })) });
    await createAssignedLead(tx, { tenantId: tenant.id, firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@example.test', phone: '+639123456789', companyName: 'Example Company', productInterest: ['Smart Lock', 'CCTV Surveillance System', 'Biometrics'] }, admin.id);
  }));
  app.listen(4101, '127.0.0.1', () => console.log('Sales UI preview API :4101 ready.'));
}
void main().catch(error => { console.error(error); process.exit(1); });
