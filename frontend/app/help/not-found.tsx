import Link from 'next/link';

export default function HelpNotFound() {
  return <div className="mx-auto max-w-xl py-12 text-[var(--text-primary)]"><h1 className="text-2xl font-semibold">Guide not found</h1><p className="my-4 text-[var(--text-secondary)]">This help article or category does not exist. Browse the Help Center to find the guide you need.</p><Link className="underline focus-visible:outline-2 focus-visible:outline-offset-4" href="/help">Back to Help Center</Link></div>;
}
