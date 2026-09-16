'use client';

import React, { useState } from 'react';
import {
  Receipt, Plus, Search, FileText, TrendingUp,
  DollarSign, AlertCircle, RefreshCw, Calendar,
  MoreVertical, Filter,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useData } from '@/store/DataContext';
import { useInvoicesData } from '../hooks/use-invoices-data';
import { USE_MOCK_DATA } from '@/lib/config';
import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import type { Invoice } from '@/store/types';

// --- Helpers ------------------------------------------------------------------

function statusColor(status: Invoice['status']): string {
  const map: Record<Invoice['status'], string> = {
    'Active':           'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    'Pending Renewal':  'bg-amber-500/10 text-amber-400 border-amber-500/20',
    'Expired':          'bg-slate-500/10 text-slate-400 border-slate-500/20',
    'Cancelled':        'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return map[status] ?? map['Expired'];
}

function paymentColor(status: Invoice['paymentStatus']): string {
  const map: Record<Invoice['paymentStatus'], string> = {
    'Paid':    'text-emerald-400',
    'Unpaid':  'text-slate-400',
    'Overdue': 'text-red-400',
  };
  return map[status] ?? 'text-slate-400';
}

function paymentDot(status: Invoice['paymentStatus']): string {
  return status === 'Paid' ? 'bg-emerald-500' : status === 'Overdue' ? 'bg-red-500' : 'bg-slate-500';
}

import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

// --- Component ----------------------------------------------------------------

export default function BillingPage() {
  const canView   = useHasPermission('billing.view');
  const canCreate = useHasPermission('billing.manage');

  // Mutations stay in DataContext; list data owned by useInvoicesData
  const { invoices: mockInvoices, addInvoice, updateInvoice, removeInvoice } = useData();
  const {
    invoices: serverInvoices,
    isInitialLoad,
    isRefreshing,
    error: invoicesError,
    refetch: refetchInvoices,
  } = useInvoicesData();

  // Mock mode: use DataContext (localStorage); real mode: use server hook
  const invoices = USE_MOCK_DATA ? mockInvoices : serverInvoices;

  const [searchQuery, setSearchQuery]   = useState('');
  const [filterStatus, setFilterStatus] = useState('All');

  // Initial load skeleton
  if (isInitialLoad) {
    return (
      <div className="p-4 lg:p-6">
        <DataLoadingSkeleton rowCount={6} columnCount={4} />
      </div>
    );
  }

  // Error state (only when no data at all)
  if (invoicesError && invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle size={28} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-500 dark:text-red-400 mb-3">{invoicesError}</p>
        <button
          onClick={refetchInvoices}
          className="text-xs text-blue-500 hover:text-blue-600 underline underline-offset-2 cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 dark:text-slate-500">
        <div className="text-center">
          <Receipt className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">You don't have permission to view billing.</p>
        </div>
      </div>
    );
  }

  const filtered = invoices.filter(inv => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      (inv.companyName ?? '').toLowerCase().includes(q) ||
      (inv.id ?? '').toLowerCase().includes(q) ||
      (inv.plan ?? '').toLowerCase().includes(q);
    const matchStatus = filterStatus === 'All' || inv.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const {
    currentPage,
    totalPages,
    pageSize,
    totalItems,
    paginateItems,
    goToPage,
    setPageSize,
  } = usePagination({
    totalItems: filtered.length,
    initialPageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],
    resetDeps: [searchQuery, filterStatus],
  });

  const paginatedInvoices = paginateItems(filtered);

  // Derived stats from real data
  const mrr = invoices
    .filter(i => i.status === 'Active' && i.frequency === 'Monthly')
    .reduce((sum, i) => sum + i.amount, 0);
  const activeCount    = invoices.filter(i => i.status === 'Active').length;
  const renewalCount   = invoices.filter(i => i.status === 'Pending Renewal').length;
  const overdueAmount  = invoices.filter(i => i.paymentStatus === 'Overdue').reduce((s, i) => s + i.amount, 0);

  const stats = [
    { label: 'Monthly Recurring Revenue', value: '$' + mrr.toLocaleString('en-US'),        icon: TrendingUp,  color: 'text-emerald-400' },
    { label: 'Active Contracts',           value: String(activeCount),                       icon: FileText,    color: 'text-blue-400' },
    { label: 'Pending Renewals',           value: String(renewalCount),                      icon: RefreshCw,   color: 'text-amber-400' },
    { label: 'Overdue Payments',           value: '$' + overdueAmount.toLocaleString('en-US'), icon: AlertCircle, color: 'text-red-400' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
            <Receipt className="text-blue-500" />
            Contract Billing
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Manage recurring revenue, subscriptions, and contract renewals.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Reports"
                  className="h-9 w-9 flex items-center justify-center bg-gray-50 dark:bg-white/[0.05] hover:bg-gray-100 dark:hover:bg-white/[0.1] text-slate-900 dark:text-white rounded-xl transition-all border border-gray-300 dark:border-white/[0.1] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <FileText size={18} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Reports</TooltipContent>
            </Tooltip>
            {canCreate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="New Contract"
                    className="h-9 w-9 flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer opacity-50 cursor-not-allowed"
                    disabled
                    title="Invoice creation — coming soon"
                  >
                    <Plus size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>New Contract (coming soon)</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-500">{stat.label}</span>
              <stat.icon size={18} className={stat.color} />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            type="text"
            placeholder="Search by client, contract ID, or plan..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] rounded-xl pl-10 pr-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500/50 transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-slate-500" />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500/50 transition-all cursor-pointer"
          >
            {['All', 'Active', 'Pending Renewal', 'Expired', 'Cancelled'].map(s => (
              <option key={s} value={s} className="bg-gray-50 dark:bg-slate-950">{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/[0.05] bg-gray-50 dark:bg-white/[0.01]">
                {['Contract ID', 'Client & Plan', 'Amount', 'Billing Cycle', 'Next Bill Date', 'Status', 'Payment', ''].map(h => (
                  <th key={h} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              <AnimatePresence mode="popLayout">
                {paginatedInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                      No contracts found.
                    </td>
                  </tr>
                ) : paginatedInvoices.map(inv => (
                  <motion.tr
                    key={inv.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <span className="text-sm font-mono font-bold text-blue-400">{inv.id}</span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-blue-400 transition-colors">
                        {inv.companyName}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{inv.plan}</p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-sm font-bold text-slate-900 dark:text-white">
                        <DollarSign size={14} className="text-emerald-500" />
                        {inv.amount.toLocaleString('en-PH')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                        <RefreshCw size={12} className="text-slate-500" />
                        {inv.frequency}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                        <Calendar size={12} className="text-slate-500" />
                        {inv.nextBillingDate}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${statusColor(inv.status)}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${paymentDot(inv.paymentStatus)}`} />
                        <span className={`text-xs font-medium ${paymentColor(inv.paymentStatus)}`}>
                          {inv.paymentStatus}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>
      
      {filtered.length > 0 && (
        <div className="mt-4">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={totalItems}
            pageSizeOptions={[10, 25, 50, 100]}
            onPageChange={goToPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {/* Renewal alert — only show if there are pending renewals */}
      {renewalCount > 0 && (
        <div className="p-6 bg-blue-600/5 border border-blue-500/20 rounded-2xl flex items-start gap-4">
          <div className="p-2 bg-blue-500/10 rounded-lg shrink-0">
            <TrendingUp className="text-blue-400" size={20} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
              {renewalCount} contract{renewalCount > 1 ? 's' : ''} pending renewal
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Review and renew upcoming contracts to avoid service interruptions.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
