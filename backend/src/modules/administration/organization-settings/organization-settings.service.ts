import { OrganizationRequiredFieldsSchema, UpdateOrganizationSettingsSchema, type UpdateOrganizationSettings } from '@leadcrm/shared';
import type { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { buildChangeset } from '../../../core/audit/audit.service';
import { NotFoundError } from '../../../shared/errors/http-error';

const select = {
  id: true, status: true, name: true, industry: true, email: true, phone: true, domain: true, address: true,
} satisfies Prisma.TenantSelect;

export async function getOrganizationSettings(tenantId: string) {
  const settings = await prisma.tenant.findUnique({ where: { id: tenantId }, select });
  if (!settings) throw new NotFoundError('Organization');
  return settings;
}

export async function updateOrganizationSettings(tenantId: string, userId: string, input: UpdateOrganizationSettings) {
  const data = UpdateOrganizationSettingsSchema.parse(input);
  return prisma.$transaction(async tx => {
    const before = await tx.tenant.findUnique({ where: { id: tenantId }, select });
    if (!before) throw new NotFoundError('Organization');
    // PATCH may omit unchanged fields, but required persisted values may never be blank.
    OrganizationRequiredFieldsSchema.parse({ ...before, ...data });
    const saved = await tx.tenant.update({ where: { id: tenantId }, data, select });
    await tx.auditLog.create({ data: {
      tenantId, userId, action: 'organization.updated', entityType: 'Tenant', entityId: tenantId,
      category: 'system', changeset: buildChangeset(before, saved) as Prisma.InputJsonObject,
    } });
    return saved;
  });
}
