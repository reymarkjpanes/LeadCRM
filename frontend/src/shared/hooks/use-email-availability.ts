'use client';

import { useEffect, useRef, useState } from 'react';
import { CrmEmailSchema, StaffEmailSchema, StaffCreationEmailSchema, EmployeeEmailSchema, EmailAvailabilitySchema, EMAIL_AVAILABILITY_MESSAGES, type EmailAvailability, type EmailAvailabilityReason } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/store/AuthContext';
import { useDebounce } from './use-debounce';

type Check = { key: string; result?: EmailAvailability; failed?: boolean };

/** Availability is always bound to the current draft and its authenticated or published-form scope. */
export function useEmailAvailability(email: string, purpose: 'leads' | 'contacts' | 'users' | 'staff-creation', enabled = true, publicForm?: { publicId: string; version: number }) {
  const { user, tenant } = useAuth();
  const staff = purpose === 'users' || purpose === 'staff-creation';
  const parsed = (purpose === 'staff-creation' ? StaffCreationEmailSchema : staff ? StaffEmailSchema : CrmEmailSchema).safeParse(email);
  const externalError = staff && parsed.success && user?.role !== 'Client Admin' && !EmployeeEmailSchema.safeParse(email).success
    ? EMAIL_AVAILABILITY_MESSAGES.EXTERNAL_STAFF_EMAIL_NOT_ALLOWED : undefined;
  const valid = parsed.success && !externalError;
  const normalized = parsed.success ? parsed.data : '';
  const publicId = publicForm?.publicId, version = publicForm?.version;
  const identity = JSON.stringify([publicId ? [publicId, version] : [tenant?.id ?? user?.tenantId, user?.id, user?.role], purpose, enabled, email]);
  const draft = useRef({ identity, revision: 0 });
  if (draft.current.identity !== identity) draft.current = { identity, revision: draft.current.revision + 1 };
  const revision = draft.current.revision;
  const key = JSON.stringify([identity, revision]);
  const isCurrentDraft = () => draft.current.identity === identity && draft.current.revision === revision;
  const debouncedKey = useDebounce(key, 600);
  const [check, setCheck] = useState<Check>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !valid || key !== debouncedKey) return;
    const controller = new AbortController();
    let active = true;
    setCheck({ key });
    const path = publicId ? '/public/forms/' + encodeURIComponent(publicId) + '/email-availability'
      : staff ? '/administration/users/email-availability' : '/crm/email-availability';
    apiClient.get<{ success: boolean; data: EmailAvailability }>(path, {
      params: { email: normalized, ...(purpose === 'staff-creation' ? { purpose } : publicId || staff ? {} : { module: purpose }) },
      signal: controller.signal,
    }).then(response => {
      if (!response.success) throw new Error('Email availability could not be verified.');
      const result = EmailAvailabilitySchema.parse(response.data);
      if (active) setCheck({ key, result });
    }).catch(() => { if (active) setCheck({ key, failed: true }); });
    return () => { active = false; controller.abort(); };
  }, [key, debouncedKey, normalized, purpose, publicId, enabled, valid, attempt, staff]);

  const current = check?.key === key ? check : undefined;
  const available = enabled && valid && current?.result?.available === true;
  const error = !enabled ? undefined : !parsed.success && email ? parsed.error.issues[0]?.message
    : externalError ?? (current?.failed ? 'Unable to verify this email. Please try again.'
      : current?.result && !current.result.available ? EMAIL_AVAILABILITY_MESSAGES[current.result.reason] : undefined);

  return {
    available,
    confirm: (value: string) => available && isCurrentDraft() && value === normalized,
    email: normalized,
    error,
    blocked: enabled && !available,
    retry: () => { if (current?.failed) setAttempt(value => value + 1); },
    reject: (reason: EmailAvailabilityReason) => { if (isCurrentDraft()) setCheck({ key, result: { available: false, reason } }); },
  };
}
