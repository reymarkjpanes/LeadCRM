"use client";
import type { ReactNode } from "react";
import {
  TASK_COLUMN_DEFINITIONS,
  TASK_STATUS_LABELS,
  isTaskOverdue,
  type ColumnConfigItem,
  type TaskRecord,
  type TaskListQuery,
} from "@leadcrm/shared";
import {
  DataGrid,
  useDataGridColumns,
  type CellRendererMap,
} from "@/shared/components/data-grid";
import { Eye, Edit, Archive } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';
import { taskRecordOptions } from '../task-relations';
interface Props {
  tasks: TaskRecord[];
  columns: ColumnConfigItem[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  onOpen: (task: TaskRecord) => void;
  onStatus: (task: TaskRecord) => void;
  onSort: (query: TaskListQuery) => void;
  query: TaskListQuery;
  busy: boolean;
  canEdit: boolean;
  canComplete?: boolean;
  canAssign?: boolean;
  canArchive: boolean;
  onEdit: (task: TaskRecord) => void;
  onArchive: (task: TaskRecord) => void;
  totalRecords: number;
  onManageColumns: () => void;
}
export function TaskTable({
  tasks,
  columns,
  selected,
  onSelect,
  onOpen,
  onStatus,
  onSort,
  query,
  busy,
  canEdit, canComplete = false, canAssign = false,
  canArchive,
  onEdit,
  onArchive,
  totalRecords,
  onManageColumns,
}: Props) {
  const selectable = canEdit || canArchive || canComplete || canAssign;
  const relation = (text?: string | null, context?: string) =>
    text ? (
      <span
        className="inline-flex max-w-48 truncate rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
        title={context ?? text}
      >
        {text}
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  const person = (value?: { firstName: string; lastName: string } | null) =>
    value ? value.firstName + " " + value.lastName : undefined;
  const relations = (task: TaskRecord, kind: 'lead' | 'contact' | 'deal' | 'account') => {
    const direct = taskRecordOptions(task, kind);
    const context = (task.relatedRecords ?? []).filter(row => row.kind === kind && !direct.some(option => option.id === row.id));
    const labels = [...direct.map(row => row.label), ...context.map(row => row.label)];
    return (
      <span className="inline-flex min-w-0 items-center gap-1" title={context.length ? context.map(row => `${row.label} — via ${row.via}`).join('\n') : undefined}>
        {relation(labels[0], !direct.length && context[0] ? `${context[0].label} — via ${context[0].via}` : undefined)}
        {labels.length > 1 && (
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
            aria-label={`View all ${labels.length} related records: ${labels.join(", ")}`}
            title={labels.join(", ")}
          >
            +{labels.length - 1}
          </button>
        )}
      </span>
    );
  };
  const cell = (task: TaskRecord, id: string): ReactNode => {
    switch (id) {
      case "action":
        return (task.status === "completed" ? canEdit : canComplete) && !task.isArchived ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-lg px-2.5 font-normal"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onStatus(task);
            }}
          >
            {task.status === "completed" ? "Reopen" : "Done"}
          </Button>
        ) : (
          "—"
        );
      case "title":
        return (
          <button
            onClick={() => onOpen(task)}
            className="max-w-72 truncate text-left text-[13px] font-medium text-[#1a73e8] dark:text-blue-400 hover:underline"
            title={task.title}
          >
            {task.title}
          </button>
        );
      case "status":
        return (
          <span className="rounded-full bg-secondary px-2 py-1 text-xs">
            {TASK_STATUS_LABELS[task.status]}
          </span>
        );
      case "priority":
        return (
          <span
            className={
              task.priority === "High"
                ? "text-destructive"
                : "text-muted-foreground"
            }
          >
            {task.priority ?? "Medium"}
          </span>
        );
      case "dueDate":
        return (
          <span
            className={
              "inline-flex items-center gap-2 " +
              (isTaskOverdue(task) ? "text-destructive" : "")
            }
          >
            {isTaskOverdue(task) && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-destructive"
                aria-label="Overdue"
              />
            )}
            {new Date(task.dueDate).toLocaleString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        );
      case "lead":
      case "contact":
      case "deal":
      case "account":
        return relations(task, id);
      case "assignedUser":
        return person(task.assignedUser) ?? "—";
      case "createdAt":
        return <span title={formatDateTime(task.createdAt, { seconds: true })}>{formatDateTime(task.createdAt, { seconds: true })}</span>;
      case "completedAt":
        return task.completedAt
          ? new Date(task.completedAt).toLocaleString()
          : "—";
      default:
        return "—";
    }
  };
  const cellRenderers: CellRendererMap<TaskRecord> = Object.fromEntries(
    TASK_COLUMN_DEFINITIONS.map(({ id }) => [
      id,
      (_value: unknown, task: TaskRecord) => cell(task, id),
    ]),
  );
  const { gridColumns } = useDataGridColumns<TaskRecord>({
    registry: TASK_COLUMN_DEFINITIONS,
    effectiveColumns: columns,
    cellRenderers,
    sortableColumns: ["title", "dueDate", "createdAt"],
    defaultWidths: {
      action: 100,
      title: 250,
      status: 145,
      priority: 120,
      dueDate: 240,
      createdAt: 230,
    },
  });
  return (
    <DataGrid<TaskRecord>
      columns={gridColumns}
      data={tasks}
      getRowId={(task) => task.id}
      height="auto"
      selectable={selectable}
      selectedIds={new Set(selected)}
      onSelectionChange={(ids) => {
        if (!busy) onSelect([...ids]);
      }}
      onRowClick={onOpen}
      sortingMode="external"
      sort={{
        field: query.sortBy ?? "createdAt",
        direction: query.sortOrder ?? "desc",
      }}
      onSortChange={(sort) =>
        onSort({
          sortBy: (sort?.field ?? "createdAt") as TaskListQuery["sortBy"],
          sortOrder: sort?.direction ?? "desc",
        })
      }
      rowActions={(task) => [
        {
          id: "view",
          label: "View",
          icon: <Eye size={14} />,
          onClick: () => onOpen(task),
        },
        {
          id: "edit",
          label: "Edit",
          icon: <Edit size={14} />,
          disabled: busy || !canEdit || !!task.isArchived,
          onClick: () => onEdit(task),
        },
        {
          id: "archive",
          label: "Archive",
          icon: <Archive size={14} />,
          separator: true,
          disabled: busy || !canArchive || !!task.isArchived,
          onClick: () => onArchive(task),
        },
      ]}
      onSettingsClick={onManageColumns}
      summaryLabel={`${totalRecords} total records`}
      emptyMessage="No tasks match these filters. Try a different date, status, or search."
      ariaLabel="Tasks data grid"
      viewMode="clip"
    />
  );
}
