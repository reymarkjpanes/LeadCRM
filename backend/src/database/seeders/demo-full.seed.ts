import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Full rich-data seeder for the Demo Corp tenant.
 * Covers: Organizations, Contacts, Pipeline+Stages, Deals, Tasks, Activities,
 *         Campaigns+Templates+TargetAudiences, Workflows,
 *         Invoices, Notifications, AuditLogs.
 *
 * Run: npm run db:seed:full
 * Safe to re-run — uses upsert where possible, skips if data already exists.
 */
export async function seedDemoFullData() {
  console.log('[Seed:Full] Starting full demo data seed...');

  // ── Resolve tenant and users ───────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'demo-corp' } });
  if (!tenant) throw new Error('Demo Corp tenant not found — run npm run db:seed:demo first');

  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: 'admin@democorp.com' } });
  const bob   = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: 'bob@democorp.com' } });
  if (!admin || !bob) throw new Error('Demo users not found — run npm run db:seed:demo first');

  const tId = tenant.id;
  const aId = admin.id;
  const bId = bob.id;

  // ── Organizations ──────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding organizations...');
  const orgs = await Promise.all([
    prisma.account.upsert({ where: { id: 'df-org-1' }, update: {}, create: { id: 'df-org-1', tenantId: tId, assignedUserId: bId, name: 'Antigravity Solutions Inc.', industry: 'Information Technology', size: '11-50', website: 'https://antigravity.ph', address: 'BGC, Taguig', city: 'Taguig', country: 'Philippines', tags: ['enterprise', 'IT'], productInterests: ['CRM Enterprise', 'Workflow Automation'] } }),
    prisma.account.upsert({ where: { id: 'df-org-2' }, update: {}, create: { id: 'df-org-2', tenantId: tId, assignedUserId: aId, name: 'Nexwave Digital Corp', industry: 'Software Development', size: '1-10', website: 'https://nexwave.ph', address: 'Ortigas, Pasig', city: 'Pasig', country: 'Philippines', tags: ['startup', 'software'] } }),
    prisma.account.upsert({ where: { id: 'df-org-3' }, update: {}, create: { id: 'df-org-3', tenantId: tId, assignedUserId: bId, name: 'CloudPH Telecom', industry: 'Telecommunications', size: '200+', address: 'Makati CBD', city: 'Makati', country: 'Philippines', tags: ['telecom', 'enterprise'], productInterests: ['Service Orders', 'CRM Enterprise'] } }),
    prisma.account.upsert({ where: { id: 'df-org-4' }, update: {}, create: { id: 'df-org-4', tenantId: tId, assignedUserId: aId, name: 'BrightPath BPO Services', industry: 'Business Process Outsourcing', size: '51-200', address: 'Cebu City', city: 'Cebu City', country: 'Philippines', tags: ['bpo', 'outsourcing'] } }),
    prisma.account.upsert({ where: { id: 'df-org-5' }, update: {}, create: { id: 'df-org-5', tenantId: tId, assignedUserId: bId, name: 'GreenTech Energy PH', industry: 'Renewable Energy', size: '11-50', address: 'Davao City', city: 'Davao City', country: 'Philippines', tags: ['energy', 'green'] } }),
    prisma.account.upsert({ where: { id: 'df-org-6' }, update: {}, create: { id: 'df-org-6', tenantId: tId, assignedUserId: aId, name: 'SecureNet Security', industry: 'Security Services', size: '51-200', address: 'Quezon City', city: 'Quezon City', country: 'Philippines', tags: ['security', 'B2B'], productInterests: ['CRM Pro', 'Service Orders'] } }),
  ]);
  console.log(`[Seed:Full] ${orgs.length} organizations seeded.`);

  // ── Contacts ───────────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding contacts...');
  const contacts = await Promise.all([
    prisma.contact.upsert({ where: { id: 'df-c-1' }, update: {}, create: { id: 'df-c-1', tenantId: tId, accountId: orgs[0].id, assignedUserId: bId, ownerId: bId, firstName: 'Anna', lastName: 'Reyes', email: 'anna.reyes@antigravity.ph', phone: '+63 917 100 0001', jobTitle: 'CTO', status: 'HOT', lifecycleStage: 'CUSTOMER', score: 91, source: 'Referral', productInterests: ['CRM Enterprise'], customerType: 'Active Customer' } }),
    prisma.contact.upsert({ where: { id: 'df-c-2' }, update: {}, create: { id: 'df-c-2', tenantId: tId, accountId: orgs[1].id, assignedUserId: aId, ownerId: aId, firstName: 'Marco', lastName: 'Dela Cruz', email: 'marco@nexwave.ph', phone: '+63 918 200 0002', jobTitle: 'CEO', status: 'WARM', lifecycleStage: 'QUALIFIED', score: 72, source: 'LinkedIn', productInterests: ['CRM Pro'] } }),
    prisma.contact.upsert({ where: { id: 'df-c-3' }, update: {}, create: { id: 'df-c-3', tenantId: tId, accountId: orgs[2].id, assignedUserId: bId, ownerId: bId, firstName: 'Patricia', lastName: 'Gomez', email: 'p.gomez@cloudph.com', phone: '+63 919 300 0003', jobTitle: 'Procurement Manager', status: 'HOT', lifecycleStage: 'CUSTOMER', score: 85, source: 'Cold Email', productInterests: ['Service Orders', 'CRM Enterprise'], customerType: 'Active Customer' } }),
    prisma.contact.upsert({ where: { id: 'df-c-4' }, update: {}, create: { id: 'df-c-4', tenantId: tId, accountId: orgs[3].id, assignedUserId: aId, ownerId: aId, firstName: 'Luis', lastName: 'Santos', email: 'luis.santos@brightpath.ph', phone: '+63 920 400 0004', jobTitle: 'VP Operations', status: 'COLD', lifecycleStage: 'LEAD', score: 38, source: 'Website' } }),
    prisma.contact.upsert({ where: { id: 'df-c-5' }, update: {}, create: { id: 'df-c-5', tenantId: tId, accountId: orgs[4].id, assignedUserId: bId, ownerId: bId, firstName: 'Sofia', lastName: 'Villanueva', email: 'sofia.v@greentech.ph', phone: '+63 921 500 0005', jobTitle: 'Director', status: 'WARM', lifecycleStage: 'CONTACT', score: 60, source: 'Trade Show' } }),
    prisma.contact.upsert({ where: { id: 'df-c-6' }, update: {}, create: { id: 'df-c-6', tenantId: tId, assignedUserId: bId, ownerId: bId, firstName: 'Jerico', lastName: 'Tan', email: 'jerico.tan@gmail.com', phone: '+63 922 600 0006', jobTitle: 'Freelance Consultant', status: 'WARM', lifecycleStage: 'LEAD', score: 55, source: 'Website' } }),
    prisma.contact.upsert({ where: { id: 'df-c-7' }, update: {}, create: { id: 'df-c-7', tenantId: tId, accountId: orgs[0].id, assignedUserId: aId, ownerId: aId, firstName: 'Camille', lastName: 'Bautista', email: 'c.bautista@antigravity.ph', phone: '+63 923 700 0007', jobTitle: 'IT Manager', status: 'HOT', lifecycleStage: 'QUALIFIED', score: 88, source: 'Referral', productInterests: ['Workflow Automation'] } }),
    prisma.contact.upsert({ where: { id: 'df-c-8' }, update: {}, create: { id: 'df-c-8', tenantId: tId, accountId: orgs[5].id, assignedUserId: bId, ownerId: bId, firstName: 'Danilo', lastName: 'Cruz', email: 'd.cruz@securenet.ph', phone: '+63 924 800 0008', jobTitle: 'Account Executive', status: 'CLOSED', lifecycleStage: 'CUSTOMER', score: 95, source: 'Cold Call', customerType: 'Active Customer' } }),
    prisma.contact.upsert({ where: { id: 'df-c-9' }, update: {}, create: { id: 'df-c-9', tenantId: tId, accountId: orgs[2].id, assignedUserId: aId, ownerId: aId, firstName: 'Maricris', lastName: 'Flores', email: 'm.flores@cloudph.com', phone: '+63 925 900 0009', jobTitle: 'Operations Head', status: 'HOT', lifecycleStage: 'QUALIFIED', score: 80, source: 'Cold Email', productInterests: ['CRM Enterprise'] } }),
    prisma.contact.upsert({ where: { id: 'df-c-10' }, update: {}, create: { id: 'df-c-10', tenantId: tId, accountId: orgs[3].id, assignedUserId: bId, ownerId: bId, firstName: 'Renato', lastName: 'Lim', email: 'renato.lim@brightpath.ph', phone: '+63 926 000 0010', jobTitle: 'Finance Manager', status: 'COLD', lifecycleStage: 'LEAD', score: 30, source: 'LinkedIn' } }),
  ]);
  console.log(`[Seed:Full] ${contacts.length} contacts seeded.`);

  // ── Pipeline + Stages ──────────────────────────────────────────────
  console.log('[Seed:Full] Seeding pipeline...');
  const pipeline = await prisma.pipeline.upsert({
    where: { id: 'df-pipeline-1' },
    update: {},
    create: {
      id: 'df-pipeline-1', tenantId: tId, name: 'IT & Telecom Sales', isDefault: true, type: 'Sales',
      stages: {
        create: [
          { id: 'df-s-1', tenantId: tId, name: 'New Inquiry',    order: 1, probability: 10,  color: '#6366f1', isDefault: true },
          { id: 'df-s-2', tenantId: tId, name: 'Contacted',      order: 2, probability: 20,  color: '#8b5cf6' },
          { id: 'df-s-3', tenantId: tId, name: 'Qualified',      order: 3, probability: 40,  color: '#0ea5e9' },
          { id: 'df-s-4', tenantId: tId, name: 'Proposal Sent',  order: 4, probability: 60,  color: '#3b82f6' },
          { id: 'df-s-5', tenantId: tId, name: 'Negotiation',    order: 5, probability: 80,  color: '#f59e0b' },
          { id: 'df-s-6', tenantId: tId, name: 'Closed Won',     order: 6, probability: 100, color: '#10b981', isWon: true },
          { id: 'df-s-7', tenantId: tId, name: 'Closed Lost',    order: 7, probability: 0,   color: '#ef4444', isLost: true },
        ],
      },
    },
    include: { stages: true },
  });
  const sm: Record<string, string> = Object.fromEntries(pipeline.stages.map(s => [s.id, s.id]));
  console.log('[Seed:Full] Pipeline seeded.');

  // ── Deals ──────────────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding deals...');
  const deals = await Promise.all([
    prisma.deal.upsert({ where: { id: 'df-d-1' }, update: {}, create: { id: 'df-d-1', tenantId: tId, pipelineId: pipeline.id, stageId: 'df-s-4', assignedUserId: bId, ownerId: bId, contactId: contacts[0].id, accountId: orgs[0].id, title: 'CRM Enterprise — Antigravity Solutions', value: 380000, currency: 'PHP', priority: 'HIGH', expectedCloseDate: new Date(Date.now() + 25 * 86400000), leadSource: 'Referral', tags: ['enterprise', 'priority'] } }),
    prisma.deal.upsert({ where: { id: 'df-d-2' }, update: {}, create: { id: 'df-d-2', tenantId: tId, pipelineId: pipeline.id, stageId: 'df-s-3', assignedUserId: aId, ownerId: aId, contactId: contacts[1].id, accountId: orgs[1].id, title: 'CRM Pro — Nexwave Digital', value: 120000, currency: 'PHP', priority: 'MEDIUM', expectedCloseDate: new Date(Date.now() + 40 * 86400000), leadSource: 'LinkedIn', tags: ['startup'] } }),
    prisma.deal.upsert({ where: { id: 'df-d-3' }, update: {}, create: { id: 'df-d-3', tenantId: tId, pipelineId: pipeline.id, stageId: 'df-s-5', assignedUserId: bId, ownerId: bId, contactId: contacts[2].id, accountId: orgs[2].id, title: 'Telecom Service Suite — CloudPH', value: 650000, currency: 'PHP', priority: 'HIGH', expectedCloseDate: new Date(Date.now() + 10 * 86400000), leadSource: 'Cold Email', tags: ['telecom', 'hot'] } }),
    prisma.deal.upsert({ where: { id: 'df-d-4' }, update: {}, create: { id: 'df-d-4', tenantId: tId, pipelineId: pipeline.id, stageId: 'df-s-1', assignedUserId: aId, ownerId: aId, contactId: contacts[3].id, accountId: orgs[3].id, title: 'CRM Starter — BrightPath BPO', value: 75000, currency: 'PHP', priority: 'LOW', expectedCloseDate: new Date(Date.now() + 55 * 86400000), leadSource: 'Website' } }),
    prisma.deal.upsert({ where: { id: 'df-d-5' }, update: {}, create: { id: 'df-d-5', tenantId: tId, pipelineId: pipeline.id, stageId: 'df-s-6', assignedUserId: bId, ownerId: bId, contactId: contacts[7].id, accountId: orgs[5].id, title: 'Security CRM — SecureNet Won', value: 820000, currency: 'PHP', priority: 'HIGH', expectedCloseDate: new Date(Date.now() - 5 * 86400000), closedAt: new Date(Date.now() - 5 * 86400000), leadSource: 'Cold Call', tags: ['won'] } }),
    prisma.deal.upsert({ where: { id: 'df-d-6' }, update: {}, create: { id: 'df-d-6', tenantId: tId, pipelineId: pipeline.id, stageId: 'df-s-7', assignedUserId: aId, ownerId: aId, contactId: contacts[4].id, accountId: orgs[4].id, title: 'CRM Pro — GreenTech (Lost)', value: 95000, currency: 'PHP', priority: 'MEDIUM', expectedCloseDate: new Date(Date.now() - 15 * 86400000), closedAt: new Date(Date.now() - 15 * 86400000), lostReason: 'Budget constraints', tags: ['lost'] } }),
    prisma.deal.upsert({ where: { id: 'df-d-7' }, update: {}, create: { id: 'df-d-7', tenantId: tId, pipelineId: pipeline.id, stageId: 'df-s-2', assignedUserId: bId, ownerId: bId, contactId: contacts[6].id, accountId: orgs[0].id, title: 'Workflow Automation — Antigravity Add-on', value: 180000, currency: 'PHP', priority: 'MEDIUM', expectedCloseDate: new Date(Date.now() + 30 * 86400000), leadSource: 'Referral' } }),
    prisma.deal.upsert({ where: { id: 'df-d-8' }, update: {}, create: { id: 'df-d-8', tenantId: tId, pipelineId: pipeline.id, stageId: 'df-s-3', assignedUserId: aId, ownerId: aId, contactId: contacts[8].id, accountId: orgs[2].id, title: 'CRM Enterprise Expansion — CloudPH Q2', value: 450000, currency: 'PHP', priority: 'HIGH', expectedCloseDate: new Date(Date.now() + 20 * 86400000), leadSource: 'Cold Email', tags: ['expansion', 'enterprise'] } }),
  ]);
  console.log(`[Seed:Full] ${deals.length} deals seeded.`);

  // ── Tasks ──────────────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding tasks...');
  await prisma.task.createMany({ skipDuplicates: true, data: [
    { id: 'df-t-1', tenantId: tId, assignedUserId: bId, assignedById: aId, title: 'Follow up with Anna Reyes — Enterprise demo', status: 'pending', priority: 'High', dueDate: new Date(Date.now() + 2 * 86400000), contactId: contacts[0].id, dealId: deals[0].id },
    { id: 'df-t-2', tenantId: tId, assignedUserId: aId, assignedById: aId, title: 'Prepare proposal for Nexwave Digital', status: 'in_progress', priority: 'Medium', dueDate: new Date(Date.now() + 5 * 86400000), contactId: contacts[1].id, dealId: deals[1].id },
    { id: 'df-t-3', tenantId: tId, assignedUserId: bId, assignedById: bId, title: 'Contract negotiation call — CloudPH Telecom', status: 'pending', priority: 'High', dueDate: new Date(Date.now() + 1 * 86400000), contactId: contacts[2].id, dealId: deals[2].id },
    { id: 'df-t-4', tenantId: tId, assignedUserId: aId, assignedById: aId, title: 'Send onboarding docs — SecureNet', status: 'completed', priority: 'Medium', dueDate: new Date(Date.now() - 3 * 86400000), completedAt: new Date(Date.now() - 2 * 86400000), contactId: contacts[7].id, dealId: deals[4].id },
    { id: 'df-t-5', tenantId: tId, assignedUserId: bId, assignedById: aId, title: 'LinkedIn outreach — Jerico Tan', status: 'pending', priority: 'Low', dueDate: new Date(Date.now() + 7 * 86400000), contactId: contacts[5].id },
    { id: 'df-t-6', tenantId: tId, assignedUserId: aId, assignedById: bId, title: 'Schedule product demo — BrightPath BPO', status: 'pending', priority: 'Medium', dueDate: new Date(Date.now() + 4 * 86400000), contactId: contacts[3].id, dealId: deals[3].id },
    { id: 'df-t-7', tenantId: tId, assignedUserId: bId, assignedById: bId, title: 'Renewal discussion — GreenTech', status: 'cancelled', priority: 'Low', dueDate: new Date(Date.now() - 10 * 86400000), contactId: contacts[4].id, dealId: deals[5].id },
    { id: 'df-t-8', tenantId: tId, assignedUserId: aId, assignedById: aId, title: 'Send add-on pricing — Antigravity', status: 'in_progress', priority: 'Medium', dueDate: new Date(Date.now() + 3 * 86400000), contactId: contacts[6].id, dealId: deals[6].id },
    { id: 'df-t-9', tenantId: tId, assignedUserId: bId, assignedById: aId, title: 'Quarterly review — CloudPH expansion', status: 'pending', priority: 'High', dueDate: new Date(Date.now() + 8 * 86400000), contactId: contacts[8].id, dealId: deals[7].id },
    { id: 'df-t-10', tenantId: tId, assignedUserId: aId, assignedById: bId, title: 'Cold outreach — Renato Lim', status: 'pending', priority: 'Low', dueDate: new Date(Date.now() + 14 * 86400000), contactId: contacts[9].id },
  ]});
  console.log('[Seed:Full] 10 tasks seeded.');

  // ── Activities ─────────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding activities...');
  await prisma.activity.createMany({ skipDuplicates: true, data: [
    { id: 'df-a-1', tenantId: tId, createdById: bId, type: 'call',         title: 'Discovery call with Anna Reyes',           description: 'Discussed CRM Enterprise requirements and budget.',       contactId: contacts[0].id, dealId: deals[0].id },
    { id: 'df-a-2', tenantId: tId, createdById: aId, type: 'email',        title: 'Proposal sent to Marco Dela Cruz',          description: 'Sent CRM Pro pricing proposal.',                          contactId: contacts[1].id, dealId: deals[1].id },
    { id: 'df-a-3', tenantId: tId, createdById: bId, type: 'meeting',      title: 'Product demo — CloudPH Telecom',            description: 'Full product demo for procurement team of 5 people.',    contactId: contacts[2].id, dealId: deals[2].id },
    { id: 'df-a-4', tenantId: tId, createdById: aId, type: 'note',         title: 'Danilo Cruz onboarded successfully',        description: 'Contract signed, onboarding started.',                   contactId: contacts[7].id, dealId: deals[4].id },
    { id: 'df-a-5', tenantId: tId, createdById: bId, type: 'stage_change', title: 'Deal moved to Negotiation',                 description: 'CloudPH deal advanced to negotiation stage.',             contactId: contacts[2].id, dealId: deals[2].id },
    { id: 'df-a-6', tenantId: tId, createdById: aId, type: 'call',         title: 'Follow-up call — Camille Bautista',         description: 'Discussed workflow automation needs for their IT dept.',   contactId: contacts[6].id, dealId: deals[6].id },
    { id: 'df-a-7', tenantId: tId, createdById: bId, type: 'email',        title: 'Introduction email — Luis Santos',          description: 'Sent company overview and product brochure.',             contactId: contacts[3].id, dealId: deals[3].id },
    { id: 'df-a-8', tenantId: tId, createdById: aId, type: 'meeting',      title: 'Quarterly business review — SecureNet',     description: 'QBR with SecureNet account team.',                        contactId: contacts[7].id, accountId: orgs[5].id },
    { id: 'df-a-9', tenantId: tId, createdById: bId, type: 'note',         title: 'Budget concern flagged — GreenTech',        description: 'Client indicated budget freeze for Q3.',                  contactId: contacts[4].id, dealId: deals[5].id },
    { id: 'df-a-10', tenantId: tId, createdById: aId, type: 'call',        title: 'Expansion opportunity — CloudPH Q2',        description: 'Maricris confirmed interest in adding 50 more seats.',    contactId: contacts[8].id, dealId: deals[7].id },
  ]});
  console.log('[Seed:Full] 10 activities seeded.');

  // ── Templates ──────────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding templates...');
  await prisma.template.createMany({ skipDuplicates: true, data: [
    { id: 'df-tpl-1', tenantId: tId, name: 'Welcome Email',            type: 'Email', category: 'Onboarding',  subject: 'Welcome to LeadCRM!', content: 'Hi {{firstName}}, welcome aboard! Here is how to get started...' },
    { id: 'df-tpl-2', tenantId: tId, name: 'Follow-Up After Demo',     type: 'Email', category: 'Sales',       subject: 'Thank you for attending our demo', content: 'Hi {{firstName}}, thank you for your time today...' },
    { id: 'df-tpl-3', tenantId: tId, name: 'Proposal Follow-Up',       type: 'Email', category: 'Sales',       subject: 'Checking in on our proposal', content: 'Hi {{firstName}}, I wanted to follow up on the proposal we sent...' },
    { id: 'df-tpl-4', tenantId: tId, name: 'Renewal Reminder',         type: 'Email', category: 'Retention',   subject: 'Your subscription is up for renewal', content: 'Hi {{firstName}}, your subscription renews on {{renewalDate}}...' },
    { id: 'df-tpl-5', tenantId: tId, name: 'SMS Quick Follow-Up',      type: 'SMS',   category: 'Sales',       content: 'Hi {{firstName}}, just checking in on your CRM needs. Reply YES to schedule a call.' },
    { id: 'df-tpl-6', tenantId: tId, name: 'Win-Back Campaign',        type: 'Email', category: 'Re-engagement', subject: 'We have something special for you', content: 'Hi {{firstName}}, we noticed your subscription lapsed...' },
  ]});
  console.log('[Seed:Full] 6 templates seeded.');

  // ── Target Audiences ───────────────────────────────────────────────
  console.log('[Seed:Full] Seeding target audiences...');
  const audiences = await Promise.all([
    prisma.targetAudience.upsert({ where: { id: 'df-aud-1' }, update: {}, create: { id: 'df-aud-1', tenantId: tId, name: 'Hot Leads', description: 'All contacts with HOT status', conditions: { create: [{ field: 'status', operator: 'equals', value: 'HOT', conditionOrder: 1 }] } } }),
    prisma.targetAudience.upsert({ where: { id: 'df-aud-2' }, update: {}, create: { id: 'df-aud-2', tenantId: tId, name: 'High Score Contacts', description: 'Contacts with score >= 80', conditions: { create: [{ field: 'score', operator: 'gte', value: '80', conditionOrder: 1 }] } } }),
    prisma.targetAudience.upsert({ where: { id: 'df-aud-3' }, update: {}, create: { id: 'df-aud-3', tenantId: tId, name: 'IT Industry', description: 'Contacts from IT companies', conditions: { create: [{ field: 'source', operator: 'equals', value: 'Referral', conditionOrder: 1 }] } } }),
  ]);
  console.log('[Seed:Full] 3 target audiences seeded.');

  // ── Campaigns ──────────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding campaigns...');
  await prisma.campaign.createMany({ skipDuplicates: true, data: [
    { id: 'df-camp-1', tenantId: tId, targetAudienceId: audiences[0].id, emailTemplateId: 'df-tpl-2', name: 'Q3 IT Solutions Outreach',    type: 'EMAIL', status: 'ACTIVE',     subject: 'Streamline your IT workflows with LeadCRM', sentCount: 142, openedCount: 67, clickedCount: 23, engagement: 47.2, scheduledFor: new Date(Date.now() + 3 * 86400000) },
    { id: 'df-camp-2', tenantId: tId, targetAudienceId: audiences[1].id,                              name: 'BPO Industry Newsletter',       type: 'EMAIL', status: 'DRAFT',      subject: 'How BPO companies grow 3x faster with CRM', sentCount: 0,   openedCount: 0,  clickedCount: 0,  engagement: 0 },
    { id: 'df-camp-3', tenantId: tId, targetAudienceId: audiences[2].id, emailTemplateId: 'df-tpl-6', name: 'Win-Back — Lost Deals',         type: 'EMAIL', status: 'COMPLETED',  subject: 'We have a special offer for you', sentCount: 38, openedCount: 15, clickedCount: 6, engagement: 39.5, scheduledFor: new Date(Date.now() - 10 * 86400000), sentAt: new Date(Date.now() - 10 * 86400000) },
    { id: 'df-camp-4', tenantId: tId, targetAudienceId: audiences[0].id,                              name: 'Hot Leads SMS Blast',           type: 'SMS',   status: 'ACTIVE',     sentCount: 25, openedCount: 0, clickedCount: 0, engagement: 0 },
    { id: 'df-camp-5', tenantId: tId, targetAudienceId: audiences[1].id, emailTemplateId: 'df-tpl-4', name: 'Renewal Campaign Q4',           type: 'EMAIL', status: 'SCHEDULED',  subject: 'Your renewal is coming up', sentCount: 0, openedCount: 0, clickedCount: 0, engagement: 0, scheduledFor: new Date(Date.now() + 30 * 86400000) },
  ]});
  console.log('[Seed:Full] 5 campaigns seeded.');

  // ── Workflows ──────────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding workflows...');
  await prisma.workflow.createMany({ skipDuplicates: true, data: [
    { id: 'df-wf-1', tenantId: tId, name: 'New Lead Auto-Assign', trigger: 'lead.created', isActive: false,
      actions: [{ type: 'assign_owner', config: { userId: bId } }] },
    { id: 'df-wf-2', tenantId: tId, name: 'Deal Won — Onboarding Task', trigger: 'deal.closed_won', isActive: false,
      actions: [{ type: 'create_task', config: { title: 'Onboarding kickoff', assignedUserId: aId } }] },
    { id: 'df-wf-3', tenantId: tId, name: 'New Client Profile Follow-up', trigger: 'contact.created', isActive: false,
      actions: [{ type: 'create_task', config: { title: 'Welcome the client', assignedUserId: aId } }] },
    { id: 'df-wf-4', tenantId: tId, name: 'Hot Client Profile Alert', trigger: 'contact.status_changed', isActive: false,
      actions: [{ type: 'create_notification', config: { title: 'Contact is now hot', userId: bId } }],
      conditions: { operator: 'AND', conditions: [{ field: 'contact.status', operator: 'equals', value: 'HOT' }] } },
    { id: 'df-wf-5', tenantId: tId, name: 'High-value Deal Follow-up', trigger: 'deal.created', isActive: false,
      actions: [{ type: 'create_task', config: { title: 'Review high-value deal', assignedUserId: aId } }],
      conditions: { operator: 'AND', conditions: [{ field: 'deal.value', operator: 'greater_than', value: 100000 }] } },
  ]});  console.log('[Seed:Full] 5 workflows seeded.');

  // ── Notifications ──────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding notifications...');
  await prisma.notification.createMany({ skipDuplicates: true, data: [
    { id: 'df-notif-1', tenantId: tId, userId: bId, type: 'deal_assigned',  title: 'New deal assigned to you',              body: 'CRM Enterprise — Antigravity Solutions has been assigned to you.',  entityType: 'Deal',    entityId: deals[0].id,    isRead: false },
    { id: 'df-notif-2', tenantId: tId, userId: aId, type: 'task_due',       title: 'Task due tomorrow',                     body: 'Prepare proposal for Nexwave Digital is due tomorrow.',             entityType: 'Task',    entityId: 'df-t-2',       isRead: false },
    { id: 'df-notif-3', tenantId: tId, userId: bId, type: 'deal_won',       title: 'Deal won! 🎉',                          body: 'Security CRM — SecureNet has been marked as Won. ₱820,000.',        entityType: 'Deal',    entityId: deals[4].id,    isRead: true, readAt: new Date(Date.now() - 1 * 86400000) },
    { id: 'df-notif-4', tenantId: tId, userId: aId, type: 'campaign_sent',  title: 'Campaign sent successfully',            body: 'Q3 IT Solutions Outreach campaign was sent to 142 contacts.',       entityType: 'Campaign', entityId: 'df-camp-1',   isRead: true, readAt: new Date(Date.now() - 2 * 86400000) },
    { id: 'df-notif-5', tenantId: tId, userId: bId, type: 'task_due',       title: 'Overdue: Contract negotiation call',    body: 'Contract negotiation call — CloudPH is overdue.',                   entityType: 'Task',    entityId: 'df-t-3',       isRead: false },
    { id: 'df-notif-6', tenantId: tId, userId: aId, type: 'deal_assigned',  title: 'Deal assigned to you',                  body: 'CRM Pro — Nexwave Digital has been assigned to you.',               entityType: 'Deal',    entityId: deals[1].id,    isRead: false },
  ]});
  console.log('[Seed:Full] 6 notifications seeded.');

  // ── Audit Logs ─────────────────────────────────────────────────────
  console.log('[Seed:Full] Seeding audit logs...');
  await prisma.auditLog.createMany({ skipDuplicates: true, data: [
    { id: 'df-audit-1', tenantId: tId, userId: aId, action: 'contact.created',     entityType: 'Contact',  entityId: contacts[0].id, category: 'crm',     metadata: { message: 'Contact Anna Reyes created' } },
    { id: 'df-audit-2', tenantId: tId, userId: bId, action: 'deal.created',        entityType: 'Deal',     entityId: deals[0].id,    category: 'crm',     metadata: { message: 'Deal CRM Enterprise — Antigravity Solutions created' } },
    { id: 'df-audit-3', tenantId: tId, userId: bId, action: 'deal.won',            entityType: 'Deal',     entityId: deals[4].id,    category: 'crm',     metadata: { message: 'Deal Security CRM — SecureNet marked as Won' }, severity: 'INFO' },
    { id: 'df-audit-4', tenantId: tId, userId: aId, action: 'deal.stage_changed',  entityType: 'Deal',     entityId: deals[2].id,    category: 'crm',     changeset: { before: { stage: 'Qualified' }, after: { stage: 'Negotiation' } } },
    { id: 'df-audit-5', tenantId: tId, userId: aId, action: 'user.login',          entityType: 'User',     entityId: aId,            category: 'auth',    metadata: { message: 'User admin@democorp.com logged in' } },
    { id: 'df-audit-6', tenantId: tId, userId: bId, action: 'campaign.sent',       entityType: 'Campaign', entityId: 'df-camp-1',    category: 'crm',     metadata: { message: 'Campaign Q3 IT Solutions Outreach sent to 142 contacts' } },
    { id: 'df-audit-8', tenantId: tId, userId: bId, action: 'contact.updated',     entityType: 'Contact',  entityId: contacts[2].id, category: 'crm',     changeset: { before: { status: 'WARM' }, after: { status: 'HOT' } } },
  ]});
  console.log('[Seed:Full] 7 audit logs seeded.');

  console.log('[Seed:Full] ✅ All demo data seeded successfully!');
  console.log('[Seed:Full] Summary: 6 orgs · 10 contacts · 1 pipeline · 8 deals · 10 tasks · 10 activities · 6 templates · 3 audiences · 5 campaigns · 5 workflows · 5 invoices · 6 notifications · 8 audit logs');
}

// ── Standalone runner ─────────────────────────────────────────────────────
if (require.main === module) {
  seedDemoFullData()
    .catch((err) => { console.error('[Seed:Full] Error:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
