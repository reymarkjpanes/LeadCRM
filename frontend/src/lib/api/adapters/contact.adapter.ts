'use client';

import { CrmStatusSchema, normalizeCrmStatus, type CrmStatus } from '@leadcrm/shared';

/** API writes use canonical status validation; response compatibility stays at the boundary. */
export function toBackendStatus(status?: string): CrmStatus {
  return CrmStatusSchema.parse(status ?? 'Warm');
}
export const toFrontendStatus = normalizeCrmStatus;

/**
 * Prepares frontend Contact data for backend creation (CreateContactDto).
 * Maps field names and drops frontend-only properties.
 * 
 * @param {Partial<any>} data Frontend contact data
 * @returns {Record<string, any>} Data formatted for backend creation
 */
export function toBackendCreateContact(data: Record<string, any>): Record<string, any> {
  const firstName = data.firstName ?? '';
  const lastName = data.lastName ?? '';

  return {
    customFieldValues: data.customFieldValues,
    newAccount: data.newAccount,
    requestId: data.requestId,
    firstName,
    lastName,
    email: data.email || undefined,
    phone: data.phone || undefined,
    companyName: data.companyName || undefined,
    status: toBackendStatus(data.status),
    source: data.source ?? data.leadSource ?? undefined,
    accountId: data.accountId || undefined,
    assignedUserId: data.assignedUserId || undefined,
    productInterest: data.productInterestIds ?? data.productInterest,
    address: data.address || undefined,
  };
}

/**
 * Prepares frontend Contact data for backend update (UpdateContactDto).
 * Only includes fields that are present, translating keys appropriately.
 * 
 * @param {Partial<any>} data Frontend contact data
 * @returns {Record<string, any>} Data formatted for backend update
 */
export function toBackendUpdateContact(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  if (data.expectedUpdatedAt !== undefined) result.expectedUpdatedAt = data.expectedUpdatedAt;
  if (data.customFieldValues !== undefined) result.customFieldValues = data.customFieldValues;
  if (data.newAccount !== undefined) result.newAccount = data.newAccount;

  if (data.firstName !== undefined) result.firstName = data.firstName;
  if (data.lastName !== undefined) result.lastName = data.lastName;

  if (data.email !== undefined) result.email = data.email;
  if (data.phone !== undefined) result.phone = data.phone ?? '';
  if (data.companyName !== undefined) result.companyName = data.companyName ?? '';
  if (data.status !== undefined) result.status = toBackendStatus(data.status);
  if (data.leadSource !== undefined || data.source !== undefined) result.source = data.source ?? data.leadSource ?? '';
  if (data.accountId !== undefined) result.accountId = data.accountId || null;
  if (data.assignedUserId !== undefined) result.assignedUserId = data.assignedUserId || null;
  if (data.productInterestIds !== undefined || data.productInterest !== undefined) result.productInterest = data.productInterestIds ?? data.productInterest ?? [];
  if (data.address !== undefined) result.address = data.address ?? '';

  return result;
}

/**
 * Translates backend contact response into frontend Contact type.
 * Handles missing fields with safe defaults.
 * 
 * @param {any} backendContact Backend contact object
 * @returns {Record<string, any>} Frontend Contact object
 */
export function toFrontendContact(backendContact: any): Record<string, any> {
  if (!backendContact) return {};

  const firstName = backendContact.firstName || '';
  const lastName = backendContact.lastName || '';
  const contactPerson = [firstName, lastName].filter(Boolean).join(' ');

  return {
    ownerGroupId: backendContact.ownerGroupId,
    statusEditOptions: backendContact.statusEditOptions,
    statusEditRestrictions: backendContact.statusEditRestrictions,
    statusManagedByDeals: backendContact.statusManagedByDeals,
    manualCancellation: backendContact.manualCancellation,
    id: backendContact.id || '',
    tenantId: backendContact.tenantId || '',
    organizationId: backendContact.organizationId || backendContact.accountId || undefined,
    accountId: backendContact.accountId || undefined,
    contactId: backendContact.contactId,
    convertedAt: backendContact.convertedAt,
    lifecycleStage: backendContact.lifecycleStage,
    customerSince: backendContact.customerSince,
    companyName: backendContact.companyName || backendContact.account?.name || backendContact.organization?.name || '',
    contactPerson: contactPerson || 'Unknown',
    firstName,
    lastName,
    email: backendContact.email || '',
    phone: backendContact.phone || '',
    productInterestIds: backendContact.productInterestIds,
    productInterests: Array.isArray(backendContact.productInterest)
      ? backendContact.productInterest
      : (Array.isArray(backendContact.productInterests) ? backendContact.productInterests : []),
    productInterest: Array.isArray(backendContact.productInterest)
      ? backendContact.productInterest[0] || ''
      : (backendContact.productInterest || ''),
    leadSource: backendContact.source || '',
    source: backendContact.source || '',
    estimatedValue: 0, // Frontend only
    assignedUserId: backendContact.assignedUserId || '',
    expectedCloseDate: '', // Frontend only
    notes: backendContact.notes || '',
    description: backendContact.description || '',
    website: backendContact.website || '',
    createdByUser: backendContact.createdBy || undefined,
    updatedByUser: backendContact.updatedBy || undefined,
    lastStatusChangedAt: backendContact.lastStatusChangedAt || undefined,
    latestStatusChangeDate: backendContact.lastStatusChangedAt || undefined,
    status: toFrontendStatus(backendContact.status),
    createdAt: backendContact.createdAt || new Date().toISOString(),
    updatedAt: backendContact.updatedAt || undefined,
    isArchived: backendContact.status === 'Archived' || !!backendContact.isArchived,
    archivedAt: backendContact.deletedAt || undefined,
    archivedBy: backendContact.deletedBy || undefined,
    address: backendContact.address || '',
    // Nested relation objects (when included by Prisma)
    organization: backendContact.account || backendContact.organization || undefined,
    account: backendContact.account || undefined,
    assignedUser: backendContact.assignedUser || undefined,
  };
}

/** The legacy /crm/leads client shares name/display mapping with Contacts. */
export function toFrontendLegacyLead(lead: any): Record<string, any> {
  if (!lead) return {};
  return { ...toFrontendContact(lead), score: typeof lead.score === 'number' ? lead.score : 0,
    linkedin: lead.linkedinUrl || '', linkedinUrl: lead.linkedinUrl || '',
    customerType: lead.accountId ? 'Organization' : 'Individual' };
}
