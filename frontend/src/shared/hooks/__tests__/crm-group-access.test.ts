// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EMPTY_PERMISSION_FLAGS, hasCrmRecordAssignmentAccess, canReassignCrmRecord, type CrmRecordAccessPolicy } from '@leadcrm/shared';

const flags = { ...EMPTY_PERMISSION_FLAGS, canView: true, canViewAll: true, canEdit: true };
const policy: CrmRecordAccessPolicy = { userId: 'staff', tenantId: 'tenant', clientAdmin: false,
  assignmentRestricted: true, permissions: { contacts: flags, accounts: flags } };
const record = (assignedUserId: string | null = 'staff') => ({ tenantId: 'tenant', assignedUserId, status: 'Inquiry' });

describe('customer access uses employee roles and Assigned Agent', () => {
  it('allows an assigned employee with the required role permission', () => {
    expect(hasCrmRecordAssignmentAccess(policy, record(), 'contacts')).toBe(true);
  });
  it.each(['another', null])('denies restricted edits for assignment %s', assigned => {
    expect(hasCrmRecordAssignmentAccess(policy, record(assigned), 'contacts')).toBe(false);
  });
  it('ignores obsolete customer ownership and group-only grants', () => {
    const legacy = { ...policy, permissions: {}, groupGrants: [{ groupId: 'one', permissions: { contacts: flags }, assignmentRestricted: false }] };
    expect(hasCrmRecordAssignmentAccess(legacy, { ...record(), ownerGroupId: 'one' } as ReturnType<typeof record>, 'contacts')).toBe(false);
    expect(hasCrmRecordAssignmentAccess(policy, { ...record(), ownerGroupId: 'one' } as ReturnType<typeof record>, 'contacts')).toBe(true);
  });
  it('allows unrestricted role access without any employee group', () => {
    expect(hasCrmRecordAssignmentAccess({ ...policy, assignmentRestricted: false }, record('another'), 'contacts')).toBe(true);
    expect(canReassignCrmRecord({ ...policy, assignmentRestricted: false }, record('another'), 'contacts')).toBe(true);
    expect(canReassignCrmRecord(policy, record(), 'contacts')).toBe(false);
  });
  it('preserves own-record scopes and distinct action grants', () => {
    const scoped = { ...policy, assignmentRestricted: false, permissions: { contacts: { ...flags, canViewAll: false, canViewMy: true } } };
    expect(hasCrmRecordAssignmentAccess(scoped, record(), 'contacts')).toBe(true);
    expect(hasCrmRecordAssignmentAccess(scoped, record('another'), 'contacts')).toBe(false);
    expect(hasCrmRecordAssignmentAccess(policy, record(), 'contacts', 'canArchive')).toBe(false);
    expect(hasCrmRecordAssignmentAccess({ ...policy, permissions: {} }, record(), 'contacts')).toBe(false);
  });
  it('keeps Accounts role-based without an Assigned Agent requirement', () => {
    expect(hasCrmRecordAssignmentAccess(policy, record(null), 'accounts')).toBe(true);
  });
  it('keeps Client Admin inside the current tenant', () => {
    const admin = { ...policy, clientAdmin: true };
    expect(hasCrmRecordAssignmentAccess(admin, record(null), 'contacts')).toBe(true);
    expect(hasCrmRecordAssignmentAccess(admin, { ...record(), tenantId: 'other' }, 'contacts')).toBe(false);
  });
});

describe('current server scope controls CRM ownership and Group Head supervision', () => {
  const scoped: CrmRecordAccessPolicy = {
    ...policy,
    crmTeamUserIds: ['staff'],
    crmGroupHead: false,
    permissions: { leads: flags, contacts: flags, deals: flags, accounts: flags },
  };
  const head: CrmRecordAccessPolicy = {
    ...scoped,
    assignmentRestricted: false,
    crmGroupHead: true,
    crmTeamUserIds: ['staff', 'associate-a', 'associate-c'],
  };

  it.each(['leads', 'contacts', 'deals'])('keeps an Associate within their own %s despite the All tab grant', module => {
    expect(hasCrmRecordAssignmentAccess(scoped, record(), module)).toBe(true);
    expect(hasCrmRecordAssignmentAccess(scoped, record('associate-a'), module)).toBe(false);
    expect(hasCrmRecordAssignmentAccess(scoped, record(null), module)).toBe(false);
    expect(canReassignCrmRecord(scoped, record(), module)).toBe(false);
  });

  it.each(['leads', 'contacts', 'deals'])('allows a Head to supervise only the resolved members of their %s scope', module => {
    expect(hasCrmRecordAssignmentAccess(head, record('associate-a'), module)).toBe(true);
    expect(hasCrmRecordAssignmentAccess(head, record('associate-c'), module)).toBe(true);
    expect(hasCrmRecordAssignmentAccess(head, record('associate-b'), module)).toBe(false);
    expect(canReassignCrmRecord(head, record('associate-a'), module)).toBe(true);
    expect(canReassignCrmRecord(head, record('associate-b'), module)).toBe(false);
    expect(hasCrmRecordAssignmentAccess(head, { ...record('associate-a'), tenantId: 'other' }, module)).toBe(false);
  });

  it('requires action grants and the selected view scope even for a Group Head', () => {
    expect(hasCrmRecordAssignmentAccess({ ...head, permissions: { deals: { ...flags, canEdit: false } } }, record('associate-a'), 'deals')).toBe(false);
    expect(canReassignCrmRecord({ ...head, permissions: { deals: { ...flags, canEdit: false } } }, record('associate-a'), 'deals')).toBe(false);
    const ownOnly = { ...head, permissions: { deals: { ...flags, canViewAll: false, canViewMy: true } } };
    expect(hasCrmRecordAssignmentAccess(ownOnly, record('associate-a'), 'deals')).toBe(false);
    expect(hasCrmRecordAssignmentAccess(ownOnly, record(), 'deals')).toBe(true);
  });

  it('uses current supervision after a Head is removed or transferred', () => {
    const transferred = { ...head, crmTeamUserIds: ['staff', 'associate-b'] };
    expect(hasCrmRecordAssignmentAccess(transferred, record('associate-a'), 'deals')).toBe(false);
    expect(hasCrmRecordAssignmentAccess(transferred, record('associate-b'), 'deals')).toBe(true);
    expect(hasCrmRecordAssignmentAccess(scoped, record('associate-a'), 'deals')).toBe(false);
  });

  it('preserves Account grants and Client Admin tenant authority', () => {
    expect(hasCrmRecordAssignmentAccess(head, record(null), 'accounts')).toBe(true);
    expect(hasCrmRecordAssignmentAccess({ ...scoped, clientAdmin: true, crmTeamUserIds: undefined }, record('associate-b'), 'deals')).toBe(true);
    expect(hasCrmRecordAssignmentAccess({ ...scoped, clientAdmin: true, crmTeamUserIds: undefined }, { ...record(), tenantId: 'other' }, 'deals')).toBe(false);
  });

  it('retains Client Admin authority when the administrator is also a designated Group Head', () => {
    const adminHead = { ...head, clientAdmin: true };
    expect(hasCrmRecordAssignmentAccess(adminHead, record('associate-b'), 'deals')).toBe(true);
    expect(canReassignCrmRecord(adminHead, record('associate-b'), 'deals')).toBe(true);
    expect(hasCrmRecordAssignmentAccess(adminHead, { ...record('associate-a'), tenantId: 'other' }, 'deals')).toBe(false);
  });
});
