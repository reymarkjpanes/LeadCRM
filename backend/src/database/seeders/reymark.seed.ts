import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_ID = 'cmrxqw7c00001aapurp97eymy'; // Rey Campany — existing real CUID tenant
const USER_ID   = 'cmrxqw7ca0003aapuxmvbxe6d'; // reymarkjpanes@gmail.com — existing real CUID user

/**
 * Cleans up old slug-ID records (rey-*) that were created before the UUID migration.
 * These have non-UUID IDs that cause Prisma validation errors on update.
 */
async function cleanupLegacyRecords() {
  console.log('[Seed] Cleaning up legacy non-UUID seeded records...');

  // Delete in dependency order (children first)
  await prisma.auditLog.deleteMany({
    where: { tenantId: TENANT_ID, id: { startsWith: 'rey-' } },
  });
  await prisma.activity.deleteMany({
    where: { tenantId: TENANT_ID, id: { startsWith: 'rey-' } },
  });
  await prisma.task.deleteMany({
    where: { tenantId: TENANT_ID, id: { startsWith: 'rey-' } },
  });
  await prisma.campaign.deleteMany({
    where: { tenantId: TENANT_ID, id: { startsWith: 'rey-' } },
  });
  await prisma.contactDeal.deleteMany({
    where: { tenantId: TENANT_ID, dealId: { startsWith: 'rey-' } },
  });
  await prisma.deal.deleteMany({
    where: { tenantId: TENANT_ID, id: { startsWith: 'rey-' } },
  });
  await prisma.stage.deleteMany({
    where: { pipelineId: 'rey-pipeline-main' },
  });
  await prisma.pipeline.deleteMany({
    where: { tenantId: TENANT_ID, id: { startsWith: 'rey-' } },
  });
  await prisma.contact.deleteMany({
    where: { tenantId: TENANT_ID, id: { startsWith: 'rey-' } },
  });
  await prisma.account.deleteMany({
    where: { tenantId: TENANT_ID, id: { startsWith: 'rey-' } },
  });

  console.log('[Seed] Legacy records removed.');
}

