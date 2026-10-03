import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ loading: true, tasks: [] as any[], refresh: vi.fn() }));
vi.mock('../use-tasks', () => ({ useTasks: () => ({ ...state, canRead: true, identity: 'tenant', summary: { total: state.tasks.length, active: state.tasks.length } }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('./task-editor', () => ({ TaskEditor: () => null }));
import { RelatedTasks } from './related-tasks';
afterEach(cleanup);

it('uses a skeleton on first load, retains loaded tasks while refreshing and blocks duplicate refreshes', () => {
  const { rerender } = render(<RelatedTasks links={{ leadId: 'lead' }} />);
  expect(screen.getByRole('status', { name: 'Loading tasks' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Refresh tasks' }) as HTMLButtonElement).disabled).toBe(true);
  state.loading = false;
  state.tasks = [{ id: 'task', title: 'Call customer', status: 'TODO', dueDate: '2026-10-20T10:00:00Z' }];
  rerender(<RelatedTasks links={{ leadId: 'lead' }} />);
  const refresh = screen.getByRole('button', { name: 'Refresh tasks' });
  expect(refresh.textContent).toBe('');
  fireEvent.click(refresh); fireEvent.click(refresh);
  expect(state.refresh).toHaveBeenCalledTimes(1);
  state.loading = true;
  rerender(<RelatedTasks links={{ leadId: 'lead' }} />);
  expect(screen.getByText('Call customer')).toBeTruthy();
  expect(screen.queryByRole('status', { name: 'Loading tasks' })).toBeNull();
  expect((screen.getByRole('button', { name: 'Refresh tasks' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Add task' }).style.backgroundColor).toBe('var(--primary)');
});
