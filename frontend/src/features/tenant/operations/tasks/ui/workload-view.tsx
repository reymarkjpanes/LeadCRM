'use client';

import React, { useMemo } from 'react';
import { Users } from 'lucide-react';
import type { Task, User } from '@/store/types';

interface WorkloadViewProps {
  tasks: Task[];
  users: User[];
}

interface UserWorkload {
  user: User;
  pending: number;
  inProgress: number;
  overdue: number;
  total: number;
}

export default function WorkloadView({ tasks, users }: WorkloadViewProps) {
  const today = new Date();

  const workloads = useMemo<UserWorkload[]>(() => {
    return users
      .map(u => {
        const userTasks = tasks.filter(
          t => t.assignedUserId === u.id && t.status !== 'cancelled' && t.status !== 'completed',
        );
        const pending    = userTasks.filter(t => t.status === 'pending').length;
        const inProgress = userTasks.filter(t => t.status === 'in_progress').length;
        const overdue    = userTasks.filter(t => t.dueDate && new Date(t.dueDate) < today).length;
        const total      = userTasks.length;
        return { user: u, pending, inProgress, overdue, total };
      })
      .filter(w => w.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [tasks, users]);

  if (workloads.length === 0) {
    return (
      <div className="py-12 text-center text-slate-400 dark:text-slate-500">
        <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No open tasks assigned to any team member.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {workloads.map(({ user, pending, inProgress, overdue, total }) => {
        const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`;
        const maxBar = Math.max(...workloads.map(w => w.total), 1);
        const barWidth = Math.round((total / maxBar) * 100);

        return (
          <div key={user.id}
            className="bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.06] rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-600 dark:text-blue-400 shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-[10px] text-slate-400">{user.role}</p>
              </div>
              {/* Stats badges */}
              <div className="flex items-center gap-1.5 shrink-0">
                {pending > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/[0.05] text-slate-500 dark:text-slate-400">
                    {pending} pending
                  </span>
                )}
                {inProgress > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    {inProgress} active
                  </span>
                )}
                {overdue > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                    {overdue} overdue
                  </span>
                )}
              </div>
            </div>

            {/* Workload bar */}
            <div className="h-1.5 bg-slate-100 dark:bg-white/[0.05] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${overdue > 0 ? 'bg-red-500' : inProgress > 0 ? 'bg-blue-500' : 'bg-slate-400'}`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">{total} open task{total !== 1 ? 's' : ''}</p>
          </div>
        );
      })}
    </div>
  );
}
