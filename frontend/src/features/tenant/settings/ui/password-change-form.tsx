'use client';
import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { PasswordStrengthMeter } from '@/shared/components/password-strength-meter';
import { StrongPasswordSchema } from '@leadcrm/shared';
import { authApi } from '@/shared/services/auth.api';
import { useAuth } from '@/store/AuthContext';
import { toast } from 'sonner';
import { Button } from '@/shared/components/ui/button';

export function PasswordChangeForm({ onSuccess, onCancel, onBusy }: { onSuccess?: () => void; onCancel?: () => void; onBusy?: (busy: boolean) => void }) {
  const { user, applyAuthUser } = useAuth();
  const [values, setValues] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values | 'form', string>>>({});
  const [shown, setShown] = useState({ password: false, confirm: false });
  const [busy, setBusy] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const passwordValid = StrongPasswordSchema.safeParse(values.password).success;
  // Mandatory setup lets the server identify reuse of a weak temporary credential first.
  const canSubmit = (passwordValid || user?.mustChangePassword && values.password.length > 0) && values.confirm === values.password && !busy;
  const confirmError = values.confirm && values.confirm !== values.password
    ? 'Passwords do not match.'
    : confirmTouched && !values.confirm ? 'Confirm your new password.' : errors.confirm;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !user) return;
    const next: typeof errors = {};
    const parsed = StrongPasswordSchema.safeParse(values.password);
    if (!parsed.success && !user.mustChangePassword) next.password = parsed.error.issues[0].message;
    if (!values.confirm) next.confirm = 'Confirm your new password.';
    else if (values.confirm !== values.password) next.confirm = 'Passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    onBusy?.(true);
    try {
      const response = await authApi.changePassword({ password: values.password });
      applyAuthUser(response.data.user, user.id);
      setValues({ password: '', confirm: '' });
      setConfirmTouched(false);
      toast.success('Password updated successfully.');
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to change password.';
      const server = error as { code?: string; fieldErrors?: { password?: string[] } };
      const fieldMessage = server.fieldErrors?.password?.[0];
      setErrors({ [server.code === 'PASSWORD_REUSE' || fieldMessage || message.startsWith('Choose a password') ? 'password' : 'form']: fieldMessage ?? message });
    } finally { setBusy(false); onBusy?.(false); }
  }
  return <form onSubmit={submit} noValidate className="space-y-4">
    {([['password', 'New password'], ['confirm', 'Confirm new password']] as const).map(([key, label]) => {
      const error = key === 'confirm' ? confirmError : errors.password;
      return <div key={key}>
      <label className="block text-xs font-semibold mb-1.5" htmlFor={`security-${key}`}>{label} <span className="text-red-500">*</span></label>
      <div className="relative"><input id={`security-${key}`} type={shown[key] ? 'text' : 'password'} autoComplete="new-password"
        value={values[key]} maxLength={72} disabled={busy} required aria-invalid={!!error} aria-describedby={error ? `${key}-error` : key === 'password' ? 'password-requirements' : undefined}
        onBlur={() => { if (key === 'confirm') setConfirmTouched(true); }}
        onChange={event => { setValues(previous => ({ ...previous, [key]: event.target.value })); setErrors({}); }} className="w-full min-w-0 rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2.5 pr-12 text-sm bg-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <button type="button" aria-label={`${shown[key] ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => setShown(previous => ({ ...previous, [key]: !previous[key] }))} className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-slate-500">{shown[key] ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      </div>
      {error && <p id={`${key}-error`} role="alert" className="text-xs text-red-600 mt-1">{error}</p>}
      {key === 'password' && <div id="password-requirements"><PasswordStrengthMeter password={values.password} hideWhenEmpty={false} /></div>}
    </div>; })}
    {errors.form && <p role="alert" className="text-sm text-red-600">{errors.form}</p>}
    <div className="flex flex-wrap justify-end gap-2 pt-2">{onCancel && <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>}<Button type="submit" disabled={!canSubmit}>{busy ? 'Saving…' : 'Change password'}</Button></div>
  </form>;
}
