import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmailActivity, EmailConversations, type ActivityEmail } from '../email-activity';
afterEach(cleanup);
it('hides the expansion control when a short message is fully visible', () => {
  const email: ActivityEmail = { id: 'short', providerMessageId: 'short', threadId: 'thread', accountId: 'account', direction: 'outbound', from: 'staff@example.test', to: ['lead@example.test'], subject: 'Quick note', sentAt: '2026-10-01T10:00:00Z', body: 'Thanks, received.' };
  render(<EmailActivity email={email} />);
  expect(screen.queryByRole('button', { name: 'View more' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'View less' })).toBeNull();
});

it('shows newest messages first, deduplicates messages and sanitizes unsafe HTML', () => {
  const make = (id: string, direction: string, body: string, date: string) => ({ id, type: 'email', title: 'generic', createdAt: date, metadata: { email: { id, providerMessageId: id, accountId: 'account', threadId: 'thread', direction, from: direction === 'inbound' ? 'lead@example.test' : 'staff@example.test', to: [direction === 'inbound' ? 'staff@example.test' : 'lead@example.test'], subject: 'Quotation', body, sentAt: date } } });
  const first = make('one', 'outbound', '<p>Exact quotation text</p><img src="https://tracking.example.test/pixel"><script>alert(1)</script><a href="javascript:alert(1)">unsafe</a>', '2026-10-01T10:00:00Z');
  const second = make('two', 'inbound', '<p>Please schedule the installation.</p><blockquote>Earlier email content</blockquote>', '2026-10-01T11:00:00Z');
  const { container } = render(<EmailConversations activities={[second, first, first]} />);
  const articles = container.querySelectorAll('article');
  expect(articles).toHaveLength(2); expect(articles[0].textContent).toContain('Received'); expect(articles[1].textContent).toContain('Sent');
  expect(articles[1].textContent).toContain('From: staff@example.test'); expect(articles[1].textContent).toContain('To: lead@example.test');
  expect(container.querySelector('img, script, [href^="javascript:"]')).toBeNull();
  expect(screen.getByText('Exact quotation text')).toBeTruthy(); expect(screen.getByText('Please schedule the installation.')).toBeTruthy();
  const expand = screen.getAllByRole('button', { name: 'View more' })[0]; fireEvent.click(expand);
  expect(expand.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Earlier email content')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'View less' })).toBeTruthy();
});
