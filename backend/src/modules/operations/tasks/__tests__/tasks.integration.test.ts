import { beforeAll, afterAll, describe, it } from "vitest";
import { expect } from "vitest";
import type { Server } from "node:http";
import prisma from "../../../../config/database.config";
import { tenantContext } from "../../../../core/tenant/tenant-context";
import { issueAuthSession } from "../../../../core/auth/auth-session";
import app from "../../../../app";
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
            mustChangePassword: false,
            emailVerified: new Date(),
          },
        });
      actor = await user("actor");
      owner = await user("owner");
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
            permissions: { create: { tenantId, module, canView: true } },
          },
        });
        await prisma.userRole.create({
          data: { tenantId, userId: reader.id, roleId: role.id },
        });
        const session = (await issueAuthSession(reader)).token;
        if (module === "tasks") readerToken = session;
        else contactsToken = session;
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
            activeProducts: [],
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
    it("persists links, completion, reassignment, reopen, archive, and audit through HTTP", async () => {
      const created = await call("/operations/tasks", "POST", {
        ...draft(),
        leadId: lead.id,
        contactId: contact.id,
        dealId: deal.id,
        accountId: account.id,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const task = created.body.data;
      expect(task.contact.id).toBe(contact.id);
      expect(task.lead.id).toBe(lead.id);
      expect(task.deal.id).toBe(deal.id);
      expect(task.assignedById).toBe(actor.id);
      const completed = await call(`/operations/tasks/${task.id}`, "PUT", {
        status: "completed",
      });
      expect(completed.status).toBe(200);
      expect(completed.body.data.completedById).toBe(actor.id);
      expect(completed.body.data.completedAt).toBeTruthy();
      const repeated = await call(
        `/operations/tasks/${task.id}/complete`,
        "PATCH",
      );
      expect(repeated.body.data.completedAt).toBe(
        completed.body.data.completedAt,
      );
      const reopened = await call(`/operations/tasks/${task.id}`, "PUT", {
        status: "in-progress",
        assignedUserId: actor.id,
        contactId: null,
      });
      expect(reopened.body.data).toMatchObject({
        id: task.id,
        status: "in_progress",
        completedAt: null,
        completedById: null,
        assignedUserId: actor.id,
        contactId: null,
      });
      const audits = await prisma.auditLog.findMany({
        where: { tenantId, entityId: task.id },
        orderBy: { createdAt: "asc" },
      });
      expect(audits.map((row) => row.action)).toEqual([
        "task.created",
        "task.completed",
        "task.updated",
      ]);
      expect((audits[2].changeset as any).before).toMatchObject({
        assignedUserId: owner.id,
      });
      expect((audits[2].changeset as any).after).toMatchObject({
        assignedUserId: actor.id,
      });
      expect(
        (await call(`/operations/tasks/${task.id}/archive`, "PATCH")).status,
      ).toBe(200);
      expect(
        (await call(`/operations/tasks/${task.id}`, "PUT", { title: "No" }))
          .status,
      ).toBe(404);
      expect(
        (await call("/operations/tasks?archived=true")).body.data.some(
          (row: any) => row.id === task.id,
        ),
      ).toBe(true);
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
    it("rejects cross-tenant, inactive, and invalid references", async () => {
      for (const bad of [
        { assignedUserId: outsider.id },
        { leadId: foreignLead.id },
        { contactId: "missing" },
        { dealId: "missing" },
        { accountId: "missing" },
      ]) {
        const response = await call("/operations/tasks", "POST", {
          ...draft("Rejected"),
          ...bad,
        });
        expect(response.status, JSON.stringify(response.body)).toBe(404);
      }
      await prisma.user.update({
        where: { id: owner.id },
        data: { status: "INACTIVE" },
      });
      expect(
        (await call("/operations/tasks", "POST", draft("Inactive"))).status,
      ).toBe(404);
      await prisma.user.update({
        where: { id: owner.id },
        data: { status: "ACTIVE" },
      });
      expect(
        await prisma.task.count({ where: { tenantId, title: "Rejected" } }),
      ).toBe(0);
    });
    it("uses server pagination beyond 100 rows and composes status with overdue", async () => {
      await scope(
        async () =>
          await prisma.task.createMany({
            data: Array.from({ length: 125 }, (_, index) => ({
              ...draft(`Page ${String(index).padStart(3, "0")}`),
              tenantId,
              status: index < 5 ? "completed" : "pending",
            })),
          }),
      );
      const first = await call(
        "/operations/tasks?search=Page&limit=100&sortBy=title",
      );
      const second = await call(
        "/operations/tasks?search=Page&limit=100&page=2&sortBy=title",
      );
      expect(first.body.meta).toMatchObject({ total: 125, hasMore: true });
      expect(second.body.data).toHaveLength(25);
      expect(
        new Set([...first.body.data, ...second.body.data].map((row) => row.id))
          .size,
      ).toBe(125);
      expect(
        (
          await call(
            "/operations/tasks?search=Page&status=completed&overdue=true",
          )
        ).body.meta.total,
      ).toBe(0);
      const summary = await call("/operations/tasks/summary?search=Page");
      expect(summary.body.data).toMatchObject({
        total: 125,
        active: 120,
        completed: 5,
        overdue: 120,
      });
      expect(summary.body.data.workload[0].total).toBe(120);
      expect((await call("/operations/tasks?limit=101")).status).toBe(400);
      expect(
        (
          await call(
            "/operations/tasks?dueFrom=2026-02-01T00:00:00Z&dueTo=2026-01-01T00:00:00Z",
          )
        ).status,
      ).toBe(400);
    });
    it("enforces existing permissions including CRM relationship task payloads", async () => {
      const task = (
        await call("/operations/tasks", "POST", {
          ...draft("Protected"),
          leadId: lead.id,
          contactId: contact.id,
        })
      ).body.data;
      expect(
        (await call("/operations/tasks", "POST", draft(), readerToken)).status,
      ).toBe(403);
      expect(
        (
          await call(
            `/operations/tasks/${task.id}/complete`,
            "PATCH",
            undefined,
            readerToken,
          )
        ).status,
      ).toBe(403);
      expect(
        (await call("/operations/tasks", "GET", undefined, contactsToken))
          .status,
      ).toBe(403);
      expect((await call(`/crm/leads/${lead.id}/relationships`, 'GET', undefined, contactsToken)).status).toBe(403);
      for (const path of [`/crm/contacts/${contact.id}/relationships`]) {
        const response = await call(path, "GET", undefined, contactsToken);
        expect(response.status).toBe(200);
        expect(response.body.data.tasks).toEqual([]);
      }
      expect(
        (
          await call(
            "/operations/tasks/options?kind=lead",
            "GET",
            undefined,
            readerToken,
          )
        ).status,
      ).toBe(403);
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
    it("creates a contact from the Task quick form and returns its explicit association", async () => {
      const created = await call("/crm/contacts", "POST", {
        firstName: "Task",
        lastName: "Contact",
        email: "task-quick@example.test",
        company: "Example",
      });
      expect(created.status).toBe(201);
      const options = await call(
        "/operations/tasks/options?kind=contact&search=task-quick",
      );
      expect(options.body.data).toEqual([
        {
          id: created.body.data.id,
          label: "Task Contact · task-quick@example.test",
        },
      ]);
      const task = await call("/operations/tasks", "POST", {
        ...draft("New contact follow-up"),
        contactId: created.body.data.id,
        accountId: account.id,
      });
      expect(task.status).toBe(201);
      const list = await call(
        "/operations/tasks?contactId=" + created.body.data.id,
      );
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].contact.id).toBe(created.body.data.id);
      expect(list.body.data[0].account).toMatchObject({
        id: account.id,
        name: account.name,
      });
    });
    it("creates and associates lead, account and deal records through the existing public CRM routes", async () => {
      const createdAccount = await call("/crm/accounts", "POST", {
        name: "Task new account",
        country: "Philippines",
      });
      expect(createdAccount.status).toBe(201);
      const createdLead = await call("/crm/leads", "POST", {
        firstName: "Task",
        lastName: "Lead",
        status: "Warm",
        email: "task-lead@example.test",
        accountId: createdAccount.body.data.id,
        productInterest: [product.id],
      });
      expect(createdLead.status).toBe(201);
      const createdDeal = await call("/crm/deals", "POST", {
        title: "Task new deal",
        productInterestIds: [product.id],
        pipelineId: deal.pipelineId,
        stageId: deal.stageId,
        priority: "MEDIUM",
        currency: "PHP",
        accountId: createdAccount.body.data.id,
        leadIds: [createdLead.body.data.id],
      });
      expect(createdDeal.status).toBe(201);
      const created = await call("/operations/tasks", "POST", {
        ...draft("New CRM records"),
        accountId: createdAccount.body.data.id,
        leadId: createdLead.body.data.id,
        dealId: createdDeal.body.data.id,
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        accountId: createdAccount.body.data.id,
        leadId: createdLead.body.data.id,
        dealId: createdDeal.body.data.id,
      });
    });
    it("returns accurate partial bulk results without changing inaccessible tasks", async () => {
      const task = (
        await call("/operations/tasks", "POST", draft("Bulk local"))
      ).body.data;
      const foreignTask = await scope(
        async () =>
          await prisma.task.create({
            data: { ...draft("Foreign task"), tenantId },
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

    it("persists multiple associations, filters every linked record, and clears lists atomically", async () => {
      const second = await scope(() =>
        prisma.lead.create({
          data: { tenantId, firstName: "Second", lastName: "Lead" },
        }),
      );
      const created = await call("/operations/tasks", "POST", {
        ...draft("Multiple links"),
        leadIds: [lead.id, second.id, lead.id],
      });
      expect(created.status).toBe(201);
      expect(created.body.data.leadIds).toEqual([lead.id, second.id]);
      expect(created.body.data.leads).toHaveLength(2);
      const id = created.body.data.id;
      expect(
        (await call(`/operations/tasks?leadId=${second.id}`)).body.data.some(
          (row: any) => row.id === id,
        ),
      ).toBe(true);
      expect(
        (
          await call(`/crm/leads/${second.id}/relationships`)
        ).body.data.tasks.some((row: any) => row.id === id),
      ).toBe(true);
      const unchanged = await call(`/operations/tasks/${id}`, "PUT", {
        title: "Renamed multiple links",
      });
      expect(unchanged.body.data.leadIds).toEqual([lead.id, second.id]);
      const rejected = await call(`/operations/tasks/${id}`, "PUT", {
        leadIds: [lead.id, foreignLead.id],
      });
      expect(rejected.status).toBe(404);
      expect((await call(`/operations/tasks/${id}`)).body.data.leadIds).toEqual(
        [lead.id, second.id],
      );
      const cleared = await call(`/operations/tasks/${id}`, "PUT", {
        leadIds: [],
      });
      expect(cleared.body.data.leadIds).toEqual([]);
      expect(cleared.body.data.leadId).toBeNull();
      expect(await prisma.taskLead.count({ where: { taskId: id } })).toBe(0);
    });
    it("restricts dependent options to explicit Lead relationships and enforces them on save", async () => {
      const relatedLead = await scope(() =>
        prisma.lead.create({
          data: {
            tenantId,
            firstName: "Related",
            lastName: "Lead",
            contactId: contact.id,
            accountId: account.id,
          },
        }),
      );
      await scope(() =>
        prisma.leadDeal.create({
          data: { tenantId, leadId: relatedLead.id, dealId: deal.id },
        }),
      );
      for (const [kind, expected] of [
        ["contact", contact.id],
        ["account", account.id],
        ["deal", deal.id],
      ]) {
        const result = await call(
          `/operations/tasks/options?kind=${kind}&leadIds=${relatedLead.id}`,
        );
        expect(result.status).toBe(200);
        expect(result.body.data.map((row: any) => row.id)).toEqual([expected]);
        const empty = await call(
          `/operations/tasks/options?kind=${kind}&leadIds=${lead.id}`,
        );
        expect(empty.body.data).toEqual([]);
      }
      expect(
        (
          await call(
            `/operations/tasks/options?kind=deal&leadIds=${foreignLead.id}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            `/operations/tasks/options?kind=deal&leadIds=${relatedLead.id}`,
            "GET",
            undefined,
            readerToken,
          )
        ).status,
      ).toBe(403);
      const invalid = await call("/operations/tasks", "POST", {
        ...draft(),
        leadIds: [lead.id],
        contactIds: [contact.id],
      });
      expect(invalid.status).toBe(400);
      const valid = await call("/operations/tasks", "POST", {
        ...draft(),
        leadIds: [relatedLead.id],
        contactIds: [contact.id],
        dealIds: [deal.id],
        accountIds: [account.id],
      });
      expect(valid.status).toBe(201);
      expect(valid.body.data.contacts[0].id).toBe(contact.id);
      expect(valid.body.data.accounts[0].id).toBe(account.id);
      expect(valid.body.data.deals[0].id).toBe(deal.id);
    });
    it("makes newly created records available in Lead-filtered options and saves their Task associations", async () => {
      const createdLead = await call("/crm/leads", "POST", {
        firstName: "Create",
        lastName: "Related",
        status: "Warm",
        email: "related-lead@example.test",
      });
      expect(createdLead.status).toBe(201);
      const leadId = createdLead.body.data.id;
      const newAccount = await call("/crm/accounts", "POST", {
        name: "Related create account",
      });
      expect(newAccount.status).toBe(201);
      const accountId = newAccount.body.data.id;
      expect(
        (await call(`/crm/leads/${leadId}`, "PUT", { accountId })).status,
      ).toBe(200);
      // Conversion requires an already confirmed sale; this test exercises task links.
      await scope(async () => {
        const won = await prisma.stage.create({ data: { tenantId, pipelineId: deal.pipelineId, name: 'Closed Won', order: 1, isWon: true, requiredFields: [] } });
        await prisma.deal.create({ data: { tenantId, pipelineId: deal.pipelineId, stageId: won.id, leadId, title: 'Previously confirmed sale', wonConfirmedAt: new Date(), closedAt: new Date(), productInterests: [], tags: [] } });
      });
      const converted = await call(`/crm/leads/${leadId}/convert`, "POST", {
        accountId,
        createContact: true,
        createDeal: false,
      });
      expect(converted.status).toBe(200);
      const contactId = converted.body.data.contact.id;
      expect((await call(`/crm/leads/${leadId}`)).body.data.status).toBe(
        "Closed",
      );
      const newDeal = await call("/crm/deals", "POST", {
        title: "Related create deal",
        productInterestIds: [product.id],
        pipelineId: deal.pipelineId,
        stageId: deal.stageId,
        leadIds: [leadId, lead.id],
      });
      expect(newDeal.status).toBe(201);
      const dealId = newDeal.body.data.id;
      for (const [kind, id] of [
        ["account", accountId],
        ["contact", contactId],
        ["deal", dealId],
      ]) {
        const options = await call(
          `/operations/tasks/options?kind=${kind}&leadIds=${leadId}`,
        );
        expect(options.status).toBe(200);
        expect(
          options.body.data.map((row: { id: string }) => row.id),
        ).toContain(id);
      }
      const saved = await call("/operations/tasks", "POST", {
        ...draft("Created related records"),
        leadIds: [leadId, lead.id],
        contactIds: [contactId],
        accountIds: [accountId],
        dealIds: [dealId],
      });
      expect(saved.status).toBe(201);
      expect(saved.body.data.contactIds).toEqual([contactId]);
      expect(saved.body.data.accountIds).toEqual([accountId]);
      expect(saved.body.data.dealIds).toEqual([dealId]);
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
    it("preserves and deduplicates all Task links through approved Merge integration", async () => {
      const merge = await import("../../../crm/merge/merge.repository");
      for (const kind of ["lead", "contact", "account"] as const) {
        const second = await scope(async () =>
          kind === "lead"
            ? prisma.lead.create({
                data: { tenantId, firstName: "Merge", lastName: "Lead" },
              })
            : kind === "contact"
              ? prisma.contact.create({
                  data: { tenantId, firstName: "Merge", lastName: "Contact" },
                })
              : prisma.account.create({
                  data: { tenantId, name: "Merge Account" },
                }),
        );
        const primary =
          kind === "lead"
            ? lead.id
            : kind === "contact"
              ? contact.id
              : account.id;
        const task = (
          await call("/operations/tasks", "POST", {
            ...draft("Merge links"),
            [kind + "Ids"]: [second.id, primary],
          })
        ).body.data;
        await scope(() =>
          prisma.$transaction((tx) =>
            kind === "lead"
              ? merge.reassignLeadRelationships(
                  tx,
                  primary,
                  second.id,
                  tenantId,
                )
              : kind === "contact"
                ? merge.reassignContactRelationships(
                    tx,
                    primary,
                    second.id,
                    tenantId,
                  )
                : merge.reassignAccountRelationships(
                    tx,
                    primary,
                    second.id,
                    tenantId,
                  ),
          ),
        );
        const stored = (await call(`/operations/tasks/${task.id}`)).body.data;
        expect(stored[kind + "Ids"]).toEqual([primary]);
        expect(stored[kind + "Id"]).toBe(primary);
      }
    });
  },
);
