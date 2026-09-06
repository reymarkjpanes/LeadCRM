import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { hashPassword } from '../../../shared/helpers/crypto';
import { ConflictError, NotFoundError } from '../../../shared/errors/http-error';
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
        tenantId: tenant.id,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        passwordHash,
        role: 'Client Admin',
        status: 'ACTIVE',
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
