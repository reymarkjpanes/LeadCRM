import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  options: vi.fn(),
  denied: "",
}));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/shared/services/tasks.api", () => ({ tasksApi: api }));
vi.mock("@/shared/hooks/use-permissions", () => ({
  useHasPermission: (permission: string) => permission !== api.denied,
}));
vi.mock("@/lib/config", () => ({ USE_MOCK_DATA: false }));
vi.mock("@/store/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner" }, tenant: { id: "tenant" } }),
}));
vi.mock("@/store/DataContext", () => ({
  useData: () => ({ users: [], contacts: [], deals: [], organizations: [] }),
}));
// Keep these tests at the Task handoff boundary; CRM forms have their own validation.
vi.mock("next/dynamic", () => ({
  default:
    () =>
    (props: {
      onSave?: (data: object) => void;
      onSubmit?: (data: object) => void;
    }) => (
      <button
        onClick={() =>
          props.onSave
            ? props.onSave({ name: "New Account" })
            : props.onSubmit?.({
                title: "New Deal",
                leadIds: ["lead", "extra"],
                organizationId: "account",
              })
        }
      >
        Submit CRM form
      </button>
    ),
}));
import { TaskRelatedRecordCreator } from "../ui/task-related-record-creator";
import { TaskRecordCreator } from "../ui/task-record-creator";

const lead = {
  id: "lead",
  firstName: "Test",
  lastName: "Lead",
  status: "Inquiry",
  accountId: "old-account",
  account: { id: "old-account", name: "Old Account" },
};
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  api.denied = "";
  api.get.mockResolvedValue({ data: lead });
});

it("requires confirmation, converts the chosen Lead, and selects only the returned Contact", async () => {
  const created = vi.fn();
  api.post.mockResolvedValue({
    data: { contact: { id: "contact", firstName: "Test", lastName: "Lead" } },
  });
  render(
    <TaskRelatedRecordCreator
      kind="contact"
      leadIds={["lead"]}
      onCreated={created}
      onCancel={vi.fn()}
      onBusy={vi.fn()}
    />,
  );
  const submit = await screen.findByRole("button", {
    name: "Create contact and convert Lead",
  });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(submit);
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I confirm converting/ }),
  );
  fireEvent.click(submit);
  await waitFor(() =>
    expect(created).toHaveBeenCalledWith({ id: "contact", label: "Test Lead" }),
  );
  expect(api.post).toHaveBeenCalledWith("/crm/leads/lead/convert", {
    createContact: true,
    createDeal: false,
    accountId: "old-account",
  });
});

it("requires choosing a Lead when several are selected and prevents reconverting existing Contacts", async () => {
  api.get.mockImplementation(async (path: string) => ({
    data: path.endsWith("second")
      ? { ...lead, id: "second", status: "Converted", contactId: "contact" }
      : lead,
  }));
  render(
    <TaskRelatedRecordCreator
      kind="contact"
      leadIds={["lead", "second"]}
      onCreated={vi.fn()}
      onCancel={vi.fn()}
      onBusy={vi.fn()}
    />,
  );
  const choose = await screen.findByLabelText("Link to Lead");
  expect(
    screen.queryByRole("button", { name: "Create contact and convert Lead" }),
  ).toBeNull();
  fireEvent.change(choose, { target: { value: "second" } });
  expect(await screen.findByText(/already has a Contact/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
});

it("requires Account-link confirmation and retries a failed link without creating another Account", async () => {
  const created = vi.fn();
  api.post.mockResolvedValue({
    data: { id: "new-account", name: "New Account" },
  });
  api.put
    .mockRejectedValueOnce(new Error("Link failed"))
    .mockResolvedValueOnce({ data: {} });
  render(
    <TaskRelatedRecordCreator
      kind="account"
      leadIds={["lead"]}
      onCreated={created}
      onCancel={vi.fn()}
      onBusy={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Submit CRM form" }),
  );
  expect(
    screen.getByText(/replaces the current Account link/).textContent,
  ).toContain("Old Account");
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm updating/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm create and link Account" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe("Link failed");
  expect(created).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry linking Account" }),
  );
  await waitFor(() =>
    expect(created).toHaveBeenCalledWith({
      id: "new-account",
      label: "New Account",
    }),
  );
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith("/crm/accounts", {
    name: "New Account",
  });
  expect(api.put).toHaveBeenCalledTimes(2);
  expect(api.put).toHaveBeenLastCalledWith("/crm/leads/lead", {
    accountId: "new-account",
  });
});

it("keeps conversion errors visible without selecting a record", async () => {
  const created = vi.fn();
  api.post.mockRejectedValue(new Error("Conversion rejected"));
  render(
    <TaskRelatedRecordCreator
      kind="contact"
      leadIds={["lead"]}
      onCreated={created}
      onCancel={vi.fn()}
      onBusy={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /I confirm converting/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Create contact and convert Lead" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Conversion rejected",
  );
  expect(created).not.toHaveBeenCalled();
});

it("blocks the relationship flow when Lead edit permission is missing", async () => {
  api.denied = "leads.edit";
  render(
    <TaskRelatedRecordCreator
      kind="account"
      leadIds={["lead"]}
      onCreated={vi.fn()}
      onCancel={vi.fn()}
      onBusy={vi.fn()}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Lead edit permission",
  );
  expect(api.post).not.toHaveBeenCalled();
});

it("links a new Deal to all selected Leads while retaining additional form selections", async () => {
  const created = vi.fn();
  api.post.mockResolvedValue({ data: { id: "deal", title: "New Deal" } });
  render(
    <TaskRecordCreator
      kind="deal"
      leadIds={["lead", "second"]}
      onCreated={created}
      onCancel={vi.fn()}
      onBusy={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Submit CRM form" }));
  await waitFor(() =>
    expect(created).toHaveBeenCalledWith({ id: "deal", label: "New Deal" }),
  );
  expect(api.post).toHaveBeenCalledWith("/crm/deals", {
    title: "New Deal",
    leadIds: ["lead", "second", "extra"],
    accountId: "account",
  });
});
