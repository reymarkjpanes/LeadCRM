"use client";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from 'next/navigation';
import { SelectedRowsBar } from '@/shared/components/crm/selected-rows-bar';

import {
  TASK_COLUMN_DEFINITIONS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  taskDateRange,
  type TaskListQuery,
  type TaskRecord,
  type TaskBulkInput,
  type TaskOption,
} from "@leadcrm/shared";
import { useData } from "@/store/DataContext";
import { useHasPermission } from "@/shared/hooks/use-permissions";
import { USE_MOCK_DATA } from "@/lib/config";
import { tasksApi } from "@/shared/services/tasks.api";
import { ModuleWorkspace } from "@/shared/components/crm/module-workspace";
import { LeadsPagination } from "@/shared/components/crm/leads-pagination";
import { ConfirmActionDialog } from "@/shared/components/crm/confirm-action-dialog";
import { ManageColumnsDrawer } from "@/shared/components/manage-columns-drawer";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import {
  DatePicker,
  TimePicker,
} from "@/shared/components/ui/date-time-picker";
import { TaskTable } from "./task-table";
import { useTaskColumns } from "../use-task-columns";
import { useTasks } from "../use-tasks";
import { manilaLocalDateTime, manilaTaskDueInstant } from "../task-data";
import { TaskEditor, TaskSelector } from "./task-editor";

type Period = "all" | "overdue" | "today" | "week";
const periods = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
];

