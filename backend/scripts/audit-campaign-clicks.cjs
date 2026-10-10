// Read-only audit. Never print environment values, credentials or recipient lists.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const campaignId = process.argv[2] || 'f658e348-260f-47bf-905c-a53ee1160510';
if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(campaignId)) throw new Error('A campaign UUID is required.');
(async () => {
  const campaign = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.campaign.findUnique({ where: { id: campaignId }, select: {
      id: true, name: true, body: true, subject: true, type: true, status: true,
      recipientCount: true, sentCount: true, openedCount: true, clickedCount: true,
      emailDeliveryLogs: { select: { brevoMessageId: true, EmailEvent: { select: { eventType: true, url: true, createdAt: true } } } },
    } });
  });
  console.log(JSON.stringify({ campaign }, null, 2));
  if (!process.env.BREVO_API_KEY) { console.log('Brevo configuration unavailable locally.'); return; }
  const headers = { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' };
  const webhooks = await fetch('https://api.brevo.com/v3/webhooks?type=transactional', { headers, signal: AbortSignal.timeout(15000) });
  console.log('Brevo webhook audit HTTP', webhooks.status);
  if (webhooks.ok) {
    const result = await webhooks.json();
    console.log(JSON.stringify({ webhooks: result.webhooks?.map(item => ({ id: item.id, type: item.type, events: item.events, url: new URL(item.url).origin + new URL(item.url).pathname, authenticated: !!item.auth, batched: item.batched })) }));
  }
  for (const log of campaign?.emailDeliveryLogs ?? []) {
    if (!log.brevoMessageId) continue;
    const response = await fetch('https://api.brevo.com/v3/smtp/statistics/events?messageId=' + encodeURIComponent(log.brevoMessageId), { headers, signal: AbortSignal.timeout(15000) });
    console.log('Brevo event audit HTTP', response.status);
    if (response.ok) {
      const result = await response.json();
      console.log(JSON.stringify({ events: result.events?.map(item => ({ event: item.event, messageId: item.messageId, date: item.date, link: item.link })) }));
    }
  }
})().catch(error => { console.error('Audit failed:', error.code ?? error.name); process.exitCode = 1; }).finally(() => prisma.$disconnect());
