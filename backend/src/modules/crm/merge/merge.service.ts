import prisma from '../../../config/database.config';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import * as repo from './merge.repository';
import type {
  MergePreviewParams,
  MergeExecuteParams,
  MergePreviewResult,
  MergeExecuteResult,
  FieldComparison,
} from './merge.types';

// Fields to exclude from merge comparison (system-managed)
const SYSTEM_FIELDS = new Set([
  'id', 'tenantId', 'createdAt', 'updatedAt', 'deletedAt', 'deletedBy',
  'createdById', 'updatedById', 'convertedAt', 'convertedById', 'contactId',
]);

// Fields that are mergeable for each entity type
const LEAD_MERGE_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'companyName', 'address',
  'description', 'website', 'productInterest', 'source', 'assignedUserId',
  'status', 'accountId', 'lastStatusChangedAt',
];

const CONTACT_MERGE_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'companyName', 'address',
  'productInterest', 'source', 'assignedUserId', 'status', 'accountId',
];

const ACCOUNT_MERGE_FIELDS = [
  'name', 'industry', 'size', 'website', 'notes', 'internalNotes',
  'tags', 'productInterests', 'activeProducts',
  'address', 'city', 'province', 'country', 'assignedUserId',
];

/**
 * Generate a merge preview — compares two records side by side
 * and returns field differences and relationship counts.
 */
export async function preview(params: MergePreviewParams): Promise<MergePreviewResult> {
  const { tenantId, entityType, primaryId, secondaryId } = params;

  if (entityType === 'lead') {
    return previewLeadMerge(tenantId, primaryId, secondaryId);
  } else if (entityType === 'contact') {
    return previewContactMerge(tenantId, primaryId, secondaryId);
  } else {
    return previewAccountMerge(tenantId, primaryId, secondaryId);
  }
}

/**
 * Execute the merge — combines two records into one,
 * reassigns relationships, archives the secondary.
 */
export async function execute(params: MergeExecuteParams): Promise<MergeExecuteResult> {
  const { tenantId, userId, entityType, primaryId, secondaryId, fieldResolutions } = params;

  if (entityType === 'lead') {
    return executeLeadMerge(tenantId, userId, primaryId, secondaryId, fieldResolutions);
  } else if (entityType === 'contact') {
    return executeContactMerge(tenantId, userId, primaryId, secondaryId, fieldResolutions);
  } else {
    return executeAccountMerge(tenantId, userId, primaryId, secondaryId, fieldResolutions);
  }
}

// ── Lead Merge ────────────────────────────────────────────────────────────────

async function previewLeadMerge(tenantId: string, primaryId: string, secondaryId: string): Promise<MergePreviewResult> {
  const [primary, secondary] = await Promise.all([
    prisma.lead.findFirst({ where: { id: primaryId, tenantId } }),
    prisma.lead.findFirst({ where: { id: secondaryId, tenantId } }),
  ]);

  if (!primary) throw new NotFoundError('Primary lead');
  if (!secondary) throw new NotFoundError('Secondary lead');
  if (primary.status === 'Merged') throw new ValidationError('Primary lead has already been merged');
  if (secondary.status === 'Merged') throw new ValidationError('Secondary lead has already been merged');

  const fieldComparisons = buildFieldComparisons(primary, secondary, LEAD_MERGE_FIELDS);

  const [primaryCounts, secondaryCounts] = await Promise.all([
    repo.countLeadRelationships(primaryId, tenantId),
    repo.countLeadRelationships(secondaryId, tenantId),
  ]);

  return {
    primary: primary as unknown as Record<string, unknown>,
    secondary: secondary as unknown as Record<string, unknown>,
    fieldComparisons,
    relationshipCounts: { primary: primaryCounts, secondary: secondaryCounts },
  };
}

