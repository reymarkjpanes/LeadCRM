import LegalDocumentPage, { legalMetadata } from '@/features/tenant/legal/legal-document-page';
import { privacyPolicy } from '@/features/tenant/legal/legal-documents';

export const metadata = legalMetadata(privacyPolicy);
export default function Page() { return <LegalDocumentPage document={privacyPolicy} />; }
