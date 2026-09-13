'use client';

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  FileText,
  Phone,
  Mail,
  CheckCircle2,
  Calendar,
  Send,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { activitiesService } from '@/features/tenant/crm/activities/services/activities.service';
import type { RecordModule } from '@/shared/hooks/use-record-detail';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/shared/components/ui/tooltip';

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuickActionBarProps {
  module: RecordModule;
  recordId: string;
  onActivityCreated: () => void;
}

type ComposerType = 'note' | 'call' | 'task' | null;

// ─── Call Outcomes ───────────────────────────────────────────────────────────

const CALL_OUTCOMES = [
  { value: 'connected', label: 'Connected' },
  { value: 'left_voicemail', label: 'Left Voicemail' },
  { value: 'no_answer', label: 'No Answer' },
  { value: 'busy', label: 'Busy' },
] as const;

// ─── Action Buttons ──────────────────────────────────────────────────────────

interface ActionButtonDef {
  id: ComposerType | 'email' | 'meeting';
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  requiresComposer: boolean;
}

const ACTION_BUTTONS: ActionButtonDef[] = [
  { id: 'note', label: 'Note', icon: FileText, shortcut: 'N', requiresComposer: true },
  { id: 'call', label: 'Call', icon: Phone, shortcut: 'C', requiresComposer: true },
  { id: 'email', label: 'Email', icon: Mail, shortcut: 'E', requiresComposer: false },
  { id: 'task', label: 'Task', icon: CheckCircle2, shortcut: 'T', requiresComposer: true },
  { id: 'meeting', label: 'Meeting', icon: Calendar, shortcut: 'M', requiresComposer: false },
];

// ─── Note Composer ───────────────────────────────────────────────────────────

function NoteComposer({ onSubmit, onCancel, isSubmitting }: {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}): React.ReactElement {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = (): void => {
    if (!text.trim()) return;
    onSubmit(text.trim());
  };

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a note..."
        rows={3}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none dark:bg-white/[0.02]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Ctrl+Enter to submit</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting} className="h-7 text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!text.trim() || isSubmitting} className="h-7 text-xs gap-1">
            <Send className="h-3 w-3" />
            Add Note
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Call Composer ────────────────────────────────────────────────────────────

function CallComposer({ onSubmit, onCancel, isSubmitting }: {
  onSubmit: (outcome: string, notes: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}): React.ReactElement {
  const [outcome, setOutcome] = useState('connected');
  const [notes, setNotes] = useState('');

  const handleSubmit = (): void => {
    onSubmit(outcome, notes.trim());
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-muted-foreground shrink-0">Outcome:</label>
        <div className="flex flex-wrap gap-1.5">
          {CALL_OUTCOMES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setOutcome(opt.value)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-md border transition-colors',
                outcome === opt.value
                  ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Call notes (optional)..."
        rows={2}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none dark:bg-white/[0.02]"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting} className="h-7 text-xs">
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={isSubmitting} className="h-7 text-xs gap-1">
          <Send className="h-3 w-3" />
          Log Call
        </Button>
      </div>
    </div>
  );
}

// ─── Task Composer ───────────────────────────────────────────────────────────

function TaskComposer({ onSubmit, onCancel, isSubmitting }: {
  onSubmit: (title: string, dueDate: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}): React.ReactElement {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (): void => {
    if (!title.trim()) return;
    onSubmit(title.trim(), dueDate);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title..."
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 dark:bg-white/[0.02]"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === 'Escape') onCancel();
          }}
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-[140px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 dark:bg-white/[0.02]"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting} className="h-7 text-xs">
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!title.trim() || isSubmitting} className="h-7 text-xs gap-1">
          <Send className="h-3 w-3" />
          Add Task
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function QuickActionBar({ module, recordId, onActivityCreated }: QuickActionBarProps): React.ReactElement {
  const [activeComposer, setActiveComposer] = useState<ComposerType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canEdit = useHasPermission('deals.edit');
  const canCreate = useHasPermission('deals.create');

  // Maps the current CRM module to the correct Activity FK field the backend expects.
  // The backend DTO uses individual FK columns (dealId, accountId, leadId) rather than
  // the legacy frontend relatedToType/relatedToId pattern.
  const entityFk = useMemo((): Record<string, string> => {
    switch (module) {
      case 'deals':    return { dealId: recordId };
      case 'accounts': return { accountId: recordId };
      default:         return { leadId: recordId }; // 'leads' and 'contacts' map to Lead FK
    }
  }, [module, recordId]);

  const handleClose = useCallback((): void => {
    setActiveComposer(null);
  }, []);

  const handleButtonClick = useCallback((actionId: string): void => {
    if (actionId === 'email') {
      toast.info('Email composer coming soon');
      return;
    }
    if (actionId === 'meeting') {
      toast.info('Meeting scheduler coming soon');
      return;
    }
    setActiveComposer((prev) => prev === actionId ? null : actionId as ComposerType);
  }, []);

  const handleNoteSubmit = useCallback(async (text: string): Promise<void> => {
    setIsSubmitting(true);
    try {
      await activitiesService.create({
        type: 'note',
        title: text,
        ...entityFk,
      });
      toast.success('Note added');
      setActiveComposer(null);
      onActivityCreated();
    } catch {
      toast.error('Failed to add note');
    } finally {
      setIsSubmitting(false);
    }
  }, [entityFk, onActivityCreated]);

  const handleCallSubmit = useCallback(async (outcome: string, notes: string): Promise<void> => {
    setIsSubmitting(true);
    try {
      await activitiesService.create({
        type: 'call',
        title: `Call — ${outcome}${notes ? `: ${notes}` : ''}`,
        ...entityFk,
        metadata: { outcome },
      });
      toast.success('Call logged');
      setActiveComposer(null);
      onActivityCreated();
    } catch {
      toast.error('Failed to log call');
    } finally {
      setIsSubmitting(false);
    }
  }, [entityFk, onActivityCreated]);

  const handleTaskSubmit = useCallback(async (title: string, dueDate: string): Promise<void> => {
    setIsSubmitting(true);
    try {
      await activitiesService.create({
        type: 'task',
        title,
        ...entityFk,
        metadata: dueDate ? { dueDate: `${dueDate}T00:00:00.000Z` } : undefined,
      });
      toast.success('Task created');
      setActiveComposer(null);
      onActivityCreated();
    } catch {
      toast.error('Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  }, [entityFk, onActivityCreated]);

  if (!canEdit && !canCreate) return <></>;

  return (
    <TooltipProvider>
      <div className="border-b border-border bg-card/50 px-6 py-2">
        {/* Action buttons row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {ACTION_BUTTONS.map((btn) => {
            const Icon = btn.icon;
            const isActive = activeComposer === btn.id;
            return (
              <Tooltip key={btn.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    className={cn('h-7 text-xs gap-1.5', isActive && 'shadow-sm')}
                    onClick={() => handleButtonClick(btn.id as string)}
                  >
                    {isActive ? <X className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                    {btn.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {btn.label} ({btn.shortcut})
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Expandable composer */}
        <AnimatePresence>
          {activeComposer && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="pt-3">
                {activeComposer === 'note' && (
                  <NoteComposer onSubmit={handleNoteSubmit} onCancel={handleClose} isSubmitting={isSubmitting} />
                )}
                {activeComposer === 'call' && (
                  <CallComposer onSubmit={handleCallSubmit} onCancel={handleClose} isSubmitting={isSubmitting} />
                )}
                {activeComposer === 'task' && (
                  <TaskComposer onSubmit={handleTaskSubmit} onCancel={handleClose} isSubmitting={isSubmitting} />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TooltipProvider>
  );
}
