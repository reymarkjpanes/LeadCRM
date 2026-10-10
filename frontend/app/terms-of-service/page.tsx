import LegalDocumentPage, { legalMetadata } from '@/features/tenant/legal/legal-document-page';
import { termsOfService } from '@/features/tenant/legal/legal-documents';

export const metadata = legalMetadata(termsOfService);
export default function Page() { return <LegalDocumentPage document={termsOfService} />; }
