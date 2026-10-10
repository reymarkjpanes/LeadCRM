import { LEGAL_ORGANIZATION as organization } from './legal-documents';
import { PublicDocumentLayout, publicLinkClass } from './public-document-layout';

export default function PublicSupportPage() {
  return (
    <PublicDocumentLayout>
      <h1 className="text-3xl font-bold leading-tight text-slate-950 sm:text-4xl">LeadCRM Support</h1>
      <p className="mt-5 max-w-2xl text-base leading-8 text-slate-700">For help with your LeadCRM account, password recovery, or privacy requests, contact Camxian Technologies.</p>
      <p className="mt-6 text-base leading-8"><a href={`mailto:${organization.supportEmail}`} className={publicLinkClass}>{organization.supportEmail}</a></p>
      <section className="mt-10 border-t border-slate-200 pt-8" aria-labelledby="help-guides">
        <h2 id="help-guides" className="text-xl font-semibold text-slate-950">Browse help guides</h2>
        <p className="mt-4 max-w-2xl text-base leading-8 text-slate-700">Browse the LeadCRM Help Center without signing in. Authorized users see their usual workspace navigation while reading the same guides.</p>
        <p className="mt-5"><a href="/help" className={publicLinkClass}>Open Help Center</a></p>
      </section>
      <p className="mt-10 text-sm leading-7 text-slate-600">Do not send passwords, reset links, or customer records in a support email.</p>
    </PublicDocumentLayout>
  );
}
