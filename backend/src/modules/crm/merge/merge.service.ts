import { salesTransaction, validateSalesOwner } from '../leads/lead-automation.service';
import { productRelationData } from '../leads/product-relations';
import { serializeLead } from '../leads/lead-serializer';
import prisma from '../../../config/database.config';
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
// The update contracts explicitly permit clearing these relationships with null.
// Required identity fields (including Email) must keep their nonempty value.
const NULLABLE_MERGE_FIELDS = new Set(['accountId', 'assignedUserId']);

// Fields that are mergeable for each entity type
const LEAD_MERGE_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'companyName', 'address',
  'productInterest', 'source', 'assignedUserId',
  'accountId',
];

const CONTACT_MERGE_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'company', 'address',
  'productInterests', 'source', 'assignedUserId', 'status', 'accountId',
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
  if (primaryId === secondaryId) throw new ValidationError('Choose two different Leads.');
  const [primary, secondary] = await Promise.all([
    prisma.lead.findFirst({ where: { id: primaryId, tenantId } }),
    prisma.lead.findFirst({ where: { id: secondaryId, tenantId } }),
  ]);

  if (!primary) throw new NotFoundError('Primary lead');
  if (!secondary) throw new NotFoundError('Secondary lead');
  if (primary.isArchived || primary.convertedAt || primary.status === 'Merged') throw new ValidationError('Primary lead has already been merged');
  if (secondary.isArchived || secondary.convertedAt || secondary.status === 'Merged') throw new ValidationError('Secondary lead has already been merged');

  const fieldComparisons = buildFieldComparisons(primary, secondary, LEAD_MERGE_FIELDS);

  const [primaryCounts, secondaryCounts] = await Promise.all([
    repo.countLeadRelationships(primaryId, tenantId),
    repo.countLeadRelationships(secondaryId, tenantId),
  ]);

  return {
    primary: serializeLead(primary),
    secondary: serializeLead(secondary),
    fieldComparisons,
    relationshipCounts: { primary: primaryCounts, secondary: secondaryCounts },
  };
}

