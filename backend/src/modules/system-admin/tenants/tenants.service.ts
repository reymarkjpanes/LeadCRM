import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { hashPassword } from '../../../shared/helpers/crypto';
import { AppError } from '../../../shared/errors/app-error';
import { ConflictError, NotFoundError } from '../../../shared/errors/http-error';
import { activateTenantSubscription } from '../../billing/subscriptions/subscription-activation.service';
import type { CreateTenantDto } from './tenants.dto';

function createSlug(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listTenants() {
  return prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      industry: true,
      companySize: true,
      email: true,
      phone: true,
      address: true,
      status: true,
      plan: true,
      createdAt: true,
    },
  });
}

export async function deactivateTenant(id: string, actorId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new NotFoundError('Client');
  if (tenant.status === 'SUSPENDED') return tenant;

  const updatedTenant = await prisma.$transaction(async (tx) => {
    const updated = await tx.tenant.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });

    await tx.auditLog.create({
      data: {
        tenantId: id,
        userId: actorId,
        action: 'tenant.deactivated',
        entityType: 'Tenant',
        entityId: id,
        category: 'admin',
        severity: 'WARNING',
        changeset: { before: { status: tenant.status }, after: { status: 'SUSPENDED' } } as Prisma.InputJsonValue,
      },
    });
    return updated;
  });

  return updatedTenant;
}

export async function activateTenant(id: string, actorId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new NotFoundError('Client');
  if (tenant.status === 'ACTIVE') return tenant;

  return prisma.$transaction(async (tx) => {
    const updatedTenant = await tx.tenant.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    await tx.auditLog.create({
      data: {
        tenantId: id,
        userId: actorId,
        action: 'tenant.activated',
        entityType: 'Tenant',
        entityId: id,
        category: 'admin',
        changeset: { before: { status: tenant.status }, after: { status: 'ACTIVE' } } as Prisma.InputJsonValue,
      },
    });
    return updatedTenant;
  });
}

export async function createTenant(dto: CreateTenantDto, actorId: string) {
  const email = dto.email.trim().toLowerCase();
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (existingUser) throw new ConflictError('A user with this email already exists');

  const existingTenant = await prisma.tenant.findFirst({
    where: {
      name: { equals: dto.name.trim(), mode: 'insensitive' },
      industry: dto.industry.trim(),
      companySize: dto.companySize.trim(),
      email: { equals: email, mode: 'insensitive' },
    },
  });
  if (existingTenant) throw new ConflictError('A client with the same company and admin details already exists');

  let plan = await prisma.pricingPlan.findFirst({
    where: { planType: dto.plan, isActive: true },
  });
  if (!plan && dto.plan === 'STARTER') {
    plan = await prisma.pricingPlan.upsert({
      where: { name: 'Starter' },
      update: { planType: 'STARTER', isActive: true },
      create: { name: 'Starter', planType: 'STARTER', monthlyPrice: 1350, isActive: true },
    });
  }
  if (!plan) throw new NotFoundError('Subscription plan');

  const passwordHash = await hashPassword(dto.password);
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: dto.name,
        slug: createSlug(dto.name),
        industry: dto.industry,
        companySize: dto.companySize,
        email,
        phone: dto.phone || undefined,
        address: dto.address || undefined,
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        plan: dto.plan,
        maxUsers: plan.maxUsers,
        maxContacts: plan.maxContacts,
        maxDeals: plan.maxDeals,
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId:      tenant.id,
        firstName:     dto.firstName,
        lastName:      dto.lastName,
        email,
        passwordHash,
        role:          'Client Admin',
        status:        'ACTIVE',
        // System Admin is explicitly creating a pre-verified, active account —
        // email verification is not required for admin-provisioned tenants.
        emailVerified: new Date(),
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    await tx.account.create({
      data: {
        tenantId: tenant.id,
        name: dto.name,
        industry: dto.industry,
        size: dto.companySize,
        address: dto.address || undefined,
      },
    });

    await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        amount: plan.monthlyPrice,
        startDate: new Date(),
      },
    });

    return { tenant, user };
  });

  await prisma.auditLog.create({
    data: {
      tenantId: result.tenant.id,
      userId: actorId,
      action: 'tenant.created',
      entityType: 'Tenant',
      entityId: result.tenant.id,
      changeset: { name: dto.name, plan: dto.plan, adminEmail: result.user.email } as Prisma.InputJsonValue,
    },
  });

  return result;
}

// ─── System Admin Dev Bypass ──────────────────────────────────────────────────

/**
 * manuallyActivateTenantSubscription
 *
 * Manually activates a SANDBOX tenant to a chosen plan and promotes its
 * founding user to Client Admin — without going through Stripe.
 *
 * Requires: ADMIN_BILLING_BYPASS_ENABLED=true in environment.
 * Only allowed for tenants in SANDBOX state. ACTIVE/SUSPENDED tenants are rejected.
 * The tenant must have ownerUserId set (required for Client Admin promotion).
 *
 * Uses the shared activateTenantSubscription() service — identical transaction
 * to the Stripe webhook path. activationSource='SYSTEM_ADMIN_BYPASS' in audit log
 * distinguishes these activations from real Stripe activations.
 */
export async function manuallyActivateTenantSubscription(
  tenantId: string,
  planType: 'STARTER' | 'PRO' | 'ENTERPRISE',
  actorId:  string,
): Promise<{ tenantId: string; planType: string }> {
  // 1. Environment guard — only enabled when explicitly opted in
  if (process.env.ADMIN_BILLING_BYPASS_ENABLED !== 'true') {
    throw new AppError(
      'Admin billing bypass is not enabled in this environment. ' +
      'Set ADMIN_BILLING_BYPASS_ENABLED=true in backend/.env to use this endpoint.',
      403,
    );
  }

  // 2. Validate tenant exists
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant');

  // 3. Validate allowed state transition: SANDBOX → ACTIVE only
  if (tenant.status === 'ACTIVE') {
    throw new AppError('Tenant is already active', 400);
  }
  if (tenant.status === 'SUSPENDED') {
    throw new AppError('Cannot activate a suspended tenant via bypass — contact support', 400);
  }
  if (tenant.status !== 'SANDBOX') {
    throw new AppError(`Tenant is not in SANDBOX state (current: ${tenant.status})`, 400);
  }

  // 4. Validate ownerUserId is set — required for Client Admin promotion
  if (!tenant.ownerUserId) {
    throw new AppError(
      'Tenant has no owner assigned (ownerUserId is null) — cannot promote to Client Admin',
      400,
    );
  }

  // 5. Validate plan exists and is active
  const plan = await prisma.pricingPlan.findFirst({
    where: { planType, isActive: true },
  });
  if (!plan) throw new NotFoundError('Pricing plan');

  // 6. Activate via shared service — same atomic transaction as Stripe webhook
  //    periodEnd: 1 year from now as a nominal billing period for bypass activations
  const periodEnd = new Date();
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  await activateTenantSubscription({
    tenantId,
    planId:                  plan.id,
    billingCycle:            'MONTHLY',
    periodEnd,
    stripeSubscriptionId:    null,
    stripeCheckoutSessionId: null,
    activationSource:        'SYSTEM_ADMIN_BYPASS',
    actorId,
  });

  return { tenantId, planType };
}
