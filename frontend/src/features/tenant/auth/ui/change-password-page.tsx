"use client";
import { OnboardingShell } from '../../onboarding/ui/onboarding-shell';
import { PasswordChangeForm } from '../../settings/ui/password-change-form';
import { ShieldCheck } from 'lucide-react';
export default function ChangePasswordPage() {
  return <OnboardingShell step={0} icon={ShieldCheck} title="Make your account your own"
    description="Choose a strong password to secure your LeadCRM account before you enter the workspace.">
    <h1 className="mb-3 text-2xl font-bold sm:text-3xl">Change your temporary password</h1>
    <p className="mb-8 text-slate-500">Create your permanent password to continue. You will then take a short tour of LeadCRM.</p>
    <PasswordChangeForm />
  </OnboardingShell>;
}
