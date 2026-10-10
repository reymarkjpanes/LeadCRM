import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Archive } from 'lucide-react';
import { ConfirmActionDialog, type ConfirmActionOptions } from '../confirm-action-dialog';
import { useConfirmDialog } from '@/shared/hooks/use-confirm-dialog';

afterEach(cleanup);

function Harness(options: ConfirmActionOptions) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open confirmation</button><ConfirmActionDialog {...options} open={open} onOpenChange={setOpen} /></>;
}
const open = () => { const trigger = screen.getByRole('button', { name: 'Open confirmation' }); trigger.focus(); fireEvent.click(trigger); return trigger; };
const deferred = () => { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

describe('canonical confirmation behavior', () => {
  it.each(['Cancel', 'Close confirmation', 'Escape', 'backdrop'])('dismisses with %s without running the action and restores focus', async method => {
    const action = vi.fn();
    render(<Harness title="Archive?" description="Keep the history." onConfirm={action} />);
    const trigger = open();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.body.style.overflow).toBe('hidden');
    if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else if (method === 'backdrop') fireEvent.click(document.querySelector('[data-confirm-action-layer] > [aria-hidden]')!);
    else fireEvent.click(screen.getByRole('button', { name: method }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(action).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('');
  });

  it('prevents double submission and dismissal while a request is pending, then closes on success', async () => {
    const request = deferred(), action = vi.fn(() => request.promise);
    render(<Harness title="Archive?" onConfirm={action}><label>Reason<input /></label></Harness>);
    open();
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelector('[data-confirm-action-layer] > [aria-hidden]')!);
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('textbox').matches(':disabled')).toBe(true);
    await act(async () => request.resolve());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('retains actionable API errors and allows retry; a new opening clears old errors', async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error('Permission denied. Ask an administrator to grant archive access.')).mockResolvedValue(undefined);
    render(<Harness title="Archive?" onConfirm={action} />); open();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(action).toHaveBeenCalledTimes(2);
    open(); expect(screen.queryByRole('alert')).toBeNull();
  });

  it('respects external loading, required inputs, and a controlled multi-step transition', async () => {
    const action = vi.fn(() => false);
    const { rerender } = render(<Harness title="Continue?" isLoading onConfirm={action} />); open();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); expect(action).not.toHaveBeenCalled();
    rerender(<Harness title="Continue?" confirmDisabled onConfirm={action} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); expect(action).not.toHaveBeenCalled();
    rerender(<Harness title="Continue?" onConfirm={action} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('validates required child fields before executing the confirmation', async () => {
    const action = vi.fn();
    render(<Harness title="Continue?" onConfirm={action}><label>Assigned agent<input required /></label></Harness>); open();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Assigned agent' }), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it('releases body scrolling when success closes both the confirmation and its parent drawer', async () => {
    function DrawerHarness() {
      const [visible, setVisible] = useState(true), [open, setOpen] = useState(false);
      useEffect(() => {
        if (!visible) return;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
      }, [visible]);
      if (!visible) return <p>Record archived</p>;
      return <><button onClick={() => setOpen(true)}>Open confirmation</button>
        <ConfirmActionDialog open={open} onOpenChange={setOpen} title="Archive?" onConfirm={() => setVisible(false)} /></>;
    }
    render(<DrawerHarness />); open();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Record archived');
    expect(document.body.style.overflow).toBe('');
  });

  it('traps keyboard focus including links and custom tab stops and protects the parent Escape handler', () => {
    const parentEscape = vi.fn(); window.addEventListener('keydown', parentEscape);
    render(<Harness title="Confirm?" onConfirm={vi.fn()}><a href="#details">Details</a><div tabIndex={0}>Extra detail</div></Harness>); open();
    const dialog = screen.getByRole('alertdialog');
    screen.getByRole('button', { name: 'Confirm' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close confirmation' }));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }));
    screen.getByRole('button', { name: 'Open confirmation' }).focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(parentEscape).not.toHaveBeenCalled(); window.removeEventListener('keydown', parentEscape);
  });

  it('uses unique title and description IDs and omits absent descriptions', () => {
    const { container, rerender } = render(<><ConfirmActionDialog open title="First" description="First details" onOpenChange={vi.fn()} onConfirm={vi.fn()} /><ConfirmActionDialog open={false} title="Second" onOpenChange={vi.fn()} onConfirm={vi.fn()} /></>);
    const first = screen.getByRole('alertdialog'), firstId = first.getAttribute('aria-labelledby');
    expect(document.getElementById(firstId!)?.textContent).toBe('First');
    expect(document.getElementById(first.getAttribute('aria-describedby')!)?.textContent).toBe('First details');
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    rerender(<><ConfirmActionDialog open={false} title="First" description="First details" onOpenChange={vi.fn()} onConfirm={vi.fn()} /><ConfirmActionDialog open title="Second" onOpenChange={vi.fn()} onConfirm={vi.fn()} /></>);
    const second = screen.getByRole('alertdialog');
    expect(second.getAttribute('aria-labelledby')).not.toBe(firstId);
    expect(second.hasAttribute('aria-describedby')).toBe(false);
  });

  it('ignores completion of a dismissed session after another confirmation opens', async () => {
    const request = deferred(), change = vi.fn();
    const { rerender } = render(<ConfirmActionDialog open title="First" onOpenChange={change} onConfirm={() => request.promise} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    rerender(<ConfirmActionDialog open={false} title="First" onOpenChange={change} onConfirm={() => request.promise} />);
    rerender(<ConfirmActionDialog open title="Second" onOpenChange={change} onConfirm={vi.fn()} />);
    await act(async () => request.resolve()); expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Second' })).toBeTruthy();
  });

  it.each(['default', 'destructive', 'success', 'warning'] as const)('supports the %s variant through the existing hook', async variant => {
    const action = vi.fn();
    function HookHarness() {
      const { confirm, dialogProps } = useConfirmDialog();
      return <><button onClick={() => confirm({ title: 'Archive Role?', variant, icon: Archive, confirmLabel: 'Archive Role', cancelLabel: 'Keep role', warning: 'Review assigned users.', onConfirm: action })}>Open confirmation</button><ConfirmActionDialog {...dialogProps} /></>;
    }
    render(<HookHarness />); open();
    expect(screen.getByRole('button', { name: 'Keep role' })).toBeTruthy();
    expect(screen.getByText('Review assigned users.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Archive Role' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(action).toHaveBeenCalledTimes(1);
  });
});
