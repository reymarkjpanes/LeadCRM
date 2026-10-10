import type { ReactNode } from 'react';
import { LEGAL_ORGANIZATION as organization } from './legal-documents';

export const publicLinkClass = 'rounded-sm text-blue-700 underline underline-offset-4 hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 [overflow-wrap:anywhere]';

export function PublicDocumentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[var(--app-viewport-height)] bg-white text-slate-800">
      <a href="#document" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4 focus:text-blue-700">Skip to content</a>
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <a href="/login" className="flex items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600" aria-label="LeadCRM sign in">
            <img src="/leadcrm_logo.png" alt="" width={54} height={54} className="h-[54px] w-[54px]" />
            <div><span className="text-2xl font-bold tracking-tight text-slate-950">Lead<span className="text-blue-600">CRM</span></span><p className="mt-0.5 text-xs text-slate-600">Camxian Technologies</p></div>
          </a>
          <a href="/login" className={`${publicLinkClass} text-sm`}>Sign in</a>
        </div>
      </header>
      <main id="document" className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">{children}</main>
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-4xl px-5 py-8 text-sm leading-7 text-slate-600 sm:px-8">
          <nav aria-label="Legal and support" className="mb-5 flex flex-wrap gap-x-5 gap-y-2">
            <a href="/privacy-policy" className={publicLinkClass}>Privacy Policy</a>
            <a href="/terms-of-service" className={publicLinkClass}>Terms of Service</a>
            <a href="/help" className={publicLinkClass}>Help Center</a>
          </nav>
          <p>{organization.name} · LeadCRM</p>
          <p>{organization.attribution}</p>
          <p>Support: <a href={`mailto:${organization.supportEmail}`} className={publicLinkClass}>{organization.supportEmail}</a></p>
          <p className="mt-2">{organization.address}</p>
        </div>
      </footer>
    </div>
  );
}
