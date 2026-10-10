import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CUSTOM_FIELD_BUILT_IN_GROUPS, type ClosingField, type CustomFieldModule, type CustomFieldState } from '@leadcrm/shared';
import { useRecordCustomFields, CustomFieldGroup, CustomFieldExtraGroups, RecordCustomFieldDetails } from '../record-custom-fields';
const fixture = vi.hoisted(() => ({ data: { fields: [], values: {}, files: [] } as CustomFieldState, error: null as string | null }));
const api = vi.hoisted(() => ({ put: vi.fn(), refetch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: api }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ ...fixture, isInitialLoad: false, refetch: api.refetch }) }));
const field = (module: CustomFieldModule, changes: Partial<ClosingField> = {}): ClosingField => ({ id: 'field', name: 'Project Budget', module, group: CUSTOM_FIELD_BUILT_IN_GROUPS[module][0], type: 'Number', required: true, active: true, visibleInForm: true, options: [], description: 'Budget in PHP', order: 0, version: 1, ...changes });
function Form({ module, recordId, save }: { module: CustomFieldModule; recordId?: string; save: (value: unknown) => void }) {
  const form = useRecordCustomFields(module, recordId);
  return <form noValidate onSubmit={event => { event.preventDefault(); if (form.validate()) save(form.payload()); }}>
    {CUSTOM_FIELD_BUILT_IN_GROUPS[module].map(group => <section key={group} aria-label={group}><h3>{group}</h3><CustomFieldGroup form={form} group={group} /></section>)}
    <CustomFieldExtraGroups form={form} startNumber={5} /><button disabled={form.blocked}>Save</button>
  </form>;
}
afterEach(cleanup);
beforeEach(() => { fixture.data = { fields: [], values: {}, files: [] }; fixture.error = null; vi.clearAllMocks(); api.put.mockResolvedValue({ success: true }); });
it.each(['leads', 'contacts', 'accounts', 'deals'] as const)('places %s fields in configured sections and rejects invalid/empty values inline', module => {
  fixture.data.fields = [field(module), field(module, { id: 'extra', name: 'Server Count', group: 'Technical Details', required: false, order: 1 })];
  const save = vi.fn(); render(<Form module={module} save={save} />);
  expect(screen.getByLabelText(/Project Budget/).closest('section')?.getAttribute('aria-label')).toBe(CUSTOM_FIELD_BUILT_IN_GROUPS[module][0]);
  expect(screen.getByLabelText('Server Count').closest('section')?.textContent).toContain('5Technical Details');
  fireEvent.click(screen.getByText('Save')); expect(save).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('required');
  fireEvent.change(screen.getByLabelText(/Project Budget/), { target: { value: 'invalid' } });
  expect((screen.getByLabelText(/Project Budget/) as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText(/Project Budget/), { target: { value: '-' } });
  fireEvent.click(screen.getByText('Save')); expect(save).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('valid number');
  fireEvent.change(screen.getByLabelText(/Project Budget/), { target: { value: '25000' } });
  fireEvent.click(screen.getByText('Save')); expect(save).toHaveBeenCalledWith({ field: 25000, extra: null });
});
it('loads existing values, submits only edits and omits hidden, disabled and foreign-module fields', () => {
  fixture.data = { fields: [field('leads'), field('leads', { id: 'hidden', name: 'Hidden', visibleInForm: false }), field('leads', { id: 'disabled', name: 'Disabled', active: false }), field('contacts', { id: 'foreign', name: 'Contact only' })], values: { field: 100, hidden: 'Retained' }, files: [] };
  const save = vi.fn(); render(<Form module="leads" recordId="lead" save={save} />);
  expect((screen.getByLabelText(/Project Budget/) as HTMLInputElement).value).toBe('100');
  for (const name of ['Hidden', 'Disabled', 'Contact only']) expect(screen.queryByLabelText(name)).toBeNull();
  fireEvent.click(screen.getByText('Save')); expect(save).toHaveBeenLastCalledWith({});
  fireEvent.change(screen.getByLabelText(/Project Budget/), { target: { value: '200' } });
  fireEvent.click(screen.getByText('Save')); expect(save).toHaveBeenLastCalledWith({ field: 200 });
});
it('retains hidden and disabled values in grouped details', () => {
  fixture.data = { fields: [field('accounts', { visibleInForm: false }), field('accounts', { id: 'other', name: 'Old note', active: false, type: 'Text' })], values: { field: 12, other: 'History' }, files: [] };
  render(<RecordCustomFieldDetails module="accounts" recordId="account" />);
  expect(screen.getByText('12')).toBeTruthy(); expect(screen.getByText('History')).toBeTruthy(); expect(screen.getByText(/Hidden in forms/)).toBeTruthy(); expect(screen.getByText(/Disabled/)).toBeTruthy();
});
it('keeps a failed definition load from submitting an incomplete record', () => {
  fixture.error = 'Unable to load custom fields'; const save = vi.fn(); render(<Form module="leads" save={save} />);
  expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true); expect(screen.getByRole('alert').textContent).toContain(fixture.error);
});
it('edits Deal custom values inside Details and preserves history on cancel', async () => {
  fixture.data = { fields: [field('deals')], values: { field: 100 }, files: [] };
  render(<RecordCustomFieldDetails module="deals" recordId="deal" canEdit />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit custom fields' }));
  fireEvent.change(screen.getByLabelText(/Project Budget/), { target: { value: '200' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(api.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit custom fields' }));
  expect((screen.getByLabelText(/Project Budget/) as HTMLInputElement).value).toBe('100');
  fireEvent.change(screen.getByLabelText(/Project Budget/), { target: { value: '300' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save custom fields' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/crm/deals/deal', { customFieldValues: { field: 300 } }));
  await waitFor(() => expect(api.refetch).toHaveBeenCalled());
});
it('does not expose custom editing without record edit permission', () => {
  fixture.data = { fields: [field('deals')], values: { field: 100 }, files: [] };
  render(<RecordCustomFieldDetails module="deals" recordId="deal" />);
  expect(screen.queryByRole('button', { name: 'Edit custom fields' })).toBeNull();
});
