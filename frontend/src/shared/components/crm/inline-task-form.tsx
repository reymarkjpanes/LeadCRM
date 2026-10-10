'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronsUp } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useData } from '@/store/DataContext';
import { getAssignableAgents } from '@/shared/utils/assigned-agents';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const InlineTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  mode: z.enum(['task', 'call']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  dueDate: z.string().optional(),
  assignedUserId: z.string().optional(),
});

export type InlineTaskFormData = z.infer<typeof InlineTaskSchema>;

// ─── Props ───────────────────────────────────────────────────────────────────

interface InlineTaskFormProps {
  recordName?: string;
  onSubmit: (data: {
    title: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    dueDate?: string;
    assignedUserId?: string;
    type: 'task' | 'call';
  }) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InlineTaskForm({
  recordName,
  onSubmit,
  onCancel,
  isLoading = false,
}: InlineTaskFormProps): React.ReactElement {
  const { users } = useData();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<InlineTaskFormData>({
    resolver: zodResolver(InlineTaskSchema),
    defaultValues: {
      title: '',
      mode: 'task',
      priority: 'MEDIUM',
      dueDate: '',
      assignedUserId: '',
    },
  });

  const mode = watch('mode');
  const priority = watch('priority');
  const isHighPriority = priority === 'HIGH';

  // Pre-fill title when switching to Call mode
  useEffect(() => {
    if (mode === 'call' && recordName) {
      setValue('title', `Call ${recordName}`);
    }
  }, [mode, recordName, setValue]);

  const handleFormSubmit = async (formData: InlineTaskFormData): Promise<void> => {
    await onSubmit({
      title: formData.title,
      priority: formData.priority,
      dueDate: formData.dueDate || undefined,
      assignedUserId: formData.assignedUserId || undefined,
      type: formData.mode,
    });
    reset();
  };

  const handleHighPriorityChange = (checked: boolean): void => {
    setValue('priority', checked ? 'HIGH' : 'MEDIUM');
  };

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      className="space-y-3 rounded-lg border border-border bg-secondary/30 p-4"
    >
      {/* Tab switcher */}
      <div className="flex items-center gap-3 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setValue('mode', 'task')}
          className={cn(
            'text-xs font-semibold uppercase tracking-wider pb-1 transition-colors',
            mode === 'task'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          style={mode === 'task' ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
        >
          Task
        </button>
        <button
          type="button"
          onClick={() => setValue('mode', 'call')}
          className={cn(
            'text-xs font-semibold uppercase tracking-wider pb-1 transition-colors',
            mode === 'call'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          style={mode === 'call' ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
        >
          Call
        </button>
      </div>

      {/* Title */}
      <div>
        <Input
          autoFocus
          placeholder={mode === 'call' ? `Call ${recordName || 'contact'}` : 'Follow up with lead'}
          {...register('title')}
          className={cn('h-9', errors.title && 'border-rose-500 dark:border-rose-500')}
        />
        {errors.title && (
          <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{errors.title.message}</p>
        )}
      </div>

      {/* High Priority checkbox */}
      {mode === 'task' && (
        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Checkbox
            checked={isHighPriority}
            onCheckedChange={handleHighPriorityChange}
          />
          High Priority
          <ChevronsUp className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
        </label>
      )}

      {/* Due date + Assignee */}
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="date"
          {...register('dueDate')}
          className="h-8 text-xs"
        />
        <select
          {...register('assignedUserId')}
          className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground"
        >
          <option value="">Assignee (Default)</option>
          {getAssignableAgents(users).map((user) => (
            <option key={user.id} value={user.id}>
              {user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user.email}
            </option>
          ))}
        </select>
      </div>

      {/* Call mode hint */}
      {mode === 'call' && (
        <p className="text-[11px] text-muted-foreground">
          The task will automatically resolve when call activity is logged.
        </p>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button size="sm" variant="ghost" type="button" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
        )}
        <Button size="sm" type="submit" disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Save Task'}
        </Button>
      </div>
    </form>
  );
}
