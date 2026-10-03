'use client';

import { CrmStatusSchema, normalizeCrmStatus, type CrmStatus } from '@leadcrm/shared';

/** API writes must use the canonical contract; never silently replace invalid input. */
export function toBackendStatus(status?: string): CrmStatus {
  return CrmStatusSchema.parse(status ?? 'Warm');
}

export const toFrontendStatus = normalizeCrmStatus;

/**
 * Splits a full name into first and last name.
 * 
 * @param {string} fullName The full name string
 * @returns {{ firstName: string, lastName: string }} First and last name parts
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: 'Unknown', lastName: 'Unknown' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Unknown' };
  const lastName = parts.pop() || 'Unknown';
  const firstName = parts.join(' ') || 'Unknown';
  return { firstName, lastName };
}

/**
 * Prepares frontend Contact data for backend creation (CreateContactDto).
 * Maps field names and drops frontend-only properties.
 * 
 * @param {Partial<any>} data Frontend contact data
 * @returns {Record<string, any>} Data formatted for backend creation
 */
export function toBackendCreateContact(data: Record<string, any>): Record<string, any> {
  const { firstName, lastName } = data.contactPerson 
    ? splitName(data.contactPerson) 
    : { 
        firstName: data.firstName || 'Unknown', 
        lastName: data.lastName || 'Unknown' 
      };

  return {
    requestId: data.requestId,
    firstName,
    lastName,
    email: data.email || undefined,
    phone: data.phone || undefined,
    companyName: data.companyName || undefined,
    status: toBackendStatus(data.status),
    source: data.leadSource || data.source || undefined,
    accountId: data.accountId || undefined,
    assignedUserId: data.assignedUserId || undefined,
    productInterest: Array.isArray(data.productInterests)
      ? data.productInterests
      : (Array.isArray(data.productInterest)
        ? data.productInterest
        : (data.productInterest ? [data.productInterest] : undefined)),
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

  if (data.contactPerson !== undefined || data.firstName !== undefined || data.lastName !== undefined) {
    if (data.contactPerson) {
      const { firstName, lastName } = splitName(data.contactPerson);
      result.firstName = firstName;
      result.lastName = lastName;
    } else {
      if (data.firstName !== undefined) result.firstName = data.firstName;
      if (data.lastName !== undefined) result.lastName = data.lastName;
    }
  }

  if (data.email !== undefined) result.email = data.email || undefined;
  if (data.phone !== undefined) result.phone = data.phone || undefined;
  if (data.companyName !== undefined) result.companyName = data.companyName || undefined;
  if (data.status !== undefined) result.status = toBackendStatus(data.status);
  if (data.leadSource !== undefined || data.source !== undefined) result.source = data.leadSource || data.source || undefined;
  if (data.accountId !== undefined) result.accountId = data.accountId || undefined;
  if (data.assignedUserId !== undefined) result.assignedUserId = data.assignedUserId || undefined;
  if (data.productInterests !== undefined) result.productInterest = data.productInterests;
  else if (data.productInterest !== undefined) result.productInterest = data.productInterest ? (Array.isArray(data.productInterest) ? data.productInterest : [data.productInterest]) : [];
  if (data.address !== undefined) result.address = data.address || undefined;

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
    id: backendContact.id || '',
    tenantId: backendContact.tenantId || '',
    organizationId: backendContact.organizationId || backendContact.accountId || undefined,
    accountId: backendContact.accountId || undefined,
    companyName: backendContact.companyName || backendContact.company || '',
    contactPerson: contactPerson || 'Unknown',
    firstName,
    lastName,
    jobTitle: backendContact.jobTitle || '',
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
    status: toFrontendStatus(backendContact.status),
    score: typeof backendContact.score === 'number' ? backendContact.score : 0,
    createdAt: backendContact.createdAt || new Date().toISOString(),
    updatedAt: backendContact.updatedAt || undefined,
    isArchived: backendContact.status === 'Archived' || !!backendContact.isArchived,
    archivedAt: backendContact.deletedAt || undefined,
    archivedBy: backendContact.deletedBy || undefined,
    linkedin: backendContact.linkedinUrl || '',
    customerType: backendContact.accountId ? 'Organization' : 'Individual',
    address: backendContact.address || '',
    // Nested relation objects (when included by Prisma)
    organization: backendContact.account || backendContact.organization || undefined,
    assignedUser: backendContact.assignedUser || undefined,
  };
}
