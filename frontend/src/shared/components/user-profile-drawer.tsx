'use client';

import React, { useMemo } from 'react';
import { Mail, Phone, Shield, Briefcase, CheckSquare, TrendingUp, Award, Calendar } from 'lucide-react';
import { User, Deal, Task } from '@/store/types';
import { ModalCloseButton } from '@/shared/components/ui/modal-close-button';
import { useAuth } from '@/store/AuthContext';
import { getTenantCurrency, formatCurrency } from '@/shared/utils/currency';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfileDrawerProps {
  user: User | null;
  deals: Deal[];
  tasks: Task[];
  onClose: () => void;
  onSelectDeal?: (deal: Deal) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const UserProfileDrawer: React.FC<UserProfileDrawerProps> = ({
  user,
  deals = [],
  tasks = [],
  onClose,
  onSelectDeal,
}) => {
  const { tenant } = useAuth();

  // Tenant-aware currency — used for all monetary values in this drawer.
  // Avoids hardcoded ₱ symbols for tenants configured with other currencies.
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);

  if (!user) return null;

  const assignedDeals = deals.filter((d) => d.assignedUserId === user.id && !d.isArchived);
  const totalPipelineValue = assignedDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const wonDeals = assignedDeals.filter(
    (d) => d.stageId === 'stage_won' || d.stageId.toLowerCase().includes('won'),
  );
  const winRate =
    assignedDeals.length > 0
      ? Math.round((wonDeals.length / assignedDeals.length) * 100)
      : 0;

  const assignedTasks = tasks.filter((t) => t.assignedUserId === user.id);
  const openTasks = assignedTasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled',
  );

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-950 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-white/10 overflow-y-auto">

        {/* ── Header Banner ─────────────────────────────────────────────── */}
        <div className="relative bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white shrink-0">
          <div className="absolute top-4 right-4">
            <ModalCloseButton
              onClose={onClose}
              ariaLabel="Close profile drawer"
              className="text-white hover:text-white bg-white/10 hover:bg-white/20"
              size={18}
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md border-2 border-white/30 flex items-center justify-center text-2xl font-black text-white shadow-inner">
              {user.firstName ? user.firstName.charAt(0) : '?'}
            </div>
            <div>
              <h3 className="text-xl font-bold leading-tight">
                {user.firstName} {user.lastName}
              </h3>
              <p className="text-xs text-blue-100 font-medium mt-0.5">{user.role}</p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    user.status === 'active'
                      ? 'bg-emerald-400/20 text-emerald-100 border border-emerald-400/30'
                      : 'bg-amber-400/20 text-amber-100'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {user.status}
                </span>
                {user.team && (
                  <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-blue-100 font-medium">
                    {user.team}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Content Body ──────────────────────────────────────────────── */}
        <div className="p-6 space-y-6 flex-1">

          {/* Key Metric Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-xl">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold mb-1">
                <Briefcase size={14} className="text-blue-500" />
                <span>Active Deals</span>
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white">{assignedDeals.length}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Opportunities managed</p>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-xl">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold mb-1">
                <TrendingUp size={14} className="text-emerald-500" />
                <span>Pipeline Value</span>
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white">
                {formatCurrency(totalPipelineValue, tenantCurrency)}
              </p>
              {/* Currency code badge — updates with tenant config */}
              <p className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 mt-0.5">
                {tenantCurrency.code}
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-xl">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold mb-1">
                <CheckSquare size={14} className="text-amber-500" />
                <span>Open Tasks</span>
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white">{openTasks.length}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Action items pending</p>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-xl">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold mb-1">
                <Award size={14} className="text-indigo-500" />
                <span>Win Rate</span>
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white">{winRate}%</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{wonDeals.length} won deals</p>
            </div>
          </div>

          {/* Contact Details */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Contact Information</h4>
            <div className="space-y-2 text-sm bg-slate-50 dark:bg-white/[0.02] p-3.5 rounded-xl border border-slate-200 dark:border-white/5">
              <div className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                <Mail size={15} className="text-slate-400 shrink-0" />
                <span className="truncate">{user.email}</span>
              </div>
              {user.phone && (
                <div className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                  <Phone size={15} className="text-slate-400 shrink-0" />
                  <span>{user.phone}</span>
                </div>
              )}
              {user.org && (
                <div className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                  <Shield size={15} className="text-slate-400 shrink-0" />
                  <span>{user.org}</span>
                </div>
              )}
              {user.lastLogin && (
                <div className="flex items-center gap-3 text-slate-500 text-xs">
                  <Calendar size={14} className="text-slate-400 shrink-0" />
                  <span>
                    Last active:{' '}
                    {new Date(user.lastLogin).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Assigned Deals */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              Assigned Deals ({assignedDeals.length})
            </h4>

            {assignedDeals.length > 0 ? (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {assignedDeals.map((deal) => (
                  <div
                    key={deal.id}
                    onClick={() => { if (onSelectDeal) onSelectDeal(deal); }}
                    className="p-3 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-xl hover:border-blue-500/40 dark:hover:border-blue-500/40 transition-colors cursor-pointer group"
                  >
                    <div className="flex justify-between items-start">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-blue-500 transition-colors">
                        {deal.title}
                      </p>
                      <span className="text-xs font-black text-slate-900 dark:text-slate-100 whitespace-nowrap ml-2">
                        {formatCurrency(deal.value ?? 0, tenantCurrency)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-1 text-[10px] text-slate-500">
                      <span>{deal.companyName}</span>
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-semibold">
                        {deal.priority}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400 border border-dashed rounded-xl">
                No active deals assigned to this user.
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
