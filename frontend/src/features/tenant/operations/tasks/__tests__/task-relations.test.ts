import { expect, it } from 'vitest';
import type { TaskRecord } from '@leadcrm/shared';
import { taskRecordOptions } from '../task-relations';

it('retains legacy labels when hydrated arrays are empty and deduplicates mixed responses', () => {
  const task = { leads: [], lead: { id: 'l', firstName: 'Lead', lastName: 'One' }, contacts: [{ id: 'c', firstName: 'Contact', lastName: 'One' }], contact: { id: 'c', firstName: 'Contact', lastName: 'One' }, deals: [], deal: { id: 'd', title: 'Expansion' }, accounts: [], account: { id: 'a', name: 'Acme' } } as unknown as TaskRecord;
  expect(taskRecordOptions(task, 'lead')).toEqual([{ id: 'l', label: 'Lead One' }]);
  expect(taskRecordOptions(task, 'contact')).toEqual([{ id: 'c', label: 'Contact One' }]);
  expect(taskRecordOptions(task, 'deal')).toEqual([{ id: 'd', label: 'Expansion' }]);
  expect(taskRecordOptions(task, 'account')).toEqual([{ id: 'a', label: 'Acme' }]);
});
