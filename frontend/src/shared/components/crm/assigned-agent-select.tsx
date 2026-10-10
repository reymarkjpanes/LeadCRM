'use client';

import { ChevronDown } from 'lucide-react';
import type { ReactElement } from 'react';
import type { User } from '@/store/types';
import { getAssignableAgents } from '@/shared/utils/assigned-agents';

export function AssignedAgentSelect({
  id,
  value,
  users,
  placeholder = 'Unassigned',
  className,
  invalid = false,
  describedBy,
  name,
  onBlur,
  onChange,
}: {
  id: string;
  value: string;
  users: readonly User[];
  placeholder?: string;
  className: string;
  invalid?: boolean;
  describedBy?: string;
  name?: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
}): ReactElement {
  const options = getAssignableAgents(users);
  const historical = value && !options.some(user => user.id === value) ? users.find(user => user.id === value) : undefined;
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        name={name}
        className={className}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {value && !options.some(user => user.id === value) && <option value={value} disabled>{historical ? `${historical.firstName} ${historical.lastName}` : 'Current assigned agent'} (unavailable)</option>}
        {options.map((user) => (
          <option key={user.id} value={user.id}>
            {user.firstName} {user.lastName}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
    </div>
  );
}
