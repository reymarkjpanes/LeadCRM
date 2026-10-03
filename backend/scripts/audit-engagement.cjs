// Read-only diagnostic: explicit tenant and customer arguments, no provider calls or mutations.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ log: [] });
const [tenantId, email] = process.argv.slice(2);
if (!tenantId || !email) throw new Error('Usage: node audit-engagement.cjs <tenantId> <customerEmail>');
db.$transaction(async tx => {
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const leads = await tx.lead.findMany({ where: { tenantId, email: { equals: email, mode: 'insensitive' } }, select: { id: true, status: true, createdAt: true, lastStatusChangedAt: true, engagementEvaluatedAt: true } });
  const messages = await tx.mailboxMessage.findMany({ where: { tenantId, leadId: { in: leads.map(l => l.id) } }, orderBy: { sentAt: 'asc' }, select: { id: true, direction: true, body: true, meaningful: true, readyToClose: true, sentAt: true, dealId: true, account: { select: { connectedAt: true } } } });
  console.log(JSON.stringify({ leads, messages }, null, 2));
}, { timeout: 25000 }).catch(error => { console.error(error.code || error.name); process.exitCode = 1; }).finally(() => db.$disconnect());
