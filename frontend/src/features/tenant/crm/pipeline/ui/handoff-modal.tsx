import React, { useState } from 'react';
import { Dialog, DialogContent } from '@/shared/components/ui/dialog';
import { X, Calendar, User, FileText, CheckCircle2 } from 'lucide-react';
import { Deal, User as SystemUser } from '@/store/types';
import { getAssignableAgents } from '@/shared/utils/assigned-agents';

interface HandoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (payload: { handoff: any }) => void;
  deal: Deal;
  users: SystemUser[];
}

export function HandoffModal({ isOpen, onClose, onConfirm, deal, users }: HandoffModalProps) {
  const [assignedUserId, setAssignedUserId] = useState<string>('');
  const [kickoffDate, setKickoffDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm({
      handoff: {
        assignedUserId: assignedUserId || undefined,
        kickoffDate: kickoffDate || undefined,
        notes: notes || undefined,
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
        <DialogContent showClose={false} aria-label="Deal Won: Handoff" className="max-w-lg overflow-hidden flex flex-col p-0 sm:p-0">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-500/10 text-emerald-500 p-2 rounded-xl">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Deal Won: Handoff</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Move {deal.companyName || deal.title} to Customer Lifecycle</p>
              </div>
            </div>
            <button aria-label="Close handoff" onClick={onClose} className="p-2 min-h-11 min-w-11 grid place-items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="min-h-0 flex-1 p-4 sm:p-6 overflow-y-auto custom-scrollbar space-y-6">
            <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
              <p>Great job! Winning this deal will transition the organization to an <strong>Active Customer</strong>.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-2">
                  <User size={16} /> Assign Customer Success/Onboarding Owner
                </label>
                <select
                  value={assignedUserId}
                  onChange={(e) => setAssignedUserId(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">-- Select Owner (Optional) --</option>
                  {getAssignableAgents(users).map(u => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-2">
                  <Calendar size={16} /> Target Kickoff Date
                </label>
                <input
                  type="date"
                  value={kickoffDate}
                  onChange={(e) => setKickoffDate(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-2">
                  <FileText size={16} /> Handoff Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Important details for the onboarding team..."
                  rows={3}
                  className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                />
              </div>
              
            </div>
          </div>

          <div className="shrink-0 p-4 sm:p-6 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-end gap-3 bg-slate-50 dark:bg-slate-800/30">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors shadow-sm shadow-emerald-500/20"
            >
              Confirm Won & Handoff
            </button>
          </div>
        </DialogContent>
    </Dialog>
  );
}
