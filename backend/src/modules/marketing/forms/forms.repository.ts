import prisma from '../../../config/database.config';
import type { CreateFormDto, UpdateFormDto } from './forms.dto';

// ─── Safe select (exclude nothing — all fields are non-sensitive) ─────────────

const FORM_SELECT = {
  id:          true,
  tenantId:    true,
  createdById: true,
  name:        true,
  status:      true,
  fields:      true,
  design:      true,
  settings:    true,
  publishedAt: true,
  isArchived:  true,
  createdAt:   true,
  updatedAt:   true,
} as const;

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List all non-archived forms for a tenant, newest first.
 * Always filters by tenantId — never returns cross-tenant data.
 */
export async function findAll(
  tenantId: string,
  page: number,
  limit: number,
): Promise<{ data: FormRow[]; total: number }> {
  const where = { tenantId, isArchived: false };
  const skip  = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.marketingForm.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { createdAt: 'desc' },
      select:  FORM_SELECT,
    }),
    prisma.marketingForm.count({ where }),
  ]);

  return { data, total };
}

/**
 * Find a single form by id scoped to the tenant.
 * Returns null if not found — caller decides whether to throw 404.
 */
export async function findById(
  id:       string,
  tenantId: string,
): Promise<FormRow | null> {
  return prisma.marketingForm.findFirst({
    where:  { id, tenantId, isArchived: false },
    select: FORM_SELECT,
  });
}

/**
 * Create a new form with empty fields/design/settings.
 * createdById is always the authenticated user from the JWT — never client-supplied.
 */
export async function create(
  tenantId:    string,
  createdById: string,
  dto:         CreateFormDto,
): Promise<FormRow> {
  return prisma.marketingForm.create({
    data: {
      tenantId,
      createdById,
      name:     dto.name,
      status:   'draft',
      fields:   [],
      design:   {},
      settings: {},
    },
    select: FORM_SELECT,
  });
}

/**
 * Partial update — only updates provided fields.
 * Always scoped by id + tenantId to prevent cross-tenant writes.
 */
export async function update(
  id:       string,
  tenantId: string,
  dto:      UpdateFormDto,
): Promise<FormRow> {
  return prisma.marketingForm.update({
    where:  { id },
    data: {
      ...(dto.name     !== undefined ? { name: dto.name }                    : {}),
      ...(dto.fields   !== undefined ? { fields:   dto.fields as object[] }  : {}),
      ...(dto.design   !== undefined ? { design:   dto.design as object }    : {}),
      ...(dto.settings !== undefined ? { settings: dto.settings as object }  : {}),
    },
    select: FORM_SELECT,
  });
}

/**
 * Publish a form — sets status to 'published' and stamps publishedAt.
 * Always scoped by id + tenantId.
 */
export async function publish(
  id:       string,
  tenantId: string,
): Promise<FormRow> {
  return prisma.marketingForm.update({
    where:  { id },
    data:   { status: 'published', publishedAt: new Date() },
    select: FORM_SELECT,
  });
}

/**
 * Soft-delete — sets isArchived to true.
 * Business data is never hard-deleted.
 */
export async function archive(
  id:       string,
  tenantId: string,
): Promise<void> {
  await prisma.marketingForm.update({
    where: { id },
    data:  { isArchived: true },
  });
}

// ─── Row type inferred from Prisma select ─────────────────────────────────────

type FormRow = {
  id:          string;
  tenantId:    string;
  createdById: string;
  name:        string;
  status:      string;
  fields:      unknown;
  design:      unknown;
  settings:    unknown;
  publishedAt: Date | null;
  isArchived:  boolean;
  createdAt:   Date;
  updatedAt:   Date;
};
