import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OrganizationFields, useOrganizationForm } from '../organization-fields';
const fixture = vi.hoisted(() => ({ custom: '', denied: [] as string[], account: { id: 'account', name: 'Linked Company', industry: 'Technology', size: '11-50', website: 'https://company.test' } }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: (key: string) => !fixture.denied.includes(key) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ organizations: [] }) }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: fixture.account, isInitialLoad: false, refetch: vi.fn() }) }));
vi.mock('@/shared/components/entity-combobox', () => ({ EntityCombobox: ({ onChange, disabled, error }: any) => <><button disabled={disabled} type="button" onClick={() => onChange('account')}>Choose Company</button>{error && <p role="alert">{error}</p>}</> }));
vi.mock('../record-custom-fields', () => ({
  useRecordCustomFields: () => ({ fields: [{ id: 'context', name: 'Company context' }], payload: () => ({ context: fixture.custom }), validate: () => !!fixture.custom, query: {} }),
  CustomFieldInput: () => <label>Company context<input onChange={event => { fixture.custom = event.target.value; }} /></label>,
}));
afterEach(cleanup);
beforeEach(() => { fixture.custom = ''; fixture.denied = []; });
function Form({ save, initial }: { save: (data: unknown) => void; initial?: { id: string; companyName?: string; accountId?: string } }) {
  const draft = useOrganizationForm(initial);
  return <form onSubmit={event => { event.preventDefault(); if (draft.validate()) save(draft.payload()); }}><OrganizationFields draft={draft} /><button>Save</button></form>;
}
it('keeps legacy company text and an optional organization without creating an Account', () => {
  const save = vi.fn(); render(<Form save={save} initial={{ id: 'person', companyName: 'Historical company' }} />);
  expect(screen.queryByLabelText('Company Name')).toBeNull();
  fireEvent.click(screen.getByText('Save'));
  expect(save).toHaveBeenCalledWith({ accountId: null });
});
it('shows exactly two exclusive modes and only the account picker when linking', () => {
  const save = vi.fn(); render(<Form save={save} />);
  const existing = screen.getByRole('button', { name: 'Link existing account' });
  const create = screen.getByRole('button', { name: 'Create new account' });
  expect(existing.getAttribute('aria-pressed')).toBe('true');
  expect(create.getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByText('Company name only')).toBeNull();
  for (const label of ['Company Name', 'Industry', 'Company Size', 'Website', 'Company Address']) expect(screen.queryByLabelText(label)).toBeNull();
  fireEvent.click(screen.getByText('Save'));
  expect(save).toHaveBeenLastCalledWith({ accountId: null });
  fireEvent.click(screen.getByText('Choose Company'));
  fireEvent.click(screen.getByText('Save'));
  expect(save).toHaveBeenLastCalledWith({ accountId: 'account' });
  fireEvent.click(create);
  expect(existing.getAttribute('aria-pressed')).toBe('false');
  expect(create.getAttribute('aria-pressed')).toBe('true');
});
it('validates new Account fields, preserves required custom values and reuses the retry identity', () => {
  const save = vi.fn(); render(<Form save={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create new account' }));
  fireEvent.click(screen.getByText('Save')); expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Company Name *'), { target: { value: 'New company' } });
  fireEvent.change(screen.getByLabelText('Industry'), { target: { value: 'Retail' } });
  fireEvent.change(screen.getByLabelText('Company Size'), { target: { value: '51-200' } });
  fireEvent.change(screen.getByLabelText('Company Address'), { target: { value: '42 Main Street\nMakati, Philippines' } });
  fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'bad url' } });
  fireEvent.click(screen.getByText('Save')); expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://new.test' } });
  fireEvent.click(screen.getByText('Save')); expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Company context'), { target: { value: 'Required context' } });
  fireEvent.click(screen.getByText('Save')); fireEvent.click(screen.getByText('Save'));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);
  expect(save.mock.calls[0][0]).toMatchObject({ newAccount: { name: 'New company', industry: 'Retail', size: '51-200', website: 'https://new.test', address: '42 Main Street\nMakati, Philippines', customFieldValues: { context: 'Required context' } } });
  expect(save.mock.calls[0][0]).not.toHaveProperty('accountId');
  expect(save.mock.calls[0][0]).not.toHaveProperty('companyName');
  expect(screen.getByLabelText('Company Address').closest('.space-y-1\\.5')?.className).toContain('sm:col-span-2');
});
it('requires Account permissions for both linking and new company creation', () => {
  fixture.denied = ['accounts.view', 'accounts.create']; render(<Form save={vi.fn()} />);
  expect((screen.getByRole('button', { name: 'Link existing account' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Create new account' }) as HTMLButtonElement).disabled).toBe(true);
});

it('omits stale creation fields after switching back to linking', () => {
  const save = vi.fn(); render(<Form save={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create new account' }));
  fireEvent.change(screen.getByLabelText('Company Name *'), { target: { value: 'Unsaved account' } });
  fireEvent.click(screen.getByRole('button', { name: 'Link existing account' }));
  fireEvent.click(screen.getByText('Choose Company')); fireEvent.click(screen.getByText('Save'));
  expect(save).toHaveBeenCalledWith({ accountId: 'account' });
});
