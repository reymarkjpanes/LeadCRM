import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[var(--app-viewport-height)] flex items-center justify-center bg-slate-50 dark:bg-[#121418] px-4 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-6xl font-black text-slate-900 dark:text-white">404</h1>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">Page Not Found</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="pt-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
