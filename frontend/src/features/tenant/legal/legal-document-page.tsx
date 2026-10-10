import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { LEGAL_ORGANIZATION as organization, LEGAL_REVIEW_PENDING, type LegalDocument } from './legal-documents';
import { PublicDocumentLayout, publicLinkClass } from './public-document-layout';

/** Supplied static text becomes escaped React nodes, never raw HTML. */
function inlineText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|https:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
    if (part.startsWith('https://')) return <a key={index} href={part} className={publicLinkClass}>{part}</a>;
    if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(part)) return <a key={index} href={`mailto:${part}`} className={publicLinkClass}>{part}</a>;
    return part;
  });
}

export function legalMetadata(document: LegalDocument): Metadata {
  return {
    title: `${document.title} | LeadCRM — Camxian Technologies`,
    description: document.description,
    alternates: { canonical: `${organization.website}${document.path}` },
    ...(LEGAL_REVIEW_PENDING ? { robots: { index: false, follow: true } } : {}),
  };
}

export default function LegalDocumentPage({ document }: { document: LegalDocument }) {
  return (
    <PublicDocumentLayout>
      <article className="[overflow-wrap:anywhere]">
        <header className="mb-10 border-b border-slate-200 pb-8">
          <p className="mb-3 text-sm font-semibold text-blue-700">Camxian Technologies</p>
          <h1 className="text-3xl font-bold leading-tight text-slate-950 sm:text-4xl">{document.title}</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">{organization.application}</p>
          <dl className="mt-6 space-y-2 text-sm leading-6 text-slate-600">
            <div><dt className="inline font-semibold text-slate-800">Effective Date: </dt><dd className="inline">{document.effectiveDate}</dd></div>
            {document.updatedDate && <div><dt className="inline font-semibold text-slate-800">Last Updated: </dt><dd className="inline">{document.updatedDate}</dd></div>}
            <div><dt className="inline font-semibold text-slate-800">Developed by: </dt><dd className="inline">{organization.developer}</dd></div>
            <div><dt className="inline font-semibold text-slate-800">Website: </dt><dd className="inline"><a href={organization.website} className={publicLinkClass}>{organization.website}</a></dd></div>
            <div><dt className="inline font-semibold text-slate-800">Support and Privacy Requests: </dt><dd className="inline"><a href={`mailto:${organization.supportEmail}`} className={publicLinkClass}>{organization.supportEmail}</a></dd></div>
            <div><dt className="inline font-semibold text-slate-800">Business Address: </dt><dd className="inline">{organization.address}</dd></div>
          </dl>
          {LEGAL_REVIEW_PENDING && <aside aria-label="Document review status" className="mt-6 border-l-2 border-blue-600 bg-blue-50 px-4 py-3 text-sm leading-6 text-slate-700"><strong className="font-semibold">Organizational review draft.</strong> Operational disclosures are awaiting Camxian Technologies&apos; final review. This is not the final approved policy.</aside>}
        </header>
        <nav aria-label="Document contents" className="mb-10 border-b border-slate-200 pb-8">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Contents</h2>
          <ol className="list-decimal space-y-2 pl-6 text-sm leading-6">{document.sections.map(section => <li key={section.number}><a href={`#section-${section.number}`} className={publicLinkClass}>{section.title}</a></li>)}</ol>
        </nav>
        {document.sections.map(section => (
          <section key={section.number} aria-labelledby={`section-${section.number}`} className="mb-10">
            <h2 id={`section-${section.number}`} className="mb-4 scroll-mt-6 text-xl font-semibold leading-8 text-slate-950 sm:text-2xl">{section.number}. {section.title}</h2>
            <div className="space-y-4 text-[15px] leading-7 text-slate-700 sm:text-base">
              {section.blocks.map((block, index) => {
                if (block.type === 'heading') return <h3 key={index} className="pt-3 text-lg font-semibold text-slate-900">{block.text}</h3>;
                if (block.type === 'list') {
                  const List = block.ordered ? 'ol' : 'ul';
                  return <List key={index} className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-2 pl-6`}>{block.items?.map((item, itemIndex) => <li key={itemIndex}>{inlineText(item)}</li>)}</List>;
                }
                return <p key={index} className="whitespace-pre-line">{inlineText(block.text ?? '')}</p>;
              })}
            </div>
          </section>
        ))}
      </article>
    </PublicDocumentLayout>
  );
}
