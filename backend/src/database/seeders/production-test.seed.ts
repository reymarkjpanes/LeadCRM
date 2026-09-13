/**
 * PRODUCTION TEST DATA SEEDER
 * 
 * Seeds the database with test data needed for production campaign testing.
 * Creates test tenant, user, leads, and verifies Gmail connection.
 * 
 * Run: npm run db:seed:production-test
 */

import prisma from '../../config/database.config';
import bcrypt from 'bcryptjs';
import { Role } from '../../shared/constants/roles';

const TEST_TENANT_ID = 'tenant_test_prod';
const TEST_USER_ID = 'user_test_prod';
const TEST_RECIPIENTS = [
  {
    email: 'jtiron2004@gmail.com',
    firstName: 'Julie Ann',
    lastName: 'Tiron',
    status: 'hot',
  },
  {
    email: 'durussy1@gmail.com', 
    firstName: 'Duruss',
    lastName: 'Y',
    status: 'warm',
  },
];

async function seedProductionTestData() {
  console.log('🌱 Seeding production test data...\n');

  try {
    // 1. Create test tenant
    console.log('📋 Creating test tenant...');
    await prisma.tenant.upsert({
      where: { id: TEST_TENANT_ID },
      update: {},
      create: {
        id: TEST_TENANT_ID,
        name: 'Production Test Tenant',
        subdomain: 'test-prod',
        plan: 'PRO' as const,
        status: 'ACTIVE',
        maxUsers: 10,
        maxContacts: 1000,
        contactsUsed: 2,
        usersUsed: 1,
      },
    });
    console.log('✅ Test tenant created/updated');

    // 2. Create test user
    console.log('👤 Creating test user...');
    const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
    
    await prisma.user.upsert({
      where: { id: TEST_USER_ID },
      update: {},
      create: {
        id: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        email: 'test-user@leadcrm.local',
        firstName: 'Test',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: Role.CLIENT_ADMIN,
        status: 'ACTIVE',
      },
    });
    console.log('✅ Test user created/updated');

    // 3. Create test leads (recipients)
    console.log('📧 Creating test recipient leads...');
    for (const recipient of TEST_RECIPIENTS) {
      await prisma.lead.upsert({
        where: {
          tenantId_email: {
            tenantId: TEST_TENANT_ID,
            email: recipient.email,
          },
        },
        update: {
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          status: recipient.status,
        },
        create: {
          tenantId: TEST_TENANT_ID,
          email: recipient.email,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          status: recipient.status,
          source: 'production-test',
          isArchived: false,
        },
      });
      console.log(`  ✅ Lead created: ${recipient.firstName} ${recipient.lastName} (${recipient.email})`);
    }

    // 4. Create role permissions for the test user
    console.log('🔐 Setting up role permissions...');
    
    // Check if role exists
    const clientAdminRole = await prisma.roleDefinition.findUnique({
      where: {
        tenantId_name: {
          tenantId: TEST_TENANT_ID,
          name: Role.CLIENT_ADMIN,
        },
      },
    });

    if (!clientAdminRole) {
      // Create Client Admin role
      await prisma.roleDefinition.create({
        data: {
          tenantId: TEST_TENANT_ID,
          name: Role.CLIENT_ADMIN,
          description: 'Full access to all tenant features',
          permissions: {
            create: [
              { tenantId: TEST_TENANT_ID, module: 'contacts', canView: true, canCreate: true, canEdit: true, canDelete: true },
              { tenantId: TEST_TENANT_ID, module: 'campaigns', canView: true, canCreate: true, canEdit: true, canDelete: true },
              { tenantId: TEST_TENANT_ID, module: 'deals', canView: true, canCreate: true, canEdit: true, canDelete: true },
              { tenantId: TEST_TENANT_ID, module: 'workflows', canView: true, canCreate: true, canEdit: true, canDelete: true },
              { tenantId: TEST_TENANT_ID, module: 'users', canView: true, canCreate: true, canEdit: true, canDelete: true },
              { tenantId: TEST_TENANT_ID, module: 'settings', canView: true, canCreate: true, canEdit: true, canDelete: true },
            ],
          },
        },
      });
      console.log('✅ Client Admin role created with full permissions');
    } else {
      console.log('✅ Client Admin role already exists');
    }

    // 5. Check Gmail connection status
    console.log('📨 Checking Gmail connection...');
    const gmailAccount = await prisma.emailAccount.findFirst({
      where: {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        provider: 'gmail',
        isActive: true,
      },
    });

    if (gmailAccount) {
      console.log(`✅ Gmail account connected: ${gmailAccount.email}`);
    } else {
      console.log('⚠️  Gmail account not connected for test user');
      console.log('   Please connect Gmail account before running production tests:');
      console.log('   1. Start the backend server: npm run dev');
      console.log('   2. Navigate to: http://localhost:4000/api/v1/marketing/gmail/auth-url');
      console.log('   3. Complete OAuth flow');
    }

    // 6. Clean up old test data
    console.log('🧹 Cleaning up old test campaigns...');
    await prisma.campaign.deleteMany({
      where: {
        tenantId: TEST_TENANT_ID,
        name: { startsWith: 'Sequential Gmail' },
      },
    });
    console.log('✅ Old test campaigns cleaned up');

    console.log('\n🎉 Production test data seeding completed!');
    console.log('📊 Summary:');
    console.log(`   Tenant: ${TEST_TENANT_ID}`);
    console.log(`   User: ${TEST_USER_ID}`);
    console.log(`   Recipients: ${TEST_RECIPIENTS.length}`);
    console.log(`   Gmail Connected: ${gmailAccount ? 'Yes' : 'No'}`);

  } catch (error) {
    console.error('❌ Failed to seed production test data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run seeder
seedProductionTestData().catch(console.error);