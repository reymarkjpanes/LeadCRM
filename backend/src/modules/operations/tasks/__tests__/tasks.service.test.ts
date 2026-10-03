import { beforeEach, describe, expect, it, vi } from "vitest";
import { tenantContext } from "../../../../core/tenant/tenant-context";

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  });
  return {
    task: model(),
    user: model(),
    lead: model(),
    contact: model(),
    deal: model(),
    account: model(),
    $transaction: vi.fn(),
  };
});
vi.mock("../../../../config/database.config", () => ({ default: db }));
vi.mock("../../../../core/audit/audit.service", () => ({
  writeAuditLog: vi.fn(),
}));
import { writeAuditLog } from "../../../../core/audit/audit.service";
import * as service from "../tasks.service";

const tenantId = "task-tenant";
const actorId = "task-actor";
const input = {
  title: "Call customer",
  assignedUserId: "task-owner",
  dueDate: "2026-10-01T09:00:00.000Z",
  status: "pending" as const,
  priority: "High" as const,
};
const original = {
  ...input,
  id: "task-id",
  tenantId,
  description: null,
  reminderAt: null,
  leadId: null,
  contactId: null,
  dealId: null,
  accountId: null,
  assignedById: actorId,
  completedAt: null,
  completedById: null,
  isArchived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const scoped = <T>(work: () => T) =>
  tenantContext.run({ tenantId, }, work);

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((work: (tx: typeof db) => unknown) =>
    work(db),
  );
  db.user.findFirst.mockImplementation(({ where }) =>
    Promise.resolve({
      id: where.id,
      tenantId,
      status: "ACTIVE",
      role: "Sales Agent",
    }),
  );
  db.task.findFirst.mockResolvedValue({ ...original });
  db.task.create.mockImplementation(({ data }) =>
    Promise.resolve({ ...original, ...data }),
  );
  db.task.update.mockImplementation(({ data }) =>
    Promise.resolve({ ...original, ...data }),
  );
  db.task.updateMany.mockResolvedValue({ count: 1 });
  for (const model of [db.lead, db.contact, db.deal, db.account])
    model.findMany.mockResolvedValue([]);
});

describe("Task service authority", () => {
  it("validates payloads even when called directly by Workflow", async () => {
    await expect(
      scoped(() =>
        service.createTask(tenantId, actorId, { ...input, title: "   " }),
      ),
    ).rejects.toThrow();
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("requires a matching tenant context before writing", async () => {
    await expect(
      service.createTask(tenantId, actorId, input),
    ).rejects.toThrow();
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("rejects a missing, foreign-tenant, or inactive assignee before persistence", async () => {
    db.user.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(where.id === actorId ? { id: actorId } : null),
    );
    await expect(
      scoped(() => service.createTask(tenantId, actorId, input)),
    ).rejects.toThrow();
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it.each(["leadId", "contactId", "dealId"] as const)(
    "rejects inaccessible %s without creating a task or audit",
    async (field) => {
      await expect(
        scoped(() =>
          service.createTask(tenantId, actorId, {
            ...input,
            [field]: "inaccessible-record",
          }),
        ),
      ).rejects.toThrow();
      expect(db.task.create).not.toHaveBeenCalled();
      expect(writeAuditLog).not.toHaveBeenCalled();
    },
  );

  it("records completion actor and time through generic status update", async () => {
    const task = await scoped(() =>
      service.updateTask(original.id, tenantId, actorId, {
        status: "completed",
      }),
    );
    expect(task).toMatchObject({
      status: "completed",
      completedById: actorId,
      completedAt: expect.any(Date),
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "task.completed", userId: actorId }),
    );
  });

  it("clears completion metadata when a completed task is reopened", async () => {
    db.task.findFirst.mockResolvedValue({
      ...original,
      status: "completed",
      completedAt: new Date(),
      completedById: "previous-actor",
    });
    await scoped(() =>
      service.updateTask(original.id, tenantId, actorId, { status: "pending" }),
    );
    expect(db.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          completedAt: null,
          completedById: null,
        }),
      }),
    );
  });

  it("preserves the first completion attribution on repeated completion", async () => {
    const completed = {
      ...original,
      status: "completed",
      completedAt: new Date("2026-09-20T00:00:00Z"),
      completedById: "original-actor",
    };
    db.task.findFirst.mockResolvedValue(completed);
    const task = await scoped(() =>
      service.completeTask(original.id, tenantId, actorId),
    );
    expect(task.completedById).toBe("original-actor");
    expect(task.completedAt).toEqual(completed.completedAt);
  });

  it("records the actual assigning actor and prior owner on reassignment", async () => {
    await scoped(() =>
      service.updateTask(original.id, tenantId, actorId, {
        assignedUserId: "new-owner",
      }),
    );
    expect(db.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedById: actorId }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        before: expect.objectContaining({
          assignedUserId: input.assignedUserId,
        }),
        after: expect.objectContaining({ assignedUserId: "new-owner" }),
      }),
    );
  });

  it("rejects edits of archived tasks", async () => {
    db.task.findFirst.mockResolvedValue({ ...original, isArchived: true });
    await expect(
      scoped(() =>
        service.updateTask(original.id, tenantId, actorId, {
          title: "Changed",
        }),
      ),
    ).rejects.toThrow();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("propagates database failures rather than reporting not-found", async () => {
    const outage = new Error("Database unavailable");
    db.task.update.mockRejectedValue(outage);
    await expect(
      scoped(() =>
        service.updateTask(original.id, tenantId, actorId, {
          title: "Changed",
        }),
      ),
    ).rejects.toBe(outage);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects permanent deletion without touching storage", async () => {
    await expect(scoped(() => service.bulkTasks(tenantId, actorId, { operation: "delete", ids: [original.id] }))).rejects.toThrow();
    expect(db.task.deleteMany).not.toHaveBeenCalled();
  });

  it.each([[], [""], Array(101).fill("id")])(
    "rejects invalid deletion IDs before accessing storage",
    async (ids) => {
      await expect(
        scoped(() =>
          service.bulkTasks(tenantId, actorId, { operation: "delete", ids }),
        ),
      ).rejects.toThrow();
      expect(db.task.deleteMany).not.toHaveBeenCalled();
    },
  );
});
