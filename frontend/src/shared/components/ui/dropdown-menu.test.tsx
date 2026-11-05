import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';

vi.mock('motion/react', () => ({ motion: { div: ({ initial, animate, exit, transition, ...props }: any) => <div {...props} /> }, AnimatePresence: ({ children }: any) => children }));
afterEach(cleanup);

function Menu({ loading = false, onSelect = () => {}, onClick }: { loading?: boolean; onSelect?: () => void; onClick?: React.MouseEventHandler<HTMLDivElement> }) {
  return <><DropdownMenu><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent>
    <DropdownMenuItem disabled={loading} onSelect={onSelect} onClick={onClick}>Edit deal</DropdownMenuItem>
    <DropdownMenuItem disabled>Unavailable</DropdownMenuItem>
    <DropdownMenuItem disabled={loading}>Add a task</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu><button>Outside</button></>;
}
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

function SelectionMenu({ focusSelectedItem = false, selectedDisabled = false }: { focusSelectedItem?: boolean; selectedDisabled?: boolean }) {
  return <DropdownMenu><DropdownMenuTrigger>Statuses</DropdownMenuTrigger><DropdownMenuContent focusSelectedItem={focusSelectedItem}>
    <DropdownMenuItem role="menuitemradio" aria-checked={false}>Inquiry</DropdownMenuItem>
    <DropdownMenuItem role="menuitemradio" aria-checked disabled={selectedDisabled}>Warm</DropdownMenuItem>
    <DropdownMenuItem role="menuitemradio" aria-checked={false}>Cold</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}

it.each([false, true])('only prefers the checked item when selected focus is enabled (%s)', async focusSelectedItem => {
  const view = render(<SelectionMenu focusSelectedItem={focusSelectedItem} />);
  const trigger = screen.getByRole('button', { name: 'Statuses' });
  trigger.focus(); fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const preferred = screen.getByRole('menuitemradio', { name: focusSelectedItem ? 'Warm' : 'Inquiry' });
  await waitFor(() => expect(document.activeElement).toBe(preferred));
  expect(preferred.tabIndex).toBe(0);
  fireEvent.keyDown(preferred, { key: 'ArrowDown' });
  const next = screen.getByRole('menuitemradio', { name: focusSelectedItem ? 'Cold' : 'Warm' });
  expect(document.activeElement).toBe(next);
  view.rerender(<SelectionMenu focusSelectedItem={focusSelectedItem} />);
  await frame();
  expect(document.activeElement).toBe(next);
});

it('falls back to the first enabled item when the checked item is disabled', async () => {
  render(<SelectionMenu focusSelectedItem selectedDisabled />);
  const trigger = screen.getByRole('button', { name: 'Statuses' });
  trigger.focus(); fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const inquiry = screen.getByRole('menuitemradio', { name: 'Inquiry' });
  await waitFor(() => expect(document.activeElement).toBe(inquiry));
  expect(screen.getByRole('menuitemradio', { checked: true }).textContent).toBe('Warm');
  expect(inquiry.getAttribute('aria-checked')).toBe('false');
});

it('focuses newly enabled actions after an async read, skips disabled actions and preserves the current menu focus on rerender', async () => {
  const view = render(<Menu loading />);
  const trigger = screen.getByRole('button', { name: 'Actions' }); trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menuitem', { name: 'Edit deal' }); await frame();
  expect(document.activeElement).toBe(trigger);
  view.rerender(<Menu />);
  const first = screen.getByRole('menuitem', { name: 'Edit deal' });
  await waitFor(() => expect(document.activeElement).toBe(first));
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  const next = screen.getByRole('menuitem', { name: 'Add a task' }); expect(document.activeElement).toBe(next);
  view.rerender(<Menu />); await frame(); expect(document.activeElement).toBe(next);
  fireEvent.keyDown(next, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it.each(['Enter', ' '])('selects a keyboard action once with %j and restores trigger focus', async key => {
  const selected = vi.fn(); render(<Menu onSelect={selected} />);
  const trigger = screen.getByRole('button', { name: 'Actions' }); trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const item = await screen.findByRole('menuitem', { name: 'Edit deal' });
  await waitFor(() => expect(document.activeElement).toBe(item));
  fireEvent.keyDown(item, { key });
  expect(selected).toHaveBeenCalledOnce(); expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('retains a consumer-cancelled action and does not steal focus while async items become enabled', async () => {
  const selected = vi.fn(); const cancel: React.MouseEventHandler<HTMLDivElement> = event => event.preventDefault();
  const view = render(<Menu onSelect={selected} onClick={cancel} />);
  const trigger = screen.getByRole('button', { name: 'Actions' }); trigger.focus(); fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const item = await screen.findByRole('menuitem', { name: 'Edit deal' }); fireEvent.keyDown(item, { key: 'Enter' });
  expect(selected).not.toHaveBeenCalled(); expect(screen.getByRole('menu')).toBeTruthy();
  view.rerender(<Menu loading />); const outside = screen.getByRole('button', { name: 'Outside' }); outside.focus();
  view.rerender(<Menu />); await frame(); expect(document.activeElement).toBe(outside);
});

it('keeps custom picker width anchored to the trigger after opening and resizing', async () => {
  render(<DropdownMenu><DropdownMenuTrigger>Products</DropdownMenuTrigger><DropdownMenuContent align="start" style={{ width: 220 }}><DropdownMenuItem>Camera</DropdownMenuItem></DropdownMenuContent></DropdownMenu>);
  const trigger=screen.getByRole('button', { name: 'Products' });
  let left=700, bottom=344;
  const bounds=vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => ({ x:left, y:bottom-44, left, right:left+220, top:bottom-44, bottom, width:220, height:44, toJSON:()=>({}) }));
  try {
    fireEvent.click(trigger); const menu=await screen.findByRole('menu');
    await waitFor(() => expect(menu.style.left).toBe('700px'));
    expect(menu.style.top).toBe('348px'); expect(menu.style.width).toBe('220px');
    left=500; bottom=294; fireEvent(window, new Event('resize'));
    await waitFor(() => expect(menu.style.left).toBe('500px'));
    expect(menu.style.top).toBe('298px'); expect(menu.style.width).toBe('220px');
  } finally { bounds.mockRestore(); }
});
