import React from 'react';
import { Send } from 'lucide-react';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

interface LeadEmailTabProps {
  leadEmail: string;
  templates: EmailTemplate[];
  emailSubject: string;
  emailBody: string;
  selectedTemplateId: string;
  isSending: boolean;
  onApplyTemplate: (id: string) => void;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSend: (e: React.FormEvent) => void;
}

export function LeadEmailTab({
  leadEmail,
  templates,
  emailSubject,
  emailBody,
  selectedTemplateId,
  isSending,
  onApplyTemplate,
  onSubjectChange,
  onBodyChange,
  onSend,
}: LeadEmailTabProps) {
  return (
    <div className="space-y-4 text-left animate-in fade-in duration-100">
      {/* Template selector */}
      <div className="bg-slate-50 dark:bg-white/[0.01] border border-gray-200 dark:border-white/[0.03] p-3 rounded-lg text-xs space-y-1">
        <span className="font-semibold block text-slate-400 uppercase text-[9px] tracking-wider">
          Select templates
        </span>
        <div className="flex flex-wrap gap-1.5">
          {templates.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onApplyTemplate(t.id)}
              className={`text-[10px] px-2.5 py-1 rounded border transition-colors ${
                selectedTemplateId === t.id
                  ? 'bg-primary/10 border-primary/30 text-blue-400'
                  : 'bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border-gray-200 dark:border-white/5 text-slate-700 dark:text-slate-300'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Compose form */}
      <form onSubmit={onSend} className="space-y-3.5">
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase select-none mb-1">
            Outbound Email Address
          </label>
          <input
            type="text"
            readOnly
            value={leadEmail}
            className="w-full bg-gray-100 dark:bg-white/[0.01] opacity-75 border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-1.5 text-xs text-slate-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
            Subject Header
          </label>
          <input
            type="text"
            required
            placeholder="Brief email subject line..."
            value={emailSubject}
            onChange={e => onSubjectChange(e.target.value)}
            className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
            Message Body
          </label>
          <textarea
            rows={6}
            required
            placeholder="Enter email content..."
            value={emailBody}
            onChange={e => onBodyChange(e.target.value)}
            className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.05] rounded-lg p-3 text-xs text-slate-900 dark:text-white focus:outline-none resize-none font-sans"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSending}
            className="bg-primary hover:bg-primary/90 font-semibold text-white px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <Send size={13} />
            {isSending ? 'Sending Dispatch...' : 'Dispatch Email'}
          </button>
        </div>
      </form>
    </div>
  );
}
