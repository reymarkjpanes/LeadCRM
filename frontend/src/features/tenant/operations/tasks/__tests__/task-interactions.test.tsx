import React, { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
const api = vi.hoisted(() => ({ get: vi.fn(), options: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/config", () => ({ USE_MOCK_DATA: false }));
vi.mock("@/store/DataContext", () => {
  const data = { users: [], contacts: [], organizations: [], deals: [] };
  return { useData: () => data };
});
vi.mock("@/store/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "owner", },
    tenant: { id: "tenant" },
  }),
}));
vi.mock("@/shared/services/tasks.api", () => ({ tasksApi: api }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
import { TaskSelector } from "../ui/task-editor";
import { ManageColumnsDrawer } from "@/shared/components/manage-columns-drawer";
import { TASK_COLUMN_DEFINITIONS } from "@leadcrm/shared";
import { TaskRecordCreator } from "../ui/task-record-creator";
import { TaskTable } from "../ui/task-table";
import { normalizeTaskColumns } from "../task-columns";
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue({ data: [], meta: { enabled: true } });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

it('renders legacy links and workflow CRM context in their Task table columns', () => {
  const task = { id: 'task', tenantId: 'tenant', title: 'Follow-up', description: '', status: 'pending' as const, assignedUserId: 'owner', dueDate: '2030-01-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z',
    leads: [], lead: { id: 'l', firstName: 'Jordan', lastName: 'Lee' }, accounts: [], account: { id: 'a', name: 'Northstar' },
    relatedRecords: [{ kind: 'deal' as const, id: 'd', label: 'Expansion', via: 'Lead: Jordan Lee' }, { kind: 'contact' as const, id: 'c', label: 'Alex Morgan', via: 'Lead: Jordan Lee' }],
  };
  render(<TaskTable tasks={[task]} columns={normalizeTaskColumns([])} selected={[]} onSelect={vi.fn()} onOpen={vi.fn()} onStatus={vi.fn()} onSort={vi.fn()} query={{}} busy={false} canEdit canArchive onEdit={vi.fn()} onArchive={vi.fn()} totalRecords={1} onManageColumns={vi.fn()} />);
  for (const name of ['Jordan Lee', 'Northstar', 'Expansion', 'Alex Morgan']) expect(screen.getByText(name, { exact: true }).closest('td')?.textContent).toBe(name);
});

it("searches inside the association dropdown, checks one explicit record, and supports clearing and creating", async () => {
  api.options.mockImplementation(async (_kind, search) => ({
    data: search
      ? [{ id: "b", label: "Beta Contact" }]
      : [
          { id: "a", label: "Alpha Contact" },
          { id: "b", label: "Beta Contact" },
        ],
  }));
  const create = vi.fn();
  function Selection() {
    const [value, setValue] = useState("");
    return (
      <>
        <output aria-label="Selected ID">{value}</output>
        <TaskSelector
          kind="contact"
          label="Associate contact"
          value={value}
          onChange={setValue}
          onCreate={create}
        />
      </>
    );
  }
  render(<Selection />);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Associate contact" }));
  const menu = screen.getByRole("dialog", { name: "Select contact" });
  fireEvent.click(
    await within(menu).findByRole("checkbox", { name: "Alpha Contact" }),
  );
  fireEvent.change(
    within(menu).getByRole("textbox", { name: "Search contact" }),
    { target: { value: "Beta" } },
  );
  await waitFor(() =>
    expect(api.options).toHaveBeenLastCalledWith(
      "contact",
      "Beta",
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(
    await within(menu).findByRole("checkbox", { name: "Beta Contact" }),
  );
  expect(screen.getByRole("status", { name: "Selected ID" }).textContent).toBe(
    "b",
  );
  fireEvent.click(within(menu).getByRole("checkbox", { name: "Beta Contact" }));
  expect(screen.getByRole("status", { name: "Selected ID" }).textContent).toBe(
    "",
  );
  fireEvent.click(
    within(menu).getByRole("button", { name: "Create a contact" }),
  );
  expect(create).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("preserves a failed contact draft and selects the saved response only after a successful retry", async () => {
  api.post
    .mockRejectedValueOnce(new Error("Contact save failed"))
    .mockResolvedValueOnce({
      data: { id: "new-contact", firstName: "Test", lastName: "Person" },
    });
  const created = vi.fn();
  render(
    <TaskRecordCreator
      kind="contact"
      onCreated={created}
      onCancel={vi.fn()}
      onBusy={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText(/first name \*/i), {
    target: { value: "Test" },
  });
  fireEvent.change(screen.getByLabelText(/last name \*/i), {
    target: { value: "Person" },
  });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'task-contact@example.test' } });
  await waitFor(() => expect((screen.getByRole('button', { name: /create contact/i }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Contact save failed",
  );
  expect(created).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText(/first name \*/i) as HTMLInputElement).value,
  ).toBe("Test");
  fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
  await waitFor(() =>
    expect(created).toHaveBeenCalledWith({
      id: "new-contact",
      label: "Test Person",
    }),
  );
  expect(api.post).toHaveBeenLastCalledWith(
    "/crm/contacts",
    expect.objectContaining({ firstName: "Test", lastName: "Person" }),
  );
});

it("uses shared column drafts, protects defaults and retries failed persistence", async () => {
  const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("Column save failed"))
      .mockResolvedValueOnce(undefined),
    close = vi.fn();
  render(
    <ManageColumnsDrawer
      isOpen
      module="tasks"
      registry={TASK_COLUMN_DEFINITIONS}
      effectiveColumns={normalizeTaskColumns(null)}
      onSave={save}
      onClose={close}
      onReset={vi.fn()}
    />,
  );
  expect(
    (
      (await screen.findByRole("button", {
        name: "Save",
      })) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByLabelText(
        "Task title visibility (locked)",
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText("Toggle Priority visibility"));
  fireEvent.click(screen.getByLabelText("Toggle Created visibility"));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Unable to save")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Saved")).toBeTruthy();
  const columns = save.mock.calls[1][0];
  expect(columns[0].id).toBe("action");
  expect(
    columns.find((column: { id: string }) => column.id === "priority").visible,
  ).toBe(false);
  expect(
    columns.find((column: { id: string }) => column.id === "createdAt").visible,
  ).toBe(true);
});

it("uses saved table order and selects only the displayed page", () => {
  const select = vi.fn(),
    sort = vi.fn();
  const task = {
    id: "one",
    tenantId: "tenant",
    title: "Follow-up",
    description: "",
    status: "pending" as const,
    assignedUserId: "owner",
    dueDate: "2030-01-01T08:00:00Z",
    createdAt: "2026-09-01T08:00:00Z",
  };
  const columns = normalizeTaskColumns([
    { id: "title", visible: true, order: 3 },
    { id: "dueDate", visible: true, order: 1 },
  ]);
  render(
    <TaskTable
      tasks={[task]}
      columns={columns}
      selected={[]}
      onSelect={select}
      onOpen={vi.fn()}
      onStatus={vi.fn()}
      onSort={sort}
      query={{ sortBy: "dueDate", sortOrder: "asc" }}
      busy={false}
      canEdit
      canArchive
      onEdit={vi.fn()}
      onArchive={vi.fn()}
      totalRecords={1}
      onManageColumns={vi.fn()}
    />,
  );
  const headers = screen
    .getAllByRole("columnheader")
    .map((element) => element.textContent);
  expect(
    headers.findIndex((label) => label?.startsWith("Due date")),
  ).toBeLessThan(headers.findIndex((label) => label?.startsWith("Task title")));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all records" }));
  expect(select).toHaveBeenCalledWith(["one"]);
  fireEvent.click(screen.getByRole("columnheader", { name: /Due date/ }));
  expect(sort).toHaveBeenCalledWith({ sortBy: "dueDate", sortOrder: "desc" });
  const row = screen.getAllByRole("row")[1];
  expect(
    row.children[0].querySelector('[aria-label="Row actions"]'),
  ).toBeTruthy();
  expect(row.children[1].querySelector('input[type="checkbox"]')).toBeTruthy();
  const trigger = screen.getByRole("button", { name: "Row actions" });
  fireEvent.click(trigger);
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["View", "Edit", "Archive"]);
  fireEvent.click(trigger);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("keeps multiple checked records across searches and supports removing and clearing", async () => {
  api.options.mockImplementation(async (_kind, search) => ({
    data: search
      ? [{ id: "b", label: "Beta" }]
      : [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
  }));
  function Multiple() {
    const [ids, setIds] = useState<string[]>([]);
    return (
      <>
        <output aria-label="Selected IDs">{ids.join(",")}</output>
        <TaskSelector
          multiple
          kind="lead"
          label="Leads"
          value={ids}
          onChange={setIds}
        />
      </>
    );
  }
  render(<Multiple />);
  fireEvent.click(screen.getByRole("button", { name: "Leads" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Alpha" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search lead" }), {
    target: { value: "Beta" },
  });
  fireEvent.click(await screen.findByRole("checkbox", { name: "Beta" }));
  expect(screen.getByLabelText("Selected IDs").textContent).toBe("a,b");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Leads" }).textContent).toContain(
    "Alpha +1",
  );
  fireEvent.click(screen.getByRole("button", { name: "Leads" }));
  const alpha = (await screen.findByRole("checkbox", {
    name: "Alpha",
  })) as HTMLInputElement;
  expect(alpha.checked).toBe(true);
  fireEvent.click(alpha);
  expect(screen.getByLabelText("Selected IDs").textContent).toBe("b");
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByLabelText("Selected IDs").textContent).toBe("");
});
