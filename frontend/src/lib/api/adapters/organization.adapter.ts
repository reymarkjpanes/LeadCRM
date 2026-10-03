'use client';

/**
 * Prepares frontend Organization data for backend creation (CreateCompanyDto).
 * 
 * @param {Record<string, any>} data Frontend organization data
 * @returns {Record<string, any>} Data formatted for backend creation
 */
export function toBackendCreateOrg(data: Record<string, any>): Record<string, any> {
  return {
    name: data.name || 'Unnamed Organization',
    industry: data.industry || undefined,
    size: data.size || undefined,
    website: data.website || undefined,
    tags: Array.isArray(data.tags) ? data.tags : [],
    address: data.address || undefined,
    city: data.city || undefined,
    province: data.province || undefined,
    country: data.country || 'Philippines',
    assignedUserId: data.assignedUserId || undefined,
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

  if (data.name !== undefined) result.name = data.name;
  if (data.industry !== undefined) result.industry = data.industry || undefined;
  if (data.size !== undefined) result.size = data.size || undefined;
  if (data.website !== undefined) result.website = data.website || undefined;
  if (data.tags !== undefined) result.tags = Array.isArray(data.tags) ? data.tags : [];
  if (data.address !== undefined) result.address = data.address || undefined;
  if (data.city !== undefined) result.city = data.city || undefined;
  if (data.province !== undefined) result.province = data.province || undefined;
  if (data.country !== undefined) result.country = data.country || undefined;
  if (data.assignedUserId !== undefined) result.assignedUserId = data.assignedUserId || undefined;

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
    tenantId: backendOrg.tenantId || '',
    name: backendOrg.name || 'Unnamed Organization',
    industry: backendOrg.industry || '',
    size: backendOrg.size || '',
    website: backendOrg.website || '',
    assignedUserId: backendOrg.assignedUserId || '',
    tags: Array.isArray(backendOrg.tags) ? backendOrg.tags : [],
    createdAt: backendOrg.createdAt || new Date().toISOString(),
    isArchived: !!backendOrg.isArchived,
    address: backendOrg.address || '',
    city: backendOrg.city || '',
    province: backendOrg.province || '',
    country: backendOrg.country || 'Philippines',
    postalCode: backendOrg.postalCode || '',
  };
}
