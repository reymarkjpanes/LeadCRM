import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RowActionsMenu, buildDefaultRowActions } from '../row-actions-menu';
import { LeadsDataGrid } from '@/features/tenant/crm/leads/ui/leads-data-grid';
import { ContactsDataGrid } from '@/features/tenant/crm/contacts/ui/contacts-data-grid';
import { AccountsDataGrid } from '@/features/tenant/crm/accounts/ui/accounts-data-grid';

let trigger = { top: 100, bottom: 128, left: 50, right: 78 };
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  trigger = { top: 100, bottom: 128, left: 50, right: 78 };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return (this.getAttribute('aria-label') === 'Row actions' ? trigger : { width: 180, height: 300 }) as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const open = () => fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' }).at(-1)!);
function menu() {
  const action = vi.fn();
  render(<RowActionsMenu actions={buildDefaultRowActions({ onView: action, onArchive: action })} />);
  open();
  return action;
}
it('opens downward through a fixed body portal with enough space', () => {
  menu();
  const dropdown = screen.getByRole('menu');
  expect(dropdown.parentElement).toBe(document.body);
  expect(dropdown.style.top).toBe('132px');
  expect(dropdown.style.left).toBe('50px');
});
it('flips upward at the bottom and follows scroll/resize', () => {
  trigger = { ...trigger, top: 550, bottom: 578 };
  menu();
  expect(screen.getByRole('menu').style.top).toBe('246px');
  trigger = { ...trigger, top: 100, bottom: 128 };
  fireEvent.scroll(window);
  expect(screen.getByRole('menu').style.top).toBe('132px');
  trigger = { ...trigger, left: 790, right: 818 };
  fireEvent.resize(window);
  expect(screen.getByRole('menu').style.left).toBe('612px');
});
it.each([-30, 790])('clamps horizontally for a trigger at %s', left => {
  trigger = { ...trigger, left, right: left + 28 };
  menu();
  expect(screen.getByRole('menu').style.left).toBe(left < 0 ? '8px' : '612px');
});
it('closes on Escape, outside clicks, and selection', () => {
  const action = menu();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Row actions' }));
  open(); fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
  open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});
it.each(['leads', 'contacts', 'accounts'])('last %s row has Archive, no Delete or Add Tags', module => {
  trigger = { ...trigger, top: 550, bottom: 578 };
  const records = [{ id: 'one', firstName: 'First', name: 'First' }, { id: 'last', firstName: 'Last', name: 'Last' }];
  const props = { effectiveColumns: [], totalRecords: 2, onRowClick: vi.fn(), selectedIds: new Set<string>(), onSelectionChange: vi.fn(), getOwnerName: () => '', getOwnerInitials: () => '', getAccountName: () => '', getAssignedUserName: () => '', onArchive: vi.fn(), canArchive: true };
  if (module === 'leads') render(<LeadsDataGrid {...props} leads={records as any} />);
  if (module === 'contacts') render(<ContactsDataGrid {...props} contacts={records as any} />);
  if (module === 'accounts') render(<AccountsDataGrid {...props} accounts={records as any} />);
  open();
  expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Add Tags' })).toBeNull();
  expect(screen.getByRole('menu').style.top).toBe('246px');
});
it('omits archive when permission is denied', () => {
  expect(buildDefaultRowActions({ onView: vi.fn(), onArchive: vi.fn(), canArchive: false }).map(item => item.id)).toEqual(['view']);
});

it.each([320, 375, 390, 768, 1440])('keeps bottom-row menus in the %spx viewport and toggles the same trigger closed', width => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  trigger = { top: 550, bottom: 578, left: width - 30, right: width - 2 };
  menu(); const dropdown = screen.getByRole('menu');
  expect(parseFloat(dropdown.style.left)).toBeGreaterThanOrEqual(8);
  expect(parseFloat(dropdown.style.left) + 180).toBeLessThanOrEqual(width - 8);
  expect(parseFloat(dropdown.style.top) + 300).toBeLessThanOrEqual(592);
  open(); expect(screen.queryByRole('menu')).toBeNull();
});
