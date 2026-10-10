import { expect, it } from 'vitest';
import { toFrontendOrg } from '../organization.adapter';

it('retains populated Account details and its embedded owner for tables without a loaded lookup page', () => {
  const fields = { id: 'account', name: 'Northstar', email: 'team@example.test', phone: '+639171234567', notes: 'Customer notes', internalNotes: 'Team notes', productInterests: ['CCTV'], activeProducts: ['Biometrics'], updatedAt: '2026-10-04T03:00:00Z', assignedUser: { id: 'owner', firstName: 'Alex', lastName: 'Morgan' } };
  expect(toFrontendOrg(fields)).toMatchObject(fields);
});
