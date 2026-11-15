'use client';
import { useEffect, useRef, useState } from 'react';
import { LeadPhoneSchema, PhoneAvailabilitySchema, PHONE_AVAILABILITY_MESSAGES, PH_MOBILE_ERROR, type PhoneAvailability, type PhoneAvailabilityReason } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/store/AuthContext';
import { useDebounce } from './use-debounce';

/** Mirrors email availability while allowing optional empty numbers in create and edit forms. */
export function usePhoneAvailability(phone: string, module: 'leads' | 'contacts', enabled = true, excludeId?: string) {
  const { user, tenant } = useAuth();
  const parsed = LeadPhoneSchema.safeParse(phone);
  const normalized = parsed.success ? parsed.data : '';
  const identity = JSON.stringify([tenant?.id ?? user?.tenantId, user?.id, user?.role, module, enabled, excludeId, phone]);
  const draft = useRef({ identity, revision: 0 });
  if (draft.current.identity !== identity) draft.current = { identity, revision: draft.current.revision + 1 };
  const revision = draft.current.revision;
  const key = JSON.stringify([identity, revision]);
  const debouncedKey = useDebounce(key, 600);
  const [check, setCheck] = useState<{ key: string; result?: PhoneAvailability; failed?: boolean }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !parsed.success || !normalized || key !== debouncedKey) return;
    const controller = new AbortController();
    let active = true;
    setCheck({ key });
    apiClient.get<{ success: boolean; data: PhoneAvailability }>('/crm/phone-availability', {
      params: { module, phone: normalized, ...(excludeId ? { excludeId } : {}) }, signal: controller.signal,
    }).then(response => {
      if (!response.success) throw new Error('Unable to verify phone.');
      const result = PhoneAvailabilitySchema.parse(response.data);
      if (active) setCheck({ key, result });
    }).catch(() => { if (active) setCheck({ key, failed: true }); });
    return () => { active = false; controller.abort(); };
  }, [key, debouncedKey, normalized, module, enabled, excludeId, parsed.success, attempt]);
  const current = check?.key === key ? check : undefined;
  const available = enabled && parsed.success && (!normalized || current?.result?.available === true);
  const error = !enabled ? undefined : !parsed.success && phone ? PH_MOBILE_ERROR
    : current?.failed ? 'Unable to verify this phone number. Please try again.'
    : current?.result?.available === false ? PHONE_AVAILABILITY_MESSAGES[current.result.reason] : undefined;
  return {
    available, error, blocked: enabled && !available,
    confirm: (value: string) => available && draft.current.identity === identity && draft.current.revision === revision
      && LeadPhoneSchema.safeParse(value).success && LeadPhoneSchema.parse(value) === normalized,
    retry: () => { if (current?.failed) setAttempt(value => value + 1); },
    reject: (reason: PhoneAvailabilityReason = 'STAFF_PHONE_NOT_ALLOWED') => {
      if (draft.current.identity !== identity || draft.current.revision !== revision) return false;
      setCheck({ key, result: { available: false, reason } }); return true;
    },
  };
}
