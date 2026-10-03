import React, { useState, useEffect } from 'react';
import {
  Send, Eye, MousePointerClick, X, Sparkles,
  BarChart2, Monitor, Link2, RefreshCw, Loader2,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from '@/shared/components/charts/ChartComponents';
import { Campaign } from '@/store/types';
import { BackButton } from '@/shared/components/ui/back-button';
import { campaignsApi } from '@/shared/services/campaigns.api';

// ··· Types ····································································

type MetricTab = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced';

interface CampaignReportViewProps {
  campaign: Campaign;
  activeMetricTab: MetricTab;
  onMetricTabChange: (tab: MetricTab) => void;
  onBack: () => void;
}

interface LiveMetrics {
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  engagement: number;
  deliveredCount?: number;
  bouncedCount?: number;
  recipientCount?: number;
  failedCount?: number;
}

// ··· Helpers ·································································

function deriveMetrics(liveMetrics: LiveMetrics) {
  const sent      = liveMetrics.sentCount ?? 0;
  const opened    = liveMetrics.openedCount ?? 0;
  const clicked   = liveMetrics.clickedCount ?? 0;
  const delivered = liveMetrics.deliveredCount ?? 0;
  const deliveredPct = sent > 0 ? Math.round(delivered / sent * 100) : 0;
  const openedPct    = sent > 0 ? Math.round((opened / sent) * 100) : 0;
  const clickedPct   = sent > 0 ? Math.round((clicked / sent) * 100) : 0;
  const bounce = liveMetrics.bouncedCount ?? 0;
  return { sent, delivered, deliveredPct, opened, openedPct, clicked, clickedPct, bounce };
}

function getMetricTabActiveClass(tab: MetricTab, active: MetricTab): string {
  const colorMap: Record<MetricTab, string> = {
    sent:      'bg-blue-50/50 dark:bg-blue-950/20 border-[#0A6EFF] shadow-[0_0_15px_rgba(10,110,255,0.1)]',
    delivered: 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.1)]',
    opened:    'bg-blue-50/50 dark:bg-blue-950/20 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.1)]',
    clicked:   'bg-blue-50/50 dark:bg-blue-950/20 border-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.1)]',
    bounced:   'bg-red-50/50 dark:bg-red-950/20 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.1)]',
  };
  const inactive = 'bg-white dark:bg-white/2 border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/[0.12]';
  return tab === active ? colorMap[tab] : inactive;
}

// ··· Inline empty state for chart panels ·····································

function ChartEmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="h-64 flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
      <div className="p-3 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500">
        {icon}
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  );
}

// ··· Skeleton cards ··························································

function SkeletonCard() {
  return (
    <div className="rounded-xl p-5 border border-gray-200 dark:border-white/5 bg-white dark:bg-white/2 animate-pulse">
      <div className="h-3 w-16 bg-slate-200 dark:bg-white/10 rounded mb-3" />
      <div className="h-7 w-20 bg-slate-200 dark:bg-white/10 rounded mb-2" />
      <div className="h-2.5 w-12 bg-slate-100 dark:bg-white/5 rounded" />
    </div>
  );
}

// ··· Component ································································

