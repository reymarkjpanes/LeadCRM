import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EmailConversationView from './email-conversation-view';
import { forwardDraft, mailboxDate, replyDraft, replyAllDraft } from '../services/email-presentation';
import type { GmailEmail } from '../services/gmail.service';

const mocks = vi.hoisted(() => ({ thread: vi.fn(), read: vi.fn(), archive: vi.fn(), trash: vi.fn(), associate: vi.fn(), correspondent: vi.fn(), readMessage: vi.fn(), archiveGroups: vi.fn(), trashGroups: vi.fn(), send: vi.fn() }));
vi.mock('../services/gmail.service', () => ({ fetchGmailThread: mocks.thread, fetchGmailCorrespondent: mocks.correspondent, setGmailMessageReadState: mocks.readMessage, archiveGmailConversations: mocks.archiveGroups, trashGmailConversations: mocks.trashGroups, sendGmailEmail: mocks.send, setGmailThreadReadState: mocks.read, archiveGmailThread: mocks.archive, trashGmailThread: mocks.trash, associateThreadDeal: mocks.associate }));
vi.mock('motion/react', () => ({ motion: { div: ({ initial, animate, exit, transition, ...props }: any) => <div {...props} /> }, AnimatePresence: ({ children }: any) => children, useReducedMotion: () => true }));
const old: GmailEmail = { id: 'old', threadId: 'conversation', from: 'Staff <staff@camxian.com>', to: ['customer@example.test'], subject: 'Fire Detection Inquiry', snippet: 'Original question', body: '<p>Original question</p>', date: '2026-10-08T05:57:00Z', labels: ['SENT'], isRead: true, direction: 'outbound', leadId: 'lead' };
const latest: GmailEmail = { ...old, id: 'latest', from: 'Doris <customer@example.test>', to: ['staff@camxian.com'], cc: ['Sales <sales@example.test>'], replyToAddress: 'reply@example.test', snippet: 'Please send the catalog', body: '<p>Please send the catalog</p><div class="gmail_quote"><p>On Thursday, Staff wrote:</p><blockquote>Original question</blockquote></div>', date: '2026-10-08T05:58:00Z', labels: ['INBOX', 'UNREAD'], isRead: false, direction: 'inbound' };
const props = () => ({ email: latest, onBack: vi.fn(), onEmailsChanged: vi.fn() });
beforeEach(() => { vi.resetAllMocks(); mocks.thread.mockResolvedValue({ emails: [latest, old], dealOptions: [], canAssociateDeal: false }); mocks.read.mockResolvedValue({ success: true }); mocks.archive.mockResolvedValue({ success: true }); mocks.trash.mockResolvedValue({ success: true }); });
afterEach(cleanup);
const loaded = () => waitFor(() => expect(screen.queryByText('Loading conversation…')).toBeNull());

