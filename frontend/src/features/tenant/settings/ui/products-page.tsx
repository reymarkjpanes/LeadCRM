'use client';
import type { ProductCategoryMutation, ProductInterestInput } from '@leadcrm/shared';
import { PageHeader } from '@/shared/components/ui/page-header';


import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, Eye, Edit, Archive } from 'lucide-react';
import { toast } from '@/shared/utils/toast';
import type { ProductInterest, ProductWonDeal, PaginatedResponse } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/store/AuthContext';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { PRODUCT_INTEREST_ENDPOINT as endpoint, useProductInterests, type ProductInterestResponse } from '@/shared/hooks/use-product-interests';
import { DataGrid, type DataGridColumnDef, type SortState } from '@/shared/components/data-grid';
import { ModuleSearchInput } from '@/shared/components/crm/module-search-input';
import { TableIconButton } from '@/shared/components/data-grid/table-icon-button';
import { SelectedRowsBar } from '@/shared/components/crm/selected-rows-bar';
import { LeadsPagination } from '@/shared/components/crm/leads-pagination';
import { DataLoadingSpinner } from '@/shared/components/crm/data-view-states';
import { AvatarCell } from '@/shared/components/crm/avatar-cell';
import { formatDate, formatDateTime, getInitials } from '@/shared/components/data-grid/cell-renderers';
import { Badge } from '@/shared/components/ui/badge';
import { executeSelectedRows } from '@/shared/components/crm/bulk-selection-bar';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { RefreshButton } from '@/shared/components/crm/refresh-button';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { Button, CreateButton } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { ProductEditor } from './product-editor';
import { ManageProductCategories } from './manage-product-categories';

const php = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

