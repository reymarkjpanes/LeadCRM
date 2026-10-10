import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  addTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  canEdit: true,
  canEditLeads: true,
  options: vi.fn(),
}));
const user = {
  id: "owner",
  firstName: "Test",
  lastName: "Owner",
  };
const data = {
  ...mocks,
  users: [],
  contacts: [],
  deals: [],
  organizations: [],
};
vi.mock("@/store/DataContext", () => ({ useData: () => data }));
vi.mock("@/store/AuthContext", () => ({
  useAuth: () => ({ user, tenant: { id: "tenant" } }),
}));
vi.mock("@/shared/hooks/use-permissions", () => ({
  useHasPermission: (permission: string) =>
    permission === "leads.edit"
      ? mocks.canEditLeads
      : permission !== "tasks.edit" || mocks.canEdit,
}));
vi.mock("@/lib/config", () => ({ USE_MOCK_DATA: false }));
vi.mock("@/shared/services/tasks.api", () => ({
  tasksApi: {
    options: mocks.options,
  },
}));
import { TaskEditor } from "../ui/task-editor";
import { manilaCurrentDate } from "../task-data";
const task = {
  id: "task",
  tenantId: "tenant",
  title: "Call client",
  description: "Keep my notes",
  status: "pending" as const,
  priority: "High" as const,
  assignedUserId: "owner",
  dueDate: "2026-09-27T13:30:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
};
afterEach(cleanup);
it('labels the existing task assignee Assigned Agent in the detail panel', () => {
  render(<TaskEditor task={task} readOnly onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Assigned Agent *' })).toBeTruthy();
  expect(screen.queryByText('Task owner')).toBeNull();
});
it("uses the Philippine calendar minimum and does not show a timezone label", () => {
  render(<TaskEditor onClose={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("Due date and time *"));
  const today = Number(manilaCurrentDate().slice(-2));
  const picker = screen.getByRole('group', { name: 'Choose due date and time' });
  if (today > 1) expect((within(picker).getByRole('button', { name: String(today - 1) }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(picker).getByRole('button', { name: String(today) }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText("Asia/Manila")).toBeNull();
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.canEdit = true;
  mocks.canEditLeads = true;
});
it("keeps the editor and entered values after a rejected save", async () => {
  mocks.updateTask.mockRejectedValue(new Error("Task update rejected"));
  const close = vi.fn();
  render(<TaskEditor task={task} onClose={close} />);
  await screen.findByRole("dialog");
  fireEvent.change(screen.getByLabelText("Title *"), {
    target: { value: "Edited title" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Task update rejected",
  );
  expect((screen.getByLabelText("Title *") as HTMLInputElement).value).toBe(
    "Edited title",
  );
  expect(close).not.toHaveBeenCalled();
});
it("preserves the due instant and existing identity on successful edits", async () => {
  mocks.updateTask.mockResolvedValue(undefined);
  const close = vi.fn();
  render(<TaskEditor task={task} onClose={close} />);
  fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.updateTask).toHaveBeenCalledWith(
    "task",
    expect.objectContaining({ dueDate: task.dueDate, title: task.title }),
  );
  expect(mocks.addTask).not.toHaveBeenCalled();
});
it("prefills the explicit Contact association for creation", async () => {
  mocks.addTask.mockResolvedValue(undefined);
  render(<TaskEditor links={{ contactId: "profile-id" }} onClose={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText("Title *"), {
    target: { value: "Profile follow up" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() =>
    expect(mocks.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        contactIds: ["profile-id"],
        title: "Profile follow up",
        assignedUserId: "owner",
      }),
    ),
  );
});
it("does not render a save action without the existing edit permission", async () => {
  mocks.canEdit = false;
  render(<TaskEditor task={task} onClose={vi.fn()} />);
  await screen.findByRole("dialog");
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

it("uses Contact wording, clears dependent links on Lead changes, and sends the selected Lead scope", async () => {
  mocks.options.mockResolvedValue({
    data: [{ id: "new-lead", label: "New Lead" }],
  });
  render(
    <TaskEditor
      task={{
        ...task,
        leadIds: ["old-lead"],
        contactIds: ["old-contact"],
        dealIds: ["old-deal"],
        accountIds: ["old-account"],
      }}
      onClose={vi.fn()}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Associate task to contact" }),
  ).toBeTruthy();
  expect(screen.queryByText(/client profile/i)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Associate task to lead" }),
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: "New Lead" }));
  expect(screen.getByRole("status").textContent).toContain(
    "Lead selection changed",
  );
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(
    screen.getByRole("button", { name: "Associate task to contact" })
      .textContent,
  ).toContain("Select a contact");
  mocks.options.mockResolvedValue({ data: [] });
  fireEvent.click(
    screen.getByRole("button", { name: "Associate task to contact" }),
  );
  expect(
    await screen.findByText("No related contacts for the selected leads."),
  ).toBeTruthy();
  expect(mocks.options).toHaveBeenLastCalledWith(
    "contact",
    "",
    expect.any(AbortSignal),
    ["old-lead", "new-lead"],
  );
  expect(screen.getByRole("button", { name: "Create a contact" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mocks.updateTask).toHaveBeenCalledWith(
      "task",
      expect.objectContaining({
        leadIds: ["old-lead", "new-lead"],
        contactIds: [],
        dealIds: [],
        accountIds: [],
      }),
    ),
  );
});

it.each(["contact", "deal", "account"])(
  "offers creation in an empty related %s menu",
  async (kind) => {
    mocks.options.mockResolvedValue({ data: [] });
    render(<TaskEditor links={{ leadIds: ["lead"] }} onClose={vi.fn()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: `Associate task to ${kind}` }),
    );
    expect(
      await screen.findByText(`No related ${kind}s for the selected leads.`),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: `Create ${kind === "account" ? "an" : "a"} ${kind}`,
      }),
    ).toBeTruthy();
  },
);

it("does not offer Lead relationship changes without Lead edit permission", async () => {
  mocks.canEditLeads = false;
  mocks.options.mockResolvedValue({ data: [] });
  render(<TaskEditor links={{ leadIds: ["lead"] }} onClose={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Associate task to contact" }),
  );
  await screen.findByText("No related contacts for the selected leads.");
  expect(screen.queryByRole("button", { name: "Create a contact" })).toBeNull();
});

it('keeps picker changes as a draft until Done and discards them on Cancel', () => {
  render(<TaskEditor onClose={vi.fn()} />);
  const trigger = screen.getByLabelText('Due date and time *');
  const original = trigger.textContent;
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText('Due minute'), { target: { value: '17' } });
  expect(trigger.textContent).toBe(original);
  fireEvent.click(within(screen.getByRole('group', { name: 'Choose due date and time' })).getByRole('button', { name: 'Cancel' }));
  expect(trigger.textContent).toBe(original);
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText('Due minute'), { target: { value: '23' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(trigger.textContent).toContain(':23');
  expect(screen.queryByRole('group', { name: 'Choose due date and time' })).toBeNull();
});
