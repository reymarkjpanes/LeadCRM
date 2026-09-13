import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../shared/helpers/crypto';
import { Role } from '../../shared/constants/roles';

const prisma = new PrismaClient();

/**
 * Seeds a complete seeder account with tenant, user, and sample CRM data.
 * Credentials: seeder@leadcrm.com / seeder123
 * Tenant: seeder-company
 * 
 * Run: npm run db:seed:seeder
 */

async function main() {
  console.log('[Seed] Seeding Seeder Company tenant data...');

  const SEEDER_EMAIL = 'seeder@leadcrm.com';
  const SEEDER_PASSWORD = 'seeder123';

  // ── 1. Create Tenant ────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'seeder-company' },
    update: { status: 'ACTIVE', subscriptionStatus: 'ACTIVE' },
    create: {
      name: 'Seeder Company',
      slug: 'seeder-company',
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      plan: 'PRO',
    },
  });
  console.log('[Seed] ✓ Tenant created: Seeder Company');

  // ── Clean up old data ───────────────────────────────────────────────────
  console.log('[Seed] Cleaning up old seeder data...');
  
  // Delete in dependency order (children first)
  await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.emailDeliveryLog.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.campaignContact.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.campaign.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.activity.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.task.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.leadDeal.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.contactDeal.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.dealStageHistory.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.dealAction.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.deal.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.stage.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.pipeline.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.lead.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.contact.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.account.deleteMany({ where: { tenantId: tenant.id } });
  
  console.log('[Seed] ✓ Old data cleaned up');

  // ── 2. Create User ──────────────────────────────────────────────────────
  const passwordHash = await hashPassword(SEEDER_PASSWORD);
  
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: SEEDER_EMAIL } },
    update: { passwordHash, status: 'ACTIVE', role: Role.CLIENT_ADMIN, emailVerified: new Date() },
    create: {
      tenantId: tenant.id,
      email: SEEDER_EMAIL,
      firstName: 'Seeder',
      lastName: 'Admin',
      passwordHash,
      role: Role.CLIENT_ADMIN,
      status: 'ACTIVE',
      emailVerified: new Date(),
    },
  });
  console.log(`[Seed] ✓ User created: ${SEEDER_EMAIL}`);

  // ── 3. Create Role Permissions ──────────────────────────────────────────
  const clientAdminRole = await prisma.roleDefinition.upsert({
    where: {
      tenantId_name: {
        tenantId: tenant.id,
        name: Role.CLIENT_ADMIN,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: Role.CLIENT_ADMIN,
      description: 'Full access to all tenant features',
    },
  });

  const modules = [
    'contacts', 'deals', 'organizations', 'campaigns', 'workflows',
    'tasks', 'service_orders', 'reports', 'billing', 'users', 'settings', 'audit'
  ];

  for (const module of modules) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_module: {
          roleId: clientAdminRole.id,
          module,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        roleId: clientAdminRole.id,
        module,
        canView: true,
        canCreate: true,
        canEdit: true,
        canDelete: true,
      },
    });
  }
  console.log('[Seed] ✓ Role permissions created');

  // ── 4. Create Pipeline + Stages ─────────────────────────────────────────
  const pipeline = await prisma.pipeline.create({
    data: {
      tenantId: tenant.id,
      name: 'Sales Pipeline',
      isDefault: true,
      stages: {
        create: [
          { name: 'New Lead',      order: 1, probability: 10,  isDefault: true, color: '#64748b', tenantId: tenant.id },
          { name: 'Contacted',     order: 2, probability: 25,  color: '#3b82f6', tenantId: tenant.id },
          { name: 'Qualified',     order: 3, probability: 40,  color: '#8b5cf6', tenantId: tenant.id },
          { name: 'Proposal',      order: 4, probability: 60,  color: '#f59e0b', tenantId: tenant.id },
          { name: 'Negotiation',   order: 5, probability: 80,  color: '#06b6d4', tenantId: tenant.id },
          { name: 'Closed Won',    order: 6, probability: 100, isWon: true,  color: '#10b981', tenantId: tenant.id },
          { name: 'Closed Lost',   order: 7, probability: 0,   isLost: true, color: '#ef4444', tenantId: tenant.id },
        ],
      },
    },
    include: { stages: true },
  });

  const stageMap = Object.fromEntries(pipeline.stages.map(s => [s.name, s]));
  console.log('[Seed] ✓ Pipeline created with 7 stages');

  // ── 5. Create Accounts (Organizations) ──────────────────────────────────
  const accounts = await Promise.all([
    prisma.account.create({
      data: {
        tenantId: tenant.id,
        assignedUserId: user.id,
        name: 'Acme Corporation',
        industry: 'Technology',
        size: '51-200',
        website: 'https://acmecorp.com',
        address: 'San Francisco, CA',
        country: 'United States',
        customerType: 'Active Customer',
      },
    }),
    prisma.account.create({
      data: {
        tenantId: tenant.id,
        assignedUserId: user.id,
        name: 'Global Innovations Ltd',
        industry: 'Manufacturing',
        size: '200+',
        website: 'https://globalinnovations.com',
        address: 'London, UK',
        country: 'United Kingdom',
        customerType: 'Prospect',
      },
    }),
    prisma.account.create({
      data: {
        tenantId: tenant.id,
        assignedUserId: user.id,
        name: 'StartupXYZ',
        industry: 'Software Development',
        size: '1-10',
        website: 'https://startupxyz.io',
        address: 'Austin, TX',
        country: 'United States',
        customerType: 'Prospect',
      },
    }),
    prisma.account.create({
      data: {
        tenantId: tenant.id,
        assignedUserId: user.id,
        name: 'Enterprise Solutions Inc',
        industry: 'Consulting',
        size: '51-200',
        address: 'New York, NY',
        country: 'United States',
        customerType: 'Active Customer',
      },
    }),
  ]);
  console.log('[Seed] ✓ 4 Accounts created');

  // ── 6. Create Leads ─────────────────────────────────────────────────────
  const leads = await Promise.all([
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        accountId: accounts[0].id,
        assignedUserId: user.id,
        firstName: 'Sarah',
        lastName: 'Johnson',
        email: 'sarah.johnson@acmecorp.com',
        phone: '+1-555-0101',
        companyName: 'Acme Corporation',
        productInterest: ['CRM Enterprise', 'Automation'],
        source: 'Referral',
        status: 'Qualified',
      },
    }),
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        accountId: accounts[0].id,
        assignedUserId: user.id,
        firstName: 'Michael',
        lastName: 'Chen',
        email: 'michael.chen@acmecorp.com',
        phone: '+1-555-0102',
        companyName: 'Acme Corporation',
        productInterest: ['API Integration'],
        source: 'Referral',
        status: 'Qualified',
      },
    }),
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        accountId: accounts[1].id,
        assignedUserId: user.id,
        firstName: 'Emma',
        lastName: 'Williams',
        email: 'emma.williams@globalinnovations.com',
        phone: '+44-20-7946-0958',
        companyName: 'Global Innovations Ltd',
        productInterest: ['CRM Pro'],
        source: 'LinkedIn',
        status: 'Contacted',
      },
    }),
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        accountId: accounts[2].id,
        assignedUserId: user.id,
        firstName: 'David',
        lastName: 'Martinez',
        email: 'david@startupxyz.io',
        phone: '+1-512-555-0103',
        companyName: 'StartupXYZ',
        productInterest: ['CRM Starter'],
        source: 'Website',
        status: 'Inquiry',
      },
    }),
  ]);
  console.log('[Seed] ✓ 4 Leads created');

  // ── 7. Create Customers ─────────────────────────────────────────────────
  const customers = await Promise.all([
    prisma.contact.create({
      data: {
        tenantId: tenant.id,
        accountId: accounts[3].id,
        assignedUserId: user.id,
        firstName: 'Jennifer',
        lastName: 'Davis',
        email: 'jennifer.davis@enterprisesolutions.com',
        phone: '+1-212-555-0104',
        companyName: 'Enterprise Solutions Inc',
        productInterest: ['CRM Enterprise', 'Service Orders'],
        source: 'Cold Email',
        status: 'WARM',
      },
    }),
    prisma.contact.create({
      data: {
        tenantId: tenant.id,
        assignedUserId: user.id,
        firstName: 'Robert',
        lastName: 'Taylor',
        email: 'robert.taylor@freelance.com',
        phone: '+1-555-0105',
        companyName: 'Independent Consulting',
        source: 'Website',
        status: 'WARM',
      },
    }),
  ]);
  console.log('[Seed] ✓ 2 Customers created');

  // ── 8. Create Deals ─────────────────────────────────────────────────────
  const deals = await Promise.all([
    prisma.deal.create({
      data: {
        tenantId: tenant.id,
        pipelineId: pipeline.id,
        stageId: stageMap['Negotiation'].id,
        accountId: accounts[0].id,
        leadId: leads[0].id,
        assignedUserId: user.id,
        ownerId: user.id,
        title: 'Enterprise CRM Implementation - Acme Corp',
        value: 125000,
        currency: 'USD',
        priority: 'HIGH',
        expectedCloseDate: new Date(Date.now() + 15 * 86400000),
      },
    }),
    prisma.deal.create({
      data: {
        tenantId: tenant.id,
        pipelineId: pipeline.id,
        stageId: stageMap['Proposal'].id,
        accountId: accounts[1].id,
        leadId: leads[2].id,
        assignedUserId: user.id,
        ownerId: user.id,
        title: 'CRM Pro - Global Innovations',
        value: 45000,
        currency: 'GBP',
        priority: 'MEDIUM',
        expectedCloseDate: new Date(Date.now() + 30 * 86400000),
      },
    }),
    prisma.deal.create({
      data: {
        tenantId: tenant.id,
        pipelineId: pipeline.id,
        stageId: stageMap['Qualified'].id,
        accountId: accounts[2].id,
        leadId: leads[3].id,
        assignedUserId: user.id,
        ownerId: user.id,
        title: 'CRM Starter - StartupXYZ',
        value: 12000,
        currency: 'USD',
        priority: 'LOW',
        expectedCloseDate: new Date(Date.now() + 45 * 86400000),
      },
    }),
    prisma.deal.create({
      data: {
        tenantId: tenant.id,
        pipelineId: pipeline.id,
        stageId: stageMap['Closed Won'].id,
        accountId: accounts[3].id,
        customerId: customers[0].id,
        assignedUserId: user.id,
        ownerId: user.id,
        title: 'CRM Enterprise + Service Orders - Enterprise Solutions',
        value: 95000,
        currency: 'USD',
        priority: 'HIGH',
        expectedCloseDate: new Date(Date.now() - 10 * 86400000),
        closedAt: new Date(Date.now() - 10 * 86400000),
      },
    }),
    prisma.deal.create({
      data: {
        tenantId: tenant.id,
        pipelineId: pipeline.id,
        stageId: stageMap['Closed Lost'].id,
        accountId: accounts[1].id,
        assignedUserId: user.id,
        ownerId: user.id,
        title: 'CRM Pro - Lost to Competitor',
        value: 28000,
        currency: 'USD',
        priority: 'MEDIUM',
        expectedCloseDate: new Date(Date.now() - 20 * 86400000),
        closedAt: new Date(Date.now() - 20 * 86400000),
        lostReason: 'Price too high',
      },
    }),
    prisma.deal.create({
      data: {
        tenantId: tenant.id,
        pipelineId: pipeline.id,
        stageId: stageMap['New Lead'].id,
        customerId: customers[1].id,
        assignedUserId: user.id,
        ownerId: user.id,
        title: 'CRM Consultation - Robert Taylor',
        value: 8000,
        currency: 'USD',
        priority: 'LOW',
        expectedCloseDate: new Date(Date.now() + 60 * 86400000),
      },
    }),
  ]);
  console.log('[Seed] ✓ 6 Deals created');

  // ── 9. Link Leads to Deals ──────────────────────────────────────────────
  await prisma.leadDeal.createMany({
    data: [
      { tenantId: tenant.id, leadId: leads[0].id, dealId: deals[0].id, addedById: user.id },
      { tenantId: tenant.id, leadId: leads[1].id, dealId: deals[0].id, addedById: user.id }, // Multiple leads on one deal
      { tenantId: tenant.id, leadId: leads[2].id, dealId: deals[1].id, addedById: user.id },
      { tenantId: tenant.id, leadId: leads[3].id, dealId: deals[2].id, addedById: user.id },
    ],
    skipDuplicates: true,
  });
  console.log('[Seed] ✓ Lead-Deal links created');

  // ── 10. Create Tasks ────────────────────────────────────────────────────
  await prisma.task.createMany({
    data: [
      {
        tenantId: tenant.id,
        assignedUserId: user.id,
        assignedById: user.id,
        title: 'Follow up with Sarah Johnson - Enterprise demo',
        status: 'pending',
        priority: 'High',
        dueDate: new Date(Date.now() + 2 * 86400000),
        leadId: leads[0].id,
        dealId: deals[0].id,
      },
      {
        tenantId: tenant.id,
        assignedUserId: user.id,
        assignedById: user.id,
        title: 'Prepare proposal for Global Innovations',
        status: 'in-progress',
        priority: 'Medium',
        dueDate: new Date(Date.now() + 7 * 86400000),
        leadId: leads[2].id,
        dealId: deals[1].id,
      },
      {
        tenantId: tenant.id,
        assignedUserId: user.id,
        assignedById: user.id,
        title: 'Contract review call - Acme Corp',
        status: 'pending',
        priority: 'High',
        dueDate: new Date(Date.now() + 1 * 86400000),
        leadId: leads[0].id,
        dealId: deals[0].id,
      },
      {
        tenantId: tenant.id,
        assignedUserId: user.id,
        assignedById: user.id,
        title: 'Send onboarding docs - Enterprise Solutions',
        status: 'completed',
        priority: 'Medium',
        dueDate: new Date(Date.now() - 8 * 86400000),
        customerId: customers[0].id,
        dealId: deals[3].id,
      },
      {
        tenantId: tenant.id,
        assignedUserId: user.id,
        assignedById: user.id,
        title: 'Initial discovery call - StartupXYZ',
        status: 'pending',
        priority: 'Low',
        dueDate: new Date(Date.now() + 14 * 86400000),
        leadId: leads[3].id,
        dealId: deals[2].id,
      },
    ],
  });
  console.log('[Seed] ✓ 5 Tasks created');

  // ── 11. Create Activities ───────────────────────────────────────────────
  await prisma.activity.createMany({
    data: [
      {
        tenantId: tenant.id,
        createdById: user.id,
        type: 'call',
        title: 'Discovery call with Sarah Johnson',
        description: 'Discussed Enterprise CRM requirements and implementation timeline.',
        leadId: leads[0].id,
        dealId: deals[0].id,
      },
      {
        tenantId: tenant.id,
        createdById: user.id,
        type: 'email',
        title: 'Proposal sent to Emma Williams',
        description: 'Sent CRM Pro pricing proposal with customization options.',
        leadId: leads[2].id,
        dealId: deals[1].id,
      },
      {
        tenantId: tenant.id,
        createdById: user.id,
        type: 'meeting',
        title: 'Product demo - Acme Corporation',
        description: 'Full product demonstration for CEO and CTO.',
        leadId: leads[0].id,
        dealId: deals[0].id,
      },
      {
        tenantId: tenant.id,
        createdById: user.id,
        type: 'note',
        title: 'Jennifer Davis onboarded successfully',
        description: 'Contract signed, payment received, onboarding completed.',
        customerId: customers[0].id,
        dealId: deals[3].id,
      },
      {
        tenantId: tenant.id,
        createdById: user.id,
        type: 'stage_change',
        title: 'Deal moved to Negotiation',
        description: 'Acme Corp deal advanced to negotiation stage.',
        leadId: leads[0].id,
        dealId: deals[0].id,
      },
    ],
  });
  console.log('[Seed] ✓ 5 Activities created');

  // ── 12. Create Campaigns ────────────────────────────────────────────────
  await prisma.campaign.createMany({
    data: [
      {
        tenantId: tenant.id,
        name: 'Q1 Enterprise Outreach',
        type: 'EMAIL',
        status: 'ACTIVE',
        subject: 'Transform your business with LeadCRM Enterprise',
        scheduledFor: new Date(Date.now() + 5 * 86400000),
      },
      {
        tenantId: tenant.id,
        name: 'Product Update Newsletter',
        type: 'EMAIL',
        status: 'DRAFT',
        subject: 'New features in LeadCRM you will love',
      },
      {
        tenantId: tenant.id,
        name: 'Win-Back Campaign',
        type: 'EMAIL',
        status: 'COMPLETED',
        subject: 'We have improved - let us talk again',
        scheduledFor: new Date(Date.now() - 15 * 86400000),
      },
    ],
  });
  console.log('[Seed] ✓ 3 Campaigns created');

  // ── 14. Create Audit Logs ───────────────────────────────────────────────
  await prisma.auditLog.createMany({
    data: [
      {
        tenantId: tenant.id,
        userId: user.id,
        action: 'user.created',
        entityType: 'User',
        entityId: user.id,
        category: 'auth',
        metadata: { message: 'Seeder admin account created' },
      },
      {
        tenantId: tenant.id,
        userId: user.id,
        action: 'lead.created',
        entityType: 'Lead',
        entityId: leads[0].id,
        category: 'crm',
        metadata: { message: 'Lead Sarah Johnson created' },
      },
      {
        tenantId: tenant.id,
        userId: user.id,
        action: 'deal.created',
        entityType: 'Deal',
        entityId: deals[0].id,
        category: 'crm',
        metadata: { message: 'Deal Enterprise CRM Implementation created' },
      },
      {
        tenantId: tenant.id,
        userId: user.id,
        action: 'deal.won',
        entityType: 'Deal',
        entityId: deals[3].id,
        category: 'crm',
        metadata: { message: 'Deal Enterprise Solutions marked as Won' },
      },
      {
        tenantId: tenant.id,
        userId: user.id,
        action: 'deal.stage_changed',
        entityType: 'Deal',
        entityId: deals[0].id,
        category: 'crm',
        metadata: { from: 'Proposal', to: 'Negotiation' },
      },
    ],
  });
  console.log('[Seed] ✓ 5 Audit logs created');

  console.log('\n[Seed] ✅ Seeder account seeded successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Summary:');
  console.log(`   Email:         ${SEEDER_EMAIL}`);
  console.log(`   Password:      ${SEEDER_PASSWORD}`);
  console.log(`   Tenant:        ${tenant.slug}`);
  console.log(`   Accounts:      4`);
  console.log(`   Leads:         4`);
  console.log(`   Customers:     2`);
  console.log(`   Deals:         6 (1 Won, 1 Lost, 4 Active)`);
  console.log(`   Tasks:         5`);
  console.log(`   Campaigns:     3`);
  console.log(`   Service Orders: 3`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((err) => {
    console.error('[Seed] ❌ Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
