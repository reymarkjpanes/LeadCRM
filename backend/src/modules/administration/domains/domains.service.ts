// Domains service — business logic layer.
// No req/res here; all Prisma access goes through domains.repository.ts.

import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ConflictError } from '../../../shared/errors/http-error';
import * as repo from './domains.repository';

export async function getAll(tenantId: string) {
  return repo.findAllDomains(tenantId);
}

export async function create(tenantId: string, actorId: string, domain: string) {
  const existing = await repo.findDomainByValue(tenantId, domain);
  if (existing) throw new ConflictError('This domain is already registered for your organization');

  const record = await repo.createDomain(tenantId, domain);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'domain.added', entityType: 'TenantDomain', entityId: record.id,
    after: { domain },
  });
  return record;
}

export async function verify(id: string, tenantId: string, actorId: string) {
  const existing = await repo.findDomainById(id, tenantId);
  if (!existing) throw new NotFoundError('Domain');
  if (existing.isVerified) return existing; // already verified — idempotent

  const record = await repo.verifyDomain(id);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'domain.verified', entityType: 'TenantDomain', entityId: id,
    after: { domain: existing.domain, isVerified: true },
  });
  return record;
}

export async function remove(id: string, tenantId: string, actorId: string) {
  const existing = await repo.findDomainById(id, tenantId);
  if (!existing) throw new NotFoundError('Domain');

  await repo.deleteDomain(id);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'domain.removed', entityType: 'TenantDomain', entityId: id,
    after: { domain: existing.domain },
    severity: 'WARNING',
  });
}

export async function getSettings(tenantId: string) {
  const settings = await repo.findDomainSettings(tenantId);
  // Return defaults if no settings row exists yet
  return settings ?? {
    id: null,
    tenantId,
    restrictToEmailDomains: false,
    joinPolicy: 'after_approval',
    defaultRole: 'Sales Rep',
    createdAt: null,
    updatedAt: null,
  };
}

export async function updateSettings(
  tenantId: string,
  actorId: string,
  data: { restrictToEmailDomains: boolean; joinPolicy: string; defaultRole: string },
) {
  const settings = await repo.upsertDomainSettings(tenantId, data);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'domain.settings_updated', entityType: 'TenantDomainSettings',
    after: data as Record<string, unknown>,
  });
  return settings;
}
