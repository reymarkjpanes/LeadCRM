// Domains repository — thin DB layer, all queries scoped to tenantId.
// Business logic lives in domains.service.ts.

import prisma from '../../../config/database.config';

const DOMAIN_SELECT = {
  id:         true,
  tenantId:   true,
  domain:     true,
  isVerified: true,
  verifiedAt: true,
  createdAt:  true,
  updatedAt:  true,
} as const;

const SETTINGS_SELECT = {
  id:                     true,
  tenantId:               true,
  restrictToEmailDomains: true,
  joinPolicy:             true,
  defaultRole:            true,
  createdAt:              true,
  updatedAt:              true,
} as const;

export async function findAllDomains(tenantId: string) {
  return prisma.tenantDomain.findMany({
    where:   { tenantId },
    select:  DOMAIN_SELECT,
    orderBy: { domain: 'asc' },
  });
}

export async function findDomainById(id: string, tenantId: string) {
  return prisma.tenantDomain.findFirst({
    where:  { id, tenantId },
    select: DOMAIN_SELECT,
  });
}

export async function findDomainByValue(tenantId: string, domain: string) {
  return prisma.tenantDomain.findFirst({
    where:  { tenantId, domain },
    select: DOMAIN_SELECT,
  });
}

export async function createDomain(tenantId: string, domain: string) {
  return prisma.tenantDomain.create({
    data:   { tenantId, domain },
    select: DOMAIN_SELECT,
  });
}

export async function verifyDomain(id: string) {
  return prisma.tenantDomain.update({
    where:  { id },
    data:   { isVerified: true, verifiedAt: new Date() },
    select: DOMAIN_SELECT,
  });
}

export async function deleteDomain(id: string) {
  return prisma.tenantDomain.delete({ where: { id } });
}

export async function findDomainSettings(tenantId: string) {
  return prisma.tenantDomainSettings.findUnique({
    where:  { tenantId },
    select: SETTINGS_SELECT,
  });
}

export async function upsertDomainSettings(
  tenantId: string,
  data: { restrictToEmailDomains: boolean; joinPolicy: string; defaultRole: string },
) {
  return prisma.tenantDomainSettings.upsert({
    where:  { tenantId },
    create: { tenantId, ...data },
    update: data,
    select: SETTINGS_SELECT,
  });
}
