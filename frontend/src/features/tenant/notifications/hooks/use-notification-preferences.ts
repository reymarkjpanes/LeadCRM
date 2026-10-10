'use client';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import { notificationsApi } from '@/shared/services/notifications.api';
import { toast } from 'sonner';

export function useNotificationPreferences() {
  const { user, tenant } = useAuth();
  const scope = (tenant?.id ?? user?.tenantId ?? '') + ':' + (user?.id ?? '');
  const current = useRef(scope); current.current = scope;
  const [state, setState] = useState({ scope, data: { ...DEFAULT_NOTIFICATION_PREFERENCES }, saved: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    loading: true, ready: false, saving: false, error: '' });
  const [retry, setRetry] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    setState({ scope, data: { ...DEFAULT_NOTIFICATION_PREFERENCES }, saved: { ...DEFAULT_NOTIFICATION_PREFERENCES }, loading: true, ready: false, saving: false, error: '' });
    if (!user?.id) return;
    notificationsApi.preferences().then(response => {
      if (active && current.current === scope) setState({ scope, data: response.data, saved: response.data, loading: false, ready: true, saving: false, error: '' });
    }).catch(() => { if (active) setState(prev => ({ ...prev, loading: false, error: 'Unable to load notification preferences.' })); });
    return () => { active = false; };
  }, [scope, user?.id, retry]);
  const value = state.scope === scope ? state : { ...state, data: DEFAULT_NOTIFICATION_PREFERENCES, loading: true, ready: false };
  const dirty = value.data.inAppGeneral !== value.saved.inAppGeneral;
  const save = async () => {
    if (saving.current || !value.ready || value.loading || !dirty) return;
    saving.current = true; setState(prev => ({ ...prev, saving: true, error: '' }));
    try {
      const response = await notificationsApi.savePreferences(value.data);
      if (current.current !== scope) return;
      setState(prev => ({ ...prev, data: response.data, saved: response.data }));
      toast.success('Notification preferences saved.');
    } catch {
      if (current.current === scope) {
        setState(prev => ({ ...prev, error: 'Preferences could not be saved. Please try again.' }));
        toast.error('Failed to save notification preferences.');
      }
    } finally {
      saving.current = false;
      if (current.current === scope) setState(prev => ({ ...prev, saving: false }));
    }
  };
  return { ...value, dirty, save, retry: () => setRetry(value => value + 1),
    setInApp: (inAppGeneral: boolean) => { if (value.ready && !value.saving) setState(prev => ({ ...prev, data: { ...prev.data, inAppGeneral } as NotificationPreferences })); } };
}
