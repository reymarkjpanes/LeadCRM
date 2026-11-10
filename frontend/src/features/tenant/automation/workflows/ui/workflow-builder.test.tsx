import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  WORKFLOW_TRIGGERS,
  getAvailableActions,
  normalizeWorkflowAssignment,
  type WorkflowDraft,
} from '@leadcrm/shared';
import WorkflowBuilder from './visual-workflow-builder';
import { WORKFLOW_RECIPES, prepareWorkflowRecipe } from '../services/workflow-recipes';
import { resolveWorkflowTemplate } from '../services/workflow-stage-templates';
import { toast } from '@/shared/utils/toast';
vi.mock('@/shared/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { workflowsApi } from '@/shared/services/workflows.api';
import { requestNavigation } from '@/shared/lib/navigation-intent';
import { useLayout } from '@/features/tenant/layout/use-layout';
const routing = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => routing, usePathname: () => window.location.pathname }));
vi.mock('@/shared/hooks/use-permissions', () => ({ usePermissions: () => ['*'] }));
vi.mock('@/shared/services/workflows.api', () => ({
  workflowsApi: { validate: vi.fn(), getExecutions: vi.fn() },
}));
beforeEach(() => {
  window.history.replaceState(null, '', '/automation/workflows/new');
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi
      .fn()
      .mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
  });
  // Newer browser scroll implementations can return a Promise; effects must not return it.
  Element.prototype.scrollTo = vi.fn().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});
