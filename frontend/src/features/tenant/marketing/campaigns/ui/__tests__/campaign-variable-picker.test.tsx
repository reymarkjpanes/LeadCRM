import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CUSTOM_FIELD_MODULES, campaignApprovedVariableKeys, campaignFieldsForSource, campaignVariableChoices, getCrmFieldCatalog, type ClosingField } from '@leadcrm/shared';
import { CampaignVariablePicker } from '../campaign-variable-picker';

afterEach(cleanup);
const definitions = CUSTOM_FIELD_MODULES.map((module, index): ClosingField => ({ id: `definition-${index}`, version: 1, module, name: module === 'leads' ? 'Customer Age' : 'Age', technicalAlias: 'age', type: 'Number', active: true, required: false, description: '', visibleInForm: true, visibleInDetails: true, group: 'Basic Information', order: 0, options: [] }));
const fields = CUSTOM_FIELD_MODULES.flatMap(module => getCrmFieldCatalog(module, definitions));
const insertionChoices = (catalog = fields, source: 'LEADS' | 'CONTACTS' = 'LEADS') => campaignVariableChoices(catalog, source, { forInsertion: true });
it.each(['missing', 'deleted'])('does not display custom fields with %s definitions', state => {
  const configured = state === 'missing' ? [] : definitions.map(field => ({ ...field, active: false, deletedAt: '2026-10-11T00:00:00.000Z' }));
  const catalog = CUSTOM_FIELD_MODULES.flatMap(module => getCrmFieldCatalog(module, configured));
  const choices = insertionChoices(catalog);
  render(<CampaignVariablePicker choices={choices} onInsert={vi.fn()} />);
  expect(choices.filter(choice => choice.category === 'Custom Fields')).toEqual([]);
  expect(screen.queryByRole('button', { name: /customFieldValues/ })).toBeNull();
  expect(screen.getByText('Custom Fields')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Sender Name/ })).toBeTruthy();
});
it('renders exactly three categories with only Lead/Contact origins, immutable aliases and no new legacy choices', () => {
  const choices = insertionChoices();
  render(<CampaignVariablePicker choices={choices} onInsert={vi.fn()} />);
  expect([...document.querySelectorAll('p')].map(node => node.textContent)).toEqual(['Standard Fields', 'Custom Fields', 'Sender']);
  expect(screen.queryByText('Existing aliases')).toBeNull();
  expect(screen.queryByText('{{first_name}}')).toBeNull();
  expect(screen.getAllByText('{{firstName}}')).toHaveLength(1);
  const ageChoices = screen.getAllByRole('button', { name: /Age.*customFieldValues.age/ }) as HTMLButtonElement[];
  expect(ageChoices).toHaveLength(2);
  expect(ageChoices.filter(button => !button.disabled)).toHaveLength(1);
  expect(ageChoices.find(button => !button.disabled)?.textContent).toContain('Customer Age');
  expect(choices.flatMap(choice => choice.origins).every(origin => ['leads', 'contacts'].includes(origin.module))).toBe(true);
  const excludedKeys = fields.filter(field => ['accounts', 'deals'].includes(field.module) && !fields.some(person => ['leads', 'contacts'].includes(person.module) && person.technicalKey === field.technicalKey)).map(field => field.technicalKey);
  for (const key of excludedKeys) expect(screen.queryByText(`{{${key}}}`)).toBeNull();
  expect(screen.queryByText(/Accounts|Deals/)).toBeNull();
  expect(screen.getByRole('button', { name: /Account.*accountId.*Leads, Contacts/ })).toBeTruthy();
});
it.each(['firstName', 'Customer Age', 'sender', 'Custom Fields', 'Contacts'])('searches labels, keys, classification and module metadata for %s', search => {
  render(<CampaignVariablePicker choices={insertionChoices()} onInsert={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Search variables'), { target: { value: search } });
  expect(document.querySelectorAll('p')).toHaveLength(3);
  expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  if (search === 'sender') expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Sender Name{{sender_name}}', 'Sender Email{{sender_email}}']);
});
it('inserts one shared company key and keeps custom definition identities distinct', () => {
  const onInsert = vi.fn(), choices = insertionChoices(fields, 'CONTACTS');
  render(<CampaignVariablePicker choices={choices} onInsert={onInsert} />);
  fireEvent.click(screen.getByRole('button', { name: /Company.*\{\{companyName\}\}.*Leads, Contacts/ }));
  expect(onInsert).toHaveBeenLastCalledWith('{{companyName}}');
  fireEvent.click(screen.getByRole('button', { name: /Age.*customFieldValues.age.*Contacts/ }));
  expect(onInsert).toHaveBeenLastCalledWith('{{customFieldValues.age}}');
  expect(choices.filter(choice => choice.technicalKey === 'customFieldValues.age').map(choice => choice.origins[0].customFieldId)).toEqual(definitions.slice(0, 2).map(field => field.id));
  expect(choices.filter(choice => choice.technicalKey === 'companyName').map(choice => choice.technicalKey)).toEqual(['companyName']);
});

it.each(['LEADS', 'CONTACTS'] as const)('inserts the catalog company key for %s without a legacy alias', source => {
  const onInsert = vi.fn(), choices = insertionChoices(fields, source);
  render(<CampaignVariablePicker choices={choices} onInsert={onInsert} />);
  const key = 'companyName';
  fireEvent.click(screen.getByText(`{{${key}}}`).closest('button')!);
  expect(onInsert).toHaveBeenCalledExactlyOnceWith(`{{${key}}}`);
  expect(screen.queryByText('{{company_name}}')).toBeNull();
  expect(screen.queryByText('{{first_name}}')).toBeNull();
});
it.each(['LEADS', 'CONTACTS'] as const)('deduplicates equivalent system keys and preserves %s labels and module availability', source => {
  const catalog = fields.map(field => field.technicalKey === 'firstName' && field.module === 'contacts' ? { ...field, label: 'Contact First Name' } : field);
  const choices = insertionChoices(catalog, source);
  for (const key of ['firstName', 'source', 'address', 'assignedUserId', 'createdAt']) {
    const matching = choices.filter(choice => choice.technicalKey === key);
    expect(matching).toHaveLength(1);
    expect(matching[0].origins.map(origin => origin.module)).toEqual(['leads', 'contacts']);
    expect(matching[0].personalizationAvailable).toBe(true);
  }
  expect(choices.find(choice => choice.technicalKey === 'firstName')?.label).toBe(source === 'CONTACTS' ? 'Contact First Name' : 'First Name');
  expect(choices.find(choice => choice.technicalKey === 'companyName')?.personalizationAvailable).toBe(true);
});
it('excludes inactive custom definitions and preserves hidden/unsupported field restrictions', () => {
  const catalog = fields.map(field => field.module === 'contacts' && field.customFieldId ? { ...field, active: false } : field.module === 'leads' && field.customFieldId ? { ...field, visibleInForm: false, visibleInDetails: false } : field);
  const choices = insertionChoices(catalog);
  expect(choices.filter(choice => choice.category === 'Custom Fields')).toHaveLength(1);
  expect(choices.find(choice => choice.category === 'Custom Fields')?.personalizationAvailable).toBe(false);
  const file = { ...fields.find(field => field.customFieldId)!, personalizationAvailable: false, type: 'file' as const };
  expect(insertionChoices([file])[0].personalizationAvailable).toBe(false);
});
it.each(['Accounts', 'Deals'])('returns no insertable results when searching excluded %s origins', module => {
  render(<CampaignVariablePicker choices={insertionChoices()} onInsert={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Search variables'), { target: { value: module } });
  expect(screen.queryAllByRole('button')).toEqual([]);
  expect(screen.getByText('No matching variables.')).toBeTruthy();
});
it.each(['LEADS', 'CONTACTS'] as const)('keeps every insertable %s key backend-approved and preserves saved relationship/canonical/legacy keys', source => {
  const catalog = fields.map(field => field.customFieldId && ['accounts', 'deals'].includes(field.module) ? { ...field, technicalKey: `customFieldValues.${field.module}Age` } : field);
  const choices = insertionChoices(catalog, source), approved = campaignApprovedVariableKeys(catalog, source);
  for (const choice of choices.filter(choice => choice.personalizationAvailable)) expect(approved.has(choice.technicalKey)).toBe(true);
  for (const key of ['first_name', 'last_name', 'company_name', 'contact_number', 'value', 'website', 'customFieldValues.definition-2', 'customFieldValues.definition-3']) expect(approved.has(key)).toBe(true);
  expect(campaignFieldsForSource(catalog, source).some(field => field.module === 'accounts')).toBe(true);
  expect(campaignFieldsForSource(catalog, source).some(field => field.module === 'deals')).toBe(true);
});
it('does not allow legacy aliases to bypass hidden, inactive or unsupported fields', () => {
  const catalog = getCrmFieldCatalog('leads', definitions).map(field => ['phone', 'status'].includes(field.technicalKey) ? { ...field, visibleInForm: false, visibleInDetails: false } : field.customFieldId ? { ...field, active: false } : field);
  const approved = campaignApprovedVariableKeys(catalog);
  expect(approved.has('firstName')).toBe(true); expect(approved.has('first_name')).toBe(true);
  for (const token of ['phone', 'contact_number', 'status', 'customFieldValues.age', 'value', 'customFieldValues.definition-0']) expect(approved.has(token)).toBe(false);
});
