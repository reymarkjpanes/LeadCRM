'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  FileText,
  Phone,
  Mail,
  CheckCircle2,
  ArrowRight,
  Zap,
  MessageSquare,
  Upload,
  Send,
  Search,
  Plus,
  Activity,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { DataLoadingSkeleton } from './data-view-states';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { activitiesService } from '@/features/tenant/crm/activities/services/activities.service';
import type { TimelineActivity } from '@/shared/hooks/use-record-activities';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { USE_MOCK_DATA } from '@/lib/config';
import type { RecordModule } from '@/shared/hooks/use-record-detail';
import { activityEmail, EmailActivity, EmailThread, groupEmailActivities } from './email-activity';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RecordTimelineTabProps {
  /** Compact layout shared by the CRM record panels. */
  compact?: boolean;
  tasks?: React.ReactNode;
  /** Activities from the useRecordDetail hook */
  activities: TimelineActivity[];
  loading?: boolean;
  error?: string | null;
  /** Module type for creating new activities */
  module: RecordModule;
  /** Record ID for creating new activities */
  recordId: string;
  /** Callback after an activity is created (to refetch) */
  onActivityCreated?: () => void;
}

const ACTIVITY_FILTERS = ['All', 'Emails', 'Tasks', 'Status'] as const;
type FilterType = typeof ACTIVITY_FILTERS[number];
type ComposerMode = 'note' | 'email' | 'task';

// ─── Activity icon/color mapping ─────────────────────────────────────────────

