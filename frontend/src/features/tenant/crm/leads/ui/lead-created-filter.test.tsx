import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LeadCreatedFilter, createdFilterCondition, emptyCreatedFilter } from './lead-created-filter';
afterEach(cleanup);
function Filter() {
  const [value, setValue] = useState(emptyCreatedFilter);
  return <><LeadCreatedFilter value={value} onChange={setValue} /><output data-testid="query">{JSON.stringify(createdFilterCondition(value))}</output></>;
}
it('updates the visible condition and structured query, and clears both', () => {
  render(<Filter />);
  fireEvent.change(screen.getByLabelText('Lead Created condition'), { target: { value: 'lte' } });
  fireEvent.change(screen.getByLabelText('Created Date'), { target: { value: '2026-09-25' } });
  expect(screen.getByText('Created ≤ Sep 25, 2026')).toBeTruthy();
  expect(screen.getByTestId('query').textContent).toBe('[{"field":"createdAt","operator":"lte","value":"2026-09-25"}]');
  fireEvent.change(screen.getByLabelText('Lead Created condition'), { target: { value: 'gte' } });
  expect(screen.getByText('Created ≥ Sep 25, 2026')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Lead Created condition'), { target: { value: 'between' } });
  fireEvent.change(screen.getByLabelText('Created From'), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('Created To'), { target: { value: '2026-09-25' } });
  expect(screen.getByText('Created Sep 1, 2026 – Sep 25, 2026')).toBeTruthy();
  expect(screen.getByTestId('query').textContent).toContain('"between","value":["2026-09-01","2026-09-25"]');
  fireEvent.click(screen.getByRole('button', { name: 'Clear Lead Created filter' }));
  expect(screen.getByTestId('query').textContent).toBe('[]');
});
it('rejects reversed ranges before issuing a filter query', () => {
  expect(createdFilterCondition({ operator: 'between', from: '2026-09-25', to: '2026-09-01' })).toEqual([]);
});
