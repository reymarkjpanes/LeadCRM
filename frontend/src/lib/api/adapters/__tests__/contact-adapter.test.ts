import { expect, it } from 'vitest';
import { toFrontendContact } from '../contact.adapter';

it('retains populated Lead table fields, audit users, and every product from the response', () => {
  const user = { id: 'owner', firstName: 'Alex', lastName: 'Morgan' };
  const input = {
    id: 'lead', firstName: 'Jordan', lastName: 'Lee', companyName: '',
    account: { id: 'account', name: 'Northstar' }, description: 'Installation request',
    website: 'https://example.test', createdBy: user, updatedBy: user,
    lastStatusChangedAt: '2026-10-04T03:00:00Z', productInterest: ['CCTV', 'Biometrics'],
  };
  expect(toFrontendContact(input)).toMatchObject({
    companyName: 'Northstar', description: input.description, website: input.website,
    createdByUser: user, updatedByUser: user,
    latestStatusChangeDate: input.lastStatusChangedAt, productInterests: ['CCTV', 'Biometrics'],
  });
});