async function executeLeadMerge(
  tenantId: string, userId: string, primaryId: string, secondaryId: string,
  fieldResolutions: Record<string, 'primary' | 'secondary'>,
): Promise<MergeExecuteResult> {
  const [primary, secondary] = await Promise.all([
    prisma.lead.findFirst({ where: { id: primaryId, tenantId } }),
    prisma.lead.findFirst({ where: { id: secondaryId, tenantId } }),
  ]);

  if (!primary) throw new NotFoundError('Primary lead');
  if (!secondary) throw new NotFoundError('Secondary lead');
  if (primary.status === 'Merged') throw new ValidationError('Primary lead has already been merged');
  if (secondary.status === 'Merged') throw new ValidationError('Secondary lead has already been merged');

  const mergedData = resolveFields(primary, secondary, fieldResolutions, LEAD_MERGE_FIELDS);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Reassign relationships
    const reassignedCounts = await repo.reassignLeadRelationships(tx, primaryId, secondaryId, tenantId);

    // 2. Update primary with resolved fields
    const updatedPrimary = await tx.lead.update({
      where: { id: primaryId } as never,
      data: { ...mergedData, updatedById: userId } as never,
    });

    // 3. Archive secondary
    await tx.lead.update({
      where: { id: secondaryId } as never,
      data: { status: 'Merged', updatedById: userId } as never,
    });

    // 4. Activity on primary
    await tx.activity.create({
      data: {
        tenantId, createdById: userId,
        type: 'merge',
        title: `Merged with lead "${secondary.firstName} ${secondary.lastName}"`,
        leadId: primaryId,
      } as never,
    });

    return { mergedRecord: updatedPrimary, reassignedCounts };
  });

  await writeAuditLog({
    tenantId, userId,
    action: 'lead.merged',
    entityType: 'Lead',
    entityId: primaryId,
    after: { secondaryId, mergedFields: Object.keys(fieldResolutions) },
  });

  return {
    mergedRecord: result.mergedRecord as unknown as Record<string, unknown>,
    archivedRecordId: secondaryId,
    reassignedCounts: result.reassignedCounts,
  };
}

// ── Contact Merge ─────────────────────────────────────────────────────────────

async function previewContactMerge(tenantId: string, primaryId: string, secondaryId: string): Promise<MergePreviewResult> {
  const [primary, secondary] = await Promise.all([
    prisma.contact.findFirst({ where: { id: primaryId, tenantId } }),
    prisma.contact.findFirst({ where: { id: secondaryId, tenantId } }),
  ]);

  if (!primary) throw new NotFoundError('Primary contact');
  if (!secondary) throw new NotFoundError('Secondary contact');

  const fieldComparisons = buildFieldComparisons(primary, secondary, CONTACT_MERGE_FIELDS);

  const [primaryCounts, secondaryCounts] = await Promise.all([
    repo.countContactRelationships(primaryId, tenantId),
    repo.countContactRelationships(secondaryId, tenantId),
  ]);

  return {
    primary: primary as unknown as Record<string, unknown>,
    secondary: secondary as unknown as Record<string, unknown>,
    fieldComparisons,
    relationshipCounts: { primary: primaryCounts, secondary: secondaryCounts },
  };
}

async function executeContactMerge(
  tenantId: string, userId: string, primaryId: string, secondaryId: string,
  fieldResolutions: Record<string, 'primary' | 'secondary'>,
): Promise<MergeExecuteResult> {
  const [primary, secondary] = await Promise.all([
    prisma.contact.findFirst({ where: { id: primaryId, tenantId } }),
    prisma.contact.findFirst({ where: { id: secondaryId, tenantId } }),
  ]);

  if (!primary) throw new NotFoundError('Primary contact');
  if (!secondary) throw new NotFoundError('Secondary contact');

  const mergedData = resolveFields(primary, secondary, fieldResolutions, CONTACT_MERGE_FIELDS);

  const result = await prisma.$transaction(async (tx) => {
    const reassignedCounts = await repo.reassignContactRelationships(tx, primaryId, secondaryId, tenantId);

    const updatedPrimary = await tx.contact.update({
      where: { id: primaryId } as never,
      data: mergedData as never,
    });

    await tx.contact.update({
      where: { id: secondaryId } as never,
      data: { status: 'Archived' } as never,
    });

    await tx.activity.create({
      data: {
        tenantId, createdById: userId,
        type: 'merge',
        title: `Merged with contact "${secondary.firstName} ${secondary.lastName}"`,
        contactId: primaryId,
      } as never,
    });

    return { mergedRecord: updatedPrimary, reassignedCounts };
  });

  await writeAuditLog({
    tenantId, userId,
    action: 'contact.merged',
    entityType: 'Contact',
    entityId: primaryId,
    after: { secondaryId, mergedFields: Object.keys(fieldResolutions) },
  });

  return {
    mergedRecord: result.mergedRecord as unknown as Record<string, unknown>,
    archivedRecordId: secondaryId,
    reassignedCounts: result.reassignedCounts,
  };
}

