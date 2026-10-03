"use client";
import { useEffect, useRef, useState } from "react";
import type { TaskListQuery, TaskRecord } from "@leadcrm/shared";
import { TASK_STATUS_LABELS, isTaskOverdue } from "@leadcrm/shared";
import { useHasPermission } from "@/shared/hooks/use-permissions";
import { Button } from "@/shared/components/ui/button";
import { RefreshButton } from "@/shared/components/crm/refresh-button";
import { DataLoadingSkeleton } from "@/shared/components/crm/data-view-states";
import { useTasks } from "../use-tasks";
import { TaskEditor, type TaskLinks } from "./task-editor";

export function RelatedTasks({ links, onCountChange }: { links: TaskLinks; onCountChange?: (count: number | undefined) => void }) {
  const [page, setPage] = useState(1),
    [editor, setEditor] = useState<TaskRecord | "new" | null>(null);
  const canCreate = useHasPermission("tasks.create");
  const query = Object.fromEntries(
    Object.entries(links).filter(([, value]) => !!value),
  ) as TaskListQuery;
  const data = useTasks({ ...query, page, limit: 10 }, true);
  const refreshing = useRef(false);
  useEffect(() => { if (!data.loading) refreshing.current = false; }, [data.loading]);
  const key = JSON.stringify(links) + data.identity;
  useEffect(() => {
    onCountChange?.(data.canRead && !data.loading && !data.error ? data.summary?.total : undefined);
  }, [data.canRead, data.loading, data.error, data.summary?.total, onCountChange]);
  useEffect(() => {
    setPage(1);
    setEditor(null);
  }, [key]);
  useEffect(() => {
    if (data.meta && page > Math.max(1, Math.ceil(data.meta.total / 10)))
      setPage(Math.max(1, Math.ceil(data.meta.total / 10)));
  }, [data.meta, page]);
  if (!data.canRead)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Task access is restricted.
      </p>
    );
  return (
    <div className={onCountChange ? "space-y-3 p-3 sm:p-4" : "space-y-3 p-4"}>
      <div className={onCountChange ? "flex flex-wrap items-center justify-between gap-2" : "flex items-center justify-between gap-2"}>
        <span className="text-xs text-muted-foreground">
          {data.summary
            ? data.summary.total + " tasks · " + data.summary.active + " active"
            : "Tasks"}
        </span>
        <div className="flex gap-2">
          <RefreshButton label="Refresh tasks" refreshing={data.loading} onClick={() => { if (refreshing.current || data.loading) return; refreshing.current = true; data.refresh(); }} />
          {canCreate && (
            <Button
              size="sm"
              variant="default"
              onClick={() => setEditor("new")}
            >
              Add task
            </Button>
          )}
        </div>
      </div>
      {data.loading && !data.tasks.length && <div role="status" aria-label="Loading tasks"><DataLoadingSkeleton rowCount={3} columnCount={1} rowHeight={64} /></div>}
      {data.error && (
        <p role="alert" className="text-sm text-destructive">
          {data.error}
        </p>
      )}
      {!data.loading && !data.error && !data.tasks.length && (
        <p className="text-sm text-muted-foreground">
          No tasks linked to this record.
        </p>
      )}
      <div className="divide-y divide-border">
        {data.tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => setEditor(task)}
            className="block w-full rounded py-3 text-left hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={onCountChange ? "block text-[13px] font-medium [overflow-wrap:anywhere] sm:text-sm" : "block text-sm font-medium"}>{task.title}</span>
            <span className={onCountChange ? "block text-[11px] text-muted-foreground sm:text-xs" : "block text-xs text-muted-foreground"}>
              {TASK_STATUS_LABELS[task.status]} ·{" "}
              {new Date(task.dueDate).toLocaleString()}
            </span>
            {isTaskOverdue(task) && (
              <span className="text-xs text-destructive">Overdue</span>
            )}
          </button>
        ))}
      </div>
      {(data.meta?.total ?? 0) > 10 && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!data.meta?.hasMore}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      )}
      {editor && (
        <TaskEditor
          key={key + (editor === "new" ? "new" : editor.id)}
          task={editor === "new" ? undefined : editor}
          links={links}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
