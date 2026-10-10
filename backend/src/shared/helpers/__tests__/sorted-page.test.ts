import { expect, it, vi } from 'vitest';
import { sortedPageIds, orderPage } from '../sorted-page';
import { normalizeLeadColumns, normalizeModuleColumns, compareSortValues } from '@leadcrm/shared';

const fields = ['firstName', 'email', 'phone', 'companyName', 'status', 'createdAt', 'source'];
it('treats all missing values equally and puts them last in either direction', () => {
  for (const direction of ['asc', 'desc'] as const) {
    for (const a of [null, undefined, '', new Date('invalid')]) {
      for (const b of [null, undefined, '', new Date('invalid')]) expect(compareSortValues(a, b, direction)).toBe(0);
      expect(compareSortValues(a, 'value', direction)).toBe(1);
      expect(compareSortValues('value', a, direction)).toBe(-1);
    }
  }
});
it.each(fields)('orders %s in both directions before pagination without changing the input', async field => {
  const values = field === 'createdAt' ? [new Date('2026-10-01'), new Date('2026-02-01'), null] : ['zebra', 'Alpha', null];
  const rows = values.map((value, i) => ({ id: String(i), [field]: value }));
  const original = [...rows];
  const read = vi.fn().mockResolvedValue(rows);
  expect(await sortedPageIds(`${field}:asc`, fields, 0, 1, read)).toEqual(['1']);
  expect(await sortedPageIds(`${field}:asc`, fields, 1, 2, read)).toEqual(['0', '2']);
  expect(await sortedPageIds(`${field}:desc`, fields, 0, 3, read)).toEqual(['0', '1', '2']);
  expect(rows).toEqual(original);
});
it('retains default ordering and validates sort keys', async () => {
  const read = vi.fn();
  expect(await sortedPageIds(undefined, fields, 0, 10, read)).toBeNull();
  await expect(sortedPageIds('tenantId:asc', fields, 0, 10, read)).rejects.toThrow();
  await expect(sortedPageIds('email:sideways', fields, 0, 10, read)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(orderPage([{ id: '2' }, { id: '1' }], ['1', '2'])).toEqual([{ id: '1' }, { id: '2' }]);
});

it('uses a bounded database page for date sorting while preserving natural text ordering', async () => {
  const readAll = vi.fn().mockResolvedValue([{ id: 'b', email: 'person10' }, { id: 'a', email: 'Person2' }]);
  const readPage = vi.fn().mockResolvedValue([{ id: 'date-page' }]);
  expect(await sortedPageIds('createdAt:asc', fields, 100, 25, readAll, readPage)).toEqual(['date-page']);
  expect(readPage).toHaveBeenCalledWith('asc'); expect(readAll).not.toHaveBeenCalled();
  expect(await sortedPageIds('email:asc', fields, 0, 25, readAll, readPage)).toEqual(['a', 'b']);
  await expect(sortedPageIds('createdAt:invalid', fields, 0, 25, readAll, readPage)).rejects.toThrow();
  expect(readPage).toHaveBeenCalledOnce();
});
it('migrates combined columns once and preserves independent preferences afterwards', () => {
  const old = [{ id: 'emailAndPhone', visible: true, order: 1 }, { id: 'email', visible: false, order: 2 }, { id: 'phone', visible: false, order: 3 }];
  const migrated = normalizeLeadColumns(old);
  expect(migrated.map(col => [col.id, col.visible])).toEqual([['email', true], ['phone', true]]);
  const customized = migrated.map(col => ({ ...col, visible: col.id !== 'email' }));
  expect(normalizeLeadColumns(customized)).toEqual(customized);
  expect(old).toHaveLength(3);
});

it('preserves saved Group column visibility/order and prefers an existing canonical preference', () => {
  const legacy = [{ id: 'department', visible: false, order: 3 }, { id: 'name', visible: true, order: 0 }];
  const migrated = normalizeModuleColumns('users', legacy);
  expect(migrated).toEqual([{ id: 'groups', visible: false, order: 3 }, legacy[1]]);
  expect(normalizeModuleColumns('users', [...legacy, { id: 'groups', visible: true, order: 2 }]))
    .toEqual([legacy[1], { id: 'groups', visible: true, order: 2 }]);
  expect(normalizeModuleColumns('users', migrated)).toBe(migrated);
  expect(normalizeModuleColumns('contacts', legacy)).toBe(legacy);
  expect(legacy[0].id).toBe('department');
});
