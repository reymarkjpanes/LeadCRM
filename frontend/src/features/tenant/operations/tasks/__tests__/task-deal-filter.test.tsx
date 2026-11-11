import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const fixture = vi.hoisted(() => ({
  options: vi.fn(), dealOptions: vi.fn(), onChange: vi.fn(),
  products: [{ id: 'p1', name: 'Setup', category: 'Services' }, { id: 'p2', name: 'Camera', category: 'Hardware' }],
  data: { users: [], contacts: [], deals: [], organizations: [] },
}));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/store/DataContext', () => ({ useData: () => fixture.data }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent' }, tenant: { id: 'tenant' } }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: fixture.products }) }));
vi.mock('@/shared/services/tasks.api', () => ({ tasksApi: { options: fixture.options, dealOptions: fixture.dealOptions } }));
import { TaskSelector } from '../ui/task-selector';
const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `deal-${i}`, label: `Deal ${i}` }));
function Form({ initial = [], leadIds = [] }: { initial?: string[]; leadIds?: string[] }) {
  const [value, setValue] = useState(initial);
  return <TaskSelector kind="deal" label="Associated deals" multiple value={value} leadIds={leadIds} onChange={next => { fixture.onChange(next); setValue(next); }} />;
}
const available = () => screen.getByRole('region', { name: 'Available deals' });
function scrollToBottom() {
  const list = available();
  Object.defineProperties(list, { clientHeight: { configurable: true, value: 192 }, scrollHeight: { configurable: true, value: 1200 }, scrollTop: { configurable: true, value: 1008, writable: true } });
  fireEvent.scroll(list);
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.options.mockResolvedValue({ data: [{ id: 'account', label: 'Searchable Company' }] });
  fixture.dealOptions.mockImplementation(async ({ selectAll, page = 1 }) => ({ data: selectAll ? rows(50) : rows(50).slice((page - 1) * 25, page * 25), meta: { total: 50, hasMore: page === 1 } }));
});
it('selects all matching deals across pages and deduplicates overlapping selections', async () => {
  render(<Form initial={['deal-0']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  scrollToBottom();
  await screen.findByRole('checkbox', { name: 'Deal 49' });
  fireEvent.click(screen.getByRole('button', { name: 'Select all matching deals' }));
  await waitFor(() => expect(fixture.onChange).toHaveBeenLastCalledWith(rows(50).map(row => row.id)));
  expect(screen.getByText('50 selected · 50 matching deals')).toBeTruthy();
  expect(within(available()).getAllByRole('checkbox')).toHaveLength(50);
  fireEvent.click(screen.getByText('Selected deals (50)'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove Deal 49' }));
  expect(fixture.onChange).toHaveBeenLastCalledWith(rows(49).map(row => row.id));
});

it('keeps selected search local, starts collapsed, and shares checkbox and trash removal', async () => {
  render(<Form initial={['deal-0', 'deal-1', 'deal-2']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  const toggle = screen.getByRole('button', { name: 'Selected deals (3)' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('textbox', { name: 'Search selected deals' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Clear selection' })).toHaveLength(1);
  fireEvent.click(toggle);
  const selected = screen.getByRole('list', { name: 'Selected deal rows' });
  const requests = fixture.dealOptions.mock.calls.length;
  fireEvent.change(screen.getByRole('textbox', { name: 'Search selected deals' }), { target: { value: 'DEAL 1' } });
  expect(within(selected).getAllByRole('checkbox')).toHaveLength(1);
  expect(within(selected).getByRole('checkbox', { name: 'Deal 1' })).toHaveProperty('checked', true);
  expect(within(available()).getAllByRole('checkbox')).toHaveLength(25);
  expect(fixture.onChange).not.toHaveBeenCalled();
  fireEvent.click(toggle); fireEvent.click(toggle);
  expect(screen.getByRole('textbox', { name: 'Search selected deals' })).toHaveProperty('value', 'DEAL 1');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search selected deals' }), { target: { value: 'missing' } });
  expect(screen.getByText('No selected deals match your search.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Selected deals (3)' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search selected deals' }), { target: { value: '' } });
  const trash = screen.getByRole('button', { name: 'Remove Deal 1' });
  expect(trash.textContent).toBe('');
  fireEvent.click(trash);
  expect(fixture.onChange).toHaveBeenLastCalledWith(['deal-0', 'deal-2']);
  expect(screen.getByRole('button', { name: 'Selected deals (2)' })).toBeTruthy();
  expect(within(available()).getByRole('checkbox', { name: 'Deal 1' })).toHaveProperty('checked', false);
  fireEvent.click(within(selected).getByRole('checkbox', { name: 'Deal 0' }));
  expect(fixture.onChange).toHaveBeenLastCalledWith(['deal-2']);
  expect(fixture.dealOptions).toHaveBeenCalledTimes(requests);
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(fixture.onChange).toHaveBeenLastCalledWith([]);
  expect(screen.queryByRole('button', { name: /Selected deals/ })).toBeNull();
});

it('preserves learned labels and IDs through result searches and reopening', async () => {
  fixture.dealOptions.mockImplementation(async ({ search }) => ({ data: search ? [{ id: 'other', label: 'Other deal' }] : rows(25), meta: { total: search ? 1 : 25, hasMore: false } }));
  render(<Form initial={['deal-0']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByRole('checkbox', { name: 'Deal 0' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search deal' }), { target: { value: 'Other' } });
  await screen.findByRole('checkbox', { name: 'Other deal' });
  fireEvent.click(screen.getByRole('button', { name: 'Selected deals (1)' }));
  expect(screen.getByRole('button', { name: 'Remove Deal 0' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search selected deals' }), { target: { value: 'Deal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.getByRole('button', { name: 'Associated deals' }).textContent).toContain('Deal 0');
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  expect(screen.getByRole('button', { name: 'Selected deals (1)' }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Selected deals (1)' }));
  expect(screen.getByRole('textbox', { name: 'Search selected deals' })).toHaveProperty('value', '');
  expect(fixture.onChange).not.toHaveBeenCalled();
});

it('loads all pages sequentially, deduplicates results, and stops at the final page', async () => {
  fixture.dealOptions.mockImplementation(async ({ page = 1 }) => ({ data: page === 1 ? rows(25) : page === 2 ? rows(49).slice(24) : rows(70).slice(49), meta: { total: 70, hasMore: page < 3 } }));
  render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
  expect(screen.queryByText(/^Page \d/)).toBeNull();
  scrollToBottom(); scrollToBottom(); scrollToBottom();
  await screen.findByRole('checkbox', { name: 'Deal 48' });
  expect(within(available()).getAllByRole('checkbox')).toHaveLength(49);
  expect(fixture.dealOptions.mock.calls.map(([query]) => query.page)).toEqual([1, 2]);
  scrollToBottom();
  await screen.findByRole('checkbox', { name: 'Deal 69' });
  expect(within(available()).getAllByRole('checkbox')).toHaveLength(70);
  scrollToBottom();
  expect(fixture.dealOptions.mock.calls.map(([query]) => query.page)).toEqual([1, 2, 3]);
});

it('retains loaded options and retries the failed page without skipping it', async () => {
  let failed = false;
  fixture.dealOptions.mockImplementation(async ({ page }) => {
    if (page === 2 && !failed) { failed = true; throw new Error('Page failed'); }
    return { data: rows(50).slice((page - 1) * 25, page * 25), meta: { total: 50, hasMore: page === 1 } };
  });
  render(<Form initial={['deal-0']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  scrollToBottom();
  expect(screen.getByRole('checkbox', { name: 'Deal 0' })).toHaveProperty('checked', true);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Page failed'));
  expect(within(available()).getAllByRole('checkbox')).toHaveLength(25);
  scrollToBottom();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('checkbox', { name: 'Deal 49' });
  expect(within(available()).getAllByRole('checkbox')).toHaveLength(50);
  expect(fixture.dealOptions.mock.calls.map(([query]) => query.page)).toEqual([1, 2, 2]);
  expect(fixture.onChange).not.toHaveBeenCalled();
});

it('retries an initial-page failure using the existing error action', async () => {
  fixture.dealOptions.mockRejectedValueOnce(new Error('Initial load failed'));
  render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Initial load failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  expect(fixture.dealOptions.mock.calls.map(([query]) => query.page)).toEqual([1, 1]);
});

it('ignores an aborted later page and resets pagination and scroll position for new filters', async () => {
  let finishPage!: (value: unknown) => void;
  let oldSignal!: AbortSignal;
  fixture.dealOptions.mockImplementation(({ category, page }, signal) => {
    if (page === 2) { oldSignal = signal; return new Promise(resolve => { finishPage = resolve; }); }
    return Promise.resolve({ data: category ? [{ id: 'new', label: 'Filtered deal' }] : rows(25), meta: { total: category ? 1 : 50, hasMore: !category } });
  });
  render(<Form initial={['deal-0']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  scrollToBottom();
  await waitFor(() => expect(fixture.dealOptions).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText('Filter deals by category'), { target: { value: 'Hardware' } });
  expect(oldSignal.aborted).toBe(true);
  expect(available().scrollTop).toBe(0);
  await screen.findByRole('checkbox', { name: 'Filtered deal' });
  finishPage({ data: [{ id: 'stale', label: 'Stale deal' }], meta: { total: 50, hasMore: false } });
  await waitFor(() => expect(within(available()).getAllByRole('checkbox')).toHaveLength(1));
  expect(screen.queryByRole('checkbox', { name: 'Stale deal' })).toBeNull();
  expect(fixture.dealOptions.mock.calls.map(([query]) => query.page)).toEqual([1, 2, 1]);
  fireEvent.click(screen.getByRole('button', { name: 'Selected deals (1)' }));
  expect(screen.getByRole('button', { name: 'Remove Deal 0' })).toBeTruthy();
  expect(fixture.onChange).not.toHaveBeenCalled();
});

it('restarts from page one after related lead scope changes', async () => {
  const view = render(<Form leadIds={['lead-a']} initial={['deal-0']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  scrollToBottom();
  await screen.findByRole('checkbox', { name: 'Deal 49' });
  view.rerender(<Form leadIds={['lead-b']} initial={['deal-0']} />);
  await waitFor(() => expect(fixture.dealOptions).toHaveBeenLastCalledWith({ search: '', leadIds: 'lead-b', page: 1 }, expect.any(AbortSignal)));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  expect(within(available()).getAllByRole('checkbox')).toHaveLength(25);
  expect(fixture.onChange).not.toHaveBeenCalled();
});

it('fills an underfilled viewport one page at a time', async () => {
  render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  Object.defineProperties(available(), { clientHeight: { configurable: true, value: 192 }, scrollHeight: { configurable: true, value: 100 } });
  await screen.findByRole('checkbox', { name: 'Deal 49' });
  expect(fixture.dealOptions.mock.calls.map(([query]) => query.page)).toEqual([1, 2]);
});

it('keeps the 50-deal limit while allowing deselection at the limit', async () => {
  fixture.dealOptions.mockResolvedValue({ data: [...rows(49), { id: 'extra', label: 'Extra deal' }], meta: { total: 50, hasMore: false } });
  render(<Form initial={rows(50).map(row => row.id)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  expect(await screen.findByRole('checkbox', { name: 'Extra deal' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Deal 0' }));
  expect(screen.getByRole('checkbox', { name: 'Extra deal' })).toHaveProperty('disabled', false);
  expect(fixture.onChange).toHaveBeenLastCalledWith(rows(50).slice(1).map(row => row.id));
});
it('combines account, category, product and search while preserving selections', async () => {
  render(<Form initial={['deal-0']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  fireEvent.click(screen.getByRole('button', { name: 'Account (Company)' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search account' }), { target: { value: 'Searchable' } });
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Searchable Company' }));
  fireEvent.change(screen.getByLabelText('Filter deals by category'), { target: { value: 'Services' } });
  expect(screen.queryByRole('option', { name: 'Camera' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter deals by product'), { target: { value: 'p1' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search deal' }), { target: { value: 'Renewal' } });
  await waitFor(() => expect(fixture.dealOptions).toHaveBeenLastCalledWith({ search: 'Renewal', accountId: 'account', category: 'Services', productInterestId: 'p1', page: 1 }, expect.any(AbortSignal)));
  expect(fixture.onChange).not.toHaveBeenCalled();
  expect(screen.getByText('1 selected · 50 matching deals')).toBeTruthy();
});
it('rejects a union over 50 without dropping the earlier selection', async () => {
  render(<Form initial={['other-deal']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByRole('checkbox', { name: 'Deal 24' });
  fireEvent.click(screen.getByRole('button', { name: 'Select all matching deals' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('More than 50'));
  expect(fixture.onChange).not.toHaveBeenCalled();
});
it('disables selection when no deals match', async () => {
  fixture.dealOptions.mockResolvedValue({ data: [], meta: { total: 0, hasMore: false } });
  render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  await screen.findByText('No matching records.');
  expect(screen.getByRole('button', { name: 'Select all matching deals' })).toHaveProperty('disabled', true);
});

it('keeps loaded options and selection without another read after unrelated provider arrays change', async () => {
  const view = render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: 'Associated deals' }));
  const option = await screen.findByRole('checkbox', { name: 'Deal 0' });
  fireEvent.click(option);
  expect(option).toHaveProperty('checked', true);
  const requests = fixture.dealOptions.mock.calls.length;
  fixture.data = { users: [], contacts: [], deals: [], organizations: [] };
  fixture.products = [...fixture.products];
  view.rerender(<Form />);
  expect(screen.getByRole('checkbox', { name: 'Deal 0' })).toBe(option);
  expect(screen.queryByText('Loading…')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Deal 1' }));
  await waitFor(() => expect(fixture.onChange).toHaveBeenLastCalledWith(['deal-0', 'deal-1']));
  expect(fixture.dealOptions).toHaveBeenCalledTimes(requests);
});
