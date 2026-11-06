import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getAvailableActions, WORKFLOW_TRIGGERS, type WorkflowOptions, type TriggerDefinition } from '@leadcrm/shared';
import { invalidatePageCache } from '@/shared/cache/page-cache';
import WorkflowBuilderPage from './workflow-builder-page';
import { WORKFLOW_RECIPES } from '../services/workflow-recipes';

const navigation = vi.hoisted(() => ({ query: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
const options = vi.hoisted(() => vi.fn());
const authScope = vi.hoisted(() => ({ tenantId: 'tenant', userId: 'user' }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, useParams: () => ({}), useSearchParams: () => navigation.query }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: authScope.tenantId }, user: { id: authScope.userId }, userCan: () => true }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ addWorkflow: vi.fn(), updateWorkflow: vi.fn() }) }));
vi.mock('@/shared/services/workflows.api', () => ({ getWorkflowMetadata: async () => ({ triggers: WORKFLOW_TRIGGERS, actions: getAvailableActions() }),
  withWorkflowTimeout: <T,>(request: Promise<T>) => request, workflowsApi: { options } }));
vi.mock('./visual-workflow-builder', () => ({ default: ({ initial, templateIndex, templateIdentity, triggers, options: choices }: { initial: { name: string }; templateIndex?: number; templateIdentity?: string | number; triggers: TriggerDefinition[]; options: WorkflowOptions }) => {
  const [name, setName] = React.useState(initial.name);
  return <><div data-testid="loaded-template">{initial.name}</div><output data-testid="template-index">{templateIndex}</output><output data-testid="template-identity">{templateIdentity}</output><output data-testid="initial-draft">{JSON.stringify(initial)}</output><input aria-label="Draft name" value={name} onChange={event => setName(event.target.value)} /><output data-testid="fields">{triggers.flatMap(trigger => trigger.fields.map(field => field.label)).join(',')}</output><output data-testid="users">{choices.users.map(user => user.name).join(',')}</output></>;
} }));
beforeEach(() => {
  vi.clearAllMocks();
  authScope.tenantId = 'tenant';
  authScope.userId = 'user';
  options.mockReset().mockResolvedValue({ data: { users: [], pipelines: [], templates: [], campaigns: [] } });
  navigation.query = new URLSearchParams();
});
afterEach(cleanup);

async function renderLoadedBuilder() {
  let view!: ReturnType<typeof render>;
  // Flush initialization and the effect that subscribes to cache invalidations.
  await act(async () => {
    view = render(<WorkflowBuilderPage />);
  });
  expect(screen.getByTestId('loaded-template')).toBeTruthy();
  return view;
}

it('shows the structured skeleton immediately and removes it when scratch initialization resolves', async () => {
  let resolve!: (value: unknown) => void;
  options.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<WorkflowBuilderPage />);
  const loading = screen.getByRole('status', { name: 'Loading workflow builder' });
  expect(loading.querySelector('.animate-pulse')).toBeTruthy();
  expect(loading.querySelector('.animate-spin')).toBeNull();
  for (const label of ['Builder library placeholder', 'Workflow canvas placeholder', 'Step configuration placeholder']) expect(loading.querySelector(`[aria-label="${label}"]`)).toBeTruthy();
  await act(async () => resolve({ data: { users: [], pipelines: [], templates: [], campaigns: [] } }));
  expect(await screen.findByTestId('loaded-template')).toBeTruthy();
  expect(screen.queryByRole('status', { name: 'Loading workflow builder' })).toBeNull();
});

