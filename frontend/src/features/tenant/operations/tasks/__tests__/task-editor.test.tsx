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
  canAssign: true,
  groupAccess: true,
  deniedPermissions: [] as string[],
  detail: {} as { data?: import('@leadcrm/shared').TaskRecord; error: string | null; errorStatus?: number; isInitialLoad: boolean; isRefreshing: boolean; refetch: ReturnType<typeof vi.fn>; setData: ReturnType<typeof vi.fn> },
  options: vi.fn(),
  captureLayout: undefined as (() => void) | undefined,
}));
const user = {
  id: "owner",
  role: 'Task staff',
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
    mocks.deniedPermissions.includes(permission) ? false : permission === "leads.edit"
      ? mocks.canEditLeads
      : permission === 'tasks.view_all' ? mocks.groupAccess : permission === 'tasks.assign' ? mocks.canAssign : permission !== "tasks.edit" || mocks.canEdit,
}));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => mocks.detail }));
vi.mock('../ui/task-selector', async () => {
  const actual = await vi.importActual<typeof import('../ui/task-selector')>('../ui/task-selector');
  return { ...actual, TaskSelector: (props: React.ComponentProps<typeof actual.TaskSelector>) => {
    React.useLayoutEffect(() => { mocks.captureLayout?.(); });
    return <actual.TaskSelector {...props} />;
  } };
});
vi.mock('../ui/task-record-creator', () => ({ TaskRecordCreator: ({ onCancel, onCreated }: { onCancel: () => void; onCreated: (option: { id: string; label: string }) => void }) => <><button type="button" onClick={onCancel}>Cancel deal creation</button><button type="button" onClick={() => onCreated({ id: 'new-deal', label: 'New Deal' })}>Finish deal creation</button></> }));
vi.mock("@/lib/config", () => ({ USE_MOCK_DATA: false }));
vi.mock("@/shared/services/tasks.api", () => ({
  tasksApi: {
    options: mocks.options,
    dealOptions: async (filters: { search?: string }, signal?: AbortSignal) => { const result = await mocks.options('deal', filters.search ?? '', signal); return { ...result, meta: { total: result.data.length, page: 1, limit: 25, hasMore: false } }; },
  },
}));
import { TaskEditor } from "../ui/task-editor";

