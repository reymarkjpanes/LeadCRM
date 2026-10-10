'use client';

/**
 * Converts a frontend priority string to backend enum value.
 * @param priority - The frontend priority ('Low', 'Medium', 'High')
 * @returns The backend priority string ('LOW', 'MEDIUM', 'HIGH')
 */
export function toBackendPriority(priority?: string): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (!priority) return 'MEDIUM';
  switch (priority.toLowerCase()) {
    case 'low': return 'LOW';
    case 'high': return 'HIGH';
    case 'medium':
    default: return 'MEDIUM';
  }
}

/**
 * Converts a backend priority string to frontend enum value.
 * @param priority - The backend priority ('LOW', 'MEDIUM', 'HIGH')
 * @returns The frontend priority string ('Low', 'Medium', 'High')
 */
export function toFrontendPriority(priority?: string): 'Low' | 'Medium' | 'High' {
  if (!priority) return 'Medium';
  switch (priority.toUpperCase()) {
    case 'LOW': return 'Low';
    case 'HIGH': return 'High';
    case 'MEDIUM':
    default: return 'Medium';
  }
}

/**
 * Converts a plain date string ("YYYY-MM-DD") or ISO datetime to a full ISO 8601 datetime.
 * Required because the backend uses z.string().datetime() which rejects date-only strings.
 */
function toISODatetime(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  // Already a full ISO datetime
  if (value.includes('T')) return value;
  // Plain date "YYYY-MM-DD" → append midnight UTC
  return `${value}T00:00:00.000Z`;
}

/**
 * Maps and formats fields, and strips frontend-only properties.
 * Normalizes singular leadId/contactId into their respective arrays with deduplication.
 * Arrays are omitted entirely when empty (never sends undefined/null values).
 * 
 * @param data - Partial frontend deal data
 * @returns Object formatted for backend CreateDealDto
 */
export function toBackendCreateDeal(data: Partial<any>): any {
  // Normalize leadIds: merge singular leadId into leadIds array, deduplicate
  let leadIds: string[] | undefined;
  if (data.leadIds && data.leadIds.length > 0) {
    leadIds = [...new Set([...(data.leadId ? [data.leadId] : []), ...data.leadIds])];
  } else if (data.leadId) {
    leadIds = [data.leadId];
  }

  // Normalize contactIds: merge singular contactId into contactIds array, deduplicate
  let contactIds: string[] | undefined;
  if (data.contactIds && data.contactIds.length > 0) {
    contactIds = [...new Set([...(data.contactId ? [data.contactId] : []), ...data.contactIds])];
  } else if (data.contactId) {
    contactIds = [data.contactId];
  }

  const result: any = {
    customFieldValues: data.customFieldValues,
    pipelineId: data.pipelineId || '',
    stageId: data.stageId || '',
    title: data.title || 'Untitled Deal',
    value: typeof data.value === 'number' ? data.value : undefined,
    currency: 'PHP', // Default currency as per DTO
    priority: toBackendPriority(data.priority),
    expectedCloseDate: toISODatetime(data.expectedCloseDate),
    leadSource: data.leadSource || undefined,
    accountId: data.accountId || data.companyId || data.organizationId || undefined,
    industry: data.industry || undefined,
    address: data.address || undefined,
    productInterests: data.productInterests,
    productInterestId: data.productInterestId,
    productInterestIds: data.productInterestIds,
    productInterestOther: data.productInterestOther || undefined,
    assignedUserId: data.assignedUserId || undefined,
  };

  // Only include arrays if they have values — never send undefined/null
  if (leadIds && leadIds.length > 0) result.leadIds = leadIds;
  if (contactIds && contactIds.length > 0) result.contactIds = contactIds;

  return result;
}

/**
 * Prepares frontend deal data for updates in the backend API.
 * Maps and formats fields, ensuring only provided fields are included.
 * 
 * @param data - Partial frontend deal data
 * @returns Object formatted for backend UpdateDealDto
 */
export function toBackendUpdateDeal(data: Partial<any>): any {
  const updateData: any = {};
  if (data.customFieldValues !== undefined) updateData.customFieldValues = data.customFieldValues;

  // Note: stageId and pipelineId are intentionally excluded.
  // Stage changes MUST go through moveDealStage (PATCH /deals/:id/stage).
  // Pipeline changes are handled by moving to a stage in the target pipeline.
  if (data.title !== undefined) updateData.title = data.title;
  if (data.value !== undefined) updateData.value = data.value;
  if (data.priority !== undefined) updateData.priority = toBackendPriority(data.priority);
  if (data.expectedCloseDate !== undefined) updateData.expectedCloseDate = toISODatetime(data.expectedCloseDate);
  if (data.leadSource !== undefined) updateData.leadSource = data.leadSource;

  // Strip empty strings for optional UUID fields
  const orgId = data.accountId || data.companyId || data.organizationId;
  if (orgId) updateData.accountId = orgId;
  if (data.productInterestIds !== undefined) updateData.productInterestIds = data.productInterestIds;
  if (data.productInterests !== undefined) updateData.productInterests = data.productInterests;

  if (data.assignedUserId) updateData.assignedUserId = data.assignedUserId;

  // Strip empty contact IDs from the array before sending
  if (data.contactIds !== undefined) {
    const filtered = data.contactIds.filter(Boolean);
    if (filtered.length > 0) updateData.contactIds = filtered;
  } else if (data.contactId) {
    updateData.contactIds = [data.contactId];
  }

  return updateData;
}

