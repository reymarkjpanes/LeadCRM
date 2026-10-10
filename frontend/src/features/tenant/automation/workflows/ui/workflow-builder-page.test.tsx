import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getAvailableActions, WORKFLOW_TRIGGERS } from '@leadcrm/shared';
import WorkflowBuilderPage from './workflow-builder-page';
import { WORKFLOW_RECIPES } from '../services/workflow-recipes';

const navigation = vi.hoisted(() => ({ query: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
const options = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => navigation, useParams: () => ({}), useSearchParams: () => navigation.query }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: { id: 'user' }, userCan: () => true }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ addWorkflow: vi.fn(), updateWorkflow: vi.fn() }) }));
vi.mock('@/shared/services/workflows.api', () => ({ getWorkflowMetadata: async () => ({ triggers: WORKFLOW_TRIGGERS, actions: getAvailableActions() }),
  workflowsApi: { options } }));
vi.mock('./visual-workflow-builder', () => ({ default: ({ initial }: { initial: { name: string } }) => <div data-testid="loaded-template">{initial.name}</div> }));
beforeEach(() => { vi.clearAllMocks(); options.mockResolvedValue({ data: { users: [], pipelines: [], templates: [], campaigns: [] } }); navigation.query = new URLSearchParams(); });
afterEach(cleanup);

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
  expect(WORKFLOW_RECIPES[index]).toEqual(original);
});

it.each(['-1', '999', '1.5', 'unknown', ''])('rejects unavailable template URL %s with recovery navigation', async value => {
  navigation.query.set('template', value);
  render(<WorkflowBuilderPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('template is unavailable');
  expect(screen.queryByTestId('loaded-template')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to workflows' }));
  expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/automation/workflows');
});
