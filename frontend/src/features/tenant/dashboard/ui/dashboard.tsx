'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import {
  Users, Briefcase, TrendingUp, DollarSign, Activity,
  ArrowUpRight, ArrowDownRight, Zap, RefreshCw, LayoutDashboard,
  Check, Target, Clock, Star, ChevronRight, Download,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from '@/shared/components/charts/ChartComponents';
import DashboardSkeleton from '@/shared/components/dashboard-skeleton';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { getTenantCurrency, formatCurrency } from '@/shared/utils/currency';
import type { CurrencyConfig } from '@/shared/utils/currency';

export default function Dashboard() {
  const { user, tenant } = useAuth();
  const { contacts, deals, users, roles, tasks, tenants, pipelines } = useData();
  const tenantCurrency = useMemo<CurrencyConfig>(() => getTenantCurrency(tenant), [tenant]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 700);
    return () => clearTimeout(t);
  }, []);

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      toast.success('Metrics refreshed');
    }, 800);
  };

  const handleExportCSV = () => {
    if (!user) return;
    try {
      // Prepare CSV data for Client Admin
      const csvRows: any[][] = [];
      
      // Header
      csvRows.push(['LeadCRM Dashboard Export', '', '', '']);
      csvRows.push(['Exported At', new Date().toLocaleString(), '', '']);
      csvRows.push(['User', `${user.firstName} ${user.lastName}`, '', '']);
      csvRows.push(['', '', '', '']);
      
      // KPI Metrics
      csvRows.push(['Key Performance Indicators', '', '', '']);
      csvRows.push(['Metric', 'Value', 'Trend', 'Status']);
      
      if (isClientAdmin) {
        csvRows.push(['Total Revenue', formatCurrency(totalRevenue, tenantCurrency), `${wonDeals.length} won`, 'Real data']);
        csvRows.push(['Forecasted Revenue', formatCurrency(Math.round(forecastedRevenue), tenantCurrency), `${activeDeals.length} active`, 'Real data']);
        csvRows.push(['Active Deals', activeDeals.length, `${allActive.length} total`, 'Real data']);
        csvRows.push(['Total Leads', contacts.length, '', 'Real data']);
        csvRows.push(['Win Rate', `${winRate}%`, `${wonDeals.length}/${allActive.length}`, 'Real data']);
        csvRows.push(['Avg Velocity', avgVelocity > 0 ? `${avgVelocity} days` : '—', 'to close', 'Real data']);
      } else {
        csvRows.push(['My Hot Leads', myHotLeads.length, `${myHotLeads.length} hot`, 'Active']);
        csvRows.push(['Pending Tasks', myPending.length, myOverdue.length > 0 ? `${myOverdue.length} overdue` : 'On track', myOverdue.length === 0 ? 'Good' : 'Alert']);
        csvRows.push(['My Active Deals', activeDeals.filter(d => d.assignedUserId === user.id).length, 'Active', 'Current']);
        csvRows.push(['Total Contacts', contacts.length, '+recent', 'Growing']);
        csvRows.push(['Win Rate', `${winRate}%`, 'This month', 'Tracking']);
        csvRows.push(['Avg Velocity', `${avgVelocity} days`, 'To close', 'Current']);
      }
      
      csvRows.push(['', '', '', '']);
      
      // Revenue Trend Data
      csvRows.push(['Revenue Trend (6 Months)', '', '', '']);
      csvRows.push(['Month', `Revenue (${tenantCurrency.code})`, 'Deals Closed', '']);
      revenueData.forEach(row => {
        csvRows.push([row.name, row.revenue, row.deals, '']);
      });
      
      csvRows.push(['', '', '', '']);
      
      // Top Performers
      if (isClientAdmin) {
        csvRows.push(['Sales Leaderboard', '', '', '']);
        csvRows.push(['Name', 'Deals Won', 'Active Deals', `Total Value (${tenantCurrency.code})`]);
        topPerformers.forEach(p => {
          csvRows.push([
            `${p.user.firstName} ${p.user.lastName}`,
            p.wonDeals,
            p.activeDeals,
            p.wonValue.toLocaleString()
          ]);
        });
      }
      
      // Convert to CSV string
      const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      
      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `LeadCRM_Dashboard_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success('Dashboard exported to CSV');
    } catch (error) {
      toast.error('Failed to export dashboard');
      console.error('Export error:', error);
    }
  };

  const userRoleDef = roles.find(r => r.name === user?.role);
  const userPerms = userRoleDef?.permissions || [];
  const isClientAdmin = user?.role === 'Client Admin';

  // ── All hooks and derived data MUST be above every early return ────────────
  // Rules of Hooks: no useMemo/useMemo calls after conditional returns.

  // Build a stage lookup from canonical pipelines data
  const stageMap = useMemo(() => {
    const map = new Map<string, { isWon: boolean; isLost: boolean; probability?: number; name: string; color?: string }>();
    for (const pipeline of pipelines) {
      for (const stage of (pipeline.stages ?? [])) {
        map.set(stage.id, { isWon: !!stage.isWon, isLost: !!stage.isLost, probability: stage.probability, name: stage.name, color: stage.color });
      }
    }
    return map;
  }, [pipelines]);

  // Derived deal sets (unconditional — stageMap is now always computed above)
  const wonDeals    = useMemo(() => deals.filter(d => !d.isArchived && !!stageMap.get(d.stageId)?.isWon), [deals, stageMap]);
  const allActive   = useMemo(() => deals.filter(d => !d.isArchived), [deals]);
  const activeDeals = useMemo(() => allActive.filter(d => !stageMap.get(d.stageId)?.isWon && !stageMap.get(d.stageId)?.isLost), [allActive, stageMap]);

  const totalRevenue      = wonDeals.reduce((s, d) => s + (d.value ?? 0), 0);
  const winRate           = allActive.length > 0 ? Math.round((wonDeals.length / allActive.length) * 100) : 0;
  const myTasks           = tasks.filter(t => t.assignedUserId === user?.id);
  const myPending         = myTasks.filter(t => t.status === 'pending');
  const myOverdue         = myTasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate && new Date(t.dueDate) < new Date());
  const myHotLeads        = contacts.filter(c => c.status === 'Hot' && c.assignedUserId === user?.id);
  const forecastedRevenue = activeDeals.reduce((acc, d) => acc + (d.value ?? 0) * ((stageMap.get(d.stageId)?.probability ?? 10) / 100), 0);

  const avgVelocity = useMemo(() => {
    const closedWon = wonDeals.filter(d => d.lastStageChangeDate);
    if (closedWon.length === 0) return 0;
    const sum = closedWon.reduce((acc, d) => {
      const created = new Date(d.createdAt || Date.now()).getTime();
      const closed  = new Date(d.lastStageChangeDate!).getTime();
      return acc + Math.max(1, Math.round((closed - created) / 86400000));
    }, 0);
    return Math.round(sum / closedWon.length);
  }, [wonDeals]);

  const revenueData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d      = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label  = d.toLocaleString('default', { month: 'short' });
      const y      = d.getFullYear();
      const m      = d.getMonth();
      const monthWon = wonDeals.filter(deal => {
        const closed = deal.lastStageChangeDate ? new Date(deal.lastStageChangeDate) : null;
        return closed && closed.getFullYear() === y && closed.getMonth() === m;
      });
      return { name: label, revenue: monthWon.reduce((s, deal) => s + (deal.value ?? 0), 0), deals: monthWon.length };
    });
  }, [wonDeals]);

  const pipelineData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of deals.filter(dl => !dl.isArchived && !stageMap.get(dl.stageId)?.isLost)) {
      counts.set(d.stageId, (counts.get(d.stageId) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([stageId, value]) => {
      const stage = stageMap.get(stageId);
      return { name: stage?.name ?? stageId, value, color: stage?.color ?? '#64748b' };
    });
  }, [deals, stageMap]);

  const topPerformers = useMemo(() => users.map(u => {
    const won = wonDeals.filter(d => d.assignedUserId === u.id);
    return { user: u, wonDeals: won.length, wonValue: won.reduce((s, d) => s + (d.value ?? 0), 0), activeDeals: activeDeals.filter(d => d.assignedUserId === u.id).length };
  }).sort((a, b) => b.wonValue - a.wonValue).slice(0, 5), [users, wonDeals, activeDeals]);

  const statCards = isClientAdmin ? [
    { label: 'Total Revenue', value: formatCurrency(totalRevenue, tenantCurrency),                 icon: DollarSign, color: 'blue',    trend: `${wonDeals.length} won`,                              up: wonDeals.length > 0 },
    { label: 'Forecasted',    value: formatCurrency(Math.round(forecastedRevenue), tenantCurrency), icon: TrendingUp, color: 'emerald', trend: `${activeDeals.length} active`,                        up: true },
    { label: 'Active Deals',  value: activeDeals.length,                                   icon: Briefcase,  color: 'purple',  trend: `${allActive.length} total`,                           up: true },
    { label: 'Total Leads',   value: contacts.length,                                      icon: Users,      color: 'orange',  trend: 'all leads',                                           up: true },
    { label: 'Win Rate',      value: `${winRate}%`,                                        icon: Target,     color: 'pink',    trend: `${wonDeals.length}/${allActive.length}`,              up: winRate > 0 },
    { label: 'Avg Velocity',  value: avgVelocity > 0 ? `${avgVelocity}d` : '—',           icon: Zap,        color: 'indigo',  trend: 'to close',                                            up: true },
  ] : [
    { label: 'My Hot Leads',    value: myHotLeads.length,                                                                 icon: Zap,      color: 'orange',  trend: `${myHotLeads.length} hot`,                                                     up: true },
    { label: 'Pending Tasks',   value: myPending.length,                                                                  icon: Clock,    color: 'red',     trend: myOverdue.length > 0 ? `${myOverdue.length} overdue` : 'On track',              up: myOverdue.length === 0 },
    { label: 'My Active Deals', value: activeDeals.filter(d => d.assignedUserId === user?.id).length,                    icon: Briefcase,color: 'blue',    trend: 'Active',                                                                       up: true },
    { label: 'Total Contacts',  value: contacts.length,                                                                   icon: Users,    color: 'purple',  trend: 'all contacts',                                                                 up: true },
    { label: 'Win Rate',        value: `${winRate}%`,                                                                     icon: Target,   color: 'emerald', trend: 'This month',                                                                   up: winRate > 0 },
    { label: 'Avg Velocity',    value: avgVelocity > 0 ? `${avgVelocity}d` : '—',                                        icon: Zap,      color: 'indigo',  trend: 'To close',                                                                     up: true },
  ];

  // ── All hooks and derivations complete — early returns are now safe ────────

  if (!user || isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <DashboardSkeleton />
      </div>
    );
  }

  // ── System Admin view ──────────────────────────────────────
  if (user.role === 'System Admin') {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="p-4 lg:p-6 space-y-6"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">Platform-wide metrics across all tenants</p>
          <button onClick={handleRefresh} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition-all active:scale-98">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { label: 'Total Tenants', value: tenants.length, icon: Briefcase, color: 'blue' },
            { label: 'Total Users', value: users.length, icon: Users, color: 'emerald' },
            { label: 'Total Deals', value: deals.length, icon: TrendingUp, color: 'purple' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className={`bg-white dark:bg-white/[0.02] p-6 rounded-2xl border border-gray-200 dark:border-white/[0.06] shadow-sm flex items-center gap-4`}>
              <div className={`p-3 rounded-xl bg-${color}-500/10 text-${color}-500`}><Icon size={22} /></div>
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{value}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white dark:bg-white/[0.02] rounded-2xl border border-gray-200 dark:border-white/[0.06] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/[0.05]">
            <h3 className="font-semibold text-slate-900 dark:text-white">Active Tenants</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-white/[0.02] text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3 text-left font-semibold">Company</th>
                <th className="px-6 py-3 text-left font-semibold">Industry</th>
                <th className="px-6 py-3 text-left font-semibold">Status</th>
                <th className="px-6 py-3 text-left font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {tenants.map(t => (
                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-3.5 font-medium text-slate-900 dark:text-white">{t.name}</td>
                  <td className="px-6 py-3.5 text-slate-500 dark:text-slate-400">{t.industry}</td>
                  <td className="px-6 py-3.5">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${t.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-slate-500 dark:text-slate-400">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    );
  }

  const colorMap: Record<string, { bg: string; text: string; glow: string }> = {
    blue:   { bg: 'bg-blue-500/10',   text: 'text-blue-500',   glow: 'shadow-blue-500/20'   },
    emerald:{ bg: 'bg-emerald-500/10', text: 'text-emerald-500', glow: 'shadow-emerald-500/20' },
    purple: { bg: 'bg-purple-500/10', text: 'text-purple-500', glow: 'shadow-purple-500/20' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-500', glow: 'shadow-orange-500/20' },
    pink:   { bg: 'bg-pink-500/10',   text: 'text-pink-500',   glow: 'shadow-pink-500/20'   },
    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-500', glow: 'shadow-indigo-500/20' },
    red:    { bg: 'bg-red-500/10',    text: 'text-red-500',    glow: 'shadow-red-500/20'    },
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="p-4 lg:p-6 space-y-6"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span>Welcome back, <strong className="text-slate-700 dark:text-slate-300">{user.firstName}</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/8 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-all active:scale-98 shadow-xs"
            title="Export to CSV"
          >
            <Download size={14} className="text-slate-500" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
          <button 
            onClick={handleRefresh} 
            className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/8 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-all active:scale-98 shadow-xs"
            title="Sync Metrics"
          >
            <RefreshCw size={14} className="text-slate-500" />
            <span>Sync Metrics</span>
          </button>
        </div>
      </div>

      {/* ── Stat Cards Operational Strip ───────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(({ label, value, icon: Icon, color, trend, up }) => {
          const c = colorMap[color] || colorMap.blue;
          return (
            <div key={label} className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col gap-2">
              <div className="flex items-start justify-between">
                <div className={`p-2 rounded-md ${c.bg} ${c.text}`}>
                  <Icon size={16} />
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${up ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                  {trend}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">{label}</span>
                <span className="text-base font-bold text-slate-900 dark:text-white tracking-tight mt-0.5 block">{value}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Middle row: Revenue Trend + Action Center ─────── */}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Area Chart */}
        <div className="lg:col-span-8 bg-white dark:bg-white/[0.02] p-6 rounded-2xl border border-gray-200 dark:border-white/[0.06] shadow-sm flex flex-col min-h-[320px]">
          <div className="flex items-start justify-between mb-5 shrink-0">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Revenue Trend</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">6-month revenue progression</p>
            </div>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
              <ArrowUpRight size={11} /> {wonDeals.length} won deals
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${tenantCurrency.symbol}${(v / 1000).toFixed(0)}k`} />
                <Tooltip />
                <Area type="monotone" dataKey="revenue" name={`Revenue (${tenantCurrency.code})`} stroke="#3B82F6" strokeWidth={2.5} fill="url(#revGrad)" activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Action Center */}
        <div className="lg:col-span-4 bg-white dark:bg-white/[0.02] p-6 rounded-2xl border border-gray-200 dark:border-white/[0.06] shadow-sm flex flex-col min-h-[320px]">
          <div className="mb-4 shrink-0">
            <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap size={16} className="text-amber-500" /> Action Center
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Hot leads & pending tasks</p>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1">
            {myPending.length === 0 && myHotLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 py-8">
                <Check size={28} className="text-emerald-500" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">All caught up!</p>
                <p className="text-xs text-slate-400">No pending actions right now.</p>
              </div>
            ) : null}
            {myHotLeads.slice(0, 3).map(lead => (
              <div key={lead.id} className="p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30">
                <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide flex items-center gap-1 mb-1"><Zap size={10} /> Hot Lead</span>
                <p className="text-sm font-semibold text-slate-800 dark:text-white">{lead.firstName} {lead.lastName}</p>
                <p className="text-xs text-slate-500">{lead.companyName || 'Individual'}</p>
              </div>
            ))}
            {myPending.slice(0, 3).map(task => (
              <div key={task.id} className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30">
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-1 block">Follow-up</span>
                <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{task.title}</p>
                {task.dueDate && <p className="text-xs text-slate-500 mt-0.5">Due {new Date(task.dueDate).toLocaleDateString()}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom row: Bar Chart + Leaderboard + Pipeline ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-5">
        {/* Bar Chart */}
        <div className="md:col-span-1 lg:col-span-4 bg-white dark:bg-white/[0.02] p-6 rounded-2xl border border-gray-200 dark:border-white/[0.06] shadow-sm flex flex-col min-h-[300px]">
          <div className="mb-4 shrink-0">
            <h3 className="font-semibold text-slate-900 dark:text-white">Revenue & Deals</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Monthly closed performance</p>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${tenantCurrency.symbol}${(v / 1000).toFixed(0)}k`} />
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="revenue" name={`Revenue (${tenantCurrency.code})`} fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={14} />
                <Bar dataKey="deals"   name="Deals Closed" fill="#8B5CF6" radius={[4, 4, 0, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sales Leaderboard */}
        <div className="md:col-span-1 lg:col-span-4 bg-white dark:bg-white/[0.02] p-6 rounded-2xl border border-gray-200 dark:border-white/[0.06] shadow-sm flex flex-col min-h-[300px]">
          <div className="mb-4 shrink-0">
            <h3 className="font-semibold text-slate-900 dark:text-white">Sales Leaderboard</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Top performers by revenue</p>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1">
            {topPerformers.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No sales data yet</p>
            ) : topPerformers.map((p, i) => (
              <div key={p.user.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.04] hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors">
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-gray-200 dark:border-white/[0.08] flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-200">
                    {p.user.firstName[0]}{p.user.lastName[0]}
                  </div>
                  {i === 0 && <Star size={10} className="absolute -top-1 -right-1 text-amber-500 fill-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{p.user.firstName} {p.user.lastName}</p>
                  <p className="text-xs text-slate-500">{p.wonDeals} deals · {p.activeDeals} active</p>
                </div>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{formatCurrency(p.wonValue, tenantCurrency)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline Donut */}
        <div className="md:col-span-2 lg:col-span-4 bg-white dark:bg-white/[0.02] p-6 rounded-2xl border border-gray-200 dark:border-white/[0.06] shadow-sm flex flex-col min-h-[300px]">
          <div className="mb-4 shrink-0">
            <h3 className="font-semibold text-slate-900 dark:text-white">Pipeline Distribution</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Active deals by stage</p>
          </div>
          {pipelineData.length > 0 ? (
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pipelineData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" stroke="none">
                    {pipelineData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Target size={32} className="text-slate-300 dark:text-slate-600" />
              <p className="text-sm">No pipeline data yet</p>
            </div>
          )}
          {pipelineData.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-1.5 shrink-0">
              {pipelineData.map(d => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{d.name} ({d.value})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </motion.div>
  );
}
