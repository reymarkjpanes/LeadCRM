import HelpHome from '@/features/tenant/help/ui/help-home';

export const metadata = { title: 'Help Center | LeadCRM' };
// Render the query-aware home on the server instead of a client-only search fallback.
export const dynamic = 'force-dynamic';
export default function Page() {
  return <HelpHome />;
}
