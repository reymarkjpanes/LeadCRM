import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression test for C2 — Lead -> Contact conversion field mapping.
 *
 * Guards against the bug where convertContact() wrote fields that do not exist on the
 * Contact model (companyName, productInterest) and an invalid ContactStatus ('Active'),
 * which caused the whole conversion $transaction to throw and roll back at runtime.
 *
 * Spec: .kiro/specs/lead-conversion-fix/
 *
 * Strategy: mock the Prisma client's $transaction to invoke the callback with a mock tx
 * client, capture the arguments passed to tx.contact.create, and assert the create data uses
 * ONLY valid Contact fields with the correct Lead -> Contact mapping.
 */

// ── Mocks ────────────────────────────────────────────────────────────────
const mockContactCreate = vi.fn();
const mockAccountCreate = vi.fn();
const mockLeadUpdate = vi.fn();
const mockActivityCreate = vi.fn();
const mockTransaction = vi.fn();

const CONTACT_STATUS_VALUES = ['HOT', 'WARM', 'COLD', 'CANCELLED', 'CLOSED'];
const CONTACT_LIFECYCLE_VALUES = ['LEAD', 'QUALIFIED', 'CONTACT', 'CUSTOMER', 'CHURNED', 'DISQUALIFIED'];

// Fields that exist on the Contact model (schema ground truth). Any create-data key outside
// this set would be an "Unknown argument" at runtime — the exact class of bug we are guarding.
const VALID_CONTACT_FIELDS = new Set([
  'tenantId', 'accountId', 'assignedUserId', 'ownerId',
  'firstName', 'lastName', 'email', 'phone', 'company', 'jobTitle', 'linkedinUrl',
  'status', 'score', 'source', 'notes', 'lastContactedAt', 'convertedAt', 'doNotContact',
  'isArchived', 'archiveReason', 'deletedAt', 'deletedBy',
  'activeProducts', 'address', 'customerSince', 'customerType', 'productInterests',
  'lifecycleStage', 'recordType', 'qualifiedAt', 'disqualifiedReason',
]);

const LEAD = {
  id: 'lead-1',
  tenantId: 'tenant-1',
  status: 'Inquiry',
  firstName: 'John',
  lastName: 'Smith',
  email: 'john@abc.com',
  phone: '+63 900 000 0000',
  companyName: 'ABC Corporation',
  address: 'Makati',
  source: 'Website',
  productInterest: ['CRM Enterprise', 'Workflow Automation'],
  assignedUserId: 'user-1',
};

vi.mock('../../../../config/database.config', () => ({
  default: {
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => mockTransaction(cb),
  },
  enforcePlanLimit: vi.fn(),
}));

vi.mock('../../../../core/audit/audit.service', () => ({ writeAuditLog: vi.fn() }));
vi.mock('../../automation/triggers/triggers.service', () => ({
  fireContactCreated: vi.fn(() => Promise.resolve()),
  fireContactStatusChanged: vi.fn(() => Promise.resolve()),
}));

// repo.findContactById is used to load the source lead
vi.mock('../contacts.repository', () => ({
  findContactById: vi.fn(() => Promise.resolve(LEAD)),
}));

import { convertContact } from '../contacts.service';

function buildTxClient() {
  return {
    account:  { findFirst: vi.fn(), create: mockAccountCreate },
    contact:  { findFirst: vi.fn(), create: mockContactCreate, update: vi.fn() },
    deal:     { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    leadDeal: { create: vi.fn() },
    contactDeal: { create: vi.fn() },
    pipeline: { findFirst: vi.fn() },
    lead:     { update: mockLeadUpdate },
    activity: { create: mockActivityCreate },
  };
}

describe('C2 regression — convertContact Lead->Contact field mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountCreate.mockResolvedValue({ id: 'acct-1', name: 'ABC Corporation' });
    mockContactCreate.mockResolvedValue({ id: 'contact-1', firstName: 'John', lastName: 'Smith' });
    mockLeadUpdate.mockResolvedValue({});
    mockActivityCreate.mockResolvedValue({});
    mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(buildTxClient()));
  });

  it('creates a Contact using only valid Contact fields with correct mapping', async () => {
    await convertContact('lead-1', 'tenant-1', 'user-1', {
      accountName: 'ABC Corporation',
      createContact: true,
      createDeal: false,
      dealPriority: 'MEDIUM',
    } as never);

    expect(mockContactCreate).toHaveBeenCalledTimes(1);
    const createArg = mockContactCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    const data = createArg.data;

    // No unknown fields (guards companyName/productInterest regression)
    for (const key of Object.keys(data)) {
      expect(VALID_CONTACT_FIELDS.has(key), `unexpected Contact field: ${key}`).toBe(true);
    }
    expect(data).not.toHaveProperty('companyName');
    expect(data).not.toHaveProperty('productInterest');

    // Correct mapping
    expect(data.company).toBe('ABC Corporation');
    expect(data.productInterests).toEqual(['CRM Enterprise', 'Workflow Automation']);
    expect(data.firstName).toBe('John');
    expect(data.accountId).toBe('acct-1');

    // Valid enums
    expect(CONTACT_STATUS_VALUES).toContain(data.status);
    expect(CONTACT_LIFECYCLE_VALUES).toContain(data.lifecycleStage);
    expect(data.lifecycleStage).toBe('CUSTOMER');
    expect(data.convertedAt).toBeInstanceOf(Date);
  });

  it('marks the lead as Converted with the resolved account and contact', async () => {
    await convertContact('lead-1', 'tenant-1', 'user-1', {
      accountName: 'ABC Corporation',
      createContact: true,
      createDeal: false,
      dealPriority: 'MEDIUM',
    } as never);

    expect(mockLeadUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockLeadUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArg.data.status).toBe('Converted');
    expect(updateArg.data.accountId).toBe('acct-1');
    expect(updateArg.data.contactId).toBe('contact-1');
  });
});
