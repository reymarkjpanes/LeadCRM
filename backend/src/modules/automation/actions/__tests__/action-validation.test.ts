import { expect, it } from 'vitest';
import { validateAction } from '../action-validation';

it('rejects update-field actions for Deals after Deal descriptions are retired', async () => {
  await expect(validateAction(
    { type: 'update_field', config: { field: 'description', value: 'Legacy value' } },
    'deal',
    'tenant',
    undefined,
    true,
  )).rejects.toThrow('Choose an editable field for this record.');
});
