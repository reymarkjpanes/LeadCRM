// Shared hooks — barrel export
export { useTheme } from './use-theme';
export { usePermissions, useHasPermission, useCanAny } from './use-permissions';
export { usePagination } from './use-pagination';
export { useColumnPreferences } from './use-column-preferences';
export { useResponsiveColumns, computeVisibleColumns } from './use-responsive-columns';
export { useViewTypePreference } from './use-view-type-preference';
export { useBulkSelection } from './use-bulk-selection';
export type { UseBulkSelectionReturn, UseBulkSelectionOptions } from './use-bulk-selection';
export { useModuleData } from './use-module-data';
export { useModuleCounts, clearModuleCountsCache } from './use-module-counts';
export { useRouteData } from './use-route-data';
export { useFilterUrlSync } from './use-filter-url-sync';
export { useScrollToError } from './use-scroll-to-error';
