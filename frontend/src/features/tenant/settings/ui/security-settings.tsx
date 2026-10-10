'use client';
import { useState } from 'react';
import { useAuth } from '@/store/AuthContext';
import { Dialog, DialogContent, DialogTitle } from '@/shared/components/ui/dialog';
import { PasswordChangeForm } from './password-change-form';
import { ShieldCheck } from 'lucide-react';

export function SecuritySettings() {
  const { user } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);
  return <section className="rounded-2xl border bg-card p-5 space-y-4">
    <div><h3 className="font-semibold">Security</h3><p className="text-xs text-slate-500">Manage your password</p></div>
    <div className="rounded-xl bg-muted p-3 flex items-center justify-between gap-3">
      <div><p className="text-sm font-semibold">Password</p>{user?.passwordChangedAt && <p className="text-xs text-slate-500">Last changed: {new Date(user.passwordChangedAt).toLocaleDateString()}</p>}</div>
      <button className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" onClick={() => setPasswordOpen(true)}>Change Password</button>
    </div>
    {passwordOpen && <PasswordDialog key={user?.id} onClose={() => setPasswordOpen(false)} />}
  </section>;
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent aria-labelledby="security-dialog-title" aria-describedby="password-dialog-description" className="max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
    <div className="mb-5 border-b border-gray-200 dark:border-slate-700 pb-5">
      <div className="mb-4 inline-flex rounded-lg bg-blue-50 dark:bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400"><ShieldCheck size={20} aria-hidden="true" /></div>
      <DialogTitle id="security-dialog-title">Change password</DialogTitle>
      <p id="password-dialog-description" className="mt-2 text-xs text-slate-500 dark:text-slate-400">Keep your account secure with a strong password.</p>
    </div>
    <PasswordChangeForm onBusy={setBusy} onSuccess={onClose} onCancel={onClose} />
  </DialogContent></Dialog>;
}