const ACTIVITY_ICON_MAP: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  note: { icon: FileText, color: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10' },
  call: { icon: Phone, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' },
  email: { icon: Mail, color: 'text-violet-500 bg-violet-50 dark:bg-violet-500/10' },
  sms: { icon: MessageSquare, color: 'text-teal-500 bg-teal-50 dark:bg-teal-500/10' },
  task: { icon: CheckCircle2, color: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
  meeting: { icon: MessageSquare, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' },
  stage_change: { icon: ArrowRight, color: 'text-orange-500 bg-orange-50 dark:bg-orange-500/10' },
  'stage-change': { icon: ArrowRight, color: 'text-orange-500 bg-orange-50 dark:bg-orange-500/10' },
  workflow: { icon: Zap, color: 'text-purple-500 bg-purple-50 dark:bg-purple-500/10' },
  deal_action: { icon: Zap, color: 'text-pink-500 bg-pink-50 dark:bg-pink-500/10' },
  file_upload: { icon: Upload, color: 'text-slate-500 bg-slate-50 dark:bg-slate-500/10' },
  'file-upload': { icon: Upload, color: 'text-slate-500 bg-slate-50 dark:bg-slate-500/10' },
};

const FILTER_MAPPING: Record<FilterType, string[]> = {
  All: [],
  Emails: ['email'],
  Tasks: ['task'],
  Status: ['stage_change', 'stage-change', 'status_change', 'deal_action'],
};


// ─── Relative time formatter ─────────────────────────────────────────────────

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Quick Composer ──────────────────────────────────────────────────────────

interface QuickComposerProps {
  module: RecordModule;
  recordId: string;
  onCreated?: () => void;
}

function QuickComposer({ module, recordId, onCreated }: QuickComposerProps): React.ReactElement {
  const { addActivity } = useData();
  const { user } = useAuth();
  const [mode, setMode] = useState<ComposerMode>('note');
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modes: { id: ComposerMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'note', label: 'Note', icon: FileText },
    { id: 'task', label: 'Task', icon: CheckCircle2 },
    { id: 'email', label: 'Email', icon: Mail },
  ];

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!text.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (USE_MOCK_DATA) {
        if (!user) throw new Error('Sign in to log activity');
        await addActivity({ type: mode, title: text.trim(), relatedToType: module === 'accounts' ? 'company' : module === 'deals' ? 'deal' : 'contact', relatedToId: recordId, createdBy: user.id, createdAt: new Date().toISOString() });
      } else {
        // The current API supports these record links. Never send a stripped or
        // unknown field, which would create an unlinked activity.
        await activitiesService.create({ type: mode, title: text.trim(), ...(module === 'leads' ? { leadId: recordId } : module === 'contacts' ? { contactId: recordId } : module === 'accounts' ? { accountId: recordId } : { dealId: recordId }) });
      }
      setText('');
      toast.success(`${mode.charAt(0).toUpperCase() + mode.slice(1)} logged`);
      onCreated?.();
    } catch {
      toast.error('Failed to log activity');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border border-border rounded-xl bg-card overflow-hidden">
      {/* Mode selector */}
      <div className="flex flex-wrap items-center gap-1 px-4 pt-3 pb-2 border-b border-border/50">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              mode === m.id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">Quick Log</span>
      </div>

      {/* Text input */}
      <div className="p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Write a ${mode}...`}
          className="min-h-[60px] resize-none border-0 p-0 shadow-none focus-visible:ring-0 text-sm"
          aria-label="Activity description"
          maxLength={255}
          disabled={isSubmitting}
        />
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
        <span className="text-xs text-muted-foreground">Will be timestamped now</span>
        <Button
          type="submit"
          size="sm"
          disabled={!text.trim() || isSubmitting}
          className="gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          Save {mode.charAt(0).toUpperCase() + mode.slice(1)}
        </Button>
      </div>
    </form>
  );
}

// ─── Timeline Entry ──────────────────────────────────────────────────────────

interface TimelineEntryProps {
  activity: TimelineActivity;
  compact?: boolean;
}

function TimelineEntry({ activity, compact = false }: TimelineEntryProps): React.ReactElement {
  const email = activityEmail(activity);
  const config = ACTIVITY_ICON_MAP[activity.type] ?? ACTIVITY_ICON_MAP.note;
  const Icon = config.icon;
  if (email) return <EmailActivity email={email} />;

  return (
    <div className={cn('grid items-start hover:bg-accent/30 transition-colors group', compact ? 'grid-cols-[1.75rem_minmax(0,1fr)] gap-2 p-3 sm:grid-cols-[2rem_minmax(0,1fr)] sm:gap-3 sm:p-4' : 'grid-cols-[2rem_minmax(0,1fr)] gap-3 p-4')}>
      {/* Icon */}
      <div className={cn('rounded-full flex items-center justify-center shrink-0', compact ? 'h-7 w-7 sm:h-8 sm:w-8' : 'h-8 w-8', config.color)}>
        <Icon className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4', !compact && 'h-4 w-4')} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-foreground leading-snug break-words [overflow-wrap:anywhere]', compact ? 'text-[13px] sm:text-sm' : 'text-sm')}>
          {activity.title}
        </p>
        {activity.description && (
          <p className={cn('text-muted-foreground mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]', compact ? 'text-[11px] sm:text-xs' : 'text-xs')}>
            {activity.description}
          </p>
        )}
        <div className={cn('mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground', compact ? 'text-[11px] sm:text-xs' : 'text-xs')}>
          {activity.createdBy && <span className="break-words [overflow-wrap:anywhere]">{[activity.createdBy.firstName, activity.createdBy.lastName].filter(Boolean).join(' ')}</span>}
          <time dateTime={activity.createdAt} title={new Date(activity.createdAt).toLocaleString()}>{formatRelativeTime(activity.createdAt)}</time>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function RecordTimelineTab({
  activities,
  module,
  recordId,
  onActivityCreated,
  loading = false,
  error,
  compact = false,
  tasks,
}: RecordTimelineTabProps): React.ReactElement {
  const canCreate = useHasPermission(`${module}.edit` as import('@leadcrm/shared').PermissionKey);
  const canLog = canCreate;
  const [filter, setFilter] = useState<FilterType>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const [composerOpen, setComposerOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!composerOpen) return;
    const composer = composerRef.current;
    const container = composer?.closest<HTMLElement>('[data-record-scroll]');
    if (!composer || !container) return;
    container.scrollTo({ top: container.scrollTop + composer.getBoundingClientRect().top - container.getBoundingClientRect().top, behavior: 'smooth' });
    composer.querySelector<HTMLElement>('textarea, input, button')?.focus({ preventScroll: true });
  }, [composerOpen]);

  const filters = ACTIVITY_FILTERS;

  // Filter + search activities
  const filteredActivities = useMemo(() => {
    let result = activities;

    // Type filter
    if (filter !== 'All') {
      const allowedTypes = FILTER_MAPPING[filter];
      result = result.filter((a) => allowedTypes.includes(a.type));
    }

    // Search
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          ([activityEmail(a)?.body, activityEmail(a)?.subject, activityEmail(a)?.from, ...(activityEmail(a)?.to ?? [])].filter(Boolean).join(' ').toLowerCase().includes(query)) ||
          (a.description?.toLowerCase().includes(query) ?? false) ||
          ([a.createdBy?.firstName, a.createdBy?.lastName].filter(Boolean).join(' ').toLowerCase().includes(query))
      );
    }

    return result;
  }, [activities, filter, searchTerm]);

  const entries = [
    ...groupEmailActivities(filteredActivities.filter(a => a.type === 'email')).map(thread => ({ id: `thread:${thread.key}`, createdAt: thread.createdAt, content: <EmailThread thread={thread} /> })),
    ...filteredActivities.filter(a => a.type !== 'email').map(activity => ({ id: activity.id, createdAt: activity.createdAt, content: <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"><TimelineEntry activity={activity} compact={compact} /></div> })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const visibleEntries = entries.slice(0, visibleCount);
  const hasMore = entries.length > visibleCount;

  const handleLoadMore = useCallback((): void => {
    setVisibleCount((prev) => prev + 20);
  }, []);

  return (
    <div className={cn('w-full min-w-0', compact ? 'space-y-3 px-3 py-4 sm:space-y-4 sm:px-4 sm:py-5' : 'space-y-4 px-[var(--panel-gutter,1.5rem)] py-5')}>
      {/* Quick Composer */}
      {canLog && (!compact || composerOpen) ? <div ref={composerRef}><QuickComposer key={recordId} module={module} recordId={recordId} onCreated={() => { setComposerOpen(false); onActivityCreated?.(); }} /></div> : !compact && canCreate ? <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">Activity history is available below. Quick Log is currently unavailable for this record.</p> : null}
      <h3 className={cn('font-semibold uppercase tracking-[0.14em] text-muted-foreground', compact ? 'text-[11px] sm:text-xs' : 'text-xs')}>Activity Timeline{!loading && !error ? ` (${activities.length})` : ''}</h3>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* Filter bar */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => { setFilter(f); setVisibleCount(20); }}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                compact && 'min-h-8 border border-border bg-card px-1.5 text-[11px] sm:min-h-9 sm:px-2 sm:text-xs',
                compact && filter === f ? 'bg-[var(--primary)] text-white border-transparent' : filter === f
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setVisibleCount(20); }}
            aria-label="Search activities"
            placeholder="Search activities..."
            className={cn('pl-8 w-full', compact ? 'h-8 text-[11px] sm:h-9 sm:text-xs' : 'h-9 text-xs')}
          />
        </div>
      </div>

      {tasks && (filter === 'All' || filter === 'Tasks') && tasks}
      {loading && !activities.length && <div role="status" aria-label="Loading activity history" className="rounded-xl border border-border bg-card"><DataLoadingSkeleton rowCount={3} columnCount={1} rowHeight={104} /></div>}
      {/* Timeline list */}
      {(!loading && !error || activities.length > 0) && <div className="min-w-0 space-y-3">
        {visibleEntries.length > 0 ? (
          <>
            {visibleEntries.map(entry => <React.Fragment key={entry.id}>{entry.content}</React.Fragment>)}

            {/* Load more */}
            {hasMore && (
              <div className="px-4 py-3 text-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Load more ({entries.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="px-4 py-12 text-center">
            {compact ? <Activity className="mx-auto mb-3 h-9 w-9 rounded-full bg-[var(--primary)]/10 p-2 text-[var(--primary)]" /> : <Plus className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />}
            <p className="text-sm text-muted-foreground">
              {activities.length === 0
                ? 'No activity recorded for this record.'
                : 'No activities match your filter.'}
            </p>
            {compact && canLog && !composerOpen && <Button variant="ghost" size="sm" className="mt-2 gap-1 text-[var(--primary)]" onClick={() => setComposerOpen(true)}><Plus size={13} />Log an activity</Button>}
          </div>
        )}
      </div>}
      {compact && canLog && activities.length > 0 && !composerOpen && <Button variant="ghost" size="sm" className="gap-1 text-[var(--primary)]" onClick={() => setComposerOpen(true)}><Plus size={13} />Log an activity</Button>}
    </div>
  );
}
