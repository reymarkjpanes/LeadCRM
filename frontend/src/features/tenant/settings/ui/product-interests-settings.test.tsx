import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProductInterestsSettings } from './product-interests-settings';
import { ProductsPage } from './products-page';
import { apiClient } from '@/lib/api/client';
import { toast } from 'sonner';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 'one' } }) }));
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
  render(<ProductInterestsSettings />);
  expect(await screen.findByText('Closed Won Requirements')).toBeTruthy();
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
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: '30000.50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/administration/product-interests', { name: 'Biometrics', dealValue: 30000.5 }));
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

it('loads details and the actual Closed Won lookup with skeletons', async () => {
  render(<ProductsPage />); await screen.findByRole('grid');
  let resolve!: (value: unknown) => void;
  vi.mocked(apiClient.get).mockImplementation((url) => url.includes('/closed-won') ? new Promise(done => { resolve = done; }) : Promise.resolve({ data: product }));
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
  expect(screen.getByRole('status', { name: 'Loading product and Closed Won customers' }).querySelector('.animate-pulse')).toBeTruthy();
  resolve({ data: [{ id: 'won', title: 'Real won deal', value: 45000, currency: 'PHP', customers: ['Saved Customer'], company: 'Company', assignedAgent: 'Agent', closedAt: '2026-09-30' }], meta: { total: 1 } });
  expect(await screen.findByText('Saved Customer')).toBeTruthy();
  expect(screen.getByText('Real won deal')).toBeTruthy();
  expect(screen.getByText('₱45,000.00')).toBeTruthy();
  expect(apiClient.get).toHaveBeenCalledWith('/administration/product-interests/' + product.id + '/closed-won?page=1&limit=25', expect.anything());
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
