'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Plus, Search, X, MoreVertical,
  CheckCircle2, Clock, AlertCircle,
  ListTodo, Kanban, ShieldAlert, Users, Trash2, Edit,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import WorkloadView from './workload-view';
import { useData } from '@/store/DataContext';
import { Task, TaskStatus } from '@/store/types';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';
import { TrelloFilter, FilterOption } from '@/shared/components/trello-filter';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ActionableEmptyState } from '@/shared/components/actionable-empty-state';

// ── Constants ──────────────────────────────────────────────────────────────
const COLUMNS: { id: TaskStatus; name: string; color: string }[] = [
  { id: 'pending',     name: 'To Do',       color: 'bg-slate-500/10 text-slate-400' },
  { id: 'in-progress', name: 'In Progress', color: 'bg-blue-500/10 text-blue-400' },
  { id: 'blocked',     name: 'Blocked',     color: 'bg-amber-500/10 text-amber-400' },
  { id: 'completed',   name: 'Completed',   color: 'bg-emerald-500/10 text-emerald-400' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function getDueDateColor(dueDate?: string): string {
  if (!dueDate) return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
  const diff = (new Date(dueDate).getTime() - Date.now()) / (1000 * 3600 * 24);
  if (diff < 0) return 'text-red-500 bg-red-500/10 border-red-500/20';
  if (diff < 3) return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
  return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
}

function getPriorityBadgeColors(p?: 'Low' | 'Medium' | 'High'): string {
  if (p === 'High')   return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-extrabold';
  if (p === 'Medium') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-extrabold';
  return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-extrabold';
}

function getInitials(firstName?: string, lastName?: string): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?';
}

// ── TaskCard (Sortable) ────────────────────────────────────────────────────
interface TaskCardProps {
  task: Task;
  assigneeName: string;
  assigneeInitials: string;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onQuickComplete: (task: Task) => void;
  isDragging?: boolean;
}

function TaskCard({ task, assigneeName, assigneeInitials, onEdit, onDelete, onQuickComplete, isDragging }: TaskCardProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortableDragging } = useSortable({ id: task.id });
  const [menuOpen, setMenuOpen] = useState(false);

  const isOverdue = task.status !== 'completed' && task.status !== 'cancelled' && !!task.dueDate && new Date(task.dueDate) < new Date();

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}
      className={cn(
        'bg-white dark:bg-slate-900 border p-4 rounded-xl transition-all group relative select-none',
        isOverdue ? 'border-red-400/60 dark:border-red-500/40' : 'border-slate-200 dark:border-slate-800/80',
        isDragging && 'shadow-2xl ring-2 ring-blue-500/30',
        !isSortableDragging && 'hover:shadow-md hover:border-blue-500/40',
      )}
    >
      {/* Drag handle + title row */}
      <div className="flex items-start gap-2 mb-2">
        <div {...attributes} {...listeners}
          className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
          aria-label="Drag to reorder"
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>
        </div>
        <h4 onClick={() => onEdit(task)}
          className={cn('text-sm font-bold leading-tight flex-1 cursor-pointer transition-colors',
            task.status === 'completed' ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400',
          )}
        >
          {task.title}
        </h4>
        {/* Context menu */}
        <div className="relative shrink-0">
          <button type="button" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white opacity-0 group-hover:opacity-100 transition-all rounded cursor-pointer"
            aria-label="Task options"
          >
            <MoreVertical size={14} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-20 py-1 overflow-hidden"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button onClick={() => { setMenuOpen(false); onEdit(task); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                  <Edit size={12} /> Edit
                </button>
                <button onClick={() => { setMenuOpen(false); onQuickComplete(task); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                  <CheckCircle2 size={12} /> {task.status === 'completed' ? 'Reopen' : 'Mark done'}
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                <button onClick={() => { setMenuOpen(false); onDelete(task); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors cursor-pointer">
                  <Trash2 size={12} /> Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-3 leading-relaxed pl-4">{task.description}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pl-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('px-2 py-0.5 text-[9px] font-black uppercase rounded-md tracking-wider', getPriorityBadgeColors(task.priority))}>
            {task.priority ?? 'Medium'}
          </span>
          {task.dueDate && (
            <div className={cn('flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border', getDueDateColor(task.dueDate))}>
              <Clock size={9} />
              {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
        <div className="w-6 h-6 rounded-full bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center text-[8px] font-black text-blue-500 border border-blue-500/15 shrink-0"
          title={assigneeName}>
          {assigneeInitials}
        </div>
      </div>

      {isOverdue && (
        <div className="mt-2 flex items-center gap-1 text-[9px] font-bold text-red-500 dark:text-red-400 pl-4">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
          Overdue
        </div>
      )}
    </div>
  );
}

// ── DeleteConfirmModal ─────────────────────────────────────────────────────
interface DeleteConfirmProps {
  task: Task | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmModal({ task, onConfirm, onCancel }: DeleteConfirmProps): React.ReactElement | null {
  if (!task) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onCancel} className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative z-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-rose-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Delete Task</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">This action cannot be undone.</p>
          </div>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 mb-5 leading-relaxed">
          Are you sure you want to delete <span className="font-bold">"{task.title}"</span>?
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="px-4 py-2 text-xs font-extrabold text-white bg-rose-600 hover:bg-rose-500 rounded-xl transition-colors shadow-lg shadow-rose-500/20 cursor-pointer">
            Delete
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── TaskBoard (main) ───────────────────────────────────────────────────────
export default function TaskBoard(): React.ReactElement {
  const { tasks, addTask, updateTask, deleteTask, users } = useData();
  const [view, setView] = useState<'kanban' | 'list' | 'workload'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]);
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);

  // Modal form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAssignedUserId, setFormAssignedUserId] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formStatus, setFormStatus] = useState<TaskStatus>('pending');
  const [formPriority, setFormPriority] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [formReassignReason, setFormReassignReason] = useState('');

  // Delete confirm
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);

  // DnD state
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // ── Memoized derived data ─────────────────────────────────────────────────
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const filteredTasks = useMemo(() => tasks.filter((t) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || (t.title ?? '').toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q);
    const matchPriority = selectedPriorities.length === 0 || selectedPriorities.includes(t.priority ?? 'Medium');
    const matchOwner = selectedOwners.length === 0 || selectedOwners.includes(t.assignedUserId ?? 'unassigned');
    const matchStatus = selectedStatuses.length === 0 || selectedStatuses.includes(t.status);
    return matchSearch && matchPriority && matchOwner && matchStatus;
  }), [tasks, searchQuery, selectedPriorities, selectedOwners, selectedStatuses]);

  const tasksByColumn = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    COLUMNS.forEach((c) => map.set(c.id, []));
    filteredTasks.forEach((t) => {
      const col = map.get(t.status);
      if (col) col.push(t);
    });
    return map;
  }, [filteredTasks]);

  // ── Pagination (list view) ────────────────────────────────────────────────
  const { currentPage, pageSize, totalPages, totalItems, paginateItems, goToPage, setPageSize } = usePagination({
    totalItems: filteredTasks.length,
    initialPageSize: 25,
    resetDeps: [searchQuery, selectedPriorities, selectedOwners, selectedStatuses],
  });
  const paginatedListTasks = paginateItems(filteredTasks);

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openAddModal = useCallback((initialStatus?: TaskStatus) => {
    setEditingTask(null);
    setFormTitle('');
    setFormDescription('');
    setFormAssignedUserId(users[0]?.id ?? '');
    const d = new Date(); d.setDate(d.getDate() + 3);
    setFormDueDate(d.toISOString().split('T')[0]);
    setFormStatus(initialStatus ?? 'pending');
    setFormPriority('Medium');
    setFormReassignReason('');
    setIsModalOpen(true);
  }, [users]);

  const openEditModal = useCallback((task: Task) => {
    setEditingTask(task);
    setFormTitle(task.title ?? '');
    setFormDescription(task.description ?? '');
    setFormAssignedUserId(task.assignedUserId ?? '');
    setFormDueDate(task.dueDate ? task.dueDate.split('T')[0] : '');
    setFormStatus(task.status ?? 'pending');
    setFormPriority(task.priority ?? 'Medium');
    setFormReassignReason('');
    setIsModalOpen(true);
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;
    if (editingTask) {
      const isReassigning = formAssignedUserId !== editingTask.assignedUserId;
      updateTask(editingTask.id, {
        title: formTitle, description: formDescription,
        assignedUserId: formAssignedUserId, dueDate: formDueDate,
        status: formStatus as TaskStatus, priority: formPriority,
        ...(isReassigning && formReassignReason ? { reassignReason: formReassignReason } : {}),
      });
    } else {
      addTask({ title: formTitle, description: formDescription,
        assignedUserId: formAssignedUserId, dueDate: formDueDate,
        status: formStatus as TaskStatus, priority: formPriority });
    }
    setIsModalOpen(false);
  };

  const handleQuickComplete = useCallback((task: Task) => {
    updateTask(task.id, { status: task.status === 'completed' ? 'pending' : 'completed' });
  }, [updateTask]);

  const handleConfirmDelete = useCallback(() => {
    if (!taskToDelete) return;
    deleteTask(taskToDelete.id);
    toast.success(`Task "${taskToDelete.title}" deleted`);
    setTaskToDelete(null);
  }, [taskToDelete, deleteTask]);

  // ── DnD handlers ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }, [tasks]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    // over.id can be a column id (TaskStatus) or a task id
    const overColumn = COLUMNS.find((c) => c.id === over.id);
    if (overColumn && activeTask.status !== overColumn.id) {
      updateTask(activeTask.id, { status: overColumn.id });
    }
  }, [tasks, updateTask]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedTask = tasks.find((t) => t.id === active.id);
    if (!draggedTask) return;

    // If dropped on a column header → status change (already done in dragOver)
    const overColumn = COLUMNS.find((c) => c.id === over.id);
    if (overColumn) return;

    // If dropped on another task → move to that column
    const overTask = tasks.find((t) => t.id === over.id);
    if (overTask && draggedTask.status !== overTask.status) {
      updateTask(draggedTask.id, { status: overTask.status });
    }
  }, [tasks, updateTask]);

  // ── Filter options ────────────────────────────────────────────────────────
  const memberOptions: FilterOption[] = useMemo(() => users.map((u) => ({
    id: u.id,
    label: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
    icon: getInitials(u.firstName, u.lastName),
  })), [users]);

  const statusOptions: FilterOption[] = COLUMNS.map((c) => ({ id: c.id, label: c.name }));

  const priorityOptions: FilterOption[] = [
    { id: 'High',   label: 'High Priority',   color: 'bg-rose-600' },
    { id: 'Medium', label: 'Medium Priority',  color: 'bg-amber-600' },
    { id: 'Low',    label: 'Low Priority',     color: 'bg-blue-600' },
  ];


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Task Management</h1>

        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-start md:justify-end">
          <TooltipProvider>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-md">
              <Tooltip><TooltipTrigger asChild>
                <button onClick={() => setView('kanban')} aria-label="Board view"
                  className={cn('h-7 w-7 flex items-center justify-center rounded transition-colors cursor-pointer',
                    view === 'kanban' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white')}>
                  <Kanban size={13} />
                </button>
              </TooltipTrigger><TooltipContent>Board view</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <button onClick={() => setView('list')} aria-label="List view"
                  className={cn('h-7 w-7 flex items-center justify-center rounded transition-colors cursor-pointer',
                    view === 'list' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white')}>
                  <ListTodo size={13} />
                </button>
              </TooltipTrigger><TooltipContent>List view</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <button onClick={() => setView('workload')} aria-label="Workload view"
                  className={cn('h-7 w-7 flex items-center justify-center rounded transition-colors cursor-pointer',
                    view === 'workload' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white')}>
                  <Users size={13} />
                </button>
              </TooltipTrigger><TooltipContent>Workload view</TooltipContent></Tooltip>
            </div>
            <Tooltip><TooltipTrigger asChild>
              <button onClick={() => openAddModal()} aria-label="New Task"
                className="h-9 w-9 flex items-center justify-center bg-blue-600 text-white rounded-md hover:bg-blue-700 active:scale-95 transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer">
                <Plus size={15} />
              </button>
            </TooltipTrigger><TooltipContent>New Task</TooltipContent></Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Search + Filter toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 py-1">
        <div className="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-xl">
          <div className="relative flex-1 max-w-xs sm:max-w-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search size={14} />
            </div>
            <input type="text" placeholder="Search tasks..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-8 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-900 dark:text-white placeholder:text-slate-400 transition-colors"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
                <X size={14} />
              </button>
            )}
          </div>
          <TrelloFilter
            searchTerm={searchQuery} setSearchTerm={setSearchQuery}
            members={memberOptions} selectedMembers={selectedOwners} setSelectedMembers={setSelectedOwners}
            statuses={statusOptions} selectedStatuses={selectedStatuses} setSelectedStatuses={setSelectedStatuses}
            labelsTitle="Priority Levels" labels={priorityOptions}
            selectedLabels={selectedPriorities} setSelectedLabels={setSelectedPriorities}
          />
        </div>
        <div className="hidden sm:flex items-center -space-x-1.5">
          {users.slice(0, 4).map((u) => (
            <div key={u.id}
              className="w-7 h-7 rounded-full border-2 border-white dark:border-slate-900 bg-blue-100 dark:bg-blue-950/60 flex items-center justify-center text-[10px] font-semibold text-blue-700 dark:text-blue-400"
              title={`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()}>
              {getInitials(u.firstName, u.lastName)}
            </div>
          ))}
          {users.length > 4 && (
            <div className="w-7 h-7 rounded-full border-2 border-white dark:border-slate-900 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-semibold text-slate-600 dark:text-slate-400">
              +{users.length - 4}
            </div>
          )}
        </div>
      </div>


      {/* ── Kanban Board ─────────────────────────────────────────────────── */}
      {view === 'kanban' && (
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <div className="flex-1 overflow-x-auto pb-4 custom-scrollbar">
            <div className="flex gap-4 h-full min-w-[960px]">
              {COLUMNS.map((column) => {
                const colTasks = tasksByColumn.get(column.id) ?? [];
                return (
                  <div key={column.id}
                    className="flex-1 flex flex-col min-w-[240px] bg-slate-50/50 dark:bg-white/[0.01] border border-gray-200 dark:border-white/[0.03] rounded-2xl p-3">
                    {/* Column header */}
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider', column.color)}>
                          {column.name}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">{colTasks.length}</span>
                      </div>
                      <button onClick={() => openAddModal(column.id)}
                        className="p-1 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer rounded"
                        aria-label={`Add task to ${column.name}`}>
                        <Plus size={15} />
                      </button>
                    </div>

                    {/* Drop zone — accept drops from other columns */}
                    <SortableContext items={colTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                      <div className="flex-1 space-y-2.5 overflow-y-auto custom-scrollbar pr-0.5 max-h-[62vh] min-h-[80px]">
                        {colTasks.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-20 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700/50 text-slate-400 dark:text-slate-600 text-xs">
                            Drop tasks here
                          </div>
                        ) : (
                          colTasks.map((task) => {
                            const assignee = userMap.get(task.assignedUserId ?? '');
                            return (
                              <TaskCard
                                key={task.id}
                                task={task}
                                assigneeName={`${assignee?.firstName ?? ''} ${assignee?.lastName ?? ''}`.trim() || 'Unassigned'}
                                assigneeInitials={getInitials(assignee?.firstName, assignee?.lastName)}
                                onEdit={openEditModal}
                                onDelete={(t) => setTaskToDelete(t)}
                                onQuickComplete={handleQuickComplete}
                              />
                            );
                          })
                        )}
                      </div>
                    </SortableContext>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Drag overlay — ghost card while dragging */}
          <DragOverlay>
            {activeTask ? (() => {
              const assignee = userMap.get(activeTask.assignedUserId ?? '');
              return (
                <TaskCard
                  task={activeTask}
                  assigneeName={`${assignee?.firstName ?? ''} ${assignee?.lastName ?? ''}`.trim()}
                  assigneeInitials={getInitials(assignee?.firstName, assignee?.lastName)}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  onQuickComplete={() => {}}
                  isDragging
                />
              );
            })() : null}
          </DragOverlay>
        </DndContext>
      )}


      {/* ── List View ────────────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950/60">
                  <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-widest w-10 text-center">✓</th>
                  <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-widest">Task</th>
                  <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-widest w-24">Priority</th>
                  <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-widest">Assigned To</th>
                  <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-widest w-32">Due Date</th>
                  <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-widest w-28">Stage</th>
                  <th className="px-5 py-3.5 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedListTasks.length > 0 ? paginatedListTasks.map((task) => {
                  const assignee = userMap.get(task.assignedUserId ?? '');
                  const col = COLUMNS.find((c) => c.id === task.status);
                  return (
                    <tr key={task.id} className="hover:bg-slate-50 dark:hover:bg-slate-950/30 transition-colors group">
                      <td className="px-5 py-3.5 text-center">
                        <button onClick={() => handleQuickComplete(task)}
                          className={cn('w-5 h-5 mx-auto rounded border flex items-center justify-center transition-all cursor-pointer',
                            task.status === 'completed'
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-slate-300 dark:border-slate-700 hover:border-blue-500')}>
                          {task.status === 'completed' && <CheckCircle2 size={12} />}
                        </button>
                      </td>
                      <td className="px-5 py-3.5 cursor-pointer" onClick={() => openEditModal(task)}>
                        <p className={cn('text-sm font-bold', task.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white group-hover:text-blue-500')}>
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 line-clamp-1">{task.description}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5 cursor-pointer" onClick={() => openEditModal(task)}>
                        <span className={cn('px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-md tracking-wider', getPriorityBadgeColors(task.priority))}>
                          {task.priority ?? 'Medium'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 cursor-pointer" onClick={() => openEditModal(task)}>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center text-[9px] font-bold text-blue-500 border border-blue-500/15 shrink-0">
                            {getInitials(assignee?.firstName, assignee?.lastName)}
                          </div>
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold truncate max-w-[100px]">
                            {assignee ? `${assignee.firstName ?? ''} ${assignee.lastName ?? ''}`.trim() : 'Unassigned'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 cursor-pointer" onClick={() => openEditModal(task)}>
                        {task.dueDate ? (
                          <span className={cn('text-xs font-bold font-mono px-2 py-0.5 rounded inline-block border', getDueDateColor(task.dueDate))}>
                            {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 cursor-pointer" onClick={() => openEditModal(task)}>
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider', col?.color ?? 'text-slate-400')}>
                          {col?.name ?? task.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEditModal(task)} className="p-1.5 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors rounded cursor-pointer" title="Edit">
                            <MoreVertical size={14} />
                          </button>
                          <button onClick={() => setTaskToDelete(task)} className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors rounded cursor-pointer" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={7} className="py-2">
                      <ActionableEmptyState
                        icon={ListTodo}
                        title={searchQuery ? 'No tasks match your search' : 'No tasks yet'}
                        description={
                          searchQuery
                            ? 'Try a different search term or clear your filters.'
                            : 'Create your first task to start tracking work for your team.'
                        }
                        actionLabel={!searchQuery ? 'Add Task' : undefined}
                        onAction={!searchQuery ? () => openAddModal() : undefined}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-slate-200 dark:border-slate-800">
            <Pagination currentPage={currentPage} totalPages={totalPages} pageSize={pageSize}
              totalItems={totalItems} pageSizeOptions={[10, 25, 50, 100]}
              onPageChange={goToPage} onPageSizeChange={setPageSize} isLoading={false} />
          </div>
        </div>
      )}


      {/* ── Workload View ─────────────────────────────────────────────────── */}
      {view === 'workload' && (
        <div className="bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.06] rounded-2xl p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Team Workload</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Open tasks per team member, sorted by total count</p>
          </div>
          <WorkloadView tasks={tasks} users={users} />
        </div>
      )}

      {/* ── Task Add / Edit Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }} transition={{ duration: 0.18 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl relative z-10 overflow-hidden">
              <form onSubmit={handleSave}>
                {/* Modal header */}
                <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-blue-500" />
                    {editingTask ? 'Edit Task' : 'New Task'}
                  </h3>
                  <button type="button" onClick={() => setIsModalOpen(false)}
                    className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                    <X size={16} />
                  </button>
                </div>

                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                  {/* Title */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Task Title *</label>
                    <input type="text" required value={formTitle} onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="e.g. Schedule post-audit consultation"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-semibold placeholder:font-normal placeholder:text-slate-400" />
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Description</label>
                    <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)}
                      placeholder="Add context or instructions…" rows={3}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none placeholder:text-slate-400" />
                  </div>

                  {/* Priority + Assignee */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Priority</label>
                      <select value={formPriority} onChange={(e) => setFormPriority(e.target.value as 'Low' | 'Medium' | 'High')}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all">
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Assignee</label>
                      <select value={formAssignedUserId} onChange={(e) => setFormAssignedUserId(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all">
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Reassign reason */}
                  {editingTask && formAssignedUserId !== editingTask.assignedUserId && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Reassignment Reason</label>
                      <input type="text" value={formReassignReason} onChange={(e) => setFormReassignReason(e.target.value)}
                        placeholder="e.g. Territory Transfer, Capacity"
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-amber-400/40 dark:border-amber-500/30 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all" />
                      <p className="text-[10px] text-amber-500 dark:text-amber-400">Reassigning — adding a reason keeps the audit trail clean.</p>
                    </div>
                  )}

                  {/* Due Date + Status */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Due Date *</label>
                      <input type="date" required value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Status</label>
                      <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as TaskStatus)}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all">
                        <option value="pending">Pending</option>
                        <option value="in-progress">In Progress</option>
                        <option value="blocked">Blocked</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Modal footer */}
                <div className="p-5 bg-slate-50 dark:bg-slate-950/40 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 rounded-b-2xl">
                  {editingTask && (
                    <button type="button" onClick={() => { setIsModalOpen(false); setTaskToDelete(editingTask); }}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer">
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                  <div className="flex gap-3 ml-auto">
                    <button type="button" onClick={() => setIsModalOpen(false)}
                      className="px-4 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all cursor-pointer">
                      Cancel
                    </button>
                    <button type="submit"
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-extrabold uppercase tracking-wide shadow-lg shadow-blue-500/20 transition-all cursor-pointer">
                      {editingTask ? 'Save Changes' : 'Create Task'}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Delete Confirm ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {taskToDelete && (
          <DeleteConfirmModal
            task={taskToDelete}
            onConfirm={handleConfirmDelete}
            onCancel={() => setTaskToDelete(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
