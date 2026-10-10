import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ mockAuth: false, switchAccount: vi.fn(async () => true), toggle: vi.fn() }));
vi.mock('@/lib/config', () => ({ get USE_MOCK_AUTH() { return state.mockAuth; } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({
  user: { firstName: 'Test', lastName: 'User', email: 'test@example.test', role: 'Sales' },
  switchDemoAccount: state.switchAccount, logout: vi.fn(),
}) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import AccountDropdown from '../account-dropdown';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('keeps demo account switching out of a connected session while retaining logout', () => {
  state.mockAuth = false;
  render(<AccountDropdown isOpen onToggle={state.toggle} navigate={() => {}} />);
  expect(screen.queryByText('Switch Role / Demo Host')).toBeNull();
  expect(screen.queryByRole('button', { name: /Bob Sales/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  expect(state.switchAccount).not.toHaveBeenCalled();
});
it('keeps the local Sales fixture available with its actual role label', () => {
  state.mockAuth = true;
  render(<AccountDropdown isOpen onToggle={state.toggle} navigate={() => {}} />);
  const button = screen.getByRole('button', { name: /Bob Sales Sales/ });
  fireEvent.click(button);
  expect(state.switchAccount).toHaveBeenCalledOnce();
  expect(state.switchAccount).toHaveBeenCalledWith('bob@camxian.com', 'admin123');
});
