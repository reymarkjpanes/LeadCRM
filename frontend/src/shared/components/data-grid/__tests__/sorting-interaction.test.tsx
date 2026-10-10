import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DataGrid } from '../data-grid';
import type { SortState } from '../types';
import { LeadsDataGrid } from '@/features/tenant/crm/leads/ui/leads-data-grid';
import { LEADS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';
import { compareSortValues, normalizeLeadColumns } from '@leadcrm/shared';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const records = [
  { id: 'z', firstName: 'Zulu', lastName: 'Test', email: 'z@test.example', phone: '300', companyName: 'Z', status: 'Warm', createdAt: '2026-03-01', source: 'Z' },
  { id: 'a', firstName: 'Alpha', lastName: 'Test', email: 'a@test.example', phone: '100', companyName: 'A', status: 'Cold', createdAt: '2026-01-01', source: 'A' },
];
const columns = LEADS_COLUMN_REGISTRY.filter(c => c.defaultVisible).map(c => ({ id: c.id, visible: true, order: c.defaultOrder }));
function LeadHarness() {
  const [sort, setSort] = useState<SortState | null>(null);
  const rows = sort ? [...records].sort((a, b) => compareSortValues(a[sort.field as keyof typeof a], b[sort.field as keyof typeof b], sort.direction)) : records;
  return <LeadsDataGrid leads={rows as any} totalRecords={2} effectiveColumns={columns} sort={sort} onSortChange={setSort}
    onRowClick={() => {}} selectedIds={new Set()} onSelectionChange={() => {}} getOwnerName={() => ''} getOwnerInitials={() => ''} />;
}
it.each(['Name', 'Email address', 'Phone number', 'Company', 'Status', 'Created', 'Source'])('cycles %s ascending, descending and default with matching rows', label => {
  render(<LeadHarness />);
  const header = screen.getByRole('columnheader', { name: label });
  const firstName = () => screen.getAllByRole('row').slice(1).find(row => row.textContent?.includes('Test'))!.textContent;
  expect(firstName()).toContain('Zulu');
  fireEvent.click(header); expect(header.getAttribute('aria-sort')).toBe('ascending'); expect(firstName()).toContain('Alpha');
  fireEvent.click(header); expect(header.getAttribute('aria-sort')).toBe('descending'); expect(firstName()).toContain('Zulu');
  fireEvent.click(header); expect(header.getAttribute('aria-sort')).toBe('none'); expect(firstName()).toContain('Zulu');
});
it('never reorders an externally sorted server page', () => {
  render(<DataGrid columns={[{ id: 'firstName', header: 'Name', accessor: row => row.firstName, sortable: true }]}
    data={records} getRowId={row => row.id} sortingMode="external" sort={{ field: 'firstName', direction: 'asc' }} />);
  expect(screen.getAllByRole('row')[1].textContent).toContain('Zulu');
});
it.each([320, 1440])('keeps separate email/phone toggles and removes the retired column at %s px', width => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  const migrated = normalizeLeadColumns([{ id: 'emailAndPhone', visible: true, order: 1 }, ...columns]);
  const props = { leads: records as any, totalRecords: 2, onRowClick: () => {}, selectedIds: new Set<string>(), onSelectionChange: () => {}, getOwnerName: () => '', getOwnerInitials: () => '' };
  const view = render(<LeadsDataGrid {...props} effectiveColumns={migrated} />);
  expect(screen.queryByText('Email & Phone')).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Email address' })).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Phone number' })).toBeTruthy();
  view.rerender(<LeadsDataGrid {...props} effectiveColumns={migrated.map(col => col.id === 'email' ? { ...col, visible: false } : col)} />);
  expect(screen.queryByRole('columnheader', { name: 'Email address' })).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Phone number' })).toBeTruthy();
});
