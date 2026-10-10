import type { ImportModuleConfig } from '../types/import.types';

/**
 * Import configuration for the Contacts module.
 *
 * Required fields: firstName, lastName, email, phone, companyName, address
 * (same as contacts import-contacts-page.tsx existing fields)
 */
export const contactImportConfig: ImportModuleConfig = {
  moduleKey: 'contacts',
  moduleLabel: 'Contacts',
  moduleSingular: 'Contact',
  backRoute: '/crm/contacts',
  importApiPath: '/crm/contacts/imports',
  detailsRoute: (importId: string) => `/crm/contacts/imports/${importId}`,
  templateFileName: 'contact-import-template.csv',
  permission: 'contacts.import',
  duplicateCheckField: 'email',

  requiredFields: [
    {
      key: 'firstName',
      label: 'First Name',
      required: true,
      type: 'text',
      autoMapPatterns: ['first name', 'firstname', 'first_name', 'given name', 'given_name'],
    },
    {
      key: 'lastName',
      label: 'Last Name',
      required: true,
      type: 'text',
      autoMapPatterns: ['last name', 'lastname', 'last_name', 'surname', 'family name', 'family_name'],
    },
    {
      key: 'email',
      label: 'Email',
      required: true,
      type: 'email',
      autoMapPatterns: ['email', 'email address', 'email_address', 'e-mail', 'emailaddress'],
    },
    {
      key: 'phone',
      label: 'Phone Number',
      required: true,
      type: 'phone',
      autoMapPatterns: [
        'phone number', 'phone', 'mobile', 'mobile number', 'phone_number',
        'telephone', 'tel', 'mobile_number', 'contact number', 'contact_number',
      ],
    },
    {
      key: 'companyName',
      label: 'Company Name',
      required: true,
      type: 'text',
      autoMapPatterns: ['company name', 'company', 'company_name', 'organization', 'org', 'organisation'],
    },
    {
      key: 'address',
      label: 'Full Address',
      required: true,
      type: 'text',
      autoMapPatterns: ['full address', 'address', 'full_address', 'street address', 'location', 'street_address'],
    },
  ],

  optionalFields: [
    { key: 'productInterest', label: 'Product Interest', required: false, type: 'text', autoMapPatterns: ['product interest', 'product interests', 'product_interest', 'products', 'product'] },],
};
