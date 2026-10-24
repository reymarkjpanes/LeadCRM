import { expect, it } from 'vitest';
import { toBackendCreateContact, toBackendUpdateContact, toFrontendContact } from './contact.adapter';
import { toBackendCreateDeal, toBackendUpdateDeal, toFrontendDeal } from './deal.adapter';
import { toBackendCreateOrg, toBackendUpdateOrg, toFrontendOrg } from './organization.adapter';
import { toContactWrite } from '@/shared/services/contacts-v2.api';

it.each([toBackendCreateContact, toBackendUpdateContact, toBackendCreateDeal, toBackendUpdateDeal, toBackendCreateOrg, toBackendUpdateOrg, toContactWrite])('omits historical Group metadata from customer writes (%#)', map => {
  expect(map({ ownerGroupId: 'historical-group', status: 'Inquiry' })).not.toHaveProperty('ownerGroupId');
});
it.each([toFrontendContact, toFrontendDeal, toFrontendOrg])('retains historical access metadata on reads (%#)', map => {
  expect(map({ id: 'customer', ownerGroupId: 'historical-group' }).ownerGroupId).toBe('historical-group');
});