async function main() {
  console.log('[Seed] Seeding Rey Campany tenant data...');

  await cleanupLegacyRecords();

  // ── Pipeline + Stages (auto-UUID via @default(uuid())) ─────────────
  const pipeline = await prisma.pipeline.create({
    data: {
      tenantId: TENANT_ID,
      name: 'Sales Pipeline',
      isDefault: true,
      stages: {
        create: [
          { name: 'Lead',          order: 1, probability: 10, isDefault: true, color: '#64748b', tenantId: TENANT_ID },
          { name: 'Qualified',     order: 2, probability: 30, color: '#3b82f6', tenantId: TENANT_ID },
          { name: 'Proposal Sent', order: 3, probability: 50, color: '#f59e0b', tenantId: TENANT_ID },
          { name: 'Negotiation',   order: 4, probability: 75, color: '#8b5cf6', tenantId: TENANT_ID },
          { name: 'Closed Won',    order: 5, probability: 100, isWon: true,  color: '#10b981', tenantId: TENANT_ID },
          { name: 'Closed Lost',   order: 6, probability: 0,   isLost: true, color: '#ef4444', tenantId: TENANT_ID },
        ],
      },
    },
    include: { stages: true },
  });

  const sm = Object.fromEntries(pipeline.stages.map(s => [s.name, s]));
  console.log('[Seed] Pipeline created.');

  // ── Organizations ──────────────────────────────────────────────────
  const orgs = await Promise.all([
    prisma.account.create({ data: { tenantId: TENANT_ID, assignedUserId: USER_ID, name: 'Antigravity Solutions Inc.', industry: 'Information Technology', size: '11-50', website: 'https://antigravity.ph', address: 'BGC, Taguig, Metro Manila', country: 'Philippines', customerType: 'Active Customer' } }),
    prisma.account.create({ data: { tenantId: TENANT_ID, assignedUserId: USER_ID, name: 'Nexwave Digital', industry: 'Software Development', size: '1-10', website: 'https://nexwave.ph', address: 'Ortigas, Pasig', country: 'Philippines', customerType: 'Prospect' } }),
    prisma.account.create({ data: { tenantId: TENANT_ID, assignedUserId: USER_ID, name: 'CloudPH Telecom', industry: 'Telecommunications', size: '200+', address: 'Makati, Metro Manila', country: 'Philippines', customerType: 'Active Customer' } }),
    prisma.account.create({ data: { tenantId: TENANT_ID, assignedUserId: USER_ID, name: 'BrightPath BPO', industry: 'Business Process Outsourcing', size: '51-200', address: 'Cebu City, Cebu', country: 'Philippines', customerType: 'Prospect' } }),
    prisma.account.create({ data: { tenantId: TENANT_ID, assignedUserId: USER_ID, name: 'GreenTech Energy PH', industry: 'Renewable Energy', size: '11-50', address: 'Davao City', country: 'Philippines', customerType: 'Prospect' } }),
  ]);
  console.log('[Seed] Organizations created.');

  // ── Contacts ───────────────────────────────────────────────────────
  const contacts = await Promise.all([
    prisma.contact.create({ data: { tenantId: TENANT_ID, accountId: orgs[0].id, assignedUserId: USER_ID, ownerId: USER_ID, firstName: 'Anna', lastName: 'Reyes', email: 'anna.reyes@antigravity.ph', phone: '+63 917 100 0001', jobTitle: 'CTO', status: 'HOT', score: 91, source: 'Referral', productInterests: ['CRM Enterprise'] } }),
    prisma.contact.create({ data: { tenantId: TENANT_ID, accountId: orgs[1].id, assignedUserId: USER_ID, ownerId: USER_ID, firstName: 'Marco', lastName: 'Dela Cruz', email: 'marco@nexwave.ph', phone: '+63 918 200 0002', jobTitle: 'CEO', status: 'WARM', score: 72, source: 'LinkedIn', productInterests: ['CRM Pro'] } }),
    prisma.contact.create({ data: { tenantId: TENANT_ID, accountId: orgs[2].id, assignedUserId: USER_ID, ownerId: USER_ID, firstName: 'Patricia', lastName: 'Gomez', email: 'p.gomez@cloudph.com', phone: '+63 919 300 0003', jobTitle: 'Procurement Manager', status: 'HOT', score: 85, source: 'Cold Email', productInterests: ['Service Orders', 'CRM Enterprise'] } }),
    prisma.contact.create({ data: { tenantId: TENANT_ID, accountId: orgs[3].id, assignedUserId: USER_ID, ownerId: USER_ID, firstName: 'Luis', lastName: 'Santos', email: 'luis.santos@brightpath.ph', phone: '+63 920 400 0004', jobTitle: 'VP Operations', status: 'COLD', score: 38, source: 'Website' } }),
    prisma.contact.create({ data: { tenantId: TENANT_ID, accountId: orgs[4].id, assignedUserId: USER_ID, ownerId: USER_ID, firstName: 'Sofia', lastName: 'Villanueva', email: 'sofia.v@greentech.ph', phone: '+63 921 500 0005', jobTitle: 'Director', status: 'WARM', score: 60, source: 'Trade Show' } }),
    prisma.contact.create({ data: { tenantId: TENANT_ID, assignedUserId: USER_ID, ownerId: USER_ID, firstName: 'Jerico', lastName: 'Tan', email: 'jerico.tan@gmail.com', phone: '+63 922 600 0006', jobTitle: 'Freelance Consultant', status: 'WARM', score: 55, source: 'Website' } }),
    prisma.contact.create({ data: { tenantId: TENANT_ID, accountId: orgs[0].id, assignedUserId: USER_ID, ownerId: USER_ID, firstName: 'Camille', lastName: 'Bautista', email: 'c.bautista@antigravity.ph', phone: '+63 923 700 0007', jobTitle: 'IT Manager', status: 'HOT', score: 88, source: 'Referral', productInterests: ['Workflow Automation'] } }),
    prisma.contact.create({ data: { tenantId: TENANT_ID, accountId: orgs[2].id, assignedUserId: USER_ID, ownerId: USER_ID, firstName: 'Danilo', lastName: 'Cruz', email: 'd.cruz@cloudph.com', phone: '+63 924 800 0008', jobTitle: 'Account Executive', status: 'CLOSED', score: 95, source: 'Cold Call', customerType: 'Active Customer' } }),
  ]);
  console.log('[Seed] Contacts created.');

  // ── Deals ──────────────────────────────────────────────────────────
  const deals = await Promise.all([
    prisma.deal.create({ data: { tenantId: TENANT_ID, pipelineId: pipeline.id, stageId: sm['Proposal Sent'].id, assignedUserId: USER_ID, ownerId: USER_ID, title: 'CRM Enterprise — Antigravity', value: 380000, currency: 'PHP', priority: 'HIGH', expectedCloseDate: new Date(Date.now() + 25 * 86400000) } }),
    prisma.deal.create({ data: { tenantId: TENANT_ID, pipelineId: pipeline.id, stageId: sm['Qualified'].id,     assignedUserId: USER_ID, ownerId: USER_ID, title: 'CRM Pro — Nexwave Digital',        value: 120000, currency: 'PHP', priority: 'MEDIUM', expectedCloseDate: new Date(Date.now() + 40 * 86400000) } }),
    prisma.deal.create({ data: { tenantId: TENANT_ID, pipelineId: pipeline.id, stageId: sm['Negotiation'].id,   assignedUserId: USER_ID, ownerId: USER_ID, title: 'Service Suite — CloudPH Telecom',  value: 650000, currency: 'PHP', priority: 'HIGH',   expectedCloseDate: new Date(Date.now() + 10 * 86400000) } }),
    prisma.deal.create({ data: { tenantId: TENANT_ID, pipelineId: pipeline.id, stageId: sm['Lead'].id,          assignedUserId: USER_ID, ownerId: USER_ID, title: 'CRM Starter — BrightPath BPO',    value: 75000,  currency: 'PHP', priority: 'LOW',    expectedCloseDate: new Date(Date.now() + 55 * 86400000) } }),
    prisma.deal.create({ data: { tenantId: TENANT_ID, pipelineId: pipeline.id, stageId: sm['Closed Won'].id,    assignedUserId: USER_ID, ownerId: USER_ID, title: 'CRM Enterprise — CloudPH Won',    value: 820000, currency: 'PHP', priority: 'HIGH',   expectedCloseDate: new Date(Date.now() - 5 * 86400000) } }),
    prisma.deal.create({ data: { tenantId: TENANT_ID, pipelineId: pipeline.id, stageId: sm['Closed Lost'].id,   assignedUserId: USER_ID, ownerId: USER_ID, title: 'CRM Pro — GreenTech (Lost)',      value: 95000,  currency: 'PHP', priority: 'MEDIUM', expectedCloseDate: new Date(Date.now() - 15 * 86400000), lostReason: 'Budget constraints' } }),
  ]);
  console.log('[Seed] Deals created.');

  // ── Contact–Deal links ─────────────────────────────────────────────
  await prisma.contactDeal.createMany({
    data: [
      { tenantId: TENANT_ID, contactId: contacts[0].id, dealId: deals[0].id, addedById: USER_ID },
      { tenantId: TENANT_ID, contactId: contacts[1].id, dealId: deals[1].id, addedById: USER_ID },
      { tenantId: TENANT_ID, contactId: contacts[2].id, dealId: deals[2].id, addedById: USER_ID },
      { tenantId: TENANT_ID, contactId: contacts[3].id, dealId: deals[3].id, addedById: USER_ID },
      { tenantId: TENANT_ID, contactId: contacts[7].id, dealId: deals[4].id, addedById: USER_ID },
      { tenantId: TENANT_ID, contactId: contacts[4].id, dealId: deals[5].id, addedById: USER_ID },
    ],
    skipDuplicates: true,
  });
  console.log('[Seed] Contact-Deal links created.');

  // ── Tasks ──────────────────────────────────────────────────────────
  await prisma.task.createMany({
    data: [
      { tenantId: TENANT_ID, assignedUserId: USER_ID, assignedById: USER_ID, title: 'Follow up with Anna Reyes re: Enterprise demo', status: 'pending', priority: 'High', dueDate: new Date(Date.now() + 2 * 86400000), customerId: contacts[0].id, dealId: deals[0].id },
      { tenantId: TENANT_ID, assignedUserId: USER_ID, assignedById: USER_ID, title: 'Prepare proposal document for Nexwave', status: 'in-progress', priority: 'Medium', dueDate: new Date(Date.now() + 5 * 86400000), customerId: contacts[1].id, dealId: deals[1].id },
      { tenantId: TENANT_ID, assignedUserId: USER_ID, assignedById: USER_ID, title: 'Contract negotiation call — CloudPH', status: 'pending', priority: 'High', dueDate: new Date(Date.now() + 1 * 86400000), customerId: contacts[2].id, dealId: deals[2].id },
      { tenantId: TENANT_ID, assignedUserId: USER_ID, assignedById: USER_ID, title: 'Send onboarding docs — CloudPH Won', status: 'completed', priority: 'Medium', dueDate: new Date(Date.now() - 3 * 86400000), customerId: contacts[7].id, dealId: deals[4].id },
      { tenantId: TENANT_ID, assignedUserId: USER_ID, assignedById: USER_ID, title: 'LinkedIn outreach — Jerico Tan', status: 'pending', priority: 'Low', dueDate: new Date(Date.now() + 7 * 86400000), customerId: contacts[5].id },
    ],
  });
  console.log('[Seed] Tasks created.');

  // ── Activities ─────────────────────────────────────────────────────
  await prisma.activity.createMany({
    data: [
      { tenantId: TENANT_ID, createdById: USER_ID, type: 'call',         title: 'Discovery call with Anna Reyes',       description: 'Discussed CRM Enterprise requirements and budget.',     customerId: contacts[0].id, dealId: deals[0].id },
      { tenantId: TENANT_ID, createdById: USER_ID, type: 'email',        title: 'Proposal sent to Marco Dela Cruz',     description: 'Sent CRM Pro pricing proposal.',                        customerId: contacts[1].id, dealId: deals[1].id },
      { tenantId: TENANT_ID, createdById: USER_ID, type: 'meeting',      title: 'Product demo — CloudPH Telecom',       description: 'Conducted full product demo for procurement team.',     customerId: contacts[2].id, dealId: deals[2].id },
      { tenantId: TENANT_ID, createdById: USER_ID, type: 'note',         title: 'Note: Danilo Cruz onboarded',          description: 'Customer signed contract and onboarding started.',      customerId: contacts[7].id, dealId: deals[4].id },
      { tenantId: TENANT_ID, createdById: USER_ID, type: 'stage_change', title: 'Deal moved to Negotiation',            description: 'CloudPH deal advanced to negotiation stage.',           customerId: contacts[2].id, dealId: deals[2].id },
    ],
  });
  console.log('[Seed] Activities created.');

  // ── Campaigns ──────────────────────────────────────────────────────
  await prisma.campaign.createMany({
    data: [
      { tenantId: TENANT_ID, name: 'Q3 IT Solutions Outreach', type: 'EMAIL', status: 'ACTIVE',     subject: 'Streamline your IT workflows with LeadCRM', scheduledFor: new Date(Date.now() + 3 * 86400000) },
      { tenantId: TENANT_ID, name: 'BPO Industry Newsletter',  type: 'EMAIL', status: 'DRAFT',      subject: 'How BPO companies are using CRM to grow 3x faster' },
      { tenantId: TENANT_ID, name: 'Win-Back — Lost Deals',    type: 'EMAIL', status: 'COMPLETED',  subject: 'We have a special offer for you', scheduledFor: new Date(Date.now() - 10 * 86400000) },
    ],
  });
  console.log('[Seed] Campaigns created.');

  // ── Audit Logs ─────────────────────────────────────────────────────
  await prisma.auditLog.createMany({
    data: [
      { tenantId: TENANT_ID, userId: USER_ID, action: 'contact.created',      entityType: 'Contact',  entityId: contacts[0].id, category: 'crm',  metadata: { message: 'Contact Anna Reyes created' } },
      { tenantId: TENANT_ID, userId: USER_ID, action: 'deal.created',         entityType: 'Deal',     entityId: deals[0].id,    category: 'crm',  metadata: { message: 'Deal CRM Enterprise — Antigravity created' } },
      { tenantId: TENANT_ID, userId: USER_ID, action: 'deal.won',             entityType: 'Deal',     entityId: deals[4].id,    category: 'crm',  metadata: { message: 'Deal CRM Enterprise — CloudPH Won marked as Won' } },
      { tenantId: TENANT_ID, userId: USER_ID, action: 'deal.stage_changed',   entityType: 'Deal',     entityId: deals[2].id,    category: 'crm',  metadata: { from: 'Qualified', to: 'Negotiation' } },
    ],
  });
  console.log('[Seed] Audit logs created.');

  console.log('[Seed] ✅ All Rey Campany data seeded successfully!');
}

main()
  .catch((err) => { console.error('[Seed] ❌ Error:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
