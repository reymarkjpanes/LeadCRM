"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TASK_STATUSES,
  taskAssociationIds,
  TaskQuerySchema,
  TaskStatusSchema,
  isTaskOverdue,
  type TaskListQuery,
  type TaskPage,
  type TaskSummary,
} from "@leadcrm/shared";
import type { Task } from "@/store/types";
import { subscribePageCacheInvalidation } from "@/shared/cache/page-cache";
import { tasksApi } from "@/shared/services/tasks.api";
import { manilaLocalDateTime, manilaTaskDueInstant } from '@/lib/manila-time';

export function localTaskQuery(
  tasks: Task[],
  input: TaskListQuery,
): { page: TaskPage; summary: TaskSummary } {
  const query = TaskQuerySchema.parse(input);
  const filtered = tasks
    .filter((task) => {
      const status = TaskStatusSchema.parse(task.status);
      return (
        Boolean(task.isArchived) === query.archived &&
        (!query.status || status === query.status) &&
        (!query.priority || task.priority === query.priority) &&
        (!query.assignedUserId ||
          task.assignedUserId === query.assignedUserId) &&
        (!query.leadId ||
          taskAssociationIds(task, "lead").includes(query.leadId)) &&
        (!query.contactId ||
          taskAssociationIds(task, "contact").includes(query.contactId)) &&
        (!query.dealId ||
          taskAssociationIds(task, "deal").includes(query.dealId)) &&
        (!query.accountId ||
          taskAssociationIds(task, "account").includes(query.accountId)) &&
        (query.state !== "active" ||
          !["completed", "cancelled"].includes(status)) &&
        (query.state !== "completed" || status === "completed") &&
        (!query.overdue || isTaskOverdue(task)) &&
        (!query.dueFrom ||
          Date.parse(task.dueDate) >= Date.parse(query.dueFrom)) &&
        (!query.dueTo || Date.parse(task.dueDate) < Date.parse(query.dueTo)) &&
        (!query.search ||
          `${task.title} ${task.description ?? ""}`
            .toLowerCase()
            .includes(query.search.toLowerCase()))
      );
    })
    .map((task) => ({ ...task, status: TaskStatusSchema.parse(task.status) }));
  filtered.sort((a, b) => {
    const aValue = a[query.sortBy] ?? "",
      bValue = b[query.sortBy] ?? "";
    return (
      (query.sortOrder === "asc" ? 1 : -1) * aValue.localeCompare(bValue) ||
      a.id.localeCompare(b.id)
    );
  });
  const byStatus = Object.fromEntries(
    TASK_STATUSES.map((status) => [
      status,
      filtered.filter((task) => task.status === status).length,
    ]),
  ) as TaskSummary["byStatus"];
  const active = filtered.filter(
    (task) =>
      !task.isArchived && !["completed", "cancelled"].includes(task.status),
  );
  const workload = [...new Set(active.map((task) => task.assignedUserId))].map(
    (assignedUserId) => {
      const rows = active.filter(
        (task) => task.assignedUserId === assignedUserId,
      );
      const person = rows[0].assignedUser;
      return {
        assignedUserId,
        name: person ? `${person.firstName} ${person.lastName}` : "Team member",
        pending: rows.filter((task) => task.status === "pending").length,
        inProgress: rows.filter((task) => task.status === "in_progress").length,
        blocked: rows.filter((task) => task.status === "blocked").length,
        overdue: rows.filter((task) => isTaskOverdue(task)).length,
        total: rows.length,
      };
    },
  );
  return {
    page: {
      data: filtered.slice(
        (query.page - 1) * query.limit,
        query.page * query.limit,
      ),
      meta: {
        total: filtered.length,
        page: query.page,
        limit: query.limit,
        hasMore: query.page * query.limit < filtered.length,
      },
    },
    summary: {
      total: filtered.length,
      active: active.length,
      completed: byStatus.completed,
      overdue: active.filter((task) => isTaskOverdue(task)).length,
      byStatus,
      workload,
    },
  };
}

/** One query owner, mounted inside the existing DataProvider. No additional Task store. */
export function useTaskQueries(identity: string, tasks: Task[], mock: boolean) {
  const [tasksRevision, setRevision] = useState(0);
  const owner = useRef({
    identity,
    pages: new Map<string, Promise<TaskPage>>(),
    summaries: new Map<string, Promise<TaskSummary>>(),
  });
  if (owner.current.identity !== identity)
    owner.current = { identity, pages: new Map(), summaries: new Map() };
  const taskRef = useRef(tasks);
  taskRef.current = tasks;
  const refreshTasks = useCallback(() => {
    owner.current.pages.clear();
    owner.current.summaries.clear();
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") refreshTasks();
    };
    const unsubscribe = subscribePageCacheInvalidation((module) => {
      if (["*", "activities", "leads", "contacts", "accounts", "deals"].includes(module)) refreshTasks();
    });
    const timer = window.setInterval(visible, 60000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshTasks]);
  const queryTasks = useCallback(
    (query: TaskListQuery = {}) => {
      if (mock)
        return Promise.resolve(localTaskQuery(taskRef.current, query).page);
      const key = JSON.stringify(TaskQuerySchema.parse(query));
      const cache = owner.current.pages;
      let promise = cache.get(key);
      if (!promise) {
        promise = tasksApi.list(query);
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, promise);
        void promise.catch(() => {
          if (cache.get(key) === promise) cache.delete(key);
        });
      }
      return promise;
    },
    [mock],
  );
  const queryTaskSummary = useCallback(
    (query: TaskListQuery = {}) => {
      if (mock)
        return Promise.resolve(localTaskQuery(taskRef.current, query).summary);
      const key = JSON.stringify(
        TaskQuerySchema.parse({ ...query, page: 1, limit: 25 }),
      );
      const cache = owner.current.summaries;
      let promise = cache.get(key);
      if (!promise) {
        promise = tasksApi.summary(query).then((result) => result.data);
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, promise);
        void promise.catch(() => {
          if (cache.get(key) === promise) cache.delete(key);
        });
      }
      return promise;
    },
    [mock],
  );
  return useMemo(
    () => ({ tasksRevision, refreshTasks, queryTasks, queryTaskSummary }),
    [tasksRevision, refreshTasks, queryTasks, queryTaskSummary],
  );
}

export function localDateTime(value: string): string {
  return manilaLocalDateTime(value);
}
export function taskDueInstant(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)) return manilaTaskDueInstant(value);
  // Persisted ISO instants retain their timezone, including existing API callers.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error('Choose a valid due date and time.');
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("Choose a valid due date and time.");
  return date.toISOString();
}

export { manilaLocalDateTime, manilaCurrentDateTime, manilaCurrentDate, manilaTaskDueInstant, resolveManilaTaskDueDateTime, isPastManilaTaskDueDateTime } from '@/lib/manila-time';
