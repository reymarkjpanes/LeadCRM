import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchivedData } from '../archived-data';
import { clearPageCache } from '@/shared/cache/page-cache';
import type { ArchivedRecord } from '@leadcrm/shared';

const state = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant-a' }, userCan: () => true, user: { id: 'user-a', role: 'Client Admin', } }) }));
vi.mock('sonner', () => ({ toast: { success: state.success, error: state.error } }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ refreshRoles: vi.fn(), refreshPipelines: vi.fn(), refreshDeals: vi.fn(), refreshOrganizations: vi.fn() }) }));
let rows: ArchivedRecord[];
let failIds: Set<string>;
let failFetch: boolean;
const request = vi.fn(async (url: string, options: RequestInit) => {
  const path = new URL(url, 'http://localhost');
  if (options.method === 'PATCH') {
    const id = path.pathname.split('/').at(-2)!;
    if (failIds.has(id)) return new Response(JSON.stringify({ error: 'Permission denied' }), { status: 403 });
    rows = rows.filter(row => row.id !== id);
    return new Response(JSON.stringify({ success: true }));
  }
  if (failFetch) return new Response(JSON.stringify({ error: 'Fetch failed' }), { status: 500 });
  const filtered = rows.filter(row => (!path.searchParams.get('type') || row.type === path.searchParams.get('type')) && row.name.toLowerCase().includes((path.searchParams.get('search') || '').toLowerCase()));
  const page = Number(path.searchParams.get('page')), limit = Number(path.searchParams.get('limit'));
  return new Response(JSON.stringify({ success: true, data: filtered.slice((page - 1) * limit, page * limit), meta: { total: filtered.length, page, limit, hasMore: page * limit < filtered.length } }));
});
beforeEach(() => {
  clearPageCache(); failIds = new Set(); failFetch = false;
  rows = (['Lead', 'Contact', 'Account'] as const).map(type => ({ id: type.toLowerCase() + '-id', type, name: 'Saved ' + type, detail: type + '@example.com', archivedAt: type === 'Lead' ? '2026-09-01T00:00:00.000Z' : null, canRestore: true }));
  vi.clearAllMocks(); vi.stubGlobal('fetch', request);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); clearPageCache(); vi.unstubAllGlobals(); });
const confirm = () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Restore/ }));
const writes = () => request.mock.calls.filter(([, options]) => options.method === 'PATCH');

