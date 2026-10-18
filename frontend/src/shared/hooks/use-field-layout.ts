'use client';
import { defaultFieldLayout, type ColumnDefinition, type CrmFieldCatalogEntry, type CustomFieldModule, type FieldLayout } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { USE_MOCK_DATA } from '@/lib/config';
import { useCachedPage } from './use-cached-page';
export function useFieldLayout(module: CustomFieldModule, disabled = false) {
  const query = useCachedPage<{ layout: FieldLayout; fields: CrmFieldCatalogEntry[] }>({ module, params: { fieldLayout: true }, disabled: USE_MOCK_DATA || disabled, revalidateOnInvalidation: true, fetchFn: async signal => (await apiClient.get<{ data: { layout: FieldLayout; fields: CrmFieldCatalogEntry[] } }>(`/crm/${module}/field-layout`, { signal })).data });
  return { ...query, layout: query.data?.layout ?? defaultFieldLayout(module) };
}
export function useConfiguredCrmColumns<T extends { id: string; header: string }>(module: CustomFieldModule, columns: T[]): T[] {
  const { layout } = useFieldLayout(module);
  return columns.map(column => ({ ...column, header: configuredLabel(module, column.id, column.header, layout) }));
}
function configuredLabel(module: string, id: string, fallback: string, layout: FieldLayout): string {
  const aliases: Record<string, string> = { productInterests: 'productInterestIds', productInterest: 'productInterestIds', activeProducts: 'activeProductIds', organizationId: 'accountId', assignedUser: 'assignedUserId' };
  const label = layout.fields[aliases[id] ?? id]?.label ?? fallback;
  return module === 'accounts' && id === 'address' && label === 'Street Address' ? 'Full Address' : label;
}
/** Grid and selector resolve the same native labels; display-only metadata remains stable. */
export function useConfiguredColumnDefinitions(module: string, columns: ColumnDefinition[]): ColumnDefinition[] {
  const supported = ['leads', 'contacts', 'accounts', 'deals'].includes(module);
  const { layout } = useFieldLayout(supported ? module as CustomFieldModule : 'leads', !supported);
  return supported ? columns.map(column => ({ ...column, label: configuredLabel(module, column.id, column.label, layout) })) : columns;
}