it('submits literal Unicode Task notes without altering whitespace or markup-like characters', async () => {
  const notes = `  ñ é 中文 日本語 한글 مرحبا 😊 & ' " < > ∑ ₱ e\u0301\n<tag>literal</tag>  `;
  render(<TaskEditor task={task} onClose={vi.fn()} />);
  editField('Notes');
  const input = screen.getByPlaceholderText('Add task notes...');
  fireEvent.change(input, { target: { value: notes } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { description: notes, expectedUpdatedAt: task.updatedAt }));
});
import { manilaCurrentDate } from "../task-data";
const task = {
  id: "task",
  tenantId: "tenant",
  title: "Call client",
  description: "Keep my notes",
  status: "pending" as const,
  priority: "High" as const,
  createdById: "owner",
  assignedUserId: "owner",
  dueDate: "2030-09-27T13:30:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: '2026-09-01T00:00:00.000Z',
};
afterEach(cleanup);
beforeEach(() => {
  user.role = 'Task staff';
  vi.resetAllMocks(); mocks.canEdit = true; mocks.canEditLeads = true; mocks.canAssign = true; mocks.groupAccess = true; mocks.deniedPermissions = []; mocks.captureLayout = undefined;
  mocks.detail = { data: task, error: null, isInitialLoad: false, isRefreshing: false, refetch: vi.fn(), setData: vi.fn(saved => { mocks.detail.data = saved; }) };
  mocks.updateTask.mockImplementation(async (_id, patch) => { const { expectedUpdatedAt, ...changes } = patch; return { ...mocks.detail.data, ...changes, updatedAt: '2026-10-18T00:00:00.000Z' }; });
  mocks.options.mockResolvedValue({ data: [{ id: 'owner', label: 'Test Owner' }] });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
async function selectAgent() {
  fireEvent.click(screen.getByRole('button', { name: 'Assigned Agent *' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Test Owner' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}
function enableEditing() {
  fireEvent.click(screen.getByRole('button', { name: 'Task actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit task' }));
}
function editField(label: string) { fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` })); }

it.each(['Sales Associate', 'Renamed custom role'])('creates a personal %s Task with a read-only To do field and no assignment dropdown', async role => {
  user.role = role; mocks.groupAccess = false;
  render(<TaskEditor links={{ dealIds: ['deal'] }} onClose={vi.fn()} />);
  const status = screen.getByRole('textbox', { name: 'Status' });
  expect(status).toHaveProperty('readOnly', true);
  expect(status).toHaveProperty('value', 'To do');
  expect(status).toHaveProperty('tabIndex', -1);
  expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Assigned Agent *' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'My personal task' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
  await waitFor(() => expect(mocks.addTask).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', assignedUserId: user.id })));
});

it.each(['Sales Associate', 'Sales Admin', 'Renamed custom role'])('lets a permitted %s manage an assigned Task created by another user', role => {
  user.role = role; mocks.groupAccess = false; mocks.detail.data = { ...task, createdById: 'someone-else' };
  render(<TaskEditor task={task} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Task actions' })).toBeTruthy();
  enableEditing(); expect(screen.queryByRole('button', { name: 'Edit Assigned Agent' })).toBeNull();
});

it.each(['Sales Associate', 'Renamed custom role'])('removes an open %s detail and its controls after reassignment', async role => {
  user.role = role; mocks.groupAccess = false;
  const { rerender } = render(<TaskEditor task={task} onClose={vi.fn()} />);
  expect(screen.getByRole('heading', { name: task.title })).toBeTruthy();
  mocks.detail.data = { ...task, assignedUserId: 'other-agent' };
  rerender(<TaskEditor task={task} onClose={vi.fn()} />);
  expect(screen.queryByRole('heading', { name: task.title })).toBeNull();
  expect(screen.queryByText(task.description)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Task actions' })).toBeNull();
  expect(mocks.updateTask).not.toHaveBeenCalled();
});

it('uses the shared header action area in menu, status, close order above the title and pills', () => {
  render(<TaskEditor task={task} onClose={vi.fn()} />);
  const header = screen.getByRole('dialog').querySelector('header')!;
  const area = header.querySelector('[data-record-actions]')!;
  expect(Array.from(area.querySelectorAll('button')).map(button => button.getAttribute('aria-label'))).toEqual(['Task actions', 'Task status: To do', 'Close record']);
  expect(within(header).getAllByText('To do')).toHaveLength(1);
  expect(within(header).getByText('TASK')).toBeTruthy();
  expect(within(header).getByText('High')).toBeTruthy();
  expect(within(header).getByRole('heading', { name: task.title })).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.queryByText(/Open full page/i)).toBeNull();
  fireEvent.click(within(area as HTMLElement).getByRole('button', { name: 'Task actions' }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Edit task', 'Archive task']);
});

it('renders saved fields, metadata, permission-filtered ID links and collapsible shared sections', () => {
  mocks.detail.data = { ...task, assignedUser: user, createdBy: { id: 'creator', firstName: 'Original', lastName: 'Creator' },
    completedAt: '2026-09-28T01:00:00Z', completedBy: { id: 'completer', firstName: 'Completing', lastName: 'Agent' },
    assignedByUser: { id: 'assigner', firstName: 'Assigning', lastName: 'Admin' }, dealIds: ['deal/id'], deals: [{ id: 'deal/id', title: 'Selected Deal' }],
    leads: [{ id: 'historic', firstName: 'Historical', lastName: 'Lead' }], relatedRecords: [
      { kind: 'lead', id: 'lead/id', label: 'Related Lead', via: 'Deal: Selected Deal' },
      { kind: 'contact', id: 'contact/id', label: 'Related Contact', via: 'Deal: Selected Deal' },
      { kind: 'account', id: 'account/id', label: 'Related Account', via: 'Deal: Selected Deal' },
    ] };
  mocks.deniedPermissions = ['contacts.view'];
  render(<TaskEditor task={task} onClose={vi.fn()} />);
  for (const [label, href] of [['Selected Deal', '/crm/deals/deal%2Fid'], ['Related Lead', '/crm/leads/lead%2Fid'], ['Related Account', '/crm/accounts/account%2Fid'], ['Historical Lead', '/crm/leads/historic']])
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
  expect(screen.queryByRole('link', { name: 'Related Contact' })).toBeNull();
  for (const text of [task.description, 'Original Creator', 'Sep 1, 2026 08:00 AM', 'Sep 28, 2026 09:00 AM by Completing Agent', 'Assigning Admin']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByText('Assigned Agent: Test Owner')).toBeTruthy();
  expect(screen.getByText('Due: Sep 27, 2030 09:30 PM')).toBeTruthy();
  for (const name of ['Task Information', 'Schedule & Assignment', 'Additional Information', /^Associated Deals\s*1$/, 'Task History']) {
    const toggle = screen.getByRole('button', { name });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle); expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle); expect(toggle.getAttribute('aria-expanded')).toBe('true');
  }
  enableEditing();
  const history = screen.getByRole('button', { name: 'Task History' }).closest('section')!;
  expect(within(history).queryByRole('button', { name: /^Edit/ })).toBeNull();
});

it.each(['readOnly', 'archived', 'permissions'] as const)('keeps %s viewers read-only without preventing viewing or collapsing cards', mode => {
  mocks.detail.data = { ...task, isArchived: mode === 'archived' };
  if (mode === 'permissions') { mocks.canEdit = false; mocks.canAssign = false; mocks.deniedPermissions = ['tasks.complete', 'tasks.archive']; }
  render(<TaskEditor task={task} readOnly={mode === 'readOnly'} onClose={vi.fn()} />);
  expect(screen.getByRole('heading', { name: task.title })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Task actions' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Task status:/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Task Information' }));
  expect(screen.getByRole('button', { name: 'Task Information' }).getAttribute('aria-expanded')).toBe('false');
  expect(mocks.updateTask).not.toHaveBeenCalled(); expect(mocks.deleteTask).not.toHaveBeenCalled();
});

it.each(['someone-else', null, undefined])('lets Client Admin edit another agent task with creator %s', async createdById => {
  user.role = 'Client Admin'; mocks.groupAccess = false;
  mocks.detail.data = { ...task, createdById, assignedUserId: 'another-agent' };
  render(<TaskEditor task={task} onClose={vi.fn()} />);
  editField('Notes');
  fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'Admin notes' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { description: 'Admin notes', expectedUpdatedAt: task.updatedAt }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(screen.getByRole('button', { name: 'Edit Assigned Agent' })).toBeTruthy();
  expect(mocks.detail.data?.createdById).toBe(createdById);
});

it('edits a saved field directly without opening Task actions and saves its captured version', async () => {
  const close = vi.fn(); render(<TaskEditor task={task} onClose={close} />);
  expect(screen.getByRole('button', { name: 'Task actions' }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button', { name: 'Edit Title' })).toHaveProperty('disabled', false);
  editField('Title');
  expect(screen.queryByRole('menuitem', { name: 'Edit task' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: /^Title/ }), { target: { value: '  Updated title  ' } });
  expect(screen.getByRole('button', { name: 'Edit Priority' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Task actions' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: /^Task status:/ })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { title: 'Updated title', expectedUpdatedAt: task.updatedAt });
  expect(screen.getByRole('heading', { name: 'Updated title' })).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Priority' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Priority' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), { target: { value: 'Low' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.updateTask).toHaveBeenLastCalledWith(task.id, { priority: 'Low', expectedUpdatedAt: '2026-10-18T00:00:00.000Z' }));
});

it('cancels inline edits without updates and focuses the first permitted edit affordance', () => {
  render(<TaskEditor task={task} onClose={vi.fn()} />); enableEditing();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Title' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Discard this field' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('textbox')).toBeNull(); expect(mocks.updateTask).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: task.title })).toBeTruthy();
});

it('preserves whitespace and the notes limit without rewriting untouched due dates or associations', async () => {
  render(<TaskEditor task={task} onClose={vi.fn()} />); editField('Notes');
  const notes = screen.getByRole('textbox', { name: 'Notes' });
  const over = 'N'.repeat(1001);
  fireEvent.change(notes, { target: { value: over } });
  expect(notes).toHaveProperty('value', over);
  expect(notes.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(notes.getAttribute('aria-describedby')!)?.textContent).toBe('Task description must not exceed 1000 characters.');
  expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  fireEvent.change(notes, { target: { value: '  Notes\n  with whitespace  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { description: '  Notes\n  with whitespace  ', expectedUpdatedAt: task.updatedAt }));
});

it('validates a required title and keeps the draft after a failed save', async () => {
  mocks.updateTask.mockRejectedValue(new Error('Task update rejected'));
  render(<TaskEditor task={task} onClose={vi.fn()} />); editField('Title');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Enter a task title.')).toBeTruthy(); expect(mocks.updateTask).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Task update rejected')).toBeTruthy(); expect(screen.getByRole('textbox')).toHaveProperty('value', 'My draft');
});

it('uses only current Task statuses, saves completion through the Task pipeline and retains saved status on failure', async () => {
  render(<TaskEditor task={task} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Task status: To do' }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['To do', 'In progress', 'Completed', 'Cancelled']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Completed' }));
  await screen.findByRole('button', { name: 'Task status: Completed' });
  expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { status: 'completed', expectedUpdatedAt: task.updatedAt });
  mocks.updateTask.mockRejectedValue(new Error('Status failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Task status: Completed' })); fireEvent.click(screen.getByRole('menuitem', { name: 'To do' }));
  await screen.findByText('Status failed'); expect(screen.getByRole('button', { name: 'Task status: Completed' })).toBeTruthy();
});

it('preserves independent assignment and completion permissions', () => {
  mocks.canAssign = false; mocks.deniedPermissions = ['tasks.complete'];
  render(<TaskEditor task={task} onClose={vi.fn()} />); enableEditing();
  expect(screen.queryByRole('button', { name: 'Edit Assigned Agent' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit Title' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Task status:/ }));
  expect(screen.getByRole('menuitem', { name: 'Completed' }).getAttribute('aria-disabled')).toBe('true');
});

it.each(['assign', 'complete'] as const)('keeps %s-only permission independent of general editing for the owner', async mode => {
  mocks.canEdit = false; mocks.canAssign = mode === 'assign'; mocks.deniedPermissions = mode === 'assign' ? ['tasks.complete', 'tasks.archive'] : ['tasks.archive'];
  render(<TaskEditor task={task} onClose={vi.fn()} />);
  if (mode === 'assign') { enableEditing(); expect(screen.getByRole('button', { name: 'Edit Assigned Agent' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Edit Title' })).toBeNull(); }
  else { expect(screen.queryByRole('button', { name: 'Task actions' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: /^Task status:/ })); fireEvent.click(screen.getByRole('menuitem', { name: 'Completed' })); await waitFor(() => expect(mocks.updateTask).toHaveBeenCalled()); }
});

it('adapts eligible reassignment and historical read-only choices through the existing selector', async () => {
  mocks.detail.data = { ...task, assignedUserId: 'historical', assignedUser: { id: 'historical', firstName: 'Historical', lastName: 'Admin' } };
  render(<TaskEditor task={task} onClose={vi.fn()} />); editField('Assigned Agent');
  fireEvent.click(screen.getByRole('button', { name: 'Assigned Agent *' }));
  expect(await screen.findByRole('checkbox', { name: 'Historical Admin (current assignment, read-only)' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Test Owner' })); fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { assignedUserId: 'owner', expectedUpdatedAt: task.updatedAt }));
});

it('uses the Manila picker and saves only the changed due instant', async () => {
  mocks.detail.data = { ...task, dueDate: '2030-09-27T13:30:00.000Z' };
  render(<TaskEditor task={task} onClose={vi.fn()} />); editField('Due date and time');
  fireEvent.change(screen.getByLabelText('Due minute'), { target: { value: '23' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { dueDate: '2030-09-27T13:23:00.000Z', expectedUpdatedAt: task.updatedAt }));
});

it('adapts array-valued Deal editing, preserves legacy links and validates required Deals', async () => {
  mocks.detail.data = { ...task, dealIds: ['deal'], deals: [{ id: 'deal', title: 'Saved Deal' }], leadIds: ['historical'] };
  mocks.options.mockResolvedValue({ data: [{ id: 'deal', label: 'Saved Deal' }, { id: 'second', label: 'Second Deal' }] });
  render(<TaskEditor task={task} onClose={vi.fn()} />); editField('Associated Deals');
  fireEvent.click(screen.getByRole('button', { name: 'Associate task to deal *' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Saved Deal' })); fireEvent.click(screen.getByRole('button', { name: 'Done' })); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Select at least one Deal to associate with this task.'); expect(mocks.updateTask).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Associate task to deal *' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'Associate task to deal *' })); fireEvent.click(await screen.findByRole('checkbox', { name: 'Second Deal' })); fireEvent.click(screen.getByRole('button', { name: 'Done' })); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { dealIds: ['second'], expectedUpdatedAt: task.updatedAt }));
});

it('has no details footer and closes through the header X', () => {
  const close = vi.fn(); render(<TaskEditor task={task} onClose={close} />);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
  expect(dialog.querySelector('footer')).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close record' }));
  expect(close).toHaveBeenCalledOnce();
});

it.each(['header', 'escape', 'backdrop'])('protects an inline draft on %s close until Discard is confirmed', async source => {
  const close = vi.fn(); render(<TaskEditor task={task} onClose={close} />); editField('Title');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved title' } });
  const request = () => { const dialog = screen.getByRole('dialog'); if (source === 'header') fireEvent.click(screen.getByRole('button', { name: 'Close record' })); else if (source === 'escape') fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' }); else fireEvent.click(dialog.previousElementSibling!); };
  request(); fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(screen.getByRole('textbox')).toHaveProperty('value', 'Unsaved title'); expect(close).not.toHaveBeenCalled();
  request(); fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' })); await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it('retains the draft during busy saves and blocks competing edits and every close path', async () => {
  let finish!: (saved: typeof task) => void; mocks.updateTask.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const close = vi.fn(); render(<TaskEditor task={task} onClose={close} />); editField('Title'); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved title' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('textbox')).toHaveProperty('disabled', true); expect(screen.getByRole('button', { name: 'Close record' })).toHaveProperty('disabled', true);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); fireEvent.click(screen.getByRole('dialog').previousElementSibling!); expect(close).not.toHaveBeenCalled();
  finish({ ...task, title: 'Saved title' }); await screen.findByRole('heading', { name: 'Saved title' }); expect(close).not.toHaveBeenCalled();
});

it.each(['background', '409'])('preserves a field draft on %s conflicts and requires explicit reload', async mode => {
  const view = render(<TaskEditor task={task} onClose={vi.fn()} />); editField('Title'); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My draft' } });
  if (mode === '409') { mocks.updateTask.mockRejectedValue(Object.assign(new Error('Task changed'), { status: 409 })); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(mocks.detail.refetch).toHaveBeenCalled()); }
  mocks.detail.data = { ...task, title: 'Canonical title', updatedAt: '2026-10-20T00:00:00Z' }; view.rerender(<TaskEditor task={task} onClose={vi.fn()} />);
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'My draft'); expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved task' })); expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.getByRole('heading', { name: 'Canonical title' })).toBeTruthy();
});

it('preserves the archive confirmation, cancel behavior and existing archive mutation', async () => {
  const close = vi.fn(); render(<TaskEditor task={task} onClose={close} />);
  const openArchive = () => { fireEvent.click(screen.getByRole('button', { name: 'Task actions' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Archive task' })); };
  openArchive(); fireEvent.click(await screen.findByRole('button', { name: 'Cancel' })); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(mocks.deleteTask).not.toHaveBeenCalled();
  openArchive(); fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Archive task?' })).getByRole('button', { name: 'Archive' })); await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(mocks.deleteTask).toHaveBeenCalledWith(task.id);
});

it('uses a neutral loading header and clears protected details after authoritative access loss', () => {
  mocks.detail.data = undefined; mocks.detail.isInitialLoad = true;
  const view = render(<TaskEditor task={task} onClose={vi.fn()} />); expect(screen.getByRole('heading', { name: 'Task details' })).toBeTruthy(); expect(screen.queryByText(task.title)).toBeNull();
  mocks.detail = { ...mocks.detail, data: task, isInitialLoad: false }; view.rerender(<TaskEditor task={task} onClose={vi.fn()} />); expect(screen.getByRole('heading', { name: task.title })).toBeTruthy();
  enableEditing(); fireEvent.click(screen.getByRole('button', { name: 'Edit Notes' }));
  mocks.detail = { ...mocks.detail, data: undefined, errorStatus: 403, error: 'Access denied' }; view.rerender(<TaskEditor task={task} onClose={vi.fn()} />);
  expect(screen.getByText('Access denied')).toBeTruthy(); expect(screen.queryByText(task.title)).toBeNull(); expect(screen.queryByText(task.description)).toBeNull(); expect(screen.queryByRole('textbox')).toBeNull();
});

it('preserves the active association draft through nested Deal creation', async () => {
  mocks.detail.data = { ...task, dealIds: ['deal'], deals: [{ id: 'deal', title: 'Saved Deal' }] };
  render(<TaskEditor task={task} onClose={vi.fn()} />); editField('Associated Deals');
  fireEvent.click(screen.getByRole('button', { name: 'Associate task to deal *' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create a deal' }));
  expect(screen.getByRole('heading', { name: 'Create deal' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Finish deal creation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { dealIds: ['deal', 'new-deal'], expectedUpdatedAt: task.updatedAt }));
});

it('allows permitted owner edits on completed Tasks without granting completion or editing history', async () => {
  mocks.detail.data = { ...task, status: 'completed', completedAt: '2026-10-01T00:00:00Z', completedBy: user };
  mocks.deniedPermissions = ['tasks.complete'];
  render(<TaskEditor task={task} onClose={vi.fn()} />); editField('Title');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Completed Task title' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('heading', { name: 'Completed Task title' });
  expect(mocks.updateTask).toHaveBeenCalledWith(task.id, { title: 'Completed Task title', expectedUpdatedAt: task.updatedAt });
  expect(screen.getByText('Oct 1, 2026 08:00 AM by Test Owner')).toBeTruthy();
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
it('shows the create subtitle only in task creation and restores it after nested deal creation closes', async () => {
  render(<TaskEditor onClose={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Create task' })).toBeTruthy();
  const subtitle = screen.getByText('Complete the task details below.');
  expect(subtitle.classList.contains('text-sm')).toBe(true);
  expect(subtitle.classList.contains('dark:text-slate-400')).toBe(true);
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Keep task draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Associate task to deal *' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create a deal' }));
  expect(screen.getByRole('heading', { name: 'Create deal' })).toBeTruthy();
  expect(screen.queryByText('Complete the task details below.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel deal creation' }));
  expect(screen.getByText('Complete the task details below.')).toBeTruthy();
  expect(screen.getByLabelText('Title *')).toHaveProperty('value', 'Keep task draft');
});


it('preserves authorized self-assignment without Tasks Assign permission while requiring an explicit choice', async () => {
  mocks.canAssign = false;
  mocks.options.mockResolvedValue({ data: [{ id: 'owner', label: 'Test Owner' }, { id: 'other', label: 'Other Agent' }] });
  render(<TaskEditor links={{ dealIds: ['deal'] }} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Self-assigned draft' } });
  expect(screen.getByText('Select Agent...')).toBeTruthy();
  await selectAgent();
  expect(screen.queryByText('Other Agent')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
  await waitFor(() => expect(mocks.addTask).toHaveBeenCalledWith(expect.objectContaining({ assignedUserId: 'owner' })));
});

it('requires explicit agent selection and preserves the entire draft for resubmission', async () => {
  const close = vi.fn();
  render(<TaskEditor links={{ dealIds: ['deal'] }} onClose={close} />);
  expect(screen.getByText('Select Agent...')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'My draft' } });
  fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: 'My notes' } });
  const due = screen.getByLabelText('Due date and time *').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Select an assigned agent.');
  expect(mocks.addTask).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Title *') as HTMLInputElement).value).toBe('My draft');
  expect((screen.getByRole('textbox', { name: /Notes/ }) as HTMLTextAreaElement).value).toBe('My notes');
  expect(screen.getByLabelText('Due date and time *').textContent).toBe(due);
  await selectAgent();
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'My draft', description: 'My notes', assignedUserId: 'owner', dealIds: ['deal'] }));
});

it('shows the eligible-agent empty state without falling back to the logged-in user', async () => {
  mocks.options.mockResolvedValue({ data: [] });
  render(<TaskEditor onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assigned Agent *' }));
  expect(await screen.findByText('No eligible agents available.')).toBeTruthy();
  expect(screen.getByText('Select Agent...')).toBeTruthy();
});

it('retains dropdown searching and keyboard opening', async () => {
  render(<TaskEditor onClose={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Assigned Agent *' }), { key: 'ArrowDown' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search owner' }), { target: { value: 'Test' } });
  await screen.findByRole('checkbox', { name: 'Test Owner' });
  expect(mocks.options).toHaveBeenLastCalledWith('user', 'Test', expect.any(AbortSignal));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search owner' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Select owner' })).toBeNull();
});

it('requires a Deal for creation even when a legacy CRM context is supplied', async () => {
  render(<TaskEditor links={{ contactId: 'profile-id' }} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Follow up' } });
  await selectAgent();
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Select at least one Deal to associate with this task.');
  expect(mocks.addTask).not.toHaveBeenCalled();
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


it('retains the originating Deal and sends no direct associations during creation', async () => {
  mocks.addTask.mockResolvedValue(undefined);
  render(<TaskEditor links={{ dealIds: ['originating-deal'] }} preserveContextLinks onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Deal follow up' } });
  await selectAgent();
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
  await waitFor(() => expect(mocks.addTask).toHaveBeenCalledWith(expect.objectContaining({ dealIds: ['originating-deal'], title: 'Deal follow up' })));
  for (const kind of ['lead','contact','account']) expect(mocks.addTask.mock.calls[0][0]).not.toHaveProperty(kind + 'Ids');
});

it('cancels a clean Create Task form without saving', () => {
  const close = vi.fn();
  render(<TaskEditor onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledOnce();
  expect(mocks.addTask).not.toHaveBeenCalled();
});

it('guards Cancel with the existing unsaved-changes confirmation', async () => {
  const close = vi.fn();
  render(<TaskEditor onClose={close} />);
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Keep my task draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  const confirmation = await screen.findByRole('alertdialog');
  expect(confirmation.textContent).toContain('Discard unsaved changes?');
  expect(close).not.toHaveBeenCalled();
  expect(mocks.addTask).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByLabelText('Title *')).toHaveProperty('value', 'Keep my task draft');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
  expect(close).toHaveBeenCalledOnce();
  expect(mocks.addTask).not.toHaveBeenCalled();
});

it('keeps task fields through selected search and clear, then saves the chosen Deal IDs', async () => {
  mocks.options.mockImplementation(async kind => ({ data: kind === 'deal' ? [
    { id: 'first', label: 'First deal' }, { id: 'second', label: 'Second deal' }, { id: 'third', label: 'Third deal' },
  ] : [{ id: 'owner', label: 'Test Owner' }] }));
  render(<TaskEditor onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Follow up on selected deals' } });
  fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: 'Preserve these notes' } });
  await selectAgent();
  fireEvent.click(screen.getByRole('button', { name: 'Associate task to deal *' }));
  const options = await screen.findByRole('region', { name: 'Available deals' });
  fireEvent.click(await within(options).findByRole('checkbox', { name: 'First deal' }));
  fireEvent.click(within(options).getByRole('checkbox', { name: 'Second deal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Selected deals (2)' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search selected deals' }), { target: { value: 'First' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.getByLabelText('Title *')).toHaveProperty('value', 'Follow up on selected deals');
  expect(screen.getByRole('textbox', { name: /Notes/ })).toHaveProperty('value', 'Preserve these notes');
  fireEvent.click(within(options).getByRole('checkbox', { name: 'Third deal' }));
  fireEvent.click(within(options).getByRole('checkbox', { name: 'Second deal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
  await waitFor(() => expect(mocks.addTask).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Follow up on selected deals', description: 'Preserve these notes', assignedUserId: 'owner', dealIds: ['third', 'second'],
  })));
});
