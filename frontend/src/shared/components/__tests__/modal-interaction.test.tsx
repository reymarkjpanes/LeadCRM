import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog, DialogContent } from '../ui/dialog';
import { Sheet, SheetContent } from '../ui/sheet';
import { SideSheet } from '../side-sheet';
import { SlidingDrawer } from '../sliding-drawer';
import { DatePicker } from '../ui/date-time-picker';
import { ConfirmActionDialog } from '../crm/confirm-action-dialog';
import { ThemeScope } from '../theme-scope';
import { updateAppearance } from '@/lib/appearance';
import { RowActionsMenu } from '../data-grid/row-actions-menu';

afterEach(() => { cleanup(); localStorage.clear(); });
function Harness({ kind }: { kind: 'dialog' | 'sheet' | 'side-sheet' | 'sliding-drawer' }) {
  const [open, setOpen] = useState(false), [confirm, setConfirm] = useState(false);
  const fields = <><label>Draft<input defaultValue="Keep this draft" /></label>
    <DatePicker id="deadline" value="2026-10-10" todayDate="2026-10-10" onChange={() => {}} />
    <button onClick={() => setConfirm(true)}>Archive draft</button>
    <ConfirmActionDialog open={confirm} onOpenChange={setConfirm} title="Archive draft?" onConfirm={() => {}} />
    <RowActionsMenu label="Draft menu" actions={[{ id: 'inspect', label: 'Inspect draft', onClick: () => {} }]} />
    <button>Last action</button></>;
  return <ThemeScope><button onClick={() => setOpen(true)}>Open editor</button><button>Background action</button>
    {kind === 'dialog' ? <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-label="Editor">{fields}</DialogContent></Dialog> :
      kind === 'sheet' ? <Sheet open={open} onOpenChange={setOpen}><SheetContent aria-label="Editor">{fields}</SheetContent></Sheet> :
      kind === 'sliding-drawer' ? <SlidingDrawer isOpen={open} onClose={() => setOpen(false)} title="Editor">{fields}</SlidingDrawer> :
      <SideSheet isOpen={open} onClose={() => setOpen(false)} title="Editor">{fields}</SideSheet>}
  </ThemeScope>;
}
it.each(['dialog', 'sheet', 'side-sheet', 'sliding-drawer'] as const)('%s traps focus by default, preserves drafts across theme changes and restores its opener', async kind => {
  render(<Harness kind={kind} />);
  const trigger = screen.getByRole('button', { name: 'Open editor' }); trigger.focus(); fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: 'Editor' });
  expect(panel.contains(document.activeElement)).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  screen.getByRole('button', { name: 'Background action' }).focus();
  expect(panel.contains(document.activeElement)).toBe(true);
  const last = screen.getByRole('button', { name: 'Last action' }); last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(panel.contains(document.activeElement)).toBe(true); expect(document.activeElement).not.toBe(last);
  act(() => updateAppearance({ mode: 'Dark' }));
  expect(panel.closest('[data-theme-container]')?.classList.contains('dark')).toBe(true);
  expect(screen.getByLabelText('Draft')).toHaveProperty('value', 'Keep this draft');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe('');
});
it('lets calendar portals receive focus and Escape dismisses the calendar before its parent', async () => {
  render(<Harness kind="sheet" />); fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Oct 10, 2026' }));
  const next = screen.getByRole('button', { name: 'Next month' }); next.focus();
  expect(document.activeElement).toBe(next);
  fireEvent.keyDown(next, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Next month' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Editor' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Oct 10, 2026' }));
});
it('lets a confirmation above a modal own focus, then returns focus to the parent action', async () => {
  render(<Harness kind="dialog" />); fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
  const archive = screen.getByRole('button', { name: 'Archive draft' }); archive.focus(); fireEvent.click(archive);
  const confirmation = screen.getByRole('alertdialog');
  expect(confirmation.closest('[inert]')).toBeNull();
  expect(confirmation.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByRole('dialog')).toBeTruthy(); expect(document.activeElement).toBe(archive);
});
it('dismisses a row menu with Escape before closing the enclosing editor', () => {
  render(<Harness kind="sheet" />); fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
  const trigger = screen.getByRole('button', { name: 'Draft menu' });
  fireEvent.click(trigger);
  const item = screen.getByRole('menuitem', { name: 'Inspect draft' }); item.focus();
  expect(document.activeElement).toBe(item);
  fireEvent.keyDown(item, { key: 'Escape' });
  expect(screen.queryByRole('menuitem', { name: 'Inspect draft' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Editor' })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
});