export default function TaskBoard() {
  const requestedTaskId = useSearchParams().get('taskId');
  const { updateTask, bulkTasks, users } = useData();
  const canCreate = useHasPermission("tasks.create"),
    canEdit = useHasPermission("tasks.edit"),
    canDelete = useHasPermission("tasks.archive");
  const canComplete = useHasPermission("tasks.complete"), canAssign = useHasPermission("tasks.assign");
  const [period, setPeriod] = useState<Period>("all");
  const [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<TaskListQuery>({});
  const [page, setPage] = useState(1),
    [limit, setLimit] = useState(25);
  const [editor, setEditor] = useState<{
    task?: TaskRecord;
    readOnly?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!requestedTaskId || USE_MOCK_DATA) return;
    let active = true;
    tasksApi.get(requestedTaskId).then(response => { if (active) setEditor({ task: response.data, readOnly: true }); })
      .catch(() => { if (active) toast.error('Unable to open this Task.'); });
    return () => { active = false; };
  }, [requestedTaskId]);
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [bulkAction, setBulkAction] = useState<"assign" | "reschedule" | null>(
    null,
  );
  const [archiveIds, setArchiveIds] = useState<string[]>([]);
  const [owner, setOwner] = useState(""),
    [date, setDate] = useState(""),
    [time, setTime] = useState("");
  const [showFilters, setShowFilters] = useState(false),
    [filterSearch, setFilterSearch] = useState("");
  const [owners, setOwners] = useState<TaskOption[]>([]),
    [ownerError, setOwnerError] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const mutationPending = useRef(false),
    refreshPending = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const range =
    period === "today" || period === "week" ? taskDateRange(period) : {};
  const query = {
    ...filters,
    ...range,
    ...(period === "overdue" ? { overdue: true } : {}),
    search: debounced,
    page,
    limit,
  };
  const queryKey = JSON.stringify(query);
  const data = useTasks(query, true);
  const columnPreferences = useTaskColumns(data.identity, data.canRead);
  const identity = useRef(data.identity);
  identity.current = data.identity;
  useEffect(() => {
    if (!data.loading && !data.refreshing) refreshPending.current = false;
  }, [data.loading, data.refreshing]);
  const refresh = () => {
    if (data.loading || data.refreshing || mutationPending.current || refreshPending.current)
      return;
    refreshPending.current = true;
    data.refresh();
  };
  useEffect(() => {
    setSelected([]);
    setBulkAction(null);
    setArchiveIds([]);
  }, [queryKey, data.identity]);
  useEffect(() => {
    if (data.loading || data.error) return;
    const visibleIds = new Set(data.tasks.map((task) => task.id));
    setSelected((previous) => {
      const next = previous.filter((id) => visibleIds.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [data.tasks, data.loading, data.error]);
  useEffect(() => {
    setEditor(null);
    setColumnsOpen(false);
    setShowFilters(false);
    setError("");
    setNotice("");
    setOwners([]);
  }, [data.identity]);
  useEffect(() => {
    if (data.meta && page > Math.max(1, Math.ceil(data.meta.total / limit)))
      setPage(Math.max(1, Math.ceil(data.meta.total / limit)));
  }, [data.meta, page, limit]);
  useEffect(() => {
    if (!showFilters || !data.canRead) return;
    const abort = new AbortController();
    setOwnerError("");
    if (USE_MOCK_DATA) {
      setOwners(
        users
          .filter((user) => user.status.toLowerCase() === "active")
          .map((user) => ({
            id: user.id,
            label: `${user.firstName} ${user.lastName}`,
          })),
      );
      return;
    }
    const timer = setTimeout(() => {
      tasksApi
        .options("user", filterSearch.replace(/^owner:\s*/i, ""), abort.signal)
        .then((response) => {
          if (!abort.signal.aborted) setOwners(response.data);
        })
        .catch((reason) => {
          if (!abort.signal.aborted)
            setOwnerError(
              reason instanceof Error
                ? reason.message
                : "Unable to load task owners.",
            );
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [showFilters, data.canRead, data.identity, filterSearch, users]);

  const change = async (task: TaskRecord) => {
    if (mutationPending.current || !(task.status === "completed" ? canEdit : canComplete) || task.isArchived) return;
    const started = identity.current;
    mutationPending.current = true;
    setBusy(true);
    setError("");
    try {
      await updateTask(task.id, {
        status: task.status === "completed" ? "pending" : "completed",
      });
      if (started === identity.current) setNotice("Task updated.");
    } catch (reason) {
      if (started === identity.current)
        setError(
          reason instanceof Error ? reason.message : "Unable to update task.",
        );
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  };
  let dueDate: string | undefined;
  try {
    if (
      date &&
      time &&
      manilaLocalDateTime(manilaTaskDueInstant(`${date}T${time}`)) === `${date}T${time}`
    )
      dueDate = manilaTaskDueInstant(`${date}T${time}`);
  } catch {
    /* Invalid selections keep Reschedule disabled. */
  }
  const runBulk = async (
    operation: TaskBulkInput["operation"],
    ids = selected,
  ) => {
    if (
      !ids.length ||
      mutationPending.current ||
      (operation === "archive" ? !canDelete : operation === "complete" ? !canComplete : operation === "assign" ? !canAssign : !canEdit)
    )
      return;
    if (
      (operation === "reschedule" && !dueDate) ||
      (operation === "assign" && !owner)
    )
      return;
    mutationPending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const started = identity.current;
    try {
      const request: TaskBulkInput =
        operation === "assign"
          ? { operation, ids, assignedUserId: owner }
          : operation === "reschedule"
            ? { operation, ids, dueDate: dueDate! }
            : { operation, ids };
      const result = await bulkTasks(request);
      if (started !== identity.current) return;
      if (operation === "archive" && result.succeeded.length) toast.success(`${result.succeeded.length} task(s) archived.`);
      setNotice(
        `${result.succeeded.length} task(s) ${operation === "archive" ? "archived" : "updated"}.`,
      );
      setError(
        result.failed
          .map(
            (failure) =>
              `${data.tasks.find((task) => task.id === failure.id)?.title ?? "Task"}: ${failure.error}`,
          )
          .join(" "),
      );
      setSelected((previous) =>
        previous.filter((id) => !result.succeeded.includes(id)),
      );
      setBulkAction(null);
      setArchiveIds(operation === "archive" ? result.failed.map(failure => failure.id) : []);
      if (operation === "archive" && result.failed.length) throw new Error(result.failed.map(failure => failure.error).join(" "));
    } catch (reason) {
      if (started === identity.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to update selected tasks.",
        );
      if (operation === "archive") throw reason;
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  };
  const updateFilter = (values: TaskListQuery) => {
    setFilters((previous) => ({ ...previous, ...values }));
    setPage(1);
  };
  const choosePeriod = (value: string) => {
    setPeriod(value as Period);
    setPage(1);
  };
  const clearFilters = () => {
    setSearch("");
    setFilters({});
    setPeriod("all");
    setPage(1);
  };
  const filterGroups = [
    {
      id: "status",
      label: "Status",
      isExpanded: true,
      items: TASK_STATUSES.map((value) => ({
        id: value,
        label: TASK_STATUS_LABELS[value],
        isChecked: filters.status === value,
      })),
    },
    {
      id: "priority",
      label: "Priority",
      isExpanded: true,
      items: ["Low", "Medium", "High"].map((value) => ({
        id: value,
        label: value,
        isChecked: filters.priority === value,
      })),
    },
    {
      id: "assignedUserId",
      label: "Task owner",
      isExpanded: true,
      items: owners.map((value) => ({
        id: value.id,
        label: `Owner: ${value.label}`,
        isChecked: filters.assignedUserId === value.id,
      })),
    },
    {
      id: "period",
      label: "Due date",
      isExpanded: true,
      items: periods.map((value) => ({
        ...value,
        isChecked: period === value.id,
      })),
    },
    {
      id: "state",
      label: "Task state",
      isExpanded: true,
      items: [
        { id: "all", label: "All task states" },
        { id: "active", label: "Active tasks" },
        { id: "completed", label: "Completed tasks" },
      ].map((value) => ({
        ...value,
        isChecked: (filters.state ?? "all") === value.id,
      })),
    },
    {
      id: "archived",
      label: "Show",
      isExpanded: true,
      items: [
        { id: "current", label: "Current tasks", isChecked: !filters.archived },
        {
          id: "archived",
          label: "Archived tasks",
          isChecked: !!filters.archived,
        },
      ],
    },
  ];
  const toggleFilter = (group: string, value: string) => {
    if (group === "period") choosePeriod(period === value ? "all" : value);
    else if (group === "archived")
      updateFilter({ archived: value === "archived" });
    else if (
      group === "status" ||
      group === "priority" ||
      group === "assignedUserId" ||
      group === "state"
    )
      updateFilter({ [group]: filters[group] === value ? undefined : value });
  };
  const total = data.meta?.total ?? 0;
  if (!data.canRead)
    return (
      <div className="p-8 text-muted-foreground">
        You do not have permission to view tasks.
      </div>
    );
  return (
    <div
      className="min-w-0 max-w-full"
    >
      <ModuleWorkspace
        moduleId="tasks"
        title="Tasks"
        description="Manage follow-ups and sales activities assigned to your team."
        primaryActionLabel="Create Task"
        onPrimaryAction={() => setEditor({})}
        canCreate={canCreate}
        availableViews={["table"]}
        activeView="table"
        onViewChange={() => {}}
        savedTabs={periods}
        activeTab={period}
        onTabChange={choosePeriod}
        searchTerm={search}
        onSearch={setSearch}
        searchPlaceholder="Search tasks..."
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((open) => !open)}
        filterGroups={filterGroups}
        onFilterToggle={toggleFilter}
        filterSearchTerm={filterSearch}
        onFilterSearch={setFilterSearch}
        onClearFilters={clearFilters}
        totalRecords={total}
        onRefresh={refresh}
        refreshLabel="Refresh tasks"
        refreshDisabled={busy || data.loading || data.refreshing}
        loading={data.loading || columnPreferences.loading}
        loadingLabel={data.loading ? "Loading tasks..." : "Loading columns..."}
        onManageColumns={() => setColumnsOpen(true)}
        directManageColumns
      >
        {(error || data.error || ownerError) && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
          >
            {error || data.error || ownerError}
            {data.error && (
              <Button variant="ghost" onClick={refresh}>
                Retry
              </Button>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="mb-2 text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {(!data.error || data.tasks.length > 0) && (
          <>
            <TaskTable
              tasks={data.tasks}
              columns={columnPreferences.columns}
              selected={selected}
              onSelect={setSelected}
              onOpen={(task) => setEditor({ task, readOnly: true })}
              onEdit={(task) => setEditor({ task })}
              onArchive={(task) => setArchiveIds([task.id])}
              onStatus={(task) => void change(task)}
              onSort={updateFilter}
              query={query}
              busy={busy}
              canEdit={canEdit}
              canComplete={canComplete}
              canAssign={canAssign}
              canArchive={canDelete}
              totalRecords={total}
              onManageColumns={() => setColumnsOpen(true)}
            />
            <LeadsPagination
              currentPage={page}
              totalRecords={total}
              pageSize={limit}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setLimit(size);
                setPage(1);
              }}
              disabled={busy || data.loading}
            />
            <p className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>{data.summary?.active ?? 0} active</span>
              <span>{data.summary?.overdue ?? 0} overdue</span>
              <span>{data.summary?.completed ?? 0} completed</span>
            </p>
          </>
        )}
      </ModuleWorkspace>
      <SelectedRowsBar count={selected.length} onClear={() => setSelected([])} disabled={busy}>
            {canComplete && (
                <Button
                  size="sm"
                  disabled={busy || data.loading || !!filters.archived}
                  onClick={() => void runBulk("complete")}
                >
                  Mark as done
                </Button>
            )}
            {canAssign && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || data.loading || !!filters.archived}
                  onClick={() => {
                    setOwner("");
                    setBulkAction("assign");
                  }}
                >
                  Assign
                </Button>
            )}
            {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || data.loading || !!filters.archived}
                  onClick={() => {
                    setDate("");
                    setTime("");
                    setBulkAction("reschedule");
                  }}
                >
                  Reschedule
                </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || data.loading}
                onClick={() => setArchiveIds([...selected])}
              >
                Archive
              </Button>
            )}
      </SelectedRowsBar>
      <Dialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setBulkAction(null);
        }}
      >
        <DialogContent
          className="max-w-md"
          aria-labelledby="task-bulk-title"
          aria-describedby="task-bulk-description"
        >
          <DialogTitle id="task-bulk-title">
            {bulkAction === "assign" ? "Assign tasks" : "Reschedule tasks"}
          </DialogTitle>
          <DialogDescription id="task-bulk-description">
            Update {selected.length} selected task(s). {bulkAction === 'reschedule' && 'Dates and times use Asia/Manila.'}
          </DialogDescription>
          {bulkAction === "assign" ? (
            <TaskSelector
              kind="user"
              label="New owner"
              required
              value={owner}
              onChange={setOwner}
            />
          ) : (
            <div className="grid gap-4">
              <div>
                <label
                  htmlFor="task-reschedule-date"
                  className="mb-1 block text-sm"
                >
                  Due date
                </label>
                <DatePicker
                  id="task-reschedule-date"
                  value={date}
                  onChange={setDate}
                  minDate="0001-01-01"
                />
              </div>
              <div>
                <label
                  htmlFor="task-reschedule-time"
                  className="mb-1 block text-sm"
                >
                  Due time
                </label>
                <TimePicker
                  id="task-reschedule-time"
                  value={time}
                  onChange={setTime}
                />
              </div>
              {date && time && !dueDate && (
                <p role="alert" className="text-sm text-destructive">
                  Choose a valid date and time.
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setBulkAction(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || (bulkAction === "assign" ? !owner : !dueDate)}
              onClick={() => {
                if (bulkAction) void runBulk(bulkAction);
              }}
            >
              {bulkAction === "assign" ? "Confirm assignment" : "Reschedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={archiveIds.length > 0}
        onOpenChange={(open) => {
          if (!open && !busy) setArchiveIds([]);
        }}
        title={archiveIds.length === 1 ? "Archive task?" : "Archive tasks?"}
        description={`Archive ${archiveIds.length} task(s)? They can be restored from Archived Data.`}
        confirmLabel="Archive"
        variant="destructive"
        isLoading={busy}
        onConfirm={() => runBulk("archive", archiveIds)}
      />
      {columnPreferences.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {columnPreferences.error}{" "}
          <button onClick={columnPreferences.retry} className="underline">
            Retry columns
          </button>
        </p>
      )}
      <ManageColumnsDrawer
        isOpen={columnsOpen && !columnPreferences.loading}
        onClose={() => setColumnsOpen(false)}
        module="tasks"
        registry={TASK_COLUMN_DEFINITIONS}
        effectiveColumns={columnPreferences.columns}
        onSave={columnPreferences.save}
        onReset={() =>
          columnPreferences.save(
            TASK_COLUMN_DEFINITIONS.map((column) => ({
              id: column.id,
              visible: column.defaultVisible,
              order: column.defaultOrder,
            })),
          )
        }
      />
      {editor && (
        <TaskEditor
          key={data.identity + (editor.task?.id ?? "new") + editor.readOnly}
          task={editor.task}
          readOnly={editor.readOnly}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