async function executeLeadMerge(
  tenantId: string, userId: string, primaryId: string, secondaryId: string,
  fieldResolutions: Record<string, 'primary' | 'secondary'>,
): Promise<MergeExecuteResult> {
  if (primaryId === secondaryId) throw new ValidationError('Choose two different Leads.');
  const result = await salesTransaction(async tx => {
    const [primary, secondary] = await Promise.all([
      tx.lead.findFirst({ where: { id: primaryId, tenantId } }),
      tx.lead.findFirst({ where: { id: secondaryId, tenantId } }),
    ]);

    if (!primary) throw new NotFoundError('Primary lead');
    if (!secondary) throw new NotFoundError('Secondary lead');
    if (primary.isArchived || primary.convertedAt || primary.status === 'Merged') throw new ValidationError('Primary lead has already been merged');
    if (secondary.isArchived || secondary.convertedAt || secondary.status === 'Merged') throw new ValidationError('Secondary lead has already been merged');

    const mergedData = resolveFields(primary, secondary, fieldResolutions, LEAD_MERGE_FIELDS);

    if (mergedData.assignedUserId && mergedData.assignedUserId !== primary.assignedUserId) await validateSalesOwner(tx, tenantId, String(mergedData.assignedUserId));
    // 1. Reassign relationships
    const reassignedCounts = await repo.reassignLeadRelationships(tx, primaryId, secondaryId, tenantId);

    if (mergedData.productInterest !== undefined) {
      const selected = fieldResolutions.productInterest === 'secondary' ? secondary : primary;
      const { productsNormalized } = await tx.lead.findFirstOrThrow({ where: { tenantId, id: selected.id }, select: { productsNormalized: true } });
      Object.assign(mergedData, await productRelationData(tx, 'lead', tenantId,
        productsNormalized ? { ids: selected.productInterestIds } : { names: selected.productInterest },
        { productInterest: [...primary.productInterest, ...secondary.productInterest], productInterestIds: [...primary.productInterestIds, ...secondary.productInterestIds] }, true));
    }
    // 2. Update primary with resolved fields
    const updatedPrimary = await tx.lead.update({
      where: { id: primaryId, tenantId } as never,
      data: { ...mergedData, updatedById: userId } as never,
    });

    // 3. Archive secondary
    await tx.lead.update({
      where: { id: secondaryId, tenantId } as never,
      data: { isArchived: true, deletedAt: new Date(), deletedBy: userId, updatedById: userId } as never,
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

    await tx.auditLog.create({ data: { tenantId, userId, action: 'lead.merged', entityType: 'Lead', entityId: primaryId, metadata: { secondaryId, mergedFields: Object.keys(fieldResolutions) } } });
    return { mergedRecord: updatedPrimary, reassignedCounts };
  });


  return {
    mergedRecord: serializeLead(result.mergedRecord),
    archivedRecordId: secondaryId,
    reassignedCounts: result.reassignedCounts,
  };
}

// ── Contact Merge ─────────────────────────────────────────────────────────────

async function previewContactMerge(tenantId: string, primaryId: string, secondaryId: string): Promise<MergePreviewResult> {
  if (primaryId === secondaryId) throw new ValidationError('Choose two different Contacts.');
  const [primary, secondary] = await Promise.all([
    prisma.contact.findFirst({ where: { id: primaryId, tenantId, isArchived: false, deletedAt: null } }),
    prisma.contact.findFirst({ where: { id: secondaryId, tenantId, isArchived: false, deletedAt: null } }),
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
  if (primaryId === secondaryId) throw new ValidationError('Choose two different Contacts.');
  const result = await salesTransaction(async tx => {
    const [primary, secondary] = await Promise.all([
      tx.contact.findFirst({ where: { id: primaryId, tenantId, isArchived: false, deletedAt: null } }),
      tx.contact.findFirst({ where: { id: secondaryId, tenantId, isArchived: false, deletedAt: null } }),
    ]);

    if (!primary) throw new NotFoundError('Primary contact');
    if (!secondary) throw new NotFoundError('Secondary contact');

    const mergedData = resolveFields(primary, secondary, fieldResolutions, CONTACT_MERGE_FIELDS);

    if (mergedData.assignedUserId && mergedData.assignedUserId !== primary.assignedUserId) {
      await validateSalesOwner(tx, tenantId, String(mergedData.assignedUserId));
    }

    const reassignedCounts = await repo.reassignContactRelationships(tx, primaryId, secondaryId, tenantId);
    if (mergedData.productInterests !== undefined) Object.assign(mergedData, await productRelationData(tx, 'contact', tenantId, { names: mergedData.productInterests as string[] }, { ...primary, productInterests: [...primary.productInterests, ...secondary.productInterests] }, true));

    const updatedPrimary = await tx.contact.update({
      where: { id: primaryId, tenantId },
      data: mergedData as never,
    });

    await tx.contact.update({
      where: { id: secondaryId, tenantId },
      data: { isArchived: true, deletedAt: new Date(), deletedBy: userId },
    });

    await tx.activity.create({
      data: {
        tenantId, createdById: userId,
        type: 'merge',
        title: `Merged with contact "${secondary.firstName} ${secondary.lastName}"`,
        contactId: primaryId,
      } as never,
    });

    await tx.auditLog.create({ data: { tenantId, userId, action: 'contact.merged', entityType: 'Contact', entityId: primaryId,
      metadata: { secondaryId, mergedFields: Object.keys(fieldResolutions) } } });
    return { mergedRecord: updatedPrimary, reassignedCounts };
  });

  return {
    mergedRecord: result.mergedRecord as unknown as Record<string, unknown>,
    archivedRecordId: secondaryId,
    reassignedCounts: result.reassignedCounts,
  };
}

// ── Account Merge ─────────────────────────────────────────────────────────────

async function previewAccountMerge(tenantId: string, primaryId: string, secondaryId: string): Promise<MergePreviewResult> {
  if (primaryId === secondaryId) throw new ValidationError('Choose two different Accounts.');
  const [primary, secondary] = await Promise.all([
    prisma.account.findFirst({ where: { id: primaryId, tenantId, isArchived: false, deletedAt: null } }),
    prisma.account.findFirst({ where: { id: secondaryId, tenantId, isArchived: false, deletedAt: null } }),
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
  if (primaryId === secondaryId) throw new ValidationError('Choose two different Accounts.');
  const result = await salesTransaction(async (tx) => {
    const [primary, secondary] = await Promise.all([
      tx.account.findFirst({ where: { id: primaryId, tenantId, isArchived: false, deletedAt: null } }),
      tx.account.findFirst({ where: { id: secondaryId, tenantId, isArchived: false, deletedAt: null } }),
    ]);
    if (!primary) throw new NotFoundError('Primary account');
    if (!secondary) throw new NotFoundError('Secondary account');
    const mergedData = resolveFields(primary, secondary, fieldResolutions, ACCOUNT_MERGE_FIELDS);
    if (mergedData.assignedUserId && mergedData.assignedUserId !== primary.assignedUserId) {
      await validateSalesOwner(tx, tenantId, String(mergedData.assignedUserId));
    }
    const reassignedCounts = await repo.reassignAccountRelationships(tx, primaryId, secondaryId, tenantId);
    if (mergedData.productInterests !== undefined || mergedData.activeProducts !== undefined) Object.assign(mergedData, await productRelationData(tx, 'account', tenantId, { names: mergedData.productInterests as string[] | undefined, activeNames: mergedData.activeProducts as string[] | undefined }, { ...primary, productInterests: [...primary.productInterests, ...secondary.productInterests], activeProducts: [...primary.activeProducts, ...secondary.activeProducts] }, true));

    const updatedPrimary = await tx.account.update({
      where: { id: primaryId, tenantId },
      data: mergedData as never,
    });

    await tx.account.update({
      where: { id: secondaryId, tenantId },
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

    await tx.auditLog.create({ data: { tenantId, userId, action: 'account.merged', entityType: 'Account', entityId: primaryId,
      metadata: { secondaryId, mergedFields: Object.keys(fieldResolutions) } } });
    return { mergedRecord: updatedPrimary, reassignedCounts };
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
      if (val !== undefined && (val !== null || NULLABLE_MERGE_FIELDS.has(field))) {
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
