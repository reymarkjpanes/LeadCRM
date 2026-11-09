'use client';

import { useRef, useState } from 'react';
import { ConfirmProfileEmailChangeSchema, RequestProfileEmailChangeSchema } from '@leadcrm/shared';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { authApi } from '@/shared/services/auth.api';
import { useAuth } from '@/store/AuthContext';

export function ProfileEmailChange({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth();
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (sent) {
        const result = ConfirmProfileEmailChangeSchema.safeParse({ code });
        if (!result.success) throw new Error(result.error.issues[0].message);
        await authApi.confirmProfileEmailChange(result.data);
        try { await logout(); }
        finally { window.location.replace('/login'); }
      } else {
        const result = RequestProfileEmailChangeSchema.safeParse({ email, currentPassword });
        if (!result.success) throw new Error(result.error.issues[0].message);
        await authApi.requestProfileEmailChange(result.data);
        setEmail(result.data.email);
        setCurrentPassword('');
        setSent(true);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to change your email address.'); }
    finally { pending.current = false; setBusy(false); }
  };

  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}>
    <DialogContent>
      <DialogTitle>{sent ? 'Verify your new email' : 'Change email address'}</DialogTitle>
      <DialogDescription>{sent ? `Enter the code sent to ${email}. You’ll sign in again after confirming.`
        : 'Confirm your password to send a verification code to your new address.'}</DialogDescription>
      <form noValidate onSubmit={submit} className="space-y-4">
        {sent ? <label className="block text-sm font-medium">Verification code
          <Input autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} disabled={busy} />
        </label> : <>
          <label className="block text-sm font-medium">New email address
            <Input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
          </label>
          <label className="block text-sm font-medium">Current password
            <Input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} disabled={busy} />
          </label>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          {sent && <button type="button" disabled={busy} onClick={() => { setSent(false); setCode(''); setError(''); }}
            className="rounded-lg border px-3 py-2 text-sm">Request a new code</button>}
          <button type="submit" disabled={busy} className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? 'Please wait…' : sent ? 'Verify and change email' : 'Send verification code'}
          </button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
