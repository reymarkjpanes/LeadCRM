import type { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  TaskQuerySchema,
  TaskBulkSchema,
  TaskOptionsQuerySchema,
  TaskStatusSchema,
  TASK_LINK_KINDS,
  taskAssociationIds,
  type TaskLinkInput,
  type TaskAssociations,
  type TaskRecord,
  type TaskSummary,
  type TaskBulkResult,
} from "@leadcrm/shared";
import * as repo from "./tasks.repository";
import { hydrateTaskRecords } from './tasks.context';
import { writeAuditLog } from "../../../core/audit/audit.service";
import { tenantContext } from "../../../core/tenant/tenant-context";
import {
  NotFoundError,
  ValidationError,
} from "../../../shared/errors/http-error";
import { AppError } from "../../../shared/errors/app-error";
import { paginate } from "../../../shared/helpers/pagination";

function parseInput<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ValidationError(
      result.error.issues[0]?.message ?? "Invalid task input.",
    );
  return result.data;
}
function requireScope(tenantId: string) {
  if (tenantContext.getStore()?.tenantId !== tenantId)
    throw new ValidationError(
      "A matching CRM tenant context is required for tasks.",
    );
}
function storedLinks(task: repo.TaskRow): TaskAssociations {
  return {
    leadIds: [
      ...new Set([
        ...(task.leadLinks ?? []).map((row) => row.leadId),
      ]),
    ],
    contactIds: [
      ...new Set([
        ...(task.contactLinks ?? []).map((row) => row.contactId),
      ]),
    ],
    dealIds: [
      ...new Set([
        ...(task.dealLinks ?? []).map((row) => row.dealId),
      ]),
    ],
    accountIds: [
      ...new Set([
        ...(task.accountLinks ?? []).map((row) => row.accountId),
      ]),
    ],
  };
}
function splitLinks<T extends TaskLinkInput>(dto: T) {
  const { leadIds, contactIds, dealIds, accountIds, leadId, contactId, dealId, accountId, ...data } = dto;
  const links: TaskAssociations = {};
  for (const kind of TASK_LINK_KINDS) {
    if (dto[`${kind}Ids`] !== undefined || dto[`${kind}Id`] !== undefined) {
      const ids = taskAssociationIds(dto, kind);
      links[`${kind}Ids`] = ids;
    }
  }
  return { data, links };
}
export function serializeTask(task: repo.TaskRow): TaskRecord {
  const lead = task.leadLinks[0]?.lead ?? null;
  const contact = task.contactLinks[0]?.contact ?? null;
  const deal = task.dealLinks[0]?.deal ?? null;
  const account = task.accountLinks[0]?.account ?? null;
  const person = (value: typeof task.assignedUser | null) =>
    value?.tenantId === task.tenantId
      ? { id: value.id, firstName: value.firstName, lastName: value.lastName }
      : null;
  const linkedPerson = (value: typeof lead) =>
    person(value);
  return {
    id: task.id,
    ...storedLinks(task),
    tenantId: task.tenantId,
    title: task.title,
    description: task.description ?? "",
    status: TaskStatusSchema.parse(task.status),
    priority: task.priority as TaskRecord["priority"],
    dueDate: task.dueDate.toISOString(),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    reminderAt: task.reminderAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    completedById: task.completedById,
    assignedUserId: task.assignedUserId,
    assignedById: task.assignedById,
    isArchived: task.isArchived,
    leadId: lead?.id ?? null,
    contactId: contact?.id ?? null,
    dealId: deal?.id ?? null,
    accountId: account?.id ?? null,
    leads: [...new Map((task.leadLinks ?? []).map(row => row.lead)
      .flatMap(row => linkedPerson(row) ?? []).map(row => [row.id, row])).values()],
    contacts: [...new Map((task.contactLinks ?? []).map(row => row.contact)
      .flatMap(row => linkedPerson(row) ?? []).map(row => [row.id, row])).values()],
    deals: [...new Map((task.dealLinks ?? []).map(row => row.deal)
      .filter(
        (row) =>
          row.tenantId === task.tenantId,
      )
      .map(({ id, title }) => [id, { id, title }] as const)).values()],
    accounts: (task.accountLinks ?? [])
      .filter(
        (row) =>
          row.account.tenantId === task.tenantId,
      )
      .map(({ account: { id, name } }) => ({ id, name })),
    account: account?.tenantId === task.tenantId ? { id: account.id, name: account.name } : null,
    assignedUser: person(task.assignedUser),
    assignedByUser: person(task.assignedBy),
    completedBy: person(task.completedBy),
    lead: linkedPerson(lead),
    contact: linkedPerson(contact),
    deal:
      deal?.tenantId === task.tenantId
        ? { id: deal.id, title: deal.title }
        : null,
  };
}
export async function getTasks(
  tenantId: string,
  query: Record<string, unknown>,
) {
  requireScope(tenantId);
  const result = await repo.findAllTasks(
    tenantId,
    parseInput(TaskQuerySchema, query),
  );
  return paginate(
    await hydrateTaskRecords(result.data.map(serializeTask), tenantId),
    result.total,
    result,
  );
}
export async function serializeTaskResponse(task: repo.TaskRow): Promise<TaskRecord> {
  return (await hydrateTaskRecords([serializeTask(task)], task.tenantId))[0];
}
export async function getTaskById(id: string, tenantId: string) {
  requireScope(tenantId);
  const task = await repo.findTaskById(id, tenantId);
  if (!task) throw new NotFoundError("Task");
  return task;
}
async function validateReferences(
  tenantId: string,
  userId: string,
  data: TaskLinkInput & { assignedUserId?: string },
  client: repo.TaskClient,
) {
  if (!(await repo.findTaskUser(userId, tenantId, client)))
    throw new NotFoundError("Active workspace actor");
  if (
    data.assignedUserId &&
    !(await repo.findTaskUser(data.assignedUserId, tenantId, client))
  )
    throw new NotFoundError("Active workspace assignee");
  for (const kind of ["lead", "contact", "deal", "account"] as const) {
    const ids = taskAssociationIds(data, kind);
    if (
      ids.length &&
      (await repo.findTaskLinkIds(kind, ids, tenantId, client)).length !==
        ids.length
    )
      throw new NotFoundError("Related record");
  }
}
function auditState(task: repo.TaskRow) {
  return {
    ...storedLinks(task),
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    assignedUserId: task.assignedUserId,
    assignedById: task.assignedById,
    completedAt: task.completedAt,
    completedById: task.completedById,
    leadId: task.leadLinks[0]?.leadId ?? null,
    contactId: task.contactLinks[0]?.contactId ?? null,
    dealId: task.dealLinks[0]?.dealId ?? null,
    accountId: task.accountLinks[0]?.accountId ?? null,
    isArchived: task.isArchived,
  };
}
export async function createTask(
  tenantId: string,
  userId: string,
  input: unknown,
) {
  requireScope(tenantId);
  const dto = parseInput(CreateTaskSchema, input);
  if (dto.reminderAt)
    throw new ValidationError("Task reminder delivery is not available.");
  const task = await repo.withTaskTransaction(async (client) => {
    await validateReferences(tenantId, userId, dto, client);
    await validateDependentLinks(tenantId, dto, undefined, client);
    const { data, links } = splitLinks(dto);
    const created = await repo.createTask(
      {
        ...data,
        tenantId,
        assignedById: userId,
        ...(dto.status === "completed"
          ? { completedAt: new Date(), completedById: userId }
          : {}),
      },
      client,
    );
    if (!Object.keys(links).length) return created;
    await repo.replaceTaskLinks(created, links, client);
    return (await repo.findTaskById(created.id, tenantId, client))!;
  });
  await writeAuditLog({
    tenantId,
    userId,
    action: "task.created",
    entityType: "Task",
    entityId: task.id,
    after: auditState(task),
  });
  return task;
}
export async function updateTask(
  id: string,
  tenantId: string,
  userId: string,
  input: unknown,
) {
  requireScope(tenantId);
  const { reassignReason, ...dto } = parseInput(UpdateTaskSchema, input);
  const result = await repo.withTaskTransaction(async (client) => {
    const before = await repo.findTaskById(id, tenantId, client);
    if (!before || before.isArchived) throw new NotFoundError("Active task");
    await validateReferences(tenantId, userId, dto, client);
    if (dto.reminderAt && dto.reminderAt !== before.reminderAt?.toISOString())
      throw new ValidationError("Task reminder delivery is not available.");
    await validateDependentLinks(tenantId, dto, before, client);
    const split = splitLinks(dto);
    const data: Prisma.TaskUncheckedUpdateInput = { ...split.data };
    if (dto.assignedUserId && dto.assignedUserId !== before.assignedUserId)
      data.assignedById = userId;
    if (dto.status === "completed" && before.status !== "completed") {
      data.completedAt = new Date();
      data.completedById = userId;
    }
    if (dto.status && dto.status !== "completed") {
      data.completedAt = null;
      data.completedById = null;
    }
    if (
      dto.status === "completed" &&
      before.status === "completed" &&
      Object.keys(dto).length === 1
    )
      return { before, task: before, changed: false };
    let task = await repo.updateTask(id, tenantId, data, client);
    if (Object.keys(split.links).length) {
      await repo.replaceTaskLinks(task, split.links, client);
      task = (await repo.findTaskById(id, tenantId, client))!;
    }
    return { before, task, changed: true };
  });
  if (result.changed)
    await writeAuditLog({
      tenantId,
      userId,
      action:
        dto.status === "completed" && result.before.status !== "completed"
          ? "task.completed"
          : "task.updated",
      entityType: "Task",
      entityId: id,
      before: auditState(result.before),
      after: auditState(result.task),
      ...(reassignReason ? { metadata: { reassignReason } } : {}),
    });
  return result.task;
}
export function completeTask(id: string, tenantId: string, userId: string) {
  return updateTask(id, tenantId, userId, { status: "completed" });
}
export async function archiveTask(
  id: string,
  tenantId: string,
  userId: string,
) {
  requireScope(tenantId);
  const { before, task } = await repo.withTaskTransaction(async (client) => {
    const before = await repo.findTaskById(id, tenantId, client);
    if (!before) throw new NotFoundError("Task");
    await validateReferences(tenantId, userId, {}, client);
    return {
      before,
      task: before.isArchived
        ? before
        : await repo.updateTask(id, tenantId, { isArchived: true }, client),
    };
  });
  if (!before.isArchived)
    await writeAuditLog({
      tenantId,
      userId,
      action: "task.archived",
      entityType: "Task",
      entityId: id,
      before: auditState(before),
      after: auditState(task),
    });
  return task;
}
export async function bulkTasks(
  tenantId: string,
  userId: string,
  input: unknown,
): Promise<TaskBulkResult> {
  requireScope(tenantId);
  const dto = parseInput(TaskBulkSchema, input);
  const result: TaskBulkResult = { succeeded: [], failed: [] };
  for (const id of dto.ids) {
    try {
      if (dto.operation === "archive") await archiveTask(id, tenantId, userId);
      else
        await updateTask(
          id,
          tenantId,
          userId,
          dto.operation === "assign"
            ? { assignedUserId: dto.assignedUserId }
            : dto.operation === "reschedule"
              ? { dueDate: dto.dueDate }
              : { status: "completed" },
        );
      result.succeeded.push(id);
    } catch (error) {
      result.failed.push({
        id,
        error:
          error instanceof AppError
            ? error.message
            : "Could not save this task. Refresh and retry.",
      });
    }
  }
  return result;
}
export async function getTaskSummary(
  tenantId: string,
  input: Record<string, unknown>,
): Promise<TaskSummary> {
  requireScope(tenantId);
  const { statuses, workload, late, users } = await repo.findTaskSummary(
    tenantId,
    parseInput(TaskQuerySchema, input),
  );
  const byStatus: TaskSummary["byStatus"] = {
    pending: 0,
    in_progress: 0,
    blocked: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const row of statuses) {
    const status = TaskStatusSchema.safeParse(row.status);
    if (status.success) byStatus[status.data] += row._count._all;
  }
  const people = new Map(
    users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]),
  );
  const rows = new Map<string, TaskSummary["workload"][number]>();
  for (const entry of workload) {
    const row = rows.get(entry.assignedUserId) ?? {
      assignedUserId: entry.assignedUserId,
      name: people.get(entry.assignedUserId) ?? "Unavailable user",
      pending: 0,
      inProgress: 0,
      blocked: 0,
      overdue: 0,
      total: 0,
    };
    row.total += entry._count._all;
    if (entry.status === "pending") row.pending += entry._count._all;
    if (["in_progress", "in-progress"].includes(entry.status))
      row.inProgress += entry._count._all;
    if (entry.status === "blocked") row.blocked += entry._count._all;
    rows.set(entry.assignedUserId, row);
  }
  for (const entry of late) {
    const row = rows.get(entry.assignedUserId);
    if (row) row.overdue = entry._count._all;
  }
  return {
    total: statuses.reduce((sum, row) => sum + row._count._all, 0),
    active: [...rows.values()].reduce((sum, row) => sum + row.total, 0),
    completed: byStatus.completed,
    overdue: late.reduce((sum, row) => sum + row._count._all, 0),
    byStatus,
    workload: [...rows.values()].sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name),
    ),
  };
}
export async function getTaskOptions(
  tenantId: string,
  input: Record<string, unknown>,
) {
  requireScope(tenantId);
  const query = parseInput(TaskOptionsQuerySchema, input);
  return repo.findTaskOptions(
    tenantId,
    query.kind,
    query.search,
    query.leadIds,
  );
}

/** New plural writes obey the cascading picker; legacy Workflow inputs retain their contract. */
async function validateDependentLinks(
  tenantId: string,
  dto: TaskLinkInput,
  before: repo.TaskRow | undefined,
  client: repo.TaskClient,
) {
  if (!TASK_LINK_KINDS.some((kind) => dto[`${kind}Ids`] !== undefined)) return;
  const effective = {
    ...(before ? storedLinks(before) : {}),
    ...splitLinks(dto).links,
  };
  const leads = effective.leadIds ?? [];
  if (!leads.length) return;
  for (const kind of ["contact", "deal", "account"] as const) {
    const ids = effective[`${kind}Ids`] ?? [];
    if (
      ids.length &&
      (await repo.findTaskLinkIds(kind, ids, tenantId, client, leads))
        .length !== ids.length
    )
      throw new ValidationError(
        "Select only records explicitly linked to the selected leads.",
      );
  }
}
