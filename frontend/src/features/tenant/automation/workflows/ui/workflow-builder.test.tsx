import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  WORKFLOW_TRIGGERS,
  getAvailableActions,
  type WorkflowDraft,
} from '@leadcrm/shared';
import WorkflowBuilder from './visual-workflow-builder';
import { toast } from 'sonner';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { workflowsApi } from '@/shared/services/workflows.api';
vi.mock('@/shared/services/workflows.api', () => ({
  workflowsApi: { validate: vi.fn() },
}));
beforeEach(() => {
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
    initial?: WorkflowDraft;
  } = {},
) {
  const save = options.save ?? vi.fn().mockResolvedValue(undefined),
    close = vi.fn();
  render(
    <WorkflowBuilder
      initial={options.initial ?? structuredClone(initial)}
      triggers={WORKFLOW_TRIGGERS}
      actions={getAvailableActions()}
      canActivate={options.canActivate ?? true}
      readOnly={options.readOnly}
      onSave={save}
      onClose={close}
    />,
  );
  return { save, close };
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
describe('visual workflow editor', () => {
  it('cancels activation without saving and submits only once with one success toast', async () => {
    let resolve!: () => void;
    const save = vi.fn().mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    setup({ save });
    fireEvent.click(button('Save and activate'));
    fireEvent.click(button('Keep editing'));
    expect(save).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(button('Save and activate'));
    fireEvent.click(button('Confirm activation'));
    fireEvent.click(button('Working…'));
    expect(save).toHaveBeenCalledOnce();
    await act(async () => resolve());
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Workflow saved and activated.');
  });
  it('reports a rejected validation without saving or announcing success', async () => {
    const { save } = setup();
    vi.mocked(workflowsApi.validate).mockResolvedValue({ success: true, data: { valid: false, message: 'Reconnect the selected Gmail sender.' } });
    fireEvent.click(button('Validate'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Reconnect the selected Gmail sender.'));
    expect(save).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Reconnect');
  });
  it('describes saving an active workflow as paused rather than a new draft', async () => {
    const { save } = setup({ initial: { ...initial, isActive: true } });
    fireEvent.click(button('Save and pause'));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false })));
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Workflow saved and paused.');
    expect(screen.getByText('Changes saved. This workflow is paused.')).toBeTruthy();
  });
  it('updates condition summaries immediately and serializes numeric ALL rules', async () => {
    const { save } = setup();
    fireEvent.click(button(/ALL conditions match/));
    fireEvent.change(screen.getByLabelText('Condition 1 value'), {
      target: { value: '25000' },
    });
    expect(screen.getByText('Deal Value is greater than 25000')).toBeTruthy();
    fireEvent.click(button('Save and activate'));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(button('Confirm activation'));
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
            { type: 'create_task', config: { title: 'Prepare proposal' } },
            initial.actions[0],
            { type: 'create_notification', config: { title: 'Notify owner' } },
          ],
        }),
      ),
    );
  });
  it('supports click-to-place and excludes incompatible actions', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Add Send Email' })).toBeNull();
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
    fireEvent.click(button('Save and activate'));
    fireEvent.click(button('Confirm activation'));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          actions: [
            initial.actions[0],
            {
              type: 'create_task',
              enabled: false,
              config: { title: 'Later task' },
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
    fireEvent.click(button('Save and activate'));
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
      screen.getByRole('dialog', { name: 'Change workflow record type?' }),
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
    fireEvent.click(button('Save and activate'));
    fireEvent.click(button('Confirm activation'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Choose an active workspace user.',
      ),
    );
    expect(toast.error).toHaveBeenCalledWith('Choose an active workspace user.');
    expect(close).not.toHaveBeenCalled();
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
      screen.getByRole('dialog', { name: 'Discard unsaved changes?' }),
    ).toBeTruthy();
    fireEvent.click(button('Keep editing'));
    fireEvent.click(button('Save draft'));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();
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
  it('guards sidebar clicks before router rendering and replays only confirmed navigation', () => {
    const navigate = vi.fn();
    render(<nav><button onClick={navigate}>Sidebar destination</button></nav>);
    setup();
    fireEvent.click(button(/Configure action: 1. Create Task/));
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Unsaved task' },
    });
    fireEvent.click(button('Sidebar destination'));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(button('Keep editing'));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(button('Sidebar destination'));
    fireEvent.click(button('Discard changes'));
    expect(navigate).toHaveBeenCalledOnce();
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
      expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
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
