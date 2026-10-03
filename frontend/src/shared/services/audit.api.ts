'use client';

import { apiClient } from '@/lib/api/client';

export interface AuditLogEntry {
  id: string; tenantId: string; userId: string;
  action: string; entityType: string; entityId?: string;
  changeset?: { before: Record<string, unknown>; after: Record<string, unknown> };
  metadata?: Record<string, unknown>;
  ipAddress?: string; userAgent?: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  createdAt: string;
  user?: { id: string; firstName: string; lastName: string; email: string };
}

export interface AuditLogsResponse {
  success: boolean;
  data: AuditLogEntry[];
  meta: { total: number; page: number; limit: number; hasMore: boolean };
}

export interface AuditLogQuery {
  entityType?: string; entityId?: string; userId?: string;
  action?: string; severity?: string;
  from?: string; to?: string;
  page?: number; limit?: number;
}

function buildQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  return q.toString() ? `?${q.toString()}` : '';
}

export const auditApi = {
  list: (query: AuditLogQuery = {}) =>
    apiClient.get<AuditLogsResponse>(`/administration/audit${buildQuery(query as Record<string, unknown>)}`),
};
