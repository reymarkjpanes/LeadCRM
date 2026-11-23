'use client';

/**
 * useAccounts — route-scoped, server-paginated hook for the Accounts page.
 *
 * Integrates with the shared page cache so return navigation shows data
 * instantly without a skeleton, followed by a silent background refresh.
 *
 * Cache key: tenantId + module('accounts') + { page, pageSize, sort, search, filter }
 * Mutations call invalidatePageCache('accounts', tenantId) to evict stale entries.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from '@/shared/utils/toast';
import { useModuleData } from '@/shared/hooks/use-module-data';
import { toFrontendOrg } from '@/lib/api/adapters/organization.adapter';
import { accountsService } from '../services/accounts.service';
import { USE_MOCK_DATA } from '@/lib/config';
import { useAuth } from '@/store/AuthContext';
import { uuid } from '@/lib/utils';
import { mockAccountsKey, mockOrganizationsKey, readMockAccountRows, readMockAccounts, requireMockAccountReview } from '@/shared/utils/mock-account-storage';
import type { Account, AccountFilters, AccountMutationInput } from '../types/account.types';
import type { SortPreference } from '@/shared/services/table-preferences.api';
import type { FilterCondition } from '@leadcrm/shared';

export interface UseAccountsParams {
  page?: number;
  pageSize?: number;
  sort?: SortPreference | null;
  search?: string;
  recordId?: string;
  disabled?: boolean;
  filter?: FilterCondition[];
}

const EMPTY_FILTERS: AccountFilters = {
  search: '',
  industries: [],
  sizes: [],
};


// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAccounts(params?: UseAccountsParams) {
  const { tenant, user, userCan } = useAuth();

  const { data, meta, facets, isInitialLoad, isRefreshing, isManualRefreshing, error, refetch } = useModuleData({
    moduleId: 'accounts',
    disabled: params?.disabled,
    page: params?.page ?? 1,
    pageSize: params?.pageSize ?? 100,
    sort: params?.sort ?? null,
    search: params?.search,
    recordId: params?.recordId,
    filter: params?.filter,
  });
  const serverAccounts = useMemo(
    () => (data.map(toFrontendOrg) as Account[]).filter((account) => !account.isArchived),
    [data],
  );
  const [mockAccounts, setDisplayAccounts] = useState<Account[]>([]);
  const displayAccounts = USE_MOCK_DATA ? mockAccounts : serverAccounts;

  // ── Mock mode (localStorage) ─────────────────────────────────────────────
  useEffect(() => {
    if (!USE_MOCK_DATA || !tenant) return;
    const all = readMockAccounts<Account>();
    setDisplayAccounts(all.filter((c) => c.tenantId === tenant.id && !c.isArchived));
  }, [tenant]);

  const isLoading = isInitialLoad;

  // ── Client-side filter state (drives filter rail UI in accounts-page) ──
  const [filters, setFilters] = useState<AccountFilters>(EMPTY_FILTERS);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);

  // ── Mutations ────────────────────────────────────────────────────────────
  const loadAccounts = useCallback(async () => {
    if (USE_MOCK_DATA) return; // mock state is set by the useEffect above
    await refetch();
  }, [refetch]);

  const handleCreate = useCallback(async (formData: AccountMutationInput) => {
    if (!tenant) throw new Error('Your workspace is unavailable. Refresh and try again.');
    try {
      if (USE_MOCK_DATA) {
        const { duplicateReviewToken, ...draft } = formData;
        const all = readMockAccounts<Account & { requestId?: string }>();
        const saved = all.find(account => account.tenantId === tenant.id && draft.requestId && account.requestId === draft.requestId);
        if (!saved && userCan('accounts', 'canView')) await requireMockAccountReview(all, tenant.id, user?.id, draft.name ?? '', duplicateReviewToken);
        const newAccount = saved ?? {
          ...draft,
          name: draft.name ?? '',
          id: uuid(),
          tenantId: tenant.id,
          createdAt: new Date().toISOString(),
        };
        if (!saved) {
          const accounts = readMockAccountRows<Account>(mockAccountsKey);
          localStorage.setItem(mockAccountsKey, JSON.stringify([...accounts, newAccount]));
          setDisplayAccounts((prev) => [...prev, newAccount]);
        }
      } else {
        await accountsService.create({ ...formData, tenantId: tenant.id });
      }
      toast.success('Account created.');
      setIsFormOpen(false);
    } catch (err) {
      throw err;
    }
  }, [tenant, user?.id, userCan]);

  const handleUpdate = useCallback(async (id: string, formData: AccountMutationInput) => {
    try {
      if (USE_MOCK_DATA) {
        for (const key of [mockAccountsKey, mockOrganizationsKey]) {
          const rows = readMockAccountRows<Account>(key);
          if (rows.some(account => account.id === id)) {
            localStorage.setItem(key, JSON.stringify(rows.map(account => account.id === id ? { ...account, ...formData } : account)));
          }
        }
        setDisplayAccounts((prev) => prev.map((c) => c.id === id ? { ...c, ...formData } : c));
      } else {
        await accountsService.update(id, formData as unknown as Record<string, unknown>);
      }
      toast.success('Account updated.');
      setIsFormOpen(false);
      setEditTarget(null);
    } catch (err) {
      throw err;
    }
  }, [tenant]);

  const handleArchive = useCallback(async (id: string) => {
    await accountsService.archive(id);
  }, []);

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
    facets: facets ?? {},
    filters,
    setFilters,
    isLoading,
    /** True during background refresh (existing data remains visible). */
    isRefreshing,
    isManualRefreshing,
    error,
    refetch: loadAccounts,
    isFormOpen,
    editTarget,
    handleCreate,
    handleUpdate,
    handleArchive,
    handleOpenCreate,
    handleOpenEdit,
    handleCloseForm,
  };
}
