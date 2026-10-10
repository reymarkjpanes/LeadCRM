import React from 'react';
import { CheckCircle } from 'lucide-react';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';

interface TimelineEvent {
  id: string;
  type: string;
  text: string;
  time: string;
  user?: string;
}

interface LeadActivitiesTabProps {
  timelineEvents: TimelineEvent[];
  logType: 'Call' | 'Meeting' | 'Note';
  logNotes: string;
  onSetLogType: (type: 'Call' | 'Meeting' | 'Note') => void;
  onSetLogNotes: (notes: string) => void;
  onLogInteraction: (e: React.FormEvent) => void;
}

const EVENT_BORDER_COLOR: Record<string, string> = {
  email: 'border-sky-400',
  sms: 'border-emerald-400',
  task: 'border-purple-400',
};

export function LeadActivitiesTab({
  timelineEvents,
  logType,
  logNotes,
  onSetLogType,
  onSetLogNotes,
  onLogInteraction,
}: LeadActivitiesTabProps) {
  const pagination = usePagination({
    totalItems: timelineEvents.length,
    initialPageSize: 10,
    pageSizeOptions: [10, 25, 50],
  });
  const paginatedEvents = pagination.paginateItems(timelineEvents);

  return (
    <div className="space-y-6 text-left animate-in fade-in duration-100">
      {/* Quick log form */}
      <form
        onSubmit={onLogInteraction}
        className="bg-slate-50 dark:bg-white/[0.02] border border-gray-150 dark:border-white/[0.04] p-4 rounded-xl space-y-3"
      >
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 dark:border-white/5">
          <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider">
            Quick log staff engagement
          </h4>
          <div className="flex gap-1">
            {(['Call', 'Meeting', 'Note'] as const).map(type => (
              <button
                key={type}
                type="button"
                onClick={() => onSetLogType(type)}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                  logType === type
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-400 border-gray-200 dark:border-white/5'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            required
            placeholder={`e.g. Discussed customer requirements during outbound ${logType.toLowerCase()}...`}
            value={logNotes}
            onChange={e => onSetLogNotes(e.target.value)}
            className="flex-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
          />
          <button
            type="submit"
            className="bg-primary hover:bg-primary/90 font-semibold text-white px-3.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
          >
            <CheckCircle size={13} /> Log
          </button>
        </div>
      </form>

      {/* Vertical timeline */}
      <div className="relative border-l border-gray-200 dark:border-white/5 pl-5 ml-2.5 space-y-5">
        {paginatedEvents.map((evt, i) => (
          <div key={evt.id || i} className="relative animate-in fade-in duration-200">
            <div className={`absolute -left-[27px] top-0.5 w-3.5 h-3.5 rounded-full border-2 bg-white dark:bg-slate-950 ${EVENT_BORDER_COLOR[evt.type] ?? 'border-slate-500'}`} />
            <div className="text-xs">
              <div className="flex items-center justify-between text-slate-400 text-[10px]">
                <span className="font-semibold text-slate-500">{evt.user ?? 'Admin'}</span>
                <span>{evt.time}</span>
              </div>
              <p className="text-slate-800 dark:text-slate-200 mt-1 font-medium">{evt.text}</p>
            </div>
          </div>
        ))}
      </div>

      {timelineEvents.length > 0 && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          pageSizeOptions={[10, 25, 50]}
          onPageChange={pagination.goToPage}
          onPageSizeChange={pagination.setPageSize}
        />
      )}
    </div>
  );
}
