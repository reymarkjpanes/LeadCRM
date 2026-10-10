import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import * as source from '../../../../../../shared/src/contracts/workflow-catalog.ts';
import type { ClosingField } from '@leadcrm/shared';
const compiled = createRequire(import.meta.url)('../../../../../../shared/src/contracts/workflow-catalog.js');

describe('canonical Workflow catalog compatibility', () => {
  it('keeps the runtime CommonJS companion in parity with the TypeScript catalog', () => {
    expect(compiled.WORKFLOW_TRIGGERS).toEqual(source.WORKFLOW_TRIGGERS);
    expect(compiled.getAvailableActions()).toEqual(source.getAvailableActions());
    for (const entity of ['lead', 'contact', 'account', 'deal'] as const) expect(compiled.getWorkflowUpdateFields(entity)).toEqual(source.getWorkflowUpdateFields(entity));
  });
  it('maps unique legacy product names and status casing without changing the stored input', () => {
    const products = [{ id: 'product-id', name: 'CCTV' }];
    const draft = { trigger: 'lead.updated', conditions: { operator: 'AND', conditions: [{ field: 'lead.productInterest', operator: 'contains', value: 'cctv' }] }, actions: [{ type: 'update_field', config: { field: 'productInterest', value: ['CCTV'] } }, { type: 'update_field', config: { field: 'status', value: 'HOT' } }] };
    const mapped = source.normalizeWorkflowReferences(draft, products);
    expect(mapped.conditions.conditions[0]).toMatchObject({ field: 'lead.productInterestIds', value: 'product-id' });
    expect(mapped.actions[0].config).toEqual({ field: 'productInterestIds', value: ['product-id'] });
    expect(mapped.actions[1].config.value).toBe('Hot');
    expect(draft.actions[0].config.field).toBe('productInterest');
  });
  it('leaves ambiguous product names and malformed legacy rules visible for repair', () => {
    const draft = { trigger: 'contact.updated', conditions: { conditions: [null, { field: 'contact.productInterests', operator: 'contains', value: 'Same' }] } };
    expect(source.normalizeWorkflowReferences(draft, [{ id: 'a', name: 'Same' }, { id: 'b', name: 'same' }])).toEqual({ ...draft, actions: undefined });
  });
  it('excludes hidden, inactive, other-module, file and governed closing fields', () => {
    const base = { id: 'custom', name: 'Access', module: 'leads', group: 'Additional Information', type: 'Dropdown', active: true, visibleInForm: true, required: false, options: ['Normal', 'Restricted'] } as ClosingField;
    const definitions = [base, { ...base, id: 'hidden', visibleInForm: false }, { ...base, id: 'inactive', active: false }, { ...base, id: 'other', module: 'contacts' }, { ...base, id: 'file', type: 'File Upload' }] as ClosingField[];
    expect(source.getWorkflowCustomFields('lead', definitions)).toEqual([expect.objectContaining({ field: 'customFieldValues.custom', type: 'enum', options: base.options })]);
    expect(source.getWorkflowCustomFields('deal', [{ ...base, module: 'deals', group: 'Closed Won Requirements' }])).toEqual([]);
  });
});
