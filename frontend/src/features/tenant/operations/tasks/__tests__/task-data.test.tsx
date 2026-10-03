import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  TaskBulkSchema,
  TaskQuerySchema,
  TaskStatusSchema,
  isTaskOverdue,
  taskDateRange,
} from "@leadcrm/shared";
import type { Task } from "@/store/types";
const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn() }));
vi.mock("@/shared/services/tasks.api", () => ({ tasksApi: api }));
import {
  localTaskQuery,
  taskDueInstant,
  localDateTime,
  useTaskQueries,
} from "../task-data";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const task: Task = {
  id: "task",
  tenantId: "tenant",
  title: "Follow up",
  description: "",
  status: "pending",
  dueDate: "2020-01-01T10:30:00.000Z",
  createdAt: "2020-01-01T00:00:00.000Z",
  assignedUserId: "owner",
};
describe("Task contract and calendar rules", () => {
  it("normalizes only the intentional status alias and rejects blank titles and unsupported fields", () => {
    expect(TaskStatusSchema.parse("in-progress")).toBe("in_progress");
    expect(
      CreateTaskSchema.safeParse({
        title: " ",
        assignedUserId: "owner",
        dueDate: task.dueDate,
      }).success,
    ).toBe(false);
    expect(UpdateTaskSchema.safeParse({ tenantId: "foreign" }).success).toBe(
      false,
    );
    expect(TaskQuerySchema.safeParse({ status: "unknown" }).success).toBe(
      false,
    );
    expect(TaskQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      TaskBulkSchema.safeParse({ operation: "complete", ids: [] }).success,
    ).toBe(false);
  });
  it("preserves date and time and constructs half-open local calendar boundaries", () => {
    const input = "2026-09-27T21:30";
    expect(localDateTime(taskDueInstant(input))).toBe(input);
    expect(localDateTime(taskDueInstant("2026-09-27"))).toBe(
      "2026-09-27T17:00",
    );
    const day = taskDateRange("today", new Date(2026, 8, 27, 23, 59));
    expect(new Date(day.dueFrom).getHours()).toBe(0);
    expect(new Date(day.dueTo).getDate()).toBe(28);
    const week = taskDateRange("week", new Date(2026, 8, 27));
    expect(new Date(week.dueFrom).getDay()).toBe(1);
    expect(new Date(week.dueTo).getDay()).toBe(1);
  });
  it("excludes completed, cancelled and archived records from overdue", () => {
    expect(isTaskOverdue(task)).toBe(true);
    for (const status of ["completed", "cancelled"])
      expect(isTaskOverdue({ ...task, status })).toBe(false);
    expect(isTaskOverdue({ ...task, isArchived: true })).toBe(false);
  });
});
describe("Task query owner", () => {
  it("paginates beyond 100 and keeps counts independent of the current page", () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({
      ...task,
      id: String(index).padStart(3, "0"),
      leadId: "lead",
    }));
    const result = localTaskQuery(rows, {
      page: 2,
      limit: 100,
      leadId: "lead",
    });
    expect(result.page.data).toHaveLength(25);
    expect(result.summary).toMatchObject({
      total: 125,
      active: 125,
      overdue: 125,
    });
    expect(
      localTaskQuery(rows, { leadId: "same-name-different-id" }).page.meta
        .total,
    ).toBe(0);
    expect(
      localTaskQuery([{ ...task, status: "completed" }], {
        status: "completed",
        overdue: true,
      }).page.data,
    ).toEqual([]);
  });
  it("deduplicates requests, invalidates after mutation, and isolates identities", async () => {
    api.list.mockResolvedValue({ data: [task], meta: { total: 1 } });
    const { result, rerender } = renderHook(
      ({ identity }) => useTaskQueries(identity, [], false),
      { initialProps: { identity: "tenant-a:user" } },
    );
    const first = result.current.queryTasks({});
    expect(result.current.queryTasks({})).toBe(first);
    await first;
    expect(api.list).toHaveBeenCalledOnce();
    act(() => result.current.refreshTasks());
    await result.current.queryTasks({});
    expect(api.list).toHaveBeenCalledTimes(2);
    rerender({ identity: "tenant-b:user" });
    await result.current.queryTasks({});
    expect(api.list).toHaveBeenCalledTimes(3);
  });
  it("propagates read failures and permits a retry", async () => {
    api.list
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce({ data: [], meta: { total: 0 } });
    const { result } = renderHook(() =>
      useTaskQueries("tenant-a:user", [], false),
    );
    await expect(result.current.queryTasks()).rejects.toThrow("Unavailable");
    await expect(result.current.queryTasks()).resolves.toMatchObject({
      data: [],
    });
  });
});

it("validates bounded multiple links and finds tasks through secondary links",()=>{
  expect(UpdateTaskSchema.parse({leadIds:["a","a","b"]}).leadIds).toEqual(["a","b"]);
  expect(UpdateTaskSchema.safeParse({leadId:"a",leadIds:["b"]}).success).toBe(false);
  expect(UpdateTaskSchema.safeParse({leadIds:Array.from({length:51},(_,i)=>String(i))}).success).toBe(false);
  const result=localTaskQuery([{...task,leadId:"a",leadIds:["a","b"]}],{leadId:"b"});
  expect(result.page.data).toHaveLength(1);
  expect(result.summary.total).toBe(1);
  expect(localTaskQuery([{...task,leadId:null,leadIds:[]}],{leadId:"b"}).page.data).toHaveLength(0);
});
