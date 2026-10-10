'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Inbox,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { getImportConfig } from '../configs';
import type { ImportSummary, PaginatedResponse } from '../types/import.types';

// ── Types ────────────────────────────────────────────────────────────────────

interface ImportHistoryListProps {
  moduleKey: string;
  onStartNew?: () => void;
}

type StatusFilter = 'all' | 'completed' | 'completed_with_errors' | 'failed';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getStatusBadge(status: ImportSummary['status']): { label: string; className: string } {
  switch (status) {
    case 'completed': return { label: 'Success', className: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' };
    case 'completed_with_errors': return { label: 'Partial', className: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' };
    case 'failed': return { label: 'Failed', className: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' };
    case 'pending': case 'importing': return { label: 'In Progress', className: 'bg-blue-100 dark:bg-primary/20 text-blue-700 dark:text-primary' };
    default: return { label: status, className: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400' };
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function ImportHistoryList({ moduleKey, onStartNew }: ImportHistoryListProps): React.ReactElement {
  const router = useRouter();
  const config = useMemo(() => getImportConfig(moduleKey), [moduleKey]);

  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const requestVersion = useRef(0);

  const pageSize = 10;

  const fetchImports = useCallback(async () => {
    const version = ++requestVersion.current;
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<PaginatedResponse<ImportSummary>>(config.importApiPath, { params: { page, limit: pageSize, status: statusFilter === 'all' ? undefined : statusFilter } });
      if (version !== requestVersion.current) return;
      setImports(response.data);
      setTotalRecords(response.meta.total);
      setTotalPages(Math.ceil(response.meta.total / pageSize) || 1);
    } catch (err) {
      if (version !== requestVersion.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load import history';
      setError(message);
      toast.error(message);
    } finally {
      if (version === requestVersion.current) setIsLoading(false);
    }
  }, [page, statusFilter, config.importApiPath]);

  useEffect(() => { fetchImports(); return () => { requestVersion.current++; }; }, [fetchImports]);

  const filteredImports = imports;

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-6 space-y-4">
        <div className="h-6 w-40 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => (<div key={i} className="h-14 bg-slate-50 dark:bg-slate-800/60 rounded-lg animate-pulse" />))}</div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-3"><AlertCircle size={20} className="text-red-500" /></div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Failed to load import history</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{error}</p>
        <button onClick={fetchImports} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-primary dark:text-primary bg-blue-50 dark:bg-primary/10 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"><RefreshCw size={12} /> Retry</button>
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────
  if (imports.length === 0 && statusFilter === 'all') {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-6">
        <div className="mb-6">
          <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">Import history</h3>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">Every {config.moduleSingular.toLowerCase()} import from this workspace and how it turned out.</p>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
            <Inbox size={24} className="text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-[14px] font-semibold text-slate-700 dark:text-slate-300">No imports yet</p>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
            Upload a CSV to bring your first batch of {config.moduleLabel.toLowerCase()} into LeadCRM.
          </p>
          <button onClick={onStartNew ?? (() => router.push(`/crm/${moduleKey}/import`))} className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 text-[12.5px] font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors cursor-pointer">
            Start an import <ArrowRight size={13} />
          </button>
        </div>
      </div>
    );
  }

  // ── List ───────────────────────────────────────────────────────────────
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">Import history</h3>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Every {config.moduleSingular.toLowerCase()} import from this workspace and how it turned out.</p>
        </div>
        <div className="flex flex-wrap items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-lg p-[2px] shrink-0">
          {(['all', 'completed', 'completed_with_errors', 'failed'] as const).map((filter) => {
            const labels: Record<StatusFilter, string> = { all: 'All', completed: 'Success', completed_with_errors: 'Partial', failed: 'Failed' };
            return (
              <button key={filter} onClick={() => { setPage(1); setStatusFilter(filter); }} className={cn('px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer', statusFilter === filter ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}>
                {labels[filter]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      {filteredImports.length === 0 ? (
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg py-10 text-center">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">No {statusFilter === 'completed_with_errors' ? 'partial' : statusFilter} imports found.</p>
        </div>
      ) : (
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg max-w-full overflow-x-auto">
        <table className="w-full text-[12px]" aria-label="Import history">
          <thead><tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
            <th scope="col" className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400">Date</th>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400">File Name</th>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400">Status</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-400">Records</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-400">Failed / Duplicates</th>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400">Imported By</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredImports.map((imp) => {
              const badge = getStatusBadge(imp.status);
              const userName = imp.createdBy ? `${imp.createdBy.firstName} ${imp.createdBy.lastName}` : '—';
              return (
                <tr key={imp.id} onClick={() => router.push(config.detailsRoute(imp.id))} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors" tabIndex={0} role="row" onKeyDown={(e) => { if (e.key === 'Enter') router.push(config.detailsRoute(imp.id)); }}>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{formatDate(imp.createdAt)}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><FileText size={14} className="text-slate-400 shrink-0" /><span className="text-slate-900 dark:text-white font-medium truncate max-w-[180px]">{imp.fileName}</span></div></td>
                  <td className="px-4 py-3"><span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold', badge.className)}>{(imp.status === 'pending' || imp.status === 'importing') && <Loader2 size={10} className="animate-spin" />}{badge.label}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums"><span className="text-emerald-600 dark:text-emerald-400 font-medium">{imp.successfulRecords}</span><span className="text-slate-400"> / {imp.totalRecords}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums">{imp.failedRecords > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{imp.failedRecords}</span> : <span className="text-slate-400">0</span>} / {imp.duplicateRecords ?? 0}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 truncate max-w-[130px]">{userName}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{totalRecords} total imports</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 tabular-nums">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className={cn('w-7 h-7 rounded-md border flex items-center justify-center transition-colors cursor-pointer', page <= 1 ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700')} aria-label="Previous page"><ChevronLeft size={14} /></button>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className={cn('w-7 h-7 rounded-md border flex items-center justify-center transition-colors cursor-pointer', page >= totalPages ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700')} aria-label="Next page"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
