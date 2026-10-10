import { expect, it } from 'vitest';
import type { User } from '@/store/types';
import { getAssignableAgents } from './assigned-agents';

it('excludes Client Admin by role while keeping other assignable users', () => {
  const users = [
    { status: 'ACTIVE', assignableAgent: true, id: 'admin', role: 'Client Admin' },
    { status: 'ACTIVE', assignableAgent: true, id: 'admin-case', role: ' client admin ' },
    { status: 'ACTIVE', assignableAgent: true, id: 'sales', role: 'Sales' },
    { status: 'ACTIVE', assignableAgent: true, id: 'support', role: 'Support Agent' },
  ] as User[];

  expect(getAssignableAgents(users).map(user => user.id)).toEqual(['sales', 'support']);
});
