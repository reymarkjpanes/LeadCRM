'use client';

/**
 * useAccounts — route-scoped, server-paginated hook for the Accounts page.
 *
 * Replaces the prior implementation that fetched accountsService.getAll()
 * independently while DataContext also fetched organizationsService.getAll()
 * for the same endpoint — causing a double-fetch on every authenticated load.
 *
 * Now uses the shared useModuleData hook (server-side pagination, AbortController,
 * stale-while-revalidate) and exposes the same public API shape as before so
 * accounts-page.tsx requires minimal changes.
 *
 * DataContext organizations array is NOT used here — those are for cross-module
 * consumers (sidebar, panels, omnibox, deals-page). This hook owns the list fetch.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useModuleData } from '@/shared/hooks/use-module-data';
import { toFrontendOrg } from '@/lib/api/adapters/organization.adapter';
import { accountsService } from '../services/accounts.service';
import { USE_MOCK_DATA } from '@/lib/config';
import { useAuth } from '@/store/AuthContext';
import { uuid } from '@/lib/utils';
import type { Account, AccountFilters } from '../types/account.types';
import type { AccountFormValues } from '../schemas/account.schema';
import type { SortPreference } from '@/shared/services/table-preferences.api';

// ── Types ─────────────────────────────────────────────────────────────────────

import type { FilterCondition } from '@leadcrm/shared';

export interface UseAccountsParams {
  page?: number;
  pageSize?: number;
  sort?: SortPreference | null;
  search?: string;
  filter?: FilterCondition[];
}

const EMPTY_FILTERS: AccountFilters = {
  search: '',
  industries: [],
  sizes: [],
};

const REFRESH_INTERVAL_MS = 60_000;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAccounts(params?: UseAccountsParams) {
  const { tenant } = useAuth();

  // ── Server fetch (real-API mode) ─────────────────────────────────────────
  const { data, meta, isLoading: isFetching, error, refetch } = useModuleData({
    moduleId: 'accounts',
    page: params?.page ?? 1,
    pageSize: params?.pageSize ?? 100,
    sort: params?.sort ?? null,
    search: params?.search,
    filter: params?.filter,
  });

  // ── Stale-while-revalidate ───────────────────────────────────────────────
  const [displayAccounts, setDisplayAccounts] = useState<Account[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    if (!isFetching && error === null && !USE_MOCK_DATA) {
      const mapped = data.map((raw) => toFrontendOrg(raw)) as Account[];
      setDisplayAccounts(mapped.filter((a) => !a.isArchived));
      setHasLoadedOnce(true);
    }
  }, [data, isFetching, error]);

  // ── Mock mode (localStorage) — preserves existing dev workflow ──────────
  useEffect(() => {
    if (!USE_MOCK_DATA || !tenant) return;
    const raw = localStorage.getItem('leadcrm_accounts');
    const all: Account[] = raw ? JSON.parse(raw) : [];
    setDisplayAccounts(all.filter((c) => c.tenantId === tenant.id && !c.isArchived));
    setHasLoadedOnce(true);
  }, [tenant]);

  const isInitialLoad = isFetching && !hasLoadedOnce && !USE_MOCK_DATA;
  const isLoading = isInitialLoad; // alias used by accounts-page

  // ── Background refresh ───────────────────────────────────────────────────
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (USE_MOCK_DATA) return;
    const interval = setInterval(() => { refetchRef.current(); }, REFRESH_INTERVAL_MS);
    const handleFocus = (): void => { refetchRef.current(); };
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // ── Client-side filter state (drives filter rail UI in accounts-page) ──
  const [filters, setFilters] = useState<AccountFilters>(EMPTY_FILTERS);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);

  // ── Mutations ────────────────────────────────────────────────────────────
  const loadAccounts = useCallback(async () => {
    if (USE_MOCK_DATA) return; // mock state is set by the useEffect above
    refetch();
  }, [refetch]);

  const handleCreate = useCallback(async (formData: AccountFormValues) => {
    if (!tenant) return;
    try {
      if (USE_MOCK_DATA) {
        const raw = localStorage.getItem('leadcrm_accounts');
        const all: Account[] = raw ? JSON.parse(raw) : [];
        const newAccount: Account = {
          ...formData,
          id: uuid(),
          tenantId: tenant.id,
          createdAt: new Date().toISOString(),
        };
        localStorage.setItem('leadcrm_accounts', JSON.stringify([...all, newAccount]));
        setDisplayAccounts((prev) => [...prev, newAccount]);
      } else {
        await accountsService.create({ ...formData, tenantId: tenant.id });
        refetch();
      }
      setIsFormOpen(false);
    } catch (err) {
      console.error('[useAccounts] Failed to create account:', err);
    }
  }, [tenant, refetch]);

  const handleUpdate = useCallback(async (id: string, formData: AccountFormValues) => {
    try {
      if (USE_MOCK_DATA) {
        const raw = localStorage.getItem('leadcrm_accounts');
        const all: Account[] = raw ? JSON.parse(raw) : [];
        localStorage.setItem('leadcrm_accounts', JSON.stringify(
          all.map((c) => c.id === id ? { ...c, ...formData } : c),
        ));
        setDisplayAccounts((prev) => prev.map((c) => c.id === id ? { ...c, ...formData } : c));
      } else {
        await accountsService.update(id, formData as unknown as Record<string, unknown>);
        refetch();
      }
      setIsFormOpen(false);
      setEditTarget(null);
    } catch (err) {
      console.error('[useAccounts] Failed to update account:', err);
    }
  }, [refetch]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      if (USE_MOCK_DATA) {
        const raw = localStorage.getItem('leadcrm_accounts');
        const all: Account[] = raw ? JSON.parse(raw) : [];
        localStorage.setItem('leadcrm_accounts', JSON.stringify(
          all.map((c) => c.id === id ? { ...c, isArchived: true } : c),
        ));
        setDisplayAccounts((prev) => prev.filter((c) => c.id !== id));
      } else {
        await accountsService.archive(id);
        refetch();
      }
    } catch (err) {
      console.error('[useAccounts] Failed to delete account:', err);
    }
  }, [refetch]);

  const handleOpenCreate = useCallback(() => { setEditTarget(null); setIsFormOpen(true); }, []);
  const handleOpenEdit   = useCallback((account: Account) => { setEditTarget(account); setIsFormOpen(true); }, []);
  const handleCloseForm  = useCallback(() => { setIsFormOpen(false); setEditTarget(null); }, []);

  // ── Expose same public API shape as before ────────────────────────────────
  return {
    /** Current page of accounts (server-paginated in real mode, full list in mock). */
    accounts: displayAccounts,
    /** Total record count from server metadata. */
    totalCount: meta?.total ?? displayAccounts.length,
    meta,
    filters,
    setFilters,
    isLoading,
    /** True during background refresh (existing data remains visible). */
    isRefreshing: isFetching && hasLoadedOnce && !USE_MOCK_DATA,
    error,
    refetch: loadAccounts,
    isFormOpen,
    editTarget,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleOpenCreate,
    handleOpenEdit,
    handleCloseForm,
  };
}
