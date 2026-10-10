import React, { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import InboxPage from './inbox-page';
import { recordEmailComposeHref } from '../services/compose-navigation';

const mocks = vi.hoisted(() => ({ send: vi.fn(), save: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('../services/gmail.service', () => ({
  getGmailStatus: async () => ({ isConnected: true, email: 'staff@example.test' }),
  fetchGmailEmails: async () => ({ emails: [] }), syncGmail: vi.fn(), disconnectGmail: vi.fn(),
  sendGmailEmail: mocks.send, saveGmailDraft: mocks.save,
}));
vi.mock('motion/react', () => ({ motion: { div: ({ initial, animate, exit, transition, ...props }: any) => <div {...props} /> }, AnimatePresence: ({ children }: any) => children, useReducedMotion: () => true }));

beforeEach(() => { vi.clearAllMocks(); window.history.replaceState({}, '', '/inbox'); });
afterEach(cleanup);

it('consumes a Lead action once, preserves exact recipient, clears fresh compose and refresh, and never sends', async () => {
  const email = 'Lina+sales@Example.test';
  window.history.replaceState({ retained: true }, '', `${recordEmailComposeHref(email)}&view=sent#mail`);
  const view = render(<StrictMode><InboxPage /></StrictMode>);
  await waitFor(() => expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe(email));
  expect(window.location.search).toBe('?view=sent');
  expect(window.location.hash).toBe('#mail');
  expect(window.history.state).toEqual({ retained: true });
  expect(mocks.replace).toHaveBeenCalledWith('/inbox?view=sent#mail', { scroll: false });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Compose new email' }));
  expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('');
  view.unmount();
  render(<InboxPage />);
  await screen.findByRole('button', { name: 'Compose new email' });
  expect(screen.queryByLabelText('To')).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it.each(['?to=lina@example.test', '?compose=lead-email&to=broken', '?compose=lead-email', ''])('does not open broken or unrequested compose: %s', async query => {
  window.history.replaceState({}, '', `/inbox${query}`);
  render(<InboxPage />);
  await screen.findByRole('button', { name: 'Compose new email' });
  expect(screen.queryByLabelText('To')).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each(['', 'broken', 'two@example.test,other@example.test', 'a@example.test\nBcc: b@example.test'])('rejects invalid Lead email %s', email => {
  expect(recordEmailComposeHref(email)).toBeNull();
});

it.each(['Electric Fence', 'Laptop/Server/Data Cabinets', 'Access & Alarm + Security'])('opens an editable Deal draft for %s once without sending', async product => {
  window.history.replaceState({}, '', recordEmailComposeHref('customer+sales@example.test', `${product} Inquiry`));
  const view = render(<StrictMode><InboxPage /></StrictMode>);
  await waitFor(() => expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('customer+sales@example.test'));
  const subject = screen.getByPlaceholderText('Subject') as HTMLInputElement;
  expect(subject.value).toBe(`${product} Inquiry`);
  expect(document.querySelector('[contenteditable="true"]')?.textContent).toBe('');
  fireEvent.change(subject, { target: { value: 'Updated inquiry' } });
  expect(subject.value).toBe('Updated inquiry');
  expect(window.location.search).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Compose new email' }));
  expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('');
  view.unmount(); render(<InboxPage />);
  await screen.findByRole('button', { name: 'Compose new email' });
  expect(screen.queryByLabelText('To')).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
