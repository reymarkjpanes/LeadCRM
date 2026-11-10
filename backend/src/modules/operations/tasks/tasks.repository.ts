import { AppError } from '../../../shared/errors/app-error';
import { setNotificationActor } from '../../notifications/notification-actor';
import { Prisma } from "@prisma/client";
import {
  TaskQuery,
  TaskOptionKind,
  TaskAssociations,
  TaskLinkKind,
  hasModulePermission,
} from "@leadcrm/shared";
import { NotFoundError } from "../../../shared/errors/http-error";
import prisma from "../../../config/database.config";
import { ConflictError } from "../../../shared/errors/http-error";
import { isCrmTransactionConflict, crmActor, resolveCrmActor, taskReadWhere, taskAssigneeInScope, authorizedWorkflowScope, crmReadWhere, mayReadCrmModule, readWorkflowCreatedTask } from '../../crm/access/crm-record-access.service';
import { eligibleAssignedAgents, TASK_ASSIGNEE_REQUIREMENTS } from '../../crm/access/assigned-agent-eligibility';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import { fenceWorkflowLease } from '../../automation/workflows/workflow-lease';

export type TaskClient = Prisma.TransactionClient;
const person = {
  id: true,
  firstName: true,
  lastName: true,
  tenantId: true,
} as const;
export const taskInclude = {
  leadLinks: {
    orderBy: [{ position: "asc" }, { leadId: "asc" }],
    include: { lead: { select: { ...person } } },
  },
  contactLinks: {
    orderBy: [{ position: "asc" }, { contactId: "asc" }],
    include: { contact: { select: { ...person } } },
  },
  dealLinks: {
    orderBy: [{ position: "asc" }, { dealId: "asc" }],
    include: {
      deal: {
        select: { id: true, title: true, tenantId: true },
      },
    },
  },
  assignedUser: { select: person },
  createdBy: { select: person },
  assignedBy: { select: person },
  completedBy: { select: person },
} satisfies Prisma.TaskInclude;
export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** One batch per source kind; never infer connections from names or company text. */
export async function findTaskRecordContext(tenantId: string, ids: Required<Omit<TaskAssociations, 'accountIds'>>, client: TaskClient = prisma) {
  const account = { id: true, name: true, tenantId: true } as const;
  const deal = { id: true, title: true, tenantId: true } as const;
  const [leads, contacts, deals] = await Promise.all([
    ids.leadIds.length ? client.lead.findMany({
      where: { tenantId, id: { in: ids.leadIds } },
      select: { ...person, account: { select: account }, convertedContact: { select: person },
        leadDeals: { where: { tenantId }, select: { deal: { select: deal } } } },
    }) : [],
    ids.contactIds.length ? client.contact.findMany({
      where: { tenantId, id: { in: ids.contactIds } },
      select: { ...person, account: { select: account },
        convertedFromLeads: { where: { tenantId }, select: person },
        contactDeals: { where: { tenantId }, select: { deal: { select: deal } } } },
    }) : [],
    ids.dealIds.length ? client.deal.findMany({
      where: { tenantId, id: { in: ids.dealIds } },
      select: { ...deal, organization: { select: account },
        leadDeals: { where: { tenantId }, select: { lead: { select: { ...person, contactId: true, convertedAt: true } } } },
        contactDeals: { where: { tenantId }, select: { contact: { select: person } } } },
    }) : [],
  ]);
  return { leads, contacts, deals };
}

