import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProductCategoryMutation } from '@leadcrm/shared';
import { ProductsPage } from './products-page';
import { apiClient } from '@/lib/api/client';
import type { ProductInterestResponse } from '@/shared/hooks/use-product-interests';

vi.mock('@/shared/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'tester', tenantId: 'one' } }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: (permission: string) => permissions.has(permission) }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const endpoint = '/administration/product-interests';
const product = { id: '0ff82f9c-48e9-4e1c-8c77-8a30755d704c', name: 'Camera', category: 'Security', description: 'Installation', dealValue: 25000, active: true, createdAt: '', updatedAt: '' };
let catalog: ProductInterestResponse;
let permissions: Set<string>;
beforeEach(() => {
  vi.clearAllMocks();
  permissions = new Set(['products.view', 'products.create', 'products.edit', 'products.archive']);
  catalog = { data: [{ ...product }], meta: { enabled: true, categories: ['Networks', 'Security'] } };
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(apiClient.get).mockImplementation(async () => structuredClone(catalog));
  vi.mocked(apiClient.patch).mockImplementation(async (path, body) => {
    if (path === endpoint + '/categories') {
      const input = body as ProductCategoryMutation;
      const names = catalog.meta.categories!;
      if (input.action === 'add') names.push(input.name);
      if (input.action === 'rename') {
        catalog.meta.categories = names.map(name => name === input.name ? input.newName : name);
        catalog.data = catalog.data.map(row => row.category === input.name ? { ...row, category: input.newName } : row);
      }
      if (input.action === 'delete') catalog.meta.categories = names.filter(name => name !== input.name);
    } else catalog.data = catalog.data.map(row => row.id === product.id ? { ...row, ...(body as object) } : row);
    return structuredClone(catalog);
  });
  vi.mocked(apiClient.post).mockImplementation(async (_path, body) => {
    catalog.data.push({ ...product, ...(body as object), id: 'created-product' }); return structuredClone(catalog);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openManager() {
  render(<ProductsPage />); await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('button', { name: 'Manage Product Categories' }));
  return screen.findByRole('dialog', { name: 'Manage Product Categories' });
}
async function closeManager() {
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Manage Product Categories' })).getByRole('button', { name: 'Close dialog' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage Product Categories' })).toBeNull());
}

it('places the existing outlined Settings icon immediately left of Add Product and reuses the group dialog layout', async () => {
  const dialog = await openManager();
  const gear = screen.getByRole('button', { name: 'Manage Product Categories' });
  expect(gear.nextElementSibling).toBe(screen.getByRole('button', { name: 'Add Product' }));
  expect(gear.className).toContain('bg-transparent'); expect(gear.className).toContain('h-11 w-11');
  expect(gear.querySelector('.lucide-settings')).toBeTruthy(); expect(gear.title).toBe('Manage Categories');
  expect(dialog.className).toContain('max-w-2xl'); expect(dialog.className).toContain('max-h-[85dvh]');
  expect(within(dialog).queryByRole('combobox')).toBeNull(); expect(within(dialog).getByText('2 categories')).toBeTruthy();
  await closeManager();
});

