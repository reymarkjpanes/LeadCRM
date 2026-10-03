import { LEAD_STATUSES } from '@leadcrm/shared';
import type { ImportModuleConfig } from '../types/import.types';

/**
 * Import configuration for the Leads module.
 *
 * Required fields: firstName, lastName, email, phone, companyName, address
 * Optional fields: website, source, description, status
 */
export const leadImportConfig: ImportModuleConfig = {
  moduleKey: 'leads',
  moduleLabel: 'Leads',
  moduleSingular: 'Lead',
  backRoute: '/crm/leads',
  importApiPath: '/crm/leads/imports',
  detailsRoute: (importId: string) => `/crm/leads/imports/${importId}`,
  templateFileName: 'lead-import-template.csv',
  permission: 'leads.import',
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
    {
      key: 'website',
      label: 'Website',
      required: false,
      type: 'url',
      autoMapPatterns: ['website', 'web', 'url', 'site', 'homepage', 'web_site'],
    },
    {
      key: 'source',
      label: 'Lead Source',
      required: false,
      type: 'text',
      autoMapPatterns: ['source', 'lead source', 'lead_source', 'referral source', 'channel'],
    },
    {
      key: 'description',
      label: 'Description',
      required: false,
      type: 'text',
      autoMapPatterns: ['description', 'notes', 'note', 'comments', 'comment', 'remarks'],
    },
    {
      key: 'status',
      label: 'Status',
      required: false,
      type: 'select',
      options: Array.from(LEAD_STATUSES),
      autoMapPatterns: ['status', 'lead status', 'lead_status', 'stage'],
    },
  ],
};
