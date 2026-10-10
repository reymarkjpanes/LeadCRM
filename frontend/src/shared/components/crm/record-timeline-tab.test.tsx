import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ canCreate: true, create: vi.fn(), onCreated: vi.fn() }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => mocks.canCreate }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ addActivity: vi.fn() }) }));
vi.mock('@/features/tenant/crm/activities/services/activities.service', () => ({ activitiesService: { create: mocks.create } }));
import { RecordTimelineTab } from './record-timeline-tab';
beforeEach(() => { vi.resetAllMocks(); mocks.canCreate = true; });
afterEach(cleanup);
it('saves one activity with the supported record link and refreshes after success', async () => {
  mocks.create.mockResolvedValue({ data: { id: 'saved' } });
  render(<RecordTimelineTab activities={[]} module="deals" recordId="deal-1" onActivityCreated={mocks.onCreated} />);
  fireEvent.change(screen.getByLabelText('Activity description'), { target: { value: 'Follow-up note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Note' }));
  await waitFor(() => expect(mocks.onCreated).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ type: 'note', title: 'Follow-up note', dealId: 'deal-1' });
});
it('retains the draft when persistence fails', async () => {
  mocks.create.mockRejectedValue(new Error('Offline'));
  render(<RecordTimelineTab activities={[]} module="accounts" recordId="account-1" onActivityCreated={mocks.onCreated} />);
  fireEvent.change(screen.getByLabelText('Activity description'), { target: { value: 'Unsaved note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Note' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save Note' }).hasAttribute('disabled')).toBe(false));
  expect((screen.getByLabelText('Activity description') as HTMLTextAreaElement).value).toBe('Unsaved note');
  expect(mocks.onCreated).not.toHaveBeenCalled();
});
it('does not offer mutations without the existing create permission', () => {
  mocks.canCreate = false;
  render(<RecordTimelineTab activities={[]} module="deals" recordId="deal-1" />);
  expect(screen.queryByLabelText('Activity description')).toBeNull();
});
it.each(['leads', 'contacts'] as const)('creates live %s activities linked to their record', async module => {
  render(<RecordTimelineTab activities={[]} module={module} recordId="record-1" />);
  expect(screen.getByLabelText('Activity description')).toBeTruthy();
  mocks.create.mockResolvedValue({ data: { id: 'saved' } });
  fireEvent.change(screen.getByLabelText('Activity description'), { target: { value: 'Record update' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Note' }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ type: 'note', title: 'Record update', [module === 'leads' ? 'leadId' : 'contactId']: 'record-1' }));
});

it.each(['leads', 'contacts', 'accounts'] as const)('%s exposes only Activity filters and keeps the existing task view inside Activity', module => {
  render(<RecordTimelineTab activities={[]} module={module} recordId="record-1" tasks={<div>Related task records</div>} />);
  const filterButtons = screen.getAllByRole('button').filter(button => ['All', 'Emails', 'Tasks', 'Status', 'Notes', 'Calls & Emails', 'Calls'].includes(button.textContent ?? ''));
  expect(filterButtons.map(button => button.textContent)).toEqual(['All', 'Emails', 'Tasks', 'Status']);
  expect(screen.getByText('Related task records')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Emails' }));
  expect(screen.queryByText('Related task records')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
  expect(screen.getByText('Related task records')).toBeTruthy();
});

it.each(['leads', 'contacts', 'accounts', 'deals'] as const)('filters %s by email, task, status, and all activity', module => {
  const activities = [
    { id: 'email', type: 'email', title: 'Sent welcome email', createdAt: '2026-09-01T10:00:00.000Z' },
    { id: 'note', type: 'note', title: 'Internal note', createdAt: '2026-09-01T10:01:00.000Z' },
    { id: 'call', type: 'call', title: 'Called prospect', createdAt: '2026-09-01T10:02:00.000Z' },
    { id: 'task', type: 'task', title: 'Follow up task activity', createdAt: '2026-09-01T10:03:00.000Z' },
    { id: 'status', type: 'stage_change', title: 'Status changed to Hot', createdAt: '2026-09-01T10:04:00.000Z' },
  ];
  render(<RecordTimelineTab activities={activities} module={module} recordId="record-1" />);
  expect(screen.getByText('Internal note')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Emails' }));
  expect(screen.getAllByText('Sent welcome email').length).toBeGreaterThan(0);
  expect(screen.queryByText('Called prospect')).toBeNull();
  expect(screen.queryByText('Internal note')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
  expect(screen.getByText('Follow up task activity')).toBeTruthy();
  expect(screen.queryByText('Sent welcome email')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Status' }));
  expect(screen.getByText('Status changed to Hot')).toBeTruthy();
  expect(screen.queryByText('Follow up task activity')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  for (const title of ['Internal note', 'Follow up task activity', 'Status changed to Hot']) expect(screen.getByText(title)).toBeTruthy();
});

it.each(['leads', 'contacts', 'accounts', 'deals'] as const)('removes the %s Call quick action while preserving historical calls', module => {
  render(<RecordTimelineTab activities={[{ id: 'call', type: 'call', title: 'Historical call', createdAt: '2026-10-01T10:00:00Z' }]} module={module} recordId="record" />);
  expect(screen.queryByRole('button', { name: /^Call$/ })).toBeNull();
  expect(screen.getByText('Historical call')).toBeTruthy();
});
