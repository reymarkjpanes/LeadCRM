'use client';

/**
 * Prepares frontend Organization data for backend creation (CreateCompanyDto).
 * 
 * @param {Record<string, any>} data Frontend organization data
 * @returns {Record<string, any>} Data formatted for backend creation
 */
export function toBackendCreateOrg(data: Record<string, any>): Record<string, any> {
  return {
    customFieldValues: data.customFieldValues,
    requestId: data.requestId,
    name: data.name || 'Unnamed Organization',
    industry: data.industry || undefined,
    size: data.size || undefined,
    website: data.website || undefined,
    address: data.address || undefined,
  };
}

/**
 * Prepares frontend Organization data for backend update (UpdateCompanyDto).
 * 
 * @param {Record<string, any>} data Frontend organization data
 * @returns {Record<string, any>} Data formatted for backend update
 */
export function toBackendUpdateOrg(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  if (data.customFieldValues !== undefined) result.customFieldValues = data.customFieldValues;

  if (data.name !== undefined) result.name = data.name;
  if (data.industry !== undefined) result.industry = data.industry || undefined;
  if (data.size !== undefined) result.size = data.size || null;
  if (data.website !== undefined) result.website = data.website || undefined;
  if (data.address !== undefined) result.address = data.address || undefined;

  return result;
}

/**
 * Translates backend organization response into frontend Organization type.
 * Handles missing fields with safe defaults.
 * 
 * @param {any} backendOrg Backend organization object
 * @returns {Record<string, any>} Frontend Organization object
 */
export function toFrontendOrg(backendOrg: any): Record<string, any> {
  if (!backendOrg) return {};

  return {
    id: backendOrg.id || '',
    ownerGroupId: backendOrg.ownerGroupId,
    tenantId: backendOrg.tenantId || '',
    name: backendOrg.name || 'Unnamed Organization',
    industry: backendOrg.industry || '',
    size: backendOrg.size || '',
    website: backendOrg.website || '',
    email: backendOrg.email || '',
    phone: backendOrg.phone || '',
    notes: backendOrg.notes || '',
    updatedAt: backendOrg.updatedAt || undefined,
    dealCount: backendOrg.dealCount,
    dealValue: backendOrg.dealValue,
    createdAt: backendOrg.createdAt || new Date().toISOString(),
    isArchived: !!backendOrg.isArchived,
    address: backendOrg.address || '',
    postalCode: backendOrg.postalCode || '',
  };
}
