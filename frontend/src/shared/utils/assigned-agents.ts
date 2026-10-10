import type { User } from '@/store/types';
import { isAssignableAgent } from '@leadcrm/shared';

export function assignedAgentName(users: readonly User[], id?: string): string {
  const user = users.find(user => user.id === id);
  return user ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || '—' : '—';
}

/** Users whose role is reserved for tenant administration cannot be assigned as agents. */
export function getAssignableAgents(users: readonly User[]): User[] {
  return users.filter(isAssignableAgent);
}
