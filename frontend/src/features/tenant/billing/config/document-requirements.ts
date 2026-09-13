import type { BusinessDocumentRequirement, BusinessType, DocumentKey } from '../types/verification.types';

export const BUSINESS_TYPES: BusinessType[] = ['Sole Proprietorship', 'Corporation', 'Partnership', 'Cooperative', 'Other'];
export const REQUIRED_BASE_DOCUMENT_KEYS: DocumentKey[] = ['businessRegistration', 'birCertificate', 'businessPermit', 'proofOfAddress'];

const DOCUMENT_REQUIREMENTS: BusinessDocumentRequirement[] = [
  { key: 'businessRegistration', name: 'Business Registration Document', description: 'Sole Proprietorship: DTI Business Name Certificate. Corporation: SEC Certificate of Incorporation. Partnership: SEC Certificate of Recording. Cooperative: CDA Certificate of Registration. Other: appropriate government-issued registration document.', required: true, applicableBusinessTypes: 'all' },
  { key: 'birCertificate', name: 'BIR Certificate of Registration (Form 2303)', description: 'Bureau of Internal Revenue Certificate of Registration (BIR Form 2303), corresponding to your registered business information.', required: true, applicableBusinessTypes: 'all' },
  { key: 'businessPermit', name: "Business Permit / Mayor's Permit", description: "Current Business Permit or Mayor's Permit verifying your business is authorized to operate at its declared location.", required: true, applicableBusinessTypes: 'all' },
  { key: 'proofOfAddress', name: 'Proof of Business Address', description: 'A document showing your business name and/or address. Examples: utility bill, lease or rental agreement, or other official proof of business address.', required: true, applicableBusinessTypes: 'all' },
  { key: 'articlesOfIncorporation', name: 'Articles of Incorporation', description: 'Required for corporations. Submit the SEC-registered Articles of Incorporation.', required: true, applicableBusinessTypes: ['Corporation'] },
  { key: 'articlesOfPartnership', name: 'Articles of Partnership', description: 'Required for partnerships. Submit the SEC-registered Articles of Partnership.', required: true, applicableBusinessTypes: ['Partnership'] },
  { key: 'industryPermit', name: 'Industry or Business-Specific Permit', description: 'If your business operates in a regulated industry (healthcare, food, financial services, etc.), submit the applicable government-issued permit or license.', required: false, applicableBusinessTypes: 'all' },
];

export function getRequirementsForBusinessType(businessType: BusinessType): BusinessDocumentRequirement[] {
  return DOCUMENT_REQUIREMENTS.filter((req) => {
    if (req.applicableBusinessTypes === 'all') return true;
    return (req.applicableBusinessTypes as BusinessType[]).includes(businessType);
  }).map((req) => {
    if (req.key === 'articlesOfIncorporation') return { ...req, required: businessType === 'Corporation' };
    if (req.key === 'articlesOfPartnership') return { ...req, required: businessType === 'Partnership' };
    return req;
  });
}

export function getRequirement(key: DocumentKey): BusinessDocumentRequirement | undefined {
  return DOCUMENT_REQUIREMENTS.find((r) => r.key === key);
}

export { DOCUMENT_REQUIREMENTS };