export function CampaignReportView({
  campaign,
  activeMetricTab,
  onMetricTabChange,
  onBack,
}: CampaignReportViewProps) {
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics>({
    sentCount:    campaign.sentCount,
    openedCount:  campaign.openedCount ?? 0,
    clickedCount: campaign.clickedCount ?? 0,
    engagement:   campaign.engagement,
    deliveredCount: campaign.deliveredCount, bouncedCount: campaign.bouncedCount,
    recipientCount: campaign.recipientCount, failedCount: campaign.failedCount,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError]   = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchLatest() {
      setIsLoading(true);
      setHasError(false);
      try {
        const response = await campaignsApi.report(campaign.id);
        if (!cancelled) {
          const c = response.data;
          setLiveMetrics({
            sentCount:    c.sentCount,
            openedCount:  c.openedCount ?? 0,
            clickedCount: c.clickedCount ?? 0,
            engagement:   c.engagement,
            deliveredCount: c.deliveredCount, bouncedCount: c.bouncedCount,
            recipientCount: c.recipientCount, failedCount: c.failedCount,
          });
        }
      } catch {
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchLatest();
    return () => { cancelled = true; };
  }, [campaign.id]);

  const m = deriveMetrics(liveMetrics);

  // Single real data point for the engagement chart
  const engagementChartData = m.sent > 0
    ? [{ name: campaign.name, opens: m.opened, clicks: m.clicked }]
    : [];

  const metricPanelText: Record<MetricTab, string> = {
    sent:      `Emails were submitted to the provider for ${m.sent.toLocaleString()} contacts in the target segment.`,
    delivered: `${m.delivered.toLocaleString()} emails were confirmed delivered (${m.deliveredPct}% delivery rate).`,
    opened:    `${m.opened.toLocaleString()} contacts opened the campaign (${m.openedPct}% open rate).`,
    clicked:   `${m.clicked.toLocaleString()} contacts clicked a link in the campaign (${m.clickedPct}% click rate).`,
    bounced:   `${m.bounce.toLocaleString()} recipients bounced or were blocked by the provider.`,
  };

  const metricPanelTitle: Record<MetricTab, string> = {
    sent:      'Sent Overview',
    delivered: 'Delivery Report',
    opened:    'Open Rate',
    clicked:   'Click Performance',
    bounced:   'Bounces & Deliverability',
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-4 mb-6">
          <BackButton label="Back to Campaigns" onClick={onBack} />
          <div>
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              {campaign.name} Report
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading metrics…</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="flex items-center justify-center py-10 gap-2 text-slate-400 dark:text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Fetching live data…</span>
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-4 mb-6">
          <BackButton label="Back to Campaigns" onClick={onBack} />
          <div>
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              {campaign.name} Report
            </h2>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="p-3 rounded-xl bg-red-500/10 text-red-500">
            <X size={24} />
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">Failed to load campaign metrics</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">There was a problem fetching the latest data.</p>
          <button
            type="button"
            onClick={() => {
              setHasError(false);
              setIsLoading(true);
              campaignsApi.report(campaign.id)
                .then(r => setLiveMetrics({
                  sentCount:    r.data.sentCount,
                  openedCount:  r.data.openedCount ?? 0,
                  clickedCount: r.data.clickedCount ?? 0,
                  engagement:   r.data.engagement,
                  deliveredCount: r.data.deliveredCount, bouncedCount: r.data.bouncedCount,
                  recipientCount: r.data.recipientCount, failedCount: r.data.failedCount,
                }))
                .catch(() => setHasError(true))
                .finally(() => setIsLoading(false));
            }}
            className="flex items-center gap-2 h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-md shadow-blue-500/20 active:scale-95"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <BackButton label="Back to Campaigns" onClick={onBack} />
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            {campaign.name} Report
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{liveMetrics.recipientCount ?? 0} eligible recipients · {m.sent} submitted · {liveMetrics.failedCount ?? 0} submission failures</p>
        </div>
      </div>

      {/* Metric cards */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">

          {/* Sent */}
          <button type="button" onClick={() => onMetricTabChange('sent')}
            className={`text-left rounded-xl p-5 border transition-all ${getMetricTabActiveClass('sent', activeMetricTab)}`}>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Submitted</h3>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{m.sent.toLocaleString()}</div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> Accepted by provider
            </div>
          </button>

          {/* Delivered */}
          <button type="button" onClick={() => onMetricTabChange('delivered')}
            className={`text-left rounded-xl p-5 border transition-all ${getMetricTabActiveClass('delivered', activeMetricTab)}`}>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
              Delivered
            </h3>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{m.delivered.toLocaleString()}</div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5 flex items-center gap-1 font-medium">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> {m.deliveredPct}% Rate
            </div>
          </button>

          {/* Open rate */}
          <button type="button" onClick={() => onMetricTabChange('opened')}
            className={`text-left rounded-xl p-5 border transition-all ${getMetricTabActiveClass('opened', activeMetricTab)}`}>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Open Rate</h3>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{m.openedPct}%</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" /> {m.opened.toLocaleString()} opened
            </div>
          </button>

          {/* Click rate */}
          <button type="button" onClick={() => onMetricTabChange('clicked')}
            className={`text-left rounded-xl p-5 border transition-all ${getMetricTabActiveClass('clicked', activeMetricTab)}`}>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Click Rate</h3>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{m.clickedPct}%</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-teal-500 rounded-full" /> {m.clicked.toLocaleString()} clicked
            </div>
          </button>

          {/* Bounced */}
          <button type="button" onClick={() => onMetricTabChange('bounced')}
            className={`text-left rounded-xl p-5 border transition-all ${getMetricTabActiveClass('bounced', activeMetricTab)}`}>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Bounce Rate</h3>
            <div className="text-2xl font-black text-slate-500 dark:text-slate-400">{m.sent ? Math.round(m.bounce / m.sent * 100) : 0}%</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full" /> {m.bounce.toLocaleString()} bounced
            </div>
          </button>
        </div>

        {/* Active metric panel */}
        <div className="p-4 bg-slate-50 dark:bg-[#0c0f16] border border-gray-200 dark:border-white/4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${
              activeMetricTab === 'sent'      ? 'bg-blue-500/10 text-blue-500' :
              activeMetricTab === 'delivered' ? 'bg-emerald-500/10 text-emerald-500' :
              activeMetricTab === 'opened'    ? 'bg-sky-500/10 text-sky-500' :
              activeMetricTab === 'clicked'   ? 'bg-teal-500/10 text-teal-500' :
                                                'bg-red-500/10 text-red-500'
            }`}>
              {activeMetricTab === 'sent'      && <Send size={18} />}
              {activeMetricTab === 'delivered' && <Sparkles size={18} />}
              {activeMetricTab === 'opened'    && <Eye size={18} />}
              {activeMetricTab === 'clicked'   && <MousePointerClick size={18} />}
              {activeMetricTab === 'bounced'   && <X size={18} />}
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">
                {metricPanelTitle[activeMetricTab]}
              </h4>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                {metricPanelText[activeMetricTab]}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 bg-white dark:bg-black/20 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/5">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium font-mono">Status:</span>
            <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-bold font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /> Live
            </span>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Engagement over time */}
        <div className="bg-white dark:bg-white/2 rounded-xl p-5 border border-gray-200 dark:border-white/5">
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Engagement Overview</h3>
          {engagementChartData.length > 0 ? (
            <div className="h-64 relative w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <AreaChart data={engagementChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorOpens" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0A6EFF" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#0A6EFF" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                    itemStyle={{ color: '#e2e8f0' }}
                  />
                  <Area type="monotone" dataKey="opens" stroke="#0A6EFF" fillOpacity={1} fill="url(#colorOpens)" name="Opens" />
                  <Area type="monotone" dataKey="clicks" stroke="#10B981" fillOpacity={1} fill="url(#colorClicks)" name="Clicks" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartEmptyState
              icon={<BarChart2 size={20} />}
              message="Detailed time-series data not available yet"
            />
          )}
        </div>

        {/* Device breakdown */}
        <div className="bg-white dark:bg-white/2 rounded-xl p-5 border border-gray-200 dark:border-white/5">
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Device Breakdown</h3>
          <ChartEmptyState
            icon={<Monitor size={20} />}
            message="Device tracking not available yet"
          />
        </div>

        {/* Top links */}
        <div className="bg-white dark:bg-white/2 rounded-xl p-5 border border-gray-200 dark:border-white/5">
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Top Links Clicked</h3>
          <ChartEmptyState
            icon={<Link2 size={20} />}
            message="Link click tracking not available yet"
          />
        </div>
      </div>
    </div>
  );
}