it('adds trimmed categories and immediately exposes them in New Product without a page refresh', async () => {
  const dialog = await openManager();
  fireEvent.change(within(dialog).getByPlaceholderText('New category name'), { target: { value: '  Cabling  ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
  await within(dialog).findByText('Cabling');
  expect(apiClient.patch).toHaveBeenCalledWith(endpoint + '/categories', { action: 'add', name: 'Cabling' });
  await closeManager(); fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  expect(within(screen.getByRole('combobox', { name: 'Category' })).getByRole('option', { name: 'Cabling' })).toBeTruthy();
});

it('rejects blank and case-insensitive duplicate category names', async () => {
  const dialog = await openManager(), input = within(dialog).getByPlaceholderText('New category name');
  fireEvent.submit(input.closest('form')!);
  expect(within(dialog).getByText('Category is required.')).toBeTruthy();
  fireEvent.change(input, { target: { value: ' security ' } }); fireEvent.submit(input.closest('form')!);
  expect(within(dialog).getByText('Category names must be unique.')).toBeTruthy(); expect(apiClient.patch).not.toHaveBeenCalled();
});

it('renames with prefill, Save and Cancel, updates the table and keeps the Edit Product selection', async () => {
  const dialog = await openManager();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Rename Security' }));
  const input = within(dialog).getByRole('textbox', { name: 'Category name: Security' });
  expect((input as HTMLInputElement).value).toBe('Security');
  fireEvent.change(input, { target: { value: 'Networks' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(within(dialog).getByText('Category names must be unique.')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); expect(apiClient.patch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Rename Security' }));
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Category name: Security' }), { target: { value: '  CCTV  ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await within(dialog).findByText('CCTV'); await closeManager();
  expect(within(screen.getByRole('grid')).getByText('CCTV')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit product' }));
  expect((screen.getByRole('combobox', { name: 'Category' }) as HTMLSelectElement).value).toBe('CCTV');
  expect(screen.queryByRole('option', { name: 'Security' })).toBeNull();
});

it('uses red trash icons and the existing destructive confirmation before deleting an unused category', async () => {
  const dialog = await openManager(), trash = within(dialog).getByRole('button', { name: 'Delete Networks category' });
  expect(trash.className).toContain('text-destructive'); expect(trash.querySelector('.lucide-trash-2')).toBeTruthy();
  fireEvent.click(trash); expect(apiClient.patch).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(trash); fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete Category' }));
  await waitFor(() => expect(within(dialog).queryByText('Networks')).toBeNull());
  await closeManager(); fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  expect(screen.queryByRole('option', { name: 'Networks' })).toBeNull();
});

it('shows the authoritative in-use deletion error and retains the category', async () => {
  const dialog = await openManager();
  vi.mocked(apiClient.patch).mockRejectedValueOnce(new Error('This category cannot be deleted because it is currently assigned to one or more products.'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Security category' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete Category' }));
  expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toBeTruthy();
  expect(within(dialog).getByText('Security')).toBeTruthy();
});

it('uses the same category mutation for inline creation before saving a new Product', async () => {
  render(<ProductsPage />); await screen.findByRole('grid'); fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Product Name' }), { target: { value: 'Router' } });
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: '500' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: '__add__' } });
  fireEvent.change(screen.getByLabelText('New Category'), { target: { value: '  Routers  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(endpoint, { name: 'Router', category: 'Routers', description: '', dealValue: 500 }));
  expect(apiClient.patch).toHaveBeenCalledWith(endpoint + '/categories', { action: 'add', name: 'Routers' });
  expect(vi.mocked(apiClient.patch).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(apiClient.post).mock.invocationCallOrder[0]);
});

it('preserves an Uncategorized Product and requires category selection when editing it', async () => {
  catalog.data[0].category = '';
  render(<ProductsPage />); await screen.findByText('Uncategorized'); fireEvent.click(screen.getByRole('button', { name: 'Edit product' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(screen.getByText('Category is required.')).toBeTruthy(); expect(apiClient.patch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'Networks' } }); fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith(endpoint + '/' + product.id, { category: 'Networks', dealValue: product.dealValue }));
});

it('hides the gear for view-only users and limits actions to existing Product grants', async () => {
  permissions = new Set(['products.view']);
  const view = render(<ProductsPage />); await screen.findByRole('grid');
  expect(screen.queryByRole('button', { name: 'Manage Product Categories' })).toBeNull(); view.unmount();
  permissions.add('products.create');
  const dialog = await openManager();
  expect(within(dialog).getByRole('button', { name: 'Add' })).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: 'Rename Security' })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Delete Security category' })).toBeNull();
});
