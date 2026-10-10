import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProductInterestsSettings } from './product-interests-settings';
import { ProductsPage } from './products-page';
import { apiClient } from '@/lib/api/client';
import { toast } from 'sonner';
import { DEFAULT_CLOSING_FIELDS } from '@leadcrm/shared';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'one' }, user: { id: 'tester', tenantId: 'one' } }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const product = { id: '0ff82f9c-48e9-4e1c-8c77-8a30755d704c', name: 'CCTV Surveillance System', dealValue: 25000, active: true, createdAt: '', updatedAt: '' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(apiClient.get).mockResolvedValue({ data: [product], meta: { enabled: true } });
  vi.mocked(apiClient.post).mockResolvedValue({ data: [product], meta: { enabled: true } });
  vi.mocked(apiClient.delete).mockResolvedValue({ data: [], meta: { enabled: false } });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps field configuration separate from product management', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: DEFAULT_CLOSING_FIELDS });
  render(<ProductInterestsSettings />);
  expect(await screen.findByText(DEFAULT_CLOSING_FIELDS[0].name)).toBeTruthy();
  expect(screen.queryByText('Product Interest')).toBeNull();
  expect(apiClient.get).not.toHaveBeenCalledWith('/administration/product-interests', expect.anything());
  expect(screen.queryByRole('button', { name: 'Add Product' })).toBeNull();
});
it('uses the shared row menu with View, Edit and Archive', async () => {
  render(<ProductsPage />);
  const trigger = await screen.findByRole('button', { name: 'Row actions' });
  fireEvent.click(trigger);
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['View', 'Edit', 'Archive']);
  fireEvent.click(trigger); expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger); fireEvent.mouseDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
});

it('pins Others after all sorted products, including descending order', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: [
    { ...product, id: 'others', name: 'Others', dealValue: 10 },
    { ...product, id: 'zebra', name: 'Zebra', dealValue: 500 },
    { ...product, id: 'alpha', name: 'Alpha', dealValue: 50 },
  ], meta: { enabled: true } });
  render(<ProductsPage />); await screen.findByRole('grid');
  const last = () => within(screen.getByRole('grid')).getAllByRole('row').at(-1)!.textContent;
  expect(last()).toContain('Others');
  fireEvent.click(screen.getByRole('columnheader', { name: 'Product Name' })); expect(last()).toContain('Others');
  fireEvent.click(screen.getByRole('columnheader', { name: 'Product Name' })); expect(last()).toContain('Others');
  fireEvent.click(screen.getByRole('columnheader', { name: 'Deal Value' })); expect(last()).toContain('Others');
});

it('replaces rows with the Leads spinner and hides pagination during a deduplicated refresh', async () => {
  render(<ProductsPage />); await screen.findByRole('grid');
  let finish!: (value: any) => void;
  vi.mocked(apiClient.get).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const calls = vi.mocked(apiClient.get).mock.calls.length;
  fireEvent.click(screen.getByLabelText('Refresh products')); fireEvent.click(screen.getByLabelText('Refresh products'));
  expect(screen.queryByRole('grid')).toBeNull(); expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  expect(screen.getByText('Loading products').querySelector('.animate-spin')).toBeTruthy(); expect(document.querySelector('.animate-pulse')).toBeNull();
  expect(apiClient.get).toHaveBeenCalledTimes(calls + 1);
  finish({ data: [product], meta: { enabled: true } }); await screen.findByRole('grid'); expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
});
it('can enable the existing product field from Products after removing its Custom Fields card', async () => {
  vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [], meta: { enabled: false } });
  render(<ProductsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Enable Product Interest' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/administration/product-interests/field', {}));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Enable Product Interest' })).toBeNull());
  await waitFor(() => expect((screen.getByRole('button', { name: 'Add Product' }) as HTMLButtonElement).disabled).toBe(false));
});
it('validates money and persists only trimmed names and numeric amounts through the API', async () => {
  render(<ProductsPage />);
  await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: '  Biometrics  ' } });
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: '-5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(await screen.findByRole('alert')).toBeTruthy(); expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: '30000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/administration/product-interests', { name: 'Biometrics', dealValue: 30000 }));
});