export async function withTaskTransaction<T>(
  work: (client: TaskClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(async tx => {
      await fenceWorkflowLease(tx);
      await setNotificationActor(tx);
      return work(tx);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (isCrmTransactionConflict(error)) {
      throw new ConflictError(
        "This task changed while you were editing. Refresh and try again.",
      );
    }
    throw error;
  }
}

export function taskWhere(
  tenantId: string,
  query: TaskQuery,
  now = new Date(),
): Prisma.TaskWhereInput {
  const AND: Prisma.TaskWhereInput[] = [];
  const overdue: Prisma.TaskWhereInput = {
    isArchived: false, dueDate: { lt: now }, status: { notIn: ["completed", "cancelled"] },
  };
  if (query.status === "overdue") AND.push(overdue);
  else if (query.status) {
    AND.push({
      status:
        query.status === "in_progress"
          ? { in: ["in_progress", "in-progress"] }
          : query.status === "pending" ? { in: ["pending", "blocked"] } : query.status,
    });
    if (["pending", "in_progress"].includes(query.status)) AND.push({ NOT: overdue });
  }
  if (query.state === "active")
    AND.push({ status: { notIn: ["completed", "cancelled"] } });
  if (query.state === "completed") AND.push({ status: "completed" });
  if (query.overdue)
    AND.push({
      isArchived: false,
      dueDate: { lt: now },
      status: { notIn: ["completed", "cancelled"] },
    });
  if (query.dueFrom || query.dueTo)
    AND.push({
      dueDate: {
        ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
        ...(query.dueTo ? { lt: new Date(query.dueTo) } : {}),
      },
    });
  for (const kind of ["lead", "contact", "deal", "account"] as const) {
    const id = query[`${kind}Id`];
    if (id) AND.push(taskContextWhere(kind, id, tenantId));
  }
  AND.push(...buildSearchClauses(query.search, ['title', 'description']));
  return {
    tenantId,
    isArchived: query.archived,
    AND,
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
  };
}
export async function findAllTasks(tenantId: string, query: TaskQuery) {
  const where = taskWhere(tenantId, query);
  if (query.sortBy === 'title') {
    return prisma.$transaction(async tx => {
      const ids = await sortedPageIds(`title:${query.sortOrder}`, ['title'], (query.page - 1) * query.limit, query.limit,
        () => tx.task.findMany({ where, select: { id: true, title: true } }));
      const [data, total] = await Promise.all([
        tx.task.findMany({ where: { ...where, id: { in: ids ?? [] } }, include: taskInclude }),
        tx.task.count({ where }),
      ]);
      return { data: orderPage(data, ids), total, page: query.page, limit: query.limit };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  const [data, total] = await prisma.$transaction(
    [
      prisma.task.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
        include: taskInclude,
      }),
      prisma.task.count({ where }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return { data, total, page: query.page, limit: query.limit };
}
export async function findTaskById(
  id: string,
  tenantId: string,
  client: TaskClient = prisma,
) {
  const actor = crmActor.getStore();
  const scope = actor && !authorizedWorkflowScope(tenantId) ? taskReadWhere(await resolveCrmActor(client, actor)) : {};
  return client.task.findFirst({
    where: { id, tenantId, AND: [scope] },
    include: taskInclude,
  });
}

export function findWorkflowCreatedTask(id: string, tenantId: string, createdById: string, client: TaskClient) {
  return readWorkflowCreatedTask(tenantId, id, createdById, () => client.task.findFirst({
    where: { id, tenantId, createdById }, include: taskInclude,
  }));
}
export function findTaskActor(
  id: string,
  tenantId: string,
  client: TaskClient = prisma,
) {
  return client.user.findFirst({
    where: {
      id,
      tenantId,
      status: "ACTIVE",
      role: { notIn: ["Guest"] },
    },
    select: person,
  });
}
export function findTaskLink(
  kind: Exclude<TaskOptionKind, "user">,
  id: string,
  tenantId: string,
  client: TaskClient = prisma,
) {
  const where = { id, tenantId, isArchived: false };
  switch (kind) {
    case "lead":
      return client.lead.findFirst({ where, select: { id: true } });
    case "contact":
      return client.contact.findFirst({ where, select: { id: true } });
    case "deal":
      return client.deal.findFirst({ where, select: { id: true } });
    case "account":
      return client.account.findFirst({ where, select: { id: true } });
  }
}
export function createTask(
  data: Prisma.TaskUncheckedCreateInput,
  client: TaskClient,
) {
  return client.task.create({ data, include: taskInclude });
}
export function updateTask(
  id: string,
  tenantId: string,
  data: Prisma.TaskUncheckedUpdateInput,
  client: TaskClient,
) {
  return client.task.update({
    where: { id, tenantId },
    data,
    include: taskInclude,
  });
}
export async function findTaskSummary(tenantId: string, query: TaskQuery) {
  const now = new Date();
  const where = taskWhere(tenantId, query, now);
  const active = {
    AND: [
      where,
      { isArchived: false, status: { notIn: ["completed", "cancelled"] } },
    ],
  };
  const overdue = {
    AND: [active, { dueDate: { lt: now }, isArchived: false }],
  };
  return prisma.$transaction(
    async (tx) => {
      const [statuses, workload, late, users, next] = await Promise.all([
        tx.task.groupBy({ by: ["status"], where, _count: { _all: true } }),
        tx.task.groupBy({
          by: ["assignedUserId", "status"],
          where: active,
          _count: { _all: true },
        }),
        tx.task.groupBy({
          by: ["assignedUserId", "status"],
          where: overdue,
          _count: { _all: true },
        }),
        tx.user.findMany({ where: { tenantId }, select: person }),
        tx.task.findFirst({
          where: { AND: [taskWhere(tenantId, { ...query, status: undefined, overdue: false }, now),
            { isArchived: false, status: { notIn: ["completed", "cancelled"] }, dueDate: { gte: now } }] },
          orderBy: { dueDate: "asc" }, select: { dueDate: true },
        }),
      ]);
      return { statuses, workload, late, users, evaluatedAt: now.toISOString(), nextStatusChangeAt: next?.dueDate?.toISOString() ?? null };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function findTaskOptions(
  tenantId: string,
  kind: TaskOptionKind,
  search: string,
  leadIds: string[] = [],
) {
  const people = {
    AND: buildSearchClauses(search, ['firstName', 'lastName', 'email']),
  };
  if (kind === "user") {
    const actor = crmActor.getStore();
    const policy = actor ? await resolveCrmActor(prisma, actor) : undefined;
    const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const rows = (await eligibleAssignedAgents(prisma, tenantId, TASK_ASSIGNEE_REQUIREMENTS))
      .filter(user => !policy || policy.clientAdmin || hasModulePermission(policy.permissions, 'tasks', 'canAssign') || user.id === policy.userId)
      .filter(user => !policy || taskAssigneeInScope(policy, user.id))
      .filter(user => terms.every(term => `${user.firstName} ${user.lastName} ${user.email}`.toLocaleLowerCase().includes(term)))
      .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id)).slice(0, 50);
    return rows.map((row) => ({
      id: row.id,
      label: `${row.firstName} ${row.lastName}`.trim(),
    }));
  }
  const related = await relatedOptionFilters(tenantId, leadIds);
  const where = { tenantId, isArchived: false };
  if (kind === "lead" || kind === "contact") {
    const args = {
      where: { ...where, ...people },
      take: 50,
      orderBy: [{ firstName: "asc" as const }, { id: "asc" as const }],
      select: { ...person, email: true },
    };
    const rows =
      kind === "lead"
        ? await prisma.lead.findMany(args)
        : await prisma.contact.findMany({
            ...args,
            where: { ...args.where, AND: [...people.AND, related.contact] },
          });
    return rows.map((row) => ({
      id: row.id,
      label:
        `${row.firstName} ${row.lastName}`.trim() +
        (row.email ? ` · ${row.email}` : ""),
    }));
  }
  if (kind === "deal") {
    const actor = crmActor.getStore();
    const policy = actor ? await resolveCrmActor(prisma, actor) : undefined;
    const rows = await prisma.deal.findMany({
      where: { ...where, deletedAt: null, AND: [...buildSearchClauses(search, ['title']), related.deal, await crmReadWhere(prisma, tenantId, 'deals')],
        ...(policy?.taskManager ? { assignedUserId: { in: policy.taskTeamUserIds } } : policy?.taskAssignmentRestricted ? { assignedUserId: policy.userId } : {}) },
      take: 50,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      select: { id: true, title: true },
    });
    return rows.map((row) => ({ id: row.id, label: row.title }));
  }
  const rows = await prisma.account.findMany({
    where: { ...where, AND: [...buildSearchClauses(search, ['name']), related.account] },
    take: 50,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  return rows.map((row) => ({ id: row.id, label: row.name }));
}

export async function findFilteredDealOptions(tenantId: string, query: import('zod').z.infer<typeof import('@leadcrm/shared').TaskOptionsQuerySchema>) {
  const actor = crmActor.getStore();
  const policy = actor ? await resolveCrmActor(prisma, actor) : undefined;
  if (!policy) throw new AppError('Authenticated workspace context required.', 403);
  if (query.accountId && !await mayReadCrmModule(prisma, tenantId, 'accounts')) throw new AppError('Account access required.', 403);
  if ((query.productInterestId || query.category) && !policy.clientAdmin && !hasModulePermission(policy.permissions, 'products', 'canView')) throw new AppError('Product access required.', 403);
  const related = await relatedOptionFilters(tenantId, query.leadIds);
  const where: Prisma.DealWhereInput = { tenantId, isArchived: false, deletedAt: null,
    AND: [...buildSearchClauses(query.search, ['title']), related.deal, await crmReadWhere(prisma, tenantId, 'deals')],
    ...(policy.taskManager ? { assignedUserId: { in: policy.taskTeamUserIds } } : policy.taskAssignmentRestricted ? { assignedUserId: policy.userId } : {}),
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.productInterestId ? { productInterestId: query.productInterestId } : {}),
    ...(query.category ? { productInterestRecord: { tenantId, category: query.category === '__uncategorized' ? '' : { equals: query.category, mode: 'insensitive' } } } : {}),
  };
  return prisma.$transaction(async tx => {
    const [total, rows] = await Promise.all([tx.deal.count({ where }), tx.deal.findMany({ where,
      take: query.selectAll ? 51 : query.limit, skip: query.selectAll ? 0 : (query.page - 1) * query.limit,
      orderBy: [{ title: 'asc' }, { id: 'asc' }], select: { id: true, title: true },
    })]);
    if (query.selectAll && total > 50) throw new AppError('More than 50 deals match. Narrow your filters before selecting all.', 400);
    return { data: rows.map(row => ({ id: row.id, label: row.title })), meta: { total, page: query.page, limit: query.limit, hasMore: query.page * query.limit < total } };
  }, { isolationLevel: 'RepeatableRead' });
}

export function taskAssociationWhere(
  kind: Exclude<TaskLinkKind, 'account'>,
  id: string,
  tenantId: string,
): Prisma.TaskWhereInput {
  return { [`${kind}Links`]: { some: { [`${kind}Id`]: id, tenantId } } };
}

/** Read-only context. Conversion does not create or move a direct TaskContact link. */
export function taskContextWhere(
  kind: TaskLinkKind,
  id: string,
  tenantId: string,
): Prisma.TaskWhereInput {
  if (kind === 'account') return { dealLinks: { some: { tenantId, deal: { tenantId, accountId: id } } } };
  const direct = taskAssociationWhere(kind, id, tenantId);
  if (kind === 'deal') return direct;
  const related: Prisma.DealWhereInput = kind === 'lead'
    ? { tenantId, leadDeals: { some: { tenantId, leadId: id } } }
    : { tenantId, OR: [
      { contactDeals: { some: { tenantId, contactId: id } } },
      { leadDeals: { some: { tenantId, lead: { tenantId, contactId: id, convertedAt: { not: null } } } } },
    ] };
  return { OR: [direct, { dealLinks: { some: { tenantId, deal: related } } }, ...(kind === 'contact' ? [{ leadLinks: { some: {
    tenantId,
    lead: { tenantId, contactId: id, convertedAt: { not: null } },
  } } }] : [])] };
}
export async function replaceTaskLinks(
  task: { id: string; tenantId: string },
  links: Omit<TaskAssociations, 'accountIds'>,
  client: TaskClient,
) {
  const where = {
    taskId: task.id,
    tenantId: task.tenantId,
  };
  if (links.leadIds !== undefined) {
    await client.taskLead.deleteMany({ where });
    if (links.leadIds.length)
      await client.taskLead.createMany({
        data: links.leadIds.map((leadId, position) => ({
          ...where,
          leadId,
          position,
        })),
      });
  }
  if (links.contactIds !== undefined) {
    await client.taskContact.deleteMany({ where });
    if (links.contactIds.length)
      await client.taskContact.createMany({
        data: links.contactIds.map((contactId, position) => ({
          ...where,
          contactId,
          position,
        })),
      });
  }
  if (links.dealIds !== undefined) {
    await client.taskDeal.deleteMany({ where });
    if (links.dealIds.length)
      await client.taskDeal.createMany({
        data: links.dealIds.map((dealId, position) => ({
          ...where,
          dealId,
          position,
        })),
      });
  }
}
export async function findTaskLinkIds(
  kind: TaskLinkKind,
  ids: string[],
  tenantId: string,
  client: TaskClient,
  leadIds: string[] = [],
) {
  const related = await relatedOptionFilters(tenantId, leadIds, client);
  const where = {
    tenantId,
    isArchived: false,
    id: { in: ids },
  };
  const select = { id: true } as const;
  switch (kind) {
    case "lead":
      return client.lead.findMany({ where, select });
    case "contact":
      return client.contact.findMany({
        where: { ...where, AND: [related.contact] },
        select,
      });
    case "deal":
      return client.deal.findMany({
        where: { ...where, deletedAt: null, AND: [related.deal] },
        select,
      });
    case "account":
      return client.account.findMany({
        where: { ...where, AND: [related.account] },
        select,
      });
  }
}
async function relatedOptionFilters(
  tenantId: string,
  leadIds: string[],
  client: TaskClient = prisma,
): Promise<{
  contact: Prisma.ContactWhereInput;
  account: Prisma.AccountWhereInput;
  deal: Prisma.DealWhereInput;
}> {
  if (!leadIds.length) return { contact: {}, account: {}, deal: {} };
  const leads = await client.lead.findMany({
    where: { tenantId, isArchived: false, id: { in: leadIds } },
    select: { id: true, contactId: true, accountId: true },
  });
  if (leads.length !== leadIds.length)
    throw new NotFoundError("Selected leads");
  return {
    contact: {
      id: {
        in: leads.flatMap((row) => (row.contactId ? [row.contactId] : [])),
      },
    },
    account: {
      id: {
        in: leads.flatMap((row) => (row.accountId ? [row.accountId] : [])),
      },
    },
    deal: {
      OR: [
        {
          leadDeals: {
            some: { tenantId, leadId: { in: leadIds } },
          },
        },
      ],
    },
  };
}

/** Called only from an already-authorized CRM merge transaction. */
export async function reassignTaskLinks(
  client: TaskClient,
  kind: Exclude<TaskLinkKind, 'account'>,
  primaryId: string,
  secondaryId: string,
  tenantId: string,
) {
  const tasks = await client.task.findMany({
    where: { tenantId, ...taskAssociationWhere(kind, secondaryId, tenantId) },
    include: taskInclude,
  });
  for (const task of tasks) {
    const all = {
      lead: task.leadLinks.map((row) => row.leadId),
      contact: task.contactLinks.map((row) => row.contactId),
      deal: task.dealLinks.map((row) => row.dealId),
    };
    const ids = [
      ...new Set(
        all[kind].map((id) =>
          id === secondaryId ? primaryId : id,
        ),
      ),
    ];
    await replaceTaskLinks(task, { [`${kind}Ids`]: ids }, client);
  }
  return { count: tasks.length };
}