it('Reply All excludes the connected mailbox, deduplicates recipients and retains the original reply identity', async () => {
  expect(replyAllDraft({ ...latest, to: ['staff@camxian.com', 'Other <other@example.test>'], cc: ['OTHER@example.test', 'staff@camxian.com', 'sales@example.test'] }, 'staff@camxian.com')).toMatchObject({ to: 'reply@example.test, other@example.test, sales@example.test', subject: 'Re: Fire Detection Inquiry', body: '', replyToMessageId: latest.id });
  render(<EmailConversationView {...props()} mailboxEmail="staff@camxian.com" />); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Reply All' }));
  expect((screen.getByLabelText('To') as HTMLInputElement).value.split(',').map(value => value.trim())).toEqual(['reply@example.test', 'sales@example.test']);
});
const correspondentId = 'c_' + 'a'.repeat(32);
const olderTopic: GmailEmail = { ...latest, id: 'older-topic-message', threadId: 'older-topic', subject: 'CCTV quotation', date: old.date, body: '<p>Older quotation</p>' };
const groupedEmail: GmailEmail = { ...latest, conversationId: correspondentId, participants: ['Doris', 'You'], correspondentAddresses: ['customer@example.test'], messageCount: 2 };
const groupResult = (emails = [olderTopic, latest]) => ({ emails, threads: [], messageCount: emails.length });
it('uses correspondent history, distinguishes original topics and marks only expanded messages read', async () => {
  mocks.correspondent.mockResolvedValue(groupResult()); mocks.readMessage.mockResolvedValue({ success: true });
  render(<EmailConversationView {...props()} email={groupedEmail} mailboxEmail="staff@camxian.com" />); await loaded();
  expect(mocks.correspondent).toHaveBeenCalledWith(correspondentId); expect(mocks.thread).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'CCTV quotation' })).toBeTruthy(); expect(screen.getByRole('heading', { name: 'Fire Detection Inquiry' })).toBeTruthy();
  await waitFor(() => expect(mocks.readMessage).toHaveBeenCalledWith('latest', true));
  expect(mocks.readMessage).toHaveBeenCalledOnce(); expect(mocks.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Expand message from Doris' }));
  await waitFor(() => expect(mocks.readMessage).toHaveBeenCalledWith(olderTopic.id, true));
});
it('replies to an older selected message and preserves its own source identity in the composer', async () => {
  mocks.correspondent.mockResolvedValue(groupResult([{ ...olderTopic, isRead: true }, { ...latest, isRead: true }]));
  mocks.send.mockResolvedValue({ success: true });
  render(<EmailConversationView {...props()} email={groupedEmail} mailboxEmail="staff@camxian.com" />); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Expand message from Doris' }));
  const olderArticle = screen.getAllByRole('article')[0];
  fireEvent.click(within(olderArticle).getByRole('button', { name: 'Reply to Doris' }));
  expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Re: CCTV quotation');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Email body' }).textContent).toBe(''));
  screen.getByRole('textbox', { name: 'Email body' }).innerHTML = '<p>Quotation reply</p>';
  fireEvent.click(screen.getByLabelText('Send email'));
  await waitFor(() => expect(mocks.send).toHaveBeenCalled());
  expect(mocks.send.mock.calls[0][3]).toBe(olderTopic.id);
});
it('loads bounded history pages and keeps the message count and existing topic ordering', async () => {
  mocks.correspondent.mockResolvedValueOnce({ ...groupResult([{ ...olderTopic, isRead: true }]), messageCount: 2, nextPageToken: 'next-history' })
    .mockResolvedValueOnce({ ...groupResult([{ ...latest, isRead: true }]), messageCount: 2 });
  render(<EmailConversationView {...props()} email={groupedEmail} />); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(mocks.correspondent).toHaveBeenLastCalledWith(correspondentId, 'next-history');
  expect(screen.queryByRole('button', { name: 'Load more messages' })).toBeNull();
});
it.each([['Archive conversation', 'archiveGroups'], ['Move conversation to trash', 'trashGroups']] as const)('applies %s to the correspondent identity across original Gmail topics', async (label, action) => {
  mocks.correspondent.mockResolvedValue(groupResult([{ ...olderTopic, isRead: true }, { ...latest, isRead: true }])); mocks[action].mockResolvedValue({ success: true });
  const actions = props(); render(<EmailConversationView {...actions} email={groupedEmail} />); await loaded();
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(mocks[action]).toHaveBeenCalledWith([correspondentId])); expect(actions.onBack).toHaveBeenCalledOnce();
});
it('clears correspondent bodies and a reply draft when authorization is revoked', async () => {
  mocks.correspondent.mockResolvedValue(groupResult([{ ...latest, isRead: true }]));
  const actions = props(), view = render(<EmailConversationView {...actions} email={groupedEmail} />); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Reply' })); expect(screen.getByRole('dialog')).toBeTruthy();
  mocks.correspondent.mockRejectedValue(Object.assign(new Error('Access revoked'), { status: 404 }));
  view.rerender(<EmailConversationView {...actions} email={groupedEmail} revision={1} />);
  await waitFor(() => expect(actions.onBack).toHaveBeenCalledOnce());
  expect(screen.queryByRole('article')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
});
it('discards an in-flight history page after a later authorization failure', async () => {
  let finish!: (result: ReturnType<typeof groupResult>) => void;
  mocks.correspondent.mockResolvedValueOnce({ ...groupResult([{ ...olderTopic, isRead: true }]), nextPageToken: 'next' })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockRejectedValueOnce(Object.assign(new Error('Access revoked'), { status: 404 }));
  const actions = props(), view = render(<EmailConversationView {...actions} email={groupedEmail} />); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
  view.rerender(<EmailConversationView {...actions} email={groupedEmail} revision={1} />);
  await waitFor(() => expect(actions.onBack).toHaveBeenCalledOnce());
  await act(async () => finish(groupResult([{ ...latest, body: '<p>Revoked content</p>' }])));
  expect(screen.queryByRole('article')).toBeNull(); expect(screen.queryByText('Revoked content')).toBeNull();
});
it('renders attachments as escaped file labels with message-specific authenticated download paths', async () => {
  mocks.thread.mockResolvedValue({ emails: [{ ...latest, attachments: [{ id: 'file-id', filename: '<script>proposal.pdf', mimeType: 'application/pdf', size: 4 }] }], dealOptions: [], canAssociateDeal: false });
  render(<EmailConversationView {...props()} />); await loaded();
  const link = screen.getByRole('link', { name: '<script>proposal.pdf' });
  expect(link.getAttribute('href')).toBe('/api/proxy/integrations/gmail/messages/latest/attachments/file-id');
  expect(link.hasAttribute('download')).toBe(true); expect(screen.getByRole('list', { name: 'Message attachments' }).querySelector('script')).toBeNull();
});

it('renders chronological vertical messages, one subject, latest expanded, older collapsible with accessible controls', async () => {
  render(<EmailConversationView {...props()} />); await loaded();
  const articles = screen.getAllByRole('article');
  expect(articles.map(article => article.getAttribute('aria-label'))).toEqual(['Message from Staff', 'Message from Doris']);
  expect(screen.getAllByRole('heading')).toHaveLength(1); expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.getByRole('button', { name: 'Expand message from Staff' }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button', { name: 'Collapse message from Doris' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Expand message from Staff' }));
  expect(within(articles[0]).getByText('Original question')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse message from Staff' }));
  expect(within(articles[0]).queryByText('Original question', { selector: 'p' })).toBeNull();
  expect(screen.getByText('Cc: Sales <sales@example.test>')).toBeTruthy();
  expect(screen.getByText(/1:58 PM/)).toBeTruthy();
  expect(within(screen.getByRole('toolbar')).queryByRole('button', { name: /Reply|Forward/ })).toBeNull();
});
it('folds only recognizable quotes and keeps complete sanitized content accessible', async () => {
  render(<EmailConversationView {...props()} />); await loaded();
  const quote = document.querySelector('details')!;
  expect(quote.open).toBe(false); expect(quote.textContent).toContain('Original question');
  expect(quote.querySelector('details')).toBeNull();
  quote.open = true; expect(quote.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Expand message from Staff' }));
  expect(document.querySelector('details')?.open).toBe(true);
  expect(latest.body).toContain('class="gmail_quote"');
});
it('marks unread only once under Strict Mode and does not re-mark read refreshes', async () => {
  const actions = props(), view = render(<StrictMode><EmailConversationView {...actions} /></StrictMode>);
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  expect(mocks.read).toHaveBeenCalledWith('conversation', true);
  mocks.thread.mockResolvedValue({ emails: [{ ...latest, isRead: true }, old], dealOptions: [], canAssociateDeal: false });
  view.rerender(<StrictMode><EmailConversationView {...actions} revision={1} /></StrictMode>);
  await loaded(); expect(mocks.read).toHaveBeenCalledOnce();
});
it('renders a single read message without a provider write', async () => {
  mocks.thread.mockResolvedValue({ emails: [old], dealOptions: [], canAssociateDeal: false });
  render(<EmailConversationView {...props()} email={old} />); await loaded();
  expect(screen.getAllByRole('article')).toHaveLength(1); expect(mocks.read).not.toHaveBeenCalled();
});
it.each([['Archive conversation', 'archive'], ['Move conversation to trash', 'trash']] as const)('applies %s to the thread, then refreshes and returns', async (label, action) => {
  const actions = props(); render(<EmailConversationView {...actions} />); await loaded();
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(actions.onBack).toHaveBeenCalledOnce());
  expect(mocks[action]).toHaveBeenCalledWith('conversation'); expect(actions.onEmailsChanged).toHaveBeenCalled();
});
it('uses the existing composer with Reply-To and blank reply body, and forwards without repeated prefix', async () => {
  render(<EmailConversationView {...props()} />); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('reply@example.test');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Email body' }).textContent).toBe(''));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull();
  expect(replyDraft({ ...latest, subject: 'Re: Inquiry' }).subject).toBe('Re: Inquiry');
  expect(replyDraft(old).to).toBe('customer@example.test');
  const forwarded = forwardDraft({ ...latest, subject: 'Fwd: Inquiry', body: '<p>Full body</p><script>bad()</script><img src="https://tracker.test">' });
  expect(forwarded.subject).toBe('Fwd: Inquiry'); expect(forwarded.to).toBe(''); expect(forwarded.body).toContain('Full body'); expect(forwarded.body).not.toMatch(/<script|<img/);
  expect(screen.queryByText('View related Deal')).toBeNull(); expect(screen.getByRole('link', { name: 'View linked Lead' }).getAttribute('href')).toBe('/crm/leads/lead');
});
it('prevents duplicate association submits and updates visible Deal context', async () => {
  mocks.thread.mockResolvedValue({ emails: [{ ...latest, needsDealAssociation: true }], dealOptions: [{ id: 'deal', title: 'Alarm', stage: 'Proposal' }], canAssociateDeal: true });
  let finish!: () => void; mocks.associate.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  render(<EmailConversationView {...props()} />); await loaded();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'deal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Associate Deal' })); fireEvent.click(screen.getByRole('button', { name: 'Associate Deal' }));
  expect(mocks.associate).toHaveBeenCalledOnce();
  mocks.thread.mockResolvedValue({ emails: [{ ...latest, dealId: 'deal' }], dealOptions: [], canAssociateDeal: true }); finish();
  expect((await screen.findByRole('link', { name: 'View related Deal' })).getAttribute('href')).toBe('/crm/deals/deal');
});
it('keeps saved content on provider failure, reports error and respects retryAt', async () => {
  mocks.read.mockRejectedValue(Object.assign(new Error('Gmail updates paused'), { status: 429, retryAt: new Date(Date.now() + 60000).toISOString() }));
  render(<EmailConversationView {...props()} />); await screen.findByRole('alert');
  expect(screen.getByText('Please send the catalog', { selector: 'p' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.read).toHaveBeenCalledOnce();
});
it('uses Manila calendar dates across midnight regardless of browser timezone', () => {
  const now = new Date('2026-10-08T16:30:00Z');
  expect(mailboxDate('2026-10-08T15:59:00Z', false, now)).toBe('Yesterday');
  expect(mailboxDate('2026-10-08T16:01:00Z', false, now)).toMatch(/12:01 AM/);
  expect(mailboxDate('2026-10-08T16:01:00Z', true, now)).toContain('October 9, 2026');
});
