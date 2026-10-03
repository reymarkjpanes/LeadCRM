import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { toBackendCreateDeal, toFrontendDeal } from '../deal.adapter';

it('retains product filters and the originating Lead name in board data', () => {
  const deal = toFrontendDeal({ productInterests: ['Smart Lock'], leadDeals: [{ lead: { id: 'lead', firstName: 'Juan', lastName: 'Cruz' } }] });
  expect(deal.productInterests).toEqual(['Smart Lock']);
  expect(deal.contactPerson).toBe('Juan Cruz');
});

/**
 * Property-based tests for deal-linkage-unified-crud spec.
 * Tests the adapter layer's normalization of linkage fields.
 */

describe('Feature: deal-linkage-unified-crud, Property 1: leadId normalization in toBackendCreateDeal', () => {
  /**
   * Validates: Requirements 2.1, 8.1, 8.2
   *
   * For any valid input object with a non-empty leadId string and/or a non-empty leadIds array,
   * toBackendCreateDeal SHALL produce an output with a leadIds array that contains all unique IDs
   * from both sources, and SHALL NOT contain duplicates.
   */
  it('should merge singular leadId into leadIds array with deduplication', () => {
    fc.assert(
      fc.property(
        fc.option(fc.uuid(), { nil: undefined }), // leadId (singular)
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }), // leadIds (array)
        fc.string({ minLength: 1 }), // title (required field)
        (leadId, leadIds, title) => {
          const input: Record<string, unknown> = {
            title,
            pipelineId: 'pipeline-1',
            stageId: 'stage-1',
          };
          if (leadId) input.leadId = leadId;
          if (leadIds.length > 0) input.leadIds = leadIds;

          const result = toBackendCreateDeal(input);

          // Compute expected unique IDs from both sources
          const expectedIds = [...new Set([...(leadId ? [leadId] : []), ...leadIds])];

          if (expectedIds.length === 0) {
            // No leadIds key should exist on the result
            expect(result).not.toHaveProperty('leadIds');
          } else {
            expect(result.leadIds).toBeDefined();
            expect(result.leadIds).toHaveLength(expectedIds.length);
            // No duplicates
            expect(new Set(result.leadIds).size).toBe(result.leadIds.length);
            // Contains all expected IDs
            for (const id of expectedIds) {
              expect(result.leadIds).toContain(id);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle leadId present in leadIds array without duplication', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // leadId that will also be in the array
        fc.array(fc.uuid(), { minLength: 1, maxLength: 4 }),
        (leadId, otherIds) => {
          // Include leadId in the leadIds array to test deduplication
          const leadIds = [leadId, ...otherIds];
          const input: Record<string, unknown> = {
            title: 'Test Deal',
            pipelineId: 'pipeline-1',
            stageId: 'stage-1',
            leadId,
            leadIds,
          };

          const result = toBackendCreateDeal(input);

          // leadId should not be duplicated
          const count = result.leadIds.filter((id: string) => id === leadId).length;
          expect(count).toBe(1);
          // Total length should equal unique count
          expect(result.leadIds).toHaveLength(new Set(leadIds).size);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce leadIds with only leadId when leadIds array is empty', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // leadId (always present)
        (leadId) => {
          const input: Record<string, unknown> = {
            title: 'Test Deal',
            pipelineId: 'pipeline-1',
            stageId: 'stage-1',
            leadId,
          };

          const result = toBackendCreateDeal(input);

          expect(result.leadIds).toEqual([leadId]);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: deal-linkage-unified-crud, Property 5: leadIds round-trip extraction in toFrontendDeal', () => {
  /**
   * **Validates: Requirements 2.4, 9.5**
   *
   * For any backend deal response with a leadDeals array of N entries
   * (each containing lead.id), toFrontendDeal SHALL produce an output
   * where leadIds contains exactly those N IDs and leadId equals the
   * first entry's ID (or undefined if N = 0).
   */
  it('should extract leadIds from leadDeals junction and set leadId to first entry', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lead: fc.record({
              id: fc.uuid(),
              firstName: fc.string({ minLength: 1, maxLength: 20 }),
              lastName: fc.string({ minLength: 1, maxLength: 20 }),
              email: fc.emailAddress(),
            }),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (leadDeals) => {
          const backendDeal = {
            id: 'deal-1',
            tenantId: 'tenant-1',
            pipelineId: 'pipeline-1',
            stageId: 'stage-1',
            title: 'Test Deal',
            leadDeals,
          };

          const result = toFrontendDeal(backendDeal);

          const expectedIds = leadDeals.map((ld) => ld.lead.id);

          if (expectedIds.length === 0) {
            expect(result.leadId).toBeUndefined();
            expect(result.leadIds).toBeUndefined();
          } else {
            expect(result.leadIds).toEqual(expectedIds);
            expect(result.leadId).toBe(expectedIds[0]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: deal-linkage-unified-crud, Property 2: contactId normalization in toBackendCreateDeal', () => {
  /**
   * Validates: Requirements 3.1, 8.3
   *
   * For any valid input object with a non-empty contactId string and/or a non-empty
   * contactIds array, toBackendCreateDeal SHALL produce an output with a contactIds
   * array that contains all unique IDs from both sources, and SHALL NOT contain duplicates.
   */
  it('should merge singular contactId into contactIds array with deduplication', () => {
    fc.assert(
      fc.property(
        fc.option(fc.uuid(), { nil: undefined }),  // contactId
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),  // contactIds
        fc.string({ minLength: 1 }),  // title
        (contactId, contactIds, title) => {
          const input: Record<string, unknown> = { title, pipelineId: 'p1', stageId: 's1' };
          if (contactId) input.contactId = contactId;
          if (contactIds.length > 0) input.contactIds = contactIds;

          const result = toBackendCreateDeal(input);

          const expectedIds = [...new Set([...(contactId ? [contactId] : []), ...contactIds])];

          if (expectedIds.length === 0) {
            expect(result).not.toHaveProperty('contactIds');
          } else {
            expect(result.contactIds).toBeDefined();
            expect(result.contactIds).toHaveLength(expectedIds.length);
            // No duplicates
            expect(new Set(result.contactIds).size).toBe(result.contactIds.length);
            // All expected IDs are present
            for (const id of expectedIds) {
              expect(result.contactIds).toContain(id);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: deal-linkage-unified-crud, Property 3: organizationId normalization in toBackendCreateDeal', () => {
  /**
   * Validates: Requirements 2.3, 4.1, 8.4
   *
   * For any valid input object where companyId or organizationId is a non-empty string,
   * toBackendCreateDeal SHALL produce an output with organizationId set to that value
   * (preferring companyId when both are present).
   */
  it('should prefer companyId over organizationId when both present', () => {
    fc.assert(
      fc.property(
        fc.option(fc.uuid(), { nil: undefined }), // companyId
        fc.option(fc.uuid(), { nil: undefined }), // organizationId
        (companyId, organizationId) => {
          const input: any = { title: 'Test', pipelineId: 'p1', stageId: 's1' };
          if (companyId) input.companyId = companyId;
          if (organizationId) input.organizationId = organizationId;

          const result = toBackendCreateDeal(input);

          if (companyId) {
            expect(result.accountId).toBe(companyId);
          } else if (organizationId) {
            expect(result.accountId).toBe(organizationId);
          } else {
            expect(result.accountId).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: deal-linkage-unified-crud, Property 6: contactIds extraction in toFrontendDeal', () => {
  /**
   * **Validates: Requirements 3.3, 9.6**
   *
   * For any backend deal response with a contactDeals array of N entries
   * (each containing contact.id or customer.id), toFrontendDeal SHALL produce an output
   * where contactIds contains exactly those N IDs.
   */
  it('should extract contactIds from contactDeals junction', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            contact: fc.record({
              id: fc.uuid(),
              firstName: fc.string({ minLength: 1, maxLength: 20 }),
              lastName: fc.string({ minLength: 1, maxLength: 20 }),
              email: fc.emailAddress(),
            }),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (contactDeals) => {
          const backendDeal = {
            id: 'deal-1',
            tenantId: 'tenant-1',
            pipelineId: 'pipeline-1',
            stageId: 'stage-1',
            title: 'Test Deal',
            contactDeals,
          };

          const result = toFrontendDeal(backendDeal);
          const expectedIds = contactDeals.map((cd) => cd.contact.id);

          if (expectedIds.length === 0) {
            expect(result.contactIds).toEqual([]);
          } else {
            expect(result.contactIds).toEqual(expectedIds);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('extracts contact IDs from ContactDeal foreign keys without expanded contacts', () => {
    const result = toFrontendDeal({ id: 'deal-1', title: 'Test Deal', contactDeals: [{ contactId: 'contact-1' }] });
    expect(result.contactIds).toEqual(['contact-1']);
  });
});

describe('Feature: deal-linkage-unified-crud, Property 7: FK-only filtering excludes non-linked deals', () => {
  /**
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4
   *
   * For any set of deals and a given record (lead, contact, or account),
   * the panel filter function SHALL include a deal if and only if it has a
   * direct FK linkage to that record — deals matched solely by companyName
   * string equality SHALL be excluded.
   */

  // Define the filter predicates matching RecordPanelWrappers.tsx
  const leadFilter = (deal: any, leadId: string) =>
    deal.leadId === leadId || (deal.leadIds ?? []).includes(leadId);

  const contactFilter = (deal: any, contactId: string) =>
    (deal.contactIds ?? []).includes(contactId) || deal.contactId === contactId;

  const accountFilter = (deal: any, accountId: string) =>
    deal.organizationId === accountId;

  it('leadFilter: includes deal iff leadId or leadIds contains target', () => {
    fc.assert(
      fc.property(
        fc.uuid(),  // target lead id
        fc.option(fc.uuid(), { nil: undefined }),  // deal.leadId
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),  // deal.leadIds
        fc.uuid(),  // deal.organizationId (should not affect lead filter)
        fc.string({ minLength: 1 }),  // companyName (should not affect filter)
        (targetLeadId, dealLeadId, dealLeadIds, orgId, companyName) => {
          const deal = { leadId: dealLeadId, leadIds: dealLeadIds, organizationId: orgId, companyName };

          const result = leadFilter(deal, targetLeadId);
          const expected = dealLeadId === targetLeadId || dealLeadIds.includes(targetLeadId);

          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('contactFilter: includes deal iff contactIds or contactId matches target', () => {
    fc.assert(
      fc.property(
        fc.uuid(),  // target contact id
        fc.option(fc.uuid(), { nil: undefined }),  // deal.contactId
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),  // deal.contactIds
        fc.string({ minLength: 1 }),  // companyName (should not affect filter)
        (targetContactId, dealContactId, dealContactIds, companyName) => {
          const deal = { contactId: dealContactId, contactIds: dealContactIds, companyName };

          const result = contactFilter(deal, targetContactId);
          const expected = dealContactIds.includes(targetContactId) || dealContactId === targetContactId;

          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accountFilter: includes deal iff organizationId matches target', () => {
    fc.assert(
      fc.property(
        fc.uuid(),  // target account id
        fc.option(fc.uuid(), { nil: undefined }),  // deal.organizationId
        fc.string({ minLength: 1 }),  // companyName (should NOT be used)
        (targetAccountId, dealOrgId, companyName) => {
          const deal = { organizationId: dealOrgId, companyName };

          const result = accountFilter(deal, targetAccountId);
          // Should ONLY match on organizationId, never on companyName
          const expected = dealOrgId === targetAccountId;

          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('companyName string match should never cause inclusion', () => {
    fc.assert(
      fc.property(
        fc.uuid(),  // target id
        fc.string({ minLength: 1 }),  // shared company name
        (targetId, sharedName) => {
          // Deal has matching companyName but NO FK linkage
          const deal = {
            leadId: 'other-lead',
            leadIds: [],
            contactId: 'other-contact',
            contactIds: [],
            organizationId: 'other-org',
            companyName: sharedName,
          };

          // None of these filters should match via companyName
          expect(leadFilter(deal, targetId)).toBe(false);
          expect(contactFilter(deal, targetId)).toBe(false);
          expect(accountFilter(deal, targetId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
