'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiClient } from '@/lib/api/client';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { USE_MOCK_DATA } from '@/lib/config';
import { useRecordActivities, type TimelineActivity } from './use-record-activities';


// ─── Types ───────────────────────────────────────────────────────────────────

export type RecordModule = 'leads' | 'contacts' | 'accounts' | 'deals';

interface RelationshipData {
  contact?: { id: string; firstName: string; lastName: string; email?: string; phone?: string; status?: string } | null;
  sourceLead?: { id: string; firstName: string; lastName: string; email?: string; status?: string; source?: string } | null;
  account?: { id: string; name: string; industry?: string; website?: string } | null;
  deals?: Array<{ id: string; title: string; value?: number; priority?: string; stage?: { id: string; name: string } }>;
  leads?: Array<{ id: string; firstName: string; lastName: string; email?: string; status?: string; source?: string }>;
  contacts?: Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string; status?: string }>;
  activities?: Array<{ id: string; type: string; title: string; createdAt: string }>;
  tasks?: Array<{ id: string; title: string; status: string; priority?: string; dueDate?: string }>;
}

export interface UseRecordDetailReturn {
  /** The full record from API (or DataContext fallback) */
  record: Record<string, unknown> | null;
  /** Related entities from the /relationships endpoint */
  relationships: RelationshipData | null;
  /** Activity timeline entries for this record */
  activities: TimelineActivity[];
  /** Whether initial fetch is in progress */
  isLoading: boolean;
  /** Whether a refetch is in progress */
  isRefetching: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Whether the record was not found (404) */
  isNotFound: boolean;
  /** Manually trigger a refetch of all data */
  refetch: () => void;
}

interface UseRecordDetailParams {
  /** CRM module type */
  module: RecordModule;
  /** Record ID to fetch — pass undefined to skip fetching */
  id: string | undefined;
}

// ─── Activity filter key mapping ─────────────────────────────────────────────


// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Fetches a single CRM record by ID along with its relationships and activities.
 *
 * Data flow:
 * 1. Immediately returns DataContext fallback (if record is in memory)
 * 2. Reads record/relationships in parallel; the shared reader supplies contextual activities
 * 3. Merges API response as authoritative data
 * 4. Stays reactive to DataContext updates (edits in panels/list sync here)
 *
 * Performance:
 * - P1: Independent API calls fired in parallel via Promise.allSettled
 * - Abort on unmount or ID change (prevents stale responses)
 * - DataContext fallback gives instant rendering (no flash)
 */
export function useRecordDetail({ module, id }: UseRecordDetailParams): UseRecordDetailReturn {
  const [apiRecord, setApiRecord] = useState<Record<string, unknown> | null>(null);
  const [relationships, setRelationships] = useState<RelationshipData | null>(null);
  const { user } = useAuth();
  const identity = [user?.id, user?.tenantId, module, id].join(':');
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  const sameIdentity = identity === loadedIdentity;
  const timeline = useRecordActivities(module, id, true, module === 'contacts' ? (sameIdentity ? relationships?.activities : []) ?? [] : undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefetching, setIsRefetching] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState<boolean>(false);

  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── DataContext fallback for instant rendering ──────────────────────────
  // NOTE: After the route-scoped migration, DataContext.contacts is no longer
  // populated at startup. For leads/contacts, this fallback returns null and the
  // hook immediately falls through to its own API fetch (fetchData below).
  // The slight first-render latency is acceptable — no blank screen occurs because
  // the hook renders a RecordDetailSkeleton while isLoading=true.
  const { contacts, organizations, deals } = useData();

  const dataContextRecord = useMemo((): Record<string, unknown> | null => {
    if (!id) return null;

    switch (module) {
      case 'leads':
        return (contacts.find((c) => c.id === id) as unknown as Record<string, unknown>) ?? null;
      case 'contacts':
        // Contacts use DataContext contacts array too (frontend treats them similarly)
        return (contacts.find((c) => c.id === id) as unknown as Record<string, unknown>) ?? null;
      case 'accounts':
        return (organizations.find((o) => o.id === id) as unknown as Record<string, unknown>) ?? null;
      case 'deals':
        return (deals.find((d) => d.id === id) as unknown as Record<string, unknown>) ?? null;
      default:
        return null;
    }
  }, [module, id, contacts, organizations, deals]);

  // ── Fetch logic ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async (isRefetch = false): Promise<void> => {
    if (!id || USE_MOCK_DATA) {
      setIsLoading(false);
      return;
    }

    // Abort previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (isRefetch) {
      setIsRefetching(true);
    } else {
      setIsLoading(true);
    }
    setLoadedIdentity(identity);
    setApiRecord(null);
    setRelationships(null);
    setError(null);
    setIsNotFound(false);

    const requestController = abortControllerRef.current;
    try {
      // P1 waterfall elimination: fire record and relationship calls in parallel


      const [recordResult, relationshipsResult] = await Promise.allSettled([
        apiClient.get<{ success: boolean; data: Record<string, unknown> }>(`/crm/${module}/${encodeURIComponent(id)}`, { signal: abortControllerRef.current!.signal }),
        apiClient.get<{ success: boolean; data: RelationshipData }>(`/crm/${module}/${encodeURIComponent(id)}/relationships?limit=50`, { signal: abortControllerRef.current!.signal }),
      ]);

      if (!mountedRef.current || requestController?.signal.aborted) return;

      // Process record
      if (recordResult.status === 'fulfilled') {
        const recordData = recordResult.value;
        setApiRecord((recordData as { data: Record<string, unknown> }).data ?? recordData as unknown as Record<string, unknown>);
      } else {
        const err = recordResult.reason;
        if (err instanceof Error && err.message.includes('not found')) {
          setIsNotFound(true);
          setError('Record not found');
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load record');
        }
      }

      // Process relationships (non-blocking — record can still show without relationships)
      if (relationshipsResult.status === 'fulfilled') {
        const relData = relationshipsResult.value;
        setRelationships((relData as { data: RelationshipData }).data ?? relData as unknown as RelationshipData);
      }

    } catch (err: unknown) {
      if (!mountedRef.current || requestController?.signal.aborted) return;
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load record');
    } finally {
      if (mountedRef.current && !requestController?.signal.aborted) {
        setIsLoading(false);
        setIsRefetching(false);
      }
    }
  }, [id, module, identity]);

  // ── Mount/unmount lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // ── Fetch on mount and when id/module changes ───────────────────────────
  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  // ── Public refetch function ─────────────────────────────────────────────
  const refetch = useCallback((): void => {
    void fetchData(true);
    void timeline.refetch();
  }, [fetchData, timeline.refetch]);

  // ── Merge: API record is authoritative, DataContext is fallback ─────────
  // If API has responded, use that. Otherwise fall back to DataContext for instant render.
  const record = (sameIdentity ? apiRecord : null) ?? dataContextRecord;

  return {
    record,
    relationships: sameIdentity ? relationships : null,
    activities: timeline.activities,
    isLoading: isLoading && !dataContextRecord, // Don't show loading if we have a DataContext fallback
    isRefetching,
    error,
    isNotFound,
    refetch,
  };
}
