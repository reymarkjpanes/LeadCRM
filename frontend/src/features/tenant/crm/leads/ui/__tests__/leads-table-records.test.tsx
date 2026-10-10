import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LeadsDataGrid } from '../leads-data-grid';
import { toFrontendContact } from '@/lib/api/adapters/contact.adapter';
import type { Lead } from '@/store/types';
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('renders all products and populated API details without relying on the user lookup page', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const owner = { id: 'owner', firstName: 'Alex', lastName: 'Morgan' };
  const lead = toFrontendContact({ id: 'lead', firstName: 'Jordan', lastName: 'Lee',
    productInterest: ['CCTV', 'Biometrics'], description: 'Installation request', website: 'https://example.test',
    assignedUser: owner, assignedUserId: owner.id, createdBy: owner, updatedBy: owner,
  }) as Lead;
  render(<LeadsDataGrid leads={[lead]} totalRecords={1}
    effectiveColumns={['firstName', 'productInterest', 'description', 'website', 'createdBy', 'updatedBy', 'assignedUserId'].map((id, order) => ({ id, order, visible: true }))}
    selectedIds={new Set()} onSelectionChange={vi.fn()} onRowClick={vi.fn()} getOwnerName={() => '—'} getOwnerInitials={() => '?'} />);
  expect(screen.getByText('CCTV')).toBeTruthy();
  expect(screen.getByText('Biometrics')).toBeTruthy();
  expect(screen.getByText('Installation request')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'example.test' }).getAttribute('href')).toBe('https://example.test');
  expect(screen.getAllByText('Alex Morgan')).toHaveLength(3);
});

it('removes the trailing Actions cells while retaining selection, navigation and record email in the row menu', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const lead = { id: 'lead', firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.test' } as Lead;
  const select = vi.fn(), navigate = vi.fn();
  const { container } = render(<LeadsDataGrid leads={[lead]} totalRecords={1}
    effectiveColumns={['firstName', 'email'].map((id, order) => ({ id, order, visible: true }))}
    selectedIds={new Set()} onSelectionChange={select} onRowClick={navigate} getOwnerName={() => '—'} getOwnerInitials={() => '?'} />);
  expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
  expect(container.querySelectorAll('col')).toHaveLength(4); // Menu, checkbox, name, email.
  expect(container.querySelector('tbody tr')?.querySelectorAll('td')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: 'Email' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select record lead' }));
  expect(select).toHaveBeenCalledWith(new Set(['lead']));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Jordan Lee'));
  expect(navigate).toHaveBeenCalledWith(lead);
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Send Email' }));
  expect(push).toHaveBeenCalledWith('/inbox?compose=record-email&to=jordan%40example.test');
});
