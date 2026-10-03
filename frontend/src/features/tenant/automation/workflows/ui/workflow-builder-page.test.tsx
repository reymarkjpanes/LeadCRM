import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getAvailableActions, WORKFLOW_TRIGGERS } from '@leadcrm/shared';
import WorkflowBuilderPage from './workflow-builder-page';
import { WORKFLOW_RECIPES } from '../services/workflow-recipes';

const navigation = vi.hoisted(() => ({ query: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, useParams: () => ({}), useSearchParams: () => navigation.query }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: { id: 'user' }, userCan: () => true }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ addWorkflow: vi.fn(), updateWorkflow: vi.fn() }) }));
vi.mock('@/shared/services/workflows.api', () => ({ getWorkflowMetadata: async () => ({ triggers: WORKFLOW_TRIGGERS, actions: getAvailableActions() }),
  workflowsApi: { options: async () => ({ data: { users: [], pipelines: [], templates: [], campaigns: [] } }) } }));
vi.mock('./visual-workflow-builder', () => ({ default: ({ initial }: { initial: { name: string } }) => <div data-testid="loaded-template">{initial.name}</div> }));
beforeEach(() => { vi.clearAllMocks(); navigation.query = new URLSearchParams(); });
afterEach(cleanup);

it('loads the selected template from the URL without changing its source definition', async () => {
  navigation.query.set('template', '12');
  const original = structuredClone(WORKFLOW_RECIPES[12]);
  render(<WorkflowBuilderPage />);
  expect((await screen.findByTestId('loaded-template')).textContent).toBe('Contact Welcome & Check-in Email');
  expect(WORKFLOW_RECIPES[12]).toEqual(original);
});

it.each(['-1', '999', '1.5', 'unknown', ''])('rejects unavailable template URL %s with recovery navigation', async value => {
  navigation.query.set('template', value);
  render(<WorkflowBuilderPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('template is unavailable');
  expect(screen.queryByTestId('loaded-template')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to workflows' }));
  expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/automation/workflows');
});
