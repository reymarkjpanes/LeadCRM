import type { z } from "zod";
import { createHash } from 'node:crypto';
import { Prisma } from "@prisma/client";
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  TaskQuerySchema,
  TaskBulkSchema,
  TaskOptionsQuerySchema,
  StoredTaskStatusSchema,
  taskDisplayStatus,
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
import { recordTaskHistory, taskState } from './tasks.history';
import { crmActor, resolveCrmActor, authorizedWorkflowScope, taskAssigneeInScope, crmReadWhere, mayReadCrmModule } from '../../crm/access/crm-record-access.service';
import { assertEligibleAssignedAgent, TASK_ASSIGNEE_REQUIREMENTS } from '../../crm/access/assigned-agent-eligibility';
import { hasModulePermission } from '@leadcrm/shared';
import { tenantContext } from "../../../core/tenant/tenant-context";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
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
    accountIds: [],
  };
}
function splitLinks<T extends TaskLinkInput>(dto: T) {
  const { leadIds, contactIds, dealIds, accountIds, leadId, contactId, dealId, accountId, ...data } = dto;
  const links: TaskAssociations = {};
  for (const kind of TASK_LINK_KINDS.filter(kind => kind !== 'account')) {
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
    status: StoredTaskStatusSchema.parse(task.status),
    displayStatus: taskDisplayStatus({ ...task, dueDate: task.dueDate.toISOString() }),
    priority: task.priority as TaskRecord["priority"],
    dueDate: task.dueDate.toISOString(),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    reminderAt: task.reminderAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    completedById: task.completedById,
    assignedUserId: task.assignedUserId,
    assignedById: task.assignedById,
    createdById: task.createdById ?? null,
    isArchived: task.isArchived,
    leadId: lead?.id ?? null,
    contactId: contact?.id ?? null,
    dealId: deal?.id ?? null,
    accountId: null,
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
    accounts: [],
    account: null,
    assignedUser: person(task.assignedUser),
    createdBy: person(task.createdBy),
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
  const actor = crmActor.getStore();
  if (actor && !actor.readRecords) return crmActor.run({ ...actor, readRecords: true, readPolicy: undefined }, async () => {
    // Mutation grants do not broaden the related CRM records disclosed in a response.
    const visible = await repo.findTaskById(task.id, task.tenantId);
    if (!visible) throw new NotFoundError('Task');
    return (await hydrateTaskRecords([serializeTask(visible)], task.tenantId))[0];
  });
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
  previousAssignee?: string,
) {
  if (!(await repo.findTaskActor(userId, tenantId, client)))
    throw new NotFoundError("Active workspace actor");
  if (
    data.assignedUserId && data.assignedUserId !== previousAssignee
  ) {
    await assertEligibleAssignedAgent(client, tenantId, data.assignedUserId, TASK_ASSIGNEE_REQUIREMENTS)
      .catch(error => { if (error instanceof ValidationError) throw new NotFoundError("Active eligible workspace assignee"); throw error; });
  }
  for (const kind of ["deal"] as const) {
    const ids = taskAssociationIds(data, kind);
    if (
      ids.length &&
      (await repo.findTaskLinkIds(kind, ids, tenantId, client)).length !==
        ids.length
    )
      throw new NotFoundError("Related record");
  }
}
export async function createTask(
  tenantId: string,
  userId: string,
  input: unknown,
  workflowDeals?: (client: repo.TaskClient) => Promise<string[]>,
) {
  requireScope(tenantId);
  const { requestId, ...parsed } = parseInput(CreateTaskSchema, input);
  const dto = { ...parsed, assignedUserId: parsed.assignedUserId ?? userId };
  const fingerprint = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
  if (dto.reminderAt)
    throw new ValidationError("Task reminder delivery is not available.");
  const task = await repo.withTaskTransaction(async (client) => {
    const workflow = authorizedWorkflowScope(tenantId);
    const readCreatedTask = (id: string) => workflow ? repo.findWorkflowCreatedTask(id, tenantId, userId, client)
      : repo.findTaskById(id, tenantId, client);
    if (requestId) {
      const receipt = await client.auditLog.findFirst({ where: { tenantId, userId, action: 'task.created',
        metadata: { path: ['taskRequestId'], equals: requestId } } });
      if (receipt) {
        if ((receipt.metadata as { requestFingerprint?: string })?.requestFingerprint !== fingerprint) throw new AppError('This Task request was already used with different values.', 409);
        const previous = receipt.entityId ? await readCreatedTask(receipt.entityId) : null;
        if (!previous) throw new AppError('The original Task is unavailable.', 409);
        await authorizeTask(client, tenantId, userId, 'canCreate', {});
        return previous;
      }
    }
    await authorizeTask(client, tenantId, userId, "canCreate", dto);
    if (workflowDeals) {
      const ids = await workflowDeals(client);
      if (JSON.stringify(ids) !== JSON.stringify(taskAssociationIds(dto, 'deal'))) throw new ValidationError('Workflow Deal context changed. Retry this execution.');
    }
    await validateReferences(tenantId, userId, dto, client);
    const { data, links } = splitLinks(dto);
    const created = await repo.createTask(
      {
        ...data,
        tenantId,
        createdById: userId,
        assignedById: userId,
      },
      client,
    );
    await repo.replaceTaskLinks(created, links, client);
    const task = await readCreatedTask(created.id);
    if (!task) throw new NotFoundError('Created Task');
    await recordTaskHistory(client, userId, task, undefined, { ...workflow,
      ...(requestId ? { taskRequestId: requestId, requestFingerprint: fingerprint } : {}) });
    return task;
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
  const { reassignReason, expectedUpdatedAt, ...dto } = parseInput(UpdateTaskSchema, input);
  const result = await repo.withTaskTransaction(async (client) => {
    const before = await repo.findTaskById(id, tenantId, client);
    if (!before || before.isArchived) throw new NotFoundError("Active task");
    await authorizeTask(client, tenantId, userId, "canEdit", dto, before);
    if (expectedUpdatedAt && Date.parse(expectedUpdatedAt) !== before.updatedAt.getTime())
      throw new ConflictError('This Task changed since you opened it. Reload the saved Task before saving your changes.');
    await validateReferences(tenantId, userId, dto, client, before.assignedUserId);
    if (dto.reminderAt && dto.reminderAt !== before.reminderAt?.toISOString())
      throw new ValidationError("Task reminder delivery is not available.");
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
    const candidate = { ...taskState(before), ...split.data, ...split.links };
    if (JSON.stringify(candidate) === JSON.stringify(taskState(before)))
      return { before, task: before, changed: false };
    let task = await repo.updateTask(id, tenantId, data, client);
    if (Object.keys(split.links).length) {
      await repo.replaceTaskLinks(task, split.links, client);
      task = (await repo.findTaskById(id, tenantId, client))!;
    }
    await recordTaskHistory(client, userId, task, before, reassignReason ? { reassignReason } : {});
    return { before, task, changed: true };
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
  const { task } = await repo.withTaskTransaction(async (client) => {
    const before = await repo.findTaskById(id, tenantId, client);
    if (!before) throw new NotFoundError("Task");
    await authorizeTask(client, tenantId, userId, "canArchive", {}, before);
    await validateReferences(tenantId, userId, {}, client);
    const task = before.isArchived ? before : await repo.updateTask(id, tenantId, { isArchived: true }, client);
    await recordTaskHistory(client, userId, task, before);
    return { before, task };
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
  const { statuses, workload, late, users, evaluatedAt, nextStatusChangeAt } = await repo.findTaskSummary(
    tenantId,
    parseInput(TaskQuerySchema, input),
  );
  const byStatus: TaskSummary["byStatus"] = {
    pending: 0,
    in_progress: 0,
    overdue: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const row of statuses) {
    const status = StoredTaskStatusSchema.safeParse(row.status);
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
      overdue: 0,
      total: 0,
    };
    row.total += entry._count._all;
    if (["pending", "blocked"].includes(entry.status)) row.pending += entry._count._all;
    if (["in_progress", "in-progress"].includes(entry.status))
      row.inProgress += entry._count._all;
    rows.set(entry.assignedUserId, row);
  }
  for (const entry of late) {
    const row = rows.get(entry.assignedUserId);
    const status = StoredTaskStatusSchema.parse(entry.status);
    byStatus[status] -= entry._count._all;
    byStatus.overdue += entry._count._all;
    if (row) {
      row.overdue += entry._count._all;
      if (status === 'pending') row.pending -= entry._count._all;
      if (status === 'in_progress') row.inProgress -= entry._count._all;
    }
  }
  return {
    total: statuses.reduce((sum, row) => sum + row._count._all, 0),
    active: [...rows.values()].reduce((sum, row) => sum + row.total, 0),
    completed: byStatus.completed,
    overdue: late.reduce((sum, row) => sum + row._count._all, 0),
    byStatus,
    evaluatedAt,
    nextStatusChangeAt,
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

/** Task grants and association eligibility are enforced in the mutation transaction. */
async function authorizeTask(client: repo.TaskClient, tenantId: string, userId: string,
  action: 'canCreate' | 'canEdit' | 'canArchive', dto: TaskLinkInput & { status?: string; assignedUserId?: string }, before?: repo.TaskRow) {
  const policy = await resolveCrmActor(client, { tenantId, userId });
  const system = authorizedWorkflowScope(tenantId);
  if (!system && before && !taskAssigneeInScope(policy, before.assignedUserId))
    throw new NotFoundError('Task');
  if (!system && !policy.clientAdmin && action !== 'canCreate' && !policy.taskAssignmentRestricted && (!before?.createdById || before.createdById !== userId))
    throw new AppError(action === 'canArchive' ? 'Only the task owner can archive this task.' : 'Only the task owner can edit this task.', 403);
  if (!system && dto.assignedUserId !== undefined && !taskAssigneeInScope(policy, dto.assignedUserId))
    throw new AppError('You cannot assign Tasks outside your authorized team.', 403);
  const permitted = (flag: 'canCreate' | 'canEdit' | 'canArchive' | 'canAssign' | 'canComplete') => {
    if (!policy.clientAdmin && !hasModulePermission(policy.permissions, 'tasks', flag)) throw new AppError('Access denied', 403);
  };
  const fields = Object.keys(dto);
  const actionOnly = before && fields.length > 0 && fields.every(field => field === 'assignedUserId' || field === 'status' && dto.status === 'completed');
  if (!actionOnly) permitted(action);
  if (system) permitted('canAssign');
  if (dto.assignedUserId !== undefined && dto.assignedUserId !== (before?.assignedUserId ?? userId)) permitted('canAssign');
  if (dto.status === 'completed' && before?.status !== 'completed') permitted('canComplete');
  if (dto.dealId !== undefined || dto.dealIds !== undefined) {
    if (!await mayReadCrmModule(client, tenantId, 'deals')) throw new AppError('Access denied', 403);
    const ids = taskAssociationIds(dto, 'deal');
    const previous = before?.dealLinks.map(row => row.dealId) ?? [];
    // Removing a Deal is an association mutation too; recheck both sides.
    const checked = [...new Set([...ids, ...previous])];
    const deals = await client.deal.findMany({ where: { tenantId, id: { in: checked },
      ...(!system ? { AND: [await crmReadWhere(client, tenantId, 'deals')] } : {}),
    }, select: { id: true, assignedUserId: true } });
    if (deals.length !== checked.length) throw new NotFoundError('Related Deal');
    if (!system && (policy.taskManager ? deals.some(deal => !deal.assignedUserId || !taskAssigneeInScope(policy, deal.assignedUserId))
      : policy.taskAssignmentRestricted && deals.some(deal => deal.assignedUserId !== userId)))
      throw new AppError('You can only associate tasks with Deals assigned to you.', 403, 'CRM_ASSIGNMENT_REQUIRED');
  }
}

export async function restoreTask(id: string, tenantId: string, userId: string) {
  requireScope(tenantId);
  return repo.withTaskTransaction(async client => {
    const before = await repo.findTaskById(id, tenantId, client);
    if (!before || !before.isArchived) throw new NotFoundError('Archived task');
    const policy = await resolveCrmActor(client, { tenantId, userId });
    if (!taskAssigneeInScope(policy, before.assignedUserId)) throw new NotFoundError('Archived task');
    if (!policy.clientAdmin && (!hasModulePermission(policy.permissions, 'archived_data', 'canRestore') || !hasModulePermission(policy.permissions, 'tasks', 'canView'))) throw new AppError('Access denied', 403);
    const task = await repo.updateTask(id, tenantId, { isArchived: false }, client);
    await recordTaskHistory(client, userId, task, before);
    return task;
  });
}

export async function getTaskOptionsPage(tenantId: string, input: Record<string, unknown>) {
  requireScope(tenantId);
  const query = parseInput(TaskOptionsQuerySchema, input);
  return repo.findFilteredDealOptions(tenantId, query);
}