it('replaces failed initialization with recovery controls and retries the same template', async () => {
  navigation.query.set('template', '0');
  options.mockRejectedValueOnce(new Error('Options unavailable'));
  render(<WorkflowBuilderPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('Options unavailable');
  expect(screen.queryByRole('status', { name: 'Loading workflow builder' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect((await screen.findByTestId('loaded-template')).textContent).toBe(WORKFLOW_RECIPES[0].name);
});

it.each(WORKFLOW_RECIPES.map((recipe, index) => [recipe.name, index] as const))('preserves the existing URL for %s even when omitted from the chooser', async (name, index) => {
  navigation.query.set('template', String(index));
  const original = structuredClone(WORKFLOW_RECIPES[index]);
  render(<WorkflowBuilderPage />);
  expect((await screen.findByTestId('loaded-template')).textContent).toBe(name);
  expect(screen.getByTestId('template-index').textContent).toBe(String(index));
  expect(WORKFLOW_RECIPES[index]).toEqual(original);
});

it('refreshes declared custom fields after a scoped invalidation while preserving editor state', async () => {
  await renderLoadedBuilder();
  fireEvent.change(screen.getByLabelText('Draft name'), { target: { value: 'Unsaved edits' } });
  options.mockResolvedValueOnce({ data: { users: [], pipelines: [], templates: [], campaigns: [], customFields: [{ id: '2857e8ec-456d-4503-b955-46db45560974', technicalAlias: 'score', name: 'Latest Score', module: 'leads', type: 'Number', group: 'Basic Information', active: true, required: false, visibleInForm: true, visibleInDetails: true, order: 0, options: [], version: 1 }] } });
  act(() => invalidatePageCache('settings', 'another-tenant'));
  expect(options).toHaveBeenCalledTimes(1);
  act(() => invalidatePageCache('settings', 'tenant'));
  await waitFor(() => expect(screen.getByTestId('fields').textContent).toContain('Latest Score'));
  expect((screen.getByLabelText('Draft name') as HTMLInputElement).value).toBe('Unsaved edits');
});

it('coalesces invalidations and discards an obsolete response before applying the latest choices', async () => {
  await renderLoadedBuilder();
  let finish!: (value: unknown) => void;
  options.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  options.mockResolvedValueOnce({ data: { users: [{ id: 'current', name: 'Current choices' }], pipelines: [], templates: [], campaigns: [] } });
  act(() => invalidatePageCache('users', 'tenant'));
  await waitFor(() => expect(options).toHaveBeenCalledTimes(2));
  act(() => { invalidatePageCache('settings', 'tenant'); invalidatePageCache('users', 'tenant'); });
  await act(async () => finish({ data: { users: [{ id: 'old', name: 'Obsolete choices' }], pipelines: [], templates: [], campaigns: [] } }));
  await waitFor(() => expect(screen.getByTestId('users').textContent).toBe('Current choices'));
  expect(options).toHaveBeenCalledTimes(3);
});

it('clears protected choices on permission loss and preserves edits through retry', async () => {
  options.mockResolvedValueOnce({ data: { users: [{ id: 'first', name: 'Protected agent' }], pipelines: [], templates: [], campaigns: [] } });
  await renderLoadedBuilder();
  fireEvent.change(screen.getByLabelText('Draft name'), { target: { value: 'Keep this edit' } });
  options.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
  act(() => invalidatePageCache('roles', 'tenant'));
  await screen.findByRole('button', { name: 'Retry choices' });
  expect(screen.getByTestId('users').textContent).toBe('');
  expect(screen.getByTestId('fields').textContent).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Retry choices' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry choices' })).toBeNull());
  expect((screen.getByLabelText('Draft name') as HTMLInputElement).value).toBe('Keep this edit');
});

it('hides the previous user choices immediately during scope changes', async () => {
  options.mockResolvedValueOnce({ data: { users: [{ id: 'agent', name: 'Previous user choices' }], pipelines: [], templates: [], campaigns: [] } });
  const view = await renderLoadedBuilder();
  let finish!: (value: unknown) => void;
  options.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  authScope.userId = 'different-user';
  view.rerender(<WorkflowBuilderPage />);
  expect(screen.queryByTestId('loaded-template')).toBeNull();
  expect(screen.queryByText('Previous user choices')).toBeNull();
  expect(options).toHaveBeenCalledTimes(2);
  await act(async () => finish({ data: { users: [], pipelines: [], templates: [], campaigns: [] } }));
  await screen.findByTestId('loaded-template');
  expect(screen.getByTestId('users').textContent).toBe('');
});

it.each(['-1', '999', '1.5', 'unknown', ''])('rejects unavailable template URL %s with recovery navigation', async value => {
  navigation.query.set('template', value);
  render(<WorkflowBuilderPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('template is unavailable');
  expect(screen.queryByTestId('loaded-template')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to workflows' }));
  expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/automation/workflows');
});

it('resolves a stable configured stage URL to current IDs and an inactive independent draft', async () => {
  const identity = 'stage:entry:pipeline:contacted';
  navigation.query.set('template', identity);
  options.mockResolvedValueOnce({ data: { users: [], templates: [], campaigns: [], pipelines: [{ id: 'pipeline', name: 'Current sales', stages: [{ id: 'contacted', name: 'Contacted' }] }] } });
  render(<WorkflowBuilderPage />);
  expect((await screen.findByTestId('loaded-template')).textContent).toBe('Current sales / Contacted: Stage entry follow-up');
  expect(screen.getByTestId('template-identity').textContent).toBe(identity);
  const draft = JSON.parse(screen.getByTestId('initial-draft').textContent!);
  expect(draft.isActive).toBe(false);
  expect(draft.conditions.conditions).toEqual([{ field: 'deal.pipelineId', operator: 'equals', value: 'pipeline' }, { field: 'event.newStageId', operator: 'equals', value: 'contacted' }]);
});

it('resolves stable existing starter IDs and rejects configured IDs unavailable to the current user', async () => {
  navigation.query.set('template', 'won-deal-handoff');
  const view = render(<WorkflowBuilderPage />);
  expect((await screen.findByTestId('loaded-template')).textContent).toBe(WORKFLOW_RECIPES[18].name);
  navigation.query.set('template', 'stage:entry:foreign:contacted');
  view.rerender(<WorkflowBuilderPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('template is unavailable');
  expect(screen.queryByTestId('loaded-template')).toBeNull();
});
