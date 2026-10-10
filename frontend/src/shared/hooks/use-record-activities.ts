'use client';

import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { USE_MOCK_DATA } from '@/lib/config';
import { apiClient } from '@/lib/api/client';
import { activitiesService, type ActivityRecord } from '@/features/tenant/crm/activities/services/activities.service';
import { useCachedPage } from './use-cached-page';
import { useHasPermission } from './use-permissions';

export type ActivityModule = 'leads' | 'contacts' | 'accounts' | 'deals';
export type TimelineActivity = Pick<ActivityRecord, 'id' | 'type' | 'title' | 'createdAt' | 'description' | 'metadata'> & { createdBy?: ActivityRecord['createdBy'] };
export const activityReadKey = { leads: 'leadId', accounts: 'accountId', deals: 'dealId' } as const;

/** One contextual reader, using the existing tenant/user cache. */
export function useRecordActivities(module: ActivityModule, id: string | undefined, enabled = true, providedActivities?: TimelineActivity[]) {
  const { activities, users } = useData();
  const { user } = useAuth();
  const canViewActivities = useHasPermission(`${module}.view`);
  const result = useCachedPage<TimelineActivity[]>({
    module: 'activities',
    params: { recordModule: module, id },
    disabled: USE_MOCK_DATA || !enabled || !id || !canViewActivities || providedActivities !== undefined,
    fetchFn: async signal => {
      // The relationships endpoint scopes recent history to this contact.
      if (module === 'contacts') {
        const response = await apiClient.get<{ data: { activities: TimelineActivity[] } }>(`/crm/contacts/${encodeURIComponent(id!)}/relationships?limit=50`, { signal });
        return response.data.activities;
      }
      const response = await activitiesService.getAll({ [activityReadKey[module]]: id, limit: 100 }, signal);
      return response.data;
    },
  });
  const relatedType = module === 'accounts' ? 'company' : module === 'deals' ? 'deal' : 'contact';
  const mockActivities: TimelineActivity[] = activities
    .filter(activity => activity.tenantId === user?.tenantId && activity.relatedToId === id && activity.relatedToType === relatedType)
    .map(activity => {
      const actor = users.find(person => person.id === activity.createdBy);
      return { ...activity, createdBy: actor ? { id: actor.id, firstName: actor.firstName, lastName: actor.lastName, email: actor.email } : undefined };
    })
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  return { ...result, activities: !enabled || !canViewActivities ? [] : USE_MOCK_DATA ? mockActivities : providedActivities ?? result.data ?? [] };
}
