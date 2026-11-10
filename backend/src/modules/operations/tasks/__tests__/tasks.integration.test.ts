import { beforeAll, afterAll, describe, it } from "vitest";
import { expect } from "vitest";
import type { Server } from "node:http";
import prisma from "../../../../config/database.config";
import { tenantContext } from "../../../../core/tenant/tenant-context";
import { issueAuthSession } from "../../../../core/auth/auth-session";
import app from "../../../../app";
import { reassignTaskLinks } from '../tasks.repository';
import { countAccountRelationships, reassignAccountRelationships } from '../../../crm/merge/merge.repository';
import { dispatchTenantNotifications } from '../../../notifications/notification-events.service';
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
const disposable =
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)(
  "Task acceptance on isolated PostgreSQL and authenticated HTTP",
  { timeout: 20000 },
  () => {
    let tenantId: string,
      otherTenantId: string,
      actor: any,
      owner: any,
      replacementOwner: any,
      outsider: any,
      lead: any,
      contact: any,
      deal: any,
      account: any,
      product: any,
      foreignLead: any;
    let token: string,
      readerToken: string,
      contactsToken: string,
      contactsReaderId: string,
      base: string,
      server: Server;
    const scope = <T>(
      work: () => T,
      scopedTenant = tenantId,
    ) => tenantContext.run({ tenantId: scopedTenant }, work);
    async function call(
      path: string,
      method = "GET",
      body?: unknown,
      auth = token,
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Cookie: `leadcrm_token=${auth}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    const draft = (title = "Follow up") => ({
      title,
      assignedUserId: owner.id,
      dueDate: "2026-01-01T09:30:00.000Z",
      priority: "High",
      dealIds: [deal.id],
    });
    beforeAll(async () => {
      const stamp = Date.now();
      tenantId = (
        await prisma.tenant.create({
          data: {
            name: "Task acceptance",
            slug: `tasks-${stamp}`,
            status: "ACTIVE",
            onboardingStep: 3,
            onboardingCompletedAt: new Date(),
          },
        })
      ).id;
      otherTenantId = (
        await prisma.tenant.create({
          data: { name: "Task foreign", slug: `tasks-other-${stamp}` },
        })
      ).id;
      const user = (name: string, tenant = tenantId, role = "Client Admin") =>
        prisma.user.create({
          data: {
            tenantId: tenant,
            role,
            email: `tasks-${name}-${stamp}@camxian.com`,
            firstName: name,
            lastName: "Test",
            mustChangePassword: false, onboardingCompletedAt: new Date(),
            emailVerified: new Date(),
          },
        });
      actor = await user("actor");
      owner = await user("owner", tenantId, "Task staff");
      replacementOwner = await user("replacement", tenantId, "Task staff");
      const taskStaffRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Task staff',
        permissions: { create: { module: 'tasks', canView: true } } } });
      await prisma.userRole.createMany({ data: [owner.id, replacementOwner.id].map(userId => ({ tenantId, userId, roleId: taskStaffRole.id })) });
      outsider = await user("outsider", otherTenantId);
      token = (await issueAuthSession(actor)).token;
      for (const [name, module] of [
        ["Task Reader", "tasks"],
        ["Contact Reader", "contacts"],
      ]) {
        const reader = await user(module, tenantId, name);
        const role = await prisma.roleDefinition.create({
          data: {
            tenantId,
            name,
            permissions: { create: { module, canView: true, ...(module === 'contacts' ? { canViewAll: true } : {}) } },
          },
        });
        await prisma.userRole.create({
          data: { tenantId, userId: reader.id, roleId: role.id },
        });
        const session = (await issueAuthSession(reader)).token;
        if (module === "tasks") readerToken = session;
        else { contactsToken = session; contactsReaderId = reader.id; }
      }
      await scope(async () => {
        product = await prisma.productInterest.create({ data: { tenantId, name: 'CCTV', dealValue: 5000 } });
        lead = await prisma.lead.create({
          data: {
            tenantId,
            firstName: "Lead",
            lastName: "Task",
            productInterest: [],
          },
        });
        contact = await prisma.contact.create({
          data: {
            tenantId,
            firstName: "Client",
            lastName: "Task",
            assignedUserId: contactsReaderId,
            productInterests: [],
          },
        });
        account = await prisma.account.create({
          data: { tenantId, name: "Task company" },
        });
        const pipeline = await prisma.pipeline.create({
          data: { tenantId, name: "Task pipeline" },
        });
        const stage = await prisma.stage.create({
          data: {
            tenantId,
            pipelineId: pipeline.id,
            name: "Lead",
            order: 0,
            requiredFields: [],
          },
        });
        deal = await prisma.deal.create({
          data: {
            tenantId,
            pipelineId: pipeline.id,
            stageId: stage.id,
            title: "Task deal",
            tags: [],
            productInterests: [],
          },
        });
      });
      foreignLead = await scope(
        async () =>
          await prisma.lead.create({
            data: {
              tenantId,
              firstName: "Foreign",
              lastName: "Task",
              productInterest: [],
            },
          }),
        otherTenantId,
      );
      server = app.listen(0);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
    }, 30000);
    afterAll(async () => {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    });
    it("bulk archives persist and Task recovery uses Archived Data with permission checks", async () => {
      const task = (await call('/operations/tasks', 'POST', draft('Recoverable task'))).body.data;
      expect((await call('/operations/tasks/bulk', 'POST', { operation: 'archive', ids: [task.id] })).body.data.succeeded).toEqual([task.id]);
      expect((await call('/operations/tasks')).body.data.some((row: any) => row.id === task.id)).toBe(false);
      const archived = await call('/administration/archived-data?type=Task');
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      expect(archived.body.data.some((row: any) => row.id === task.id && row.canRestore)).toBe(true);
      const path = `/administration/archived-data/Task/${task.id}/restore`;
      expect((await call(path, 'PATCH', undefined, readerToken)).status).toBe(403);
      expect((await call(path, 'PATCH')).status).toBe(200);
      expect((await call(`/operations/tasks/${task.id}`)).body.data).toMatchObject({ isArchived: false, title: 'Recoverable task' });
      expect((await call(path, 'PATCH')).status).toBe(404);
      expect((await call('/administration/archived-data/Task/invalid/restore', 'PATCH')).status).toBe(400);
    });
    it('rejects stale edits atomically and allows completion-only versioned updates', async () => {
      const first = (await call('/operations/tasks', 'POST', draft('Versioned Task'))).body.data;
      const updated = (await call(`/operations/tasks/${first.id}`, 'PUT', { title: 'Saved title' })).body.data;
      const before = await prisma.auditLog.count({ where: { tenantId, entityType: 'Task', entityId: first.id } });
      const stale = await call(`/operations/tasks/${first.id}`, 'PUT', { title: 'Stale title', expectedUpdatedAt: first.updatedAt });
      expect(stale.status).toBe(409);
      expect((await call(`/operations/tasks/${first.id}`)).body.data).toMatchObject({ title: 'Saved title', status: 'pending' });
      expect(await prisma.auditLog.count({ where: { tenantId, entityType: 'Task', entityId: first.id } })).toBe(before);
      const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Versioned completer', permissions: { create: { module: 'tasks', canView: true, canComplete: true } } } });
      const completer = await prisma.user.create({ data: { tenantId, role: role.name, email: `completer-${Date.now()}@camxian.com`, firstName: 'Task', lastName: 'Completer',
        mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date(), userRoles: { create: { roleId: role.id } } } });
      const auth = (await issueAuthSession(completer)).token;
      expect((await call(`/operations/tasks/${first.id}`, 'PUT', { status: 'completed', expectedUpdatedAt: updated.updatedAt }, auth)).status).toBe(404);
      const owned = await scope(() => prisma.task.create({ data: { tenantId, createdById: completer.id, assignedUserId: completer.id, title: 'Completer-owned', dueDate: new Date('2030-01-01') } }));
      const completed = await call(`/operations/tasks/${owned.id}`, 'PUT', { status: 'completed', expectedUpdatedAt: owned.updatedAt.toISOString() }, auth);
      expect(completed.status).toBe(200);
      expect(completed.body.data).toMatchObject({ status: 'completed', completedById: completer.id });
      expect((await call(`/operations/tasks/${owned.id}`, 'PUT', { title: 'Denied edit', expectedUpdatedAt: completed.body.data.updatedAt }, auth)).status).toBe(403);
    });
    it("persists Task columns per user and protects required columns and permissions", async () => {
      const path = "/preferences/columns/tasks";
      const defaults = await call(path);
      expect(defaults.status).toBe(200);
      const columns = defaults.body.data.columns.map((column: any) => ({
        ...column,
        visible: column.id === "priority" ? false : column.visible,
      }));
      expect((await call(path, "PUT", { columns })).status).toBe(200);
      expect(
        (await call(path)).body.data.columns.find(
          (column: any) => column.id === "priority",
        ).visible,
      ).toBe(false);
      expect(
        (
          await call(path, "GET", undefined, readerToken)
        ).body.data.columns.find((column: any) => column.id === "priority")
          .visible,
      ).toBe(true);
      expect((await call(path, "GET", undefined, contactsToken)).status).toBe(
        404,
      );
      expect(
        (
          await call(path, "PUT", {
            columns: columns.map((column: any) => ({
              ...column,
              visible: false,
            })),
          })
        ).status,
      ).toBe(400);
    });
    it("returns accurate partial bulk results without changing inaccessible tasks", async () => {
      const task = (
        await call("/operations/tasks", "POST", draft("Bulk local"))
      ).body.data;
      const foreignTask = await scope(
        async () =>
          await prisma.task.create({
            data: { title: "Foreign task", tenantId: otherTenantId, assignedUserId: outsider.id, dueDate: new Date("2026-01-01") },
          }),
        otherTenantId,
      );
      const response = await call("/operations/tasks/bulk", "POST", {
        operation: "complete",
        ids: [task.id, foreignTask.id, task.id, "missing"],
      });
      expect(response.status).toBe(200);
      expect(response.body.data.succeeded).toEqual([task.id]);
      expect(response.body.data.failed).toHaveLength(2);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: foreignTask.id } }))
          .status,
      ).toBe("pending");
      expect((await call(`/operations/tasks/${foreignTask.id}`)).status).toBe(404);
      expect(
        (
          await call("/operations/tasks/bulk", "POST", {
            operation: "complete",
            ids: [],
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call(
            "/operations/tasks/bulk",
            "POST",
            { operation: "archive", ids: [task.id] },
            readerToken,
          )
        ).status,
      ).toBe(403);
    });

    it("reschedules through the existing API and validates dates and assignees", async () => {
      const saved = (
        await call("/operations/tasks", "POST", draft("Reschedule acceptance"))
      ).body.data;
      const dueDate = "2030-10-15T01:00:00.000Z";
      const payload = { operation: "reschedule", ids: [saved.id], dueDate };
      expect(
        (await call("/operations/tasks/bulk", "POST", payload, readerToken))
          .status,
      ).toBe(403);
      expect(
        (
          await call("/operations/tasks/bulk", "POST", {
            ...payload,
            dueDate: "invalid",
          })
        ).status,
      ).toBe(400);
      const response = await call("/operations/tasks/bulk", "POST", payload);
      expect(response.body.data).toEqual({ succeeded: [saved.id], failed: [] });
      expect(
        (await call(`/operations/tasks/${saved.id}`)).body.data.dueDate,
      ).toBe(dueDate);
      const assigned = await call("/operations/tasks/bulk", "POST", {
        operation: "assign",
        ids: [saved.id],
        assignedUserId: outsider.id,
      });
      expect(assigned.body.data.succeeded).toEqual([]);
      expect(assigned.body.data.failed).toHaveLength(1);
      expect(
        (await call(`/operations/tasks/${saved.id}`)).body.data.assignedUserId,
      ).toBe(owner.id);
    });
    it("rejects the retired permanent deletion operation", async () => {
      const saved = (await call("/operations/tasks", "POST", draft("Deletion rejected"))).body.data;
      expect((await call("/operations/tasks/bulk", "POST", { operation: "delete", ids: [saved.id] })).status).toBe(400);
      expect((await call(`/operations/tasks/${saved.id}`)).status).toBe(200);
    });

    const newDeal = (title: string, data: object = {}) => scope(() => prisma.deal.create({ data: {
      tenantId, pipelineId: deal.pipelineId, stageId: deal.stageId, title, ...data,
    } }));
    const create = async (title: string, data: object = {}) => {
      const response = await call('/operations/tasks', 'POST', { ...draft(title), ...data });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return response.body.data;
    };
    const history = (taskId: string) => prisma.activity.findMany({ where: { tenantId, taskId }, orderBy: [{ createdAt: 'asc' }, { title: 'asc' }] });

    it('allows Client Admin management across creators while preserving assigned staff access and task history', async () => {
      const task = await create('Administrator management');
      await prisma.rolePermission.updateMany({ where: { tenantId, role: { name: 'Task staff' }, module: 'tasks' },
        data: { canEdit: true, canAssign: true, canComplete: true, canArchive: true } });
      const admin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', firstName: 'Other', lastName: 'Admin', email: `task-other-admin-${Date.now()}@camxian.com`, emailVerified: new Date(), onboardingCompletedAt: new Date(), mustChangePassword: false } });
      const assigneeToken = (await issueAuthSession(owner)).token;
      const adminToken = (await issueAuthSession(admin)).token;
      const beforeLinks = await prisma.taskDeal.findMany({ where: { taskId: task.id } });
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { title: 'Assigned user edit' }, assigneeToken)).status).toBe(200);
      expect((await call(`/operations/tasks/${task.id}/complete`, 'PATCH', undefined, assigneeToken)).status).toBe(200);
      expect((await call(`/operations/tasks/${task.id}`, 'GET', undefined, adminToken)).status).toBe(200);
      const edited = await call(`/operations/tasks/${task.id}`, 'PUT', { title: 'Admin edit', description: 'Updated notes', priority: 'Low',
        dueDate: '2031-01-01T01:00:00.000Z', assignedUserId: replacementOwner.id, status: 'in_progress', dealIds: [deal.id] }, adminToken);
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(edited.body.data).toMatchObject({ title: 'Admin edit', description: 'Updated notes', priority: 'Low', dueDate: '2031-01-01T01:00:00.000Z',
        assignedUserId: replacementOwner.id, createdById: actor.id, assignedById: admin.id, status: 'in_progress' });
      expect((await call(`/operations/tasks/${task.id}/complete`, 'PATCH', undefined, adminToken)).status).toBe(200);
      expect((await call(`/operations/tasks/${task.id}/archive`, 'PATCH', undefined, adminToken)).status).toBe(200);
      expect(await prisma.taskDeal.findMany({ where: { taskId: task.id } })).toEqual(beforeLinks);
      expect((await history(task.id)).some(event => event.createdById === admin.id)).toBe(true);
      expect(await prisma.auditLog.count({ where: { tenantId, entityType: 'Task', entityId: task.id, userId: admin.id } })).toBeGreaterThan(0);
      const otherTask = await scope(() => prisma.task.create({ data: { tenantId, createdById: owner.id, assignedUserId: owner.id, title: 'Other-owned', dueDate: new Date('2030-01-01') } }));
      const legacy = await scope(() => prisma.task.create({ data: { tenantId, assignedUserId: owner.id, title: 'No creator', dueDate: new Date('2030-01-01') } }));
      expect((await call(`/operations/tasks/${legacy.id}`, 'PUT', { description: 'Legacy notes', priority: 'High' })).status).toBe(200);
      for (const operation of ['assign', 'reschedule', 'complete', 'archive'] as const) {
        const response = await call('/operations/tasks/bulk', 'POST', { operation, ids: [otherTask.id, legacy.id],
          ...(operation === 'assign' ? { assignedUserId: replacementOwner.id } : operation === 'reschedule' ? { dueDate: '2031-02-01T02:00:00.000Z' } : {}) });
        expect(response.status).toBe(200); expect(response.body.data.succeeded).toEqual([otherTask.id, legacy.id]);
        expect(response.body.data.failed).toEqual([]);
      }
      expect(await prisma.task.findUniqueOrThrow({ where: { id: otherTask.id } })).toMatchObject({ createdById: owner.id, assignedUserId: replacementOwner.id, isArchived: true });
      expect(await prisma.task.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ createdById: null, assignedUserId: replacementOwner.id, isArchived: true, description: 'Legacy notes' });
    });

    it('requires Deals, rejects every direct association field, and rejects conflicting input', async () => {
      const invalid = [{ dealIds: [] }, { dealIds: undefined }, { dealId: deal.id },
        ...['leadId', 'leadIds', 'contactId', 'contactIds', 'accountId', 'accountIds'].map(key => ({ [key]: key.endsWith('Ids') ? [lead.id] : lead.id }))];
      for (const payload of invalid) expect((await call('/operations/tasks', 'POST', { ...draft('Rejected input'), ...payload })).status).toBe(400);
      expect(await prisma.task.count({ where: { tenantId, title: 'Rejected input' } })).toBe(0);
      const { dealIds, ...singular } = draft('Singular compatibility');
      expect((await call('/operations/tasks', 'POST', { ...singular, dealId: deal.id })).status).toBe(201);
    });

    it('creates multiple deduplicated TaskDeal rows and never writes direct CRM links', async () => {
      const second = await newDeal('Second Deal');
      const task = await create('Multiple Deals', { dealIds: [deal.id, second.id, deal.id] });
      expect(task.dealIds).toEqual([deal.id, second.id]);
      for (const model of [prisma.taskLead, prisma.taskContact]) expect(await model.count({ where: { taskId: task.id } })).toBe(0);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).retiredAccountLinks).toEqual([]);
      expect(await prisma.taskDeal.count({ where: { taskId: task.id } })).toBe(2);
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { description: 'Keep links' })).body.data.dealIds).toEqual([deal.id, second.id]);
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { dealIds: [] })).status).toBe(400);
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { leadIds: [] })).status).toBe(400);
    });

    it('delivers one assignment notification for a multi-Deal Task and preserves worker retry idempotency', async () => {
      const { randomUUID } = await import('node:crypto');
      const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Task notification staff',
        permissions: { create: { module: 'tasks', canView: true } } } });
      const staff = await prisma.user.create({ data: { tenantId, firstName: 'Assigned', lastName: 'Staff',
        email: `${randomUUID()}@camxian.com`, role: 'Task notification staff', userRoles: { create: { roleId: role.id } } } });
      const second = await newDeal('Notification second Deal');
      const task = await create('Multi-Deal assignment delivery', { assignedUserId: staff.id, dealIds: [deal.id, second.id],
        dueDate: new Date(Date.now() + 3 * 86400000).toISOString() });
      for (let batch = 0; batch < 20; batch++) if (!(await dispatchTenantNotifications(tenantId)).claimed) break;
      const deliveries = await prisma.notification.findMany({ where: { tenantId, entityType: 'Task', entityId: task.id } });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({ userId: staff.id, type: 'task_assigned' });
      await dispatchTenantNotifications(tenantId);
      expect(await prisma.notification.count({ where: { tenantId, entityType: 'Task', entityId: task.id } })).toBe(1);
      expect(await prisma.notificationDelivery.count({ where: { tenantId, userId: staff.id, outcome: 'delivered', eventKey: deliveries[0].eventKey! } })).toBe(1);
    });

    it('records Deal association changes with both event-time contexts and deduplicates concurrent completion', async () => {
      const source = await newDeal('Removed Deal');
      const target = await newDeal('Added Deal');
      const task = await create('Association and concurrency', { dealIds: [source.id] });
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { dealIds: [target.id] })).status).toBe(200);
      const changes = (await history(task.id)).filter(row => (row.metadata as any).taskEvent.event === 'deals_changed');
      expect(changes).toHaveLength(1);
      expect((changes[0].metadata as any).taskEvent).toMatchObject({ before: { dealIds: [source.id] }, after: { dealIds: [target.id] } });
      expect((changes[0].metadata as any).taskEvent.context.dealIds.sort()).toEqual([source.id, target.id].sort());
      const results = await Promise.all(Array.from({ length: 4 }, () => call(`/operations/tasks/${task.id}/complete`, 'PATCH')));
      expect(results.some(result => result.status === 200)).toBe(true);
      expect(results.every(result => [200, 409].includes(result.status))).toBe(true);
      for (const result of results.filter(result => result.status === 409)) expect((await call(`/operations/tasks/${task.id}/complete`, 'PATCH')).status).toBe(200);
      expect((await history(task.id)).filter(row => (row.metadata as any).taskEvent.event === 'completed')).toHaveLength(1);
    });

    it('rejects foreign, archived, missing Deals and inactive assignees atomically', async () => {
      const foreign = await scope(async () => {
        const pipeline = await prisma.pipeline.create({ data: { tenantId: otherTenantId, name: 'Foreign pipeline' } });
        const stage = await prisma.stage.create({ data: { tenantId: otherTenantId, pipelineId: pipeline.id, name: 'Lead', order: 0, requiredFields: [] } });
        return prisma.deal.create({ data: { tenantId: otherTenantId, title: 'Foreign Deal', pipelineId: pipeline.id, stageId: stage.id } });
      }, otherTenantId);
      const archived = await newDeal('Archived Deal', { isArchived: true });
      for (const id of [foreign.id, archived.id, 'missing']) {
        expect((await call('/operations/tasks', 'POST', { ...draft('Invalid reference'), dealIds: [deal.id, id] })).status).toBe(404);
      }
      expect((await call('/operations/tasks', 'POST', { ...draft('Invalid reference'), assignedUserId: outsider.id })).status).toBe(404);
      expect((await call('/operations/tasks', 'POST', { ...draft('Invalid reference'), assignedUserId: actor.id })).status).toBe(404);
      expect(await prisma.task.count({ where: { tenantId, title: 'Invalid reference' } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { tenantId, action: 'task.created', changeset: { path: ['after', 'title'], equals: 'Invalid reference' } } })).toBe(0);
    });

    it('uses authoritative role memberships for options and rejects invalid create, reassignment and bulk assignment without side effects', async () => {
      const staffRole = await prisma.roleDefinition.findFirstOrThrow({ where: { tenantId, name: 'Task staff' } });
      const adminRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Client Admin', permissions: { create: { module: 'tasks', canView: true } } } });
      const guestRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Guest', isArchived: true } });
      const archivedRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Retired task staff', isArchived: true, permissions: { create: { module: 'tasks', canView: true } } } });
      const candidate = async (name: string, roles: string[], status = 'ACTIVE', role = 'Task Staff') => {
        const user = await prisma.user.create({ data: { tenantId, firstName: name, lastName: 'Eligibility', email: `${name}-${Date.now()}@camxian.com`, role, status } });
        for (const roleId of roles) await prisma.userRole.create({ data: { tenantId, userId: user.id, roleId } });
        return user;
      };
      const invalid = [actor, outsider,
        await candidate('multi-admin', [staffRole.id, adminRole.id]),
        await candidate('guest', [staffRole.id], 'INACTIVE', 'Guest'),
        await candidate('multi-guest', [staffRole.id, guestRole.id]),
        await candidate('inactive', [staffRole.id], 'INACTIVE'),
        await candidate('no-task-access', []),
        await candidate('archived-role', [archivedRole.id]),
      ];
      const options = await call('/operations/tasks/options?kind=user');
      expect(options.status).toBe(200);
      expect(options.body.data.map((row: any) => row.id)).toContain(owner.id);
      for (const person of invalid) expect(options.body.data.map((row: any) => row.id)).not.toContain(person.id);
      const saved = (await call('/operations/tasks', 'POST', draft('Eligibility transfer'))).body.data;
      const taskCount = await prisma.task.count({ where: { tenantId } });
      const auditCount = await prisma.auditLog.count({ where: { tenantId, entityType: 'Task' } });
      const activityCount = await prisma.activity.count({ where: { tenantId } });
      for (const person of invalid) {
        expect((await call('/operations/tasks', 'POST', { ...draft('Invalid assignment'), assignedUserId: person.id })).status).toBe(404);
        expect((await call(`/operations/tasks/${saved.id}`, 'PUT', { assignedUserId: person.id })).status).toBe(404);
        const bulk = await call('/operations/tasks/bulk', 'POST', { operation: 'assign', ids: [saved.id], assignedUserId: person.id });
        expect(bulk.body.data.succeeded).toEqual([]);
        expect(bulk.body.data.failed).toHaveLength(1);
      }
      expect((await call('/operations/tasks', 'POST', { ...draft(), assignedUserId: '' })).status).toBe(400);
      expect(await prisma.task.count({ where: { tenantId } })).toBe(taskCount);
      expect(await prisma.auditLog.count({ where: { tenantId, entityType: 'Task' } })).toBe(auditCount);
      expect(await prisma.activity.count({ where: { tenantId } })).toBe(activityCount);
      expect(await prisma.task.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ assignedUserId: owner.id, createdById: actor.id });
    });

    it('preserves historical Client Admin assignment on an unrelated edit and permits a real eligible reassignment', async () => {
      const saved = await scope(() => prisma.task.create({ data: { tenantId, title: 'Historical admin task', assignedUserId: actor.id, createdById: actor.id, dueDate: new Date(), dealLinks: { create: { dealId: deal.id } } } }));
      expect((await call(`/operations/tasks/${saved.id}`, 'PUT', { title: 'Historical edited', assignedUserId: actor.id })).status).toBe(200);
      expect(await prisma.task.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ title: 'Historical edited', assignedUserId: actor.id, createdById: actor.id });
      expect((await call(`/operations/tasks/${saved.id}`, 'PUT', { assignedUserId: owner.id })).status).toBe(200);
      expect(await prisma.task.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ assignedUserId: owner.id, createdById: actor.id, assignedById: actor.id });
    });

    it('retains authorized staff self-assignment while enforcing Tasks Assign permission for another agent', async () => {
      const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Self-assigned Task Staff', permissions: { create: [
        { module: 'tasks', canView: true, canCreate: true }, { module: 'deals', canView: true, canViewAll: true },
      ] } } });
      const staff = await prisma.user.create({ data: { tenantId, firstName: 'Self', lastName: 'Staff', email: `task-self-${Date.now()}@camxian.com`, role: role.name, mustChangePassword: false, onboardingCompletedAt: new Date() } });
      await prisma.userRole.create({ data: { tenantId, userId: staff.id, roleId: role.id } });
      const auth = (await issueAuthSession(staff)).token;
      const assignedDeal = await newDeal('Self-assigned staff Deal', { assignedUserId: staff.id });
      const options = await call('/operations/tasks/options?kind=user', 'GET', undefined, auth);
      expect(options.body.data.map((row: any) => row.id)).toEqual([staff.id]);
      const own = await call('/operations/tasks', 'POST', { ...draft('Explicit self-assignment'), dealIds: [assignedDeal.id], assignedUserId: staff.id }, auth);
      expect(own.status).toBe(201);
      expect(own.body.data).toMatchObject({ assignedUserId: staff.id, createdById: staff.id });
      expect((await call('/operations/tasks', 'POST', { ...draft('Unauthorized other assignment'), assignedUserId: owner.id }, auth)).status).toBe(403);
      expect(await prisma.task.count({ where: { tenantId, title: 'Unauthorized other assignment' } })).toBe(0);
    });

    it('commits actor, creator, assignment, completion, reschedule, archive and restore history once', async () => {
      const task = await create('Lifecycle');
      expect(task).toMatchObject({ createdById: actor.id, assignedUserId: owner.id, assignedById: actor.id });
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { assignedUserId: replacementOwner.id, dueDate: '2031-01-01T09:00:00Z' })).status).toBe(200);
      const completed = await call(`/operations/tasks/${task.id}/complete`, 'PATCH');
      await call(`/operations/tasks/${task.id}/complete`, 'PATCH');
      expect(completed.body.data).toMatchObject({ completedById: actor.id, createdById: actor.id });
      await call(`/operations/tasks/${task.id}`, 'PUT', { status: 'pending' });
      await call(`/operations/tasks/${task.id}`, 'PUT', { status: 'in_progress' });
      await call(`/operations/tasks/${task.id}/archive`, 'PATCH');
      await call(`/operations/tasks/${task.id}/archive`, 'PATCH');
      await call(`/administration/archived-data/Task/${task.id}/restore`, 'PATCH');
      const rows = await history(task.id);
      expect(rows.map(row => (row.metadata as any).taskEvent.event).sort()).toEqual([
        'created','assigned','reassigned','rescheduled','completed','reopened','status_changed','archived','restored',
      ].sort());
      const audits = await prisma.auditLog.findMany({ where: { tenantId, entityId: task.id } });
      expect(new Set(audits.map(row => row.id))).toEqual(new Set(rows.map(row => row.id)));
      expect(rows.every(row => row.createdById === actor.id && row.createdAt instanceof Date)).toBe(true);
      await call(`/operations/tasks/${task.id}`, 'PUT', { status: 'in_progress', dueDate: '2031-01-01T09:00:00Z' });
      expect(await history(task.id)).toHaveLength(rows.length);
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { createdById: owner.id })).status).toBe(400);
    });

    it('rolls back Task and audit if its Activity cannot be committed', async () => {
      let rejectHistory = true;
      prisma.$use(async (params, next) => {
        if (rejectHistory && params.model === 'Activity' && params.action === 'create' && params.args.data.metadata?.taskEvent?.taskTitle === 'History rollback') throw new Error('Simulated history outage');
        return next(params);
      });
      try { expect((await call('/operations/tasks', 'POST', draft('History rollback'))).status).toBe(500); }
      finally { rejectHistory = false; }
      expect(await prisma.task.count({ where: { tenantId, title: 'History rollback' } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { tenantId, changeset: { path: ['after','title'], equals: 'History rollback' } } })).toBe(0);
    });

    it('returns a persisted creation receipt on retries and rejects reuse with different values', async () => {
      const { randomUUID } = await import('node:crypto');
      const payload = { ...draft('Idempotent creation'), requestId: randomUUID() };
      const first = await call('/operations/tasks', 'POST', payload);
      const retry = await call('/operations/tasks', 'POST', payload);
      expect(retry.body.data.id).toBe(first.body.data.id);
      expect(await history(first.body.data.id)).toHaveLength(2);
      expect((await call('/operations/tasks', 'POST', { ...payload, title: 'Changed retry' })).status).toBe(409);
    });

    it('deduplicates concurrent creation requests without repeating task history', async () => {
      const { randomUUID } = await import('node:crypto');
      const payload = { ...draft('Concurrent idempotent creation'), requestId: randomUUID() };
      const responses = await Promise.all(Array.from({ length: 3 }, () => call('/operations/tasks', 'POST', payload)));
      expect(responses.every(response => [200, 201, 409].includes(response.status)), JSON.stringify(responses)).toBe(true);
      const successes = responses.filter(response => response.status < 300);
      expect(successes.length).toBeGreaterThan(0);
      expect(new Set(successes.map(response => response.body.data.id)).size).toBe(1);
      const retry = await call('/operations/tasks', 'POST', payload);
      expect(retry.body.data.id).toBe(successes[0].body.data.id);
      expect(await history(retry.body.data.id)).toHaveLength(2);
      expect(await prisma.task.count({ where: { tenantId, title: payload.title } })).toBe(1);
    });

    it('derives all CRM Task lists with accurate counts, pagination, conversion context and no duplicates', async () => {
      const related = await newDeal('Related Deal', { accountId: account.id,
        leadDeals: { create: { leadId: lead.id } }, contactDeals: { create: { contactId: contact.id } } });
      const second = await newDeal('Another Related Deal', { accountId: account.id,
        leadDeals: { create: { leadId: lead.id } }, contactDeals: { create: { contactId: contact.id } } });
      const task = await create('Derived unique', { dealIds: [related.id, second.id] });
      for (const [kind,id] of [['lead',lead.id],['contact',contact.id],['account',account.id],['deal',related.id]]) {
        const result = await call(`/operations/tasks?${kind}Id=${id}&search=Derived%20unique&limit=1`);
        expect(result.body.meta.total).toBe(1); expect(result.body.data[0].id).toBe(task.id);
        expect((await call(`/operations/tasks/summary?${kind}Id=${id}&search=Derived%20unique`)).body.data).toMatchObject({ total: 1, active: 1 });
        const events = await call(`/crm/activities?${kind}Id=${id}&type=task&search=Derived%20unique&limit=1`);
        expect(events.body.meta.total).toBe(2); expect(events.body.data).toHaveLength(1);
        const next = await call(`/crm/activities?${kind}Id=${id}&type=task&search=Derived%20unique&limit=1&cursor=${events.body.nextCursor}`);
        expect(next.body.data).toHaveLength(1); expect(next.body.data[0].id).not.toBe(events.body.data[0].id);
      }
      await scope(() => prisma.lead.update({ where: { id: lead.id }, data: { contactId: contact.id, convertedAt: new Date() } }));
      await scope(() => prisma.contactDeal.deleteMany({ where: { tenantId, dealId: related.id } }));
      expect((await call(`/operations/tasks?contactId=${contact.id}&search=Derived%20unique`)).body.meta.total).toBe(1);
      await call(`/operations/tasks/${task.id}/archive`, 'PATCH');
      expect((await call(`/operations/tasks?leadId=${lead.id}&search=Derived%20unique`)).body.meta.total).toBe(0);
      expect((await call(`/crm/activities?leadId=${lead.id}&type=task&search=Derived%20unique`)).body.meta.total).toBe(3);
      expect((await call(`/crm/activities?taskId=${task.id}`)).status).toBe(200);
    }, 60000);

    it('freezes event-time context when Deal participants and Account change', async () => {
      const leadA = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Old', lastName: 'Lead' } }));
      const leadB = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'New', lastName: 'Lead' } }));
      const otherAccount = await scope(() => prisma.account.create({ data: { tenantId, name: 'New Account' } }));
      const related = await newDeal('Historical Deal', { accountId: account.id, leadDeals: { create: { leadId: leadA.id } } });
      const task = await create('Frozen history', { dealIds: [related.id] });
      await call(`/operations/tasks/${task.id}/complete`, 'PATCH');
      const first = await history(task.id);
      await scope(() => prisma.$transaction(async tx => {
        await tx.leadDeal.deleteMany({ where: { tenantId, dealId: related.id } });
        await tx.leadDeal.create({ data: { tenantId, leadId: leadB.id, dealId: related.id } });
        await tx.deal.update({ where: { id: related.id }, data: { accountId: otherAccount.id } });
      }));
      for (const [kind,oldId,newId] of [['lead',leadA.id,leadB.id],['account',account.id,otherAccount.id]]) {
        expect((await call(`/crm/activities?${kind}Id=${oldId}&search=Frozen%20history`)).body.meta.total).toBe(3);
        expect((await call(`/crm/activities?${kind}Id=${newId}&search=Frozen%20history`)).body.meta.total).toBe(0);
        expect((await call(`/operations/tasks?${kind}Id=${newId}&search=Frozen%20history`)).body.meta.total).toBe(1);
      }
      expect((await history(task.id)).map(row => row.metadata)).toEqual(first.map(row => row.metadata));
      await call(`/operations/tasks/${task.id}`, 'PUT', { status: 'pending' });
      expect((await call(`/crm/activities?leadId=${leadB.id}&search=Frozen%20history`)).body.meta.total).toBe(1);
    });

    it('preserves legacy person Task links through edits and Lead merges without inventing Deals or Account associations', async () => {
      const source = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Legacy', lastName: 'Lead' } }));
      const task = await scope(() => prisma.task.create({ data: { tenantId, title: 'Legacy record', assignedUserId: owner.id,
        createdById: actor.id, dueDate: new Date('2026-01-01'), leadLinks: { create: { leadId: source.id } },
        contactLinks: { create: { contactId: contact.id } } } }));
      await call(`/operations/tasks/${task.id}`, 'PUT', { description: 'Safe legacy management', status: 'completed' });
      const result = (await call(`/operations/tasks/${task.id}`)).body.data;
      expect(result).toMatchObject({ dealIds: [], leadIds: [source.id], contactIds: [contact.id], accountId: null, accountIds: [], accounts: [], createdById: actor.id });
      expect(result).not.toHaveProperty('retiredAccountLinks');
      expect((await call(`/operations/tasks?accountId=${account.id}&search=Legacy%20record`)).body.meta.total).toBe(0);
      const events = await history(task.id);
      await scope(() => prisma.$transaction(tx => reassignTaskLinks(tx, 'lead', lead.id, source.id, tenantId)));
      expect((await call(`/operations/tasks/${task.id}`)).body.data.leadIds).toEqual([lead.id]);
      expect((await history(task.id)).map(row => row.metadata)).toEqual(events.map(row => row.metadata));
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { dealIds: [deal.id] })).status).toBe(200);
      expect(await prisma.taskLead.count({ where: { taskId: task.id } })).toBe(1);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).retiredAccountLinks).toEqual([]);
    });

    it('moves Account task context through Deal merges without fabricating links for unassociated Tasks or changing frozen history', async () => {
      const [sourceAccount, targetAccount] = await scope(() => Promise.all(['Source', 'Target'].map(name =>
        prisma.account.create({ data: { tenantId, name: `Task merge ${name}` } }))));
      const associatedDeal = await newDeal('Account Task context merge', { accountId: sourceAccount.id });
      const current = await create('Account Task context merge', { dealIds: [associatedDeal.id] });
      const legacy = await scope(() => prisma.task.create({ data: { tenantId, title: 'Retired Account context merge',
        assignedUserId: owner.id, createdById: actor.id, dueDate: new Date() } }));
      const events = await history(current.id);
      expect((await scope(() => countAccountRelationships(sourceAccount.id, tenantId))).tasks).toBe(1);
      const reassigned = await scope(() => prisma.$transaction(tx => reassignAccountRelationships(tx, targetAccount.id, sourceAccount.id, tenantId)));
      expect(reassigned.tasks).toBe(1);
      expect((await call(`/operations/tasks?accountId=${sourceAccount.id}`)).body.meta.total).toBe(0);
      const related = await call(`/operations/tasks?accountId=${targetAccount.id}`);
      expect(related.body.data.map((row: { id: string }) => row.id)).toEqual([current.id]);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: legacy.id } })).retiredAccountLinks).toEqual([]);
      expect((await call(`/operations/tasks/${legacy.id}`)).body.data).toMatchObject({ dealIds: [], accountIds: [], accounts: [], accountId: null });
      expect((await history(current.id)).map(row => row.metadata)).toEqual(events.map(row => row.metadata));
    });

    it('enforces Sales Deal assignments and Task permissions without granting CRM edit', async () => {
      const sales = await prisma.user.create({ data: { tenantId, firstName: 'Sales', lastName: 'Agent', role: 'Sales Agent',
        email: `sales-${Date.now()}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date() } });
      const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales Agent', crmAssignmentRestricted: true,
        permissions: { create: [{ module: 'tasks', canView: true, canCreate: true, canEdit: true, canAssign: true, canComplete: true }, { module: 'deals', canView: true, canViewAll: true }] } } });
      await prisma.userRole.create({ data: { tenantId, userId: sales.id, roleId: role.id } });
      const auth = (await issueAuthSession(sales)).token;
      const own = await newDeal('Own Sales Deal', { assignedUserId: sales.id });
      const other = await newDeal('Other Sales Deal', { assignedUserId: owner.id, ownerId: sales.id });
      expect((await call('/operations/tasks', 'POST', { ...draft('Allowed Sales Task'), assignedUserId: sales.id, dealIds: [own.id] }, auth)).status).toBe(201);
      expect((await call('/operations/tasks', 'POST', { ...draft('Denied Sales Task'), assignedUserId: sales.id, dealIds: [other.id] }, auth)).status).toBe(404);
      expect(await prisma.task.count({ where: { tenantId, title: 'Denied Sales Task' } })).toBe(0);
      const task = await create('Admin task on Other Deal', { dealIds: [other.id] });
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { dealIds: [own.id] }, auth)).status).toBe(404);
      expect((await call(`/operations/tasks/${task.id}`, 'PUT', { description: 'Task rights only' }, auth)).status).toBe(404);
      const owned = (await call('/operations/tasks', 'POST', { ...draft('Sales-owned editable'), assignedUserId: sales.id, dealIds: [own.id] }, auth)).body.data;
      expect((await call(`/operations/tasks/${owned.id}`, 'PUT', { description: 'Task rights only' }, auth)).status).toBe(200);
      expect((await call(`/crm/deals/${own.id}`, 'PUT', { title: 'No CRM edit grant' }, auth)).status).toBe(403);
      const options = await call('/operations/tasks/options?kind=deal', 'GET', undefined, auth);
      expect(options.body.data.map((row: any) => row.id)).toContain(own.id);
      expect(options.body.data.map((row: any) => row.id)).not.toContain(other.id);
      expect((await call('/operations/tasks', 'POST', draft('Reader denied'), readerToken)).status).toBe(403);
    });

    it('protects Task history from unauthorized reads, forgery, edits and deletes', async () => {
      const related = await newDeal('Protected history Deal', { contactDeals: { create: { contactId: contact.id } } });
      const task = await create('Private Task history', { dealIds: [related.id] });
      const events = await history(task.id);
      expect((await call(`/crm/activities?contactId=${contact.id}&search=Private%20Task`, 'GET', undefined, contactsToken)).body.meta.total).toBe(0);
      expect((await call(`/crm/activities/${events[0].id}`, 'GET', undefined, contactsToken)).status).toBe(404);
      expect((await call(`/crm/contacts/${contact.id}/relationships`, 'GET', undefined, contactsToken)).body.data.activities.some((row: any) => events.some(event => event.id === row.id))).toBe(false);
      expect((await call(`/crm/activities/${events[0].id}`, 'PUT', { title: 'Forged' })).status).toBe(403);
      expect((await call(`/crm/activities/${events[0].id}`, 'DELETE')).status).toBe(403);
      expect((await call('/crm/activities', 'POST', { type: 'task', title: 'Forged history', taskId: task.id })).status).toBe(403);
      const foreign = await scope(() => prisma.activity.create({ data: { tenantId: otherTenantId, createdById: outsider.id, type: 'task', title: 'Other tenant history' } }), otherTenantId);
      expect((await call(`/crm/activities/${foreign.id}`)).status).toBe(404);
    });
  },
);
