import React, { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import InboxPage from './inbox-page';
import { leadEmailComposeHref } from '../services/compose-navigation';

const mocks = vi.hoisted(() => ({ send: vi.fn(), save: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
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
  window.history.replaceState({ retained: true }, '', `${leadEmailComposeHref(email)}&view=sent#mail`);
  const view = render(<StrictMode><InboxPage /></StrictMode>);
  await waitFor(() => expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe(email));
  expect(window.location.search).toBe('?view=sent');
  expect(window.location.hash).toBe('#mail');
  expect(window.history.state).toEqual({ retained: true });
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
  expect(leadEmailComposeHref(email)).toBeNull();
});