/**
 * Maps a backend deal response to the frontend Deal type structure.
 * Handles derived fields, nested relations, and supplies safe defaults.
 * 
 * @param backendDeal - The deal object returned from the backend API
 * @returns Formatted frontend Deal object
 */
export function toFrontendDeal(backendDeal: any): any {
  if (!backendDeal) return null;

  // Derive company name
  const companyName = backendDeal.organization?.name || backendDeal.account?.name || '';
  const accountId = backendDeal.accountId || backendDeal.organizationId || backendDeal.organization?.id || backendDeal.account?.id || undefined;

  // Extract leadIds from leadDeals junction
  let leadIds: string[] = [];
  let leadId: string | undefined;
  let leadPerson: { id: string; firstName: string; lastName: string } | undefined;

  if (backendDeal.leadDeals && Array.isArray(backendDeal.leadDeals)) {
    leadIds = backendDeal.leadDeals
      .map((ld: any) => ld?.lead?.id || ld?.leadId)
      .filter(Boolean);
    leadId = leadIds[0] || undefined;

    const firstLead = backendDeal.leadDeals[0]?.lead;
    if (firstLead) {
      leadPerson = {
        id: firstLead.id,
        firstName: firstLead.firstName || '',
        lastName: firstLead.lastName || '',
      };
    }
  }
  if (!leadIds.length && (backendDeal.leadId || backendDeal.lead?.id)) {
    leadIds = [backendDeal.leadId || backendDeal.lead.id];
    leadId = leadIds[0];
    if (backendDeal.lead) leadPerson = { id: leadId!, firstName: backendDeal.lead.firstName || '', lastName: backendDeal.lead.lastName || '' };
  }

  // Derive contact person and contact IDs — use the ContactDeal junction
  let contactPerson = '';
  let contactIds: string[] = [];

  if (backendDeal.contactDeals && Array.isArray(backendDeal.contactDeals)) {
    contactIds = backendDeal.contactDeals
      .map((cd: any) => cd?.contact?.id || cd?.contactId)
      .filter(Boolean);

    const firstContact = backendDeal.contactDeals[0]?.contact;
    if (firstContact) {
      contactPerson = [firstContact.firstName, firstContact.lastName]
        .filter(Boolean)
        .join(' ') || firstContact.email || '';
    }
  }
  if (!contactIds.length && (backendDeal.contactId || backendDeal.contact?.id)) {
    contactIds = [backendDeal.contactId || backendDeal.contact.id];
    if (backendDeal.contact) contactPerson = [backendDeal.contact.firstName, backendDeal.contact.lastName].filter(Boolean).join(' ');
  }

  // Process history and find last stage change date
  let history: any[] = [];
  let lastStageChangeDate: string | undefined = undefined;
  
  if (backendDeal.stageHistories && Array.isArray(backendDeal.stageHistories)) {
    history = backendDeal.stageHistories.map((sh: any) => ({
      stageId: sh.newStage?.id || '',
      previousStageId: sh.previousStage?.id || undefined,
      timestamp: sh.movedAt || new Date().toISOString(),
      userId: sh.movedBy?.id || '',
      note: sh.note || undefined
    }));
    
    if (history.length > 0) {
      const dates = history.map(h => new Date(h.timestamp).getTime());
      const maxDate = new Date(Math.max(...dates));
      lastStageChangeDate = maxDate.toISOString();
    }
  }

  return {
    id: backendDeal.id || '',
    productInterestId: backendDeal.productInterestId,
    productInterestIds: backendDeal.productInterestIds?.length ? backendDeal.productInterestIds : backendDeal.productInterestId ? [backendDeal.productInterestId] : [],
    tenantId: backendDeal.tenantId || '',
    pipelineId: backendDeal.pipelineId || '',
    stageId: backendDeal.stageId || '',
    title: backendDeal.title || 'Untitled Deal',
    accountId,
    organizationId: accountId,
    leadId: leadId,
    leadIds: leadIds.length > 0 ? leadIds : undefined,
    leadPerson: leadPerson,
    contactId: contactIds.length > 0 ? contactIds[0] : undefined,
    contactIds: contactIds,
    companyId: accountId,
    companyName: companyName,
    contactPerson: contactPerson || (leadPerson ? [leadPerson.firstName, leadPerson.lastName].filter(Boolean).join(' ') : ''),
    productInterests: Array.isArray(backendDeal.productInterests) ? backendDeal.productInterests : [],
    value: typeof backendDeal.value === 'number' ? backendDeal.value : 0,
    priority: toFrontendPriority(backendDeal.priority),
    expectedCloseDate: backendDeal.expectedCloseDate || '',
    assignedUserId: backendDeal.assignedUserId || backendDeal.ownerId || '',
    assignedUser: backendDeal.assignedUser || undefined,
    lostReason: backendDeal.lostReason || undefined,
    order: typeof backendDeal.order === 'number' ? backendDeal.order : 0,
    createdAt: backendDeal.createdAt || new Date().toISOString(),
    updatedAt: backendDeal.updatedAt || undefined,
    lastStageChangeDate: lastStageChangeDate,
    leadSource: backendDeal.leadSource || undefined,
    industry: backendDeal.industry || undefined,
    
    // Frontend-only or unmapped backend fields default setups
    location: undefined,
    campaign: undefined,
    customerType: undefined,
    // Tags are String[] on both sides now (DI-6)
    tags: Array.isArray(backendDeal.tags) ? backendDeal.tags : (backendDeal.tags ? [backendDeal.tags] : []),
    isArchived: !!backendDeal.isArchived,
    history: history,
    activities: [],
    ownershipHistory: []
  };
}
