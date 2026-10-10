import React from 'react';
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssignedAgentSelect } from '../assigned-agent-select';

it('excludes Client Admin users while preserving other assignable users and the empty option', () => {
  render(
    <AssignedAgentSelect
      id="assigned-agent"
      value=""
      users={[
        { status: 'ACTIVE', assignableAgent: true, id: 'admin', role: 'Client Admin', firstName: 'Admin', lastName: 'User' },
        { status: 'ACTIVE', assignableAgent: true, id: 'sales', role: 'Sales', firstName: 'Sales', lastName: 'User' },
      ] as never}
      placeholder="Assign automatically"
      className="select"
      onChange={() => undefined}
    />,
  );

  const options = screen.getAllByRole('option');
  expect(options.map(option => (option as HTMLOptionElement).value)).toEqual(['', 'sales']);
  expect(screen.getByRole('option', { name: 'Assign automatically' })).toBeTruthy();
});