it('requires both new product fields, trims the name and shows length errors inline', async () => {
  render(<ProductsPage />); await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  expect(screen.getAllByText('*')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(await screen.findByText('Product name is required')).toBeTruthy();
  expect(screen.getByText('Deal value is required.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: '   ' } });
  expect(screen.getByText('Product name is required')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: ` ${'x'.repeat(201)} ` } });
  expect((screen.getByLabelText('Product Name') as HTMLInputElement).value).toBe('   ');
  expect(screen.getByText('Product name must not exceed 200 characters.')).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it.each(['₱25000', '25,000', '-25000', 'abc', '12abc', '25000.50', ' '])('rejects raw new-product Deal Value %s', async amount => {
  render(<ProductsPage />); await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: ' Valid Product ' } });
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: amount } });
  expect((screen.getByLabelText('Deal Value (PHP)') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('accepts digit-only new-product values and saves the trimmed product name', async () => {
  render(<ProductsPage />); await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: '   CCTV Surveillance System   ' } });
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: '25000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/administration/product-interests', { name: 'CCTV Surveillance System', dealValue: 25000 }));
});
it('requires confirmation before archiving a product and clears bulk selection after success', async () => {
  vi.mocked(apiClient.delete).mockResolvedValue({ data: [], meta: { enabled: true } });
  render(<ProductsPage />);
  await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all records' }));
  expect(screen.getByText('1 selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect(apiClient.delete).not.toHaveBeenCalled();
  vi.mocked(apiClient.get).mockResolvedValue({ data: [], meta: { enabled: true } });
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
  await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/administration/product-interests/' + product.id));
  await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
});

async function editProduct() {
  fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: '7000.25' } });
}
it('shows a skeleton then applies the committed response and toasts only after success', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiClient.patch).mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<ProductsPage />);
  expect(screen.getByRole('status')).toBeTruthy();
  await editProduct();
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(toast.success).not.toHaveBeenCalled();
  expect(apiClient.patch).toHaveBeenCalledWith('/administration/product-interests/' + product.id, { name: product.name, dealValue: 7000.25 });
  // The follow-up GET stays pending: the mutation response must be enough to update the UI.
  vi.mocked(apiClient.get).mockImplementation(() => new Promise(() => {}));
  resolve({ data: [{ ...product, dealValue: 7000.25 }], meta: { enabled: true } });
  await screen.findByText('₱7,000.25');
  expect(toast.success).toHaveBeenCalledWith('Product updated successfully.');
  await waitFor(() => expect(screen.queryByLabelText('Deal Value (PHP)')).toBeNull());
});
it('retains entered values and allows retry when saving fails', async () => {
  vi.mocked(apiClient.patch).mockRejectedValue(new Error('Database unavailable'));
  render(<ProductsPage />);
  await editProduct();
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Database unavailable'));
  expect(toast.success).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Deal Value (PHP)') as HTMLInputElement).value).toBe('7000.25');
  expect((screen.getByRole('button', { name: 'Save Product' }) as HTMLButtonElement).disabled).toBe(false);
});

