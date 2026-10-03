"use client";
import { useEffect, useState } from "react";
import type { TaskListQuery, TaskPage, TaskSummary } from "@leadcrm/shared";
import { useAuth } from "@/store/AuthContext";
import { useData } from "@/store/DataContext";
import { useHasPermission } from "@/shared/hooks/use-permissions";

export function useTasks(query: TaskListQuery = {}, preserveOnRefresh = false) {
  const { user, tenant } = useAuth();
  const { queryTasks, queryTaskSummary, tasksRevision, refreshTasks } =
    useData();
  const canRead = useHasPermission("tasks.view");
  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);
  const queryKey = JSON.stringify(query);
  const identity = `${tenant?.id}:${user?.id}:${canRead}`;
  const key = `${identity}:${queryKey}:${tasksRevision}`;
  const [result, setResult] = useState<{
    key: string;
    scope: string;
    page?: TaskPage;
    summary?: TaskSummary;
    error?: string;
  }>();
  useEffect(() => {
    if (!canRead || !tenant) return;
    let current = true;
    const input: TaskListQuery = JSON.parse(queryKey);
    Promise.all([queryTasks(input), queryTaskSummary(input)])
      .then(([page, summary]) => {
        if (current) setResult({ key, scope: identity + queryKey, page, summary });
      })
      .catch((error) => {
        if (current)
          setResult(previous => ({
            ...(preserveOnRefresh && previous?.scope === identity + queryKey ? { page: previous.page, summary: previous.summary } : {}),
            key,
            scope: identity + queryKey,
            error:
              error instanceof Error ? error.message : "Unable to load tasks.",
          }));
      });
    return () => {
      current = false;
    };
  }, [key, queryKey, canRead, tenant, queryTasks, queryTaskSummary, preserveOnRefresh, identity]);
  const visible = result?.key === key || preserveOnRefresh && result?.scope === identity + queryKey ? result : undefined;
  return {
    tasks: visible?.page?.data ?? [],
    meta: visible?.page?.meta,
    summary: visible?.summary,
    error: visible?.error,
    loading: canRead && !!tenant && result?.key !== key,
    canRead,
    refresh: refreshTasks,
    identity,
  };
}