function ProductView({ initialProduct }: { initialProduct: ProductInterest }) {
  const id = initialProduct.id;
  const { user } = useAuth();
  const canViewDeals = useHasPermission('products.view_closed_won');
  const [product, setProduct] = useState(initialProduct);
  const [deals, setDeals] = useState<ProductWonDeal[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [productError, setProductError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    apiClient.get<{ data: ProductInterest }>(`${endpoint}/${id}`, { signal: controller.signal })
      .then(detail => { if (!controller.signal.aborted) setProduct(detail.data); })
      .catch(e => { if (!controller.signal.aborted) setProductError(e.message); });
    return () => controller.abort();
  }, [id, user?.tenantId]);
  const loadDeals = useCallback(async () => {
    if (!canViewDeals || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true); setError('');
    try {
      const result = await apiClient.get<PaginatedResponse<ProductWonDeal>>(`${endpoint}/${id}/closed-won?page=${page}&limit=${pageSize}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setDeals(result.data); setTotal(result.meta.total);
      setPage(current => Math.min(current, Math.max(1, Math.ceil(result.meta.total / pageSize))));
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load Closed Deal records.'); }
    finally { if (pending.current === controller) { pending.current = null; setLoading(false); } }
  }, [id, page, pageSize, canViewDeals, user?.tenantId]);
  useEffect(() => {
    void loadDeals();
    return () => { pending.current?.abort(); pending.current = null; };
  }, [loadDeals]);
  const columns: DataGridColumnDef<ProductWonDeal>[] = [
    { id: 'customer', header: 'Contacts', accessor: row => row.customers.join(', '), width: 210, minWidth: 180, cell: (_, row) => {
      const name = row.customers.join(', ') || row.company || 'No customer linked';
      return <AvatarCell name={name} initials={getInitials(name)} subtitle={row.customers.length ? row.company ?? undefined : undefined} />;
    } },
    { id: 'closedAt', header: 'Won', accessor: row => formatDate(row.closedAt), width: 130, minWidth: 120 },
    { id: 'assignedAgent', header: 'Assigned Agent', accessor: row => row.assignedAgent || '—', width: 175, minWidth: 160 },
  ];
  const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
  return <div className="min-w-0 space-y-8">
    {productError && <p role="alert" className="text-sm text-destructive">{productError}</p>}
    <dl className="space-y-6 text-sm [overflow-wrap:anywhere]">
      <div><dt className={labelClass}>Product Name</dt><dd className="mt-2 text-xl font-semibold leading-snug">{product.name}</dd></div>
      <div><dt className={labelClass}>Category</dt><dd className="mt-2">{product.category || 'Uncategorized'}</dd></div>
      <div><dt className={labelClass}>Description</dt><dd className="mt-2 whitespace-pre-wrap">{product.description || '—'}</dd></div>
      <div className="grid grid-cols-1 gap-5 min-[390px]:grid-cols-2">
        <div><dt className={labelClass}>Deal Value</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{php.format(product.dealValue)}</dd></div>
        <div><dt className={labelClass}>Status</dt><dd className="mt-2"><Badge variant={product.active ? 'success' : 'secondary'} className="rounded-full"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{product.active ? 'Active' : 'Archived'}</Badge></dd></div>
      </div>
      <div className="grid grid-cols-1 gap-5 border-t border-border pt-5 min-[390px]:grid-cols-2">
        <div><dt className={labelClass}>Created</dt><dd className="mt-2">{formatDateTime(product.createdAt)}</dd></div>
        <div><dt className={labelClass}>Updated</dt><dd className="mt-2">{formatDateTime(product.updatedAt)}</dd></div>
      </div>
    </dl>
    <section className="min-w-0 space-y-3" aria-label="Closed Deal">
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Closed Deal</h3><div className="flex shrink-0 items-center gap-2">
        {canViewDeals && total !== null && <Badge variant="secondary">{total} {total === 1 ? 'record' : 'records'}</Badge>}
        {canViewDeals && <RefreshButton label="Refresh Closed Deal" refreshing={loading} onClick={loadDeals} />}
      </div></div>
      {!canViewDeals ? <p className="text-sm text-muted-foreground">Deal viewing permission is required.</p> : <>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="relative min-h-40 min-w-0 max-w-full" aria-busy={loading}>
          <DataGrid columns={columns} data={deals} getRowId={row => row.id} height="auto" viewMode="wrap" enableColumnMenu={false} ariaLabel="Closed Deal table" emptyMessage={loading || error ? '' : 'No Closed Deal records found.'} />
          {loading && <DataLoadingSpinner label="Loading Closed Deal" hideLabel className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card/95 p-3" />}
        </div>
        <LeadsPagination currentPage={page} pageSize={pageSize} totalRecords={total ?? 0} disabled={loading} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
      </>}
    </section>
  </div>;
}

export function ProductsPage() {
  const { products, categories, loading, error, refresh, enabled, hasLoaded } = useProductInterests();
  const canEdit = useHasPermission('products.edit'), canCreate = useHasPermission('products.create'), canArchive = useHasPermission('products.archive');
  const { user } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<{ mode: 'view' | 'edit' | 'new'; product?: ProductInterest } | null>(null);
  const [archiveIds, setArchiveIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [manageCategories, setManageCategories] = useState(false);
  const lock = useRef(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setSelected(new Set()); setPanel(null); setArchiveIds([]); setManageCategories(false); }, [user?.tenantId]);
  useEffect(() => { setSelected(new Set()); }, [page, pageSize, search]);
  const filtered = products.filter(product => [product.name, product.category, product.description].join(' ').toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => {
    const others = Number(a.name.trim().toLowerCase() === 'others') - Number(b.name.trim().toLowerCase() === 'others');
    if (others) return others;
    if (!sort) return 0;
    const comparison = sort.field === 'dealValue' ? a.dealValue - b.dealValue : String(a[sort.field as keyof ProductInterest] ?? '').localeCompare(String(b[sort.field as keyof ProductInterest] ?? ''));
    return sort.direction === 'desc' ? -comparison : comparison;
  });
  useEffect(() => { setPage(value => Math.min(value, Math.max(1, Math.ceil(filtered.length / pageSize)))); }, [filtered.length, pageSize]);
  const changed = (result: ProductInterestResponse) => window.dispatchEvent(new CustomEvent('product-interests-changed', { detail: result }));
  async function changeCategory(input: ProductCategoryMutation) {
    const allowed = input.action === 'add' ? canCreate : input.action === 'rename' ? canEdit : canArchive;
    if (!allowed || lock.current) throw new Error('This action is unavailable.');
    lock.current = true; setBusy(true);
    try {
      changed(await apiClient.patch<ProductInterestResponse>(endpoint + '/categories', input));
      toast.success(input.action === 'add' ? 'Category added successfully.' : input.action === 'rename' ? 'Category updated successfully.' : 'Category deleted successfully.');
    } finally { lock.current = false; setBusy(false); }
  }
  async function enableProducts() {
    if (!canCreate || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      changed(await apiClient.post<ProductInterestResponse>(endpoint + '/field', {}));
      toast.success('Product Interest field enabled.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to enable products.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save(data: Partial<ProductInterestInput>) {
    if (!(panel?.mode === 'edit' ? canEdit : canCreate) || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = panel?.mode === 'edit' ? await apiClient.patch<ProductInterestResponse>(`${endpoint}/${panel.product!.id}`, data) : await apiClient.post<ProductInterestResponse>(endpoint, data);
      changed(result); setPanel(null); toast.success(panel?.mode === 'edit' ? 'Product updated successfully.' : 'Product created successfully.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to save product.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function archive() {
    if (!canArchive || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const { succeeded, failed } = await executeSelectedRows(archiveIds, async id => changed(await apiClient.delete<ProductInterestResponse>(`${endpoint}/${id}`)));
      setSelected(previous => new Set([...previous].filter(id => !succeeded.includes(id))));
      setArchiveIds(failed); refresh();
      if (succeeded.length) toast.success(`${succeeded.length} product(s) archived.`);
      if (failed.length) throw new Error(`${failed.length} product(s) could not be archived. Review your permissions and retry the remaining products.`);
    } finally { lock.current = false; setBusy(false); }
  }
  const columns: DataGridColumnDef<ProductInterest>[] = [
    { id: 'name', header: 'Product Name', accessor: row => row.name, sortable: true, width: 330 },
    { id: 'category', header: 'Category', accessor: row => row.category || 'Uncategorized', sortable: true, width: 220 },
    { id: 'description', header: 'Description', accessor: row => row.description || '—', sortable: true, width: 300 },
    { id: 'dealValue', header: 'Deal Value', accessor: row => row.dealValue, sortable: true, width: 190, cell: (_, row) => php.format(row.dealValue) },
    { id: 'status', header: 'Status', accessor: row => row.active ? 'Active' : 'Archived', width: 120 },
    { id: 'actions', header: 'Actions', accessor: () => '', width: 110, cell: (_, row) => <TableIconButton touchFriendly label="Edit product" disabled={!canEdit || busy} onClick={() => setPanel({ mode: 'edit', product: row })}><Edit size={14} /></TableIconButton> },
  ];
  return <div className="min-w-0 max-w-full space-y-4">
    <PageHeader title="Products" subtitle="Manage products and their default Deal values."
      actions={<>
        {(canCreate || canEdit || canArchive) && <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Manage Product Categories" title="Manage Categories" disabled={busy} onClick={() => setManageCategories(true)}><Settings size={16} aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>Manage Categories</TooltipContent></Tooltip></TooltipProvider>}
        {canCreate && <CreateButton label="Add Product" disabled={busy || !enabled} onClick={() => setPanel({ mode: 'new' })} />}
      </>} />
    <div data-selection-toolbar role="toolbar" aria-label="Products controls" className="flex min-w-0 flex-nowrap items-center gap-2">
      <div className="min-w-0 flex-1 sm:flex-none"><ModuleSearchInput label="Search products" placeholder="Search products..." value={search} onChange={value => { setSearch(value); setPage(1); }} /></div>
      <div className="shrink-0"><RefreshButton label="Refresh products" refreshing={loading} disabled={busy || loading} onClick={refresh} /></div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!enabled && <div className="space-y-2"><p className="text-sm text-muted-foreground">Enable Product Interest to add products.</p>{canCreate && <Button variant="outline" disabled={busy} onClick={() => void enableProducts()}>Enable Product Interest</Button>}</div>}
    {loading && !hasLoaded && !products.length ? <TableLoadingState label="Loading products" /> : <DataGrid isRefreshing={loading} columns={columns} data={filtered.slice((page - 1) * pageSize, page * pageSize)} getRowId={row => row.id} height="auto" selectable={canArchive} selectedIds={selected} onSelectionChange={ids => { if (!busy) setSelected(ids); }} sort={sort} onSortChange={setSort} sortingMode="external" enableColumnMenu={false} ariaLabel="Products table" summaryLabel={`${filtered.length} products`} onRowClick={product => setPanel({ mode: 'view', product })}
      rowActions={product => [{ id: 'view', label: 'View', icon: <Eye size={14} />, onClick: () => setPanel({ mode: 'view', product }) }, ...((canEdit || canArchive) ? [
        { id: 'edit', label: 'Edit', icon: <Edit size={14} />, disabled: busy || !canEdit, onClick: () => setPanel({ mode: 'edit', product }) },
        { id: 'archive', label: 'Archive', icon: <Archive size={14} />, separator: true, disabled: busy || !canArchive, onClick: () => setArchiveIds([product.id]) },
      ] : [])]} />}
    <LeadsPagination currentPage={page} pageSize={pageSize} totalRecords={filtered.length} loading={loading && !hasLoaded} refreshing={loading && hasLoaded} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} disabled={busy} />
    <SelectedRowsBar count={selected.size} onClear={() => setSelected(new Set())} disabled={busy}>{canArchive && <Button variant="outline" disabled={busy} onClick={() => setArchiveIds([...selected])}>Archive</Button>}</SelectedRowsBar>
    <SlidingDrawer isOpen={!!panel} onClose={() => { if (!busy) setPanel(null); }} eyebrow={panel?.mode === 'view' ? 'Product Record' : undefined} title={panel?.mode === 'new' ? 'New Product' : panel?.mode === 'edit' ? 'Edit Product' : 'Product details'} subtitle={panel?.mode === 'new' ? 'Complete the product details below.' : undefined}>
      <div className={panel?.mode === 'view' ? 'min-w-0 px-4 py-6 sm:px-6' : 'h-full min-h-0 min-w-0'}>{panel?.mode === 'view' ? <ProductView key={panel.product!.id} initialProduct={panel.product!} /> : panel && <ProductEditor key={panel.product?.id ?? 'new'} product={products.find(product => product.id === panel.product?.id) ?? panel.product} categories={categories} canCreateCategory={canCreate} onCreateCategory={name => changeCategory({ action: 'add', name })} busy={busy} onSave={save} onCancel={() => setPanel(null)} />}</div>
    </SlidingDrawer>
    <ManageProductCategories key={user?.tenantId} open={manageCategories} onOpenChange={setManageCategories} categories={categories} pending={busy} ready={hasLoaded && !error} canCreate={canCreate} canEdit={canEdit} canDelete={canArchive} mutate={changeCategory} />
    <ConfirmActionDialog open={archiveIds.length > 0} onOpenChange={open => { if (!open && !busy) setArchiveIds([]); }} title={archiveIds.length === 1 ? 'Archive this product?' : `Archive ${archiveIds.length} products?`} description="Archived products are removed from new selections. Historical records and Deal values remain unchanged." confirmLabel="Archive" variant="destructive" isLoading={busy} onConfirm={archive} />
  </div>;
}
