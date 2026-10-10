import privacySections from './content/privacy-policy.json';
import termsSections from './content/terms-of-service.json';

export const LEGAL_ORGANIZATION = {
  name: 'Camxian Technologies',
  application: 'LeadCRM — Internal Customer Relationship Management System',
  developer: 'LeadCRM Development Team (Student Capstone Project)',
  attribution: 'LeadCRM is developed by the LeadCRM Development Team as a student capstone project for Camxian Technologies.',
  website: 'https://lead-crm.tech',
  supportEmail: 'leadcrm.tech@gmail.com',
  address: '180 Dr. Sixto Ave. Bgy Caniogan, Pasig City, Metro Manila',
} as const;

export interface LegalBlock {
  type: string;
  text?: string;
  ordered?: boolean;
  items?: string[];
}
export interface LegalDocument {
  title: string;
  path: string;
  effectiveDate: string;
  updatedDate?: string;
  description: string;
  sections: { number: number; title: string; blocks: LegalBlock[] }[];
}

// Remove draft status only after completing docs/legal-auth-email-integration.md.
export const LEGAL_REVIEW_PENDING = true;
export const privacyPolicy: LegalDocument = {
  title: 'Privacy Policy', path: '/privacy-policy',
  effectiveDate: 'September 23, 2026', updatedDate: 'October 9, 2026',
  description: 'How Camxian Technologies collects, uses, protects, and handles personal information through LeadCRM.',
  sections: privacySections,
};
export const termsOfService: LegalDocument = {
  title: 'Terms of Service', path: '/terms-of-service',
  effectiveDate: 'October 9, 2026',
  description: 'Terms governing authorized use of the LeadCRM internal customer relationship management system operated by Camxian Technologies.',
  sections: termsSections,
};
