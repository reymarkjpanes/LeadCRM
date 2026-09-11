'use client';

import React from 'react';
import { Calendar, CheckCircle2, DollarSign, FileText, Briefcase, UserCheck, MessageSquare, AlertCircle, Clock, ShieldCheck } from 'lucide-react';
import { Lead, Deal, Task, Invoice } from '@/store/types';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';

export interface TimelineEvent {
  id: string;
  category: 'CRM' | 'Sales' | 'Support' | 'Marketing' | 'Finance';
  eventType: string;
  title: string;
  description?: string;
  timestamp: string;
  actorName: string;
  entityId?: string;
  entityType?: 'lead' | 'organization' | 'deal' | 'task' | 'invoice';
  amount?: number;
}

interface CustomerJourneyTimelineProps {
  lead: Lead;
  deals: Deal[];
  tasks: Task[];
  invoices?: Invoice[];
  onSelectDeal?: (deal: Deal) => void;
}

export const CustomerJourneyTimeline: React.FC<CustomerJourneyTimelineProps> = ({
  lead,
  deals = [],
  tasks = [],
  invoices = [],
  onSelectDeal,
}) => {
  // Aggregate dynamic timeline events from deals, tasks, invoices, and activities
  const events: TimelineEvent[] = [];

  // 1. Initial Lead Creation Event
  if (lead.createdAt) {
    events.push({
      id: `evt_created_${lead.id}`,
      category: 'CRM',
      eventType: 'lead_created',
      title: 'Lead Profile Created',
      description: `Lead intake registered via ${lead.leadSource || 'Inbound Inquiry'} into CRM system.`,
      timestamp: lead.createdAt,
      actorName: 'System Intake',
      entityId: lead.id,
      entityType: 'lead',
    });
  }

  // 2. Aggregate Deal Events (Deal Created & Stage History)
  const leadCompName = lead.companyName?.toLowerCase().trim() || '';
  const clientDeals = deals.filter(d => 
    d.leadId === lead.id || 
    d.leadIds?.includes(lead.id) || 
    (leadCompName !== '' && d.companyName && d.companyName.toLowerCase().trim() === leadCompName)
  );
  
  clientDeals.forEach(deal => {
    events.push({
      id: `evt_deal_created_${deal.id}`,
      category: 'Sales',
      eventType: 'deal_created',
      title: `Deal Created: ${deal.title}`,
      description: `Initial deal value set at ₱${(deal.value || 0).toLocaleString('en-PH')} (${deal.priority} Priority).`,
      timestamp: deal.createdAt,
      actorName: deal.assignedUserId || 'User',
      entityId: deal.id,
      entityType: 'deal',
      amount: deal.value,
    });

    if (deal.history && deal.history.length > 0) {
      deal.history.forEach((h, idx) => {
        const stageName = h.stageId === 'stage_won' ? 'Closed Won' : h.stageId === 'stage_lost' ? 'Closed Lost' : h.stageId;
        events.push({
          id: `evt_stage_${deal.id}_${idx}`,
          category: 'Sales',
          eventType: 'stage_changed',
          title: `Deal Milestone: ${deal.title}`,
          description: `Stage updated to [${stageName}]${h.note ? ` — Note: "${h.note}"` : ''}.`,
          timestamp: h.timestamp,
          actorName: h.userId || 'User',
          entityId: deal.id,
          entityType: 'deal',
          amount: deal.value,
        });
      });
    }
  });

  // 3. Aggregate Task Events
  const clientTasks = tasks.filter(t => clientDeals.some(d => d.id === t.dealId));
  clientTasks.forEach(task => {
    events.push({
      id: `evt_task_${task.id}`,
      category: 'Support',
      eventType: 'task_event',
      title: `Task ${task.status === 'completed' ? 'Completed' : 'Assigned'}: ${task.title}`,
      description: task.description || 'Execution task linked to active deal workflow.',
      timestamp: task.createdAt,
      actorName: task.assignedUserId || 'Operations',
      entityId: task.id,
      entityType: 'task',
    });
  });

  // 4. Aggregate Status Update logs
  if (lead.updateStatus) {
    events.push({
      id: `evt_update_${lead.id}`,
      category: 'CRM',
      eventType: 'activity_log',
      title: 'Latest Interaction Logged',
      description: lead.updateStatus,
      timestamp: lead.lastUpdated || lead.createdAt,
      actorName: 'Assigned Agent',
      entityId: lead.id,
      entityType: 'lead',
    });
  }

  // Sort events chronologically (newest first)
  const sortedEvents = events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (sortedEvents.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-slate-400 border border-dashed rounded-xl my-4">
        No chronological history recorded for this client profile.
      </div>
    );
  }

  const pagination = usePagination({
    totalItems: sortedEvents.length,
    initialPageSize: 10,
    pageSizeOptions: [10, 25, 50],
  });
  const paginatedEvents = pagination.paginateItems(sortedEvents);

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
          <Clock size={14} className="text-blue-500" />
          Master Customer Timeline ({sortedEvents.length} Events)
        </h4>
        <span className="text-[10px] text-slate-400 font-medium">Aggregated Multi-Year Journey</span>
      </div>

      <div className="relative border-l-2 border-slate-200 dark:border-white/10 ml-4 pl-6 space-y-6">
        {paginatedEvents.map(evt => {
          const evtDate = new Date(evt.timestamp);
          const formattedDate = isNaN(evtDate.getTime()) ? evt.timestamp : evtDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });

          return (
            <div key={evt.id} className="relative group">
              {/* Timeline Marker Icon */}
              <div className={`absolute -left-[31px] top-0.5 w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-white shadow-xs ${
                evt.category === 'Sales' ? 'bg-blue-600' :
                evt.category === 'CRM' ? 'bg-emerald-600' :
                evt.category === 'Finance' ? 'bg-indigo-600' :
                'bg-amber-500'
              }`}>
                {evt.category === 'Sales' ? <Briefcase size={12} /> :
                 evt.category === 'CRM' ? <UserCheck size={12} /> :
                 evt.category === 'Finance' ? <DollarSign size={12} /> :
                 <CheckCircle2 size={12} />}
              </div>

              {/* Card Container */}
              <div className="p-4 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-xl hover:border-blue-500/40 transition-colors shadow-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider mb-1 ${
                      evt.category === 'Sales' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                      evt.category === 'CRM' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {evt.category} · {evt.eventType.replace('_', ' ')}
                    </span>
                    <h5 className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                      {evt.title}
                    </h5>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400 whitespace-nowrap ml-2">
                    {formattedDate}
                  </span>
                </div>

                {evt.description && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                    {evt.description}
                  </p>
                )}

                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-white/5 text-[10px] text-slate-400">
                  <span>Logged by: <strong className="text-slate-700 dark:text-slate-300">{evt.actorName}</strong></span>
                  {evt.amount && (
                    <span className="font-black text-slate-900 dark:text-slate-100">
                      ₱{evt.amount.toLocaleString('en-PH')} PHP
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {sortedEvents.length > 0 && (
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
};
