'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Eye, Edit, Archive } from 'lucide-react';
import { toast } from 'sonner';
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
import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';
import { executeSelectedRows } from '@/shared/components/crm/bulk-selection-bar';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { RefreshButton } from '@/shared/components/crm/refresh-button';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { Button } from '@/shared/components/ui/button';
import { ProductEditor } from './product-editor';

const php = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

function ProductView({ id }: { id: string }) {
  const { user } = useAuth();
  const canViewDeals = useHasPermission('products.view_closed_won');
  const [product, setProduct] = useState<ProductInterest | null>(null);
  const [deals, setDeals] = useState<ProductWonDeal[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.all([
      apiClient.get<{ data: ProductInterest }>(`${endpoint}/${id}`, { signal: controller.signal }),
      canViewDeals ? apiClient.get<PaginatedResponse<ProductWonDeal>>(`${endpoint}/${id}/closed-won?page=${page}&limit=${pageSize}`, { signal: controller.signal }) : Promise.resolve(null),
    ]).then(([detail, result]) => { if (!controller.signal.aborted) { setProduct(detail.data); setDeals(result?.data ?? []); setTotal(result?.meta?.total ?? 0); } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, page, pageSize, canViewDeals, user?.tenantId]);
  if (loading) return <div role="status" aria-label="Loading product and Closed Won customers"><DataLoadingSkeleton rowCount={8} columnCount={2} /></div>;
  if (error) return <p role="alert" className="text-destructive">{error}</p>;
  return <div className="space-y-6">
    <dl className="space-y-3 text-sm break-words">
      <div><dt className="text-muted-foreground">Product Name</dt><dd>{product?.name}</dd></div>
      <div><dt className="text-muted-foreground">Deal Value</dt><dd>{php.format(product?.dealValue ?? 0)}</dd></div>
      <div><dt className="text-muted-foreground">Status</dt><dd>{product?.active ? 'Active' : 'Archived'}</dd></div>
      <div><dt className="text-muted-foreground">Created</dt><dd>{product && new Date(product.createdAt).toLocaleString()}</dd></div>
      <div><dt className="text-muted-foreground">Updated</dt><dd>{product && new Date(product.updatedAt).toLocaleString()}</dd></div>
    </dl>
    <section className="space-y-3"><h3 className="font-semibold">Closed Won customers</h3>
      {!canViewDeals ? <p className="text-sm text-muted-foreground">Deal viewing permission is required.</p> : <>
        {deals.length === 0 && <p className="text-sm text-muted-foreground">No Closed Won deals for this product.</p>}
        {deals.map(deal => <article key={deal.id} className="border-b border-border py-3 text-sm break-words space-y-1">
          <p className="font-medium">{deal.customers.join(', ') || deal.company || 'No customer linked'}</p>
          {deal.company && <p>{deal.company}</p>}<p>{deal.title}</p>
          <p>{deal.value === null ? '—' : deal.currency === 'PHP' ? php.format(deal.value) : `${deal.currency} ${deal.value.toLocaleString()}`}</p>
          {deal.closedAt && <p className="text-muted-foreground">Closed Won: {new Date(deal.closedAt).toLocaleDateString()}</p>}
          {deal.assignedAgent && <p className="text-muted-foreground">Assigned agent: {deal.assignedAgent}</p>}
        </article>)}
        <LeadsPagination currentPage={page} pageSize={pageSize} totalRecords={total} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
      </>}
    </section>
  </div>;
}

export function ProductsPage() {
  const { products, loading, error, refresh, enabled } = useProductInterests();
  const canEdit = useHasPermission('products.edit'), canCreate = useHasPermission('products.create'), canArchive = useHasPermission('products.archive');
  const { user } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<{ mode: 'view' | 'edit' | 'new'; product?: ProductInterest } | null>(null);
  const [archiveIds, setArchiveIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setSelected(new Set()); setPanel(null); setArchiveIds([]); }, [user?.tenantId]);
  useEffect(() => { setSelected(new Set()); }, [page, pageSize, search]);
  const filtered = products.filter(product => product.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    if (!sort) return 0;
    const comparison = sort.field === 'dealValue' ? a.dealValue - b.dealValue : a.name.localeCompare(b.name);
    return sort.direction === 'desc' ? -comparison : comparison;
  });
  useEffect(() => { setPage(value => Math.min(value, Math.max(1, Math.ceil(filtered.length / pageSize)))); }, [filtered.length, pageSize]);
  const changed = (result: ProductInterestResponse) => window.dispatchEvent(new CustomEvent('product-interests-changed', { detail: result }));
  async function enableProducts() {
    if (!canCreate || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      changed(await apiClient.post<ProductInterestResponse>(endpoint + '/field', {}));
      toast.success('Product Interest field enabled.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to enable products.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save(data: { name: string; dealValue: number }) {
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
      setArchiveIds([]); refresh();
      if (succeeded.length) toast.success(`${succeeded.length} product(s) archived.`);
      if (failed.length) toast.error(`${failed.length} product(s) could not be archived. Refresh and retry.`);
    } finally { lock.current = false; setBusy(false); }
  }
  const columns: DataGridColumnDef<ProductInterest>[] = [
    { id: 'name', header: 'Product Name', accessor: row => row.name, sortable: true, width: 330 },
    { id: 'dealValue', header: 'Deal Value', accessor: row => row.dealValue, sortable: true, width: 190, cell: (_, row) => php.format(row.dealValue) },
    { id: 'status', header: 'Status', accessor: row => row.active ? 'Active' : 'Archived', width: 120 },
    { id: 'actions', header: 'Actions', accessor: () => '', width: 110, cell: (_, row) => <TableIconButton touchFriendly label="Edit product" disabled={!canEdit || busy} onClick={() => setPanel({ mode: 'edit', product: row })}><Edit size={14} /></TableIconButton> },
  ];
  return <div className="min-w-0 max-w-full space-y-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-semibold">Products</h2><p className="mt-1 text-sm text-muted-foreground">Manage products and their default Deal values.</p></div>
      {canCreate && <Button aria-label="Add Product" title="Add Product" disabled={busy || !enabled} onClick={() => setPanel({ mode: 'new' })} className="shrink-0"><Plus size={16} /><span className="hidden sm:inline">Add Product</span></Button>}
    </div>
    <div className="flex flex-wrap items-center gap-2"><ModuleSearchInput label="Search products" placeholder="Search products..." value={search} onChange={value => { setSearch(value); setPage(1); }} /><RefreshButton label="Refresh products" refreshing={loading} disabled={busy || loading} onClick={refresh} /></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!enabled && <div className="space-y-2"><p className="text-sm text-muted-foreground">Enable Product Interest to add products.</p>{canCreate && <Button variant="outline" disabled={busy} onClick={() => void enableProducts()}>Enable Product Interest</Button>}</div>}
    {loading && !products.length ? <TableLoadingState label="Loading products" /> : <DataGrid columns={columns} data={filtered.slice((page - 1) * pageSize, page * pageSize)} getRowId={row => row.id} height="auto" selectable={canArchive} selectedIds={selected} onSelectionChange={ids => { if (!busy) setSelected(ids); }} sort={sort} onSortChange={setSort} sortingMode="external" enableColumnMenu={false} ariaLabel="Products table" summaryLabel={`${filtered.length} products`} onRowClick={product => setPanel({ mode: 'view', product })}
      rowActions={product => [{ id: 'view', label: 'View', icon: <Eye size={14} />, onClick: () => setPanel({ mode: 'view', product }) }, ...((canEdit || canArchive) ? [
        { id: 'edit', label: 'Edit', icon: <Edit size={14} />, disabled: busy || !canEdit, onClick: () => setPanel({ mode: 'edit', product }) },
        { id: 'archive', label: 'Archive', icon: <Archive size={14} />, separator: true, disabled: busy || !canArchive, onClick: () => setArchiveIds([product.id]) },
      ] : [])]} />}
    <LeadsPagination currentPage={page} pageSize={pageSize} totalRecords={filtered.length} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} disabled={busy} />
    <SelectedRowsBar count={selected.size} onClear={() => setSelected(new Set())} disabled={busy}>{canArchive && <Button variant="outline" disabled={busy} onClick={() => setArchiveIds([...selected])}>Archive</Button>}</SelectedRowsBar>
    <SlidingDrawer isOpen={!!panel} onClose={() => { if (!busy) setPanel(null); }} title={panel?.mode === 'new' ? 'New Product' : panel?.mode === 'edit' ? 'Edit Product' : 'Product details'}>
      <div className="min-w-0 p-4 sm:p-6">{panel?.mode === 'view' ? <ProductView key={panel.product!.id} id={panel.product!.id} /> : panel && <ProductEditor key={panel.product?.id ?? 'new'} product={panel.product} busy={busy} onSave={save} onCancel={() => setPanel(null)} />}</div>
    </SlidingDrawer>
    <ConfirmActionDialog open={archiveIds.length > 0} onOpenChange={open => { if (!open && !busy) setArchiveIds([]); }} title={archiveIds.length === 1 ? 'Archive this product?' : `Archive ${archiveIds.length} products?`} description="Archived products are removed from new selections. Historical records and Deal values remain unchanged." confirmLabel="Archive" isLoading={busy} onConfirm={archive} />
  </div>;
}