it('keeps Product metadata visible while loading the historical Closed Won table with a spinner', async () => {
  render(<ProductsPage />); await screen.findByRole('grid');
  let resolve!: (value: unknown) => void;
  vi.mocked(apiClient.get).mockImplementation((url) => url.includes('/closed-won') ? new Promise(done => { resolve = done; }) : Promise.resolve({ data: product }));
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
  expect(screen.getByRole('status', { name: 'Loading Closed Won' }).querySelector('.animate-spin')).toBeTruthy();
  expect(screen.getByText('Product Record')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Product details' })).toBeTruthy();
  resolve({ data: [{ id: 'won', title: 'Real won deal', value: 45000, currency: 'PHP', customers: ['Saved Customer'], company: 'Company', assignedAgent: 'Agent', closedAt: '2026-09-30' }], meta: { total: 1 } });
  expect(await screen.findByText('Saved Customer')).toBeTruthy();
  expect(screen.queryByText('Real won deal')).toBeNull();
  expect(screen.queryByText('₱45,000.00')).toBeNull();
  const table = within(screen.getByRole('region', { name: 'Closed Won table' })).getByRole('grid');
  expect(table.tagName).toBe('TABLE');
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Contacts', 'Won', 'Assigned Agent']);
  expect(within(table).getByText('Company')).toBeTruthy();
  expect(within(table).getByText('Agent')).toBeTruthy();
  expect(screen.getByText('1 record')).toBeTruthy();
  expect(apiClient.get).toHaveBeenCalledWith('/administration/product-interests/' + product.id + '/closed-won?page=1&limit=25', expect.anything());
});

it('refreshes once, retains metadata and pagination, then uses server pages and page sizes', async () => {
  const won = { id: 'won', title: 'Historical deal', value: 1234.56, currency: 'PHP', customers: ['Customer'], company: null, assignedAgent: null, closedAt: null };
  render(<ProductsPage />); await screen.findByRole('grid');
  vi.mocked(apiClient.get).mockImplementation(async url => url.includes('/closed-won') ? { data: [won], meta: { total: 26 } } : { data: product });
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' })); fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
  await screen.findByText('26 records');
  const section = screen.getByRole('region', { name: 'Closed Won' });
  let finish!: (value: unknown) => void;
  vi.mocked(apiClient.get).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const refresh = within(section).getByRole('button', { name: 'Refresh Closed Won' });
  const before = vi.mocked(apiClient.get).mock.calls.length;
  fireEvent.click(refresh); fireEvent.click(refresh);
  expect(apiClient.get).toHaveBeenCalledTimes(before + 1);
  expect((refresh as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status', { name: 'Loading Closed Won' }).textContent).toBe('');
  expect(screen.getAllByText('₱25,000.00').length).toBeGreaterThan(0);
  expect(within(section).getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
  finish({ data: [won], meta: { total: 26 } });
  await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
  expect(within(section).getAllByText('Customer')).toHaveLength(1);
  vi.mocked(apiClient.get).mockResolvedValue({ data: [won], meta: { total: 26 } });
  fireEvent.click(within(section).getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(expect.stringContaining('page=2&limit=25'), expect.anything()));
  await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(section).getByRole('button', { name: 'Records per page' }));
  fireEvent.click(screen.getByRole('option', { name: '10' }));
  await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(expect.stringContaining('page=1&limit=10'), expect.anything()));
});

it('opens the existing editor from the icon-only product quick action', async () => {
  render(<ProductsPage />); await screen.findByRole('grid');
  const edit = screen.getByRole('button', { name: 'Edit product' });
  expect(edit.textContent).toBe(''); expect(edit.title).toBe('Edit product');
  expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
  fireEvent.click(edit);
  expect(screen.getByText('Edit Product')).toBeTruthy();
  expect((screen.getByLabelText('Product Name') as HTMLInputElement).value).toBe(product.name);
});

it('saves a formatted Peso amount, reloads the committed value and reopens the editor', async () => {
  let saved = { ...product, dealValue: 0 };
  vi.mocked(apiClient.get).mockImplementation(async () => ({ data: [saved], meta: { enabled: true } }));
  vi.mocked(apiClient.patch).mockImplementation(async (_url, body) => {
    saved = { ...saved, ...(body as { name: string; dealValue: number }) };
    return { data: [saved], meta: { enabled: true } };
  });
  const first = render(<ProductsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit product' }));
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: '₱25,000.00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/administration/product-interests/' + product.id, { name: product.name, dealValue: 25000 }));
  await screen.findByText('₱25,000.00');
  expect(toast.success).toHaveBeenCalledWith('Product updated successfully.');
  first.unmount(); render(<ProductsPage />);
  await screen.findByText('₱25,000.00');
  fireEvent.click(screen.getByRole('button', { name: 'Edit product' }));
  expect((screen.getByLabelText('Deal Value (PHP)') as HTMLInputElement).value).toBe('25000');
});