// ── Account Merge ─────────────────────────────────────────────────────────────

async function previewAccountMerge(tenantId: string, primaryId: string, secondaryId: string): Promise<MergePreviewResult> {
  const [primary, secondary] = await Promise.all([
    prisma.account.findFirst({ where: { id: primaryId, tenantId, isArchived: false } }),
    prisma.account.findFirst({ where: { id: secondaryId, tenantId, isArchived: false } }),
  ]);

  if (!primary) throw new NotFoundError('Primary account');
  if (!secondary) throw new NotFoundError('Secondary account');

  const fieldComparisons = buildFieldComparisons(primary, secondary, ACCOUNT_MERGE_FIELDS);

  const [primaryCounts, secondaryCounts] = await Promise.all([
    repo.countAccountRelationships(primaryId, tenantId),
    repo.countAccountRelationships(secondaryId, tenantId),
  ]);

  return {
    primary: primary as unknown as Record<string, unknown>,
    secondary: secondary as unknown as Record<string, unknown>,
    fieldComparisons,
    relationshipCounts: { primary: primaryCounts, secondary: secondaryCounts },
  };
}

async function executeAccountMerge(
  tenantId: string, userId: string, primaryId: string, secondaryId: string,
  fieldResolutions: Record<string, 'primary' | 'secondary'>,
): Promise<MergeExecuteResult> {
  const [primary, secondary] = await Promise.all([
    prisma.account.findFirst({ where: { id: primaryId, tenantId, isArchived: false } }),
    prisma.account.findFirst({ where: { id: secondaryId, tenantId, isArchived: false } }),
  ]);

  if (!primary) throw new NotFoundError('Primary account');
  if (!secondary) throw new NotFoundError('Secondary account');

  const mergedData = resolveFields(primary, secondary, fieldResolutions, ACCOUNT_MERGE_FIELDS);

  const result = await prisma.$transaction(async (tx) => {
    const reassignedCounts = await repo.reassignAccountRelationships(tx, primaryId, secondaryId, tenantId);

    const updatedPrimary = await tx.account.update({
      where: { id: primaryId } as never,
      data: mergedData as never,
    });

    await tx.account.update({
      where: { id: secondaryId } as never,
      data: { isArchived: true, deletedAt: new Date(), deletedBy: userId } as never,
    });

    await tx.activity.create({
      data: {
        tenantId, createdById: userId,
        type: 'merge',
        title: `Merged with account "${secondary.name}"`,
        accountId: primaryId,
      } as never,
    });

    return { mergedRecord: updatedPrimary, reassignedCounts };
  });

  await writeAuditLog({
    tenantId, userId,
    action: 'account.merged',
    entityType: 'Account',
    entityId: primaryId,
    after: { secondaryId, mergedFields: Object.keys(fieldResolutions) },
  });

  return {
    mergedRecord: result.mergedRecord as unknown as Record<string, unknown>,
    archivedRecordId: secondaryId,
    reassignedCounts: result.reassignedCounts,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFieldComparisons(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
  fields: string[],
): FieldComparison[] {
  return fields.map((field) => {
    const pVal = (primary as Record<string, unknown>)[field];
    const sVal = (secondary as Record<string, unknown>)[field];
    return {
      field,
      primaryValue: pVal ?? null,
      secondaryValue: sVal ?? null,
      isDifferent: JSON.stringify(pVal ?? null) !== JSON.stringify(sVal ?? null),
    };
  });
}

function resolveFields(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
  resolutions: Record<string, 'primary' | 'secondary'>,
  allowedFields: string[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (SYSTEM_FIELDS.has(field)) continue;

    const resolution = resolutions[field];
    if (resolution === 'secondary') {
      const val = (secondary as Record<string, unknown>)[field];
      if (val !== undefined && val !== null) {
        merged[field] = val;
      }
    } else if (resolution === 'primary') {
      // Explicitly set primary value (handles case where we want to keep empty)
      const val = (primary as Record<string, unknown>)[field];
      if (val !== undefined) {
        merged[field] = val;
      }
    }
    // If no resolution specified for a field, primary value is kept (no update needed)
  }

  return merged;
}
