import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmailActivity, EmailConversations, type ActivityEmail } from '../email-activity';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const messageFormats = [
  { format: 'plain text', body: 'First line\nSecond line', selector: 'pre', text: 'First line\nSecond line' },
  { format: 'pre and code', body: '<pre>First line\n<code>Second line</code></pre>', selector: 'pre code', text: 'Second line' },
  { format: 'formatted HTML', body: '<p>Hello <strong>bold</strong> <em>italic</em> <a href="https://example.test">link</a><br>Second line</p><p>Next paragraph</p>', selector: 'p', text: 'Hello bold italic linkSecond line' },
];
it.each((['inbound', 'outbound'] as const).flatMap(direction => messageFormats.map(message => ({ direction, ...message }))))('uses shared body typography for $direction $format without changing content or metadata', ({ direction, body, selector, text, format }) => {
  const email: ActivityEmail = { id: 'formatted', providerMessageId: 'formatted', threadId: 'thread', accountId: 'account', direction, from: 'sender@example.test', to: ['recipient@example.test'], subject: 'Typography', sentAt: '2026-10-01T10:00:00Z', body };
  const { container } = render(<EmailActivity email={email} />);
  const content = container.querySelector('[data-email-body]')!;
  expect(content.classList.contains('inbox-message-typography')).toBe(true);
  expect(content.className).not.toMatch(/(?:^|\s)(?:sm:)?(?:text-(?:xs|sm)|leading-\S+)/);
  expect(content.querySelector(selector)?.textContent).toBe(text);
  expect(container.querySelector('dl')?.classList.contains('inbox-message-typography')).toBe(false);
  expect(screen.getByText(direction === 'inbound' ? 'Received' : 'Sent')).toBeTruthy();
  expect(screen.getByText('sender@example.test')).toBeTruthy(); expect(screen.getByText('recipient@example.test')).toBeTruthy();
  expect(screen.getByText('Typography')).toBeTruthy(); expect(container.querySelector('time')?.dateTime).toBe(email.sentAt);
  if (format === 'formatted HTML') {
    expect(content.querySelector('strong')?.textContent).toBe('bold');
    expect(content.querySelector('em')?.textContent).toBe('italic');
    expect(content.querySelector('a')?.getAttribute('href')).toBe('https://example.test');
    expect(content.querySelectorAll('br')).toHaveLength(1); expect(content.querySelectorAll('p')).toHaveLength(2);
  }
  expect(email.body).toBe(body);
});

it('hides the expansion control when a short message is fully visible', () => {
  const email: ActivityEmail = { id: 'short', providerMessageId: 'short', threadId: 'thread', accountId: 'account', direction: 'outbound', from: 'staff@example.test', to: ['lead@example.test'], subject: 'Quick note', sentAt: '2026-10-01T10:00:00Z', body: 'Thanks, received.' };
  render(<EmailActivity email={email} />);
  expect(screen.queryByRole('button', { name: 'View more' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'View less' })).toBeNull();
});

it('shows newest messages first, deduplicates messages and sanitizes unsafe HTML', () => {
  const make = (id: string, direction: string, body: string, date: string) => ({ id, type: 'email', title: 'generic', createdAt: date, metadata: { email: { id, providerMessageId: id, accountId: 'account', threadId: 'thread', direction, from: direction === 'inbound' ? 'lead@example.test' : 'staff@example.test', to: [direction === 'inbound' ? 'staff@example.test' : 'lead@example.test'], subject: 'Quotation', body, sentAt: date } } });
  const first = make('one', 'outbound', '<p>Exact quotation text</p><img src="https://tracking.example.test/pixel"><script>alert(1)</script><a href="javascript:alert(1)">unsafe</a>', '2026-10-01T10:00:00Z');
  const second = make('two', 'inbound', '<p>Please schedule the installation.</p><blockquote type="cite">Earlier email content</blockquote>', '2026-10-01T11:00:00Z');
  const { container } = render(<EmailConversations activities={[second, first, first]} />);
  const articles = container.querySelectorAll('article');
  expect(articles).toHaveLength(2); expect(articles[0].textContent).toContain('Received'); expect(articles[1].textContent).toContain('Sent');
  expect(articles[1].textContent).toContain('From: staff@example.test'); expect(articles[1].textContent).toContain('To: lead@example.test');
  expect(container.querySelector('img, script, [href^="javascript:"]')).toBeNull();
  expect(screen.getByText('Exact quotation text')).toBeTruthy(); expect(screen.getByText('Please schedule the installation.')).toBeTruthy();
  expect(screen.queryByText('Earlier email content')).toBeNull();
  expect(screen.queryByRole('button', { name: 'View more' })).toBeNull();
  const conversation = screen.getByRole('button', { name: /Quotation/ });
  fireEvent.click(conversation);
  expect(conversation.getAttribute('aria-expanded')).toBe('false');
  expect(articles[0].closest('[hidden]')).toBeTruthy();
  fireEvent.click(conversation);
  expect(conversation.getAttribute('aria-expanded')).toBe('true');
  expect(articles[0].closest('[hidden]')).toBeNull();
  expect([...container.querySelectorAll('[data-email-body]')].every(body => body.classList.contains('inbox-message-typography'))).toBe(true);
});

it('expands a clipped long new reply without restoring quoted text', () => {
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(500);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
  const text = 'New reply line. '.repeat(200);
  const email: ActivityEmail = { id: 'long', providerMessageId: 'long', threadId: 'thread', accountId: 'account', direction: 'inbound', from: 'lead@example.test', to: ['staff@example.test'], subject: 'Reply', sentAt: '2026-10-01T10:00:00Z', body: `<p>${text}</p><div class="gmail_quote">Earlier email content</div>` };
  const { container } = render(<EmailActivity email={email} />);
  const before = container.querySelector('[data-email-body]')!.textContent;
  const expand = screen.getByRole('button', { name: 'View more' }); fireEvent.click(expand);
  expect(expand.getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('[data-email-body]')!.textContent).toBe(before);
  expect(before).toBe(text); expect(screen.queryByText('Earlier email content')).toBeNull();
  expect(screen.getByRole('button', { name: 'View less' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View less' }));
  expect(screen.getByRole('button', { name: 'View more' }).getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('[data-email-body]')!.classList.contains('max-h-32')).toBe(true);
  expect(container.querySelector('[data-email-body]')!.textContent).toBe(before);
});
