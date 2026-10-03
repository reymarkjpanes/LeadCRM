import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ leads: vi.fn(), contacts: vi.fn(), accounts: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 't' }, user: { id: 'u', } }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ deals: [{ id: 'deal-id', title: 'Johnny deal', companyName: 'Jact' }] }) }));
vi.mock('@/features/tenant/crm/leads/services/leads.service', () => ({ leadsService: { getAll: mocks.leads } }));
vi.mock('@/features/tenant/crm/accounts/services/accounts.service', () => ({ accountsService: { getAll: mocks.accounts } }));
vi.mock('@/shared/services/contacts-v2.api', () => ({ contactsV2Api: { list: mocks.contacts } }));
import { GlobalOmnibox } from '../global-omnibox';
import { MobileSearchOverlay } from '../mobile-search-overlay';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.leads.mockResolvedValue({ data: [{ id: 'lead-id', firstName: ' Johnny ', lastName: ' Sins ', companyName: 'Jact Inc.', email: 'johnny123@gmail.com' }] });
  mocks.contacts.mockResolvedValue({ data: [{ id: 'contact-id', firstName: ' May Ann ', lastName: ' Tiron ', companyName: 'Google Inc.', email: 'may@example.com' }] });
  mocks.accounts.mockResolvedValue({ data: [{ id: 'account-id', name: 'Jact account' }] });
});
afterEach(cleanup);
async function search() {
  const input = screen.getByRole('textbox');
  input.focus(); fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'johnny' } });
  await screen.findByText('Johnny Sins');
  return input as HTMLInputElement;
}
it.each([['Johnny Sins', 'leads', 'lead-id'], ['May Ann Tiron', 'contacts', 'contact-id'], ['Jact account', 'accounts', 'account-id'], ['Johnny deal', 'deals', 'deal-id']])('selects %s, clears and blurs the input, closes results and navigates by ID', async (name, module, id) => {
  const onResultSelect = vi.fn(); render(<GlobalOmnibox onResultSelect={onResultSelect} />);
  const input = await search();
  expect(screen.getByText('Jact Inc. · johnny123@gmail.com')).toBeTruthy();
  fireEvent.click(screen.getByText(name));
  expect(input.value).toBe(''); expect(document.activeElement).not.toBe(input);
  expect(screen.queryByText(name)).toBeNull();
  expect(onResultSelect).toHaveBeenCalledTimes(1);
  expect(mocks.push).toHaveBeenCalledWith(`/crm/${module}?highlight=${id}`);
});
it('closes the actual mobile overlay on selection', async () => {
  function Harness() { const [open, setOpen] = React.useState(true); return <MobileSearchOverlay isOpen={open} onClose={() => setOpen(false)} />; }
  render(<Harness />); await search(); fireEvent.click(screen.getByText('Johnny Sins'));
  await waitFor(() => expect(screen.queryByRole('search')).toBeNull());
});
it('retains the debounce, minimum length and module scope', async () => {
  render(<GlobalOmnibox />);
  const input = screen.getByRole('textbox'); fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'jo' } });
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(mocks.leads).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Scope Search Module'), { target: { value: 'contacts' } });
  fireEvent.change(input, { target: { value: 'johnny' } });
  expect(mocks.contacts).not.toHaveBeenCalled();
  await screen.findByText('May Ann Tiron');
  expect(mocks.leads).not.toHaveBeenCalled(); expect(mocks.accounts).not.toHaveBeenCalled();
});
it.each([
  [{ firstName: ' Jane ' }, 'Jane'],
  [{ leadPerson: ' Legacy Name ' }, 'Legacy Name'],
  [{ leadPerson: ' ', displayName: ' Display Name ' }, 'Display Name'],
])('uses safe lead name fallbacks', async (fields, expected) => {
  mocks.leads.mockResolvedValue({ data: [{ id: 'lead', ...fields }] });
  render(<GlobalOmnibox />); const input = screen.getByRole('textbox'); fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'query' } });
  await screen.findByText(expected); expect(screen.queryByText('undefined undefined')).toBeNull();
});

it('can immediately search the same term again after selecting a result', async () => {
  render(<GlobalOmnibox />); const input = await search();
  fireEvent.click(screen.getByText('Johnny Sins'));
  input.focus(); fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'johnny' } });
  await screen.findByText('Johnny Sins');
});
