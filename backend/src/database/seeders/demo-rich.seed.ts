import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seeds rich demo data for the Demo Corp tenant (admin@democorp.com).
 * Run with: npx ts-node src/database/seeders/demo-rich.seed.ts
 * Requires an existing Demo Corp tenant.
 */
export async function seedDemoRichData() {
  console.log('[Seed] Seeding rich demo data for Demo Corp...');

  // ── Resolve tenant and users ──────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'demo-corp' } });
  if (!tenant) throw new Error('Demo Corp tenant not found — provision the demo tenant first');

  const adminUser = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: 'admin@democorp.com' },
  });
  const salesUser = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: 'bob@democorp.com' },
  });
  if (!adminUser || !salesUser) throw new Error('Demo users not found');

  const tId = tenant.id;
  const aId = adminUser.id;
  const sId = salesUser.id;

  // ── Accounts (canonical company entity — ADR-001) ─────────────────
  const orgs = await Promise.all([
    prisma.account.upsert({
      where: { id: 'seed-org-techsol' },
      update: {},
      create: { id: 'seed-org-techsol', tenantId: tId, assignedUserId: sId, name: 'Tech Solutions Inc.', industry: 'Information Technology', size: '51-200', website: 'https://techsolutions.ph', address: 'BGC, Taguig, Metro Manila', country: 'Philippines' },
    }),
    prisma.account.upsert({
      where: { id: 'seed-org-nexus' },
      update: {},
      create: { id: 'seed-org-nexus', tenantId: tId, assignedUserId: aId, name: 'Nexus Digital Corp', industry: 'Software Development', size: '11-50', website: 'https://nexusdigital.ph', address: 'Ortigas, Pasig, Metro Manila', country: 'Philippines' },
    }),
    prisma.account.upsert({
      where: { id: 'seed-org-skynet' },
      update: {},
      create: { id: 'seed-org-skynet', tenantId: tId, assignedUserId: sId, name: 'Skynet Telecom', industry: 'Telecommunications', size: '200+', website: 'https://skynettelecom.ph', address: 'Makati CBD, Metro Manila', country: 'Philippines' },
    }),
    prisma.account.upsert({
      where: { id: 'seed-org-greenpeak' },
      update: {},
      create: { id: 'seed-org-greenpeak', tenantId: tId, assignedUserId: aId, name: 'Green Peak Energy', industry: 'Renewable Energy', size: '11-50', address: 'Cebu City, Cebu', country: 'Philippines' },
    }),
    prisma.account.upsert({
      where: { id: 'seed-org-firstbpo' },
      update: {},
      create: { id: 'seed-org-firstbpo', tenantId: tId, assignedUserId: sId, name: 'FirstBPO Services', industry: 'Business Process Outsourcing', size: '200+', website: 'https://firstbpo.com.ph', address: 'Eastwood, Quezon City', country: 'Philippines' },
    }),
  ]);

  // ── Contacts ──────────────────────────────────────────────────────
  const contacts = await Promise.all([
    prisma.contact.upsert({ where: { id: 'seed-c-1' }, update: {}, create: { id: 'seed-c-1', tenantId: tId, accountId: orgs[0].id, assignedUserId: sId, ownerId: sId, firstName: 'Maria', lastName: 'Santos', email: 'maria.santos@techsolutions.ph', phone: '+63 917 123 4567', jobTitle: 'IT Manager', status: 'HOT', score: 92, source: 'Website', productInterests: ['CRM Enterprise', 'Workflow Automation'] } }),
    prisma.contact.upsert({ where: { id: 'seed-c-2' }, update: {}, create: { id: 'seed-c-2', tenantId: tId, accountId: orgs[1].id, assignedUserId: aId, ownerId: aId, firstName: 'Carlos', lastName: 'Reyes', email: 'carlos.reyes@nexusdigital.ph', phone: '+63 918 234 5678', jobTitle: 'CEO', status: 'WARM', score: 78, source: 'Referral', productInterests: ['CRM Pro'] } }),
    prisma.contact.upsert({ where: { id: 'seed-c-3' }, update: {}, create: { id: 'seed-c-3', tenantId: tId, accountId: orgs[2].id, assignedUserId: sId, ownerId: sId, firstName: 'Ana', lastName: 'Villanueva', email: 'ana.v@skynettelecom.ph', phone: '+63 919 345 6789', jobTitle: 'Procurement Head', status: 'HOT', score: 88, source: 'Cold Email', productInterests: ['Service Orders', 'CRM Enterprise'] } }),
    prisma.contact.upsert({ where: { id: 'seed-c-4' }, update: {}, create: { id: 'seed-c-4', tenantId: tId, accountId: orgs[3].id, assignedUserId: aId, ownerId: aId, firstName: 'Diego', lastName: 'Cruz', email: 'diego.cruz@greenpeak.ph', phone: '+63 920 456 7890', jobTitle: 'Operations Director', status: 'COLD', score: 45, source: 'LinkedIn', productInterests: ['CRM Pro'] } }),
    prisma.contact.upsert({ where: { id: 'seed-c-5' }, update: {}, create: { id: 'seed-c-5', tenantId: tId, accountId: orgs[4].id, assignedUserId: sId, ownerId: sId, firstName: 'Liza', lastName: 'Mendoza', email: 'liza.mendoza@firstbpo.com.ph', phone: '+63 921 567 8901', jobTitle: 'VP Sales', status: 'CLOSED', score: 95, source: 'Trade Show', customerType: 'Active Customer', productInterests: ['CRM Enterprise', 'Marketing Pro'] } }),
    prisma.contact.upsert({ where: { id: 'seed-c-6' }, update: {}, create: { id: 'seed-c-6', tenantId: tId, assignedUserId: sId, ownerId: sId, firstName: 'Ramon', lastName: 'Garcia', email: 'ramon.garcia@gmail.com', phone: '+63 922 678 9012', jobTitle: 'Freelance Consultant', status: 'WARM', score: 62, source: 'Website' } }),
    prisma.contact.upsert({ where: { id: 'seed-c-7' }, update: {}, create: { id: 'seed-c-7', tenantId: tId, accountId: orgs[0].id, assignedUserId: sId, ownerId: aId, firstName: 'Patricia', lastName: 'Tan', email: 'patricia.tan@techsolutions.ph', phone: '+63 923 789 0123', jobTitle: 'CTO', status: 'HOT', score: 85, source: 'Referral', productInterests: ['Workflow Automation'] } }),
    prisma.contact.upsert({ where: { id: 'seed-c-8' }, update: {}, create: { id: 'seed-c-8', tenantId: tId, accountId: orgs[2].id, assignedUserId: aId, ownerId: aId, firstName: 'Miguel', lastName: 'Flores', email: 'm.flores@skynettelecom.ph', phone: '+63 924 890 1234', jobTitle: 'Account Manager', status: 'WARM', score: 70, source: 'Cold Call' } }),
  ]);

  // ── Pipeline + Stages ─────────────────────────────────────────────
  const pipeline = await prisma.pipeline.upsert({
    where: { id: 'seed-pipeline-main' },
    update: {},
    create: {
      id: 'seed-pipeline-main', tenantId: tId, name: 'Sales Pipeline', isDefault: true,
      stages: {
        create: [
          { id: 'seed-stage-lead',        name: 'Lead',          order: 1, probability: 10, isDefault: true, color: '#64748b' },
          { id: 'seed-stage-qualified',   name: 'Qualified',     order: 2, probability: 30, color: '#3b82f6' },
          { id: 'seed-stage-proposal',    name: 'Proposal Sent', order: 3, probability: 50, color: '#f59e0b' },
          { id: 'seed-stage-negotiation', name: 'Negotiation',   order: 4, probability: 75, color: '#8b5cf6' },
          { id: 'seed-stage-won',         name: 'Closed Won',    order: 5, probability: 100, isWon: true,  color: '#10b981' },
          { id: 'seed-stage-lost',        name: 'Closed Lost',   order: 6, probability: 0,   isLost: true, color: '#ef4444' },
        ],
      },
    },
    include: { stages: true },
  });

  const stageMap = Object.fromEntries(pipeline.stages.map(s => [s.id, s]));

  // ── Deals ─────────────────────────────────────────────────────────
  const deals = await Promise.all([
    prisma.deal.upsert({
      where: { id: 'seed-deal-1' },
      update: {},
      create: {
        id: 'seed-deal-1', tenantId: tId, pipelineId: pipeline.id,
        stageId: stageMap['seed-stage-proposal'].id,
        assignedUserId: sId, title: 'CRM Enterprise — Tech Solutions',
        value: 450000, currency: 'PHP', priority: 'HIGH',
        expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        contactId: contacts[0].id,
      },
    }),
    prisma.deal.upsert({
      where: { id: 'seed-deal-2' },
      update: {},
      create: {
        id: 'seed-deal-2', tenantId: tId, pipelineId: pipeline.id,
        stageId: stageMap['seed-stage-qualified'].id,
        assignedUserId: aId, title: 'CRM Pro — Nexus Digital',
        value: 180000, currency: 'PHP', priority: 'MEDIUM',
        expectedCloseDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
        contactId: contacts[1].id,
      },
    }),
    prisma.deal.upsert({
      where: { id: 'seed-deal-3' },
      update: {},
      create: {
        id: 'seed-deal-3', tenantId: tId, pipelineId: pipeline.id,
        stageId: stageMap['seed-stage-negotiation'].id,
        assignedUserId: sId, title: 'Telecom CRM Suite — Skynet',
        value: 750000, currency: 'PHP', priority: 'HIGH',
        expectedCloseDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        contactId: contacts[2].id,
      },
    }),
    prisma.deal.upsert({
      where: { id: 'seed-deal-4' },
      update: {},
      create: {
        id: 'seed-deal-4', tenantId: tId, pipelineId: pipeline.id,
        stageId: stageMap['seed-stage-lead'].id,
        assignedUserId: aId, title: 'CRM Pro — Green Peak Energy',
        value: 95000, currency: 'PHP', priority: 'LOW',
        expectedCloseDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        contactId: contacts[3].id,
      },
    }),
    prisma.deal.upsert({
      where: { id: 'seed-deal-5' },
      update: {},
      create: {
        id: 'seed-deal-5', tenantId: tId, pipelineId: pipeline.id,
        stageId: stageMap['seed-stage-won'].id,
        assignedUserId: sId, title: 'CRM Enterprise + Marketing — FirstBPO',
        value: 920000, currency: 'PHP', priority: 'HIGH',
        expectedCloseDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        contactId: contacts[4].id,
      },
    }),
  ]);

  // ── Tasks ─────────────────────────────────────────────────────────
  await Promise.all([
    prisma.task.upsert({
      where: { id: 'seed-task-1' },
      update: {},
      create: {
        id: 'seed-task-1', tenantId: tId, assignedUserId: sId, assignedById: aId,
        title: 'Follow up with Maria Santos re: Enterprise demo',
        status: 'pending', priority: 'High',
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        contactId: contacts[0].id, dealId: deals[0].id,
      },
    }),
    prisma.task.upsert({
      where: { id: 'seed-task-2' },
      update: {},
      create: {
        id: 'seed-task-2', tenantId: tId, assignedUserId: aId, assignedById: aId,
        title: 'Prepare proposal for Nexus Digital',
        status: 'in_progress', priority: 'Medium',
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        contactId: contacts[1].id, dealId: deals[1].id,
      },
    }),
    prisma.task.upsert({
      where: { id: 'seed-task-3' },
      update: {},
      create: {
        id: 'seed-task-3', tenantId: tId, assignedUserId: sId, assignedById: sId,
        title: 'Contract review call — Skynet Telecom',
        status: 'pending', priority: 'High',
        dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        contactId: contacts[2].id, dealId: deals[2].id,
      },
    }),
    prisma.task.upsert({
      where: { id: 'seed-task-4' },
      update: {},
      create: {
        id: 'seed-task-4', tenantId: tId, assignedUserId: aId, assignedById: aId,
        title: 'Send onboarding documentation — FirstBPO',
        status: 'completed', priority: 'Medium',
        dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        contactId: contacts[4].id, dealId: deals[4].id,
      },
    }),
  ]);

  // ── Audit Logs ────────────────────────────────────────────────────
  await Promise.all([
    prisma.auditLog.upsert({
      where: { id: 'seed-audit-1' },
      update: {},
      create: {
        id: 'seed-audit-1', tenantId: tId, userId: aId,
        action: 'contact.created', entityType: 'Contact', entityId: contacts[0].id,
        category: 'crm',
        metadata: { message: 'Contact Maria Santos created' },
      },
    }),
    prisma.auditLog.upsert({
      where: { id: 'seed-audit-2' },
      update: {},
      create: {
        id: 'seed-audit-2', tenantId: tId, userId: sId,
        action: 'deal.stage_changed', entityType: 'Deal', entityId: deals[0].id,
        category: 'crm',
        metadata: { message: 'Deal moved to Proposal Sent stage' },
      },
    }),
    prisma.auditLog.upsert({
      where: { id: 'seed-audit-3' },
      update: {},
      create: {
        id: 'seed-audit-3', tenantId: tId, userId: aId,
        action: 'deal.won', entityType: 'Deal', entityId: deals[4].id,
        category: 'crm',
        metadata: { message: 'Deal CRM Enterprise + Marketing — FirstBPO marked Won' },
      },
    }),
  ]);

  console.log('[Seed] Rich demo data seeded successfully.');
}

// ── Standalone runner ────────────────────────────────────────────
if (require.main === module) {
  seedDemoRichData()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
