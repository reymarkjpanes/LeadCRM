import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../shared/helpers/crypto';
import { seedSystemRoles } from './roles.seed';
import { seedNotifications } from './notifications.seed';
import { seedSandboxData } from './sandbox.seed';

const prisma = new PrismaClient();

/**
 * seedDemoAccounts — idempotent demo account seeder.
 *
 * Creates/updates all 5 demo accounts in the User table so they work
 * with the /auth/send-otp → /auth/verify-otp login flow.
 *
 * All upserts include password hash in the update block so a re-run
 * always restores a valid password state, even if hashes were corrupted.
 *
 * Required Render env vars for OTP bypass:
 *   DEMO_MODE=true
 *   DEV_SEED_EMAILS=admin@gmail.com,super@leadcrm.com,admin@democorp.com,bob@democorp.com,guest@democorp.com
 */
export async function seedDemoAccounts(): Promise<void> {
  console.log('[Seed] Seeding demo accounts...');

  const passwordHash      = await hashPassword('admin123');
  const guestPasswordHash = await hashPassword('guest123');

  // ── 1. System Admin Tenant ──────────────────────────────────────────────
  // Both system admin accounts live in this tenant so loginUser() can find
  // them via prisma.user.findFirst({ where: { email } }).
  const systemTenant = await prisma.tenant.upsert({
    where:  { slug: 'leadcrm-system-demo' },
    update: { status: 'ACTIVE', subscriptionStatus: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() },
    create: {
      name:               'LeadCRM System Demo',
      slug:               'leadcrm-system-demo',
      status:             'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      plan:               'ENTERPRISE',
      onboardingStep:          3,
      onboardingCompletedAt:   new Date(),
    },
  });

  // Primary System Admin — email/password controlled by env vars.
  // SECURITY: In production, SYSTEM_ADMIN_PASSWORD must be explicitly set to a strong
  // value in the deployment platform's secret config. The seeder refuses to run with the
  // default 'admin123' password in production to prevent accidental weak-credential deployment.
  const systemAdminEmail    = (process.env.SYSTEM_ADMIN_EMAIL    ?? 'admin@gmail.com').toLowerCase().trim();
  const systemAdminPassword = process.env.SYSTEM_ADMIN_PASSWORD  ?? 'admin123';

  if (process.env.NODE_ENV === 'production' && systemAdminPassword === 'admin123') {
    throw new Error(
      '[Seed] SECURITY: SYSTEM_ADMIN_PASSWORD must be set to a strong password in production. ' +
      'Set it in your deployment platform\'s environment configuration (e.g. Render dashboard). ' +
      'Do NOT use the default admin123 password in production.',
    );
  }

  const systemAdminHash     =
    systemAdminEmail === 'admin@gmail.com' && systemAdminPassword === 'admin123'
      ? passwordHash // reuse already-computed hash
      : await hashPassword(systemAdminPassword);

  await seedSystemRoles(systemTenant.id);

  await prisma.user.upsert({
    where:  { tenantId_email: { tenantId: systemTenant.id, email: systemAdminEmail } },
    // update block restores correct password + ACTIVE status on every seed run
    update: { passwordHash: systemAdminHash, status: 'ACTIVE', role: 'System Admin', emailVerified: new Date() },
    create: {
      tenantId:     systemTenant.id,
      email:        systemAdminEmail,
      firstName:    'System',
      lastName:     'Admin',
      passwordHash: systemAdminHash,
      role:         'System Admin',
      status:       'ACTIVE',
      emailVerified: new Date(),
    },
  });
  console.log(`[Seed] ✓ System Admin: ${systemAdminEmail}`);

  // Legacy alias — always seed super@leadcrm.com as a User so it works
  // through the standard /auth/send-otp login endpoint.
  // (tenant-generator.ts wrote it to the SystemAdmin table — that path
  //  is no longer called from the main seed entry point.)
  if (systemAdminEmail !== 'super@leadcrm.com') {
    await prisma.user.upsert({
      where:  { tenantId_email: { tenantId: systemTenant.id, email: 'super@leadcrm.com' } },
      update: { passwordHash, status: 'ACTIVE', role: 'System Admin', emailVerified: new Date() },
      create: {
        tenantId:     systemTenant.id,
        email:        'super@leadcrm.com',
        firstName:    'System',
        lastName:     'Administrator',
        passwordHash,
        role:         'System Admin',
        status:       'ACTIVE',
        emailVerified: new Date(),
      },
    });
    console.log('[Seed] ✓ System Admin alias: super@leadcrm.com');
  }

  // ── 2. Client Tenant (DemoCorp) ─────────────────────────────────────────
  const clientTenant = await prisma.tenant.upsert({
    where:  { slug: 'demo-corp' },
    update: { status: 'ACTIVE', subscriptionStatus: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() },
    create: {
      name:               'Demo Corp',
      slug:               'demo-corp',
      status:             'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      plan:               'PRO',
      onboardingStep:          3,
      onboardingCompletedAt:   new Date(),
    },
  });

  await seedSystemRoles(clientTenant.id);

  await prisma.account.upsert({
    where:  { id: 'democorp-org-id' },
    update: {},
    create: {
      id:       'democorp-org-id',
      tenantId: clientTenant.id,
      name:     'Demo Corporation',
    },
  });

  const demoUsers = [
    { email: 'admin@democorp.com', firstName: 'Client', lastName: 'Admin',  role: 'Admin' },
    { email: 'bob@democorp.com',   firstName: 'Bob',    lastName: 'Sales',  role: 'User' },
  ];

  for (const u of demoUsers) {
    const seededUser = await prisma.user.upsert({
      where:  { tenantId_email: { tenantId: clientTenant.id, email: u.email } },
      update: { passwordHash, status: 'ACTIVE', role: u.role, emailVerified: new Date() },
      create: {
        tenantId:     clientTenant.id,
        email:        u.email,
        firstName:    u.firstName,
        lastName:     u.lastName,
        passwordHash,
        role:         u.role,
        status:       'ACTIVE',
        emailVerified: new Date(),
      },
    });
    console.log(`[Seed] ✓ ${u.role}: ${u.email}`);

    // Create UserRole junction row so the live DB RBAC path works.
    // Tenant safety: RoleDefinition is looked up within the same tenant as the user.
    const roleDef = await prisma.roleDefinition.findFirst({
      where: { tenantId: clientTenant.id, name: u.role },
    });
    if (roleDef && roleDef.tenantId === clientTenant.id) {
      await prisma.userRole.upsert({
        where: { userId_roleId_tenantId: { userId: seededUser.id, roleId: roleDef.id, tenantId: clientTenant.id } },
        update: {},
        create: { userId: seededUser.id, roleId: roleDef.id, tenantId: clientTenant.id },
      });
      console.log(`[Seed]   → UserRole created: ${u.email} → ${u.role}`);
    }
  }

  // ── 3. Guest Sandbox Tenant ─────────────────────────────────────────────
  const guestTenant = await prisma.tenant.upsert({
    where:  { slug: 'sandbox-guest' },
    update: { status: 'SANDBOX', onboardingStep: 3, onboardingCompletedAt: new Date() },
    create: {
      name:               'Guest Sandbox',
      slug:               'sandbox-guest',
      status:             'SANDBOX',
      subscriptionStatus: 'TRIAL',
      plan:               'FREE',
      onboardingStep:          3,
      onboardingCompletedAt:   new Date(),
    },
  });

  await seedSystemRoles(guestTenant.id);

  const guestUser = await prisma.user.upsert({
    where:  { tenantId_email: { tenantId: guestTenant.id, email: 'guest@democorp.com' } },
    update: { passwordHash: guestPasswordHash, status: 'ACTIVE', role: 'Restricted User', emailVerified: new Date() },
    create: {
      tenantId:     guestTenant.id,
      email:        'guest@democorp.com',
      firstName:    'Guest',
      lastName:     'Demo',
      passwordHash: guestPasswordHash,
      role:         'Restricted User',
      status:       'ACTIVE',
      emailVerified: new Date(),
    },
  });
  console.log('[Seed] ✓ Guest: guest@democorp.com');

  // Create UserRole junction for guest. Tenant safety: look up within guestTenant only.
  const guestRoleDef = await prisma.roleDefinition.findFirst({
    where: { tenantId: guestTenant.id, name: 'Restricted User' },
  });
  if (guestRoleDef && guestRoleDef.tenantId === guestTenant.id) {
    await prisma.userRole.upsert({
      where: { userId_roleId_tenantId: { userId: guestUser.id, roleId: guestRoleDef.id, tenantId: guestTenant.id } },
      update: {},
      create: { userId: guestUser.id, roleId: guestRoleDef.id, tenantId: guestTenant.id },
    });
    console.log('[Seed]   → UserRole created: guest@democorp.com → Restricted User');
  }

  // Ensure the guest sandbox tenant has a default pipeline (normally created by registerGuest,
  // but demo.seed.ts bypasses that path — so we create it idempotently here).
  const guestPipelineExists = await prisma.pipeline.count({ where: { tenantId: guestTenant.id } });
  if (guestPipelineExists === 0) {
    await prisma.pipeline.create({
      data: {
        tenantId: guestTenant.id,
        name: 'Sales Pipeline',
        isDefault: true,
        stages: {
          create: [
            { name: 'Lead',      order: 1, isDefault: true, tenantId: guestTenant.id },
            { name: 'Contacted', order: 2,                  tenantId: guestTenant.id },
            { name: 'Qualified', order: 3,                  tenantId: guestTenant.id },
            { name: 'Won',       order: 4, isWon: true,     tenantId: guestTenant.id },
            { name: 'Lost',      order: 5, isLost: true,    tenantId: guestTenant.id },
          ],
        },
      },
    });
  }

  // Seed sandbox CRM data for the guest tenant (idempotent).
  await seedSandboxData(guestTenant.id, guestUser.id).catch((err) => {
    console.error('[Seed] Failed to seed sandbox data for guest tenant:', err instanceof Error ? err.message : err);
    // Non-blocking in the seeder context — the tenant and user are usable either way
  });

  // Seed some contacts and deals for the client tenant
  const userClientAdmin = await prisma.user.findFirst({ where: { email: 'admin@democorp.com' } });
  
  if (userClientAdmin) {
    // Check if leads already exist
    const leadsCount = await prisma.lead.count({ where: { tenantId: clientTenant.id } });
    if (leadsCount === 0) {
      console.log('[Seed] Seeding sample leads & deals...');
      await prisma.lead.create({
        data: {
          tenantId:       clientTenant.id,
          firstName:      'John',
          lastName:       'Doe',
          email:          'john.doe@example.com',
          companyName:    'Tech Solutions',
          status:         'Inquiry',
          assignedUserId: userClientAdmin.id,
        },
      });

      const pipeline = await prisma.pipeline.create({
        data: {
          tenantId: clientTenant.id,
          name: 'Main Sales Pipeline',
          isDefault: true,
          stages: {
            create: [
              { name: 'Lead',      order: 1, isDefault: true, tenantId: clientTenant.id, color: '#64748b', probability: 10 },
              { name: 'Contacted', order: 2,                  tenantId: clientTenant.id, color: '#3b82f6', probability: 25 },
              { name: 'Qualified', order: 3,                  tenantId: clientTenant.id, color: '#8b5cf6', probability: 50 },
              { name: 'Won',       order: 4, isWon: true,     tenantId: clientTenant.id, color: '#10b981', probability: 100 },
              { name: 'Lost',      order: 5, isLost: true,    tenantId: clientTenant.id, color: '#ef4444', probability: 0 },
            ]
          }
        }
      });

      const stageLead = await prisma.stage.findFirst({ where: { pipelineId: pipeline.id, name: 'Lead' }});

      if (stageLead) {
        await prisma.deal.create({
          data: {
            tenantId: clientTenant.id,
            pipelineId: pipeline.id,
            stageId: stageLead.id,
            title: 'Tech Solutions Q3 Software License',
            value: 15000,
            currency: 'USD',
            assignedUserId: userClientAdmin.id,
            ownerId: userClientAdmin.id,
          }
        });
      }
    }
  }
  
  // ── Seed Notifications ──────────────────────────────────────────────────
  try {
    await seedNotifications();
  } catch (error) {
    console.error('[Seed] Failed to seed notifications:', error);
  }

  console.log('[Seed] Demo accounts seeded successfully.');
}

// ── Standalone runner ─────────────────────────────────────────────────────
if (require.main === module) {
  seedDemoAccounts()
    .catch((err) => { console.error('[Seed] Error:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
