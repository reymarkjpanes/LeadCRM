'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { ConfirmProfileEmailChangeSchema, RequestProfileEmailChangeSchema } from '@leadcrm/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Input, textFieldClassName } from '@/shared/components/ui/input';
import { useEmailAvailability } from '@/shared/hooks/use-email-availability';
import { authApi } from '@/shared/services/auth.api';
import { useAuth } from '@/store/AuthContext';

export function ProfileEmailChange({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth();
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [codeFocused, setCodeFocused] = useState(false);
  const [activeDigit, setActiveDigit] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const emailCheck = useEmailAvailability(email, 'users', !sent);
  useEffect(() => { if (sent && !busy) codeInput.current?.focus(); }, [sent, busy]);

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
        if (!emailCheck.confirm(result.data.email)) return;
        await authApi.requestProfileEmailChange(result.data);
        setEmail(result.data.email);
        setCurrentPassword('');
        setShowPassword(false);
        setSent(true);
      }
    } catch (reason) {
      if (!sent && (reason as { code?: string })?.code === 'EMAIL_IN_USE') emailCheck.reject('EMAIL_IN_USE');
      else setError(reason instanceof Error ? reason.message : 'Unable to change your email address.');
    }
    finally { pending.current = false; setBusy(false); }
  };

  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}>
    <DialogContent id="profile-email-change-dialog" className="max-w-xl space-y-6 p-6 sm:p-8" closeClassName="right-5 top-5 sm:right-6 sm:top-6">
      <DialogHeader className="space-y-2 pr-8">
        <DialogTitle className="text-xl leading-tight">{sent ? 'Verify your new email' : 'Change email address'}</DialogTitle>
        <DialogDescription className="break-words leading-relaxed">{sent ? `Enter the 6-digit code sent to ${email}.`
          : 'Confirm your password to send a verification code to your new address.'}</DialogDescription>
      </DialogHeader>
      <form noValidate onSubmit={submit} className="space-y-5">
        {sent ? <div className="block text-sm font-medium">
          <label htmlFor="profile-email-code">Verification code</label>
          <div className={`relative mt-2 w-full max-w-sm ${busy ? 'opacity-50' : ''}`}>
            <Input ref={codeInput} id="profile-email-code" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
              autoComplete="one-time-code" placeholder="Enter verification code" value={code} disabled={busy}
              aria-invalid={!!error} aria-describedby={error ? 'profile-email-code-error' : undefined}
              className="absolute inset-0 h-full w-full opacity-0"
              onFocus={() => setCodeFocused(true)} onBlur={() => setCodeFocused(false)}
              onSelect={event => setActiveDigit(Math.min(event.currentTarget.selectionStart ?? 0, 5))}
              onChange={event => {
                const value = event.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                setCode(value); setError(''); setActiveDigit(Math.min(event.target.selectionStart ?? value.length, value.length, 5));
              }}
              onPaste={event => {
                const value = event.clipboardData.getData('text').trim();
                if (/^[0-9]{6}$/.test(value)) {
                  event.preventDefault(); event.currentTarget.value = value; event.currentTarget.setSelectionRange(6, 6);
                  setCode(value); setError(''); setActiveDigit(5);
                }
              }} />
            <div aria-hidden="true" className="pointer-events-none grid grid-cols-6 gap-2 sm:gap-3">
              {Array.from({ length: 6 }, (_, index) => <span key={index}
                className={`${textFieldClassName} h-12 items-center justify-center px-0 font-mono text-xl tabular-nums sm:h-14 ${code[index] ? 'text-foreground' : 'text-muted-foreground'} ${error ? 'border-red-500 dark:border-red-500' : ''} ${codeFocused && activeDigit === index ? 'border-primary ring-2 ring-primary/20' : ''}`}>
                {code[index] || '–'}
              </span>)}
            </div>
          </div>
        </div> : <div className="space-y-6 pb-1 pt-2">
          <div className="block text-sm font-medium">
            <label htmlFor="profile-new-email">New email address</label>
            <div className="relative mt-2">
              <Input id="profile-new-email" type="email" autoComplete="email" placeholder="Enter new email address"
                value={email} onChange={event => { setEmail(event.target.value); setError(''); }} onBlur={emailCheck.retry}
                aria-invalid={!!emailCheck.error} aria-describedby={emailCheck.error ? 'profile-new-email-error' : undefined}
                className="h-11 pr-10" disabled={busy} />
              {emailCheck.available && !emailCheck.error && <Check size={16} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-green-600 dark:text-green-400" />}
            </div>
            {emailCheck.error && <p id="profile-new-email-error" role="alert" className="text-xs text-red-500">{emailCheck.error}</p>}
          </div>
          <div className="block text-sm font-medium">
            <label htmlFor="profile-current-password">Current password</label>
            <div className="relative mt-2">
              <Input id="profile-current-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                placeholder="Enter current password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} className="h-11 pr-11" disabled={busy} />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} disabled={busy}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-0 top-1/2 inline-flex h-full w-11 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
        </div>}
        {error && <p id={sent ? 'profile-email-code-error' : undefined} role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 sm:gap-3">
          {sent && <button type="button" disabled={busy} onClick={() => { setSent(false); setCode(''); setError(''); }}
            className="min-h-11 rounded-lg border px-3 py-2 text-sm">Request a new code</button>}
          <button type="submit" disabled={busy || emailCheck.blocked} className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? 'Please wait…' : sent ? 'Verify' : 'Send verification code'}
          </button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
