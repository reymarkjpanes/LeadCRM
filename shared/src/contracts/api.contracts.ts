/**
 * Standard API contracts — re-exports from types + adds error shape and list query.
 *
 * NOTE: ApiResponse and PaginatedResponse are defined in shared/src/types/api.types.ts
 * and re-exported from there. This file adds the error envelope and list query params.
 */

// Re-export the canonical response types so api.contracts is the single import point
export type { ApiResponse, PaginatedResponse, PaginationMeta } from '../types/api.types';

// Error response envelope (used by backend error middleware)
export interface ApiError {
  success: false;
  error: {
    code:      string;    // e.g. CONTACT_NOT_FOUND | PERMISSION_DENIED
    message:   string;
    retryAt?:  string;    // ISO timestamp; do not retry before this time
    field?:    string;    // for validation errors
    requestId: string;
    timestamp: string;
  };
}

// Common query params for list endpoints
export interface ListQueryParams {
  page?:     number;
  pageSize?: number;
  search?:   string;
  sortBy?:   string;
  sortDir?:  'asc' | 'desc';
  cursor?:   string;
}
