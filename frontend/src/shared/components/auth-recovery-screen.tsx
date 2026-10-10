'use client';
import { ThemeScope } from '@/shared/components/theme-scope';

import { useState } from 'react';
import { useAuth } from '@/store/AuthContext';

export function AuthRecoveryScreen({ message, workspace = false }: { message: string; workspace?: boolean }) {
  const { retryAuthInit, logout } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <ThemeScope enabled={workspace} role="main" className="flex min-h-[var(--app-viewport-height)] items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-5 text-center">
        <h1 className="text-xl font-semibold">Unable to continue to your workspace</h1>
        <p role="alert" className="text-sm text-slate-500">{error || message}</p>
        <div className="flex justify-center gap-4">
          <button disabled={busy} onClick={() => void run(retryAuthInit)}
            className="rounded-lg bg-primary px-5 py-2 text-white disabled:opacity-50">
            Try again
          </button>
          <button disabled={busy} onClick={() => void run(logout)}
            className="rounded-lg border px-5 py-2 disabled:opacity-50">
            Sign out
          </button>
        </div>
      </div>
    </ThemeScope>
  );
}
