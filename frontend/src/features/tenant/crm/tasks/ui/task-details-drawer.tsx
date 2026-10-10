'use client';

import React from 'react';
import { Calendar, User as UserIcon, CheckCircle2, Clock, AlertCircle, Briefcase, FileText, Tag } from 'lucide-react';
import { Task, Deal, User } from '@/store/types';
import { ModalCloseButton } from '@/shared/components/ui/modal-close-button';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';

interface TaskDetailsDrawerProps {
  task: Task | null;
  deal?: Deal | null;
  assignedUser?: User | null;
  onClose: () => void;
  onToggleStatus?: (taskId: string, newStatus: Task['status']) => void;
}

export const TaskDetailsDrawer: React.FC<TaskDetailsDrawerProps> = ({
  task,
  deal,
  assignedUser,
  onClose,
  onToggleStatus,
}) => {
  if (!task) return null;

  const isCompleted = task.status === 'completed';

  return (
    <Sheet open={!!task} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent showClose={false} aria-label="Task details" className="max-w-md sm:max-w-md bg-white dark:bg-slate-950 shadow-2xl flex flex-col border-l border-slate-200 dark:border-white/10 overflow-y-auto">
        {/* Header */}
        <div className="relative p-6 border-b border-slate-200 dark:border-white/10 flex items-start justify-between bg-slate-50 dark:bg-white/[0.02]">
          <div className="pr-6">
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                task.priority === 'High' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                task.priority === 'Medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              }`}>
                <Tag size={12} />
                {task.priority} Priority
              </span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                isCompleted ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}>
                {isCompleted ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                {task.status}
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-snug [overflow-wrap:anywhere]">
              {task.title}
            </h3>
          </div>

          <ModalCloseButton onClose={onClose} ariaLabel="Close task details drawer" size={18} />
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 flex-1">
          {/* Quick Actions */}
          <div className="p-4 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-xl flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Task Status:
            </span>
            <button
              onClick={() => {
                if (onToggleStatus) {
                  onToggleStatus(task.id, isCompleted ? 'pending' : 'completed');
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs ${
                isCompleted
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 hover:bg-amber-100'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-500/20'
              }`}
            >
              {isCompleted ? <Clock size={14} /> : <CheckCircle2 size={14} />}
              {isCompleted ? 'Mark as Pending' : 'Mark as Completed'}
            </button>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
              <FileText size={14} /> Description
            </h4>
            <div className="p-3.5 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-xl text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              {task.description || 'No detailed description provided.'}
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Details & Assignments</h4>
            
            <div className="space-y-2.5 text-xs bg-slate-50 dark:bg-white/[0.02] p-4 rounded-xl border border-slate-200 dark:border-white/5">
              <div className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Calendar size={14} /> Due Date:
                </span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <UserIcon size={14} /> Assigned To:
                </span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName}` : 'Unassigned'}
                </span>
              </div>

              {deal && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Briefcase size={14} /> Related Deal:
                  </span>
                  <span className="font-bold text-blue-600 dark:text-blue-400 truncate max-w-[200px]">
                    {deal.title}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
