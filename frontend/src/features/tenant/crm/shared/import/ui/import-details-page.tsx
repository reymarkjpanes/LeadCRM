'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  RefreshCw,
  Calendar,
  User,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { getImportConfig } from '../configs';
import type { ImportSummary, PaginatedResponse } from '../types/import.types';

// ── Props ────────────────────────────────────────────────────────────────────

interface ImportDetailsPageProps {
  moduleKey: string;
  importId: string;
}

// ── Result row shape from API ────────────────────────────────────────────────

interface ApiResultRow {
  id: string;
  importId: string;
  rowNumber: number;
  status: 'imported' | 'failed' | 'duplicate';
  remarks: string | null;
  createdAt: string;
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', className: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' };
    case 'completed_with_errors':
      return { label: 'Completed with Errors', className: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' };
    case 'failed':
      return { label: 'Failed', className: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' };
    case 'pending':
    case 'importing':
      return { label: 'In Progress', className: 'bg-blue-100 dark:bg-primary/20 text-blue-700 dark:text-primary' };
    default:
      return { label: status, className: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400' };
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ImportDetailsPage({ moduleKey, importId }: ImportDetailsPageProps): React.ReactElement {
  const router = useRouter();
  const config = useMemo(() => getImportConfig(moduleKey), [moduleKey]);

  const [importData, setImportData] = useState<ImportSummary | null>(null);
  const [results, setResults] = useState<ApiResultRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const resultRequest = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | 'imported' | 'failed' | 'duplicate'>('all');

  const pageSize = 25;

  // ── Fetch Import Summary ───────────────────────────────────────────────

  const fetchImport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<{ success: boolean; data: ImportSummary }>(
        `${config.importApiPath}/${importId}`,
      );
      setImportData(response.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load import details';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [config.importApiPath, importId]);

  // ── Fetch Results ──────────────────────────────────────────────────────

  const fetchResults = useCallback(async () => {
    const version = ++resultRequest.current;
    setResultsLoading(true);
    setResultsError(null);
    try {
      const params: Record<string, unknown> = { page, limit: pageSize };
      if (statusFilter !== 'all') params.status = statusFilter;

      const response = await apiClient.get<PaginatedResponse<ApiResultRow>>(
        `${config.importApiPath}/${importId}/results`,
        { params },
      );
      if (version !== resultRequest.current) return;
      setResults(response.data);
      setTotalResults(response.meta.total);
      setTotalPages(Math.ceil(response.meta.total / pageSize) || 1);
    } catch (err) {
      if (version !== resultRequest.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load results';
      setResultsError(message);
      toast.error(message);
    } finally {
      if (version === resultRequest.current) setResultsLoading(false);
    }
  }, [config.importApiPath, importId, page, statusFilter]);

  useEffect(() => {
    fetchImport();
  }, [fetchImport]);

  useEffect(() => {
    if (importData) fetchResults();
    return () => { resultRequest.current++; };
  }, [fetchResults, importData]);

  // ── Get display columns from result data ───────────────────────────────

  const displayFields = useMemo(() => {
    const allFields = [...config.requiredFields, ...config.optionalFields];
    // Show up to 6 fields in the results table
    return allFields.filter((f, index) => index < 6 || f.key === 'productInterest');
  }, [config]);

  // ── Back route (to the import page, not module list) ───────────────────

  const backToImport = `/crm/${config.moduleKey}/import`;

  // ── Loading State ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col h-full min-h-0 min-w-0 max-w-full">
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="px-0 sm:px-4 py-3 sm:py-6 space-y-5">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-6">
              <div className="w-32 h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mb-3" />
              <div className="w-48 h-6 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl animate-pulse" />
              ))}
            </div>
            <div className="h-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────────────

  if (error || !importData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-14 h-14 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-4">
          <AlertCircle size={24} className="text-red-500" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Import Not Found</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
          {error || 'The import record could not be found.'}
        </p>
        <button
          onClick={() => router.push(backToImport)}
          className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Import
        </button>
      </div>
    );
  }

  // ── Main View ──────────────────────────────────────────────────────────

  const statusBadge = getStatusBadge(importData.status);
  const userName = importData.createdBy
    ? `${importData.createdBy.firstName} ${importData.createdBy.lastName}`
    : '—';

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 max-w-full">
      {/* Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-0 sm:px-4 py-3 sm:py-6 space-y-5">
          {/* Header Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-5">
            <button
              onClick={() => router.push(backToImport)}
              className="inline-flex items-center gap-1 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors mb-3 cursor-pointer"
            >
              <ArrowLeft size={14} /> Back to Import
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold text-slate-900 dark:text-white">Import Details</h1>
              <span className={cn('px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold', statusBadge.className)}>
                {statusBadge.label}
              </span>
            </div>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1" style={{ overflowWrap: 'anywhere' }}>{importData.fileName}</p>
            {importData.status === 'importing' && importData.idempotencyKey && (
              <div className="mt-3 text-[13px] text-slate-500">
                <p>The original importer can resume by uploading the same CSV with the same column mapping.</p>
                <button onClick={() => router.push(`${backToImport}?importKey=${encodeURIComponent(importData.idempotencyKey!)}`)} className="mt-2 text-primary font-medium cursor-pointer">
                  Resume import <ArrowLeft size={13} className="inline rotate-180" />
                </button>
              </div>
            )}
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 min-[375px]:grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2"><FileText size={15} className="text-slate-400" /><span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">File Name</span></div>
              <p className="text-[13px] font-semibold text-slate-900 dark:text-white break-words" title={importData.fileName} style={{ overflowWrap: 'anywhere' }}>{importData.fileName}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2"><Calendar size={15} className="text-slate-400" /><span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Date</span></div>
              <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{formatDate(importData.createdAt)}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2"><User size={15} className="text-slate-400" /><span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Imported By</span></div>
              <p className="text-[13px] font-semibold text-slate-900 dark:text-white break-words">{userName}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-700/50 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2"><CheckCircle2 size={15} className="text-emerald-500" /><span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Records</span></div>
              <p className="text-[13px] font-bold text-slate-900 dark:text-white">{importData.successfulRecords} / {importData.totalRecords}</p>
              {(importData.duplicateRecords ?? 0) > 0 && <p className="text-[11px] text-amber-600">{importData.duplicateRecords} duplicates</p>}
              {importData.failedRecords > 0 && <p className="text-[11px] text-red-500 mt-0.5">{importData.failedRecords} failed</p>}
            </div>
          </div>

          {/* Results Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Import Results</h3>
              <div className="flex flex-wrap items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-lg p-[2px]">
                {(['all', 'imported', 'failed', 'duplicate'] as const).map((filter) => {
                  const labels = { all: 'All', imported: 'Imported', failed: 'Failed', duplicate: 'Duplicate' };
                  return (
                    <button
                      key={filter}
                      onClick={() => { setPage(1); setStatusFilter(filter); }}
                      className={cn(
                        'px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer',
                        statusFilter === filter
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
                      )}
                    >
                      {labels[filter]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Results Table */}
            {resultsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : resultsError ? (
              <div role="alert" className="py-8 text-center text-sm text-red-600">
                <p>{resultsError}</p>
                <button onClick={fetchResults} className="mt-3 text-primary font-medium cursor-pointer"><RefreshCw size={13} className="inline" /> Retry results</button>
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">No results found for this filter.</p>
              </div>
            ) : (
              <div className="max-w-full overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400 w-14">Row</th>
                      {displayFields.map((f) => (
                        <th key={f.key} className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {f.label}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400 w-20">Status</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400 min-w-[200px]">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {results.map((row) => (
                      <tr key={row.id} className={cn('transition-colors', row.status === 'failed' && 'bg-red-50/30 dark:bg-red-500/[0.02]')}>
                        <td className="px-3 py-2 text-slate-400 dark:text-slate-500 font-mono text-[10px]">{row.rowNumber}</td>
                        {displayFields.map((f) => (
                          <td key={f.key} className="px-3 py-2 text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
                            {(row[f.key] as string) || '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          {row.status === 'imported' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              <CircleCheck size={11} /> Imported
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 dark:text-red-400">
                              <CircleX size={11} /> {row.status === 'duplicate' ? 'Duplicate' : 'Failed'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-slate-500 dark:text-slate-400">
                          {row.status === 'imported' ? ('Successfully imported' + (row.resolvedValue === undefined ? '' : ' · Product value: ₱' + Number(row.resolvedValue).toLocaleString('en-PH')))  : (row.remarks || '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {totalResults} total results
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className={cn(
                      'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                      page <= 1
                        ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
                    )}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className={cn(
                      'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                      page >= totalPages
                        ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
                    )}
                    aria-label="Next page"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// (DetailCard removed — cards are now inlined in main view)