it('uses the shared grid, actual timestamp and one scrolling filter row', async () => {
  render(<ArchivedData />);
  expect(screen.getByRole('status').querySelector('.animate-spin')).toBeTruthy();
  expect(screen.getByText('Archived Data Recovery')).toBeTruthy();
  const filters = screen.getByRole('group', { name: 'Archived record types' });
  expect(within(filters).getAllByRole('button').map(button => button.textContent)).toEqual(['All', 'Lead', 'Contact', 'Account', 'Deal', 'User', 'Task', 'Campaign', 'Workflow']);
  expect(filters.className).toContain('overflow-x-auto');
  expect(filters.className).toContain('flex-nowrap');
  await screen.findByText('Saved Lead');
  expect(screen.getByRole('grid')).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  expect(screen.getByRole('columnheader', { name: 'Archived On' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Restore' })[0].textContent).toBe('');
});

it.each([
  ['Lead', 'crm/leads'], ['Contact', 'crm/contacts'], ['Account', 'crm/accounts'], ['Deal', 'crm/deals'], ['User', 'administration/users'], ['Task', 'administration/archived-data/Task'], ['Campaign', 'administration/archived-data/Campaign'], ['Workflow', 'administration/archived-data/Workflow'],
])('confirms %s restoration using its configured endpoint', async (label, route) => {
  rows = [{ ...rows[0], id: label.toLowerCase() + '-id', type: label as ArchivedRecord['type'], name: 'Saved ' + label }];
  render(<ArchivedData />); await screen.findByText('Saved ' + label);
  fireEvent.click(within(screen.getByRole('grid')).getByRole('button', { name: 'Restore' }));
  expect(writes()).toHaveLength(0);
  expect(screen.getByText('This record will be restored to its original module.')).toBeTruthy();
  confirm();
  await waitFor(() => expect(screen.queryByText('Saved ' + label)).toBeNull());
  expect(writes()[0][0]).toBe('/api/proxy/' + route + '/' + label.toLowerCase() + '-id/restore');
  expect(state.success).toHaveBeenCalledWith(label + ' restored');
});

it('cancel and Escape do not restore; dialog traps focus and restores it', async () => {
  render(<ArchivedData />); await screen.findByText('Saved Lead');
  const button = screen.getAllByRole('button', { name: 'Restore' })[0];
  button.focus(); fireEvent.click(button);
  const dialog = screen.getByRole('alertdialog');
  const first = within(dialog).getByRole('button', { name: 'Close' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Restore' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(writes()).toHaveLength(0);
});

it('selects, deselects and restores all visible records only after bulk confirmation', async () => {
  render(<ArchivedData />); await screen.findByText('Saved Lead');
  const all = screen.getByRole('checkbox', { name: 'Select all records' }) as HTMLInputElement;
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select record Lead-lead-id' }));
  expect(all.indeterminate).toBe(true);
  fireEvent.click(all); expect(screen.getByText('3 selected')).toBeTruthy();
  fireEvent.click(all); expect(screen.queryByRole('group', { name: 'Bulk restore' })).toBeNull();
  fireEvent.click(all); fireEvent.click(screen.getByText('Restore', { selector: 'button' }));
  expect(writes()).toHaveLength(0);
  expect(screen.getByText('This will restore 3 archived records to their original modules.')).toBeTruthy();
  confirm();
  await screen.findByText('No archived records found.');
  expect(writes()).toHaveLength(3);
  expect(state.success).toHaveBeenCalledWith('3 records restored');
});

it('keeps failed records and reports partial bulk results accurately', async () => {
  failIds.add('contact-id');
  render(<ArchivedData />); await screen.findByText('Saved Lead');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all records' }));
  fireEvent.click(screen.getByText('Restore', { selector: 'button' })); confirm();
  await waitFor(() => expect(state.error).toHaveBeenCalledWith('1 record could not be restored. Permission denied'));
  expect(state.success).toHaveBeenCalledWith('2 records restored');
  expect(screen.getByText('Saved Contact')).toBeTruthy();
  expect(screen.getByText('1 selected')).toBeTruthy();
  expect(screen.queryByText('Saved Lead')).toBeNull();
});

it('retains a rejected individual restore and disables forbidden actions', async () => {
  failIds.add('lead-id'); rows[1].canRestore = false;
  render(<ArchivedData />); await screen.findByText('Saved Lead');
  expect((screen.getAllByRole('button', { name: 'Restore' })[1] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]); confirm();
  await waitFor(() => expect(state.error).toHaveBeenCalledWith('Permission denied'));
  expect(screen.getByText('Saved Lead')).toBeTruthy();
  expect(state.success).not.toHaveBeenCalled();
});

it('clears selection on filter/page changes, uses backend pagination and omits absent timestamps', async () => {
  rows = Array.from({ length: 26 }, (_, index) => ({ ...rows[0], id: String(index), name: 'Lead ' + index, archivedAt: null }));
  render(<ArchivedData />); await screen.findByText('Lead 0');
  expect(screen.queryByRole('columnheader', { name: 'Archived On' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all records' }));
  expect(screen.getByText('25 selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Lead 25');
  expect(screen.queryByRole('group', { name: 'Bulk restore' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Contact' }));
  await screen.findByText('No archived records found.');
  expect(request.mock.calls.some(([url]) => url.includes('type=Contact') && url.includes('page=1'))).toBe(true);
});

it('shows a fetch error with retry and recovers', async () => {
  failFetch = true; render(<ArchivedData />);
  await screen.findByRole('alert');
  expect(screen.queryByText('No archived records found.')).toBeNull();
  failFetch = false; fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Saved Lead');
});

it('searches server records beyond the visible page and resets pagination', async () => {
  rows = Array.from({ length: 26 }, (_, i) => ({ ...rows[0], id: String(i), name: i === 25 ? 'Needle campaign' : `Lead ${i}`, type: i === 25 ? 'Campaign' : 'Lead' }));
  render(<ArchivedData />); await screen.findByText('Lead 0');
  expect(screen.queryByText('Needle campaign')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search archived records' }), { target: { value: 'Needle' } });
  expect(screen.getByText('Loading archived records...').parentElement?.querySelector('.animate-spin')).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Archived record types' })).toBeTruthy();
  await screen.findByText('Needle campaign');
  expect(request.mock.calls.some(([url]) => url.includes('search=Needle') && url.includes('page=1'))).toBe(true);
  expect(screen.queryByText('Lead 0')).toBeNull();
});
