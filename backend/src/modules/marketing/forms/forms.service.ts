import * as repo from './forms.repository';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError } from '../../../shared/errors/http-error';
import { getPaginationParams, paginate } from '../../../shared/helpers/pagination';
import type { CreateFormDto, UpdateFormDto } from './forms.dto';

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Return a paginated list of non-archived forms for the tenant.
 */
export async function getForms(
  tenantId: string,
  query:    Record<string, unknown>,
) {
  const { page, limit } = getPaginationParams(query);
  const { data, total } = await repo.findAll(tenantId, page, limit);
  return paginate(data, total, { page, limit });
}

/**
 * Return a single form by id, scoped to the tenant.
 * Throws 404 if the form does not exist or belongs to another tenant.
 */
export async function getFormById(
  id:       string,
  tenantId: string,
) {
  const form = await repo.findById(id, tenantId);
  if (!form) throw new NotFoundError('Form');
  return form;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new draft form.
 * createdById is always from the authenticated JWT — never from the request body.
 */
export async function createForm(
  tenantId:    string,
  createdById: string,
  dto:         CreateFormDto,
) {
  const form = await repo.create(tenantId, createdById, dto);

  // Non-blocking — audit failure must never block the primary operation
  void writeAuditLog({
    tenantId,
    userId:     createdById,
    action:     'form.created',
    entityType: 'MarketingForm',
    entityId:   form.id,
    after:      { name: form.name },
  });

  return form;
}

/**
 * Partially update a form's name, fields, design, or settings.
 * Verifies the form belongs to the tenant before updating.
 */
export async function updateForm(
  id:       string,
  tenantId: string,
  userId:   string,
  dto:      UpdateFormDto,
) {
  const existing = await repo.findById(id, tenantId);
  if (!existing) throw new NotFoundError('Form');

  const form = await repo.update(id, tenantId, dto);

  void writeAuditLog({
    tenantId,
    userId,
    action:     'form.updated',
    entityType: 'MarketingForm',
    entityId:   id,
    after:      dto as Record<string, unknown>,
  });

  return form;
}

/**
 * Publish a form — transitions status from 'draft' → 'published'.
 * Verifies the form belongs to the tenant before publishing.
 */
export async function publishForm(
  id:       string,
  tenantId: string,
  userId:   string,
) {
  const existing = await repo.findById(id, tenantId);
  if (!existing) throw new NotFoundError('Form');

  const form = await repo.publish(id, tenantId);

  void writeAuditLog({
    tenantId,
    userId,
    action:     'form.published',
    entityType: 'MarketingForm',
    entityId:   id,
    after:      { status: 'published', publishedAt: form.publishedAt },
  });

  return form;
}

/**
 * Soft-delete a form by setting isArchived = true.
 * Business data is never hard-deleted.
 * Verifies the form belongs to the tenant before archiving.
 */
export async function archiveForm(
  id:       string,
  tenantId: string,
  userId:   string,
) {
  const existing = await repo.findById(id, tenantId);
  if (!existing) throw new NotFoundError('Form');

  await repo.archive(id, tenantId);

  void writeAuditLog({
    tenantId,
    userId,
    action:     'form.archived',
    entityType: 'MarketingForm',
    entityId:   id,
    severity:   'WARNING',
  });
}