const initial: WorkflowDraft = {
  name: 'Deal follow-up',
  trigger: 'deal.created',
  isActive: false,
  conditions: {
    operator: 'AND',
    conditions: [
      { field: 'deal.value', operator: 'greater_than', value: 1000 },
    ],
  },
  actions: [{ type: 'create_task', config: { title: 'Call owner' } }],
};
function setup(
  options: {
    save?: (draft: WorkflowDraft) => Promise<void>;
    readOnly?: boolean;
    canActivate?: boolean;
    canPause?: boolean;
    canExecute?: boolean;
    initial?: WorkflowDraft;
  } = {},
) {
  const save = options.save ?? vi.fn().mockResolvedValue(undefined),
    close = vi.fn();
  const view = render(
    <WorkflowBuilder
      initial={options.initial ?? structuredClone(initial)}
      triggers={WORKFLOW_TRIGGERS}
      actions={getAvailableActions()}
      canActivate={options.canActivate ?? true}
      canPause={options.canPause ?? true}
      canExecute={options.canExecute ?? true}
      readOnly={options.readOnly}
      onSave={save}
      onClose={close}
    />,
  );
  return { save, close, view };
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
function unloadPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
it('shows run checks to read-only operators independently of management and hides them after revocation', () => {
  const props = { initial: structuredClone(initial), workflowId: 'rbac-workflow', triggers: WORKFLOW_TRIGGERS,
    actions: getAvailableActions(), readOnly: true, canActivate: false, canPause: false, canExecute: true,
    onSave: vi.fn(), onClose: vi.fn() };
  const view = render(<WorkflowBuilder {...props} />);
  expect(button('Test draft')).toHaveProperty('disabled', false);
  for (const name of ['Save draft', 'Publish workflow', 'Pause']) expect(screen.queryByRole('button', { name })).toBeNull();
  view.rerender(<WorkflowBuilder {...props} canExecute={false} />);
  expect(screen.queryByRole('button', { name: 'Test draft' })).toBeNull();
  expect(props.onSave).not.toHaveBeenCalled();
});

it('does not mount Activity history without the run-history grant', () => {
  render(<WorkflowBuilder initial={structuredClone(initial)} workflowId="private-workflow" triggers={WORKFLOW_TRIGGERS}
    actions={getAvailableActions()} canActivate={false} canExecute={false} canViewRuns={false} readOnly onSave={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(button('Activity'));
  expect(screen.getByText('Run history requires permission to view workflow runs.')).toBeTruthy();
  expect(workflowsApi.getExecutions).not.toHaveBeenCalled();
});

it('does not use activation permission to grant pause control', () => {
  const props = { initial: { ...structuredClone(initial), isActive: true }, workflowId: 'active-rbac-workflow', initialStatus: 'ACTIVE' as const,
    triggers: WORKFLOW_TRIGGERS, actions: getAvailableActions(), canActivate: true, canPause: false, canExecute: false,
    onPause: vi.fn().mockResolvedValue({ ...initial, id: 'active-rbac-workflow', isActive: false, status: 'PAUSED' }), onSave: vi.fn(), onClose: vi.fn() };
  const view = render(<WorkflowBuilder {...props} />);
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  view.rerender(<WorkflowBuilder {...props} canActivate={false} canPause readOnly />);
  fireEvent.click(button('Pause'));
  expect(props.onPause).toHaveBeenCalledOnce();
});
function editTask(title = 'Unsaved task') {
  fireEvent.click(button(/Configure action: 1. Create Task/));
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: title } });
}
function ModuleNavigation({ label, module }: { label: string; module: string }) {
  const { navigate } = useLayout();
  return <nav aria-label="Modules"><button onClick={() => requestNavigation(() => navigate(module))}>{label}</button></nav>;
}
describe('visual workflow editor', () => {
  it('saves literal Unicode names and multiline descriptions from shared details fields', async () => {
    const { save } = setup();
    const name = `ñ é 中文 日本語 한글 مرحبا 😊 & ' " < > ∑ ₱ e\u0301`;
    const description = `${name}\n<tag>literal text</tag>`;
    fireEvent.click(button('Workflow details'));
    fireEvent.change(screen.getByPlaceholderText('Enter workflow name...'), { target: { value: name } });
    fireEvent.change(screen.getByPlaceholderText('Describe what this workflow does...'), { target: { value: description } });
    fireEvent.click(button('Save draft'));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ name, description })));
  });
  it('edits a configured stage template, saves an inactive draft and preserves custom actions across option refresh', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const options = { users: [], templates: [], campaigns: [], pipelines: [{ id: 'pipeline', name: 'Sales', stages: [{ id: 'contacted', name: 'Contacted' }, { id: 'won', name: 'Approved', isWon: true }] }] };
    const identity = 'stage:entry:pipeline:contacted';
    const draft = resolveWorkflowTemplate(identity, options)!.recipe;
    const props = { initial: draft, templateIdentity: identity, options, triggers: WORKFLOW_TRIGGERS, actions: getAvailableActions(), canActivate: true, onSave: save, onClose: vi.fn() };
    const view = render(<WorkflowBuilder {...props} />);
    fireEvent.click(button(/Configure action: 1. Create Task/));
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Administrator task wording' } });
    fireEvent.change(screen.getByLabelText('Due in days'), { target: { value: '4' } });
    const renamed = structuredClone(options); renamed.pipelines[0].stages[0].name = 'Contacted renamed';
    view.rerender(<WorkflowBuilder {...props} options={renamed} />);
    expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe('Administrator task wording');
    fireEvent.click(button(/Configure condition:/));
    expect((screen.getByLabelText('Template entry stage') as HTMLSelectElement).value).toBe('contacted');
    expect([...((screen.getByLabelText('Template entry stage') as HTMLSelectElement).options)].map(option => option.value)).toEqual(['', 'contacted']);
    fireEvent.click(button('Save draft'));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ isActive: false, actions: [{ type: 'create_task', config: { title: 'Administrator task wording', dueDaysFromNow: 4, assignmentTarget: { type: 'record_owner' } } }], conditions: { conditions: [{ field: 'deal.pipelineId', value: 'pipeline' }, { field: 'event.newStageId', value: 'contacted' }] } });
  });

  it('keeps an unavailable configured stage visible for repair and prevents saving without losing edits', async () => {
    const save = vi.fn();
    const options = { users: [], templates: [], campaigns: [], pipelines: [{ id: 'pipeline', name: 'Sales', stages: [{ id: 'contacted', name: 'Contacted' }] }] };
    const identity = 'stage:entry:pipeline:contacted';
    const props = { initial: resolveWorkflowTemplate(identity, options)!.recipe, templateIdentity: identity, options, triggers: WORKFLOW_TRIGGERS, actions: getAvailableActions(), canActivate: true, onSave: save, onClose: vi.fn() };
    const view = render(<WorkflowBuilder {...props} />);
    fireEvent.click(button(/Configure action: 1. Create Task/));
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Keep my edits' } });
    view.rerender(<WorkflowBuilder {...props} options={{ ...options, pipelines: [] }} />);
    expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe('Keep my edits');
    fireEvent.click(button('Save draft'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/unavailable|available record/));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Unavailable selection — repair required' })).toBeTruthy();
  });

  it('links template source/target choices to persisted rules and action config from either inspector', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const options = { users: [], templates: [], campaigns: [], pipelines: [{ id: 'pipeline', name: 'Sales', stages: [{ id: 'source', name: 'Lead', isWon: false, isLost: false }, { id: 'target', name: 'Contacted', isWon: false, isLost: false }, { id: 'won', name: 'Won', isWon: true, isLost: false }] }] };
    render(<WorkflowBuilder initial={prepareWorkflowRecipe(WORKFLOW_RECIPES[17], options)} templateIndex={17} options={options} triggers={WORKFLOW_TRIGGERS} actions={getAvailableActions()} canActivate onSave={save} onClose={vi.fn()} />);
    fireEvent.click(button(/Configure action: 1. Move Deal Stage/));
    expect([...((screen.getByLabelText('Template target stage') as HTMLSelectElement).options)].map(option => option.value)).toEqual(['', 'source', 'target']);
    fireEvent.change(screen.getByLabelText('Template source stage'), { target: { value: 'source' } });
    fireEvent.change(screen.getByLabelText('Template target stage'), { target: { value: 'target' } });
    fireEvent.click(button(/Configure condition:/));
    expect((screen.getByLabelText('Template source stage') as HTMLSelectElement).value).toBe('source');
    expect((screen.getByLabelText('Template target stage') as HTMLSelectElement).value).toBe('target');
    fireEvent.click(button('Save draft'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ isActive: false, conditions: { operator: 'AND', conditions: [{ field: 'deal.pipelineId', value: 'pipeline' }, { field: 'deal.stageId', value: 'source' }] }, actions: [{ type: 'move_deal_stage', config: { stageId: 'target' } }, { type: 'create_task' }] });
  });
  it('updates the canvas after deleting the middle condition and restores rules through undo and redo', () => {
    setup({ initial: { ...initial, conditions: { operator: 'AND', conditions: [
      { field: 'deal.title', operator: 'equals', value: 'First' },
      { field: 'deal.title', operator: 'equals', value: 'Middle' },
      { field: 'deal.title', operator: 'equals', value: 'Last' },
    ] } } });
    fireEvent.click(button(/Configure condition:/));
    fireEvent.click(button('Remove condition 2'));
    expect((screen.getByLabelText('Condition 2 value') as HTMLInputElement).value).toBe('Last');
    expect(screen.queryByText('Deal Title is Middle')).toBeNull();
    fireEvent.click(button('Undo'));
    fireEvent.click(button(/Configure condition:/));
    expect((screen.getByLabelText('Condition 2 value') as HTMLInputElement).value).toBe('Middle');
    fireEvent.click(button('Redo'));
    fireEvent.click(button(/Configure condition:/));
    expect((screen.getByLabelText('Condition 2 value') as HTMLInputElement).value).toBe('Last');
  });
  it('cancels activation without saving and submits only once with one success toast', async () => {
    let resolve!: () => void;
    const save = vi.fn().mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    setup({ save });
    fireEvent.click(button('Publish workflow'));
    fireEvent.click(button('Keep editing'));
    expect(save).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(button('Publish workflow'));
    fireEvent.click(button(/Activate workflow|Publish changes/));
    fireEvent.click(button('Working…'));
    expect(save).toHaveBeenCalledOnce();
    await act(async () => resolve());
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Workflow published.');
  });
  it('reports a rejected validation without saving or announcing success', async () => {
    const { save } = setup();
    vi.mocked(workflowsApi.validate).mockResolvedValue({ success: true, data: { valid: false, message: 'Reconnect the selected Gmail sender.' } });
    fireEvent.click(button('Validate'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Reconnect the selected Gmail sender.'); expect(toast.error).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Reconnect');
  });
  it('saves a draft while keeping the published workflow active', async () => {
    const { save } = setup({ initial: { ...initial, isActive: true } });
    fireEvent.click(button('Save draft'));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false })));
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Draft saved; published version remains active.');
    expect(screen.getByText('Draft saved. The published version remains active.')).toBeTruthy();
  });
  it('updates condition summaries immediately and serializes numeric ALL rules', async () => {
    const { save } = setup();
    fireEvent.click(button(/ALL conditions match/));
    fireEvent.change(screen.getByLabelText('Condition 1 value'), {
      target: { value: '25000' },
    });
    expect(screen.getByText('Deal Value is greater than 25000')).toBeTruthy();
    fireEvent.click(button('Publish workflow'));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(button(/Activate workflow|Publish changes/));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
          conditions: {
            operator: 'AND',
            conditions: [
              { field: 'deal.value', operator: 'greater_than', value: 25000 },
            ],
          },
        }),
      ),
    );
  });
  it('inserts between actions using the same library, preserves config through reordering and undo', async () => {
    const { save } = setup({
      initial: {
        ...initial,
        actions: [
          ...initial.actions,
          { type: 'create_notification', config: { title: 'Notify owner' } },
        ],
      },
    });
    fireEvent.click(button('Add step at position 2'));
    fireEvent.click(button('Add Create Task'));
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Prepare proposal' },
    });
    fireEvent.click(button('Move action 2 up'));
    expect(screen.getByLabelText('Task title').getAttribute('value')).toBe(
      'Prepare proposal',
    );
    fireEvent.click(button('Remove action 1'));
    fireEvent.click(button('Undo'));
    fireEvent.click(button('Save draft'));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          actions: [
            { type: 'create_task', config: { title: 'Prepare proposal', assignmentTarget: { type: 'record_owner' } } },
            normalizeWorkflowAssignment(initial.actions[0]),
            { type: 'create_notification', config: { title: 'Notify owner' } },
          ],
        }),
      ),
    );
  });
  it('supports click-to-place and excludes incompatible actions', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Add Send Email' })).toBeTruthy();
    fireEvent.click(button('Add Create Task'));
    expect(button('Insert at position 1')).toBeTruthy();
    fireEvent.click(button('Insert at position 1'));
    expect(screen.getByLabelText('Task title')).toBeTruthy();
  });
  it('duplicates independent configuration and saves real disabled state', async () => {
    const { save } = setup();
    fireEvent.click(button('Duplicate action 1'));
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Later task' },
    });
    fireEvent.click(screen.getByLabelText('Action enabled'));
    expect(
      screen.getByText('Disabled · skipped during execution'),
    ).toBeTruthy();
    fireEvent.click(button('Publish workflow'));
    fireEvent.click(button(/Activate workflow|Publish changes/));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          actions: [
            normalizeWorkflowAssignment(initial.actions[0]),
            {
              type: 'create_task',
              enabled: false,
              config: { title: 'Later task', assignmentTarget: { type: 'record_owner' } },
            },
          ],
        }),
      ),
    );
  });
  it('blocks activation with only disabled actions, but permits saving the draft', async () => {
    const { save } = setup({
      initial: {
        ...initial,
        actions: [{ type: 'send_email', enabled: false, config: {} }],
        trigger: 'lead.created',
        conditions: null,
      },
    });
    fireEvent.click(button('Publish workflow'));
    expect(screen.getByRole('alert').textContent).toContain(
      'Enable at least one action',
    );
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(button('Save draft'));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
  });
  it('previews entity changes, lets users cancel, and preserves compatible actions', () => {
    setup();
    fireEvent.click(button(/Configure trigger: Deal Created/));
    fireEvent.change(screen.getByLabelText('Start when'), {
      target: { value: 'lead.created' },
    });
    expect(
      screen.getByRole('alertdialog', { name: 'Change workflow record type?' }),
    ).toBeTruthy();
    fireEvent.click(button('Keep current trigger'));
    expect(screen.getByText('Deal Value is greater than 1000')).toBeTruthy();
  });
  it('keeps edits after a server error and validates without saving', async () => {
    const { save, close } = setup({
      save: vi
        .fn()
        .mockRejectedValue(new Error('Choose an active workspace user.')),
    });
    fireEvent.click(button('Publish workflow'));
    fireEvent.click(button(/Activate workflow|Publish changes/));
    await waitFor(() =>
      expect(screen.getByRole('alertdialog').textContent).toContain(
        'Choose an active workspace user.',
      ),
    );
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Choose an active workspace user.'); expect(toast.error).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(button('Keep editing'));
    vi.mocked(workflowsApi.validate).mockResolvedValue({
      success: true,
      data: {
        valid: true,
        message: 'Configuration valid. No actions executed.',
      },
    });
    fireEvent.click(button('Validate'));
    await waitFor(() =>
      expect(
        screen.getByText('Configuration valid. No actions executed.')
          .textContent,
      ).toContain('No actions executed'),
    );
    expect(save).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith('Configuration valid. No actions executed.');
  });
  it('guards dirty exits and leaves saved changes in the editor', async () => {
    const { save, close } = setup();
    fireEvent.click(button(/Configure action: 1. Create Task/));
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'New title' },
    });
    fireEvent.click(button('Back to workflows'));
    expect(
      screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' }),
    ).toBeTruthy();
    fireEvent.click(button('Keep editing'));
    expect(screen.getByLabelText('Task title')).toHaveProperty('value', 'New title');
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(button('Save draft'));
    await screen.findByText('Draft saved. This workflow is inactive.');
    expect(save).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    await waitFor(() => expect(unloadPrevented()).toBe(false));
    const navigate = vi.fn(); act(() => requestNavigation(navigate)); expect(navigate).toHaveBeenCalledOnce();
    fireEvent.click(button('Back to workflows')); expect(close).toHaveBeenCalledOnce();
    editTask('Edited after saving');
    act(() => requestNavigation(navigate)); expect(navigate).toHaveBeenCalledOnce();
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
    expect(unloadPrevented()).toBe(true);
  });
  it('keeps read-only configuration inspectable and omits mutations', () => {
    setup({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    fireEvent.click(button(/Configure action: 1. Create Task/));
    expect(
      screen.getByLabelText('Task title').closest('fieldset')?.disabled,
    ).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Remove action 1' }),
    ).toBeNull();
  });
  describe.each([false, true])('module navigation (dirty=%s)', dirty => {
    it.each([
      ['Dashboard', 'dashboard', '/dashboard'], ['Leads', 'leads', '/crm/leads'], ['Contacts', 'contacts', '/crm/contacts'], ['Accounts', 'accounts', '/crm/accounts'],
      ['Deals', 'pipeline', '/crm/pipeline'], ['Deal records', 'deals', '/crm/deals'], ['Tasks', 'tasks', '/operations/taskboard'], ['Campaigns', 'campaigns', '/marketing/campaigns'],
      ['Workflows', 'workflows', '/automation/workflows'], ['Settings', 'settings', '/settings'], ['Team settings', 'settings-users', '/settings?tab=users'],
      ['Profile settings', 'profile-settings', '/settings/profile'], ['Forms', 'forms', '/marketing/forms'], ['Help', 'help', '/help'], ['Inbox', 'inbox', '/inbox'],
    ])('resumes the exact %s destination once', async (label, module, destination) => {
      render(<ModuleNavigation label={label} module={module} />);
      const { save, close } = setup();
      if (dirty) editTask();
      fireEvent.click(button(label));
      if (dirty) {
        const dialog = screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
        expect(within(dialog).getByText('Your last saved workflow will be kept.')).toBeTruthy();
        expect(within(dialog).queryByRole('button', { name: 'Save changes' })).toBeNull();
        expect(routing.push).not.toHaveBeenCalled();
        fireEvent.click(button('Keep editing'));
        expect(screen.getByLabelText('Task title')).toHaveProperty('value', 'Unsaved task');
        expect(routing.push).not.toHaveBeenCalled(); expect(unloadPrevented()).toBe(true);
        fireEvent.click(button(label));
        const discard = button('Discard changes'); fireEvent.click(discard); fireEvent.click(discard);
      }
      await waitFor(() => expect(routing.push).toHaveBeenCalledExactlyOnceWith(destination));
      expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(unloadPrevented()).toBe(false);
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    });
  });
  it('allows clean Back immediately', () => {
    const { close } = setup(); fireEvent.click(button('Back to workflows'));
    expect(close).toHaveBeenCalledOnce(); expect(screen.queryByRole('alertdialog')).toBeNull(); expect(unloadPrevented()).toBe(false);
  });
  it.each(['Keep editing', 'Close confirmation', 'Escape', 'backdrop'])('preserves dirty edits when Back is canceled with %s', method => {
    const { close, save } = setup(); editTask(); fireEvent.click(button('Back to workflows'));
    if (method === 'Escape') fireEvent.keyDown(window.document, { key: 'Escape' });
    else if (method === 'backdrop') fireEvent.click(window.document.querySelector('[data-confirm-action-layer] > [aria-hidden]')!);
    else fireEvent.click(button(method));
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(close).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Task title')).toHaveProperty('value', 'Unsaved task'); expect(unloadPrevented()).toBe(true);
  });
  it('discards Back once without saving and rearms protection after another edit', async () => {
    const { close, save } = setup(); editTask(); fireEvent.click(button('Back to workflows'));
    const discard = button('Discard changes'); fireEvent.click(discard); fireEvent.click(discard);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(close).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled(); expect(unloadPrevented()).toBe(false);
    editTask('Another edit');
    fireEvent.click(button('Back to workflows'));
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy(); expect(close).toHaveBeenCalledOnce(); expect(unloadPrevented()).toBe(true);
  });
  it('captures internal links with query/hash and clears canceled destinations', async () => {
    const clicked = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(<header><a href="/crm/contacts?highlight=contact-1#details" onClick={clicked}>Contact destination</a></header>);
    const { close } = setup(); editTask();
    fireEvent.click(screen.getByText('Contact destination')); expect(clicked).not.toHaveBeenCalled(); expect(routing.push).not.toHaveBeenCalled();
    fireEvent.click(button('Keep editing')); fireEvent.click(button('Back to workflows')); fireEvent.click(button('Discard changes'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(close).toHaveBeenCalledOnce(); expect(routing.push).not.toHaveBeenCalled();
    editTask('More edits'); fireEvent.click(screen.getByText('Contact destination')); fireEvent.click(button('Discard changes'));
    await waitFor(() => expect(routing.push).toHaveBeenCalledExactlyOnceWith('/crm/contacts?highlight=contact-1#details'));
    expect(clicked).not.toHaveBeenCalled();
  });
  it('retains the first pending header destination until confirmation', async () => {
    const first = vi.fn(), second = vi.fn();
    render(<header><button onClick={() => requestNavigation(first)}>First destination</button><button onClick={() => requestNavigation(second)}>Second destination</button></header>);
    setup(); editTask();
    fireEvent.click(button('First destination')); fireEvent.click(button('Second destination')); fireEvent.click(button('Discard changes'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
  });
  it.each(['new tab', 'named target', 'download', 'same page', 'exact current', 'external', 'ctrl', 'meta', 'shift', 'alt', 'middle'])('does not intercept %s links while dirty', kind => {
    const clicked = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(<a href={kind === 'same page' ? '#section' : kind === 'exact current' ? window.location.href : kind === 'external' ? 'https://example.test' : '/crm/contacts'} target={kind === 'new tab' ? '_blank' : kind === 'named target' ? 'other-window' : undefined} download={kind === 'download' || undefined} onClick={clicked}>Destination</a>);
    setup(); editTask();
    fireEvent.click(screen.getByText('Destination'), { ctrlKey: kind === 'ctrl', metaKey: kind === 'meta', shiftKey: kind === 'shift', altKey: kind === 'alt', button: kind === 'middle' ? 1 : 0 });
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(clicked).toHaveBeenCalledOnce(); expect(unloadPrevented()).toBe(true);
  });
  it('keeps failed drafts dirty and protected', async () => {
    const { close } = setup({ save: vi.fn().mockRejectedValue(new Error('Save failed')) }); editTask();
    fireEvent.click(button('Save draft')); await screen.findByText('Save failed');
    expect(screen.getByLabelText('Task title')).toHaveProperty('value', 'Unsaved task'); expect(unloadPrevented()).toBe(true);
    fireEvent.click(button('Back to workflows')); expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
  });
  it('allows dirty editor tabs, inspector controls, menus, undo/redo, validation and activation controls', async () => {
    const menuAction = vi.fn(); render(<div role="menu"><button role="menuitem" onClick={menuAction}>Editor menu action</button></div>);
    const { close, save } = setup(); editTask();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editor menu action' })); expect(menuAction).toHaveBeenCalledOnce();
    for (const name of ['Activity', 'Builder', 'Workflow details', 'Undo', 'Redo']) {
      fireEvent.click(button(name)); expect(screen.queryByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeNull();
    }
    fireEvent.click(button(/Configure trigger:/));
    fireEvent.click(button(/Configure condition:/));
    fireEvent.change(screen.getByLabelText('Condition 1 value'), { target: { value: '2000' } });
    fireEvent.click(button('Add condition'));
    expect(screen.queryByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeNull();
    fireEvent.click(button('Remove condition 2'));
    fireEvent.click(button(/Configure action: 1. Create Task/));
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Another title' } });
    fireEvent.click(button('Duplicate action 1')); fireEvent.click(button('Undo'));
    expect(button('Test draft')).toHaveProperty('disabled', true); fireEvent.click(button('Test draft'));
    vi.mocked(workflowsApi.validate).mockResolvedValue({ success: true, data: { valid: true, message: 'Configuration valid. No actions executed.' } });
    fireEvent.click(button('Validate'));
    await screen.findByText('Configuration valid. No actions executed.');
    expect(workflowsApi.validate).toHaveBeenCalledOnce();
    fireEvent.click(button('Publish workflow'));
    expect(screen.getByRole('alertdialog', { name: 'Activate workflow?' })).toBeTruthy();
    fireEvent.click(button('Keep editing'));
    expect(screen.queryByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeNull();
    expect(close).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(unloadPrevented()).toBe(true);
  });
  it('removes intent, link and unload guards when unmounted', () => {
    const clicked = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(<a href="/help" onClick={clicked}>Help destination</a>);
    const { view } = setup(); editTask(); view.unmount();
    const navigate = vi.fn(); requestNavigation(navigate); fireEvent.click(screen.getByText('Help destination'));
    expect(navigate).toHaveBeenCalledOnce(); expect(clicked).toHaveBeenCalledOnce(); expect(unloadPrevented()).toBe(false);
  });
  it('guards browser history while allowing the first-save URL replacement', () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: navigation,
    });
    try {
      setup();
      fireEvent.click(button(/Configure action: 1. Create Task/));
      fireEvent.change(screen.getByLabelText('Task title'), {
        target: { value: 'Unsaved task' },
      });
      const navigate = (navigationType: string) => {
        const event = new Event('navigate', { cancelable: true });
        Object.assign(event, {
          navigationType,
          destination: { url: 'http://localhost/automation/workflows' },
        });
        act(() => { navigation.dispatchEvent(event); });
        return event;
      };
      expect(navigate('replace').defaultPrevented).toBe(false);
      expect(navigate('traverse').defaultPrevented).toBe(true);
      expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
      fireEvent.click(button('Keep editing'));
    } finally {
      Reflect.deleteProperty(window, 'navigation');
    }
  });
  it('retains unsupported legacy steps for explicit repair without exposing raw config', () => {
    const { save } = setup({
      initial: {
        ...initial,
        actions: [{ type: 'obsolete_action', message: 'Legacy' }],
      } as unknown as WorkflowDraft,
    });
    expect(screen.getByText(/This older action is unsupported/)).toBeTruthy();
    expect(screen.queryByText('obsolete_action')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
