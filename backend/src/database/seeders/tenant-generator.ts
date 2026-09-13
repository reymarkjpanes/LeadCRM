import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';
import { hashPassword } from '../../shared/helpers/crypto';
import { seedSystemRoles } from './roles.seed';

const prisma = new PrismaClient();

const INDUSTRIES = [
  'SaaS / Software Company',
  'IT Services & Consulting',
  'Digital Marketing Agency',
  'Real Estate Agency',
  'Construction & Engineering',
  'Healthcare Clinic',
  'Retail & E-commerce',
  'Manufacturing',
  'Logistics & Transportation',
  'Financial Services'
];

// Helper for dates
const randomDatePast = (months = 6) => faker.date.recent({ days: months * 30 });
const randomDateFuture = (days = 30) => faker.date.soon({ days });

export async function seedSystemAdmin() {
  console.log('[Seed] Seeding System Administrator...');
  const passwordHash = await hashPassword('admin123');

  await prisma.systemAdmin.upsert({
    where: { email: 'super@leadcrm.com' },
    update: {},
    create: {
      email: 'super@leadcrm.com',
      firstName: 'System',
      lastName: 'Administrator',
      passwordHash,
      isActive: true,
    },
  });
}

export async function generateTenants(count: number = 10) {
  console.log(`[Seed] Generating ${count} Realistic Tenants...`);
  const defaultPassword = await hashPassword('password123');

  // Pricing plans must exist for subscriptions
  const planPro = await prisma.pricingPlan.upsert({
    where: { name: 'Pro' },
    update: {},
    create: { name: 'Pro', planType: 'PRO', monthlyPrice: 49, isActive: true }
  });
  const planEnterprise = await prisma.pricingPlan.upsert({
    where: { name: 'Enterprise' },
    update: {},
    create: { name: 'Enterprise', planType: 'ENTERPRISE', monthlyPrice: 99, isActive: true }
  });

  for (let i = 0; i < count; i++) {
    const industry = INDUSTRIES[i % INDUSTRIES.length];
    const companyName = faker.company.name();
    const slug = faker.helpers.slugify(companyName).toLowerCase() + '-' + i;
    
    console.log(`\n--- Generating Tenant ${i+1}/${count}: ${companyName} (${industry}) ---`);

    // 1. Create Tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: companyName,
        slug,
        industry,
        companySize: faker.helpers.arrayElement(['1-10', '11-50', '51-200', '200+']),
        email: faker.internet.email(),
        phone: faker.phone.number(),
        address: faker.location.streetAddress(),
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        plan: i % 2 === 0 ? 'PRO' : 'ENTERPRISE',
      }
    });

    await seedSystemRoles(tenant.id);

    // Create Subscription
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: i % 2 === 0 ? planPro.id : planEnterprise.id,
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        amount: i % 2 === 0 ? 49 : 99,
        startDate: randomDatePast(12),
      }
    });

    // 2. Roles & Permissions
    // seedSystemRoles already created Client Admin, User, and Guest system roles.
    // Only create custom (non-system) roles here.
    const rolesData = [
      { name: 'Sales Manager', isSystemRole: false, perms: { canView: true, canCreate: true, canEdit: true, canDelete: false } },
      { name: 'Marketing',     isSystemRole: false, perms: { canView: true, canCreate: true, canEdit: true, canDelete: false } },
      { name: 'Support Agent', isSystemRole: false, perms: { canView: true, canCreate: true, canEdit: true, canDelete: false } },
      { name: 'Finance',       isSystemRole: false, perms: { canView: true, canCreate: false, canEdit: false, canDelete: false } },
    ];
    
    const roleEntities: Record<string, { id: string }> = {};
    const modules = ['contacts', 'deals', 'organizations', 'campaigns', 'tasks', 'invoices', 'users', 'reports'];

    for (const rd of rolesData) {
      const roleDef = await prisma.roleDefinition.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: rd.name } },
        update: {}, // seedSystemRoles already inserted System ones
        create: {
          tenantId: tenant.id,
          name: rd.name,
          isSystemRole: rd.isSystemRole,
          permissions: {
            create: modules.map(m => ({
              tenantId: tenant.id,
              module: m,
              ...rd.perms
            }))
          }
        }
      });
      roleEntities[rd.name] = roleDef;
    }

    // 3. Users
    const usersList: { id: string; role: string }[] = [];
    
    const createUser = async (roleName: string, fName?: string, lName?: string, e?: string) => {
      const firstName = fName || faker.person.firstName();
      const lastName = lName || faker.person.lastName();
      const email = e || faker.internet.email({ firstName, lastName, provider: slug + '.com' });
      
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          firstName,
          lastName,
          email: email.toLowerCase(),
          passwordHash: defaultPassword,
          role: roleName, // legacy field
          status: 'ACTIVE',
          userRoles: {
            create: {
              roleId: roleEntities[roleName].id,
              tenantId: tenant.id,
            }
          }
        }
      });
      usersList.push(user);
      return user;
    };

    // Create the team
    // The tenant owner is created as Client Admin (the system role).
    // We look up the Client Admin RoleDefinition seeded by seedSystemRoles.
    const clientAdminRoleDef = await prisma.roleDefinition.findUniqueOrThrow({
      where: { tenantId_name: { tenantId: tenant.id, name: 'Client Admin' } },
    });
    roleEntities['Client Admin'] = clientAdminRoleDef;

    const createClientAdmin = async (fName?: string, lName?: string, e?: string) => {
      const firstName = fName || faker.person.firstName();
      const lastName  = lName || faker.person.lastName();
      const email     = e || faker.internet.email({ firstName, lastName, provider: slug + '.com' });
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          firstName,
          lastName,
          email: email.toLowerCase(),
          passwordHash: defaultPassword,
          role: 'Client Admin',
          status: 'ACTIVE',
          userRoles: { create: { roleId: clientAdminRoleDef.id, tenantId: tenant.id } },
        },
      });
      usersList.push(user);
      return user;
    };

    const clientAdmin = await createClientAdmin('Admin', 'User', `admin@${slug}.com`);
    await createUser('Sales Manager');
    const salesReps: { id: string; role: string }[] = [];
    const numSalesReps = faker.number.int({ min: 3, max: 6 });
    for(let j=0; j<numSalesReps; j++) salesReps.push(await createUser('User'));
    await createUser('Marketing');
    await createUser('Support Agent');
    await createUser('Finance');

    // 4. Accounts (Clients of this tenant)
    const numOrgs = faker.number.int({ min: 20, max: 50 });
    const orgEntities: { id: string }[] = [];
    for (let j = 0; j < numOrgs; j++) {
      const org = await prisma.account.create({
        data: {
          tenantId:      tenant.id,
          name:          faker.company.name(),
          industry:      faker.company.buzzNoun(),
          size:          faker.helpers.arrayElement(['1-10', '11-50', '51-200', '200+']),
          website:       faker.internet.url(),
          address:       faker.location.streetAddress(),
          city:          faker.location.city(),
          country:       faker.location.country(),
          assignedUserId: faker.helpers.arrayElement(salesReps).id,
          createdAt:     randomDatePast(12),
        },
      });
      orgEntities.push(org);
    }

    // 5. Leads
    const numContacts = faker.number.int({ min: 50, max: 150 });
    const leads: { id: string; lastName: string; accountId?: string | null }[] = [];
    for (let j = 0; j < numContacts; j++) {
      const assigned = faker.helpers.arrayElement(salesReps);
      const account  = faker.helpers.maybe(
        () => faker.helpers.arrayElement(orgEntities),
        { probability: 0.8 },
      );
      const lead = await prisma.lead.create({
        data: {
          tenantId:       tenant.id,
          accountId:      account?.id ?? null,
          assignedUserId: assigned.id,
          firstName:      faker.person.firstName(),
          lastName:       faker.person.lastName(),
          email:          faker.internet.email(),
          phone:          faker.phone.number(),
          status:         faker.helpers.arrayElement(['Inquiry', 'Contacted', 'Qualified', 'Closed']),
          source:         faker.helpers.arrayElement(['Website', 'Referral', 'Cold Call', 'Conference', 'LinkedIn']),
          createdAt:      randomDatePast(12),
        },
      });
      leads.push(lead);
    }

    // 6. Pipelines & Stages
    const salesPipeline = await prisma.pipeline.create({
      data: {
        tenantId: tenant.id,
        name: 'Standard Sales Pipeline',
        isDefault: true,
        type: 'Sales',
        stages: {
          create: [
            { name: 'Lead', order: 1, probability: 10, isDefault: true, color: '#6b7280', tenantId: tenant.id },
            { name: 'Meeting Scheduled', order: 2, probability: 30, color: '#3b82f6', tenantId: tenant.id },
            { name: 'Qualified', order: 3, probability: 50, color: '#8b5cf6', tenantId: tenant.id },
            { name: 'Proposal Sent', order: 4, probability: 75, color: '#f59e0b', tenantId: tenant.id },
            { name: 'Won', order: 5, probability: 100, isWon: true, color: '#10b981', tenantId: tenant.id },
            { name: 'Lost', order: 6, probability: 0, isLost: true, color: '#ef4444', tenantId: tenant.id },
          ]
        }
      },
      include: { stages: true }
    });

    // 7. Deals
    const numDeals = faker.number.int({ min: 30, max: 80 });
    for (let j = 0; j < numDeals; j++) {
      const stage    = faker.helpers.arrayElement(salesPipeline.stages);
      const assigned = faker.helpers.arrayElement(salesReps);
      const lead     = faker.helpers.arrayElement(leads);
      const account  = lead.accountId
        ? orgEntities.find((o) => o.id === lead.accountId) ?? null
        : null;

      const createdAt = randomDatePast(6);
      const isClosed  = stage.isWon || stage.isLost;

      const deal = await prisma.deal.create({
        data: {
          tenantId:          tenant.id,
          pipelineId:        salesPipeline.id,
          stageId:           stage.id,
          accountId:         account?.id ?? null,
          leadId:            lead.id,
          assignedUserId:    assigned.id,
          ownerId:           assigned.id,
          title:             `${lead.lastName ?? account?.id ?? 'Client'} - ${faker.commerce.productName()} Opportunity`,
          value:             faker.number.int({ min: 1000, max: 100000 }),
          currency:          'USD',
          priority:          faker.helpers.arrayElement(['LOW', 'MEDIUM', 'HIGH']) as 'LOW' | 'MEDIUM' | 'HIGH',
          expectedCloseDate: randomDateFuture(60),
          closedAt:          isClosed ? randomDatePast(1) : null,
          createdAt,
          updatedAt:         randomDatePast(1),
          leadDeals: {
            create: {
              leadId:    lead.id,
              tenantId:  tenant.id,
              role:      'Decision Maker',
              addedById: assigned.id,
            },
          },
        },
      });

      // Deal History, Tasks, Activities
      await prisma.dealStageHistory.create({
        data: {
          tenantId: tenant.id,
          dealId: deal.id,
          newStageId: stage.id,
          movedById: assigned.id,
          movedAt: deal.createdAt
        }
      });

      // Create a few tasks per deal
      const numTasks = faker.number.int({ min: 1, max: 4 });
      for (let k = 0; k < numTasks; k++) {
        const isCompleted = faker.datatype.boolean();
        await prisma.task.create({
          data: {
            tenantId:       tenant.id,
            dealId:         deal.id,
            leadId:         lead.id,
            assignedUserId: assigned.id,
            assignedById:   assigned.id,
            title:          faker.helpers.arrayElement(['Follow up call', 'Send Proposal', 'Schedule Demo', 'Review Requirements']),
            status:         isCompleted ? 'completed' : faker.helpers.arrayElement(['pending', 'in_progress']),
            priority:       faker.helpers.arrayElement(['Low', 'Medium', 'High']),
            dueDate:        isCompleted ? randomDatePast(2) : randomDateFuture(10),
            completedAt:    isCompleted ? randomDatePast(1) : null,
            completedById:  isCompleted ? assigned.id : null,
          },
        });
      }

      // Create some activity history
      const numActivities = faker.number.int({ min: 2, max: 6 });
      for (let k = 0; k < numActivities; k++) {
        await prisma.activity.create({
          data: {
            tenantId:    tenant.id,
            createdById: assigned.id,
            dealId:      deal.id,
            leadId:      lead.id,
            type:        faker.helpers.arrayElement(['call', 'meeting', 'email', 'note']),
            title:       faker.lorem.sentence(4),
            description: faker.lorem.paragraph(),
            createdAt:   randomDatePast(3),
          },
        });
      }

      // Invoices for Won deals
      if (stage.isWon) {
        await prisma.invoice.create({
          data: {
            tenantId:      tenant.id,
            dealId:        deal.id,
            leadId:        lead.id,
            accountId:     account?.id ?? null,
            invoiceNumber: `INV-${faker.number.int({ min: 1000, max: 9999 })}`,
            amount:        deal.value ?? 0,
            totalAmount:   deal.value ?? 0,
            currency:      'USD',
            frequency:     'One-time',
            status:        'Sent',
            paymentStatus: faker.helpers.arrayElement(['Paid', 'Unpaid']),
            startDate:     deal.createdAt,
            dueDate:       randomDateFuture(10),
            createdAt:     deal.createdAt,
          },
        });
      }
    }

    // 8. Campaigns
    const targetAudience = await prisma.targetAudience.create({
      data: {
        tenantId: tenant.id,
        name: 'Hot Leads',
        conditions: {
          create: [
            { field: 'status', operator: 'equals', value: 'HOT', conditionOrder: 1 }
          ]
        }
      }
    });

    await prisma.campaign.create({
      data: {
        tenantId: tenant.id,
        name: 'Q3 Product Update',
        type: 'EMAIL',
        status: 'ACTIVE',
        subject: 'Exciting news from ' + companyName,
        body: 'Check out our latest features...',
        targetAudienceId: targetAudience.id,
        sentCount: faker.number.int({min: 100, max: 500}),
        openedCount: faker.number.int({min: 50, max: 100}),
        clickedCount: faker.number.int({min: 10, max: 40}),
        engagement: 25.5,
      }
    });
    
    console.log(`[Seed] Finished generating data for Tenant: ${companyName}`);
  }
}
