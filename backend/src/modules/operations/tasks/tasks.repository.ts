import { Prisma } from "@prisma/client";
import {
  TaskQuery,
  TaskOptionKind,
  TaskAssociations,
  TaskLinkKind,
} from "@leadcrm/shared";
import { NotFoundError } from "../../../shared/errors/http-error";
import prisma from "../../../config/database.config";
import { ConflictError } from "../../../shared/errors/http-error";

export type TaskClient = Pick<
  Prisma.TransactionClient,
  | "task"
  | "user"
  | "lead"
  | "contact"
  | "deal"
  | "account"
  | "taskLead"
  | "taskContact"
  | "taskDeal"
  | "taskAccount"
>;
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
  accountLinks: {
    orderBy: [{ position: "asc" }, { accountId: "asc" }],
    include: {
      account: {
        select: { id: true, name: true, tenantId: true },
      },
    },
  },
  assignedUser: { select: person },
  assignedBy: { select: person },
  completedBy: { select: person },
  lead: { select: { ...person } },
  contact: { select: { ...person } },
  deal: {
    select: { id: true, title: true, tenantId: true },
  },
} satisfies Prisma.TaskInclude;
export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export async function withTaskTransaction<T>(
  work: (client: TaskClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
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
  if (query.status)
    AND.push({
      status:
        query.status === "in_progress"
          ? { in: ["in_progress", "in-progress"] }
          : query.status,
    });
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
    if (id) AND.push(taskAssociationWhere(kind, id, tenantId));
  }
  return {
    tenantId,
    isArchived: query.archived,
    AND,
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}
export async function findAllTasks(tenantId: string, query: TaskQuery) {
  const where = taskWhere(tenantId, query);
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
export function findTaskById(
  id: string,
  tenantId: string,
  client: TaskClient = prisma,
) {
  return client.task.findFirst({
    where: { id, tenantId },
    include: taskInclude,
  });
}
export function findTaskUser(
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
  const where = taskWhere(tenantId, query);
  const active = {
    AND: [
      where,
      { isArchived: false, status: { notIn: ["completed", "cancelled"] } },
    ],
  };
  const overdue = {
    AND: [active, { dueDate: { lt: new Date() }, isArchived: false }],
  };
  return prisma.$transaction(
    async (tx) => {
      const [statuses, workload, late, users] = await Promise.all([
        tx.task.groupBy({ by: ["status"], where, _count: { _all: true } }),
        tx.task.groupBy({
          by: ["assignedUserId", "status"],
          where: active,
          _count: { _all: true },
        }),
        tx.task.groupBy({
          by: ["assignedUserId"],
          where: overdue,
          _count: { _all: true },
        }),
        tx.user.findMany({ where: { tenantId }, select: person }),
      ]);
      return { statuses, workload, late, users };
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
  const contains = { contains: search, mode: "insensitive" as const };
  const people = {
    OR: [{ firstName: contains }, { lastName: contains }, { email: contains }],
  };
  if (kind === "user") {
    const rows = await prisma.user.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        role: { notIn: ["Guest"] },
        ...people,
      },
      take: 50,
      orderBy: [{ firstName: "asc" }, { id: "asc" }],
      select: person,
    });
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
            where: { ...args.where, AND: [related.contact] },
          });
    return rows.map((row) => ({
      id: row.id,
      label:
        `${row.firstName} ${row.lastName}`.trim() +
        (row.email ? ` · ${row.email}` : ""),
    }));
  }
  if (kind === "deal") {
    const rows = await prisma.deal.findMany({
      where: { ...where, title: contains, AND: [related.deal] },
      take: 50,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      select: { id: true, title: true },
    });
    return rows.map((row) => ({ id: row.id, label: row.title }));
  }
  const rows = await prisma.account.findMany({
    where: { ...where, name: contains, AND: [related.account] },
    take: 50,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  return rows.map((row) => ({ id: row.id, label: row.name }));
}

export function findTaskAccounts(tenantId: string, ids: string[]) {
  return prisma.account.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, name: true },
  });
}

export function taskAssociationWhere(
  kind: TaskLinkKind,
  id: string,
  tenantId: string,
): Prisma.TaskWhereInput {
  return {
    OR: [
      { [`${kind}Id`]: id },
      {
        [`${kind}Links`]: {
          some: {
            [`${kind}Id`]: id,
            tenantId,
          },
        },
      },
    ],
  };
}
export async function replaceTaskLinks(
  task: { id: string; tenantId: string },
  links: TaskAssociations,
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
  if (links.accountIds !== undefined) {
    await client.taskAccount.deleteMany({ where });
    if (links.accountIds.length)
      await client.taskAccount.createMany({
        data: links.accountIds.map((accountId, position) => ({
          ...where,
          accountId,
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
        where: { ...where, AND: [related.deal] },
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
        { leadId: { in: leadIds } },
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
  kind: TaskLinkKind,
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
      account: task.accountLinks.map((row) => row.accountId),
    };
    const legacy = task[`${kind}Id`];
    const ids = [
      ...new Set(
        [...all[kind], ...(legacy ? [legacy] : [])].map((id) =>
          id === secondaryId ? primaryId : id,
        ),
      ),
    ];
    await client.task.update({
      where: { id: task.id, tenantId },
      data: { [`${kind}Id`]: ids[0] ?? null },
    });
    await replaceTaskLinks(task, { [`${kind}Ids`]: ids }, client);
  }
  return { count: tasks.length };
}
