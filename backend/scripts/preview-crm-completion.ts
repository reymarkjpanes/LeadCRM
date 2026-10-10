import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../src/config/database.config';
import { issueAuthSession } from '../src/core/auth/auth-session';
import app from '../src/app';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/leadcrm_completion_preview') throw new Error('Requires disposable preview database.');
  const tenant = await prisma.tenant.create({ data: { name: 'LeadCRM UI Verification', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Preview', lastName: 'Admin', email: 'preview@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false } });
  const session = await issueAuthSession(user);
  let leadId = '';
  for (let i = 0; i < 3; i++) {
    const createdAt = new Date(Date.now() - (3 - i) * 86400000);
    const name = ['A oldest', 'M middle', 'Z newest'][i];
    const lead = await prisma.lead.create({ data: { tenantId: tenant.id, firstName: name, lastName: 'Customer', email: `customer${i}@example.test`, assignedUserId: user.id, createdAt } });
    leadId = lead.id;
    await prisma.contact.create({ data: { tenantId: tenant.id, firstName: name, lastName: 'Contact', email: `contact${i}@example.test`, createdAt } });
    await prisma.account.create({ data: { tenantId: tenant.id, name, createdAt } });
    await prisma.task.create({ data: { tenantId: tenant.id, title: name, assignedUserId: user.id, createdAt, dueDate: new Date(Date.now() + i * 86400000) } });
    await prisma.workflow.create({ data: { tenantId: tenant.id, name, trigger: 'lead.created', actions: [], createdAt } });
    await prisma.campaign.create({ data: { tenantId: tenant.id, name, type: 'EMAIL', createdAt } });
    await prisma.user.create({ data: { tenantId: tenant.id, firstName: name, lastName: 'Staff', email: `staff${i}@example.test`, role: 'Sales Rep', status: 'ACTIVE', createdAt } });
    await prisma.account.create({ data: { tenantId: tenant.id, name: `${name} archived`, isArchived: true, deletedAt: createdAt,
      createdAt: new Date(Date.now() - (i + 10) * 86400000) } });
  }
  await prisma.notification.createMany({ data: Array.from({ length: 110 }, (_, i) => ({ tenantId: tenant.id, userId: user.id,
    title: `Customer reply ${i + 1}`, body: 'The customer requested a formal quotation for installation and purchase terms. Please review the related record.',
    type: 'customer_reply', entityType: 'Lead', entityId: leadId, createdAt: new Date(Date.now() + i) })) });
  const output = resolve('../data/outputs/crm-completion');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'preview-session.json'), JSON.stringify({ token: session.token, leadId }));
  const server = app.listen(4009, '127.0.0.1', () => console.log('Disposable CRM preview ready on 127.0.0.1:4009'));
  const stop = () => server.close(async () => { await prisma.$disconnect(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
void main();
